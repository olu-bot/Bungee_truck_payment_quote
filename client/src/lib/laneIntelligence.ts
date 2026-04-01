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

  // For "City, Province" format (2 parts), return the first part
  if (parts.length === 2) {
    return parts[0];
  }

  // For 3+ parts (street, city, state, postal), walk from the second segment
  // and return the first segment that looks like a city name
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i].trim();
    // Skip pure postal codes (e.g. "M5V 2T6", "90210")
    if (/^\w\d\w\s?\d\w\d$/i.test(segment)) continue; // Canadian postal
    if (/^\d{5}(-\d{4})?$/.test(segment)) continue;    // US zip

    // If this segment is a short province/state abbreviation (1-2 chars), skip it
    if (segment.length <= 2 && PROVINCE_STATE_SUFFIXES.has(segment.toLowerCase())) continue;

    // This is likely the city — return it
    return segment;
  }

  // Fallback: return the second part (index 1), typically the city
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
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
