import type { PayMode } from "@/lib/routeCalc";
import type { Lane } from "@shared/schema";

export type FormStop = {
  id: string;
  location: string;
  dockMinutes: number;
  /** User-applied offset (minutes) on top of the Google API drive time. Resets when the route is rebuilt. */
  driveMinutesAdjustment?: number;
};

export type LegBreakdown = {
  from: string;
  to: string;
  type?: string;
  isLocal?: boolean;
  distanceKm: number;
  driveMinutes: number;
  dockMinutes: number;
  totalBillableHours: number;
  fixedCost: number;
  driverCost: number;
  fuelCost: number;
  legCost: number;
  isDeadhead?: boolean;
};

export type RouteCalculation = {
  legs: LegBreakdown[];
  totalDistanceKm: number;
  totalDriveMinutes: number;
  totalDockMinutes: number;
  totalHours: number;
  allInHourlyRate: number;
  fixedCostPerHour: number;
  fuelPerKm: number;
  payMode: PayMode;
  driverPayPerMile: number;
  deadheadPayPercent: number;
  tripCost: number;
  deadheadCost: number;
  fullTripCost: number;
};

export type PricingTier = {
  label: string;
  percent: number;
  price: number;
};

export type PricingAdvice = {
  totalCost: number;
  tiers: (PricingTier & { marginAmount: number })[];
  customPercent?: { label: string; percent: number; price: number; marginAmount: number } | null;
  customQuote?: { label: string; quoteAmount: number; marginPercent: number; marginAmount: number } | null;
};

export type LaneWithCache = Lane & { cachedStops?: { location?: string; type?: string }[] };
