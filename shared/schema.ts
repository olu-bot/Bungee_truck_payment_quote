import { z } from "zod";

// ── Route stops (route builder + API) ────────────────────────────

export const routeStopSchema = z.object({
  id: z.string(),
  type: z.string(),
  location: z.string(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  dockTimeMinutes: z.number().optional(),
  distanceFromPrevKm: z.number().optional(),
  driveMinutesFromPrev: z.number().optional(),
});

export type RouteStop = z.infer<typeof routeStopSchema>;

export const calculateRouteSchema = z.object({
  profileId: z.string(),
  stops: z.array(routeStopSchema),
  includeReturn: z.boolean(),
  fuelPricePerLitre: z.number(),
});

export const pricingTiersSchema = z.object({
  totalCost: z.number(),
  customMarginPercent: z.number().optional(),
  customQuoteAmount: z.number().optional(),
});

export const chatRouteSchema = z.object({
  message: z.string().min(1),
});

// ── Cost profile ─────────────────────────────────────────────────

export const insertCostProfileSchema = z.object({
  name: z.string(),
  truckType: z.string(),
  monthlyTruckPayment: z.number(),
  monthlyInsurance: z.number(),
  monthlyMaintenance: z.number(),
  monthlyPermitsPlates: z.number(),
  monthlyOther: z.number(),
  workingDaysPerMonth: z.number(),
  workingHoursPerDay: z.number(),
  driverPayPerHour: z.number(),
  driverPayPerMile: z.number().optional(), // Per-mile driver pay for long-haul ($/mi or $/km)
  deadheadPayPercent: z.number().optional(), // Deadhead rate as % of loaded rate (e.g. 75 = 75%), defaults to 100
  fuelConsumptionPer100km: z.number(),
  defaultDockTimeMinutes: z.number(),
  detentionRatePerHour: z.number(),
  currency: z.string().optional(), // Currency the profile values were entered in (e.g. "USD", "CAD")
  createdAt: z.string().optional(),
});

export type CostProfile = z.infer<typeof insertCostProfileSchema> & { id: string; createdAt: string };

// ── Yard ─────────────────────────────────────────────────────────

export const insertYardSchema = z.object({
  name: z.string(),
  address: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export type Yard = z.infer<typeof insertYardSchema> & { id: string };

// ── Team ─────────────────────────────────────────────────────────

export const insertTeamMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  pin: z.string(),
  createdAt: z.string().optional(),
});

export type TeamMember = z.infer<typeof insertTeamMemberSchema> & { id: string; createdAt: string };

// ── Lane / rates (quote calculator) ──────────────────────────────

export const insertLaneSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  truckType: z.string(),
  fixedPrice: z.number(),
  estimatedMiles: z.number(),
});

export type Lane = z.infer<typeof insertLaneSchema> & { id: string };

export type RateTable = {
  truckType: string;
  ratePerMile: number;
  fuelSurchargePercent: number;
  minCharge: number;
};

export type HourlyRate = {
  truckType: string;
  driverPayPerHour: number;
  truckCostPerHour: number;
  insurancePerHour: number;
  maintenancePerHour: number;
  miscPerHour: number;
  fuelPerKm: number;
  citySpeedKmh: number;
  detentionRatePerHour: number;
};

// ── Saved route (Firestore / optional API) ───────────────────────

export type SavedRoute = {
  id: string;
  name?: string;
  createdAt: string;
  stops?: RouteStop[];
  [key: string]: unknown;
};

// ── Quote ────────────────────────────────────────────────────────

export type QuoteStatus = "pending" | "won" | "lost";

export type Quote = {
  id: string;
  quoteNumber: string;
  createdAt: string;
  profileId?: string | null;
  routeId?: string | null;
  origin: string;
  destination: string;
  truckType: string;
  distance: number;
  pricingMode: string;
  carrierCost: number;
  fuelSurcharge: number;
  totalCarrierCost: number;
  marginType: string;
  marginValue: number;
  marginAmount: number;
  customerPrice: number;
  grossProfit: number;
  profitMarginPercent: number;
  quoteSource?: string;
  routeSnapshotJson?: string;
  /** Free-text note: RFQ#, customer name, lane memo, etc. */
  customerNote?: string;
  /** Pipeline status — defaults to "pending" */
  status?: QuoteStatus;
  /** The final rate the customer agreed to (may differ from customerPrice after negotiation) */
  wonRate?: number | null;
  /** Note recorded when marking won or lost (e.g. why we lost, who won, negotiation details) */
  statusNote?: string;
};
