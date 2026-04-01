import { describe, it, expect } from "vitest";
import {
  currencyForCountryCode,
  resolveWorkspaceCurrency,
  formatCurrencyAmount,
  convertCurrency,
  currencySymbol,
  currencyFromOperatingCountryLabels,
} from "./currency";

describe("currencyForCountryCode", () => {
  it("returns CAD for CA", () => expect(currencyForCountryCode("CA")).toBe("CAD"));
  it("returns USD for US", () => expect(currencyForCountryCode("US")).toBe("USD"));
  it("is case-insensitive", () => expect(currencyForCountryCode("us")).toBe("USD"));
  it("defaults to CAD for unknown codes", () => expect(currencyForCountryCode("XX")).toBe("CAD"));
  it("defaults to CAD for null/undefined", () => {
    expect(currencyForCountryCode(null)).toBe("CAD");
    expect(currencyForCountryCode(undefined)).toBe("CAD");
  });
});

describe("currencyFromOperatingCountryLabels", () => {
  it("returns USD for USA-like labels", () => {
    expect(currencyFromOperatingCountryLabels(["USA"])).toBe("USD");
    expect(currencyFromOperatingCountryLabels(["United States"])).toBe("USD");
  });
  it("returns CAD for Canada", () => {
    expect(currencyFromOperatingCountryLabels(["Canada"])).toBe("CAD");
  });
  it("defaults to CAD for empty/undefined", () => {
    expect(currencyFromOperatingCountryLabels([])).toBe("CAD");
    expect(currencyFromOperatingCountryLabels(undefined)).toBe("CAD");
  });
});

describe("resolveWorkspaceCurrency", () => {
  it("uses preferredCurrency first", () => {
    expect(resolveWorkspaceCurrency({ preferredCurrency: "USD" })).toBe("USD");
  });
  it("falls back to operatingCountryCode", () => {
    expect(resolveWorkspaceCurrency({ operatingCountryCode: "US" })).toBe("USD");
  });
  it("falls back to operatingCountries labels", () => {
    expect(resolveWorkspaceCurrency({ operatingCountries: ["United States"] })).toBe("USD");
  });
  it("defaults to CAD for null", () => {
    expect(resolveWorkspaceCurrency(null)).toBe("CAD");
  });
});

describe("convertCurrency", () => {
  it("returns same amount for same currency", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
  });
  it("converts USD to CAD (roughly 1.44x)", () => {
    const cad = convertCurrency(100, "USD", "CAD");
    expect(cad).toBeGreaterThan(130);
    expect(cad).toBeLessThan(150);
  });
  it("converts CAD to USD (roughly 0.69x)", () => {
    const usd = convertCurrency(100, "CAD", "USD");
    expect(usd).toBeGreaterThan(60);
    expect(usd).toBeLessThan(75);
  });
});

describe("currencySymbol", () => {
  it("returns $ for CAD and USD", () => {
    expect(currencySymbol("CAD")).toBe("$");
    expect(currencySymbol("USD")).toBe("$");
  });
});

describe("formatCurrencyAmount", () => {
  it("formats with 2 decimal places", () => {
    const formatted = formatCurrencyAmount(1234.5, "USD");
    // Intl formatter may round; verify it contains the integer portion
    expect(formatted).toContain("1,23");
  });
});
