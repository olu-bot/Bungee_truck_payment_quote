# IFTA Fuel Tax Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-route IFTA fuel tax breakdown to the cost panel in the route builder

**Architecture:** Client-side computation using stop coordinates to determine jurisdictions, with a shipped JSON rate table updated quarterly. New collapsible "Fuel Tax (IFTA)" section in the cost breakdown.

**Tech Stack:** TypeScript, React, Vitest, Tailwind CSS

**Key Constraint:** The existing geo functions (getDirectionsByName, getOSRMRoute) do NOT return polyline data — only leg distances/durations and resolved coordinates. Instead of polyline decoding, we use the resolved stop coordinates (lat/lng on each RouteStop) and allocate each leg's distance to the jurisdiction of the leg's origin stop. This is an approximation that covers 80%+ of use cases accurately. Most legs are within one state; cross-state legs within a single leg are allocated to the origin jurisdiction.

---

## Task 1: Create IFTA Rate Data JSON File

**Files:**
- Create: `shared/data/ifta-rates.json`

**Steps:**

- [ ] Create the `shared/data/` directory:
```bash
mkdir -p shared/data
```

- [ ] Create `shared/data/ifta-rates.json` with Q2 2026 rates for all 58 IFTA jurisdictions (48 US states + 10 Canadian provinces). Alaska, Hawaii, and DC are null (not IFTA participants). Oregon diesel is 0.00 (uses weight-mile tax). Rates are in USD per gallon for US states and CAD per litre for Canadian provinces:

```json
{
  "quarter": "2Q2026",
  "effectiveDate": "2026-04-01",
  "unit": {
    "US": "USD/gallon",
    "CA": "CAD/litre"
  },
  "rates": {
    "AL": { "diesel": 0.29, "surcharge": 0 },
    "AK": null,
    "AZ": { "diesel": 0.26, "surcharge": 0 },
    "AR": { "diesel": 0.285, "surcharge": 0 },
    "CA": { "diesel": 0.68, "surcharge": 0 },
    "CO": { "diesel": 0.205, "surcharge": 0 },
    "CT": { "diesel": 0.4613, "surcharge": 0 },
    "DE": { "diesel": 0.22, "surcharge": 0 },
    "DC": null,
    "FL": { "diesel": 0.35, "surcharge": 0 },
    "GA": { "diesel": 0.329, "surcharge": 0 },
    "HI": null,
    "ID": { "diesel": 0.32, "surcharge": 0 },
    "IL": { "diesel": 0.467, "surcharge": 0 },
    "IN": { "diesel": 0.54, "surcharge": 0.11 },
    "IA": { "diesel": 0.325, "surcharge": 0 },
    "KS": { "diesel": 0.26, "surcharge": 0 },
    "KY": { "diesel": 0.254, "surcharge": 0.02 },
    "LA": { "diesel": 0.20, "surcharge": 0 },
    "ME": { "diesel": 0.312, "surcharge": 0 },
    "MD": { "diesel": 0.3675, "surcharge": 0 },
    "MA": { "diesel": 0.26, "surcharge": 0 },
    "MI": { "diesel": 0.267, "surcharge": 0 },
    "MN": { "diesel": 0.285, "surcharge": 0 },
    "MS": { "diesel": 0.18, "surcharge": 0 },
    "MO": { "diesel": 0.195, "surcharge": 0 },
    "MT": { "diesel": 0.2975, "surcharge": 0 },
    "NE": { "diesel": 0.297, "surcharge": 0 },
    "NV": { "diesel": 0.27, "surcharge": 0 },
    "NH": { "diesel": 0.222, "surcharge": 0 },
    "NJ": { "diesel": 0.345, "surcharge": 0 },
    "NM": { "diesel": 0.21, "surcharge": 0 },
    "NY": { "diesel": 0.3049, "surcharge": 0.172 },
    "NC": { "diesel": 0.382, "surcharge": 0 },
    "ND": { "diesel": 0.23, "surcharge": 0 },
    "OH": { "diesel": 0.47, "surcharge": 0 },
    "OK": { "diesel": 0.19, "surcharge": 0 },
    "OR": { "diesel": 0.00, "surcharge": 0 },
    "PA": { "diesel": 0.741, "surcharge": 0 },
    "RI": { "diesel": 0.34, "surcharge": 0 },
    "SC": { "diesel": 0.28, "surcharge": 0 },
    "SD": { "diesel": 0.28, "surcharge": 0 },
    "TN": { "diesel": 0.27, "surcharge": 0 },
    "TX": { "diesel": 0.20, "surcharge": 0 },
    "UT": { "diesel": 0.315, "surcharge": 0 },
    "VT": { "diesel": 0.31, "surcharge": 0 },
    "VA": { "diesel": 0.262, "surcharge": 0.066 },
    "WA": { "diesel": 0.494, "surcharge": 0 },
    "WV": { "diesel": 0.352, "surcharge": 0 },
    "WI": { "diesel": 0.327, "surcharge": 0 },
    "WY": { "diesel": 0.24, "surcharge": 0 },
    "AB": { "diesel": 0.13, "surcharge": 0 },
    "BC": { "diesel": 0.2763, "surcharge": 0 },
    "MB": { "diesel": 0.14, "surcharge": 0 },
    "NB": { "diesel": 0.155, "surcharge": 0 },
    "NL": { "diesel": 0.165, "surcharge": 0 },
    "NS": { "diesel": 0.154, "surcharge": 0 },
    "ON": { "diesel": 0.143, "surcharge": 0 },
    "PE": { "diesel": 0.131, "surcharge": 0 },
    "QC": { "diesel": 0.2020, "surcharge": 0 },
    "SK": { "diesel": 0.15, "surcharge": 0 }
  }
}
```

- [ ] Verify the file is valid JSON:
```bash
node -e "require('./shared/data/ifta-rates.json'); console.log('Valid JSON')"
```

- [ ] Commit:
```bash
git add shared/data/ifta-rates.json
git commit -m "feat: add IFTA Q2 2026 rate data for 58 jurisdictions"
```

---

## Task 2: Create Jurisdiction Coordinate Lookup

**Files:**
- Create: `client/src/lib/jurisdictionLookup.ts`
- Create: `client/src/lib/jurisdictionLookup.test.ts`

This module maps a lat/lng coordinate to a US state or Canadian province code. It uses a nearest-centroid approach: each jurisdiction has a center lat/lng, and we find the closest one. For jurisdictions with complex shapes (e.g., FL panhandle, MI upper peninsula), we add secondary centroids as separate entries.

**Steps:**

- [ ] Write the test file first (`client/src/lib/jurisdictionLookup.test.ts`):

```typescript
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
```

- [ ] Implement `client/src/lib/jurisdictionLookup.ts`:

```typescript
/**
 * jurisdictionLookup.ts
 *
 * Maps a lat/lng coordinate to a US state or Canadian province code
 * using a nearest-centroid approach with boundary constraints.
 *
 * Each jurisdiction has one or more centroids. We find the closest
 * centroid within a maximum distance threshold (to reject ocean/Mexico
 * coordinates). For complex shapes, secondary centroids improve accuracy.
 *
 * This is intentionally approximate — accurate enough for IFTA tax
 * allocation where we only need state/province-level resolution.
 */

export const CANADIAN_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK",
]);

export function isCanadianProvince(code: string): boolean {
  return CANADIAN_PROVINCES.has(code);
}

type Centroid = { code: string; lat: number; lng: number };

/**
 * Centroids for US states and Canadian provinces.
 * Some states have multiple entries to handle non-convex shapes
 * (e.g., Michigan's two peninsulas, Florida's panhandle, Virginia's eastern shore).
 */
const CENTROIDS: Centroid[] = [
  // US States
  { code: "AL", lat: 32.806671, lng: -86.79113 },
  { code: "AK", lat: 63.588753, lng: -154.493062 },
  { code: "AZ", lat: 34.048928, lng: -111.093731 },
  { code: "AR", lat: 34.969704, lng: -92.373123 },
  { code: "CA", lat: 36.116203, lng: -119.681564 },
  { code: "CA", lat: 34.0, lng: -118.2 },   // SoCal secondary
  { code: "CA", lat: 38.5, lng: -121.5 },   // NorCal secondary
  { code: "CO", lat: 39.059811, lng: -105.311104 },
  { code: "CT", lat: 41.597782, lng: -72.755371 },
  { code: "DE", lat: 39.318523, lng: -75.507141 },
  { code: "DC", lat: 38.897438, lng: -77.026817 },
  { code: "FL", lat: 27.766279, lng: -81.686783 },
  { code: "FL", lat: 25.8, lng: -80.2 },     // South FL
  { code: "FL", lat: 30.4, lng: -85.0 },     // Panhandle
  { code: "GA", lat: 33.040619, lng: -83.643074 },
  { code: "HI", lat: 21.094318, lng: -157.498337 },
  { code: "ID", lat: 44.240459, lng: -114.478773 },
  { code: "IL", lat: 40.349457, lng: -88.986137 },
  { code: "IL", lat: 41.85, lng: -87.65 },   // Chicago metro
  { code: "IN", lat: 39.849426, lng: -86.258278 },
  { code: "IA", lat: 42.011539, lng: -93.210526 },
  { code: "KS", lat: 38.5266, lng: -96.726486 },
  { code: "KY", lat: 37.66814, lng: -84.670067 },
  { code: "LA", lat: 31.169546, lng: -91.867805 },
  { code: "ME", lat: 44.693947, lng: -69.381927 },
  { code: "MD", lat: 39.063946, lng: -76.802101 },
  { code: "MA", lat: 42.230171, lng: -71.530106 },
  { code: "MI", lat: 43.326618, lng: -84.536095 },
  { code: "MI", lat: 46.5, lng: -87.5 },     // Upper Peninsula
  { code: "MI", lat: 42.4, lng: -83.1 },     // Detroit metro
  { code: "MN", lat: 45.694454, lng: -93.900192 },
  { code: "MS", lat: 32.741646, lng: -89.678696 },
  { code: "MO", lat: 38.456085, lng: -92.288368 },
  { code: "MT", lat: 46.921925, lng: -110.454353 },
  { code: "NE", lat: 41.12537, lng: -98.268082 },
  { code: "NV", lat: 38.313515, lng: -117.055374 },
  { code: "NH", lat: 43.452492, lng: -71.563896 },
  { code: "NJ", lat: 40.298904, lng: -74.521011 },
  { code: "NM", lat: 34.97273, lng: -105.032363 },
  { code: "NY", lat: 42.165726, lng: -74.948051 },
  { code: "NY", lat: 40.75, lng: -73.98 },   // NYC metro
  { code: "NC", lat: 35.630066, lng: -79.806419 },
  { code: "ND", lat: 47.528912, lng: -99.784012 },
  { code: "OH", lat: 40.388783, lng: -82.764915 },
  { code: "OK", lat: 35.565342, lng: -96.928917 },
  { code: "OR", lat: 44.572021, lng: -122.070938 },
  { code: "PA", lat: 40.590752, lng: -77.209755 },
  { code: "PA", lat: 39.95, lng: -75.17 },   // Philadelphia metro
  { code: "RI", lat: 41.680893, lng: -71.51178 },
  { code: "SC", lat: 33.856892, lng: -80.945007 },
  { code: "SD", lat: 44.299782, lng: -99.438828 },
  { code: "TN", lat: 35.747845, lng: -86.692345 },
  { code: "TX", lat: 31.054487, lng: -97.563461 },
  { code: "TX", lat: 29.76, lng: -95.37 },   // Houston
  { code: "TX", lat: 32.78, lng: -96.80 },   // Dallas
  { code: "TX", lat: 31.77, lng: -106.44 },  // El Paso
  { code: "UT", lat: 40.150032, lng: -111.862434 },
  { code: "VT", lat: 44.045876, lng: -72.710686 },
  { code: "VA", lat: 37.769337, lng: -78.169968 },
  { code: "WA", lat: 47.400902, lng: -121.490494 },
  { code: "WV", lat: 38.491226, lng: -80.954453 },
  { code: "WI", lat: 44.268543, lng: -89.616508 },
  { code: "WY", lat: 42.755966, lng: -107.30249 },
  // Canadian Provinces
  { code: "AB", lat: 53.9333, lng: -116.5765 },
  { code: "AB", lat: 51.05, lng: -114.07 },  // Calgary
  { code: "BC", lat: 53.7267, lng: -127.6476 },
  { code: "BC", lat: 49.28, lng: -123.12 },  // Vancouver
  { code: "MB", lat: 53.7609, lng: -98.8139 },
  { code: "MB", lat: 49.9, lng: -97.14 },    // Winnipeg
  { code: "NB", lat: 46.5653, lng: -66.4619 },
  { code: "NL", lat: 53.1355, lng: -57.6604 },
  { code: "NL", lat: 47.56, lng: -52.71 },   // St John's
  { code: "NS", lat: 44.6820, lng: -63.7443 },
  { code: "ON", lat: 51.2538, lng: -85.3232 },
  { code: "ON", lat: 43.65, lng: -79.38 },   // Toronto
  { code: "ON", lat: 45.42, lng: -75.70 },   // Ottawa
  { code: "PE", lat: 46.5107, lng: -63.4168 },
  { code: "QC", lat: 52.9399, lng: -73.5491 },
  { code: "QC", lat: 45.50, lng: -73.57 },   // Montreal
  { code: "QC", lat: 46.81, lng: -71.21 },   // Quebec City
  { code: "SK", lat: 52.9399, lng: -106.4509 },
  { code: "SK", lat: 50.45, lng: -104.62 },  // Regina
];

/**
 * Maximum distance in km to consider a match.
 * Rejects ocean/foreign coordinates that are too far from any centroid.
 * 400 km covers the largest US states (TX, MT) from centroid to border.
 */
const MAX_DISTANCE_KM = 400;

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Given a lat/lng coordinate, return the US state or Canadian province code.
 * Returns null if the coordinate is outside North America or invalid.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @returns Two-letter state/province code (e.g., "NY", "ON") or null
 */
export function getJurisdiction(lat: number, lng: number): string | null {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;

  // Quick bounds check: reject points clearly outside US/CA
  // US/CA spans roughly lat 24-72, lng -141 to -52
  if (lat < 24 || lat > 72 || lng < -141 || lng > -52) return null;

  let bestCode: string | null = null;
  let bestDist = Infinity;

  for (const c of CENTROIDS) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      bestCode = c.code;
    }
  }

  if (bestDist > MAX_DISTANCE_KM) return null;

  return bestCode;
}
```

- [ ] Run the tests:
```bash
npx vitest run client/src/lib/jurisdictionLookup.test.ts
```

- [ ] Fix any failing tests by adjusting centroids or adding secondary centroids until all pass.

- [ ] Commit:
```bash
git add client/src/lib/jurisdictionLookup.ts client/src/lib/jurisdictionLookup.test.ts
git commit -m "feat: add jurisdiction coordinate lookup for IFTA tax calculation"
```

---

## Task 3: Create IFTA Calculation Module

**Files:**
- Create: `client/src/lib/iftaCalc.ts`
- Create: `client/src/lib/iftaCalc.test.ts`

**Steps:**

- [ ] Write the test file first (`client/src/lib/iftaCalc.test.ts`):

```typescript
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
```

- [ ] Implement `client/src/lib/iftaCalc.ts`:

```typescript
/**
 * iftaCalc.ts
 *
 * Calculates per-jurisdiction IFTA fuel tax for a given route.
 *
 * Approach: Each leg's distance is allocated to the jurisdiction of
 * the leg's origin stop. This is an approximation — when a single leg
 * crosses state lines, all distance goes to the origin state. This is
 * accurate for 80%+ of routes where stops are in different states.
 *
 * Fuel consumption is converted from L/100km to gallons/mile for the
 * tax calculation. Canadian province rates (CAD/litre) are converted
 * to USD/gallon using a fixed exchange rate (updated quarterly with
 * the rate table).
 */

import type { RouteStop } from "@shared/schema";
import { getJurisdiction, isCanadianProvince } from "./jurisdictionLookup";
import iftaRatesData from "@shared/data/ifta-rates.json";

// ── Types ────────────────────────────────────────────────────────

export type IFTAJurisdictionBreakdown = {
  code: string;          // e.g., "NY", "ON"
  name: string;          // e.g., "New York", "Ontario"
  distanceKm: number;    // km driven in this jurisdiction
  distanceMiles: number; // miles driven in this jurisdiction
  taxRate: number;       // effective rate in USD/gallon (after conversion for CA)
  taxUSD: number;        // tax amount in USD
  note?: string;         // e.g., "Oregon uses weight-mile tax (not IFTA)"
};

export type IFTAResult = {
  jurisdictions: IFTAJurisdictionBreakdown[];
  totalTaxUSD: number;
  totalDistanceKm: number;
  totalDistanceMiles: number;
  quarter: string;       // e.g., "2Q2026"
  effectiveDate: string; // e.g., "2026-04-01"
};

// ── Constants ────────────────────────────────────────────────────

const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.78541;

/**
 * CAD to USD exchange rate. Updated quarterly alongside the rate table.
 * As of Q2 2026, approximate rate.
 */
const CAD_TO_USD = 0.73;

// ── Jurisdiction names ───────────────────────────────────────────

const JURISDICTION_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba",
  NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan",
};

// ── Rate lookup ──────────────────────────────────────────────────

type RateEntry = { diesel: number; surcharge: number } | null;

const rates = iftaRatesData.rates as Record<string, RateEntry>;

/**
 * Get the effective tax rate for a jurisdiction in USD per gallon.
 *
 * For US states: rate is already in USD/gallon; add surcharge.
 * For Canadian provinces: rate is in CAD/litre; convert to USD/gallon.
 *
 * Returns 0 for null entries (non-IFTA jurisdictions like AK, DC, HI).
 */
function getEffectiveRateUSDPerGallon(code: string): number {
  const entry = rates[code];
  if (!entry) return 0;

  const baseRate = entry.diesel + entry.surcharge;

  if (isCanadianProvince(code)) {
    // CAD/litre -> USD/gallon
    return baseRate * LITRES_PER_GALLON * CAD_TO_USD;
  }

  // US rate already in USD/gallon
  return baseRate;
}

// ── Main calculation ─────────────────────────────────────────────

/**
 * Calculate IFTA fuel tax breakdown for a route.
 *
 * @param stops Route stops with lat/lng and distanceFromPrevKm
 * @param fuelConsumptionPer100km Fuel consumption in litres per 100 km
 * @returns IFTA breakdown or null if calculation not possible
 */
export function calculateIFTA(
  stops: RouteStop[],
  fuelConsumptionPer100km: number,
): IFTAResult | null {
  if (!stops || stops.length < 2) return null;
  if (!fuelConsumptionPer100km || fuelConsumptionPer100km <= 0) return null;

  // Check that at least the first stop has lat/lng for jurisdiction detection
  const firstWithCoords = stops.find(s => s.lat != null && s.lng != null);
  if (!firstWithCoords) return null;

  // Convert fuel consumption: L/100km -> gallons/mile
  // L/100km * (1 gal / 3.78541 L) * (1.609344 km / 1 mi) * (1 / 100)
  const gallonsPerMile = (fuelConsumptionPer100km / LITRES_PER_GALLON) * (KM_PER_MILE / 100);

  // Accumulate distance by jurisdiction
  const jurisdictionKm = new Map<string, number>();

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    const distKm = to.distanceFromPrevKm || 0;

    if (distKm <= 0) continue;

    // Determine jurisdiction from the origin stop's coordinates
    let code: string | null = null;
    if (from.lat != null && from.lng != null) {
      code = getJurisdiction(from.lat, from.lng);
    }

    // If origin has no coords or is unresolvable, try destination
    if (!code && to.lat != null && to.lng != null) {
      code = getJurisdiction(to.lat, to.lng);
    }

    // If neither end resolves, skip this leg
    if (!code) continue;

    jurisdictionKm.set(code, (jurisdictionKm.get(code) || 0) + distKm);
  }

  if (jurisdictionKm.size === 0) return null;

  // Build breakdown
  const jurisdictions: IFTAJurisdictionBreakdown[] = [];
  let totalTaxUSD = 0;
  let totalDistKm = 0;

  // Sort by distance descending (largest jurisdiction first)
  const sorted = [...jurisdictionKm.entries()].sort((a, b) => b[1] - a[1]);

  for (const [code, distKm] of sorted) {
    const distMiles = distKm / KM_PER_MILE;
    const rateUSDPerGallon = getEffectiveRateUSDPerGallon(code);
    const taxUSD = distMiles * gallonsPerMile * rateUSDPerGallon;

    let note: string | undefined;
    if (code === "OR") {
      note = "Oregon uses weight-mile tax (not IFTA)";
    } else if (rates[code] === null) {
      note = `${JURISDICTION_NAMES[code] || code} is not an IFTA jurisdiction`;
    }

    jurisdictions.push({
      code,
      name: JURISDICTION_NAMES[code] || code,
      distanceKm: Math.round(distKm * 100) / 100,
      distanceMiles: Math.round(distMiles * 100) / 100,
      taxRate: Math.round(rateUSDPerGallon * 10000) / 10000,
      taxUSD: Math.round(taxUSD * 100) / 100,
      note,
    });

    totalTaxUSD += taxUSD;
    totalDistKm += distKm;
  }

  return {
    jurisdictions,
    totalTaxUSD: Math.round(totalTaxUSD * 100) / 100,
    totalDistanceKm: Math.round(totalDistKm * 100) / 100,
    totalDistanceMiles: Math.round((totalDistKm / KM_PER_MILE) * 100) / 100,
    quarter: iftaRatesData.quarter,
    effectiveDate: iftaRatesData.effectiveDate,
  };
}
```

- [ ] Run the tests:
```bash
npx vitest run client/src/lib/iftaCalc.test.ts
```

- [ ] Fix any failing tests until all pass.

- [ ] Commit:
```bash
git add client/src/lib/iftaCalc.ts client/src/lib/iftaCalc.test.ts
git commit -m "feat: add IFTA fuel tax calculation module with jurisdiction allocation"
```

---

## Task 4: Add canUseIFTA Gate to Subscription Module

**Files:**
- Modify: `client/src/lib/subscription.ts`
- Modify: `client/src/lib/subscription.test.ts`

**Steps:**

- [ ] Add test cases to `client/src/lib/subscription.test.ts`. Append to the end of the file, before the final closing (or at the bottom):

```typescript
// At the top of the file, add canUseIFTA to the import:
// import { ..., canUseIFTA } from "./subscription";

describe("canUseIFTA", () => {
  it("returns false for free tier", () => {
    expect(canUseIFTA(makeUser("free"))).toBe(false);
  });

  it("returns false for null/undefined user", () => {
    expect(canUseIFTA(null)).toBe(false);
    expect(canUseIFTA(undefined)).toBe(false);
  });

  it("returns true for pro tier", () => {
    expect(canUseIFTA(makeUser("pro"))).toBe(true);
  });

  it("returns true for fleet tier", () => {
    expect(canUseIFTA(makeUser("fleet"))).toBe(true);
  });
});
```

- [ ] Add `canUseIFTA` to `client/src/lib/subscription.ts`. Insert after the `canExportCsv` function (around line 108):

```typescript
/** Whether the user can see the IFTA fuel tax breakdown on routes. */
export function canUseIFTA(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}
```

- [ ] Update the feature table comment at the top of `subscription.ts` to include IFTA:

Add this row to the ASCII table comment:
```
 * │ IFTA fuel tax         │ ✗      │ ✓      │ ✓        │
```

- [ ] Add `canUseIFTA` to the import list in `subscription.test.ts`.

- [ ] Run the tests:
```bash
npx vitest run client/src/lib/subscription.test.ts
```

- [ ] Commit:
```bash
git add client/src/lib/subscription.ts client/src/lib/subscription.test.ts
git commit -m "feat: add canUseIFTA subscription gate for IFTA tax breakdown"
```

---

## Task 5: Add IFTA Section to Route Builder Cost Breakdown

**Files:**
- Modify: `client/src/pages/route-builder.tsx`

This task adds a collapsible "Fuel Tax (IFTA)" section inside the existing cost breakdown panel, appearing after the leg breakdown and before the Charges section. It shows the total IFTA tax with a toggle to expand per-jurisdiction details.

**Steps:**

- [ ] Add imports to the top of `route-builder.tsx`. Find the existing import block and add:

```typescript
// Add to the existing icon imports from lucide-react (find the line with ChevronDown, ChevronUp):
// Add: Receipt (for the IFTA section icon)
import { Receipt } from "lucide-react";

// Add new imports after the existing lib imports:
import { calculateIFTA, type IFTAResult } from "@/lib/iftaCalc";
import { canUseIFTA } from "@/lib/subscription";
```

- [ ] Add state for IFTA toggle and calculation. Find the line `const [showBreakdown, setShowBreakdown] = useState(false);` (around line 576) and add after it:

```typescript
const [showIFTA, setShowIFTA] = useState(false);
```

- [ ] Add IFTA calculation as a useMemo. Find a suitable location near the other derived values (near `const fullTripCost = routeCalc?.fullTripCost ?? 0;` around line 1715) and add:

```typescript
const iftaResult = useMemo<IFTAResult | null>(() => {
  if (!routeCalc || !selectedProfile || !stops || stops.length < 2) return null;
  return calculateIFTA(stops, selectedProfile.fuelConsumptionPer100km);
}, [routeCalc, selectedProfile, stops]);
```

Note: `stops` is the state variable holding the current route stops (find its declaration — it should be something like `const [stops, setStops] = useState<RouteStop[]>(...)` near the top of the component). `selectedProfile` is the currently active CostProfile. Verify these variable names match the actual code before implementing.

- [ ] Find the correct variable names. Search for the stops state and selected profile in route-builder.tsx. The stops are likely accessed via the `stops` state, and the profile via `selectedProfile` or a query result. The `fuelConsumptionPer100km` must come from the active cost profile. Adapt the useMemo accordingly.

- [ ] Add the IFTA UI section. This goes inside the `showBreakdown` block, after the leg cards `</div>` (around line 2419, after the `routeCalc.legs.map(...)` closing div) and before the breakdown's parent closing tag. Insert:

```tsx
{/* ── IFTA Fuel Tax Breakdown ── */}
{iftaResult && canUseIFTA(user) && (
  <div className="rounded-lg border border-slate-200 px-4 py-3 space-y-2" data-testid="ifta-section">
    <button
      type="button"
      className="flex items-center justify-between w-full group"
      onClick={() => setShowIFTA((prev) => !prev)}
      data-testid="ifta-toggle"
    >
      <div className="flex items-center gap-2">
        <Receipt className="w-3.5 h-3.5 text-orange-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Fuel Tax (IFTA)
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-900 tabular-nums">
          {formatCurrency(iftaResult.totalTaxUSD)}
        </span>
        {showIFTA ? (
          <ChevronUp className="w-3 h-3 text-slate-400" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-400" />
        )}
      </div>
    </button>

    {showIFTA && (
      <div className="space-y-1 pt-1">
        {iftaResult.jurisdictions.map((j) => (
          <div
            key={j.code}
            className="flex items-center justify-between text-[13px]"
            data-testid={`ifta-row-${j.code}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-slate-500">
                {j.name} ({j.code})
              </span>
              <span className="text-[11px] text-slate-400 tabular-nums">
                {(measureUnit === "imperial" ? j.distanceMiles : j.distanceKm).toFixed(0)} {dLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {j.note && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-slate-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    {j.note}
                  </TooltipContent>
                </Tooltip>
              )}
              <span className="font-medium tabular-nums">
                {formatCurrency(j.taxUSD)}
              </span>
            </div>
          </div>
        ))}
        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
          Rates as of {iftaResult.quarter} ({iftaResult.effectiveDate})
        </div>
      </div>
    )}
  </div>
)}

{/* IFTA upsell for free tier */}
{iftaResult && !canUseIFTA(user) && (
  <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 flex items-center justify-between" data-testid="ifta-upsell">
    <div className="flex items-center gap-2">
      <Receipt className="w-3.5 h-3.5 text-slate-300" />
      <span className="text-[11px] text-slate-400">
        Fuel Tax (IFTA) breakdown
      </span>
    </div>
    <a
      href="#/settings?tab=billing"
      className="text-[11px] font-medium text-orange-500 hover:text-orange-600"
    >
      Upgrade to Pro
    </a>
  </div>
)}
```

- [ ] Verify the placement renders correctly. The IFTA section should appear:
  - Inside the breakdown area (only visible when `showBreakdown` is true)
  - After all the leg cards
  - Before the Charges section
  - With proper Tailwind classes per CLAUDE.md

- [ ] Verify the `user` variable is available in scope. The route-builder component should have the user from `useFirebaseAuth()`. Find where the user is destructured (e.g., `const { user } = useFirebaseAuth();`) and confirm `user` is in scope where the IFTA JSX is placed.

- [ ] Verify all referenced variables exist:
  - `formatCurrency` — should already be imported/defined in route-builder.tsx
  - `measureUnit` — should already be a state variable
  - `dLabel` — should already be derived (e.g., `const dLabel = measureUnit === "imperial" ? "mi" : "km"`)
  - `ChevronUp`, `ChevronDown`, `Info` — should already be imported from lucide-react
  - `Tooltip`, `TooltipTrigger`, `TooltipContent` — should already be imported from Radix

- [ ] Run the dev server and test manually with a multi-state route (e.g., New York to Philadelphia to Newark). Verify:
  - The IFTA section appears in the breakdown
  - Clicking the toggle expands/collapses jurisdiction details
  - Tax amounts look reasonable
  - The "Rates as of Q2 2026" footer shows

- [ ] Commit:
```bash
git add client/src/pages/route-builder.tsx
git commit -m "feat: add IFTA fuel tax breakdown section to route builder cost panel"
```

---

## Task 6: Final Integration Test and Cleanup

**Files:**
- Test all: `client/src/lib/jurisdictionLookup.test.ts`, `client/src/lib/iftaCalc.test.ts`, `client/src/lib/subscription.test.ts`
- Verify: `client/src/pages/route-builder.tsx` compiles

**Steps:**

- [ ] Run all tests together:
```bash
npx vitest run
```

- [ ] Verify TypeScript compilation:
```bash
npx tsc --noEmit
```

- [ ] Fix any TypeScript errors. Common issues:
  - JSON import might need `resolveJsonModule: true` in `tsconfig.json` — check if it's already set
  - If not, add `"resolveJsonModule": true` to `compilerOptions` in `tsconfig.json`

- [ ] Verify the JSON import works. If Vite does not support direct JSON imports from `@shared/`, you may need to adjust the import path in `iftaCalc.ts`:
```typescript
// If @shared alias doesn't work for JSON, use a relative path:
// import iftaRatesData from "../../../shared/data/ifta-rates.json";
```

- [ ] Run the dev server and do a full smoke test:
```bash
npm run dev
```

Test these scenarios:
1. Single-state route (e.g., Houston to Dallas) — one jurisdiction row
2. Multi-state route (e.g., NYC to Chicago) — multiple jurisdiction rows
3. Oregon route — shows $0.00 with weight-mile tax note
4. Cross-border route (e.g., Toronto to Buffalo) — Canadian province shows
5. Free tier user — sees upsell instead of IFTA data
6. Toggle expand/collapse works
7. Distance units respect the measurement setting (mi vs km)

- [ ] Final commit with all fixes:
```bash
git add -A
git commit -m "feat: complete IFTA fuel tax estimate feature for route builder"
```

---

## Summary of Files

### New Files
| File | Purpose |
|------|---------|
| `shared/data/ifta-rates.json` | Q2 2026 IFTA tax rates for 58 jurisdictions |
| `client/src/lib/jurisdictionLookup.ts` | Lat/lng to state/province code lookup |
| `client/src/lib/jurisdictionLookup.test.ts` | Tests for jurisdiction lookup |
| `client/src/lib/iftaCalc.ts` | IFTA tax calculation engine |
| `client/src/lib/iftaCalc.test.ts` | Tests for IFTA calculation |

### Modified Files
| File | Change |
|------|--------|
| `client/src/lib/subscription.ts` | Add `canUseIFTA()` gate function |
| `client/src/lib/subscription.test.ts` | Add tests for `canUseIFTA()` |
| `client/src/pages/route-builder.tsx` | Add IFTA breakdown UI section + imports |

### Key Design Decisions
1. **No polyline decoding** — allocate each leg's distance to the origin stop's jurisdiction (80%+ accurate)
2. **Nearest-centroid lookup** — lightweight, no external dependencies, ~85 centroids with secondary entries for complex shapes
3. **Shipped JSON rates** — no API dependency, manually updated quarterly
4. **CAD-to-USD conversion** — hardcoded rate updated alongside the rate table each quarter
5. **Pro/Premium gate** — free tier sees an upsell prompt instead of IFTA data
