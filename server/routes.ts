import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { registerStripeRoutes } from "./stripe";
import { storage } from "./storage";
import { sendFeedbackEmail, sendReplyToUserEmail } from "./feedbackEmail";
import { verifyBearerIsAdmin, getAdminFirestore } from "./firebaseAdmin";
import { registerEmployeeCalculatorAuthRoutes } from "./employeeCalculatorAuth";
import { insertLaneSchema, insertCostProfileSchema, insertYardSchema, insertTeamMemberSchema, calculateRouteSchema, pricingTiersSchema, chatRouteSchema } from "@shared/schema";
import type { CostProfile, RouteStop } from "@shared/schema";
import { randomUUID } from "crypto";

// ── Helpers ─────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Server-side geo caches (shared by API + internal callers) ───────────────

const GEO_TTL_MS      = 1000 * 60 * 60 * 48;  // 48h — addresses rarely move
const ROUTE_TTL_MS    = 1000 * 60 * 60 * 24;  // 24h — road distances are stable
const SUGGEST_TTL_MS  = 1000 * 60 * 60 * 12;  // 12h — place suggestions
const GEO_MISS_TTL_MS = 1000 * 60 * 10;       // 10m — negative cache for misses
const FETCH_TIMEOUT_MS = 8000;

// Max entries per cache to prevent unbounded memory growth
const MAX_CACHE_SIZE = 10_000;

type CacheEntry<T> = { value: T; expiresAt: number };

type OsrmRouteResult = { distanceKm: number; durationMinutes: number; isEstimate?: boolean };

const geocodeCache      = new Map<string, CacheEntry<{ lat: number; lng: number } | null>>();
const distanceCache     = new Map<string, CacheEntry<OsrmRouteResult>>();
const multiRouteCache   = new Map<string, CacheEntry<{ distanceKm: number; durationMinutes: number }[] | null>>();
const placeSuggestCache = new Map<string, CacheEntry<string[]>>();
const chatRouteCache    = new Map<string, CacheEntry<unknown>>();

const CHAT_ROUTE_TTL_MS = 1000 * 60 * 30; // 30m — same message gives same route

function nowMs(): number {
  return Date.now();
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= nowMs()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

/** Evict oldest entries when cache exceeds MAX_CACHE_SIZE. */
function cacheEvict<T>(cache: Map<string, CacheEntry<T>>): void {
  if (cache.size <= MAX_CACHE_SIZE) return;
  // Evict ~20% oldest (Map iterates in insertion order)
  const toRemove = Math.ceil(cache.size * 0.2);
  let removed = 0;
  for (const key of cache.keys()) {
    if (removed >= toRemove) break;
    cache.delete(key);
    removed++;
  }
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: nowMs() + ttlMs });
  cacheEvict(cache);
}

/** Periodic sweep: remove expired entries from all caches every 10 minutes. */
setInterval(() => {
  const now = nowMs();
  for (const cache of [geocodeCache, distanceCache, multiRouteCache, placeSuggestCache, chatRouteCache]) {
    for (const [key, entry] of cache as Map<string, CacheEntry<unknown>>) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  }
}, 1000 * 60 * 10);

function normalizeLocationKey(location: string): string {
  return location.trim().replace(/\s+/g, " ").toLowerCase();
}

function googleMapsServerKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || process.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function routePairKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  const q = (n: number) => Number(n).toFixed(5);
  return `${q(fromLat)},${q(fromLng)}=>${q(toLat)},${q(toLng)}`;
}

function waypointsKey(waypoints: { lat: number; lng: number }[]): string {
  return waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(";");
}

// Derive hourly fixed cost from a cost profile
function getFixedCostPerHour(p: CostProfile): number {
  const monthlyFixed = p.monthlyTruckPayment + p.monthlyInsurance + p.monthlyMaintenance + p.monthlyPermitsPlates + p.monthlyOther;
  const hoursPerMonth = p.workingDaysPerMonth * p.workingHoursPerDay;
  return hoursPerMonth > 0 ? monthlyFixed / hoursPerMonth : 0;
}

// Fuel cost per km (fuelPrice comes from UI now, not profile)
function getFuelPerKm(fuelConsumptionPer100km: number, fuelPricePerLitre: number): number {
  return (fuelConsumptionPer100km / 100) * fuelPricePerLitre;
}

// All-in cost per hour (fixed + driver)
function getAllInHourly(p: CostProfile): number {
  return getFixedCostPerHour(p) + p.driverPayPerHour;
}

// ── Distance/Duration Calculation ─────────────────────────────────
// Priority: Google Directions API (matches map embed) → OSRM → haversine estimate

const ROUTE_API_TIMEOUT_MS = 10_000;

/**
 * Haversine straight-line distance between two lat/lng points.
 * Used as last-resort fallback when all routing APIs fail.
 */
function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): { distanceKm: number; durationMinutes: number; isEstimate: true } {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  const estimatedRoad = r2(straightLine * 1.3);
  const estimatedMinutes = r2(estimatedRoad / 60 * 60);
  return { distanceKm: estimatedRoad, durationMinutes: estimatedMinutes, isEstimate: true };
}

// ── Google Directions API (primary — matches map embed) ──────────

async function googleDirectionsRoute(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<OsrmRouteResult | null> {
  const gKey = googleMapsServerKey();
  if (!gKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_API_TIMEOUT_MS);
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=driving&key=${gKey}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json() as { status: string; routes: { legs: { distance: { value: number }; duration: { value: number } }[] }[] };
    if (data.status === "OK" && data.routes.length > 0) {
      const leg = data.routes[0].legs[0];
      return {
        distanceKm: r2(leg.distance.value / 1000),
        durationMinutes: r2(leg.duration.value / 60),
      };
    }
    console.log(`[Google Directions] status: ${data.status}`);
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.log(`[Google Directions] ${reason}`);
  }
  return null;
}

/**
 * Google Directions by PLACE NAMES — matches exactly what the map embed shows.
 * This avoids geocoding errors: Google resolves the names itself, same as the embed iframe.
 * Returns legs array with distance/duration plus resolved lat/lng for each waypoint.
 */
async function googleDirectionsByName(
  locationNames: string[],
): Promise<{
  legs: { distanceKm: number; durationMinutes: number }[];
  resolvedCoords: { lat: number; lng: number }[];
} | null> {
  const gKey = googleMapsServerKey();
  if (!gKey || locationNames.length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_API_TIMEOUT_MS);
    const origin = encodeURIComponent(locationNames[0]);
    const destination = encodeURIComponent(locationNames[locationNames.length - 1]);
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${gKey}`;
    if (locationNames.length > 2) {
      const mid = locationNames.slice(1, -1).map((n) => encodeURIComponent(n)).join("|");
      url += `&waypoints=${mid}`;
    }
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json() as {
      status: string;
      routes: Array<{
        legs: Array<{
          distance: { value: number };
          duration: { value: number };
          start_location: { lat: number; lng: number };
          end_location: { lat: number; lng: number };
        }>;
      }>;
      geocoded_waypoints?: Array<{ geocoder_status: string; place_id: string }>;
    };
    if (data.status === "OK" && data.routes.length > 0) {
      const route = data.routes[0];
      const legs = route.legs.map((leg) => ({
        distanceKm: r2(leg.distance.value / 1000),
        durationMinutes: r2(leg.duration.value / 60),
      }));
      // Extract resolved coordinates: first leg start + each leg end
      const resolvedCoords: { lat: number; lng: number }[] = [
        route.legs[0].start_location,
      ];
      for (const leg of route.legs) {
        resolvedCoords.push(leg.end_location);
      }
      console.log(`[Google Directions by name] ${locationNames.join(" → ")} → ${legs.map((l) => `${l.distanceKm}km/${l.durationMinutes}min`).join(", ")}`);
      return { legs, resolvedCoords };
    }
    console.log(`[Google Directions by name] status: ${data.status} for: ${locationNames.join(" → ")}`);
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.log(`[Google Directions by name] ${reason}`);
  }
  return null;
}

async function googleDirectionsMultiRoute(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  const gKey = googleMapsServerKey();
  if (!gKey || waypoints.length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_API_TIMEOUT_MS);
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mid = waypoints.slice(1, -1).map((w) => `${w.lat},${w.lng}`).join("|");
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${gKey}`;
    if (mid) url += `&waypoints=${encodeURIComponent(mid)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json() as { status: string; routes: { legs: { distance: { value: number }; duration: { value: number } }[] }[] };
    if (data.status === "OK" && data.routes.length > 0) {
      return data.routes[0].legs.map((leg) => ({
        distanceKm: r2(leg.distance.value / 1000),
        durationMinutes: r2(leg.duration.value / 60),
      }));
    }
    console.log(`[Google Directions multi] status: ${data.status}`);
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.log(`[Google Directions multi] ${reason}`);
  }
  return null;
}

// ── OSRM (fallback when no Google key) ───────────────────────────

async function osrmRouteUncached(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<OsrmRouteResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_API_TIMEOUT_MS);
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "BungeeConnect/3.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        distanceKm: r2(route.distance / 1000),
        durationMinutes: r2(route.duration / 60),
      };
    }
    console.log(`[OSRM] Non-Ok response: ${data.code} — falling back to haversine`);
    return haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.log(`[OSRM] ${reason} — falling back to haversine`);
    return haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  }
}

async function osrmMultiRouteUncached(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  if (waypoints.length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_API_TIMEOUT_MS);
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "BungeeConnect/3.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const legs = data.routes[0].legs;
      return legs.map((leg: { distance: number; duration: number }) => ({
        distanceKm: r2(leg.distance / 1000),
        durationMinutes: r2(leg.duration / 60),
      }));
    }
    console.log("[OSRM multi] Non-Ok response:", data.code);
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.error(`[OSRM multi] ${reason}:`, err instanceof Error ? err.message : err);
  }
  return null;
}

// ── Unified routing functions: Google → OSRM → haversine ─────────

async function getRoute(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<OsrmRouteResult> {
  const key = routePairKey(fromLat, fromLng, toLat, toLng);
  const hit = cacheGet(distanceCache, key);
  if (hit !== undefined) return hit;
  // Try Google first (matches map embed), fall back to OSRM
  const google = await googleDirectionsRoute(fromLat, fromLng, toLat, toLng);
  if (google) {
    cacheSet(distanceCache, key, google, ROUTE_TTL_MS);
    return google;
  }
  const result = await osrmRouteUncached(fromLat, fromLng, toLat, toLng);
  cacheSet(distanceCache, key, result, ROUTE_TTL_MS);
  return result;
}

async function getMultiRoute(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  if (waypoints.length < 2) return null;
  const key = waypointsKey(waypoints);
  const hit = cacheGet(multiRouteCache, key);
  if (hit !== undefined) return hit;
  // Try Google first, fall back to OSRM
  const google = await googleDirectionsMultiRoute(waypoints);
  if (google) {
    cacheSet(multiRouteCache, key, google, ROUTE_TTL_MS);
    return google;
  }
  const result = await osrmMultiRouteUncached(waypoints);
  cacheSet(multiRouteCache, key, result, ROUTE_TTL_MS);
  return result;
}

// ── Google Geocoding API (primary) ──────────────────────────────
async function googleGeocodeRaw(query: string, countrycodes?: string): Promise<{ lat: number; lng: number } | null> {
  const gKey = googleMapsServerKey();
  if (!gKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const params = new URLSearchParams({ address: query.trim(), key: gKey });
    // Use region bias (soft hint) — NOT components filter which breaks with multiple countries.
    // For single country, use components=country:XX for precision.
    // For multi-country (e.g. "us,ca"), use region bias on the first code only.
    if (countrycodes) {
      const codes = countrycodes.split(",").map((c) => c.trim().toUpperCase());
      if (codes.length === 1) {
        params.set("components", `country:${codes[0]}`);
      } else {
        // Soft region bias on first country — Google will still find results in other countries
        params.set("region", codes[0].toLowerCase());
      }
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json() as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address?: string }>;
    };
    if (data.status === "OK" && data.results.length > 0) {
      const loc = data.results[0].geometry.location;
      console.log(`[Google Geocode] "${query}" → ${loc.lat.toFixed(4)},${loc.lng.toFixed(4)} (${data.results[0].formatted_address ?? ""})`);
      return { lat: loc.lat, lng: loc.lng };
    }
    if (data.status !== "ZERO_RESULTS") {
      console.log(`[Google Geocode] status: ${data.status} for "${query}"`);
    }
  } catch {
    // Timeout or network error — fall through to Nominatim
  }
  return null;
}

// ── Nominatim / OpenStreetMap Geocoding (fallback) ─────────────
async function nominatimGeocodeRaw(query: string, countrycodes?: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    if (countrycodes) {
      url += `&countrycodes=${encodeURIComponent(countrycodes)}`;
    }
    const res = await fetch(url, {
      headers: { "User-Agent": "BungeeConnect/3.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {
    // Timeout or network error — silently fail
  }
  return null;
}

/** Unified geocode: Google → Nominatim fallback */
async function geocodeRaw(query: string, countrycodes?: string): Promise<{ lat: number; lng: number } | null> {
  // Primary: Google Geocoding API
  const google = await googleGeocodeRaw(query, countrycodes);
  if (google) return google;
  // Fallback: Nominatim / OpenStreetMap
  const nom = await nominatimGeocodeRaw(query, countrycodes);
  if (nom) {
    console.log(`[Nominatim fallback] "${query}" → ${nom.lat.toFixed(4)},${nom.lng.toFixed(4)}`);
  }
  return nom;
}

/**
 * Geocode with city extraction fallback.
 * If the full address fails, try progressively shorter comma-separated
 * suffixes to find a city/region match.
 * e.g. "123 Industrial Rd, Suite 5, Toronto, ON" →
 *      try "Suite 5, Toronto, ON" → "Toronto, ON" → "ON"
 */
async function geocodeLocationUncached(location: string, countrycodes?: string): Promise<{ lat: number; lng: number } | null> {
  // Try full address first (with country bias)
  const full = await geocodeRaw(location, countrycodes);
  if (full) return full;

  // Fallback: try progressively shorter suffixes
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(", ");
    if (candidate.length >= 3) {
      const result = await geocodeRaw(candidate, countrycodes);
      if (result) return result;
    }
  }

  // Last resort: try without country bias in case it's a cross-border destination
  if (countrycodes) {
    const noBias = await geocodeRaw(location);
    if (noBias) return noBias;
  }

  return null;
}

async function geocodeLocation(location: string, countrycodes?: string): Promise<{ lat: number; lng: number } | null> {
  const key = normalizeLocationKey(location) + (countrycodes ? `|${countrycodes}` : "");
  if (!key) return null;
  const hit = cacheGet(geocodeCache, key);
  if (hit !== undefined) return hit;
  const result = await geocodeLocationUncached(location, countrycodes);
  cacheSet(geocodeCache, key, result, result ? GEO_TTL_MS : GEO_MISS_TTL_MS);
  return result;
}

/** Google Places Autocomplete — US/CA geocodable results; cached server-side. */
async function googlePlaceSuggestions(query: string): Promise<string[]> {
  const key = normalizeLocationKey(query);
  if (key.length < 2) return [];
  const hit = cacheGet(placeSuggestCache, key);
  if (hit !== undefined) return hit;
  const gKey = googleMapsServerKey();
  if (!gKey) {
    cacheSet(placeSuggestCache, key, [], SUGGEST_TTL_MS);
    return [];
  }
  const params = new URLSearchParams({
    input: query.trim(),
    types: "geocode",
    components: "country:us|country:ca",
    key: gKey,
  });
  const data = (await fetchJsonWithTimeout(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
  )) as { status?: string; predictions?: Array<{ description?: string }> };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    cacheSet(placeSuggestCache, key, [], SUGGEST_TTL_MS);
    return [];
  }
  const list = (data.predictions ?? [])
    .map((p) => p.description?.trim())
    .filter((x): x is string => Boolean(x?.length))
    .slice(0, 10);
  cacheSet(placeSuggestCache, key, list, SUGGEST_TTL_MS);
  return list;
}

// ── Route Cost Calculation ──────────────────────────────────────

function calculateRouteCost(
  profile: CostProfile,
  stops: RouteStop[],
  includeReturn: boolean,
  fuelPricePerLitre: number,
  returnDistanceKm?: number,
  returnDriveMinutes?: number,
) {
  const allInHourly = getAllInHourly(profile);
  const fuelPerKm = getFuelPerKm(profile.fuelConsumptionPer100km, fuelPricePerLitre);

  let totalDriveMinutes = 0;
  let totalDockMinutes = 0;
  let totalDistanceKm = 0;
  const legs: any[] = [];

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    const driveMin = to.driveMinutesFromPrev || 0;
    const distKm = to.distanceFromPrevKm || 0;
    const dockMin = to.dockTimeMinutes || 0;

    totalDriveMinutes += driveMin;
    totalDockMinutes += dockMin;
    totalDistanceKm += distKm;

    const driveHours = driveMin / 60;
    const dockHours = dockMin / 60;
    const legTimeCost = (driveHours + dockHours) * allInHourly;
    const legFuelCost = distKm * fuelPerKm;

    // Determine if this is a "local" leg (under 100km)
    const isLocal = distKm < 100;

    legs.push({
      from: from.location,
      to: to.location,
      type: to.type,
      isLocal,
      distanceKm: r2(distKm),
      driveMinutes: r2(driveMin),
      dockMinutes: r2(dockMin),
      totalBillableHours: r2((driveMin + dockMin) / 60),
      fixedCost: r2((driveMin + dockMin) / 60 * (allInHourly - (profile.driverPayPerHour || 0))),
      driverCost: r2((driveMin + dockMin) / 60 * (profile.driverPayPerHour || 0)),
      fuelCost: r2(legFuelCost),
      legCost: r2(legTimeCost + legFuelCost),
    });
  }

  // Return to yard (deadhead)
  let returnLeg = null;
  if (includeReturn) {
    const retKm = returnDistanceKm || (stops.length > 1 ? stops[stops.length - 1].distanceFromPrevKm || 0 : 0);
    const retMin = returnDriveMinutes || (stops.length > 1 ? stops[stops.length - 1].driveMinutesFromPrev || 0 : 0);
    totalDistanceKm += retKm;
    totalDriveMinutes += retMin;

    const driveHours = retMin / 60;
    const legTimeCost = driveHours * allInHourly;
    const legFuelCost = retKm * fuelPerKm;

    returnLeg = {
      from: stops[stops.length - 1].location,
      to: stops[0].location,
      type: "return",
      isLocal: retKm < 100,
      distanceKm: r2(retKm),
      driveMinutes: r2(retMin),
      dockMinutes: 0,
      totalBillableHours: r2(retMin / 60),
      fixedCost: r2(driveHours * (allInHourly - (profile.driverPayPerHour || 0))),
      driverCost: r2(driveHours * (profile.driverPayPerHour || 0)),
      fuelCost: r2(legFuelCost),
      legCost: r2(legTimeCost + legFuelCost),
    };
    legs.push(returnLeg);
  }

  const totalHours = (totalDriveMinutes + totalDockMinutes) / 60;
  const timeCost = totalHours * allInHourly;
  const fuelCost = totalDistanceKm * fuelPerKm;
  const totalCost = timeCost + fuelCost;

  // Calculate delivery cost (without deadhead return)
  const deliveryCost = legs.filter(l => l.type !== "return").reduce((sum: number, l: any) => sum + l.legCost, 0);
  const deadheadCost = returnLeg ? returnLeg.legCost : 0;

  return {
    legs,
    totalDistanceKm: r2(totalDistanceKm),
    totalDriveMinutes: r2(totalDriveMinutes),
    totalDockMinutes: r2(totalDockMinutes),
    totalHours: r2(totalHours),
    allInHourlyRate: r2(allInHourly),
    fixedCostPerHour: r2(getFixedCostPerHour(profile)),
    fuelPerKm: r2(fuelPerKm),
    deliveryCost: r2(deliveryCost),
    deadheadCost: r2(deadheadCost),
    fullTripCost: r2(totalCost),
  };
}

// ── City aliases & fuzzy matching ───────────────────────────────

const CITY_ALIASES: Record<string, string> = {
  "toronto": "Toronto, ON", "to": "Toronto, ON", "yyz": "Toronto, ON",
  "mississauga": "Mississauga, ON", "sauga": "Mississauga, ON",
  "brampton": "Brampton, ON", "hamilton": "Hamilton, ON",
  "burlington": "Burlington, ON", "oakville": "Oakville, ON",
  "kitchener": "Kitchener, ON", "waterloo": "Waterloo, ON",
  "london": "London, ON", "windsor": "Windsor, ON",
  "ottawa": "Ottawa, ON", "montreal": "Montreal, QC", "mtl": "Montreal, QC",
  "quebec city": "Quebec City, QC", "quebec": "Quebec City, QC",
  "sudbury": "Sudbury, ON", "thunder bay": "Thunder Bay, ON",
  "barrie": "Barrie, ON", "guelph": "Guelph, ON", "cambridge": "Cambridge, ON",
  "st catharines": "St. Catharines, ON", "niagara falls": "Niagara Falls, ON",
  "north york": "North York, ON", "scarborough": "Scarborough, ON",
  "etobicoke": "Etobicoke, ON", "markham": "Markham, ON",
  "vaughan": "Vaughan, ON", "ajax": "Ajax, ON", "oshawa": "Oshawa, ON",
  "whitby": "Whitby, ON", "pickering": "Pickering, ON",
  "kingston": "Kingston, ON", "peterborough": "Peterborough, ON",
  "belleville": "Belleville, ON", "sarnia": "Sarnia, ON",
  "chatham": "Chatham-Kent, ON", "chicago": "Chicago, IL",
  "detroit": "Detroit, MI", "buffalo": "Buffalo, NY",
  "new york": "New York, NY", "nyc": "New York, NY",
  "los angeles": "Los Angeles, CA", "la": "Los Angeles, CA",
  "atlanta": "Atlanta, GA", "dallas": "Dallas, TX",
  "houston": "Houston, TX", "miami": "Miami, FL",
  "boston": "Boston, MA", "philadelphia": "Philadelphia, PA",
  "philly": "Philadelphia, PA", "seattle": "Seattle, WA",
  "denver": "Denver, CO", "minneapolis": "Minneapolis, MN",
  "columbus": "Columbus, OH", "cleveland": "Cleveland, OH",
  "pittsburgh": "Pittsburgh, PA", "indianapolis": "Indianapolis, IN",
  "nashville": "Nashville, TN", "memphis": "Memphis, TN",
  "st louis": "St. Louis, MO", "kansas city": "Kansas City, MO",
  "milwaukee": "Milwaukee, WI", "charlotte": "Charlotte, NC",
  "jacksonville": "Jacksonville, FL",
  "san francisco": "San Francisco, CA", "sf": "San Francisco, CA",
  "portland": "Portland, OR", "calgary": "Calgary, AB",
  "edmonton": "Edmonton, AB", "vancouver": "Vancouver, BC",
  "winnipeg": "Winnipeg, MB", "saskatoon": "Saskatoon, SK",
  "regina": "Regina, SK", "halifax": "Halifax, NS", "moncton": "Moncton, NB",
};

function fuzzyMatchCity(input: string): string | null {
  const trimmed = input.trim();
  // If the input looks like a precise address (contains digits or commas),
  // return it as-is so we geocode the full address instead of matching a city.
  if (/\d/.test(trimmed) || trimmed.includes(",")) return trimmed;

  const lower = trimmed.toLowerCase();
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower];
  for (const [key, val] of Object.entries(CITY_ALIASES)) {
    if (lower.startsWith(key) || key.startsWith(lower)) return val;
  }
  for (const [key, val] of Object.entries(CITY_ALIASES)) {
    if (levenshtein(lower, key) <= 2) return val;
  }
  return trimmed.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Metadata extracted from freight-style chat messages (PU/DEL times, equipment, etc.) */
type FreightMeta = {
  equipment: string | null;
  pickupDetails: string | null;
  deliveryDetails: string | null;
};

/** Strip freight annotations (equipment, PU/DEL details) and return clean location text + metadata */
function extractFreightMeta(message: string): { clean: string; meta: FreightMeta } {
  const meta: FreightMeta = { equipment: null, pickupDetails: null, deliveryDetails: null };

  let clean = message;

  // Equipment line: "Equipment: Dry Van" or "EQUIPMENT: FLATBED" etc.
  const equipMatch = clean.match(/\b(?:equipment|equip|truck\s*type|trailer\s*type)\s*[;；:：]\s*([^\n]+)/i);
  if (equipMatch) {
    meta.equipment = equipMatch[1].trim();
    clean = clean.replace(equipMatch[0], " ");
  }

  // Delivery details MUST be matched before Pickup details so we don't accidentally
  // consume "DEL DETAILS" inside a broader PU match.
  const delMatch = clean.match(/\b(?:del(?:ivery)?\s*(?:details?|info|time|window|appt|appointment)?)\s*[;；:：]\s*([^\n]+)/i);
  if (delMatch) {
    meta.deliveryDetails = delMatch[1].trim();
    clean = clean.replace(delMatch[0], " ");
  }

  const puMatch = clean.match(/\b(?:p\/?u|pick\s*-?\s*up)\s*(?:details?|info|time|window|appt|appointment)?\s*[;；:：]\s*([^\n]+)/i);
  if (puMatch) {
    meta.pickupDetails = puMatch[1].trim();
    clean = clean.replace(puMatch[0], " ");
  }

  // Also strip "LANE:" or "lane:" prefix
  clean = clean.replace(/\blane\s*[;；:：]\s*/i, " ");

  return { clean: clean.trim(), meta };
}

function parseChatMessage(message: string): { locations: string[]; freightMeta: FreightMeta } {
  // Step 1: extract and strip freight metadata (equipment, PU/DEL details)
  const { clean, meta } = extractFreightMeta(message);

  // Step 2: replace arrow-style and dash-style delimiters with a uniform separator
  let normalized = clean
    .replace(/→/g, " to ")
    .replace(/–/g, " to ")    // en-dash (very common in freight: "Toronto – Montreal")
    .replace(/—/g, " to ")    // em-dash
    .replace(/->/g, " to ")
    .replace(/\s*>\s*/g, " to ")
    .replace(/\band\s+then\b/gi, " to ")
    .replace(/\bthen\b/gi, " to ");

  // Only use commas as location separators when there are NO explicit "to"
  // delimiters.  This preserves addresses that contain commas
  // (e.g. "123 Main St, Toronto, ON to 456 Oak Ave, Montreal, QC").
  const hasExplicitDelimiter = /\s+to\s+/i.test(normalized);
  if (!hasExplicitDelimiter) {
    normalized = normalized.replace(/,/g, " to ");
  }

  const parts = normalized.split(/\s+to\s+/i).map(s => s.trim()).filter(s => s.length > 0);
  return { locations: parts.map(p => fuzzyMatchCity(p) || p), freightMeta: meta };
}

// ── Shipment block parser — extracts structured data from pasted freight text ──

type CargoItem = {
  dimensions: string; // e.g. "318×25×187 cm"
  weightKg: number | null;
  pieces: number | null;
  description: string | null;
};

type ShipmentInfo = {
  referenceNumber: string | null;
  cargo: CargoItem[];
  totalWeightKg: number | null;
  totalPieces: number | null;
  productName: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

/** Canadian/US province & state codes used for address detection */
const REGION_CODES = new Set([
  "ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "NT", "YT", "NU",
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

/** Detect if a message looks like a pasted shipment/freight block vs simple chat */
function looksLikeShipmentBlock(msg: string): boolean {
  const indicators = [
    /提货|派送|地址|产品|尺寸|件/,          // Chinese freight keywords
    /pick\s*up\s*address|deliver(y)?\s*address/i,
    /\b\d+\s*[×xX*]\s*\d+\s*[×xX*]\s*\d+/,  // dimensions pattern
    /\b\d+(\.\d+)?\s*kg\b/i,                  // weight in kg
    /\b\d+(\.\d+)?\s*lbs?\b/i,                // weight in lbs
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/,           // Canadian postal code
    /\b\d{5}(-\d{4})?\b/,                      // US zip
  ];
  let score = 0;
  for (const rx of indicators) {
    if (rx.test(msg)) score++;
  }
  // Also check if message is multi-line (pasted block)
  if (msg.split(/\n/).filter(l => l.trim()).length >= 3) score++;
  return score >= 2;
}

function parseShipmentBlock(msg: string): ShipmentInfo {
  const lines = msg.split(/\n/).map(l => l.trim()).filter(Boolean);
  const fullText = lines.join("\n");

  const info: ShipmentInfo = {
    referenceNumber: null,
    cargo: [],
    totalWeightKg: null,
    totalPieces: null,
    productName: null,
    pickupAddress: null,
    deliveryAddress: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };

  // ── Reference number (e.g. HPT11731950)
  const refMatch = fullText.match(/\b([A-Z]{2,5}\d{6,})\b/);
  if (refMatch) info.referenceNumber = refMatch[1];

  // ── Dimensions: NNN×NNN×NNN with optional (cm)/(in)
  const dimMatches = fullText.matchAll(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(?:\(?\s*(cm|in|mm)\s*\)?)?/gi);
  for (const dm of dimMatches) {
    const unit = dm[4] || "cm";
    info.cargo.push({
      dimensions: `${dm[1]}×${dm[2]}×${dm[3]} ${unit}`,
      weightKg: null,
      pieces: null,
      description: null,
    });
  }

  // ── Pieces count: "3板3件" or "X pieces" or "X pcs" or "X板X件"
  const piecesMatch = fullText.match(/(\d+)\s*板\s*(\d+)\s*件/) ||
    fullText.match(/(\d+)\s*(?:pieces?|pcs|件|crates?|pallets?|skids?)/i);
  if (piecesMatch) {
    // For "3板3件" pattern, total pieces = pallets + pieces
    const secondNum = piecesMatch[2] ? parseInt(piecesMatch[2]) : 0;
    info.totalPieces = parseInt(piecesMatch[1]) + secondNum;
  }

  // ── Weight: NNN.NN KG or NNN LBS
  const weightMatch = fullText.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|KG|kgs|千克)/i) ||
    fullText.match(/(\d+(?:[.,]\d+)?)\s*(?:lbs?|pounds?)/i);
  if (weightMatch) {
    const raw = parseFloat(weightMatch[1].replace(",", "."));
    const isLbs = /lbs?|pounds?/i.test(weightMatch[0]);
    info.totalWeightKg = isLbs ? r2(raw * 0.453592) : r2(raw);
  }

  // ── Product name: "产品名称；XXX" or "product: XXX" or "commodity: XXX"
  const productMatch = fullText.match(/(?:产品名称|产品|品名|commodity|product\s*(?:name)?)\s*[;；:：]\s*(.+)/i);
  if (productMatch) info.productName = productMatch[1].trim();

  // ── Pickup address: "提货地址：XXX" or "pickup address: XXX" or "pick up: XXX" or "origin: XXX"
  const pickupLabels = /(?:提货地址|提货|取货地址|pick\s*-?\s*up\s*(?:address)?|origin|shipper)\s*[;；:：]\s*/i;
  const pickupIdx = fullText.search(pickupLabels);
  if (pickupIdx >= 0) {
    const after = fullText.slice(pickupIdx).replace(pickupLabels, "");
    info.pickupAddress = extractAddressBlock(after, lines, pickupIdx, fullText);
  }

  // ── Delivery address: "派送地址；XXX" or "delivery address: XXX" or "consignee: XXX" or "deliver to: XXX"
  const delivLabels = /(?:派送地址|派送|送货地址|收货地址|deliver(?:y)?\s*(?:address|to)?|consignee|destination|drop\s*-?\s*off)\s*[;；:：]\s*/i;
  const delivIdx = fullText.search(delivLabels);
  if (delivIdx >= 0) {
    const after = fullText.slice(delivIdx).replace(delivLabels, "");
    info.deliveryAddress = extractAddressBlock(after, lines, delivIdx, fullText);
  }

  // ── Contact phone: various formats
  const phoneMatch = fullText.match(/\b(\+?1?\s*[-.]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/);
  if (phoneMatch) info.contactPhone = phoneMatch[1].replace(/\s+/g, "");

  // ── Contact email
  const emailMatch = fullText.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) info.contactEmail = emailMatch[1];

  // ── Contact name: try to find a person/company name near the delivery address
  // Look for a line that has a name-like pattern (capitalized words, no digits, no labels)
  if (info.deliveryAddress) {
    const delivStart = fullText.indexOf(info.deliveryAddress);
    const nearbyText = fullText.slice(Math.max(0, delivIdx), delivStart + info.deliveryAddress.length + 200);
    const nameLines = nearbyText.split(/\n/).map(l => l.trim()).filter(l =>
      l.length > 2 &&
      l.length < 60 &&
      !/\d/.test(l) &&
      !/[;；:：@]/.test(l) &&
      !/提货|派送|地址|产品|尺寸|deliver|pickup|address|phone|email/i.test(l)
    );
    if (nameLines.length > 0) info.contactName = nameLines[0];
  }

  return info;
}

/** Extract an address block from text following a label, collecting multi-line addresses */
function extractAddressBlock(after: string, _lines: string[], _labelIdx: number, _fullText: string): string {
  // Collect lines until we hit another label or end
  const addressLines: string[] = [];
  const splitLines = after.split(/\n/).map(l => l.trim()).filter(Boolean);

  const stopLabels = /^(?:派送|提货|取货|送货|收货|deliver|pickup|pick\s*up|origin|consignee|destination|drop\s*off|产品|品名|product|commodity|phone|email|contact|tel)/i;

  for (const line of splitLines) {
    if (addressLines.length > 0 && stopLabels.test(line)) break;
    // Skip lines that are just phone numbers or emails
    if (/^[+\d(][\d\s\-().]+$/.test(line) && line.replace(/\D/g, "").length >= 10) {
      // This is a phone number — don't include in address but stop collecting
      break;
    }
    if (/^[a-zA-Z0-9._%+-]+@/.test(line)) break;
    addressLines.push(line);
    // If line contains a postal/zip code, good stopping point
    if (/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/.test(line) || /\b\d{5}(-\d{4})?\b/.test(line)) break;
    // If line contains country code like "CA" or "US" at end, stop
    if (/\b(CA|US|USA|Canada)\s*$/i.test(line)) break;
    // Max 5 lines for an address block
    if (addressLines.length >= 5) break;
  }

  return addressLines.join(", ").replace(/,\s*,/g, ",").trim();
}

// ── Register Routes ─────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  registerEmployeeCalculatorAuthRoutes(app);

  // === COST PROFILES ===
  app.get("/api/profiles", async (_req, res) => {
    res.json(await storage.getCostProfiles());
  });

  app.get("/api/profiles/:id", async (req, res) => {
    const p = await storage.getCostProfile(req.params.id);
    if (!p) return res.status(404).json({ error: "Profile not found" });
    res.json({
      ...p,
      fixedCostPerHour: r2(getFixedCostPerHour(p)),
      allInHourlyRate: r2(getAllInHourly(p)),
    });
  });

  app.post("/api/profiles", async (req, res) => {
    try {
      const parsed = insertCostProfileSchema.parse(req.body);
      const profile = await storage.createCostProfile(parsed);
      res.status(201).json(profile);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/profiles/:id", async (req, res) => {
    try {
      const updated = await storage.updateCostProfile(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Profile not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/profiles/:id", async (req, res) => {
    const deleted = await storage.deleteCostProfile(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  // === YARDS ===
  app.get("/api/yards", async (_req, res) => {
    res.json(await storage.getYards());
  });

  app.post("/api/yards", async (req, res) => {
    try {
      const parsed = insertYardSchema.parse(req.body);
      const yard = await storage.createYard(parsed);
      res.status(201).json(yard);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/yards/:id", async (req, res) => {
    const updated = await storage.updateYard(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Yard not found" });
    res.json(updated);
  });

  app.delete("/api/yards/:id", async (req, res) => {
    const deleted = await storage.deleteYard(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  // === TEAM MEMBERS ===
  app.get("/api/team", async (_req, res) => {
    res.json(await storage.getTeamMembers());
  });

  app.post("/api/team", async (req, res) => {
    try {
      const parsed = insertTeamMemberSchema.parse(req.body);
      const member = await storage.createTeamMember(parsed);
      res.status(201).json(member);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/team/:id", async (req, res) => {
    const updated = await storage.updateTeamMember(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Member not found" });
    res.json(updated);
  });

  app.delete("/api/team/:id", async (req, res) => {
    const deleted = await storage.deleteTeamMember(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  app.post("/api/team/auth", async (req, res) => {
    const { pin } = req.body;
    const member = await storage.authenticateByPin(pin);
    if (!member) return res.status(401).json({ error: "Invalid PIN" });
    res.json({ id: member.id, name: member.name, role: member.role });
  });

  // === GEOCODE ===
  app.get("/api/geocode", async (req, res) => {
    const location = req.query.location as string;
    const countrycodes = req.query.countrycodes as string | undefined;
    if (!location) return res.status(400).json({ error: "location required" });
    // Bias geocoding to US + Canada by default for trucking routes; override with specific country if provided
    const bias = countrycodes || "us,ca";
    const result = await geocodeLocation(location, bias);
    if (!result) return res.status(404).json({ error: "Location not found" });
    res.json(result);
  });

  app.get("/api/place-suggestions", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim().length < 2) return res.json({ suggestions: [] });
    try {
      const suggestions = await googlePlaceSuggestions(q);
      res.json({ suggestions });
    } catch {
      res.json({ suggestions: [] });
    }
  });

  /** Resolves a place description (e.g. "Toronto, ON, Canada") into structured fields.
   *  Used by the signup form city autocomplete to extract city/state/country/lat/lng. */
  app.get("/api/place-resolve", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.status(400).json({ error: "q required" });
    const gKey = googleMapsServerKey();
    if (!gKey) return res.status(503).json({ error: "Maps not configured" });
    try {
      const params = new URLSearchParams({ address: q, key: gKey });
      const data = await fetchJsonWithTimeout(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
      ) as {
        status: string;
        results: Array<{
          geometry: { location: { lat: number; lng: number } };
          address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
        }>;
      };
      if (data.status !== "OK" || !data.results?.length) {
        return res.status(404).json({ error: "Not found" });
      }
      const r = data.results[0];
      const get = (type: string, key: "long_name" | "short_name") =>
        r.address_components.find((c) => c.types.includes(type))?.[key] ?? "";
      return res.json({
        city:
          get("locality", "long_name") ||
          get("sublocality_level_1", "long_name") ||
          get("postal_town", "long_name") ||
          q.split(",")[0].trim(),
        stateName: get("administrative_area_level_1", "long_name"),
        stateCode: get("administrative_area_level_1", "short_name"),
        countryName: get("country", "long_name"),
        countryCode: get("country", "short_name"),
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      });
    } catch {
      return res.status(500).json({ error: "Geocoding failed" });
    }
  });

  // === DISTANCE BETWEEN TWO POINTS (Google Directions → OSRM fallback) ===
  app.get("/api/distance", async (req, res) => {
    const fromLat = parseFloat(req.query.fromLat as string);
    const fromLng = parseFloat(req.query.fromLng as string);
    const toLat = parseFloat(req.query.toLat as string);
    const toLng = parseFloat(req.query.toLng as string);
    if (isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }
    const result = await getRoute(fromLat, fromLng, toLat, toLng);
    if (!result) return res.status(500).json({ error: "Routing failed" });
    res.json(result);
  });

  // === NAME-BASED DIRECTIONS (matches Google Maps embed behavior) ===
  // Accepts location *names* instead of coordinates — the server passes them
  // straight to Google Directions API so the resolved distance/duration exactly
  // matches what the Google Maps Embed shows on the map.
  app.post("/api/directions-by-name", async (req, res) => {
    const { locations } = req.body as { locations: string[] };
    if (!Array.isArray(locations) || locations.length < 2 || locations.some((l) => typeof l !== "string" || !l.trim())) {
      return res.status(400).json({ error: "Need at least 2 non-empty location strings" });
    }

    // Try Google Directions with place names (primary — matches embed)
    const gResult = await googleDirectionsByName(locations);
    if (gResult) {
      return res.json({
        legs: gResult.legs,
        resolvedCoords: gResult.resolvedCoords,
        source: "google-directions-by-name",
      });
    }

    // Fallback: geocode each name → coordinates, then route between them
    console.log("[/api/directions-by-name] Google name-based failed, falling back to geocode+route");
    const coords: ({ lat: number; lng: number } | null)[] = await Promise.all(
      locations.map((loc) => geocodeRaw(loc.trim())),
    );
    const validWaypoints: { lat: number; lng: number }[] = [];
    const coordResults: ({ lat: number; lng: number } | null)[] = [];
    for (const c of coords) {
      coordResults.push(c);
      if (c) validWaypoints.push(c);
    }
    if (validWaypoints.length < 2) {
      return res.status(422).json({ error: "Could not geocode enough locations" });
    }
    const legs = await getMultiRoute(validWaypoints);
    if (!legs) {
      return res.status(500).json({ error: "Routing failed" });
    }
    return res.json({
      legs,
      resolvedCoords: coordResults,
      source: "geocode-fallback",
    });
  });

  // === MULTI-WAYPOINT DISTANCE (Google Directions → OSRM fallback) ===
  app.post("/api/distances", async (req, res) => {
    const { waypoints } = req.body as { waypoints: { lat: number; lng: number }[] };
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return res.status(400).json({ error: "Need at least 2 waypoints" });
    }
    for (const wp of waypoints) {
      if (typeof wp.lat !== "number" || typeof wp.lng !== "number" || isNaN(wp.lat) || isNaN(wp.lng)) {
        return res.status(400).json({ error: "Invalid waypoint coordinates" });
      }
    }
    let legs = await getMultiRoute(waypoints);
    if (!legs) {
      // Multi-waypoint OSRM failed (timeout, unroutable, etc.)
      // Fall back to per-leg haversine estimates
      console.log("[/api/distances] Multi-waypoint routing failed, falling back to per-leg haversine");
      legs = [];
      for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const cur = waypoints[i];
        legs.push(haversineDistanceKm(prev.lat, prev.lng, cur.lat, cur.lng));
      }
    }
    res.json({ legs });
  });

  // === ROUTE CALCULATION ===
  app.post("/api/calculate-route", async (req, res) => {
    try {
      const input = calculateRouteSchema.parse(req.body);
      const profile = await storage.getCostProfile(input.profileId);
      if (!profile) return res.status(400).json({ error: "Equipment cost profile not found" });

      const result = calculateRouteCost(
        profile, input.stops, input.includeReturn, input.fuelPricePerLitre
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // === PRICING ADVICE ===
  app.post("/api/pricing-advice", async (req, res) => {
    try {
      const { totalCost, customMarginPercent, customQuoteAmount } = pricingTiersSchema.parse(req.body);
      const tiers = [
        { label: "20% Margin", percent: 20, price: r2(totalCost * 1.20), marginAmount: r2(totalCost * 0.20) },
        { label: "30% Margin", percent: 30, price: r2(totalCost * 1.30), marginAmount: r2(totalCost * 0.30) },
        { label: "40% Margin", percent: 40, price: r2(totalCost * 1.40), marginAmount: r2(totalCost * 0.40) },
      ];

      let customPercent = null;
      if (customMarginPercent !== undefined && customMarginPercent > 0) {
        customPercent = {
          label: "Custom %",
          percent: customMarginPercent,
          price: r2(totalCost * (1 + customMarginPercent / 100)),
          marginAmount: r2(totalCost * customMarginPercent / 100),
        };
      }

      // Custom $ amount → compute margin %
      let customQuote = null;
      if (customQuoteAmount !== undefined && customQuoteAmount > 0 && totalCost > 0) {
        const marginPercent = r2(((customQuoteAmount - totalCost) / totalCost) * 100);
        customQuote = {
          label: "Custom Quote",
          quoteAmount: customQuoteAmount,
          marginPercent,
          marginAmount: r2(customQuoteAmount - totalCost),
        };
      }

      res.json({ totalCost: r2(totalCost), tiers, customPercent, customQuote });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  function applyQuoteMargin(
    totalCarrierCost: number,
    marginType: "flat" | "percentage",
    marginValue: number,
  ) {
    let customerPrice: number;
    let marginAmount: number;
    if (marginType === "percentage") {
      customerPrice = r2(totalCarrierCost * (1 + marginValue / 100));
      marginAmount = r2(customerPrice - totalCarrierCost);
    } else {
      marginAmount = r2(marginValue);
      customerPrice = r2(totalCarrierCost + marginValue);
    }
    const grossProfit = marginAmount;
    const profitMarginPercent =
      totalCarrierCost > 0 ? r2((grossProfit / totalCarrierCost) * 100) : 0;
    return { marginAmount, customerPrice, grossProfit, profitMarginPercent };
  }

  // === RATE TABLES (quote calculator) ===
  app.get("/api/rates", async (_req, res) => {
    res.json(await storage.getRates());
  });

  app.put("/api/rates/:truckType", async (req, res) => {
    const updated = await storage.updateRate(req.params.truckType, {
      ratePerMile: Number(req.body.ratePerMile),
      fuelSurchargePercent: Number(req.body.fuelSurchargePercent),
      minCharge: Number(req.body.minCharge),
    });
    updated ? res.json(updated) : res.status(404).json({ error: "Unknown truck type" });
  });

  app.get("/api/hourly-rates", async (_req, res) => {
    res.json(await storage.getHourlyRates());
  });

  app.put("/api/hourly-rates/:truckType", async (req, res) => {
    const { truckType, ...rest } = { truckType: req.params.truckType, ...req.body };
    const updated = await storage.updateHourlyRate(req.params.truckType, rest);
    updated ? res.json(updated) : res.status(404).json({ error: "Unknown truck type" });
  });

  const calculateQuoteBody = z.object({
    origin: z.string(),
    destination: z.string(),
    truckType: z.string(),
    distance: z.number(),
    pricingMode: z.enum(["per_mile", "fixed_lane", "local_pd"]),
    laneId: z.string().optional(),
    marginType: z.enum(["flat", "percentage"]),
    marginValue: z.number(),
  });

  app.post("/api/calculate", async (req, res) => {
    try {
      const body = calculateQuoteBody.parse(req.body);
      const rates = await storage.getRates();
      const rate = rates.find((r) => r.truckType === body.truckType);
      if (!rate) return res.status(400).json({ error: "Unknown truck type" });

      let carrierCost: number;
      if (body.pricingMode === "fixed_lane") {
        if (!body.laneId) return res.status(400).json({ error: "laneId required for fixed lane" });
        const lane = await storage.getLane(body.laneId);
        if (!lane) return res.status(404).json({ error: "Lane not found" });
        carrierCost = r2(lane.fixedPrice);
      } else {
        carrierCost = r2(body.distance * rate.ratePerMile);
      }

      const fuelSurcharge = r2(carrierCost * (rate.fuelSurchargePercent / 100));
      const subtotal = r2(carrierCost + fuelSurcharge);
      const totalCarrierCost = r2(Math.max(subtotal, rate.minCharge));
      const m = applyQuoteMargin(totalCarrierCost, body.marginType, body.marginValue);

      res.json({
        carrierCost,
        fuelSurcharge,
        totalCarrierCost,
        marginAmount: m.marginAmount,
        customerPrice: m.customerPrice,
        grossProfit: m.grossProfit,
        profitMarginPercent: m.profitMarginPercent,
        ratePerMile: rate.ratePerMile,
        fuelSurchargePercent: rate.fuelSurchargePercent,
        minCharge: rate.minCharge,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid request";
      res.status(400).json({ error: msg });
    }
  });

  const calculateLocalBody = z.object({
    truckType: z.string(),
    distanceKm: z.number(),
    pickupDockMinutes: z.number(),
    deliveryDockMinutes: z.number(),
    additionalStops: z.array(
      z.object({
        location: z.string(),
        dockTimeMinutes: z.number(),
        distanceKm: z.number(),
      }),
    ),
    isRoundTrip: z.boolean(),
    isRushHour: z.boolean(),
    marginType: z.enum(["flat", "percentage"]),
    marginValue: z.number(),
  });

  app.post("/api/calculate-local", async (req, res) => {
    try {
      const body = calculateLocalBody.parse(req.body);
      const hourlyList = await storage.getHourlyRates();
      const hr = hourlyList.find((h) => h.truckType === body.truckType);
      if (!hr) return res.status(400).json({ error: "Unknown truck type" });

      const rushMultiplier = body.isRushHour ? 1.15 : 1;
      const oneWayKm = body.distanceKm;
      const returnKm = body.isRoundTrip ? oneWayKm : 0;
      const extraKm = body.additionalStops.reduce((s, st) => s + st.distanceKm, 0);
      const totalKm = r2(oneWayKm + returnKm + extraKm);

      const speed = Math.max(hr.citySpeedKmh, 1);
      const driveOneWayMin = (oneWayKm / speed) * 60 * rushMultiplier;
      const returnTimeMinutes = body.isRoundTrip ? (returnKm / speed) * 60 * rushMultiplier : 0;
      const extraDriveMin = body.additionalStops.reduce(
        (s, st) => s + (st.distanceKm / speed) * 60 * rushMultiplier,
        0,
      );
      const driveTimeMinutes = r2(driveOneWayMin + extraDriveMin);
      const dockTimeMinutes = r2(
        body.pickupDockMinutes +
          body.deliveryDockMinutes +
          body.additionalStops.reduce((s, st) => s + st.dockTimeMinutes, 0),
      );
      const totalMinutes = r2(driveTimeMinutes + returnTimeMinutes + dockTimeMinutes);
      const totalHours = r2(totalMinutes / 60);

      const allInHourlyRate = r2(
        hr.driverPayPerHour +
          hr.truckCostPerHour +
          hr.insurancePerHour +
          hr.maintenancePerHour +
          hr.miscPerHour,
      );
      const timeCost = r2(totalHours * allInHourlyRate);
      const fuelCost = r2(totalKm * hr.fuelPerKm);
      const totalCarrierCost = r2(timeCost + fuelCost);
      const m = applyQuoteMargin(totalCarrierCost, body.marginType, body.marginValue);

      res.json({
        driveTimeMinutes,
        dockTimeMinutes,
        returnTimeMinutes: r2(returnTimeMinutes),
        totalMinutes,
        totalHours,
        oneWayKm,
        returnKm,
        totalKm,
        allInHourlyRate,
        timeCost,
        fuelCost,
        totalCarrierCost,
        marginAmount: m.marginAmount,
        customerPrice: m.customerPrice,
        grossProfit: m.grossProfit,
        profitMarginPercent: m.profitMarginPercent,
        fuelPerKm: hr.fuelPerKm,
        citySpeedKmh: hr.citySpeedKmh,
        rushMultiplier,
        stopsCount: body.additionalStops.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid request";
      res.status(400).json({ error: msg });
    }
  });

  // === CHATBOT ROUTE PARSING ===
  app.post("/api/chat-route", async (req, res) => {
    try {
      const { message, dockTimeMinutes: clientDockTime } = chatRouteSchema.parse(req.body);
      const dockTimeMin = clientDockTime ?? 60;

      // ── Cache check: same message + dock time → same result ──
      const chatCacheKey = `${normalizeLocationKey(message)}|dock=${dockTimeMin}`;
      const chatHit = cacheGet(chatRouteCache, chatCacheKey);
      if (chatHit) return res.json(chatHit);

      // ── Smart detect: is this a pasted shipment block or a simple chat? ──
      let locations: string[];
      let shipment: ShipmentInfo | null = null;
      let freightMeta: FreightMeta | null = null;

      if (looksLikeShipmentBlock(message)) {
        shipment = parseShipmentBlock(message);
        // Build locations array from extracted pickup/delivery
        locations = [];
        if (shipment.pickupAddress) locations.push(shipment.pickupAddress);
        if (shipment.deliveryAddress) locations.push(shipment.deliveryAddress);

        if (locations.length < 2) {
          // Fallback: try regular chat parse on the original message
          const parsed = parseChatMessage(message);
          locations = parsed.locations;
          freightMeta = parsed.freightMeta;
        }
      } else {
        const parsed = parseChatMessage(message);
        locations = parsed.locations;
        freightMeta = parsed.freightMeta;
      }

      if (locations.length < 2) {
        return res.json({
          success: false,
          message: shipment
            ? "I found shipment details but couldn't identify both a pickup and delivery address. Please include both addresses."
            : "I need at least 2 locations to build a route. Try something like 'Toronto to Montreal' or paste a shipment order with pickup and delivery addresses.",
          locations: [],
          shipment: shipment || undefined,
        });
      }

      // ── PRIMARY: Google Directions by place name ──────────────────
      // This matches EXACTLY what the Google Maps embed shows — Google resolves
      // the place names itself, avoiding geocoding discrepancies.
      const byName = await googleDirectionsByName(locations);

      let stopsWithGeo: any[];
      let returnDistance: OsrmRouteResult | null = null;

      if (byName && byName.legs.length === locations.length - 1) {
        // Build stops using Google-resolved coordinates and distances
        stopsWithGeo = locations.map((loc, i) => ({
          id: randomUUID().slice(0, 8),
          type: i === 0 ? "pickup" : i === locations.length - 1 ? "delivery" : "stop",
          location: loc,
          lat: byName.resolvedCoords[i]?.lat,
          lng: byName.resolvedCoords[i]?.lng,
          dockTimeMinutes: dockTimeMin,
          distanceFromPrevKm: i > 0 ? byName.legs[i - 1].distanceKm : 0,
          driveMinutesFromPrev: i > 0 ? byName.legs[i - 1].durationMinutes : 0,
        }));

        // Return distance (last → first) using Google-resolved coords
        const first = byName.resolvedCoords[0];
        const last = byName.resolvedCoords[byName.resolvedCoords.length - 1];
        if (first && last) {
          returnDistance = await getRoute(last.lat, last.lng, first.lat, first.lng);
        }

        // Also cache the Google-resolved geocodes for future use
        for (let i = 0; i < locations.length; i++) {
          const coord = byName.resolvedCoords[i];
          if (coord) {
            const key = normalizeLocationKey(locations[i]) + "|us,ca";
            cacheSet(geocodeCache, key, coord, GEO_TTL_MS);
          }
        }
      } else {
        // ── FALLBACK: geocode separately then route by coordinates ──
        console.log("[chat-route] Google Directions by name failed, falling back to geocode + route");
        const geocoded = await Promise.all(
          locations.map(async (loc) => ({ loc, geo: await geocodeLocation(loc, "us,ca") })),
        );

        stopsWithGeo = geocoded.map(({ loc, geo }, i) => ({
          id: randomUUID().slice(0, 8),
          type: i === 0 ? "pickup" : i === locations.length - 1 ? "delivery" : "stop",
          location: loc,
          lat: geo?.lat,
          lng: geo?.lng,
          dockTimeMinutes: dockTimeMin,
          distanceFromPrevKm: 0,
          driveMinutesFromPrev: 0,
        }));

        const waypoints: { lat: number; lng: number }[] = [];
        const geoIdxToWpIdx = new Map<number, number>();
        stopsWithGeo.forEach((s: any, i: number) => {
          if (typeof s.lat === "number" && typeof s.lng === "number") {
            geoIdxToWpIdx.set(i, waypoints.length);
            waypoints.push({ lat: s.lat, lng: s.lng });
          }
        });

        const multiLegs = waypoints.length >= 2 ? await getMultiRoute(waypoints) : null;

        for (let i = 1; i < stopsWithGeo.length; i++) {
          const prevWp = geoIdxToWpIdx.get(i - 1);
          const curWp = geoIdxToWpIdx.get(i);
          if (
            prevWp != null && curWp != null &&
            curWp === prevWp + 1 && multiLegs && multiLegs[prevWp]
          ) {
            stopsWithGeo[i].distanceFromPrevKm = multiLegs[prevWp].distanceKm;
            stopsWithGeo[i].driveMinutesFromPrev = multiLegs[prevWp].durationMinutes;
            continue;
          }
          const prev = stopsWithGeo[i - 1];
          const cur = stopsWithGeo[i];
          if (
            typeof prev?.lat === "number" && typeof prev?.lng === "number" &&
            typeof cur?.lat === "number" && typeof cur?.lng === "number"
          ) {
            const route = await getRoute(prev.lat, prev.lng, cur.lat, cur.lng);
            if (route) {
              cur.distanceFromPrevKm = route.distanceKm;
              cur.driveMinutesFromPrev = route.durationMinutes;
            }
          }
        }

        const first = stopsWithGeo[0];
        const last = stopsWithGeo[stopsWithGeo.length - 1];
        if (first.lat && first.lng && last.lat && last.lng) {
          returnDistance = await getRoute(last.lat, last.lng, first.lat, first.lng);
        }
      }

      // Build a human-friendly response message
      let botMessage = `Built a route with ${locations.length} stops: ${locations.join(" → ")}`;

      // Include freight metadata (equipment, PU/DEL windows) if extracted
      if (freightMeta && (freightMeta.equipment || freightMeta.pickupDetails || freightMeta.deliveryDetails)) {
        const metaParts: string[] = [];
        if (freightMeta.equipment) metaParts.push(`🚛 ${freightMeta.equipment}`);
        if (freightMeta.pickupDetails) metaParts.push(`📦 PU: ${freightMeta.pickupDetails}`);
        if (freightMeta.deliveryDetails) metaParts.push(`📍 DEL: ${freightMeta.deliveryDetails}`);
        botMessage += "\n" + metaParts.join("\n");
      }

      if (shipment) {
        const parts: string[] = [];
        if (shipment.productName) parts.push(`Product: ${shipment.productName}`);
        if (shipment.totalPieces) parts.push(`${shipment.totalPieces} pcs`);
        if (shipment.totalWeightKg) parts.push(`${shipment.totalWeightKg} kg`);
        if (shipment.referenceNumber) parts.push(`Ref: ${shipment.referenceNumber}`);
        if (parts.length > 0) botMessage += `\n📦 ${parts.join(" · ")}`;
        if (shipment.contactPhone || shipment.contactEmail) {
          botMessage += `\n📞 ${[shipment.contactName, shipment.contactPhone, shipment.contactEmail].filter(Boolean).join(" · ")}`;
        }
      }

      const chatResult = {
        success: true,
        message: botMessage,
        locations,
        stops: stopsWithGeo,
        returnDistance,
        shipment: shipment || undefined,
        freightMeta: freightMeta || undefined,
      };
      cacheSet(chatRouteCache, chatCacheKey, chatResult, CHAT_ROUTE_TTL_MS);
      res.json(chatResult);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // === CACHE FLUSH (dev — clears all stale geo/route caches) ===
  app.post("/api/cache-flush", (_req, res) => {
    const before = { geocode: geocodeCache.size, distance: distanceCache.size, multiRoute: multiRouteCache.size, placeSuggest: placeSuggestCache.size, chatRoute: chatRouteCache.size };
    geocodeCache.clear();
    distanceCache.clear();
    multiRouteCache.clear();
    placeSuggestCache.clear();
    chatRouteCache.clear();
    res.json({ flushed: before });
  });

  // === CACHE STATS (dev/monitoring) ===
  app.get("/api/cache-stats", (_req, res) => {
    res.json({
      geocode:      { entries: geocodeCache.size,      maxSize: MAX_CACHE_SIZE, ttlHours: GEO_TTL_MS / 3600000 },
      distance:     { entries: distanceCache.size,     maxSize: MAX_CACHE_SIZE, ttlHours: ROUTE_TTL_MS / 3600000 },
      multiRoute:   { entries: multiRouteCache.size,   maxSize: MAX_CACHE_SIZE, ttlHours: ROUTE_TTL_MS / 3600000 },
      placeSuggest: { entries: placeSuggestCache.size,  maxSize: MAX_CACHE_SIZE, ttlHours: SUGGEST_TTL_MS / 3600000 },
      chatRoute:    { entries: chatRouteCache.size,     maxSize: MAX_CACHE_SIZE, ttlMinutes: CHAT_ROUTE_TTL_MS / 60000 },
    });
  });

  // === SAVED ROUTES ===
  app.get("/api/routes", async (_req, res) => {
    res.json(await storage.getRoutes());
  });
  app.post("/api/routes", async (req, res) => {
    try {
      const route = await storage.createRoute(req.body);
      res.status(201).json(route);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete("/api/routes/:id", async (req, res) => {
    const deleted = await storage.deleteRoute(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  // === LANES ===
  app.get("/api/lanes", async (_req, res) => {
    res.json(await storage.getLanes());
  });
  app.post("/api/lanes", async (req, res) => {
    try {
      const parsed = insertLaneSchema.parse(req.body);
      const lane = await storage.createLane(parsed);
      res.status(201).json(lane);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete("/api/lanes/:id", async (req, res) => {
    const deleted = await storage.deleteLane(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  // === QUOTES ===
  app.get("/api/quotes", async (_req, res) => {
    res.json(await storage.getQuotes());
  });
  app.post("/api/quotes", async (req, res) => {
    try {
      const quoteNumber = `BQ-${Date.now().toString(36).toUpperCase()}`;
      const quote = await storage.createQuote({
        ...req.body,
        quoteNumber,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(quote);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete("/api/quotes/:id", async (req, res) => {
    const deleted = await storage.deleteQuote(req.params.id);
    deleted ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  const feedbackBodySchema = z.object({
    name: z.string().max(200).optional().default(""),
    email: z.string().max(320).optional().default(""),
    company: z.string().max(300).optional().default(""),
    category: z.enum(["feature", "bug", "improvement", "other"]),
    subject: z.string().min(1).max(500),
    description: z.string().min(1).max(20000),
    priority: z.enum(["low", "medium", "high"]),
    area: z.string().max(200).optional().default(""),
  });

  app.post("/api/feedback", async (req, res) => {
    try {
      const parsed = feedbackBodySchema.parse(req.body);
      const result = await sendFeedbackEmail(parsed);
      if (!result.ok) {
        const isConfig = result.error.includes("not configured") || result.error.includes("Set FEEDBACK");
        return res.status(isConfig ? 503 : 500).json({ error: result.error });
      }
      res.status(202).json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.flatten() });
      }
      const msg = err instanceof Error ? err.message : "Invalid request";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/feedback/:feedbackId/email-reply", async (req, res) => {
    const actor = await verifyBearerIsAdmin(req);
    if (!actor) return res.status(403).json({ error: "Forbidden" });
    const fs = getAdminFirestore();
    if (!fs) {
      return res.status(503).json({
        error:
          "Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or deploy with Application Default Credentials.",
      });
    }
    const feedbackId = req.params.feedbackId;
    const snap = await fs.doc(`feedback/${feedbackId}`).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const f = snap.data() as Record<string, unknown>;
    const reply = String(f.adminReply || "").trim();
    if (!reply) return res.status(400).json({ error: "Save a reply in the app before emailing." });
    const to = String(f.email || "").trim();
    if (!to) return res.status(400).json({ error: "User has no email on file." });
    const subject = String(f.subject || "(feedback)");
    const send = await sendReplyToUserEmail({
      to,
      feedbackSubject: subject,
      replyText: reply,
    });
    if (!send.ok) return res.status(500).json({ error: send.error });
    await fs.doc(`feedback/${feedbackId}`).update({
      replyEmailedAt: new Date().toISOString(),
    });
    res.status(202).json({ ok: true });
  });

  const clientErrorSchema = z.object({
    category: z.enum(["window-error", "unhandled-rejection", "react-boundary", "recovery"]),
    message: z.string().min(1).max(4000),
    stack: z.string().max(12000).optional(),
    code: z.string().max(200).optional(),
    detail: z.string().max(1000).optional(),
    href: z.string().max(4000).optional().default(""),
    ua: z.string().max(1000).optional().default(""),
    ts: z.string().max(100).optional().default(""),
  });

  app.post("/api/client-error", async (req, res) => {
    try {
      const e = clientErrorSchema.parse(req.body);
      const safeMessage = e.message.replace(/\s+/g, " ").slice(0, 500);
      const safeStack = (e.stack || "").slice(0, 1200);
      console.warn(
        `[client-error] ${e.category}${e.code ? `:${e.code}` : ""} ${safeMessage}`,
        {
          href: e.href.slice(0, 300),
          ua: e.ua.slice(0, 180),
          ts: e.ts,
          detail: e.detail?.slice(0, 300),
          stack: safeStack,
        },
      );
      return res.status(202).json({ ok: true });
    } catch {
      return res.status(202).json({ ok: true });
    }
  });

  registerStripeRoutes(app);

  return httpServer;
}
