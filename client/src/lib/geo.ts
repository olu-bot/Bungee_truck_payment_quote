const GEO_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const ROUTE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const SUGGEST_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const MISS_TTL_MS = 1000 * 60 * 5; // 5m negative cache for failed geocode/route

type CacheEntry<T> = { value: T; expiresAt: number };

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

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: nowMs() + ttlMs });
}

function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function routeKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  const q = (n: number) => Number(n).toFixed(5);
  return `${q(fromLat)},${q(fromLng)}=>${q(toLat)},${q(toLng)}`;
}

function multiKey(waypoints: { lat: number; lng: number }[]): string {
  return waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(";");
}

const geoCache = new Map<string, CacheEntry<{ lat: number; lng: number } | null>>();
const geoInflight = new Map<string, Promise<{ lat: number; lng: number } | null>>();

const routeCache = new Map<string, CacheEntry<{ distanceKm: number; durationMinutes: number } | null>>();
const routeInflight = new Map<string, Promise<{ distanceKm: number; durationMinutes: number } | null>>();

const multiCache = new Map<string, CacheEntry<{ distanceKm: number; durationMinutes: number }[] | null>>();
const multiInflight = new Map<string, Promise<{ distanceKm: number; durationMinutes: number }[] | null>>();

const suggestCache = new Map<string, CacheEntry<string[]>>();
const suggestInflight = new Map<string, Promise<string[]>>();

async function fetchGeocode(q: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(`/api/geocode?location=${encodeURIComponent(q)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  const key = normalizeKey(location);
  if (!key) return null;
  const hit = cacheGet(geoCache, key);
  if (hit !== undefined) return hit;
  const inflight = geoInflight.get(key);
  if (inflight) return inflight;

  const req = (async () => {
    const coords = await fetchGeocode(location.trim());
    cacheSet(geoCache, key, coords, coords ? GEO_TTL_MS : MISS_TTL_MS);
    return coords;
  })();
  geoInflight.set(key, req);
  try {
    return await req;
  } finally {
    geoInflight.delete(key);
  }
}

export async function getOSRMRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  const key = routeKey(fromLat, fromLng, toLat, toLng);
  const hit = cacheGet(routeCache, key);
  if (hit !== undefined) return hit;
  const inflight = routeInflight.get(key);
  if (inflight) return inflight;

  const params = new URLSearchParams({
    fromLat: String(fromLat),
    fromLng: String(fromLng),
    toLat: String(toLat),
    toLng: String(toLng),
  });
  const req = (async () => {
    const res = await fetch(`/api/distance?${params}`);
    if (!res.ok) {
      cacheSet(routeCache, key, null, MISS_TTL_MS);
      return null;
    }
    const data = (await res.json()) as { distanceKm: number; durationMinutes: number };
    cacheSet(routeCache, key, data, ROUTE_TTL_MS);
    return data;
  })();
  routeInflight.set(key, req);
  try {
    return await req;
  } finally {
    routeInflight.delete(key);
  }
}

/**
 * Fetch all leg distances in a single OSRM call.
 * Returns an array of { distanceKm, durationMinutes } — one per consecutive pair.
 * Falls back to null if the call fails.
 */
export async function getMultiWaypointDistances(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  if (waypoints.length < 2) return null;
  const key = multiKey(waypoints);
  const hit = cacheGet(multiCache, key);
  if (hit !== undefined) return hit;
  const inflight = multiInflight.get(key);
  if (inflight) return inflight;

  const req = (async () => {
    const res = await fetch("/api/distances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints }),
    });
    if (!res.ok) {
      cacheSet(multiCache, key, null, MISS_TTL_MS);
      return null;
    }
    const data = (await res.json()) as { legs?: { distanceKm: number; durationMinutes: number }[] };
    const legs = data.legs ?? null;
    cacheSet(multiCache, key, legs, legs ? ROUTE_TTL_MS : MISS_TTL_MS);
    return legs;
  })();
  multiInflight.set(key, req);
  try {
    return await req;
  } finally {
    multiInflight.delete(key);
  }
}

/** Google-backed place lines (server uses Places Autocomplete + cache). */
export async function fetchPlaceSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = normalizeKey(q);
  const hit = cacheGet(suggestCache, key);
  if (hit !== undefined) return hit;
  const inflight = suggestInflight.get(key);
  if (inflight) return inflight;

  const req = (async () => {
    const res = await fetch(`/api/place-suggestions?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      cacheSet(suggestCache, key, [], SUGGEST_TTL_MS);
      return [];
    }
    const data = (await res.json()) as { suggestions?: string[] };
    const list = Array.isArray(data.suggestions) ? data.suggestions : [];
    cacheSet(suggestCache, key, list, SUGGEST_TTL_MS);
    return list;
  })();
  suggestInflight.set(key, req);
  try {
    return await req;
  } finally {
    suggestInflight.delete(key);
  }
}
