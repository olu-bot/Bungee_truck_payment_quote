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

export function calculateRouteCost(
  profile: CostProfile,
  stops: RouteStop[],
  includeReturn: boolean,
  fuelPricePerLitre: number,
  returnDistanceKm?: number,
  returnDriveMinutes?: number,
) {
  const allInHourly = getAllInHourly(profile);
  const fuelPerKm = getFuelPerKm(profile.fuelConsumptionPer100km, fuelPricePerLitre);

  let totalDriveMinutes = 0;
  let totalDockMinutes = 0;
  let totalDistanceKm = 0;
  const legs: Array<Record<string, unknown>> = [];

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    const driveMin = to.driveMinutesFromPrev || 0;
    const distKm = to.distanceFromPrevKm || 0;
    const dockMin = to.dockTimeMinutes || 0;

    totalDriveMinutes += driveMin;
    totalDockMinutes += dockMin;
    totalDistanceKm += distKm;

    const driveHours = driveMin / 60;
    const dockHours = dockMin / 60;
    const legTimeCost = (driveHours + dockHours) * allInHourly;
    const legFuelCost = distKm * fuelPerKm;
    const isLocal = distKm < 100;

    legs.push({
      from: from.location,
      to: to.location,
      type: to.type,
      isLocal,
      distanceKm: r2(distKm),
      driveMinutes: r2(driveMin),
      dockMinutes: r2(dockMin),
      totalBillableHours: r2((driveMin + dockMin) / 60),
      laborCost: r2(((driveMin + dockMin) / 60) * allInHourly),
      fuelCost: r2(legFuelCost),
      legCost: r2(legTimeCost + legFuelCost),
    });
  }

  let returnLeg: Record<string, unknown> | null = null;
  if (includeReturn) {
    const retKm =
      returnDistanceKm ||
      (stops.length > 1 ? stops[stops.length - 1]!.distanceFromPrevKm || 0 : 0);
    const retMin =
      returnDriveMinutes ||
      (stops.length > 1 ? stops[stops.length - 1]!.driveMinutesFromPrev || 0 : 0);
    totalDistanceKm += retKm;
    totalDriveMinutes += retMin;

    const driveHours = retMin / 60;
    const legTimeCost = driveHours * allInHourly;
    const legFuelCost = retKm * fuelPerKm;

    returnLeg = {
      from: stops[stops.length - 1]!.location,
      to: stops[0]!.location,
      type: "return",
      isLocal: retKm < 100,
      distanceKm: r2(retKm),
      driveMinutes: r2(retMin),
      dockMinutes: 0,
      totalBillableHours: r2(retMin / 60),
      laborCost: r2(driveHours * allInHourly),
      fuelCost: r2(legFuelCost),
      legCost: r2(legTimeCost + legFuelCost),
    };
    legs.push(returnLeg);
  }

  const totalHours = (totalDriveMinutes + totalDockMinutes) / 60;
  const timeCost = totalHours * allInHourly;
  const fuelCost = totalDistanceKm * fuelPerKm;
  const totalCost = timeCost + fuelCost;

  const deliveryCost = legs.filter((l) => l.type !== "return").reduce((sum, l) => sum + (l.legCost as number), 0);
  const deadheadCost = returnLeg ? (returnLeg.legCost as number) : 0;

  return {
    legs,
    totalDistanceKm: r2(totalDistanceKm),
    totalDriveMinutes: r2(totalDriveMinutes),
    totalDockMinutes: r2(totalDockMinutes),
    totalHours: r2(totalHours),
    allInHourlyRate: r2(allInHourly),
    fixedCostPerHour: r2(getFixedCostPerHour(profile)),
    fuelPerKm: r2(fuelPerKm),
    deliveryCost: r2(deliveryCost),
    deadheadCost: r2(deadheadCost),
    fullTripCost: r2(totalCost),
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
