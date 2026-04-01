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
  const { origin, destination, ...rest } = overrides;
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    quoteNumber: "Q-001",
    createdAt: new Date().toISOString(),
    origin,
    destination,
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
    ...rest,
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
