import type { CostProfile, RouteStop } from "@shared/schema";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getFixedCostPerHour(p: CostProfile): number {
  const monthlyFixed =
    p.monthlyTruckPayment +
    p.monthlyInsurance +
    p.monthlyMaintenance +
    p.monthlyPermitsPlates +
    p.monthlyOther;
  const hoursPerMonth = p.workingDaysPerMonth * p.workingHoursPerDay;
  return hoursPerMonth > 0 ? monthlyFixed / hoursPerMonth : 0;
}

function getFuelPerKm(fuelConsumptionPer100km: number, fuelPricePerLitre: number): number {
  return (fuelConsumptionPer100km / 100) * fuelPricePerLitre;
}

function getAllInHourly(p: CostProfile): number {
  return getFixedCostPerHour(p) + p.driverPayPerHour;
}

/**
 * Deadhead = the **return** leg only (Delivery → Yard).
 *
 * Typical route:  Pickup → [Stops] → Delivery → Yard
 *                 ^^^^^^^^ trip cost ^^^^^^^^^^   ^^^^ deadhead (return empty)
 *
 * Routes start at the pickup — the yard-to-pickup travel is not a leg.
 * Only the final leg whose destination is a yard (the return) is deadhead.
 */
function isReturnDeadhead(
  _from: RouteStop,
  to: RouteStop,
  isLastLeg: boolean,
): boolean {
  return isLastLeg && to.type === "yard";
}

export function calculateRouteCost(
  profile: CostProfile,
  stops: RouteStop[],
  includeDeadhead: boolean,
  fuelPricePerLitre: number,
  _returnDistanceKm?: number,
  _returnDriveMinutes?: number,
) {
  const allInHourly = getAllInHourly(profile);
  const fuelPerKm = getFuelPerKm(profile.fuelConsumptionPer100km, fuelPricePerLitre);

  const legs: Array<{
    from: string;
    to: string;
    type: string;
    isLocal: boolean;
    isDeadhead: boolean;
    distanceKm: number;
    driveMinutes: number;
    dockMinutes: number;
    totalBillableHours: number;
    laborCost: number;
    fuelCost: number;
    legCost: number;
  }> = [];

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    const isLastLeg = i === stops.length - 1;
    const deadhead = isReturnDeadhead(from, to, isLastLeg);

    // Skip the deadhead leg entirely when the toggle is off
    if (deadhead && !includeDeadhead) continue;

    const driveMin = to.driveMinutesFromPrev || 0;
    const distKm = to.distanceFromPrevKm || 0;
    // Deadhead legs have no dock/loading time
    const dockMin = deadhead ? 0 : (to.dockTimeMinutes || 0);

    const driveHours = driveMin / 60;
    const dockHours = dockMin / 60;
    const billableHours = driveHours + dockHours;
    const legTimeCost = billableHours * allInHourly;
    const legFuelCost = distKm * fuelPerKm;
    const isLocal = distKm < 100;

    legs.push({
      from: from.location,
      to: to.location,
      type: deadhead ? "deadhead" : (to.type || "delivery"),
      isLocal,
      isDeadhead: deadhead,
      distanceKm: r2(distKm),
      driveMinutes: r2(driveMin),
      dockMinutes: r2(dockMin),
      totalBillableHours: r2(billableHours),
      laborCost: r2(billableHours * allInHourly),
      fuelCost: r2(legFuelCost),
      legCost: r2(legTimeCost + legFuelCost),
    });
  }

  // Derive totals from the legs (single source of truth)
  let totalDistanceKm = 0;
  let totalDriveMinutes = 0;
  let totalDockMinutes = 0;
  for (const leg of legs) {
    totalDistanceKm += leg.distanceKm;
    totalDriveMinutes += leg.driveMinutes;
    totalDockMinutes += leg.dockMinutes;
  }

  const tripCost = r2(legs.filter((l) => !l.isDeadhead).reduce((s, l) => s + l.legCost, 0));
  const deadheadCost = r2(legs.filter((l) => l.isDeadhead).reduce((s, l) => s + l.legCost, 0));
  const fullTripCost = r2(tripCost + deadheadCost);

  return {
    legs,
    totalDistanceKm: r2(totalDistanceKm),
    totalDriveMinutes: r2(totalDriveMinutes),
    totalDockMinutes: r2(totalDockMinutes),
    totalHours: r2((totalDriveMinutes + totalDockMinutes) / 60),
    allInHourlyRate: r2(allInHourly),
    fixedCostPerHour: r2(getFixedCostPerHour(profile)),
    fuelPerKm: r2(fuelPerKm),
    tripCost,
    deadheadCost,
    fullTripCost,
  };
}

type PricingTier = { label: string; percent: number; price: number; marginAmount: number };

export function getPricingAdvice(
  totalCost: number,
  customMarginPercent?: number,
  customQuoteAmount?: number,
): {
  tiers: PricingTier[];
  customPercent: {
    label: string;
    percent: number;
    price: number;
    marginAmount: number;
  } | null;
  customQuote: {
    label: string;
    quoteAmount: number;
    marginPercent: number;
    marginAmount: number;
  } | null;
} {
  const tiers: PricingTier[] = [
    { label: "20% Margin", percent: 20, price: r2(totalCost * 1.2), marginAmount: r2(totalCost * 0.2) },
    { label: "30% Margin", percent: 30, price: r2(totalCost * 1.3), marginAmount: r2(totalCost * 0.3) },
    { label: "40% Margin", percent: 40, price: r2(totalCost * 1.4), marginAmount: r2(totalCost * 0.4) },
  ];

  let customPercent: {
    label: string;
    percent: number;
    price: number;
    marginAmount: number;
  } | null = null;
  if (customMarginPercent !== undefined && customMarginPercent > 0) {
    customPercent = {
      label: "Custom %",
      percent: customMarginPercent,
      price: r2(totalCost * (1 + customMarginPercent / 100)),
      marginAmount: r2((totalCost * customMarginPercent) / 100),
    };
  }

  let customQuote: {
    label: string;
    quoteAmount: number;
    marginPercent: number;
    marginAmount: number;
  } | null = null;
  if (customQuoteAmount !== undefined && customQuoteAmount > 0 && totalCost > 0) {
    const marginPercent = r2(((customQuoteAmount - totalCost) / totalCost) * 100);
    customQuote = {
      label: "Custom Quote",
      quoteAmount: customQuoteAmount,
      marginPercent,
      marginAmount: r2(customQuoteAmount - totalCost),
    };
  }

  return { tiers, customPercent, customQuote };
}
