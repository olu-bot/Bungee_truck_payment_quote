import { describe, it, expect } from "vitest";
import {
  resolveMeasurementUnit,
  KM_PER_MILE,
  milesToKm,
  kmToMiles,
  lPer100kmToMpg,
  mpgToLPer100km,
  distanceLabel,
  fuelConsumptionLabel,
  fuelConsumptionSuffix,
  displayDistance,
  displayFuelConsumption,
  inputToLPer100km,
} from "./measurement";

// ── resolveMeasurementUnit ──────────────────────────────────────

describe("resolveMeasurementUnit", () => {
  it("returns metric when explicitly set", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "metric" })).toBe("metric");
  });

  it("returns imperial when explicitly set", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "imperial" })).toBe("imperial");
  });

  it("defaults to imperial for null/undefined/missing", () => {
    expect(resolveMeasurementUnit(null)).toBe("imperial");
    expect(resolveMeasurementUnit(undefined)).toBe("imperial");
    expect(resolveMeasurementUnit({})).toBe("imperial");
    expect(resolveMeasurementUnit({ measurementUnit: "unknown" })).toBe("imperial");
  });
});

// ── Distance conversions ────────────────────────────────────────

describe("distance conversions", () => {
  it("KM_PER_MILE is correct", () => {
    expect(KM_PER_MILE).toBeCloseTo(1.609344, 5);
  });

  it("milesToKm converts correctly", () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 5);
    expect(milesToKm(100)).toBeCloseTo(160.9344, 3);
    expect(milesToKm(0)).toBe(0);
  });

  it("kmToMiles converts correctly", () => {
    expect(kmToMiles(1.609344)).toBeCloseTo(1, 5);
    expect(kmToMiles(100)).toBeCloseTo(62.137, 2);
    expect(kmToMiles(0)).toBe(0);
  });

  it("round-trips accurately", () => {
    const original = 250;
    expect(kmToMiles(milesToKm(original))).toBeCloseTo(original, 5);
    expect(milesToKm(kmToMiles(original))).toBeCloseTo(original, 5);
  });
});

// ── Fuel consumption conversions ────────────────────────────────

describe("fuel consumption conversions", () => {
  it("lPer100kmToMpg converts correctly", () => {
    // 10 L/100km ≈ 23.5 MPG
    expect(lPer100kmToMpg(10)).toBeCloseTo(23.5215, 2);
    // 35 L/100km ≈ 6.72 MPG (heavy truck)
    expect(lPer100kmToMpg(35)).toBeCloseTo(6.72, 1);
  });

  it("handles zero/negative input", () => {
    expect(lPer100kmToMpg(0)).toBe(0);
    expect(lPer100kmToMpg(-5)).toBe(0);
  });

  it("mpgToLPer100km converts correctly", () => {
    expect(mpgToLPer100km(23.5215)).toBeCloseTo(10, 2);
    expect(mpgToLPer100km(0)).toBe(0);
    expect(mpgToLPer100km(-5)).toBe(0);
  });

  it("round-trips accurately", () => {
    const original = 35;
    expect(mpgToLPer100km(lPer100kmToMpg(original))).toBeCloseTo(original, 3);
  });
});

// ── Label helpers ───────────────────────────────────────────────

describe("label helpers", () => {
  it("distanceLabel returns correct unit", () => {
    expect(distanceLabel("imperial")).toBe("mi");
    expect(distanceLabel("metric")).toBe("km");
  });

  it("fuelConsumptionLabel returns correct unit", () => {
    expect(fuelConsumptionLabel("imperial")).toBe("MPG");
    expect(fuelConsumptionLabel("metric")).toBe("L/100km");
  });

  it("fuelConsumptionSuffix returns correct suffix", () => {
    expect(fuelConsumptionSuffix("imperial")).toBe("MPG");
    expect(fuelConsumptionSuffix("metric")).toBe("L");
  });
});

// ── Display conversions ─────────────────────────────────────────

describe("displayDistance", () => {
  it("returns km for metric", () => {
    expect(displayDistance(100, "metric")).toBe(100);
  });

  it("converts km to miles for imperial", () => {
    expect(displayDistance(100, "imperial")).toBeCloseTo(62.137, 2);
  });
});

describe("displayFuelConsumption", () => {
  it("returns L/100km for metric", () => {
    expect(displayFuelConsumption(35, "metric")).toBe(35);
  });

  it("converts to MPG for imperial", () => {
    expect(displayFuelConsumption(35, "imperial")).toBeCloseTo(6.72, 1);
  });
});

describe("inputToLPer100km", () => {
  it("passes through for metric", () => {
    expect(inputToLPer100km(35, "metric")).toBe(35);
  });

  it("converts MPG to L/100km for imperial", () => {
    expect(inputToLPer100km(6.72, "imperial")).toBeCloseTo(35, 0);
  });
});
