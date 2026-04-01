import { describe, it, expect } from "vitest";
import {
  calculateIFTA,
  type IFTAResult,
  type IFTAJurisdictionBreakdown,
} from "./iftaCalc";
import type { RouteStop } from "@shared/schema";

function makeStop(overrides: Partial<RouteStop> & { id: string; location: string }): RouteStop {
  return {
    type: "pickup",
    lat: null,
    lng: null,
    dockTimeMinutes: 30,
    distanceFromPrevKm: 0,
    driveMinutesFromPrev: 0,
    ...overrides,
  };
}

describe("calculateIFTA", () => {
  const defaultFuelConsumptionPer100km = 35; // 35 L/100km typical for trucks

  it("returns a valid result for a single-state route (TX)", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
      makeStop({ id: "2", location: "Dallas, TX", type: "delivery", lat: 32.7767, lng: -96.797, distanceFromPrevKm: 386 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);

    expect(result).not.toBeNull();
    expect(result!.jurisdictions).toHaveLength(1);
    expect(result!.jurisdictions[0].code).toBe("TX");
    expect(result!.jurisdictions[0].distanceKm).toBeCloseTo(386, 0);
    expect(result!.totalTaxUSD).toBeGreaterThan(0);
    expect(result!.quarter).toBe("2Q2026");
  });

  it("returns a multi-state breakdown for a NY-PA-NJ route", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "New York, NY", type: "pickup", lat: 40.7128, lng: -74.006 }),
      makeStop({ id: "2", location: "Philadelphia, PA", type: "delivery", lat: 39.9526, lng: -75.1652, distanceFromPrevKm: 160 }),
      makeStop({ id: "3", location: "Newark, NJ", type: "delivery", lat: 40.7357, lng: -74.1724, distanceFromPrevKm: 130 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);

    expect(result).not.toBeNull();
    // Leg 1 (NYC->Philly): origin is NY, so 160 km allocated to NY
    // Leg 2 (Philly->Newark): origin is PA, so 130 km allocated to PA
    expect(result!.jurisdictions).toHaveLength(2);

    const ny = result!.jurisdictions.find(j => j.code === "NY");
    const pa = result!.jurisdictions.find(j => j.code === "PA");
    expect(ny).toBeDefined();
    expect(pa).toBeDefined();
    expect(ny!.distanceKm).toBeCloseTo(160, 0);
    expect(pa!.distanceKm).toBeCloseTo(130, 0);
    expect(result!.totalTaxUSD).toBeGreaterThan(0);
  });

  it("returns $0 tax for Oregon (weight-mile tax state)", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Portland, OR", type: "pickup", lat: 45.5152, lng: -122.6784 }),
      makeStop({ id: "2", location: "Eugene, OR", type: "delivery", lat: 44.0521, lng: -123.0868, distanceFromPrevKm: 180 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);

    expect(result).not.toBeNull();
    expect(result!.jurisdictions).toHaveLength(1);
    expect(result!.jurisdictions[0].code).toBe("OR");
    expect(result!.jurisdictions[0].taxUSD).toBeCloseTo(0, 2);
    expect(result!.jurisdictions[0].note).toContain("weight-mile");
    expect(result!.totalTaxUSD).toBeCloseTo(0, 2);
  });

  it("handles a cross-border US/CA route (Toronto ON to Buffalo NY)", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Toronto, ON", type: "pickup", lat: 43.6532, lng: -79.3832 }),
      makeStop({ id: "2", location: "Buffalo, NY", type: "delivery", lat: 42.8864, lng: -78.8784, distanceFromPrevKm: 160 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);

    expect(result).not.toBeNull();
    // Leg origin is ON (Canadian), distance allocated to ON
    expect(result!.jurisdictions).toHaveLength(1);
    const on = result!.jurisdictions.find(j => j.code === "ON");
    expect(on).toBeDefined();
    // Canadian rate is in CAD/litre, should be converted to USD for totalTaxUSD
    expect(on!.taxUSD).toBeGreaterThan(0);
  });

  it("returns null when stops have no lat/lng", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: null, lng: null }),
      makeStop({ id: "2", location: "Dallas, TX", type: "delivery", lat: null, lng: null, distanceFromPrevKm: 386 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);
    expect(result).toBeNull();
  });

  it("returns null when there are fewer than 2 stops", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);
    expect(result).toBeNull();
  });

  it("returns null when fuel consumption is zero or negative", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
      makeStop({ id: "2", location: "Dallas, TX", type: "delivery", lat: 32.7767, lng: -96.797, distanceFromPrevKm: 386 }),
    ];

    expect(calculateIFTA(stops, 0)).toBeNull();
    expect(calculateIFTA(stops, -5)).toBeNull();
  });

  it("skips legs with zero distance", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
      makeStop({ id: "2", location: "Houston Warehouse, TX", type: "delivery", lat: 29.77, lng: -95.37, distanceFromPrevKm: 0 }),
      makeStop({ id: "3", location: "Dallas, TX", type: "delivery", lat: 32.7767, lng: -96.797, distanceFromPrevKm: 386 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);
    expect(result).not.toBeNull();
    // Only one jurisdiction entry (TX) with 386 km total, the 0-distance leg is skipped
    expect(result!.jurisdictions).toHaveLength(1);
    expect(result!.jurisdictions[0].distanceKm).toBeCloseTo(386, 0);
  });

  it("handles a stop whose jurisdiction cannot be determined", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
      makeStop({ id: "2", location: "Offshore Platform", type: "delivery", lat: 28.0, lng: -90.0, distanceFromPrevKm: 200 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);
    // Origin is TX, so 200 km allocated to TX regardless
    expect(result).not.toBeNull();
    expect(result!.jurisdictions).toHaveLength(1);
    expect(result!.jurisdictions[0].code).toBe("TX");
  });

  it("aggregates multiple legs in the same jurisdiction", () => {
    const stops: RouteStop[] = [
      makeStop({ id: "1", location: "Houston, TX", type: "pickup", lat: 29.7604, lng: -95.3698 }),
      makeStop({ id: "2", location: "Austin, TX", type: "delivery", lat: 30.2672, lng: -97.7431, distanceFromPrevKm: 260 }),
      makeStop({ id: "3", location: "Dallas, TX", type: "delivery", lat: 32.7767, lng: -96.797, distanceFromPrevKm: 310 }),
    ];

    const result = calculateIFTA(stops, defaultFuelConsumptionPer100km);
    expect(result).not.toBeNull();
    expect(result!.jurisdictions).toHaveLength(1);
    expect(result!.jurisdictions[0].code).toBe("TX");
    expect(result!.jurisdictions[0].distanceKm).toBeCloseTo(570, 0);
  });
});
