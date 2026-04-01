import { describe, it, expect } from "vitest";
import {
  resolveMeasurementUnit,
  milesToKm,
  kmToMiles,
  lPer100kmToMpg,
  mpgToLPer100km,
  displayDistance,
  displayFuelConsumption,
  inputToLPer100km,
  distanceLabel,
  fuelConsumptionLabel,
  KM_PER_MILE,
} from "./measurement";

describe("resolveMeasurementUnit", () => {
  it("returns 'imperial' by default", () => {
    expect(resolveMeasurementUnit(null)).toBe("imperial");
    expect(resolveMeasurementUnit(undefined)).toBe("imperial");
    expect(resolveMeasurementUnit({})).toBe("imperial");
  });
  it("returns stored value when valid", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "metric" })).toBe("metric");
    expect(resolveMeasurementUnit({ measurementUnit: "imperial" })).toBe("imperial");
  });
  it("rejects invalid values", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "banana" })).toBe("imperial");
  });
});

describe("distance conversions", () => {
  it("milesToKm converts correctly", () => {
    expect(milesToKm(1)).toBeCloseTo(KM_PER_MILE, 4);
    expect(milesToKm(100)).toBeCloseTo(160.9344, 2);
  });
  it("kmToMiles converts correctly", () => {
    expect(kmToMiles(KM_PER_MILE)).toBeCloseTo(1, 4);
    expect(kmToMiles(100)).toBeCloseTo(62.1371, 2);
  });
  it("round-trips are identity", () => {
    expect(kmToMiles(milesToKm(42))).toBeCloseTo(42, 6);
  });
});

describe("fuel consumption conversions", () => {
  it("converts L/100km to MPG", () => {
    expect(lPer100kmToMpg(10)).toBeCloseTo(23.52, 1);
  });
  it("converts MPG to L/100km", () => {
    expect(mpgToLPer100km(23.52)).toBeCloseTo(10, 0);
  });
  it("handles zero values gracefully", () => {
    expect(lPer100kmToMpg(0)).toBe(0);
    expect(mpgToLPer100km(0)).toBe(0);
  });
  it("round-trips are identity", () => {
    expect(mpgToLPer100km(lPer100kmToMpg(35))).toBeCloseTo(35, 6);
  });
});

describe("display helpers", () => {
  it("displayDistance converts km for imperial", () => {
    expect(displayDistance(100, "imperial")).toBeCloseTo(62.14, 1);
    expect(displayDistance(100, "metric")).toBe(100);
  });
  it("displayFuelConsumption converts for imperial", () => {
    expect(displayFuelConsumption(10, "imperial")).toBeCloseTo(23.52, 1);
    expect(displayFuelConsumption(10, "metric")).toBe(10);
  });
  it("inputToLPer100km converts MPG for imperial", () => {
    expect(inputToLPer100km(23.52, "imperial")).toBeCloseTo(10, 0);
    expect(inputToLPer100km(10, "metric")).toBe(10);
  });
  it("distanceLabel returns correct unit", () => {
    expect(distanceLabel("imperial")).toBe("mi");
    expect(distanceLabel("metric")).toBe("km");
  });
  it("fuelConsumptionLabel returns correct unit", () => {
    expect(fuelConsumptionLabel("imperial")).toBe("MPG");
    expect(fuelConsumptionLabel("metric")).toBe("L/100km");
  });
});
