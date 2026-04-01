# IFTA Per-Route Fuel Tax Estimate — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-03-31
> **Feature:** Per-route IFTA fuel tax breakdown in the route builder cost panel

---

## Problem

Carriers operating across US states and Canadian provinces must pay fuel tax to each jurisdiction based on miles driven there. Currently, carriers have no visibility into per-route fuel tax costs until quarterly IFTA filing. This leads to under-quoting on cross-state routes and surprise tax bills.

## Solution

Add a "Fuel Tax (IFTA)" section inside the existing cost breakdown panel in the route builder. When a route crosses jurisdiction boundaries, show the estimated fuel tax per state/province and total, based on the route polyline, fuel consumption rate, and current IFTA tax rates.

---

## How It Works

### Step 1: Determine Jurisdiction Miles

When the route builder calculates a route, the server already receives the Google Directions response which includes an encoded polyline. We decode this polyline into lat/lng points along the route, then use **reverse geocoding** (point-in-polygon or a lightweight state/province lookup) to determine which jurisdiction each segment falls in and how many miles are in each.

**Implementation:** Use a lightweight coordinate-to-state lookup library (e.g., a GeoJSON boundary file for US states + Canadian provinces with point-in-polygon checks). This avoids API calls for every point — we only need state/province boundaries, not full address resolution.

**Sampling strategy:** Decode the full polyline, then sample every 50th point (roughly every 3-5km depending on route density). For each sample point, determine the jurisdiction via point-in-polygon. When the jurisdiction changes between consecutive samples, record the boundary crossing. Sum the haversine distance between consecutive samples, grouped by jurisdiction.

### Step 2: Look Up Tax Rates

IFTA tax rates are published quarterly by [IFTA, Inc.](https://www.iftach.org/taxmatrix4/) as a matrix. There is **no public REST API** — all trucking tools use a static table updated each quarter.

**Implementation:** Ship a JSON file (`shared/data/ifta-rates.json`) containing:

```json
{
  "quarter": "2Q2026",
  "effectiveDate": "2026-04-01",
  "rates": {
    "AL": { "diesel": 0.29, "surcharge": 0 },
    "AK": null,
    "AZ": { "diesel": 0.26, "surcharge": 0 },
    "AB": { "diesel": 0.13, "surcharge": 0 },
    "BC": { "diesel": 0.2763, "surcharge": 0 },
    "ON": { "diesel": 0.143, "surcharge": 0 },
    "...": "..."
  }
}
```

- Rates are in **$/gallon** (US) or **$/litre** (Canada) — normalize to a common unit during calculation
- Null entries = jurisdiction not in IFTA (Alaska, DC, territories)
- Include `quarter` and `effectiveDate` so the UI can show "Rates as of Q2 2026"
- Special cases: Oregon = $0.00 (uses weight-mile tax instead), Kentucky/Virginia/New York have surcharges

**Update process:** Manually update the JSON file each quarter when IFTA publishes new rates (Jan 1, Apr 1, Jul 1, Oct 1). Show a "last updated" indicator in the UI.

### Step 3: Calculate Tax Per Jurisdiction

For each jurisdiction the route passes through:

```
tax = miles_in_jurisdiction × (fuel_consumption_gallons_per_mile) × tax_rate_per_gallon
```

Where:
- `miles_in_jurisdiction` = from Step 1
- `fuel_consumption_gallons_per_mile` = derived from the cost profile's `fuelConsumptionPer100km` (convert to gal/mile)
- `tax_rate_per_gallon` = from the IFTA rate table

For Canadian provinces (rates in $/litre), convert to $/gallon for the calculation, then display in the user's preferred unit.

### Step 4: Display in Cost Breakdown

Add a collapsible "Fuel Tax (IFTA)" row inside the cost breakdown panel, after the existing fuel cost row.

**Collapsed view:** `Fuel Tax (IFTA)  $47.82` (total across all jurisdictions)

**Expanded view:**
```
Fuel Tax (IFTA)                    $47.82
  ├─ Ontario (ON)     142 mi    $12.30
  ├─ New York (NY)    98 mi     $18.45
  ├─ Pennsylvania (PA) 67 mi    $11.22
  └─ New Jersey (NJ)   34 mi    $5.85
  Rates as of Q2 2026
```

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `shared/data/ifta-rates.json` | Quarterly IFTA tax rate table |
| `client/src/lib/iftaCalc.ts` | IFTA calculation logic (jurisdiction detection + tax math) |
| `client/src/lib/statePolygons.ts` | US state + CA province boundary polygons for point-in-polygon lookup |

### Modified Files

| File | Change |
|------|--------|
| `client/src/pages/route-builder.tsx` | Add IFTA breakdown section to cost breakdown panel |
| `shared/data/` (new dir) | House the IFTA rates JSON |

### Data Flow

```
Route polyline (from Google Directions)
  → Decode to lat/lng points (sample every ~5km)
  → Point-in-polygon lookup → jurisdiction per segment
  → Sum miles per jurisdiction
  → Multiply by fuel consumption × tax rate
  → Display in cost breakdown
```

### Boundary Data

Use a simplified GeoJSON of US state + Canadian province boundaries (~200KB compressed). Only need state/province level, not county. This runs entirely client-side — no API calls needed for jurisdiction detection.

Source: [Natural Earth](https://www.naturalearthdata.com/) admin-1 boundaries, simplified to reduce file size.

---

## Tier Gating

- **Free tier:** IFTA section hidden
- **Pro / Premium:** IFTA section visible in cost breakdown

This is a meaningful upsell — cross-state carriers (the ones who need IFTA) are exactly the users who would pay for Pro.

---

## Edge Cases

1. **Route entirely within one state:** Show single jurisdiction, tax still applies
2. **Route through Oregon:** Show $0.00 with note "Oregon uses weight-mile tax (not IFTA)"
3. **Route through non-IFTA jurisdictions (Alaska, DC):** Omit from calculation, show note if route touches them
4. **Canadian provinces with rates in $/litre:** Convert to user's preferred unit for display
5. **Cross-border US/CA routes:** Show both US and CA jurisdictions with respective rates, totals in user's currency
6. **No polyline available (OSRM fallback):** OSRM also returns a polyline; use the same logic. For haversine fallback (no polyline), hide IFTA section with tooltip "IFTA estimate requires route data"

---

## Testing

Unit tests for `iftaCalc.ts`:
- Single-state route returns correct tax
- Multi-state route splits miles correctly
- Oregon returns $0.00
- Cross-border route handles USD/CAD conversion
- Edge case: zero distance, missing profile fuel consumption
- Polyline sampling produces reasonable jurisdiction splits

---

## Out of Scope

- Full quarterly IFTA filing/reporting
- Fuel purchase tracking
- Net tax owed vs. tax paid at pump reconciliation
- Weight-mile tax calculation (Oregon, New Mexico)
- Real-time rate API (none exists publicly)
