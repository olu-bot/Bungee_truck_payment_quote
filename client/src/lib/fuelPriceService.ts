/**
 * Fuel Price Service — provides current regional diesel prices for North America.
 *
 * US prices: fetched weekly from EIA (Energy Information Administration) public page.
 * Canadian prices: fetched from available sources or estimated from US prices + exchange rate.
 *
 * Prices are cached in localStorage with a 24-hour TTL so we don't hit the source on every page load.
 * Falls back to built-in defaults if the fetch fails.
 */

import type { MeasurementUnit } from "@/lib/measurement";

// ── Types ──────────────────────────────────────────────────────────

export type FuelRegion = {
  id: string;
  name: string;
  /** Price per US gallon (USD) for US regions, or per litre (CAD) for Canadian */
  pricePerGallon?: number;
  pricePerLitre?: number;
  currency: "USD" | "CAD";
  updatedAt: string;
};

export type FuelPriceData = {
  regions: FuelRegion[];
  usAverage: FuelRegion;
  caAverage: FuelRegion;
  fetchedAt: string;
  source: string;
};

// ── PADD region → state mapping ────────────────────────────────────

/** EIA PADD (Petroleum Administration for Defense Districts) to state codes */
const PADD_STATES: Record<string, string[]> = {
  // PADD 1 — East Coast
  east_coast: [
    "ME", "NH", "VT", "MA", "CT", "RI", "NY", "NJ", "PA",
    "DE", "MD", "VA", "WV", "NC", "SC", "GA", "FL",
  ],
  // PADD 2 — Midwest
  midwest: [
    "OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "NE", "KS",
    "ND", "SD", "KY", "TN", "OK",
  ],
  // PADD 3 — Gulf Coast
  gulf_coast: ["TX", "LA", "MS", "AL", "AR", "NM"],
  // PADD 4 — Rocky Mountain
  rocky_mountain: ["MT", "WY", "CO", "UT", "ID", "NV"],
  // PADD 5 — West Coast (excl. California)
  west_coast: ["WA", "OR", "AK", "HI", "AZ"],
  // California (separate from PADD 5 in EIA data)
  california: ["CA"],
};

/** Reverse lookup: state code → PADD region id */
const STATE_TO_PADD: Record<string, string> = {};
for (const [padd, states] of Object.entries(PADD_STATES)) {
  for (const s of states) {
    STATE_TO_PADD[s] = padd;
  }
}

/** Canadian province → region id */
const CA_PROVINCE_REGION: Record<string, string> = {
  BC: "ca_west",
  AB: "ca_prairies",
  SK: "ca_prairies",
  MB: "ca_prairies",
  ON: "ca_ontario",
  QC: "ca_quebec",
  NB: "ca_atlantic",
  NS: "ca_atlantic",
  PE: "ca_atlantic",
  NL: "ca_atlantic",
};

// ── Default / fallback prices ──────────────────────────────────────
// Defaults update automatically: each successful EIA fetch replaces
// the fallback so stale hardcoded numbers are never used again.

const US_GALLON_TO_LITRE = 3.78541;
const USD_TO_CAD_RATE = 1.44; // approximate exchange rate

/** Key for persisting last-good EIA data as new defaults */
const DEFAULTS_KEY = "bungee_fuel_defaults";

function galToLitre(pricePerGallon: number): number {
  return Math.round((pricePerGallon / US_GALLON_TO_LITRE) * 1000) / 1000;
}

/** Try to load the last successful EIA fetch as the default. Falls back to hardcoded. */
function getSavedDefaults(): FuelPriceData | null {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FuelPriceData;
  } catch {
    return null;
  }
}

/** Persist a successful EIA fetch so it becomes the new fallback. */
function saveAsDefaults(data: FuelPriceData): void {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/** Built-in fallback prices (updated periodically) */
function getDefaultPrices(): FuelPriceData {
  // Prefer the last successful EIA fetch over hardcoded values
  const saved = getSavedDefaults();
  if (saved) return saved;
  const now = new Date().toISOString();
  const usRegions: FuelRegion[] = [
    { id: "us_average", name: "U.S. Average", pricePerGallon: 5.375, pricePerLitre: galToLitre(5.375), currency: "USD", updatedAt: "2026-03-23" },
    { id: "east_coast", name: "East Coast", pricePerGallon: 5.480, pricePerLitre: galToLitre(5.480), currency: "USD", updatedAt: "2026-03-23" },
    { id: "midwest", name: "Midwest", pricePerGallon: 5.160, pricePerLitre: galToLitre(5.160), currency: "USD", updatedAt: "2026-03-23" },
    { id: "gulf_coast", name: "Gulf Coast", pricePerGallon: 5.134, pricePerLitre: galToLitre(5.134), currency: "USD", updatedAt: "2026-03-23" },
    { id: "rocky_mountain", name: "Rocky Mountain", pricePerGallon: 5.174, pricePerLitre: galToLitre(5.174), currency: "USD", updatedAt: "2026-03-23" },
    { id: "west_coast", name: "West Coast", pricePerGallon: 6.310, pricePerLitre: galToLitre(6.310), currency: "USD", updatedAt: "2026-03-23" },
    { id: "california", name: "California", pricePerGallon: 6.870, pricePerLitre: galToLitre(6.870), currency: "USD", updatedAt: "2026-03-23" },
  ];

  // Canadian estimates: US average converted to CAD per litre + regional adjustments
  const usAvgPerLitreCad = galToLitre(5.375) * USD_TO_CAD_RATE;
  const caRegions: FuelRegion[] = [
    { id: "ca_average", name: "Canada Average", pricePerLitre: Math.round(usAvgPerLitreCad * 1.05 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
    { id: "ca_west", name: "Western Canada (BC)", pricePerLitre: Math.round(usAvgPerLitreCad * 1.12 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
    { id: "ca_prairies", name: "Prairies (AB, SK, MB)", pricePerLitre: Math.round(usAvgPerLitreCad * 0.98 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
    { id: "ca_ontario", name: "Ontario", pricePerLitre: Math.round(usAvgPerLitreCad * 1.05 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
    { id: "ca_quebec", name: "Quebec", pricePerLitre: Math.round(usAvgPerLitreCad * 1.08 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
    { id: "ca_atlantic", name: "Atlantic Canada", pricePerLitre: Math.round(usAvgPerLitreCad * 1.10 * 1000) / 1000, currency: "CAD", updatedAt: "2026-03-23" },
  ];

  return {
    regions: [...usRegions, ...caRegions],
    usAverage: usRegions[0],
    caAverage: caRegions[0],
    fetchedAt: now,
    source: "built-in defaults (EIA March 2026)",
  };
}

// ── Cache ──────────────────────────────────────────────────────────

const CACHE_KEY = "bungee_fuel_prices";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedPrices(): FuelPriceData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as FuelPriceData & { _cachedAt?: number };
    const cachedAt = data._cachedAt ?? 0;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedPrices(data: FuelPriceData): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...data, _cachedAt: Date.now() })
    );
  } catch {
    // localStorage full or unavailable — ignore
  }
}

// ── Fetch from EIA ─────────────────────────────────────────────────

/**
 * Attempts to parse current diesel prices from the EIA weekly page.
 * Falls back to defaults if the fetch fails.
 */
async function fetchEIAPrices(): Promise<FuelPriceData> {
  try {
    const res = await fetch(
      "https://www.eia.gov/petroleum/gasdiesel/includes/gas_diesel_powerful.txt",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`EIA fetch failed: ${res.status}`);
    const text = await res.text();

    // The EIA text file contains tab-separated data with region prices
    // Try to parse it — format varies, so we'll be defensive
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // Look for diesel section
    const regionMap: Record<string, number> = {};
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 2) continue;
      const name = cols[0].toLowerCase().trim();
      const price = parseFloat(cols[cols.length - 1]);
      if (isNaN(price) || price < 1 || price > 15) continue;

      if (name.includes("u.s.") || name.includes("national")) regionMap["us_average"] = price;
      if (name.includes("east coast") || name.includes("padd 1")) regionMap["east_coast"] = price;
      if (name.includes("midwest") || name.includes("padd 2")) regionMap["midwest"] = price;
      if (name.includes("gulf") || name.includes("padd 3")) regionMap["gulf_coast"] = price;
      if (name.includes("rocky") || name.includes("padd 4")) regionMap["rocky_mountain"] = price;
      if (name.includes("west coast") && !name.includes("california")) regionMap["west_coast"] = price;
      if (name.includes("california")) regionMap["california"] = price;
    }

    // If we got at least the US average, use parsed data
    if (regionMap["us_average"]) {
      const defaults = getDefaultPrices();
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      // Update US regions with parsed prices, keep defaults for others
      for (const region of defaults.regions) {
        if (regionMap[region.id] !== undefined) {
          region.pricePerGallon = regionMap[region.id];
          region.pricePerLitre = galToLitre(regionMap[region.id]);
          region.updatedAt = today;
        }
      }

      // Update Canadian estimates based on new US average
      const usAvg = regionMap["us_average"];
      const usAvgPerLitreCad = galToLitre(usAvg) * USD_TO_CAD_RATE;
      for (const region of defaults.regions) {
        if (region.currency === "CAD" && region.id !== "ca_average") {
          // Keep multiplier ratios, just update base
          const oldBase = galToLitre(5.375) * USD_TO_CAD_RATE;
          const ratio = (region.pricePerLitre ?? 0) / oldBase;
          region.pricePerLitre = Math.round(usAvgPerLitreCad * ratio * 1000) / 1000;
          region.updatedAt = today;
        }
        if (region.id === "ca_average") {
          region.pricePerLitre = Math.round(usAvgPerLitreCad * 1.05 * 1000) / 1000;
          region.updatedAt = today;
        }
      }

      defaults.fetchedAt = now;
      defaults.source = `EIA weekly data (${today})`;
      defaults.usAverage = defaults.regions.find((r) => r.id === "us_average")!;
      defaults.caAverage = defaults.regions.find((r) => r.id === "ca_average")!;
      // Persist this successful fetch as the new fallback defaults
      saveAsDefaults(defaults);
      return defaults;
    }
  } catch {
    // Fetch failed — use defaults
  }

  return getDefaultPrices();
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get current fuel prices. Returns cached data if fresh, otherwise fetches.
 * Always returns data (falls back to built-in defaults).
 */
export async function getFuelPrices(): Promise<FuelPriceData> {
  const cached = getCachedPrices();
  if (cached) return cached;

  const data = await fetchEIAPrices();
  setCachedPrices(data);
  return data;
}

/** Synchronous version — returns cache or defaults (no fetch). */
export function getFuelPricesSync(): FuelPriceData {
  return getCachedPrices() ?? getDefaultPrices();
}

/**
 * Get the fuel price for a specific state/province code.
 * Returns price in the appropriate unit:
 *  - Imperial (US): price per gallon in USD
 *  - Metric (Canada): price per litre in CAD
 *  - If unit is "imperial", returns $/gallon; if "metric", returns $/litre
 */
export function getRegionalFuelPrice(
  stateCode: string | undefined,
  unit: MeasurementUnit,
  data?: FuelPriceData,
): { price: number; regionName: string; updatedAt: string; currency: "USD" | "CAD" } {
  const prices = data ?? getFuelPricesSync();
  const code = (stateCode || "").toUpperCase().trim();

  // Check if it's a Canadian province
  const caRegionId = CA_PROVINCE_REGION[code];
  if (caRegionId) {
    const region = prices.regions.find((r) => r.id === caRegionId) ?? prices.caAverage;
    return {
      price: region.pricePerLitre ?? 1.65,
      regionName: region.name,
      updatedAt: region.updatedAt,
      currency: "CAD",
    };
  }

  // US state — find PADD region
  const paddId = STATE_TO_PADD[code];
  if (paddId) {
    const region = prices.regions.find((r) => r.id === paddId) ?? prices.usAverage;
    if (unit === "imperial") {
      return {
        price: region.pricePerGallon ?? 5.375,
        regionName: region.name,
        updatedAt: region.updatedAt,
        currency: "USD",
      };
    } else {
      // Convert to $/litre for metric users in the US
      return {
        price: region.pricePerLitre ?? galToLitre(5.375),
        regionName: region.name,
        updatedAt: region.updatedAt,
        currency: "USD",
      };
    }
  }

  // Unknown — return the appropriate national average
  if (unit === "imperial") {
    return {
      price: prices.usAverage.pricePerGallon ?? 5.375,
      regionName: "U.S. Average",
      updatedAt: prices.usAverage.updatedAt,
      currency: "USD",
    };
  }
  return {
    price: prices.caAverage.pricePerLitre ?? 1.65,
    regionName: "Canada Average",
    updatedAt: prices.caAverage.updatedAt,
    currency: "CAD",
  };
}

/**
 * Get fuel price formatted for the route builder's fuel input.
 * The route builder internally works in $/litre, so this always returns $/litre.
 */
export function getFuelPriceForRouteBuilder(
  stateCode: string | undefined,
  unit: MeasurementUnit,
  data?: FuelPriceData,
): { pricePerLitre: number; regionName: string; updatedAt: string; sourceCurrency: "USD" | "CAD" } {
  const prices = data ?? getFuelPricesSync();
  const code = (stateCode || "").toUpperCase().trim();

  // Canadian province
  const caRegionId = CA_PROVINCE_REGION[code];
  if (caRegionId) {
    const region = prices.regions.find((r) => r.id === caRegionId) ?? prices.caAverage;
    return {
      pricePerLitre: region.pricePerLitre ?? 1.65,
      regionName: region.name,
      updatedAt: region.updatedAt,
      sourceCurrency: "CAD",
    };
  }

  // US state
  const paddId = STATE_TO_PADD[code];
  const region = paddId
    ? (prices.regions.find((r) => r.id === paddId) ?? prices.usAverage)
    : prices.usAverage;
  return {
    pricePerLitre: region.pricePerLitre ?? galToLitre(5.375),
    regionName: region.name,
    updatedAt: region.updatedAt,
    sourceCurrency: "USD",
  };
}
