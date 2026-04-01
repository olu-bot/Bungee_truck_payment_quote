import { describe, it, expect } from "vitest";
import { getJurisdiction, isCanadianProvince, CANADIAN_PROVINCES } from "./jurisdictionLookup";

describe("getJurisdiction", () => {
  // US states - major cities
  it("returns NY for New York City", () => {
    expect(getJurisdiction(40.7128, -74.006)).toBe("NY");
  });

  it("returns CA for Los Angeles", () => {
    expect(getJurisdiction(34.0522, -118.2437)).toBe("CA");
  });

  it("returns TX for Houston", () => {
    expect(getJurisdiction(29.7604, -95.3698)).toBe("TX");
  });

  it("returns IL for Chicago", () => {
    expect(getJurisdiction(41.8781, -87.6298)).toBe("IL");
  });

  it("returns FL for Miami", () => {
    expect(getJurisdiction(25.7617, -80.1918)).toBe("FL");
  });

  it("returns PA for Philadelphia", () => {
    expect(getJurisdiction(39.9526, -75.1652)).toBe("PA");
  });

  it("returns OH for Columbus", () => {
    expect(getJurisdiction(39.9612, -82.9988)).toBe("OH");
  });

  it("returns WA for Seattle", () => {
    expect(getJurisdiction(47.6062, -122.3321)).toBe("WA");
  });

  it("returns GA for Atlanta", () => {
    expect(getJurisdiction(33.749, -84.388)).toBe("GA");
  });

  it("returns MI for Detroit", () => {
    expect(getJurisdiction(42.3314, -83.0458)).toBe("MI");
  });

  // Canadian provinces
  it("returns ON for Toronto", () => {
    expect(getJurisdiction(43.6532, -79.3832)).toBe("ON");
  });

  it("returns QC for Montreal", () => {
    expect(getJurisdiction(45.5017, -73.5673)).toBe("QC");
  });

  it("returns BC for Vancouver", () => {
    expect(getJurisdiction(49.2827, -123.1207)).toBe("BC");
  });

  it("returns AB for Calgary", () => {
    expect(getJurisdiction(51.0447, -114.0719)).toBe("AB");
  });

  it("returns MB for Winnipeg", () => {
    expect(getJurisdiction(49.8951, -97.1384)).toBe("MB");
  });

  it("returns SK for Regina", () => {
    expect(getJurisdiction(50.4452, -104.6189)).toBe("SK");
  });

  // Edge cases
  it("returns OR for Portland (near WA border)", () => {
    expect(getJurisdiction(45.5152, -122.6784)).toBe("OR");
  });

  it("returns NJ for Newark (near NY border)", () => {
    expect(getJurisdiction(40.7357, -74.1724)).toBe("NJ");
  });

  it("returns null for coordinates in Mexico", () => {
    expect(getJurisdiction(19.4326, -99.1332)).toBeNull();
  });

  it("returns null for coordinates in the ocean", () => {
    expect(getJurisdiction(35.0, -50.0)).toBeNull();
  });

  it("returns null for null/undefined inputs", () => {
    expect(getJurisdiction(null as any, null as any)).toBeNull();
    expect(getJurisdiction(undefined as any, undefined as any)).toBeNull();
  });
});

describe("isCanadianProvince", () => {
  it("returns true for Canadian province codes", () => {
    expect(isCanadianProvince("ON")).toBe(true);
    expect(isCanadianProvince("AB")).toBe(true);
    expect(isCanadianProvince("BC")).toBe(true);
  });

  it("returns false for US state codes", () => {
    expect(isCanadianProvince("NY")).toBe(false);
    expect(isCanadianProvince("CA")).toBe(false);
    expect(isCanadianProvince("TX")).toBe(false);
  });
});

describe("CANADIAN_PROVINCES", () => {
  it("contains exactly 10 provinces", () => {
    expect(CANADIAN_PROVINCES.size).toBe(10);
  });
});
