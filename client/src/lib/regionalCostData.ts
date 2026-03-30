/**
 * Regional trucking cost database for North America.
 *
 * Data compiled from ATRI 2024-2025 Operational Costs of Trucking,
 * BLS occupational data, state-level insurance reports, and Canadian
 * Trucking Alliance sources. All USD baselines; Canadian regions noted
 * with currency: "CAD" for downstream conversion.
 */

// ── Types ──────────────────────────────────────────────────────────

export type RegionData = {
  id: string;
  name: string;
  /** ISO state / province codes belonging to this region */
  states: string[];
  /** Multipliers relative to national baseline (1.0 = average) */
  costMultipliers: {
    truckPayment: number;
    insurance: number;
    maintenance: number;
    permits: number;
    driverPay: number;
    fuel: number;
  };
  currency: "USD" | "CAD";
};

export type EquipmentBaseline = {
  label: string;
  monthlyTruckPayment: number;
  monthlyInsurance: number;
  monthlyMaintenance: number;
  monthlyPermitsPlates: number;
  monthlyOther: number;
  driverPayPerHour: number;
  driverPayPerMile: number;
  /** Fuel consumption in L/100 km (internal unit) */
  fuelConsumptionLPer100km: number;
  defaultDockTimeMinutes: number;
  detentionRatePerHour: number;
  workingDaysPerMonth: number;
  workingHoursPerDay: number;
  deadheadPayPercent: number;
};

// ── Regions ────────────────────────────────────────────────────────

export const REGIONS: RegionData[] = [
  // ── United States ────────────────────────────────────────────
  {
    id: "us_northeast",
    name: "Northeast US",
    states: ["MA", "CT", "RI", "VT", "NH", "ME", "NY", "PA", "NJ"],
    costMultipliers: { truckPayment: 1.08, insurance: 1.45, maintenance: 1.15, permits: 1.20, driverPay: 1.12, fuel: 1.08 },
    currency: "USD",
  },
  {
    id: "us_southeast",
    name: "Southeast US",
    states: ["FL", "GA", "SC", "NC", "VA", "WV", "MD", "DE", "LA", "MS", "AL", "TN", "KY"],
    costMultipliers: { truckPayment: 0.97, insurance: 1.28, maintenance: 1.10, permits: 0.95, driverPay: 1.05, fuel: 1.10 },
    currency: "USD",
  },
  {
    id: "us_midwest",
    name: "Midwest US",
    states: ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "NE", "KS", "ND", "SD"],
    costMultipliers: { truckPayment: 0.92, insurance: 0.95, maintenance: 1.05, permits: 0.90, driverPay: 0.98, fuel: 1.02 },
    currency: "USD",
  },
  {
    id: "us_mountain",
    name: "Mountain West",
    states: ["MT", "WY", "CO", "UT", "ID", "NM", "AZ", "NV"],
    costMultipliers: { truckPayment: 0.95, insurance: 0.98, maintenance: 1.08, permits: 0.95, driverPay: 1.03, fuel: 1.15 },
    currency: "USD",
  },
  {
    id: "us_pacific",
    name: "Pacific US",
    states: ["WA", "OR", "CA", "HI", "AK"],
    costMultipliers: { truckPayment: 1.12, insurance: 1.22, maintenance: 1.12, permits: 1.25, driverPay: 1.18, fuel: 1.12 },
    currency: "USD",
  },
  {
    id: "us_southwest",
    name: "Texas & Southwest",
    states: ["TX", "OK", "AR"],
    costMultipliers: { truckPayment: 0.94, insurance: 1.10, maintenance: 1.06, permits: 0.92, driverPay: 1.02, fuel: 1.05 },
    currency: "USD",
  },
  // ── Canada ───────────────────────────────────────────────────
  {
    id: "ca_west",
    name: "Western Canada",
    states: ["BC", "AB", "SK", "MB"],
    costMultipliers: { truckPayment: 1.10, insurance: 1.15, maintenance: 1.12, permits: 1.10, driverPay: 1.10, fuel: 1.18 },
    currency: "CAD",
  },
  {
    id: "ca_ontario",
    name: "Ontario",
    states: ["ON"],
    costMultipliers: { truckPayment: 1.05, insurance: 1.20, maintenance: 1.10, permits: 1.15, driverPay: 1.08, fuel: 1.12 },
    currency: "CAD",
  },
  {
    id: "ca_quebec",
    name: "Quebec",
    states: ["QC"],
    costMultipliers: { truckPayment: 1.02, insurance: 1.18, maintenance: 1.10, permits: 1.18, driverPay: 1.06, fuel: 1.10 },
    currency: "CAD",
  },
  {
    id: "ca_atlantic",
    name: "Atlantic Canada",
    states: ["NB", "NS", "PE", "NL"],
    costMultipliers: { truckPayment: 0.98, insurance: 1.12, maintenance: 1.15, permits: 1.08, driverPay: 1.04, fuel: 1.22 },
    currency: "CAD",
  },
];

// ── Equipment baselines ────────────────────────────────────────────

export const EQUIPMENT_BASELINES: Record<string, EquipmentBaseline> = {
  dry_van: {
    label: "Dry Van",
    monthlyTruckPayment: 1950,
    monthlyInsurance: 975,
    monthlyMaintenance: 480,
    monthlyPermitsPlates: 85,
    monthlyOther: 150,
    driverPayPerHour: 28.5,
    driverPayPerMile: 0.48,
    fuelConsumptionLPer100km: 34.0,
    defaultDockTimeMinutes: 45,
    detentionRatePerHour: 50,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    deadheadPayPercent: 80,
  },
  straight_truck: {
    label: "Straight Truck",
    monthlyTruckPayment: 1400,
    monthlyInsurance: 750,
    monthlyMaintenance: 380,
    monthlyPermitsPlates: 65,
    monthlyOther: 100,
    driverPayPerHour: 25.0,
    driverPayPerMile: 0.42,
    fuelConsumptionLPer100km: 28.0,
    defaultDockTimeMinutes: 45,
    detentionRatePerHour: 50,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    deadheadPayPercent: 80,
  },
  reefer: {
    label: "Reefer",
    monthlyTruckPayment: 2200,
    monthlyInsurance: 1125,
    monthlyMaintenance: 680,
    monthlyPermitsPlates: 95,
    monthlyOther: 200,
    driverPayPerHour: 30.0,
    driverPayPerMile: 0.52,
    fuelConsumptionLPer100km: 37.5,
    defaultDockTimeMinutes: 60,
    detentionRatePerHour: 75,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    deadheadPayPercent: 80,
  },
  flatbed: {
    label: "Flatbed",
    monthlyTruckPayment: 2150,
    monthlyInsurance: 1050,
    monthlyMaintenance: 620,
    monthlyPermitsPlates: 110,
    monthlyOther: 175,
    driverPayPerHour: 29.25,
    driverPayPerMile: 0.50,
    fuelConsumptionLPer100km: 35.5,
    defaultDockTimeMinutes: 90,
    detentionRatePerHour: 65,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    deadheadPayPercent: 80,
  },
  step_deck: {
    label: "Step Deck",
    monthlyTruckPayment: 2300,
    monthlyInsurance: 1100,
    monthlyMaintenance: 650,
    monthlyPermitsPlates: 130,
    monthlyOther: 200,
    driverPayPerHour: 31.0,
    driverPayPerMile: 0.55,
    fuelConsumptionLPer100km: 38.0,
    defaultDockTimeMinutes: 120,
    detentionRatePerHour: 85,
    workingDaysPerMonth: 20,
    workingHoursPerDay: 11,
    deadheadPayPercent: 75,
  },
  tanker: {
    label: "Tanker",
    monthlyTruckPayment: 2250,
    monthlyInsurance: 1250,
    monthlyMaintenance: 720,
    monthlyPermitsPlates: 150,
    monthlyOther: 250,
    driverPayPerHour: 32.0,
    driverPayPerMile: 0.58,
    fuelConsumptionLPer100km: 36.0,
    defaultDockTimeMinutes: 75,
    detentionRatePerHour: 80,
    workingDaysPerMonth: 21,
    workingHoursPerDay: 10,
    deadheadPayPercent: 75,
  },
};

// ── Helpers ────────────────────────────────────────────────────────

/** Finds the region for a given US state or Canadian province code. */
export function findRegionByState(stateCode: string): RegionData | undefined {
  const code = stateCode.toUpperCase().trim();
  return REGIONS.find((r) => r.states.includes(code));
}

/** All state/province codes mapped to region IDs for quick lookup. */
export const STATE_TO_REGION: Record<string, string> = {};
for (const r of REGIONS) {
  for (const s of r.states) {
    STATE_TO_REGION[s] = r.id;
  }
}

/**
 * Compute a region-adjusted cost profile from equipment baseline and region.
 * Returns values suitable for pre-populating the cost profile wizard.
 */
export function getRegionalEstimate(
  equipmentType: string,
  region: RegionData | undefined,
): EquipmentBaseline {
  const base = EQUIPMENT_BASELINES[equipmentType] ?? EQUIPMENT_BASELINES.dry_van;
  if (!region) return { ...base };

  const m = region.costMultipliers;
  return {
    ...base,
    monthlyTruckPayment: Math.round(base.monthlyTruckPayment * m.truckPayment),
    monthlyInsurance: Math.round(base.monthlyInsurance * m.insurance),
    monthlyMaintenance: Math.round(base.monthlyMaintenance * m.maintenance),
    monthlyPermitsPlates: Math.round(base.monthlyPermitsPlates * m.permits),
    monthlyOther: Math.round(base.monthlyOther * (m.maintenance + m.truckPayment) / 2), // blend
    driverPayPerHour: Math.round(base.driverPayPerHour * m.driverPay * 100) / 100,
    driverPayPerMile: Math.round(base.driverPayPerMile * m.driverPay * 100) / 100,
    fuelConsumptionLPer100km: Math.round(base.fuelConsumptionLPer100km * m.fuel * 10) / 10,
  };
}

/** Flat list of all US states + Canadian provinces for the location picker. */
export const ALL_STATES: { code: string; name: string; country: "US" | "CA" }[] = [
  // US States
  { code: "AL", name: "Alabama", country: "US" },
  { code: "AK", name: "Alaska", country: "US" },
  { code: "AZ", name: "Arizona", country: "US" },
  { code: "AR", name: "Arkansas", country: "US" },
  { code: "CA", name: "California", country: "US" },
  { code: "CO", name: "Colorado", country: "US" },
  { code: "CT", name: "Connecticut", country: "US" },
  { code: "DE", name: "Delaware", country: "US" },
  { code: "FL", name: "Florida", country: "US" },
  { code: "GA", name: "Georgia", country: "US" },
  { code: "HI", name: "Hawaii", country: "US" },
  { code: "ID", name: "Idaho", country: "US" },
  { code: "IL", name: "Illinois", country: "US" },
  { code: "IN", name: "Indiana", country: "US" },
  { code: "IA", name: "Iowa", country: "US" },
  { code: "KS", name: "Kansas", country: "US" },
  { code: "KY", name: "Kentucky", country: "US" },
  { code: "LA", name: "Louisiana", country: "US" },
  { code: "ME", name: "Maine", country: "US" },
  { code: "MD", name: "Maryland", country: "US" },
  { code: "MA", name: "Massachusetts", country: "US" },
  { code: "MI", name: "Michigan", country: "US" },
  { code: "MN", name: "Minnesota", country: "US" },
  { code: "MS", name: "Mississippi", country: "US" },
  { code: "MO", name: "Missouri", country: "US" },
  { code: "MT", name: "Montana", country: "US" },
  { code: "NE", name: "Nebraska", country: "US" },
  { code: "NV", name: "Nevada", country: "US" },
  { code: "NH", name: "New Hampshire", country: "US" },
  { code: "NJ", name: "New Jersey", country: "US" },
  { code: "NM", name: "New Mexico", country: "US" },
  { code: "NY", name: "New York", country: "US" },
  { code: "NC", name: "North Carolina", country: "US" },
  { code: "ND", name: "North Dakota", country: "US" },
  { code: "OH", name: "Ohio", country: "US" },
  { code: "OK", name: "Oklahoma", country: "US" },
  { code: "OR", name: "Oregon", country: "US" },
  { code: "PA", name: "Pennsylvania", country: "US" },
  { code: "RI", name: "Rhode Island", country: "US" },
  { code: "SC", name: "South Carolina", country: "US" },
  { code: "SD", name: "South Dakota", country: "US" },
  { code: "TN", name: "Tennessee", country: "US" },
  { code: "TX", name: "Texas", country: "US" },
  { code: "UT", name: "Utah", country: "US" },
  { code: "VT", name: "Vermont", country: "US" },
  { code: "VA", name: "Virginia", country: "US" },
  { code: "WA", name: "Washington", country: "US" },
  { code: "WV", name: "West Virginia", country: "US" },
  { code: "WI", name: "Wisconsin", country: "US" },
  { code: "WY", name: "Wyoming", country: "US" },
  // Canadian Provinces
  { code: "AB", name: "Alberta", country: "CA" },
  { code: "BC", name: "British Columbia", country: "CA" },
  { code: "MB", name: "Manitoba", country: "CA" },
  { code: "NB", name: "New Brunswick", country: "CA" },
  { code: "NL", name: "Newfoundland & Labrador", country: "CA" },
  { code: "NS", name: "Nova Scotia", country: "CA" },
  { code: "ON", name: "Ontario", country: "CA" },
  { code: "PE", name: "Prince Edward Island", country: "CA" },
  { code: "QC", name: "Quebec", country: "CA" },
  { code: "SK", name: "Saskatchewan", country: "CA" },
];
