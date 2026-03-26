/** User/company preference for how distances and related labels are shown. Internal math can stay in km where the app already uses it. */
export type MeasurementUnit = "metric" | "imperial";

export type WorkspaceMeasurementFields = {
  measurementUnit?: string;
};

export function resolveMeasurementUnit(
  fields: WorkspaceMeasurementFields | null | undefined
): MeasurementUnit {
  const u = fields?.measurementUnit;
  if (u === "metric" || u === "imperial") return u;
  return "imperial";
}

export const KM_PER_MILE = 1.609344;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

// ── Fuel consumption conversions ────────────────────────────────
// Internal storage is always L/100km.
// Display conversion: MPG (US gallon) ↔ L/100km
// Formula: MPG = 235.215 / (L/100km)   and   L/100km = 235.215 / MPG

const MPG_CONSTANT = 235.215; // (100 × 3.78541) / 1.609344

/** Convert L/100km (internal) → MPG (US gallon) for display */
export function lPer100kmToMpg(lPer100km: number): number {
  if (lPer100km <= 0) return 0;
  return MPG_CONSTANT / lPer100km;
}

/** Convert MPG (US gallon) → L/100km (internal) for storage */
export function mpgToLPer100km(mpg: number): number {
  if (mpg <= 0) return 0;
  return MPG_CONSTANT / mpg;
}

// ── Display label helpers ───────────────────────────────────────

/** Returns the distance unit label for the current measurement unit */
export function distanceLabel(unit: MeasurementUnit): string {
  return unit === "imperial" ? "mi" : "km";
}

/** Returns the fuel consumption label for the current measurement unit */
export function fuelConsumptionLabel(unit: MeasurementUnit): string {
  return unit === "imperial" ? "MPG" : "L/100km";
}

/** Returns the fuel consumption unit suffix for the current measurement unit */
export function fuelConsumptionSuffix(unit: MeasurementUnit): string {
  return unit === "imperial" ? "MPG" : "L";
}

/**
 * Convert a distance value for display based on measurement unit.
 * Internal values are always in km.
 */
export function displayDistance(km: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? kmToMiles(km) : km;
}

/**
 * Convert a fuel consumption value for display based on measurement unit.
 * Internal values are always in L/100km.
 */
export function displayFuelConsumption(lPer100km: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? lPer100kmToMpg(lPer100km) : lPer100km;
}

/**
 * Convert a user-entered fuel consumption value to internal L/100km.
 */
export function inputToLPer100km(value: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? mpgToLPer100km(value) : value;
}
