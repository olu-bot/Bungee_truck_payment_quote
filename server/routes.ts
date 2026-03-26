import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { registerStripeRoutes } from "./stripe";
import { storage } from "./storage";
import { sendFeedbackEmail, sendReplyToUserEmail } from "./feedbackEmail";
import { verifyBearerIsAdmin, getAdminFirestore } from "./firebaseAdmin";
import { insertLaneSchema, insertCostProfileSchema, insertYardSchema, insertTeamMemberSchema, calculateRouteSchema, pricingTiersSchema, chatRouteSchema } from "@shared/schema";
import type { CostProfile, RouteStop } from "@shared/schema";
import { randomUUID } from "crypto";

// ── Helpers ─────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
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

// ── OSRM Distance/Duration Calculation ──────────────────────────

const OSRM_TIMEOUT_MS = 10_000; // 10-second timeout to avoid hanging on unroutable destinations

/**
 * Haversine straight-line distance between two lat/lng points.
 * Used as fallback when OSRM can't find a road route (e.g. islands, remote areas).
 * Returns distance in km. Assumes average 60 km/h for drive-time estimate.
 */
function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): { distanceKm: number; durationMinutes: number; isEstimate: true } {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  // Apply 1.3x detour factor for road distance estimate
  const estimatedRoad = r2(straightLine * 1.3);
  const estimatedMinutes = r2(estimatedRoad / 60 * 60); // ~60 km/h average
  return { distanceKm: estimatedRoad, durationMinutes: estimatedMinutes, isEstimate: true };
}

async function getOSRMRoute(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number; isEstimate?: boolean } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
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
    // OSRM returned non-Ok (e.g. "NoRoute") — fall back to haversine
    console.log(`[OSRM] Non-Ok response: ${data.code} — falling back to haversine`);
    return haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  } catch (err) {
    // Timeout or network error — fall back to haversine
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.log(`[OSRM] ${reason} — falling back to haversine`);
    return haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  }
}

/**
 * Multi-waypoint OSRM request — one API call returns per-leg distances.
 * Avoids rate-limiting that occurs with sequential single-pair calls.
 */
async function getOSRMMultiRoute(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  if (waypoints.length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;
    console.log("[OSRM multi] URL:", url);
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
    console.log("[OSRM multi] Non-Ok response:", data.code, "— will use per-leg fallback");
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.error(`[OSRM multi] ${reason}:`, err instanceof Error ? err.message : err);
  }
  return null;
}

async function geocodeRaw(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "User-Agent": "BungeeConnect/3.0" } },
    );
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {
    // Silently fail
  }
  return null;
}

/**
 * Geocode with city extraction fallback.
 * If the full address fails, try progressively shorter comma-separated
 * suffixes to find a city/region match.
 * e.g. "123 Industrial Rd, Suite 5, Toronto, ON" →
 *      try "Suite 5, Toronto, ON" → "Toronto, ON" → "ON"
 */
async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  // Try full address first
  const full = await geocodeRaw(location);
  if (full) return full;

  // Fallback: try progressively shorter suffixes
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(", ");
    if (candidate.length >= 3) {
      const result = await geocodeRaw(candidate);
      if (result) return result;
    }
  }

  return null;
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
  const lower = input.trim().toLowerCase();
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower];
  for (const [key, val] of Object.entries(CITY_ALIASES)) {
    if (lower.startsWith(key) || key.startsWith(lower)) return val;
  }
  for (const [key, val] of Object.entries(CITY_ALIASES)) {
    if (levenshtein(lower, key) <= 2) return val;
  }
  if (/\d/.test(input) || input.includes(",")) return input.trim();
  return input.trim().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
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

function parseChatMessage(message: string): string[] {
  const normalized = message
    .replace(/→/g, " to ")
    .replace(/->/g, " to ")
    .replace(/>/g, " to ")
    .replace(/\band\s+then\b/gi, " to ")
    .replace(/\bthen\b/gi, " to ")
    .replace(/,/g, " to ");
  const parts = normalized.split(/\s+to\s+/i).map(s => s.trim()).filter(s => s.length > 0);
  return parts.map(p => fuzzyMatchCity(p) || p);
}

// ── Register Routes ─────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
    if (!location) return res.status(400).json({ error: "location required" });
    const result = await geocodeLocation(location);
    if (!result) return res.status(404).json({ error: "Location not found" });
    res.json(result);
  });

  // === DISTANCE BETWEEN TWO POINTS (OSRM) ===
  app.get("/api/distance", async (req, res) => {
    const fromLat = parseFloat(req.query.fromLat as string);
    const fromLng = parseFloat(req.query.fromLng as string);
    const toLat = parseFloat(req.query.toLat as string);
    const toLng = parseFloat(req.query.toLng as string);
    if (isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }
    const result = await getOSRMRoute(fromLat, fromLng, toLat, toLng);
    if (!result) return res.status(500).json({ error: "Routing failed" });
    res.json(result);
  });

  // === MULTI-WAYPOINT DISTANCE (single OSRM call, avoids rate-limits) ===
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
    let legs = await getOSRMMultiRoute(waypoints);
    if (!legs) {
      // Multi-waypoint OSRM failed (timeout, unroutable, etc.)
      // Fall back to per-leg haversine estimates
      console.log("[/api/distances] Multi-waypoint OSRM failed, falling back to per-leg haversine");
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
      if (!profile) return res.status(400).json({ error: "Cost profile not found" });

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
      const { message } = chatRouteSchema.parse(req.body);
      const locations = parseChatMessage(message);

      if (locations.length < 2) {
        return res.json({
          success: false,
          message: "I need at least 2 locations to build a route. Try something like 'Toronto to Montreal' or 'Chicago, Sudbury, Thunder Bay'.",
          locations: [],
        });
      }

      // Geocode all locations and get distances between consecutive stops
      const stopsWithGeo: any[] = [];
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const geo = await geocodeLocation(loc);
        const stop: any = {
          id: randomUUID().slice(0, 8),
          type: i === 0 ? "pickup" : i === locations.length - 1 ? "delivery" : "stop",
          location: loc,
          lat: geo?.lat,
          lng: geo?.lng,
          dockTimeMinutes: 60,
          distanceFromPrevKm: 0,
          driveMinutesFromPrev: 0,
        };

        // Calculate distance from previous stop
        if (i > 0 && geo && stopsWithGeo[i - 1].lat && stopsWithGeo[i - 1].lng) {
          const route = await getOSRMRoute(
            stopsWithGeo[i - 1].lat, stopsWithGeo[i - 1].lng,
            geo.lat, geo.lng,
          );
          if (route) {
            stop.distanceFromPrevKm = route.distanceKm;
            stop.driveMinutesFromPrev = route.durationMinutes;
          }
        }

        stopsWithGeo.push(stop);
      }

      // Also compute return distance from last to first
      let returnDistance = null;
      const first = stopsWithGeo[0];
      const last = stopsWithGeo[stopsWithGeo.length - 1];
      if (first.lat && first.lng && last.lat && last.lng) {
        returnDistance = await getOSRMRoute(last.lat, last.lng, first.lat, first.lng);
      }

      res.json({
        success: true,
        message: `Built a route with ${locations.length} stops: ${locations.join(" → ")}`,
        locations,
        stops: stopsWithGeo,
        returnDistance,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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

  registerStripeRoutes(app);

  return httpServer;
}
