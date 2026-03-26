import type { Lane } from "@shared/schema";
import type { MeasurementUnit } from "@/lib/measurement";

/** Serializable quote result (per-mile / fixed lane) */
export type SnapshotQuoteResult = {
  carrierCost: number;
  fuelSurcharge: number;
  totalCarrierCost: number;
  marginAmount: number;
  customerPrice: number;
  grossProfit: number;
  profitMarginPercent: number;
  ratePerMile: number;
  fuelSurchargePercent: number;
  minCharge: number;
};

/** Serializable local P&D result */
export type SnapshotLocalResult = {
  driveTimeMinutes: number;
  dockTimeMinutes: number;
  returnTimeMinutes: number;
  totalMinutes: number;
  totalHours: number;
  oneWayKm: number;
  returnKm: number;
  totalKm: number;
  allInHourlyRate: number;
  timeCost: number;
  fuelCost: number;
  totalCarrierCost: number;
  marginAmount: number;
  customerPrice: number;
  grossProfit: number;
  profitMarginPercent: number;
  fuelPerKm: number;
  citySpeedKmh: number;
  rushMultiplier: number;
  stopsCount: number;
};

export type QuoteCalculatorSnapshot = {
  v: 1;
  pricingMode: "per_mile" | "fixed_lane" | "local_pd";
  measurementUnit: MeasurementUnit;
  truckType: string;
  marginType: "flat" | "percentage";
  marginValue: number;
  origin?: string;
  destination?: string;
  /** Miles used for per-mile / fixed-lane pricing */
  distanceMiles?: number;
  distanceInputLabel?: string;
  laneId?: string;
  laneLabel?: string;
  localOrigin?: string;
  localDestination?: string;
  localDistanceKm?: number;
  pickupDockMinutes?: number;
  deliveryDockMinutes?: number;
  additionalStops?: Array<{ location: string; dockTimeMinutes: number; distanceKm: number }>;
  isRoundTrip?: boolean;
  isRushHour?: boolean;
  standard?: SnapshotQuoteResult;
  local?: SnapshotLocalResult;
};

export function parseQuoteCalculatorSnapshot(
  json: string | undefined | null,
): QuoteCalculatorSnapshot | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as QuoteCalculatorSnapshot;
    return o && o.v === 1 ? o : null;
  } catch {
    return null;
  }
}

export function laneLabelForSnapshot(laneId: string, lanes: Lane[]): string | undefined {
  const lane = lanes.find((l) => l.id === laneId);
  if (!lane) return undefined;
  return `${lane.origin} → ${lane.destination}`;
}

export function buildQuoteCalculatorSnapshot(args: {
  pricingMode: "per_mile" | "fixed_lane" | "local_pd";
  measurementUnit: MeasurementUnit;
  truckType: string;
  marginType: "flat" | "percentage";
  marginValue: number;
  origin: string;
  destination: string;
  standardMiles: number;
  standardDistanceLabel: string;
  selectedLaneId: string;
  lanes: Lane[];
  localOrigin: string;
  localDestination: string;
  localDistanceKm: string;
  pickupDockMinutes: string;
  deliveryDockMinutes: string;
  additionalStops: Array<{ location: string; dockTimeMinutes: number; distanceKm: number }>;
  isRoundTrip: boolean;
  isRushHour: boolean;
  standard?: SnapshotQuoteResult | null;
  local?: SnapshotLocalResult | null;
}): QuoteCalculatorSnapshot {
  const laneLabel =
    args.pricingMode === "fixed_lane" && args.selectedLaneId
      ? laneLabelForSnapshot(args.selectedLaneId, args.lanes)
      : undefined;
  return {
    v: 1,
    pricingMode: args.pricingMode,
    measurementUnit: args.measurementUnit,
    truckType: args.truckType,
    marginType: args.marginType,
    marginValue: args.marginValue,
    ...(args.pricingMode !== "local_pd"
      ? {
          origin: args.origin,
          destination: args.destination,
          distanceMiles: args.standardMiles,
          distanceInputLabel: args.standardDistanceLabel,
          laneId: args.selectedLaneId || undefined,
          laneLabel,
          standard: args.standard ?? undefined,
        }
      : {
          localOrigin: args.localOrigin,
          localDestination: args.localDestination,
          localDistanceKm: Number(args.localDistanceKm) || 0,
          pickupDockMinutes: Number(args.pickupDockMinutes) || 0,
          deliveryDockMinutes: Number(args.deliveryDockMinutes) || 0,
          additionalStops: args.additionalStops.length ? args.additionalStops : undefined,
          isRoundTrip: args.isRoundTrip,
          isRushHour: args.isRushHour,
          local: args.local ?? undefined,
        }),
  };
}
