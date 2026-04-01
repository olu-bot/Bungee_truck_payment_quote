import { describe, it, expect } from "vitest";
import { calculateRouteCost, getPricingAdvice } from "./routeCalc";
import type { CostProfile, RouteStop } from "@shared/schema";

// ── Test fixtures ───────────────────────────────────────────────

const baseProfile: CostProfile = {
  id: "p1",
  name: "Test Profile",
  truckType: "dry_van",
  monthlyTruckPayment: 1500,
  monthlyInsurance: 800,
  monthlyMaintenance: 400,
  monthlyPermitsPlates: 200,
  monthlyOther: 100,
  workingDaysPerMonth: 22,
  workingHoursPerDay: 10,
  driverPayPerHour: 25,
  driverPayPerMile: 0.55,
  deadheadPayPercent: 75,
  fuelConsumptionPer100km: 35,
  defaultDockTimeMinutes: 30,
  detentionRatePerHour: 50,
  createdAt: "2026-01-01",
};

function makeStop(overrides: Partial<RouteStop> & { location: string }): RouteStop {
  return {
    id: overrides.location,
    type: overrides.type ?? "delivery",
    location: overrides.location,
    distanceFromPrevKm: overrides.distanceFromPrevKm ?? 0,
    driveMinutesFromPrev: overrides.driveMinutesFromPrev ?? 0,
    dockTimeMinutes: overrides.dockTimeMinutes ?? 30,
  };
}

// ── calculateRouteCost ──────────────────────────────────────────

describe("calculateRouteCost", () => {
  it("calculates a simple two-stop route (perHour)", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "Toronto", type: "pickup", distanceFromPrevKm: 0, driveMinutesFromPrev: 0, dockTimeMinutes: 30 }),
      makeStop({ location: "Montreal", distanceFromPrevKm: 540, driveMinutesFromPrev: 300, dockTimeMinutes: 30 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 1.5, undefined, undefined, "perHour");
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].distanceKm).toBe(540);
    expect(result.legs[0].driveMinutes).toBe(300);
    expect(result.legs[0].isDeadhead).toBe(false);
    expect(result.fullTripCost).toBeGreaterThan(0);
    expect(result.payMode).toBe("perHour");
  });

  it("calculates per-mile pay mode", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "Toronto", type: "pickup", distanceFromPrevKm: 0, driveMinutesFromPrev: 0 }),
      makeStop({ location: "Chicago", distanceFromPrevKm: 800, driveMinutesFromPrev: 480 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 1.5, undefined, undefined, "perMile");
    expect(result.payMode).toBe("perMile");
    // Per-mile driver cost should be based on distance
    const leg = result.legs[0];
    const distMiles = 800 / 1.609344;
    const expectedDriverCost = Math.round(distMiles * 0.55 * 100) / 100;
    expect(leg.driverCost).toBe(expectedDriverCost);
  });

  it("falls back to perHour when perMile rate is 0", () => {
    const noMileProfile = { ...baseProfile, driverPayPerMile: 0 };
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "B", distanceFromPrevKm: 500, driveMinutesFromPrev: 300 }),
    ];
    const result = calculateRouteCost(noMileProfile, stops, false, 1.5, undefined, undefined, "perMile");
    expect(result.payMode).toBe("perHour");
  });

  it("includes deadhead when toggle is on", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "Pickup", type: "pickup" }),
      makeStop({ location: "Delivery", distanceFromPrevKm: 200, driveMinutesFromPrev: 120, dockTimeMinutes: 30 }),
      makeStop({ location: "Yard", type: "yard", distanceFromPrevKm: 50, driveMinutesFromPrev: 40, dockTimeMinutes: 0 }),
    ];
    const withDH = calculateRouteCost(baseProfile, stops, true, 1.5);
    const withoutDH = calculateRouteCost(baseProfile, stops, false, 1.5);
    expect(withDH.legs).toHaveLength(2);
    expect(withoutDH.legs).toHaveLength(1);
    expect(withDH.deadheadCost).toBeGreaterThan(0);
    expect(withoutDH.deadheadCost).toBe(0);
  });

  it("applies deadhead pay percent discount", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "Pickup", type: "pickup" }),
      makeStop({ location: "Delivery", distanceFromPrevKm: 200, driveMinutesFromPrev: 120, dockTimeMinutes: 30 }),
      makeStop({ location: "Yard", type: "yard", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
    ];
    const fullPay = { ...baseProfile, deadheadPayPercent: 100 };
    const reducedPay = { ...baseProfile, deadheadPayPercent: 50 };
    const resFull = calculateRouteCost(fullPay, stops, true, 1.5);
    const resReduced = calculateRouteCost(reducedPay, stops, true, 1.5);
    const fullDHLeg = resFull.legs.find(l => l.isDeadhead)!;
    const reducedDHLeg = resReduced.legs.find(l => l.isDeadhead)!;
    expect(reducedDHLeg.driverCost).toBeLessThan(fullDHLeg.driverCost);
  });

  it("calculates fuel cost based on consumption and price", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "B", distanceFromPrevKm: 100, driveMinutesFromPrev: 60 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 2.0);
    // fuel = 100km * (35/100) * 2.0 = 70
    expect(result.legs[0].fuelCost).toBe(70);
  });

  it("handles multi-leg routes correctly", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "B", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 20 }),
      makeStop({ location: "C", distanceFromPrevKm: 150, driveMinutesFromPrev: 90, dockTimeMinutes: 30 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 1.5);
    expect(result.legs).toHaveLength(2);
    expect(result.totalDistanceKm).toBe(250);
    expect(result.totalDriveMinutes).toBe(150);
    expect(result.totalDockMinutes).toBe(50);
    expect(result.tripCost).toBe(result.fullTripCost); // no deadhead
  });

  it("returns zero costs for zero-distance legs", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "A", distanceFromPrevKm: 0, driveMinutesFromPrev: 0, dockTimeMinutes: 0 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 1.5);
    expect(result.legs[0].legCost).toBe(0);
  });

  it("includes advanced fixed costs in calculation", () => {
    const advancedProfile = {
      ...baseProfile,
      monthlyTrailerLease: 500,
      monthlyEldTelematics: 100,
      monthlyAccountingOffice: 200,
      monthlyTireReserve: 100,
    };
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "B", distanceFromPrevKm: 200, driveMinutesFromPrev: 120, dockTimeMinutes: 30 }),
    ];
    const withAdvanced = calculateRouteCost(advancedProfile, stops, false, 1.5);
    const withoutAdvanced = calculateRouteCost(baseProfile, stops, false, 1.5);
    expect(withAdvanced.fixedCostPerHour).toBeGreaterThan(withoutAdvanced.fixedCostPerHour);
    expect(withAdvanced.fullTripCost).toBeGreaterThan(withoutAdvanced.fullTripCost);
  });

  it("marks local legs correctly (under 100km)", () => {
    const stops: RouteStop[] = [
      makeStop({ location: "A", type: "pickup" }),
      makeStop({ location: "B", distanceFromPrevKm: 50, driveMinutesFromPrev: 30 }),
    ];
    const result = calculateRouteCost(baseProfile, stops, false, 1.5);
    expect(result.legs[0].isLocal).toBe(true);
  });
});

// ── getPricingAdvice ────────────────────────────────────────────

describe("getPricingAdvice", () => {
  it("returns three standard margin tiers (20%, 30%, 40%)", () => {
    const result = getPricingAdvice(1000);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0]).toEqual({ label: "20% Margin", percent: 20, price: 1200, marginAmount: 200 });
    expect(result.tiers[1]).toEqual({ label: "30% Margin", percent: 30, price: 1300, marginAmount: 300 });
    expect(result.tiers[2]).toEqual({ label: "40% Margin", percent: 40, price: 1400, marginAmount: 400 });
  });

  it("returns custom percent when provided", () => {
    const result = getPricingAdvice(1000, 15);
    expect(result.customPercent).toEqual({
      label: "Custom %",
      percent: 15,
      price: 1150,
      marginAmount: 150,
    });
  });

  it("returns null custom percent when not provided", () => {
    const result = getPricingAdvice(1000);
    expect(result.customPercent).toBeNull();
  });

  it("calculates custom quote margin correctly", () => {
    const result = getPricingAdvice(1000, undefined, 1500);
    expect(result.customQuote).toEqual({
      label: "Custom Quote",
      quoteAmount: 1500,
      marginPercent: 50,
      marginAmount: 500,
    });
  });

  it("returns null custom quote when amount is 0", () => {
    const result = getPricingAdvice(1000, undefined, 0);
    expect(result.customQuote).toBeNull();
  });
});
