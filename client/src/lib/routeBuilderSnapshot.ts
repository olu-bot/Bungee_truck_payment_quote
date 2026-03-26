export type SnapshotLeg = {
  from: string;
  to: string;
  type?: string;
  isLocal?: boolean;
  isDeadhead?: boolean;
  distanceKm: number;
  driveMinutes: number;
  dockMinutes: number;
  totalBillableHours: number;
  laborCost: number;
  fuelCost: number;
  legCost: number;
};

export type RouteBuilderSnapshot = {
  routeSummary: string;
  totalKm: number;
  totalMin: number;
  returnKm: number;
  includeReturn: boolean;
  fuelPricePerLitre: number;
  yardLabel?: string;
  deliveryCost: number;
  deadheadCost: number;
  fullTripCost: number;
  allInHourlyRate: number;
  fuelPerKm: number;
  tiers: { label: string; percent: number; price: number; marginAmount: number }[];
  customQuoteInput?: string;
  customQuote?: {
    label: string;
    quoteAmount: number;
    marginPercent: number;
    marginAmount: number;
  };
  legs: SnapshotLeg[];
  chatUserMessage?: string;
};

export function parseRouteBuilderSnapshot(
  json: string | undefined | null,
): RouteBuilderSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RouteBuilderSnapshot;
  } catch {
    return null;
  }
}
