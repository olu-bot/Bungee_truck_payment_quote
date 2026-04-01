/**
 * iftaCalc.ts
 *
 * Calculates per-jurisdiction IFTA fuel tax for a given route.
 *
 * Approach: Each leg's distance is allocated to the jurisdiction of
 * the leg's origin stop. This is an approximation — when a single leg
 * crosses state lines, all distance goes to the origin state. This is
 * accurate for 80%+ of routes where stops are in different states.
 *
 * Fuel consumption is converted from L/100km to gallons/mile for the
 * tax calculation. Canadian province rates (CAD/litre) are converted
 * to USD/gallon using a fixed exchange rate (updated quarterly with
 * the rate table).
 */

import type { RouteStop } from "@shared/schema";
import { getJurisdiction, isCanadianProvince } from "./jurisdictionLookup";
import iftaRatesData from "@shared/data/ifta-rates.json";

// ── Types ────────────────────────────────────────────────────────

export type IFTAJurisdictionBreakdown = {
  code: string;          // e.g., "NY", "ON"
  name: string;          // e.g., "New York", "Ontario"
  distanceKm: number;    // km driven in this jurisdiction
  distanceMiles: number; // miles driven in this jurisdiction
  taxRate: number;       // effective rate in USD/gallon (after conversion for CA)
  taxUSD: number;        // tax amount in USD
  note?: string;         // e.g., "Oregon uses weight-mile tax (not IFTA)"
};

export type IFTAResult = {
  jurisdictions: IFTAJurisdictionBreakdown[];
  totalTaxUSD: number;
  totalDistanceKm: number;
  totalDistanceMiles: number;
  quarter: string;       // e.g., "2Q2026"
  effectiveDate: string; // e.g., "2026-04-01"
};

// ── Constants ────────────────────────────────────────────────────

const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.78541;

/**
 * CAD to USD exchange rate. Updated quarterly alongside the rate table.
 * As of Q2 2026, approximate rate.
 */
const CAD_TO_USD = 0.73;

// ── Jurisdiction names ───────────────────────────────────────────

const JURISDICTION_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba",
  NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan",
};

// ── Rate lookup ──────────────────────────────────────────────────

type RateEntry = { diesel: number; surcharge: number } | null;

const rates = iftaRatesData.rates as Record<string, RateEntry>;

/**
 * Get the effective tax rate for a jurisdiction in USD per gallon.
 *
 * For US states: rate is already in USD/gallon; add surcharge.
 * For Canadian provinces: rate is in CAD/litre; convert to USD/gallon.
 *
 * Returns 0 for null entries (non-IFTA jurisdictions like AK, DC, HI).
 */
function getEffectiveRateUSDPerGallon(code: string): number {
  const entry = rates[code];
  if (!entry) return 0;

  const baseRate = entry.diesel + entry.surcharge;

  if (isCanadianProvince(code)) {
    // CAD/litre -> USD/gallon
    return baseRate * LITRES_PER_GALLON * CAD_TO_USD;
  }

  // US rate already in USD/gallon
  return baseRate;
}

// ── Main calculation ─────────────────────────────────────────────

/**
 * Calculate IFTA fuel tax breakdown for a route.
 *
 * @param stops Route stops with lat/lng and distanceFromPrevKm
 * @param fuelConsumptionPer100km Fuel consumption in litres per 100 km
 * @returns IFTA breakdown or null if calculation not possible
 */
export function calculateIFTA(
  stops: RouteStop[],
  fuelConsumptionPer100km: number,
): IFTAResult | null {
  if (!stops || stops.length < 2) return null;
  if (!fuelConsumptionPer100km || fuelConsumptionPer100km <= 0) return null;

  // Check that at least the first stop has lat/lng for jurisdiction detection
  const firstWithCoords = stops.find(s => s.lat != null && s.lng != null);
  if (!firstWithCoords) return null;

  // Convert fuel consumption: L/100km -> gallons/mile
  // L/100km * (1 gal / 3.78541 L) * (1.609344 km / 1 mi) * (1 / 100)
  const gallonsPerMile = (fuelConsumptionPer100km / LITRES_PER_GALLON) * (KM_PER_MILE / 100);

  // Accumulate distance by jurisdiction
  const jurisdictionKm = new Map<string, number>();

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    const distKm = to.distanceFromPrevKm || 0;

    if (distKm <= 0) continue;

    // Determine jurisdiction from the origin stop's coordinates
    let code: string | null = null;
    if (from.lat != null && from.lng != null) {
      code = getJurisdiction(from.lat, from.lng);
    }

    // If origin has no coords or is unresolvable, try destination
    if (!code && to.lat != null && to.lng != null) {
      code = getJurisdiction(to.lat, to.lng);
    }

    // If neither end resolves, skip this leg
    if (!code) continue;

    jurisdictionKm.set(code, (jurisdictionKm.get(code) || 0) + distKm);
  }

  if (jurisdictionKm.size === 0) return null;

  // Build breakdown
  const jurisdictions: IFTAJurisdictionBreakdown[] = [];
  let totalTaxUSD = 0;
  let totalDistKm = 0;

  // Sort by distance descending (largest jurisdiction first)
  const sorted = [...jurisdictionKm.entries()].sort((a, b) => b[1] - a[1]);

  for (const [code, distKm] of sorted) {
    const distMiles = distKm / KM_PER_MILE;
    const rateUSDPerGallon = getEffectiveRateUSDPerGallon(code);
    const taxUSD = distMiles * gallonsPerMile * rateUSDPerGallon;

    let note: string | undefined;
    if (code === "OR") {
      note = "Oregon uses weight-mile tax (not IFTA)";
    } else if (rates[code] === null) {
      note = `${JURISDICTION_NAMES[code] || code} is not an IFTA jurisdiction`;
    }

    jurisdictions.push({
      code,
      name: JURISDICTION_NAMES[code] || code,
      distanceKm: Math.round(distKm * 100) / 100,
      distanceMiles: Math.round(distMiles * 100) / 100,
      taxRate: Math.round(rateUSDPerGallon * 10000) / 10000,
      taxUSD: Math.round(taxUSD * 100) / 100,
      note,
    });

    totalTaxUSD += taxUSD;
    totalDistKm += distKm;
  }

  return {
    jurisdictions,
    totalTaxUSD: Math.round(totalTaxUSD * 100) / 100,
    totalDistanceKm: Math.round(totalDistKm * 100) / 100,
    totalDistanceMiles: Math.round((totalDistKm / KM_PER_MILE) * 100) / 100,
    quarter: iftaRatesData.quarter,
    effectiveDate: iftaRatesData.effectiveDate,
  };
}
