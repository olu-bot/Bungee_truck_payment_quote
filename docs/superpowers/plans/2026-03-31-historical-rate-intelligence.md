# Historical Rate Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lane-level insights to the route builder and a company-wide analytics dashboard

**Architecture:** Client-side computation from existing Firestore quotes data. New laneIntelligence.ts module for lane matching and stats. New Analytics page with Dashboard tab (Recharts) and Quote History tab (existing component).

**Tech Stack:** TypeScript, React, Recharts, Vitest, Tailwind CSS

---

## Task 1: Create `laneIntelligence.ts` with `normalizeCity()`, `computeLaneStats()`, `matchLane()` -- with full tests

### 1a. Create `client/src/lib/laneIntelligence.ts`

- [ ] Create file at `client/src/lib/laneIntelligence.ts`

```typescript
/**
 * laneIntelligence.ts
 *
 * Client-side lane matching and historical stats computation.
 * Groups existing Firestore quotes by normalized origin/destination city
 * and produces per-lane KPIs (win rate, avg price, margins, etc.).
 *
 * Data source: the Quote[] array already fetched by React Query
 * with key ["firebase", "quotes", scopeId]. No new API calls needed.
 */

import type { Quote } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────

export type LaneStats = {
  laneKey: string;              // "toronto->montreal" (always alphabetically ordered for dedup)
  displayOrigin: string;        // Original city casing for display: "Toronto"
  displayDestination: string;   // "Montreal"
  totalQuotes: number;
  wonQuotes: number;
  lostQuotes: number;
  pendingQuotes: number;
  winRate: number;              // 0-1 (only considers won+lost, ignores pending)
  avgWinningPrice: number;      // Average customerPrice on won quotes
  avgLosingTarget: number;      // Average lostTargetPrice from lost quotes
  avgMarginPercent: number;     // Average profitMarginPercent on won quotes
  lastWinningPrice: number;     // customerPrice of the most recent won quote
  lastQuotedAt: string;         // ISO date string of most recent quote
  totalRevenue: number;         // Sum of customerPrice on won quotes
};

// ── Province / state suffix normalization ───────────────────────────

/**
 * Map of province/state abbreviations and full names that should be
 * stripped during normalization so "Toronto, ON" matches "Toronto, Ontario"
 * and plain "Toronto".
 */
const PROVINCE_STATE_SUFFIXES = new Set([
  // Canadian provinces
  "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt",
  "alberta", "british columbia", "manitoba", "new brunswick",
  "newfoundland and labrador", "nova scotia", "northwest territories",
  "nunavut", "ontario", "prince edward island", "quebec", "saskatchewan", "yukon",
  // US states (abbreviated — full list)
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
  // Common full state names
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming",
]);

// ── City extraction & normalization ────────────────────────────────

/**
 * Extract just the city name from an address like "123 Main St, Toronto, ON M5V 2T6".
 * Uses the same comma-splitting approach as extractCityFromAddress() in route-builder.tsx
 * but returns only the city token, stripped of province/state and postal code.
 */
export function extractCity(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return address.trim();
  if (parts.length === 1) return parts[0];

  // Walk from the second segment (skip street-level detail)
  // and return the first segment that looks like a city name
  // (not a postal code, not a province abbreviation alone)
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i].trim();
    // Skip pure postal codes (e.g. "M5V 2T6", "90210")
    if (/^\w\d\w\s?\d\w\d$/i.test(segment)) continue; // Canadian postal
    if (/^\d{5}(-\d{4})?$/.test(segment)) continue;    // US zip

    // If this segment is just a province/state code, skip it
    if (PROVINCE_STATE_SUFFIXES.has(segment.toLowerCase())) continue;

    // This is likely the city — return it (strip trailing province/state if attached)
    return segment;
  }

  // Fallback: return second part (index 1), which is typically the city
  return parts[1];
}

/**
 * Normalize a city name for matching purposes.
 * - Lowercase
 * - Trim whitespace
 * - Remove trailing province/state suffixes ("Toronto, ON" -> "toronto")
 * - Remove postal/zip codes
 * - Collapse multiple spaces
 */
export function normalizeCity(raw: string): string {
  let city = raw.toLowerCase().trim();

  // Remove postal codes embedded in the string
  city = city.replace(/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/gi, "").trim(); // Canadian
  city = city.replace(/\b\d{5}(-\d{4})?\b/g, "").trim();            // US zip

  // Split on comma — take only the first meaningful token
  const commaTokens = city.split(",").map((t) => t.trim()).filter(Boolean);
  if (commaTokens.length > 1) {
    // Check if last token is a province/state suffix — if so, drop it
    const last = commaTokens[commaTokens.length - 1];
    if (PROVINCE_STATE_SUFFIXES.has(last)) {
      commaTokens.pop();
    }
    city = commaTokens[0]; // Use just the city name
  }

  // Collapse spaces
  city = city.replace(/\s+/g, " ").trim();

  return city;
}

/**
 * Build a canonical lane key from two city strings.
 * Reversed lanes are treated as the same lane (A->B === B->A)
 * by sorting the two cities alphabetically.
 */
export function laneKey(originCity: string, destCity: string): string {
  const a = normalizeCity(originCity);
  const b = normalizeCity(destCity);
  // Sort alphabetically so direction doesn't matter
  return a < b ? `${a}->${b}` : `${b}->${a}`;
}

// ── Stats computation ──────────────────────────────────────────────

/**
 * Group an array of quotes by normalized lane and compute stats for each.
 * Returns a Map keyed by canonical lane key.
 *
 * @param quotes - The full Quote[] from Firestore
 * @param convertToWorkspaceCurrency - Optional function to normalize amounts
 *   to workspace currency before aggregation. If omitted, raw values are used.
 */
export function computeLaneStats(
  quotes: Quote[],
  convertToWorkspaceCurrency?: (amount: number, quoteCurrency?: string) => number,
): Map<string, LaneStats> {
  const map = new Map<string, LaneStats>();

  // Intermediate accumulator for computing averages
  type Accumulator = {
    displayOrigin: string;
    displayDestination: string;
    totalQuotes: number;
    wonQuotes: number;
    lostQuotes: number;
    pendingQuotes: number;
    winningPriceSum: number;
    losingTargetSum: number;
    losingTargetCount: number;
    marginPercentSum: number;
    lastWinningPrice: number;
    lastWinDate: string;
    lastQuotedAt: string;
    totalRevenue: number;
  };

  const accumulators = new Map<string, Accumulator>();

  for (const q of quotes) {
    const originCity = extractCity(q.origin);
    const destCity = extractCity(q.destination);
    const key = laneKey(originCity, destCity);

    if (!accumulators.has(key)) {
      accumulators.set(key, {
        displayOrigin: originCity,
        displayDestination: destCity,
        totalQuotes: 0,
        wonQuotes: 0,
        lostQuotes: 0,
        pendingQuotes: 0,
        winningPriceSum: 0,
        losingTargetSum: 0,
        losingTargetCount: 0,
        marginPercentSum: 0,
        lastWinningPrice: 0,
        lastWinDate: "",
        lastQuotedAt: "",
        totalRevenue: 0,
      });
    }

    const acc = accumulators.get(key)!;
    const price = convertToWorkspaceCurrency
      ? convertToWorkspaceCurrency(q.customerPrice)
      : q.customerPrice;
    const status = q.status ?? "pending";

    acc.totalQuotes++;

    // Track the most recent quote date
    if (!acc.lastQuotedAt || q.createdAt > acc.lastQuotedAt) {
      acc.lastQuotedAt = q.createdAt;
    }

    if (status === "won") {
      acc.wonQuotes++;
      acc.winningPriceSum += price;
      acc.totalRevenue += price;
      acc.marginPercentSum += q.profitMarginPercent;

      // Track last winning price (by date)
      if (!acc.lastWinDate || q.createdAt > acc.lastWinDate) {
        acc.lastWinDate = q.createdAt;
        acc.lastWinningPrice = price;
      }
    } else if (status === "lost") {
      acc.lostQuotes++;
      if (q.lostTargetPrice != null && q.lostTargetPrice > 0) {
        const target = convertToWorkspaceCurrency
          ? convertToWorkspaceCurrency(q.lostTargetPrice)
          : q.lostTargetPrice;
        acc.losingTargetSum += target;
        acc.losingTargetCount++;
      }
    } else {
      acc.pendingQuotes++;
    }
  }

  // Convert accumulators to LaneStats
  for (const [key, acc] of accumulators) {
    const decidedQuotes = acc.wonQuotes + acc.lostQuotes;
    const winRate = decidedQuotes > 0 ? acc.wonQuotes / decidedQuotes : 0;
    const avgWinningPrice = acc.wonQuotes > 0 ? acc.winningPriceSum / acc.wonQuotes : 0;
    const avgLosingTarget = acc.losingTargetCount > 0
      ? acc.losingTargetSum / acc.losingTargetCount
      : 0;
    const avgMarginPercent = acc.wonQuotes > 0 ? acc.marginPercentSum / acc.wonQuotes : 0;

    map.set(key, {
      laneKey: key,
      displayOrigin: acc.displayOrigin,
      displayDestination: acc.displayDestination,
      totalQuotes: acc.totalQuotes,
      wonQuotes: acc.wonQuotes,
      lostQuotes: acc.lostQuotes,
      pendingQuotes: acc.pendingQuotes,
      winRate,
      avgWinningPrice,
      avgLosingTarget,
      avgMarginPercent,
      lastWinningPrice: acc.lastWinningPrice,
      lastQuotedAt: acc.lastQuotedAt,
      totalRevenue: acc.totalRevenue,
    });
  }

  return map;
}

/**
 * Look up lane stats for a given origin/destination pair.
 * Returns null if no matching lane exists in the stats map.
 */
export function matchLane(
  origin: string,
  destination: string,
  statsMap: Map<string, LaneStats>,
): LaneStats | null {
  const originCity = extractCity(origin);
  const destCity = extractCity(destination);
  const key = laneKey(originCity, destCity);
  return statsMap.get(key) ?? null;
}

// ── Aggregate helpers (for Dashboard KPI cards) ────────────────────

export type DashboardKPIs = {
  totalQuotes: number;
  quotesThisMonth: number;
  wonQuotes: number;
  lostQuotes: number;
  pendingQuotes: number;
  winRate: number;              // 0-1
  winRateLastMonth: number;     // 0-1 (for trend comparison)
  avgMarginPercent: number;     // on won quotes
  totalRevenue: number;         // sum of customerPrice on won quotes
};

/**
 * Compute dashboard-level KPIs from a quote array, filtered to a date range.
 *
 * @param quotes - Full quote array
 * @param fromDate - ISO date string for range start (inclusive)
 * @param toDate - ISO date string for range end (inclusive)
 */
export function computeDashboardKPIs(
  quotes: Quote[],
  fromDate?: string,
  toDate?: string,
): DashboardKPIs {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  // Filter to date range
  const filtered = quotes.filter((q) => {
    if (fromDate && q.createdAt < fromDate) return false;
    if (toDate && q.createdAt > toDate) return false;
    return true;
  });

  const thisMonth = filtered.filter((q) => q.createdAt >= currentMonthStart);
  const lastMonth = quotes.filter(
    (q) => q.createdAt >= lastMonthStart && q.createdAt <= lastMonthEnd,
  );

  let wonQuotes = 0;
  let lostQuotes = 0;
  let pendingQuotes = 0;
  let marginSum = 0;
  let revenueSum = 0;

  for (const q of filtered) {
    const status = q.status ?? "pending";
    if (status === "won") {
      wonQuotes++;
      marginSum += q.profitMarginPercent;
      revenueSum += q.customerPrice;
    } else if (status === "lost") {
      lostQuotes++;
    } else {
      pendingQuotes++;
    }
  }

  const decidedQuotes = wonQuotes + lostQuotes;
  const winRate = decidedQuotes > 0 ? wonQuotes / decidedQuotes : 0;

  // Last month win rate for trend
  const lastMonthWon = lastMonth.filter((q) => q.status === "won").length;
  const lastMonthDecided = lastMonth.filter(
    (q) => q.status === "won" || q.status === "lost",
  ).length;
  const winRateLastMonth = lastMonthDecided > 0 ? lastMonthWon / lastMonthDecided : 0;

  return {
    totalQuotes: filtered.length,
    quotesThisMonth: thisMonth.length,
    wonQuotes,
    lostQuotes,
    pendingQuotes,
    winRate,
    winRateLastMonth,
    avgMarginPercent: wonQuotes > 0 ? marginSum / wonQuotes : 0,
    totalRevenue: revenueSum,
  };
}

// ── Monthly revenue series (for bar chart) ─────────────────────────

export type MonthlyRevenue = {
  month: string;     // "2026-01", "2026-02", etc.
  label: string;     // "Jan 2026", "Feb 2026", etc.
  revenue: number;
  quoteCount: number;
};

/**
 * Build a monthly revenue series from won quotes within a date range.
 */
export function computeMonthlyRevenue(
  quotes: Quote[],
  fromDate?: string,
  toDate?: string,
): MonthlyRevenue[] {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const buckets = new Map<string, { revenue: number; count: number }>();

  for (const q of quotes) {
    if (q.status !== "won") continue;
    if (fromDate && q.createdAt < fromDate) continue;
    if (toDate && q.createdAt > toDate) continue;

    const d = new Date(q.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const existing = buckets.get(key) ?? { revenue: 0, count: 0 };
    existing.revenue += q.customerPrice;
    existing.count++;
    buckets.set(key, existing);
  }

  // Sort by month key and produce series
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, data]) => {
      const [year, monthStr] = key.split("-");
      const monthIdx = parseInt(monthStr, 10) - 1;
      return {
        month: key,
        label: `${MONTH_NAMES[monthIdx]} ${year}`,
        revenue: data.revenue,
        quoteCount: data.count,
      };
    });
}

// ── Win/Loss breakdown (for donut chart) ───────────────────────────

export type StatusBreakdown = {
  status: string;   // "Won" | "Lost" | "Pending"
  count: number;
  percent: number;  // 0-100
};

export function computeStatusBreakdown(
  quotes: Quote[],
  fromDate?: string,
  toDate?: string,
): StatusBreakdown[] {
  const filtered = quotes.filter((q) => {
    if (fromDate && q.createdAt < fromDate) return false;
    if (toDate && q.createdAt > toDate) return false;
    return true;
  });

  let won = 0, lost = 0, pending = 0;
  for (const q of filtered) {
    const status = q.status ?? "pending";
    if (status === "won") won++;
    else if (status === "lost") lost++;
    else pending++;
  }

  const total = filtered.length || 1; // avoid division by zero
  return [
    { status: "Won", count: won, percent: (won / total) * 100 },
    { status: "Lost", count: lost, percent: (lost / total) * 100 },
    { status: "Pending", count: pending, percent: (pending / total) * 100 },
  ];
}

// ── Top lanes (for table) ──────────────────────────────────────────

export type TopLane = {
  displayOrigin: string;
  displayDestination: string;
  totalQuotes: number;
  winRate: number;
  avgPrice: number;
  revenue: number;
};

/**
 * Return the top N lanes by quote count from the lane stats map.
 * Optionally sort by a different field.
 */
export function getTopLanes(
  statsMap: Map<string, LaneStats>,
  limit: number = 10,
  sortBy: "totalQuotes" | "winRate" | "totalRevenue" = "totalQuotes",
): TopLane[] {
  return Array.from(statsMap.values())
    .sort((a, b) => {
      if (sortBy === "winRate") return b.winRate - a.winRate;
      if (sortBy === "totalRevenue") return b.totalRevenue - a.totalRevenue;
      return b.totalQuotes - a.totalQuotes;
    })
    .slice(0, limit)
    .map((s) => ({
      displayOrigin: s.displayOrigin,
      displayDestination: s.displayDestination,
      totalQuotes: s.totalQuotes,
      winRate: s.winRate,
      avgPrice: s.avgWinningPrice,
      revenue: s.totalRevenue,
    }));
}

// ── Date range helpers ─────────────────────────────────────────────

export type DateRangePreset = "30d" | "90d" | "12m" | "all";

export function getDateRangeBounds(preset: DateRangePreset): { from?: string; to?: string } {
  if (preset === "all") return {};
  const now = new Date();
  let from: Date;
  if (preset === "30d") {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (preset === "90d") {
    from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else {
    // 12m
    from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
  return { from: from.toISOString(), to: now.toISOString() };
}
```

### 1b. Create `client/src/lib/laneIntelligence.test.ts`

- [ ] Create test file at `client/src/lib/laneIntelligence.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  extractCity,
  normalizeCity,
  laneKey,
  computeLaneStats,
  matchLane,
  computeDashboardKPIs,
  computeMonthlyRevenue,
  computeStatusBreakdown,
  getTopLanes,
  getDateRangeBounds,
} from "./laneIntelligence";
import type { Quote } from "@shared/schema";

// ── Test helpers ───────────────────────────────────────────────────

function makeQuote(overrides: Partial<Quote> & { origin: string; destination: string }): Quote {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    quoteNumber: "Q-001",
    createdAt: new Date().toISOString(),
    origin: overrides.origin,
    destination: overrides.destination,
    truckType: "Dry Van",
    distance: 300,
    pricingMode: "route_builder",
    carrierCost: 1000,
    fuelSurcharge: 200,
    totalCarrierCost: 1200,
    marginType: "percentage",
    marginValue: 20,
    marginAmount: 300,
    customerPrice: 3000,
    grossProfit: 300,
    profitMarginPercent: 25,
    status: "pending",
    ...overrides,
  };
}

// ── extractCity ────────────────────────────────────────────────────

describe("extractCity", () => {
  it("extracts city from full address with street, city, province, postal", () => {
    expect(extractCity("123 Industrial Rd, Toronto, ON, M5V 2T6")).toBe("Toronto");
  });

  it("extracts city from 'City, Province' format", () => {
    expect(extractCity("Montreal, QC")).toBe("Montreal");
  });

  it("extracts city from 'City, State' format (US)", () => {
    expect(extractCity("Seattle, WA")).toBe("Seattle");
  });

  it("returns plain city name when no commas", () => {
    expect(extractCity("Toronto")).toBe("Toronto");
  });

  it("handles city with full province name", () => {
    expect(extractCity("Calgary, Alberta")).toBe("Calgary");
  });

  it("handles multi-word city names", () => {
    expect(extractCity("100 Main St, New York, NY, 10001")).toBe("New York");
  });
});

// ── normalizeCity ──────────────────────────────────────────────────

describe("normalizeCity", () => {
  it("lowercases and trims", () => {
    expect(normalizeCity("  Toronto  ")).toBe("toronto");
  });

  it("strips province abbreviation after comma", () => {
    expect(normalizeCity("Toronto, ON")).toBe("toronto");
  });

  it("strips full province name after comma", () => {
    expect(normalizeCity("Toronto, Ontario")).toBe("toronto");
  });

  it("strips Canadian postal code", () => {
    expect(normalizeCity("Toronto, ON M5V 2T6")).toBe("toronto");
  });

  it("strips US zip code", () => {
    expect(normalizeCity("Seattle, WA 98101")).toBe("seattle");
  });

  it("handles plain city", () => {
    expect(normalizeCity("Calgary")).toBe("calgary");
  });
});

// ── laneKey ────────────────────────────────────────────────────────

describe("laneKey", () => {
  it("produces same key regardless of direction", () => {
    const forward = laneKey("Toronto", "Montreal");
    const reversed = laneKey("Montreal", "Toronto");
    expect(forward).toBe(reversed);
  });

  it("normalizes before keying", () => {
    const a = laneKey("Toronto, ON", "Montreal, QC");
    const b = laneKey("toronto", "montreal");
    expect(a).toBe(b);
  });

  it("sorts alphabetically", () => {
    const key = laneKey("Toronto", "Calgary");
    expect(key).toBe("calgary->toronto");
  });
});

// ── computeLaneStats ───────────────────────────────────────────────

describe("computeLaneStats", () => {
  it("returns empty map for empty quotes array", () => {
    const result = computeLaneStats([]);
    expect(result.size).toBe(0);
  });

  it("groups quotes by normalized lane", () => {
    const quotes = [
      makeQuote({ origin: "Toronto, ON", destination: "Montreal, QC", status: "won", customerPrice: 3000 }),
      makeQuote({ origin: "Toronto, Ontario", destination: "Montreal, Quebec", status: "won", customerPrice: 3200 }),
      makeQuote({ origin: "Calgary, AB", destination: "Edmonton, AB", status: "pending", customerPrice: 1200 }),
    ];
    const map = computeLaneStats(quotes);
    expect(map.size).toBe(2); // Two distinct lanes
  });

  it("treats reversed routes as same lane", () => {
    const quotes = [
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3000 }),
      makeQuote({ origin: "Montreal", destination: "Toronto", status: "lost", customerPrice: 2800, lostTargetPrice: 2600 }),
    ];
    const map = computeLaneStats(quotes);
    expect(map.size).toBe(1);
    const lane = Array.from(map.values())[0];
    expect(lane.totalQuotes).toBe(2);
    expect(lane.wonQuotes).toBe(1);
    expect(lane.lostQuotes).toBe(1);
  });

  it("computes win rate correctly (ignoring pending)", () => {
    const quotes = [
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3000 }),
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3200 }),
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "lost", customerPrice: 2800, lostTargetPrice: 2500 }),
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "pending", customerPrice: 3100 }),
    ];
    const map = computeLaneStats(quotes);
    const lane = Array.from(map.values())[0];
    expect(lane.totalQuotes).toBe(4);
    expect(lane.winRate).toBeCloseTo(2 / 3); // 2 won / 3 decided
    expect(lane.pendingQuotes).toBe(1);
  });

  it("computes average winning price", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000 }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200 }),
    ];
    const lane = Array.from(computeLaneStats(quotes).values())[0];
    expect(lane.avgWinningPrice).toBe(3100);
  });

  it("computes average losing target price", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "lost", lostTargetPrice: 2500 }),
      makeQuote({ origin: "A", destination: "B", status: "lost", lostTargetPrice: 2700 }),
    ];
    const lane = Array.from(computeLaneStats(quotes).values())[0];
    expect(lane.avgLosingTarget).toBe(2600);
  });

  it("returns last winning price (most recent won quote, not average)", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000, createdAt: "2026-01-15T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3400, createdAt: "2026-03-20T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200, createdAt: "2026-02-10T00:00:00Z" }),
    ];
    const lane = Array.from(computeLaneStats(quotes).values())[0];
    expect(lane.lastWinningPrice).toBe(3400); // Most recent by date, not last in array
  });

  it("computes total revenue from won quotes only", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000 }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200 }),
      makeQuote({ origin: "A", destination: "B", status: "lost", customerPrice: 2800 }),
    ];
    const lane = Array.from(computeLaneStats(quotes).values())[0];
    expect(lane.totalRevenue).toBe(6200);
  });

  it("handles lane with zero decided quotes (all pending)", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "pending" }),
    ];
    const lane = Array.from(computeLaneStats(quotes).values())[0];
    expect(lane.winRate).toBe(0);
    expect(lane.avgWinningPrice).toBe(0);
    expect(lane.avgMarginPercent).toBe(0);
  });

  it("applies currency conversion when provided", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000 }),
    ];
    // Convert by doubling the value
    const map = computeLaneStats(quotes, (amount) => amount * 2);
    const lane = Array.from(map.values())[0];
    expect(lane.avgWinningPrice).toBe(6000);
    expect(lane.totalRevenue).toBe(6000);
  });
});

// ── matchLane ──────────────────────────────────────────────────────

describe("matchLane", () => {
  it("returns stats when lane matches", () => {
    const quotes = [
      makeQuote({ origin: "Toronto, ON", destination: "Montreal, QC", status: "won", customerPrice: 3000 }),
    ];
    const map = computeLaneStats(quotes);
    const result = matchLane("Toronto, Ontario", "Montreal, Quebec", map);
    expect(result).not.toBeNull();
    expect(result!.totalQuotes).toBe(1);
  });

  it("matches reversed direction", () => {
    const quotes = [
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3000 }),
    ];
    const map = computeLaneStats(quotes);
    const result = matchLane("Montreal", "Toronto", map);
    expect(result).not.toBeNull();
  });

  it("returns null when no match", () => {
    const quotes = [
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3000 }),
    ];
    const map = computeLaneStats(quotes);
    const result = matchLane("Calgary", "Edmonton", map);
    expect(result).toBeNull();
  });

  it("matches full address against city-only quote", () => {
    const quotes = [
      makeQuote({ origin: "Toronto", destination: "Montreal", status: "won", customerPrice: 3000 }),
    ];
    const map = computeLaneStats(quotes);
    const result = matchLane("123 Industrial Rd, Toronto, ON, M5V 2T6", "456 Rue St-Paul, Montreal, QC, H2Y 1H2", map);
    expect(result).not.toBeNull();
  });
});

// ── computeDashboardKPIs ───────────────────────────────────────────

describe("computeDashboardKPIs", () => {
  it("computes aggregate KPIs", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000, profitMarginPercent: 25 }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200, profitMarginPercent: 30 }),
      makeQuote({ origin: "A", destination: "B", status: "lost", customerPrice: 2800 }),
      makeQuote({ origin: "C", destination: "D", status: "pending", customerPrice: 1500 }),
    ];
    const kpis = computeDashboardKPIs(quotes);
    expect(kpis.totalQuotes).toBe(4);
    expect(kpis.wonQuotes).toBe(2);
    expect(kpis.lostQuotes).toBe(1);
    expect(kpis.pendingQuotes).toBe(1);
    expect(kpis.winRate).toBeCloseTo(2 / 3);
    expect(kpis.avgMarginPercent).toBeCloseTo(27.5);
    expect(kpis.totalRevenue).toBe(6200);
  });

  it("returns zero for empty array", () => {
    const kpis = computeDashboardKPIs([]);
    expect(kpis.totalQuotes).toBe(0);
    expect(kpis.winRate).toBe(0);
    expect(kpis.totalRevenue).toBe(0);
  });

  it("filters by date range", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000, createdAt: "2026-01-15T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200, createdAt: "2026-03-20T00:00:00Z" }),
    ];
    const kpis = computeDashboardKPIs(quotes, "2026-03-01T00:00:00Z", "2026-03-31T23:59:59Z");
    expect(kpis.totalQuotes).toBe(1);
    expect(kpis.totalRevenue).toBe(3200);
  });
});

// ── computeMonthlyRevenue ──────────────────────────────────────────

describe("computeMonthlyRevenue", () => {
  it("groups won quotes by month", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3000, createdAt: "2026-01-15T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 3200, createdAt: "2026-01-20T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 2800, createdAt: "2026-02-10T00:00:00Z" }),
    ];
    const series = computeMonthlyRevenue(quotes);
    expect(series).toHaveLength(2);
    expect(series[0].month).toBe("2026-01");
    expect(series[0].revenue).toBe(6200);
    expect(series[0].quoteCount).toBe(2);
    expect(series[1].month).toBe("2026-02");
    expect(series[1].revenue).toBe(2800);
  });

  it("excludes non-won quotes", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "lost", customerPrice: 3000, createdAt: "2026-01-15T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "pending", customerPrice: 3200, createdAt: "2026-01-20T00:00:00Z" }),
    ];
    const series = computeMonthlyRevenue(quotes);
    expect(series).toHaveLength(0);
  });

  it("returns sorted by month ascending", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 1000, createdAt: "2026-03-01T00:00:00Z" }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 2000, createdAt: "2026-01-01T00:00:00Z" }),
    ];
    const series = computeMonthlyRevenue(quotes);
    expect(series[0].month).toBe("2026-01");
    expect(series[1].month).toBe("2026-03");
  });
});

// ── computeStatusBreakdown ─────────────────────────────────────────

describe("computeStatusBreakdown", () => {
  it("computes status counts and percents", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won" }),
      makeQuote({ origin: "A", destination: "B", status: "won" }),
      makeQuote({ origin: "A", destination: "B", status: "lost" }),
      makeQuote({ origin: "A", destination: "B", status: "pending" }),
    ];
    const breakdown = computeStatusBreakdown(quotes);
    const won = breakdown.find((b) => b.status === "Won")!;
    const lost = breakdown.find((b) => b.status === "Lost")!;
    const pending = breakdown.find((b) => b.status === "Pending")!;
    expect(won.count).toBe(2);
    expect(won.percent).toBe(50);
    expect(lost.count).toBe(1);
    expect(lost.percent).toBe(25);
    expect(pending.count).toBe(1);
    expect(pending.percent).toBe(25);
  });
});

// ── getTopLanes ────────────────────────────────────────────────────

describe("getTopLanes", () => {
  it("returns lanes sorted by quote count by default", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 1000 }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 1000 }),
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 1000 }),
      makeQuote({ origin: "C", destination: "D", status: "won", customerPrice: 5000 }),
    ];
    const map = computeLaneStats(quotes);
    const top = getTopLanes(map, 10, "totalQuotes");
    expect(top[0].totalQuotes).toBe(3);
    expect(top[1].totalQuotes).toBe(1);
  });

  it("respects limit", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B" }),
      makeQuote({ origin: "C", destination: "D" }),
      makeQuote({ origin: "E", destination: "F" }),
    ];
    const map = computeLaneStats(quotes);
    const top = getTopLanes(map, 2);
    expect(top).toHaveLength(2);
  });

  it("sorts by revenue when requested", () => {
    const quotes = [
      makeQuote({ origin: "A", destination: "B", status: "won", customerPrice: 1000 }),
      makeQuote({ origin: "C", destination: "D", status: "won", customerPrice: 5000 }),
    ];
    const map = computeLaneStats(quotes);
    const top = getTopLanes(map, 10, "totalRevenue");
    expect(top[0].revenue).toBe(5000);
  });
});

// ── getDateRangeBounds ─────────────────────────────────────────────

describe("getDateRangeBounds", () => {
  it("returns no bounds for 'all'", () => {
    const bounds = getDateRangeBounds("all");
    expect(bounds.from).toBeUndefined();
    expect(bounds.to).toBeUndefined();
  });

  it("returns bounds for '30d'", () => {
    const bounds = getDateRangeBounds("30d");
    expect(bounds.from).toBeDefined();
    expect(bounds.to).toBeDefined();
    const diff = new Date(bounds.to!).getTime() - new Date(bounds.from!).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeCloseTo(30, 0);
  });

  it("returns bounds for '90d'", () => {
    const bounds = getDateRangeBounds("90d");
    expect(bounds.from).toBeDefined();
    const diff = new Date(bounds.to!).getTime() - new Date(bounds.from!).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeCloseTo(90, 0);
  });
});
```

- [ ] Run tests: `cd client && npx vitest run src/lib/laneIntelligence.test.ts`

---

## Task 2: Add `canUseAnalytics()` and `canUseLaneIntelligence()` gates to `subscription.ts`

- [ ] Edit `client/src/lib/subscription.ts` -- append these two functions before the closing `// ── Display helpers` section:

```typescript
// Add after the canExportCsv function (line 109), before the "Display helpers" section:

/** Whether the user can view the Analytics dashboard tab (charts, KPIs). Pro/Premium only. */
export function canUseAnalytics(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can see lane intelligence hints in route builder. Pro/Premium only. */
export function canUseLaneIntelligence(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}
```

- [ ] Add tests to `client/src/lib/subscription.test.ts`:

```typescript
// Append to the existing test file:

describe("canUseAnalytics", () => {
  it("returns false for free tier", () => {
    expect(canUseAnalytics(makeUser("free"))).toBe(false);
    expect(canUseAnalytics(null)).toBe(false);
  });
  it("returns true for pro", () => {
    expect(canUseAnalytics(makeUser("pro"))).toBe(true);
  });
  it("returns true for fleet", () => {
    expect(canUseAnalytics(makeUser("fleet"))).toBe(true);
  });
});

describe("canUseLaneIntelligence", () => {
  it("returns false for free tier", () => {
    expect(canUseLaneIntelligence(makeUser("free"))).toBe(false);
  });
  it("returns true for pro", () => {
    expect(canUseLaneIntelligence(makeUser("pro"))).toBe(true);
  });
  it("returns true for fleet", () => {
    expect(canUseLaneIntelligence(makeUser("fleet"))).toBe(true);
  });
});
```

- [ ] Run tests: `cd client && npx vitest run src/lib/subscription.test.ts`

---

## Task 3: Install recharts, create `analytics.tsx` page shell with tabs

### 3a. Install recharts

- [ ] Run: `cd client && npm install recharts`

### 3b. Create `client/src/pages/analytics.tsx`

- [ ] Create file at `client/src/pages/analytics.tsx`

```typescript
import { useState, useMemo, lazy, Suspense } from "react";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { canUseAnalytics } from "@/lib/subscription";
import { BarChart3, History } from "lucide-react";

const Dashboard = lazy(() => import("@/pages/analytics/dashboard"));
const QuoteHistory = lazy(() => import("@/pages/quote-history"));

type Tab = "dashboard" | "history";

export default function Analytics() {
  const { user } = useFirebaseAuth();
  const hasDashboard = canUseAnalytics(user);
  const [activeTab, setActiveTab] = useState<Tab>(hasDashboard ? "dashboard" : "history");

  const tabs: { id: Tab; label: string; icon: typeof BarChart3; gated?: boolean }[] = useMemo(() => {
    const items: { id: Tab; label: string; icon: typeof BarChart3; gated?: boolean }[] = [];
    if (hasDashboard) {
      items.push({ id: "dashboard", label: "Dashboard", icon: BarChart3 });
    }
    items.push({ id: "history", label: "Quote History", icon: History });
    return items;
  }, [hasDashboard]);

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium
                border-b-2 -mb-px transition-colors
                ${isActive
                  ? "border-orange-500 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300"
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
          </div>
        }
      >
        {activeTab === "dashboard" && hasDashboard && <Dashboard />}
        {activeTab === "history" && <QuoteHistory />}
      </Suspense>
    </div>
  );
}
```

---

## Task 4: Create `dashboard.tsx` with KPI cards (Total Quotes, Win Rate, Avg Margin, Revenue)

- [ ] Create directory: `mkdir -p client/src/pages/analytics`
- [ ] Create file at `client/src/pages/analytics/dashboard.tsx`

```typescript
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Trophy,
  TrendingUp,
  DollarSign,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import type { Quote } from "@shared/schema";
import {
  computeLaneStats,
  computeDashboardKPIs,
  computeMonthlyRevenue,
  computeStatusBreakdown,
  getTopLanes,
  getDateRangeBounds,
  type DateRangePreset,
  type TopLane,
} from "@/lib/laneIntelligence";
import { formatCurrencyAmount, currencySymbol, resolveWorkspaceCurrency } from "@/lib/currency";
import type { SupportedCurrency } from "@/lib/currency";

// Lazy-loaded chart components to keep the initial bundle smaller
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Date range presets ─────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

// ── Status colors ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Won: "#22c55e",    // green-500
  Lost: "#ef4444",   // red-500
  Pending: "#f59e0b", // amber-500
};

// ── Component ──────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const currency = resolveWorkspaceCurrency(user) as SupportedCurrency;
  const sym = currencySymbol(currency);

  const [dateRange, setDateRange] = useState<DateRangePreset>("90d");
  const [laneSortBy, setLaneSortBy] = useState<"totalQuotes" | "winRate" | "totalRevenue">("totalQuotes");

  const { data: quotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["firebase", "quotes", scopeId ?? ""],
    queryFn: () => firebaseDb.getQuotes(scopeId),
    enabled: !!scopeId,
  });

  const { from, to } = useMemo(() => getDateRangeBounds(dateRange), [dateRange]);

  // Filter quotes to date range for lane stats
  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (from && q.createdAt < from) return false;
      if (to && q.createdAt > to) return false;
      return true;
    });
  }, [quotes, from, to]);

  const kpis = useMemo(() => computeDashboardKPIs(quotes, from, to), [quotes, from, to]);
  const laneStatsMap = useMemo(() => computeLaneStats(filteredQuotes), [filteredQuotes]);
  const topLanes = useMemo(() => getTopLanes(laneStatsMap, 10, laneSortBy), [laneStatsMap, laneSortBy]);
  const monthlyRevenue = useMemo(() => computeMonthlyRevenue(quotes, from, to), [quotes, from, to]);
  const statusBreakdown = useMemo(() => computeStatusBreakdown(quotes, from, to), [quotes, from, to]);

  // Win rate trend arrow
  const winRateDelta = kpis.winRate - kpis.winRateLastMonth;
  const winRateDeltaPercent = Math.round(winRateDelta * 100);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-900">No quotes yet</p>
            <p className="text-xs text-slate-500 mt-1">Start quoting to see your analytics</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Date range filter */}
      <div className="flex items-center justify-end">
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangePreset)}>
          <SelectTrigger className="h-7 text-xs w-[160px] border-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Quotes */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Quotes</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{kpis.totalQuotes.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400">{kpis.quotesThisMonth} this month</p>
          </CardContent>
        </Card>

        {/* Win Rate */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Win Rate</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{Math.round(kpis.winRate * 100)}%</p>
            <div className="flex items-center gap-1 text-[11px]">
              {winRateDeltaPercent > 0 ? (
                <>
                  <ArrowUp className="w-3 h-3 text-green-600" />
                  <span className="text-green-600">{winRateDeltaPercent}% vs last month</span>
                </>
              ) : winRateDeltaPercent < 0 ? (
                <>
                  <ArrowDown className="w-3 h-3 text-red-500" />
                  <span className="text-red-500">{Math.abs(winRateDeltaPercent)}% vs last month</span>
                </>
              ) : (
                <>
                  <Minus className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-400">No change vs last month</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Avg Margin */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Avg Margin</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{kpis.avgMarginPercent.toFixed(1)}%</p>
            <p className="text-[11px] text-slate-400">On won quotes</p>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Revenue</span>
            </div>
            <p className="text-xl font-bold text-slate-900">
              {sym}{kpis.totalRevenue >= 1000
                ? `${(kpis.totalRevenue / 1000).toFixed(1)}k`
                : kpis.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
            <p className="text-[11px] text-slate-400">Won quotes, {DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label?.toLowerCase()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Lanes Table */}
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Top Lanes</h3>
            <Select value={laneSortBy} onValueChange={(v) => setLaneSortBy(v as typeof laneSortBy)}>
              <SelectTrigger className="h-7 text-[11px] w-[130px] border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="totalQuotes" className="text-xs">By Quotes</SelectItem>
                <SelectItem value="winRate" className="text-xs">By Win Rate</SelectItem>
                <SelectItem value="totalRevenue" className="text-xs">By Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {topLanes.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No lane data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-1.5 font-medium text-slate-500">Lane</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Quotes</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Win Rate</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Avg Price</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topLanes.map((lane, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-900">
                        <span className="flex items-center gap-1">
                          {lane.displayOrigin}
                          <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          {lane.displayDestination}
                        </span>
                      </td>
                      <td className="text-right py-1.5 text-slate-900">{lane.totalQuotes}</td>
                      <td className="text-right py-1.5 text-slate-900">{Math.round(lane.winRate * 100)}%</td>
                      <td className="text-right py-1.5 text-slate-900">
                        {lane.avgPrice > 0 ? `${sym}${formatCurrencyAmount(lane.avgPrice, currency)}` : "--"}
                      </td>
                      <td className="text-right py-1.5 text-slate-900">
                        {lane.revenue > 0 ? `${sym}${formatCurrencyAmount(lane.revenue, currency)}` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Revenue Over Time */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Revenue Over Time</h3>
            {monthlyRevenue.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No revenue data yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenue} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) =>
                        value >= 1000 ? `${sym}${(value / 1000).toFixed(0)}k` : `${sym}${value}`
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                      formatter={(value: number) => [`${sym}${value.toLocaleString()}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" fill="#f97316" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Win/Loss Breakdown */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Win/Loss Breakdown</h3>
            {kpis.totalQuotes === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No data yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown.filter((s) => s.count > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="status"
                    >
                      {statusBreakdown
                        .filter((s) => s.count > 0)
                        .map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLORS[entry.status] ?? "#94a3b8"}
                          />
                        ))}
                    </Pie>
                    <Legend
                      verticalAlign="bottom"
                      iconSize={8}
                      formatter={(value: string) => (
                        <span className="text-[11px] text-slate-500">{value}</span>
                      )}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                      formatter={(value: number, name: string) => {
                        const item = statusBreakdown.find((s) => s.status === name);
                        return [`${value} (${item?.percent.toFixed(0)}%)`, name];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

---

## Task 5: Add Top Lanes table to dashboard

Already included in Task 4 above (the `<table>` section within `dashboard.tsx`). No separate task needed.

---

## Task 6: Add Revenue Over Time bar chart (Recharts)

Already included in Task 4 above (the `BarChart` section within `dashboard.tsx`). No separate task needed.

---

## Task 7: Add Win/Loss Breakdown chart

Already included in Task 4 above (the `PieChart` section within `dashboard.tsx`). No separate task needed.

---

## Task 8: Add date range filter to dashboard

Already included in Task 4 above (the `Select` for `dateRange` at the top of the dashboard). No separate task needed.

---

## Task 9: Update `App.tsx` -- add Analytics nav item, route, move Quote History under Analytics

- [ ] Edit `client/src/App.tsx` to add the lazy import for Analytics (after the existing QuoteHistory lazy import, around line 33):

```typescript
// Add this line after the QuoteHistory lazy import:
const Analytics = lazy(() => import("@/pages/analytics"));
```

- [ ] Edit `client/src/App.tsx` to also import `BarChart3` from lucide-react (it is already imported at line 66, so this step is already done -- verify `BarChart3` is in the import list).

- [ ] Edit the `NAV_ITEMS` array (around line 214-230) to replace the Quote History entry with Analytics:

Change this line:
```typescript
  { path: "/history", label: "Quote History", icon: History, requiredPermission: null },
```
To:
```typescript
  { path: "/analytics", label: "Analytics", icon: BarChart3, requiredPermission: null },
```

- [ ] Edit the route rendering section (around line 1020-1035) to add the `/analytics` route and keep `/history` as a redirect:

Change:
```typescript
              ) : routePath === "/history" ? (
                <QuoteHistory />
```
To:
```typescript
              ) : routePath === "/analytics" ? (
                <Analytics />
              ) : routePath === "/history" ? (
                <Analytics />
```

This ensures old `/history` bookmarks still work by rendering the Analytics page (which has Quote History as a tab).

---

## Task 10: Add lane history tooltip and auto-suggest to `route-builder.tsx`

- [ ] Edit `client/src/pages/route-builder.tsx` to add imports at the top of the file (after existing imports, around line 66):

```typescript
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { computeLaneStats, matchLane, type LaneStats } from "@/lib/laneIntelligence";
import { canUseLaneIntelligence } from "@/lib/subscription";
```

- [ ] Also add `History` to the lucide-react imports if not already present. Check the existing import block -- `History` is not currently imported in route-builder.tsx, so add it:

```typescript
// Add History to the lucide-react import block (around line 16-57):
import {
  // ...existing icons...
  History,
} from "lucide-react";
```

- [ ] Inside the main `RouteBuilder` component function, add the lane intelligence hook. Find the area where quotes are fetched (search for `queryKey: ["firebase", "quotes"`) -- this query exists in `quote-history.tsx` but NOT in `route-builder.tsx`. We need to add a quotes query to route-builder:

Add this block inside the component, near the other `useQuery` calls (after the profiles/yards queries):

```typescript
  // ── Lane intelligence ──────────────────────────────────────────
  const showLaneIntel = canUseLaneIntelligence(user);

  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ["firebase", "quotes", scopeId ?? ""],
    queryFn: () => firebaseDb.getQuotes(scopeId),
    enabled: !!scopeId && showLaneIntel,
  });

  const laneStatsMap = useMemo(
    () => (showLaneIntel ? computeLaneStats(allQuotes) : new Map()),
    [allQuotes, showLaneIntel],
  );

  // Match current route's origin/destination against historical lanes
  const currentLaneStats: LaneStats | null = useMemo(() => {
    if (!showLaneIntel || stops.length < 2) return null;
    const nonYard = stops.filter((s) => s.type !== "yard");
    if (nonYard.length < 2) return null;
    const origin = nonYard[0]?.location;
    const dest = nonYard[nonYard.length - 1]?.location;
    if (!origin || !dest) return null;
    return matchLane(origin, dest, laneStatsMap);
  }, [showLaneIntel, stops, laneStatsMap]);
```

- [ ] Add the lane intelligence tooltip UI component. Create a small inline component inside `route-builder.tsx` (before the main return JSX, or as a sub-component):

```typescript
  // ── Lane Intelligence Popover ──────────────────────────────────
  function LaneIntelligencePopover({ stats }: { stats: LaneStats }) {
    const wsCurrency = resolveWorkspaceCurrency(user) as SupportedCurrency;
    const sym = currencySymbol(wsCurrency);
    const lastDate = stats.lastQuotedAt
      ? new Date(stats.lastQuotedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "--";
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 transition-colors"
            aria-label="Lane history"
          >
            <History className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">{stats.totalQuotes} prev</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-[260px] p-3 text-xs"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {stats.displayOrigin}
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              {stats.displayDestination}
              <span className="text-[11px] font-normal text-slate-400 ml-auto">
                {stats.totalQuotes} quotes
              </span>
            </div>
            <div className="border-t border-slate-100 pt-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Win rate</span>
                <span className="text-slate-900 font-medium">
                  {Math.round(stats.winRate * 100)}% ({stats.wonQuotes}/{stats.wonQuotes + stats.lostQuotes})
                </span>
              </div>
              {stats.avgWinningPrice > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg winning price</span>
                  <span className="text-slate-900 font-medium">
                    {sym}{formatCurrencyAmount(stats.avgWinningPrice, wsCurrency)}
                  </span>
                </div>
              )}
              {stats.avgLosingTarget > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg losing target</span>
                  <span className="text-slate-900 font-medium">
                    {sym}{formatCurrencyAmount(stats.avgLosingTarget, wsCurrency)}
                  </span>
                </div>
              )}
              {stats.avgMarginPercent > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Your avg margin</span>
                  <span className="text-slate-900 font-medium">
                    {stats.avgMarginPercent.toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Last quoted</span>
                <span className="text-slate-400">{lastDate}</span>
              </div>
            </div>
            {stats.lastWinningPrice > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <p className="text-[11px] text-slate-400">
                  Last won at <span className="text-orange-600 font-medium">{sym}{formatCurrencyAmount(stats.lastWinningPrice, wsCurrency)}</span>
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
```

- [ ] Render the `LaneIntelligencePopover` in the route summary area. Find the section in the JSX where the route summary is displayed (the area showing origin -> destination after calculation). This is typically near the "Your Quote" / pricing section. Insert this conditional render:

```typescript
{/* Lane Intelligence — show next to route summary when a matching lane exists */}
{currentLaneStats && <LaneIntelligencePopover stats={currentLaneStats} />}
```

Place this right after or alongside the route display (e.g., where `origin -> destination` is shown). The exact location depends on the route-builder JSX structure -- look for where `stops` are rendered as a summary line with `ArrowRight` icons.

- [ ] Add auto-suggest for the quote input. Find the `customQuoteInput` state and the section where the user enters their quote price. Add a `useEffect` that pre-fills when a lane match is detected:

```typescript
  // Auto-suggest last winning price when lane is detected and no custom quote entered yet
  useEffect(() => {
    if (
      currentLaneStats &&
      currentLaneStats.lastWinningPrice > 0 &&
      !customQuoteInput // Only suggest if user hasn't already typed a value
    ) {
      setCustomQuoteInput(String(Math.round(currentLaneStats.lastWinningPrice)));
    }
    // Only run when lane stats change (new route entered), not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLaneStats?.laneKey]);
```

- [ ] Below the custom quote input field, show a subtle hint when auto-suggest is active:

```typescript
{currentLaneStats && currentLaneStats.lastWinningPrice > 0 && (
  <p className="text-[11px] text-slate-400 mt-0.5">
    Last won at {currencySymbol(resolveWorkspaceCurrency(user) as SupportedCurrency)}
    {formatCurrencyAmount(currentLaneStats.lastWinningPrice, resolveWorkspaceCurrency(user) as SupportedCurrency)}
  </p>
)}
```

---

## Task 11: Final integration test

- [ ] Run the full vitest suite: `cd client && npx vitest run`
- [ ] Verify no TypeScript errors: `cd client && npx tsc --noEmit`
- [ ] Verify the dev server starts without errors: `cd client && npm run dev` (manual check)
- [ ] Spot-check in browser:
  - Navigate to `/#/analytics` -- Dashboard tab shows KPI cards, charts, Top Lanes table
  - Click "Quote History" tab -- existing quote history renders correctly
  - Old `/#/history` URL redirects to Analytics page
  - On route builder, enter a known lane -- History icon appears with popover
  - Auto-suggest fills the quote input with last winning price
  - Free tier user sees only Quote History tab (no Dashboard)
  - Free tier user does not see lane intelligence on route builder

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `client/src/lib/laneIntelligence.ts` | Lane matching, stats computation, dashboard KPIs, chart data |
| `client/src/lib/laneIntelligence.test.ts` | Unit tests for all laneIntelligence functions |
| `client/src/pages/analytics.tsx` | Analytics page shell with Dashboard / Quote History tabs |
| `client/src/pages/analytics/dashboard.tsx` | Dashboard tab: KPI cards, Top Lanes table, Revenue chart, Win/Loss chart |

### Modified Files
| File | Change |
|------|--------|
| `client/src/lib/subscription.ts` | Add `canUseAnalytics()`, `canUseLaneIntelligence()` |
| `client/src/lib/subscription.test.ts` | Add tests for new gate functions |
| `client/src/App.tsx` | Add Analytics lazy import, update NAV_ITEMS (Quote History -> Analytics), add `/analytics` route, keep `/history` as redirect |
| `client/src/pages/route-builder.tsx` | Add quotes query, lane stats computation, LaneIntelligencePopover component, auto-suggest logic |
| `client/package.json` | Add `recharts` dependency |

### Dependencies
| Package | Version | Reason |
|---------|---------|--------|
| `recharts` | `^2.x` | Bar chart + Pie chart in dashboard |
