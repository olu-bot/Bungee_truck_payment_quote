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
  fixedCost: number;
  driverCost: number;
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
  /** Surcharge % applied to base cost (hazmat, regulatory) */
  surchargePercent?: number;
  /** Surcharge dollar amount */
  surchargeAmount?: number;
  /** Carrier cost = fullTripCost + surchargeAmount */
  carrierCost?: number;
  /** One-time accessorial charges (detention, lumper, TONU, etc.) — 0 in quick-quote mode */
  accessorialTotal?: number;
  /** Accessorial line items for display */
  accessorialItems?: { label: string; amount: number }[];
  /** fullTripCost + surchargeAmount + accessorialTotal */
  allInCost?: number;
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
  payMode?: string;
  dockTimeHrs?: number;
  quoteMode?: string;
  chatUserMessage?: string;
  customerNote?: string;
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
