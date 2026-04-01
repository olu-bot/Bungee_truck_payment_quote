import { describe, it, expect } from "vitest";
import {
  currencySymbol,
  currencyForCountryCode,
  currencyFromOperatingCountryLabels,
  resolveWorkspaceCurrency,
  formatCurrencyAmount,
  convertCurrency,
  convertCostProfileCurrency,
  localizeMoneySuffix,
  currencyPerLitreLabel,
} from "./currency";

// ── currencySymbol ──────────────────────────────────────────────

describe("currencySymbol", () => {
  it("returns $ for both CAD and USD", () => {
    expect(currencySymbol("CAD")).toBe("$");
    expect(currencySymbol("USD")).toBe("$");
  });
});

// ── currencyForCountryCode ──────────────────────────────────────

describe("currencyForCountryCode", () => {
  it("maps CA to CAD and US to USD", () => {
    expect(currencyForCountryCode("CA")).toBe("CAD");
    expect(currencyForCountryCode("US")).toBe("USD");
  });

  it("is case-insensitive", () => {
    expect(currencyForCountryCode("ca")).toBe("CAD");
    expect(currencyForCountryCode("us")).toBe("USD");
  });

  it("defaults to CAD for unknown or missing codes", () => {
    expect(currencyForCountryCode("MX")).toBe("CAD");
    expect(currencyForCountryCode(null)).toBe("CAD");
    expect(currencyForCountryCode(undefined)).toBe("CAD");
  });
});

// ── currencyFromOperatingCountryLabels ──────────────────────────

describe("currencyFromOperatingCountryLabels", () => {
  it("detects USD from USA label", () => {
    expect(currencyFromOperatingCountryLabels(["USA"])).toBe("USD");
    expect(currencyFromOperatingCountryLabels(["United States"])).toBe("USD");
  });

  it("detects CAD from Canada label", () => {
    expect(currencyFromOperatingCountryLabels(["Canada"])).toBe("CAD");
  });

  it("defaults to CAD for empty or missing", () => {
    expect(currencyFromOperatingCountryLabels([])).toBe("CAD");
    expect(currencyFromOperatingCountryLabels(undefined)).toBe("CAD");
  });
});

// ── resolveWorkspaceCurrency ────────────────────────────────────

describe("resolveWorkspaceCurrency", () => {
  it("prefers preferredCurrency when valid", () => {
    expect(resolveWorkspaceCurrency({ preferredCurrency: "USD" })).toBe("USD");
    expect(resolveWorkspaceCurrency({ preferredCurrency: "CAD" })).toBe("CAD");
  });

  it("ignores invalid preferredCurrency", () => {
    expect(resolveWorkspaceCurrency({ preferredCurrency: "EUR", operatingCountryCode: "US" })).toBe("USD");
  });

  it("falls back to operatingCountryCode", () => {
    expect(resolveWorkspaceCurrency({ operatingCountryCode: "US" })).toBe("USD");
    expect(resolveWorkspaceCurrency({ operatingCountryCode: "CA" })).toBe("CAD");
  });

  it("falls back to operatingCountries labels", () => {
    expect(resolveWorkspaceCurrency({ operatingCountries: ["USA"] })).toBe("USD");
  });

  it("defaults to CAD for null/undefined", () => {
    expect(resolveWorkspaceCurrency(null)).toBe("CAD");
    expect(resolveWorkspaceCurrency(undefined)).toBe("CAD");
    expect(resolveWorkspaceCurrency({})).toBe("CAD");
  });
});

// ── formatCurrencyAmount ────────────────────────────────────────

describe("formatCurrencyAmount", () => {
  it("formats USD amounts with $ symbol", () => {
    const result = formatCurrencyAmount(1500, "USD");
    expect(result).toContain("$");
    expect(result).toContain("1,500") ;
  });

  it("formats CAD amounts with $ symbol", () => {
    const result = formatCurrencyAmount(2500, "CAD");
    expect(result).toContain("$");
    expect(result).toContain("2,500");
  });

  it("handles zero", () => {
    const result = formatCurrencyAmount(0, "USD");
    expect(result).toContain("$");
    expect(result).toContain("0");
  });
});

// ── convertCurrency ─────────────────────────────────────────────

describe("convertCurrency", () => {
  it("same currency returns same amount", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(100, "CAD", "CAD")).toBe(100);
  });

  it("converts USD to CAD (should be higher number)", () => {
    const result = convertCurrency(100, "USD", "CAD");
    expect(result).toBeGreaterThan(100);
  });

  it("converts CAD to USD (should be lower number)", () => {
    const result = convertCurrency(100, "CAD", "USD");
    expect(result).toBeLessThan(100);
  });

  it("round-trips approximately", () => {
    const original = 1000;
    const converted = convertCurrency(original, "USD", "CAD");
    const roundTrip = convertCurrency(converted, "CAD", "USD");
    expect(roundTrip).toBeCloseTo(original, 2);
  });
});

// ── convertCostProfileCurrency ──────────────────────────────────

describe("convertCostProfileCurrency", () => {
  it("converts monetary fields but not non-monetary ones", () => {
    const profile = {
      monthlyTruckPayment: 1000,
      monthlyInsurance: 500,
      driverPayPerHour: 25,
      workingDaysPerMonth: 22,
      workingHoursPerDay: 10,
      fuelConsumptionPer100km: 35,
    };
    const converted = convertCostProfileCurrency(profile, "USD", "CAD");
    expect(converted.monthlyTruckPayment).toBeGreaterThan(1000);
    expect(converted.monthlyInsurance).toBeGreaterThan(500);
    expect(converted.driverPayPerHour).toBeGreaterThan(25);
    // Non-monetary fields unchanged
    expect(converted.workingDaysPerMonth).toBe(22);
    expect(converted.workingHoursPerDay).toBe(10);
    expect(converted.fuelConsumptionPer100km).toBe(35);
  });

  it("returns same profile when currencies match", () => {
    const profile = { monthlyTruckPayment: 1000 };
    const result = convertCostProfileCurrency(profile, "CAD", "CAD");
    expect(result.monthlyTruckPayment).toBe(1000);
  });
});

// ── localizeMoneySuffix ─────────────────────────────────────────

describe("localizeMoneySuffix", () => {
  it("maps $ suffix to currency symbol", () => {
    expect(localizeMoneySuffix("$", "USD")).toBe("$");
    expect(localizeMoneySuffix("$/hr", "CAD")).toBe("$/hr");
    expect(localizeMoneySuffix("$/L", "USD")).toBe("$/L");
    expect(localizeMoneySuffix("$/mi", "CAD")).toBe("$/mi");
  });

  it("returns undefined for undefined input", () => {
    expect(localizeMoneySuffix(undefined, "USD")).toBeUndefined();
  });

  it("passes through unknown suffixes", () => {
    expect(localizeMoneySuffix("units", "USD")).toBe("units");
  });
});

// ── currencyPerLitreLabel ───────────────────────────────────────

describe("currencyPerLitreLabel", () => {
  it("returns $/L format", () => {
    expect(currencyPerLitreLabel("USD")).toBe("$/L");
    expect(currencyPerLitreLabel("CAD")).toBe("$/L");
  });
});
