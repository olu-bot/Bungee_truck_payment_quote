import { describe, it, expect } from "vitest";
import { calculateRouteCost, getPricingAdvice } from "./routeCalc";
import type { CostProfile, RouteStop } from "@shared/schema";

function makeProfile(overrides: Partial<CostProfile> = {}): CostProfile {
  return {
    id: "p1",
    name: "Test Profile",
    truckType: "dry_van",
    monthlyTruckPayment: 2000,
    monthlyInsurance: 800,
    monthlyMaintenance: 500,
    monthlyPermitsPlates: 200,
    monthlyOther: 100,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: 25,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: 75,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStop(location: string, overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: `stop-${location}`,
    type: "delivery",
    location,
    lat: 0,
    lng: 0,
    ...overrides,
  };
}

describe("calculateRouteCost", () => {
  const profile = makeProfile();
  const fuelPrice = 1.50;

  it("returns empty legs for fewer than 2 stops", () => {
    const result = calculateRouteCost(profile, [makeStop("A")], false, fuelPrice);
    expect(result.legs).toHaveLength(0);
    expect(result.fullTripCost).toBe(0);
  });

  it("calculates a simple 2-stop route (per-hour)", () => {
    const stops: RouteStop[] = [
      makeStop("Origin", { type: "pickup" }),
      makeStop("Dest", { type: "delivery", distanceFromPrevKm: 200, driveMinutesFromPrev: 120, dockTimeMinutes: 30 }),
    ];
    const result = calculateRouteCost(profile, stops, false, fuelPrice);

    expect(result.legs).toHaveLength(1);
    expect(result.totalDistanceKm).toBe(200);
    expect(result.totalDriveMinutes).toBe(120);
    expect(result.totalDockMinutes).toBe(30);
    expect(result.fullTripCost).toBeGreaterThan(0);
    expect(result.legs[0].fixedCost).toBeGreaterThan(0);
    expect(result.legs[0].driverCost).toBeGreaterThan(0);
    expect(result.legs[0].fuelCost).toBeCloseTo(105, 0);
  });

  it("skips deadhead leg when includeDeadhead is false", () => {
    const stops: RouteStop[] = [
      makeStop("Pickup", { type: "pickup" }),
      makeStop("Delivery", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 30 }),
      makeStop("Yard", { type: "yard", distanceFromPrevKm: 50, driveMinutesFromPrev: 30 }),
    ];
    const withoutDH = calculateRouteCost(profile, stops, false, fuelPrice);
    const withDH = calculateRouteCost(profile, stops, true, fuelPrice);

    expect(withoutDH.legs).toHaveLength(1);
    expect(withDH.legs).toHaveLength(2);
    expect(withDH.deadheadCost).toBeGreaterThan(0);
    expect(withoutDH.deadheadCost).toBe(0);
  });

  it("applies deadhead pay percent", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
      makeStop("Y", { type: "yard", distanceFromPrevKm: 100, driveMinutesFromPrev: 60 }),
    ];
    const full = calculateRouteCost(makeProfile({ deadheadPayPercent: 100 }), stops, true, fuelPrice);
    const half = calculateRouteCost(makeProfile({ deadheadPayPercent: 50 }), stops, true, fuelPrice);

    const fullDHDriver = full.legs[1].driverCost;
    const halfDHDriver = half.legs[1].driverCost;
    expect(halfDHDriver).toBeCloseTo(fullDHDriver * 0.5, 1);
  });

  it("uses per-mile driver pay when set", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 160.934, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
    ];
    const result = calculateRouteCost(
      makeProfile({ driverPayPerMile: 0.60 }),
      stops, false, fuelPrice, undefined, undefined, "perMile", "imperial",
    );
    expect(result.legs[0].driverCost).toBeCloseTo(60, 0);
  });

  it("falls back to perHour when perMile requested but rate is 0", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
    ];
    const result = calculateRouteCost(
      makeProfile({ driverPayPerMile: 0 }),
      stops, false, fuelPrice, undefined, undefined, "perMile",
    );
    expect(result.payMode).toBe("perHour");
  });
});

describe("getPricingAdvice", () => {
  it("returns 3 standard tiers at 20%, 30%, 40%", () => {
    const result = getPricingAdvice(1000);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0].price).toBe(1200);
    expect(result.tiers[1].price).toBe(1300);
    expect(result.tiers[2].price).toBe(1400);
  });

  it("calculates custom margin percentage", () => {
    const result = getPricingAdvice(1000, 15);
    expect(result.customPercent).not.toBeNull();
    expect(result.customPercent!.price).toBe(1150);
    expect(result.customPercent!.marginAmount).toBe(150);
  });

  it("calculates custom quote amount with reverse margin", () => {
    const result = getPricingAdvice(1000, undefined, 1250);
    expect(result.customQuote).not.toBeNull();
    expect(result.customQuote!.marginPercent).toBe(25);
    expect(result.customQuote!.marginAmount).toBe(250);
  });

  it("returns null customPercent when margin is 0 or undefined", () => {
    expect(getPricingAdvice(1000).customPercent).toBeNull();
    expect(getPricingAdvice(1000, 0).customPercent).toBeNull();
  });

  it("returns null customQuote when totalCost is 0", () => {
    expect(getPricingAdvice(0, undefined, 500).customQuote).toBeNull();
  });
});
