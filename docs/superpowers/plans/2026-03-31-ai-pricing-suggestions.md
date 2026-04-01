# AI-Powered Pricing Suggestions (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a data-driven price suggestion in the route builder based on the carrier's own quote history

**Architecture:** New pricingSuggestion.ts module that analyzes lane stats to find the optimal margin. PricingSuggestionCard component renders the suggestion with confidence level. Phase 1 = internal signal only (no market data API).

**Tech Stack:** TypeScript, React, Vitest, Tailwind CSS

---

## Task 1: Create `pricingSuggestion.ts` — suggestion algorithm with full tests

### 1a. Create `client/src/lib/pricingSuggestion.ts`

- [ ] Create file at `client/src/lib/pricingSuggestion.ts`

```typescript
/**
 * pricingSuggestion.ts
 *
 * Phase 1: Internal signal only — computes a suggested customer price
 * based on the carrier's own quote history for the lane.
 *
 * Uses LaneStats from laneIntelligence.ts (Feature 3) to determine
 * the optimal margin and confidence level.
 *
 * Phase 2 (future): will add external market rate signal.
 */

import type { LaneStats } from "./laneIntelligence";

// ── Types ──────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

export type PricingSuggestion = {
  /** The suggested customer price (carrier cost + optimal margin + accessorials) */
  suggestedPrice: number;
  /** The optimal margin percentage (0-1, e.g. 0.28 = 28%) */
  optimalMarginPercent: number;
  /** Confidence in the suggestion based on sample size */
  confidence: ConfidenceLevel;
  /** Human-readable reasoning for the suggestion */
  reasoning: string;
  /** Win rate at or near this margin (0-1) */
  expectedWinRate: number;
  /** Number of historical quotes used */
  quoteCount: number;
  /** True if the carrier wins every quote (may be under-pricing) */
  isAlwaysWinning: boolean;
  /** True if the carrier has only lost quotes */
  isAlwaysLosing: boolean;
};

// ── Constants ──────────────────────────────────────────────────────

/** Minimum quotes needed to show any suggestion */
const MIN_QUOTES_FOR_SUGGESTION = 2;

/** Confidence thresholds based on resolved quote count (won + lost) */
const HIGH_CONFIDENCE_THRESHOLD = 15;
const MEDIUM_CONFIDENCE_THRESHOLD = 5;

/** Default margin when carrier has only lost quotes (aim lower) */
const FALLBACK_LOSS_DISCOUNT = 0.05; // 5% below their average losing margin

/** Minimum margin floor — never suggest below 10% */
const MIN_MARGIN_PERCENT = 0.10;

/** Maximum margin cap — never suggest above 60% */
const MAX_MARGIN_PERCENT = 0.60;

// ── Core algorithm ─────────────────────────────────────────────────

/**
 * Compute the confidence level based on the number of resolved quotes
 * (won + lost — pending quotes don't tell us anything about pricing).
 */
export function getConfidence(resolvedQuotes: number): ConfidenceLevel {
  if (resolvedQuotes >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (resolvedQuotes >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

/**
 * Compute a pricing suggestion from lane stats and current carrier cost.
 *
 * @param laneStats - Historical lane stats from laneIntelligence.ts (or null if no history)
 * @param carrierCost - Current calculated carrier cost (fullTripCost + inflation surcharge)
 * @param accessorialTotal - Total accessorial charges to add on top of margin
 * @returns PricingSuggestion or null if insufficient data
 */
export function computeSuggestion(
  laneStats: LaneStats | null,
  carrierCost: number,
  accessorialTotal: number = 0,
): PricingSuggestion | null {
  // No suggestion if no lane history or carrier cost is zero/negative
  if (!laneStats || carrierCost <= 0) return null;

  const resolvedQuotes = laneStats.wonQuotes + laneStats.lostQuotes;

  // Need at least MIN_QUOTES_FOR_SUGGESTION resolved quotes
  if (resolvedQuotes < MIN_QUOTES_FOR_SUGGESTION) return null;

  const confidence = getConfidence(resolvedQuotes);
  const isAlwaysWinning = laneStats.wonQuotes > 0 && laneStats.lostQuotes === 0;
  const isAlwaysLosing = laneStats.lostQuotes > 0 && laneStats.wonQuotes === 0;

  let optimalMarginPercent: number;
  let reasoning: string;
  let expectedWinRate: number;

  if (isAlwaysWinning) {
    // Carrier wins every quote — they may be under-pricing.
    // Suggest a margin 5 percentage points above their current average.
    const currentMargin = laneStats.avgMarginPercent / 100; // convert from percentage to decimal
    optimalMarginPercent = currentMargin + 0.05;
    expectedWinRate = laneStats.winRate;
    reasoning =
      `You win every quote on this lane — consider raising your margin. ` +
      `Your average margin is ${(currentMargin * 100).toFixed(0)}%, suggesting ${(optimalMarginPercent * 100).toFixed(0)}%.`;
  } else if (isAlwaysLosing) {
    // Carrier only has losses — suggest pricing below their avg losing target.
    // Use the average losing target as a guide: price just below it.
    if (laneStats.avgLosingTarget > 0 && laneStats.avgLosingTarget > carrierCost) {
      // The customer's target is known — price slightly below it
      const targetMargin = (laneStats.avgLosingTarget - carrierCost) / carrierCost;
      optimalMarginPercent = Math.max(targetMargin - FALLBACK_LOSS_DISCOUNT, MIN_MARGIN_PERCENT);
      reasoning =
        `All ${laneStats.lostQuotes} quotes were lost. Customer targets average ${formatDollar(laneStats.avgLosingTarget)}. ` +
        `Suggesting a ${(optimalMarginPercent * 100).toFixed(0)}% margin to be more competitive.`;
    } else {
      // No useful losing target data — suggest minimum margin
      optimalMarginPercent = MIN_MARGIN_PERCENT;
      reasoning =
        `All ${laneStats.lostQuotes} quotes were lost with no clear target price. Suggesting minimum ${(MIN_MARGIN_PERCENT * 100).toFixed(0)}% margin.`;
    }
    expectedWinRate = 0;
  } else {
    // Normal case: mix of wins and losses — use the winning margin as the sweet spot
    const winningMargin = laneStats.avgMarginPercent / 100; // convert from percentage to decimal
    optimalMarginPercent = winningMargin;
    expectedWinRate = laneStats.winRate;

    const winPct = (laneStats.winRate * 100).toFixed(0);
    reasoning =
      `Based on ${resolvedQuotes} quotes (${winPct}% win rate). ` +
      `Your winning margin averages ${(winningMargin * 100).toFixed(0)}%.`;
  }

  // Clamp margin to reasonable range
  optimalMarginPercent = Math.max(MIN_MARGIN_PERCENT, Math.min(MAX_MARGIN_PERCENT, optimalMarginPercent));

  // Calculate the suggested price
  const suggestedPrice = Math.round(carrierCost * (1 + optimalMarginPercent) + accessorialTotal);

  return {
    suggestedPrice,
    optimalMarginPercent,
    confidence,
    reasoning,
    expectedWinRate,
    quoteCount: resolvedQuotes,
    isAlwaysWinning,
    isAlwaysLosing,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatDollar(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Returns the display color classes for a confidence level dot.
 */
export function confidenceDotColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "bg-green-500";
    case "medium":
      return "bg-yellow-400";
    case "low":
      return "bg-slate-300";
  }
}

/**
 * Returns the display label for a confidence level.
 */
export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
  }
}
```

### 1b. Create `client/src/lib/pricingSuggestion.test.ts`

- [ ] Create file at `client/src/lib/pricingSuggestion.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  computeSuggestion,
  getConfidence,
  confidenceDotColor,
  confidenceLabel,
  type PricingSuggestion,
} from "./pricingSuggestion";
import type { LaneStats } from "./laneIntelligence";

// ── Helpers ────────────────────────────────────────────────────────

function makeLaneStats(overrides: Partial<LaneStats> = {}): LaneStats {
  return {
    laneKey: "toronto->montreal",
    displayOrigin: "Toronto",
    displayDestination: "Montreal",
    totalQuotes: 10,
    wonQuotes: 6,
    lostQuotes: 4,
    pendingQuotes: 0,
    winRate: 0.6,
    avgWinningPrice: 3200,
    avgLosingTarget: 2900,
    avgMarginPercent: 28,
    lastWinningPrice: 3300,
    lastQuotedAt: "2026-03-15T00:00:00Z",
    totalRevenue: 19200,
    ...overrides,
  };
}

// ── getConfidence ──────────────────────────────────────────────────

describe("getConfidence", () => {
  it("returns low for fewer than 5 resolved quotes", () => {
    expect(getConfidence(0)).toBe("low");
    expect(getConfidence(1)).toBe("low");
    expect(getConfidence(4)).toBe("low");
  });

  it("returns medium for 5-14 resolved quotes", () => {
    expect(getConfidence(5)).toBe("medium");
    expect(getConfidence(10)).toBe("medium");
    expect(getConfidence(14)).toBe("medium");
  });

  it("returns high for 15+ resolved quotes", () => {
    expect(getConfidence(15)).toBe("high");
    expect(getConfidence(50)).toBe("high");
  });
});

// ── computeSuggestion ──────────────────────────────────────────────

describe("computeSuggestion", () => {
  // ── Null / no-suggestion cases ───────────────────────────────────

  it("returns null when laneStats is null", () => {
    expect(computeSuggestion(null, 2500)).toBeNull();
  });

  it("returns null when carrierCost is 0", () => {
    expect(computeSuggestion(makeLaneStats(), 0)).toBeNull();
  });

  it("returns null when carrierCost is negative", () => {
    expect(computeSuggestion(makeLaneStats(), -100)).toBeNull();
  });

  it("returns null when fewer than 2 resolved quotes", () => {
    const stats = makeLaneStats({
      wonQuotes: 1,
      lostQuotes: 0,
      totalQuotes: 1,
      winRate: 1,
    });
    expect(computeSuggestion(stats, 2500)).toBeNull();
  });

  it("returns null when all quotes are pending (0 resolved)", () => {
    const stats = makeLaneStats({
      wonQuotes: 0,
      lostQuotes: 0,
      pendingQuotes: 5,
      totalQuotes: 5,
      winRate: 0,
    });
    expect(computeSuggestion(stats, 2500)).toBeNull();
  });

  // ── Normal case (mix of wins and losses) ─────────────────────────

  it("suggests winning margin for normal win/loss mix", () => {
    const stats = makeLaneStats({
      wonQuotes: 6,
      lostQuotes: 4,
      winRate: 0.6,
      avgMarginPercent: 28, // 28% winning margin
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result).not.toBeNull();
    expect(result.optimalMarginPercent).toBeCloseTo(0.28);
    expect(result.suggestedPrice).toBe(Math.round(2500 * 1.28));
    expect(result.confidence).toBe("medium"); // 10 resolved quotes
    expect(result.expectedWinRate).toBe(0.6);
    expect(result.isAlwaysWinning).toBe(false);
    expect(result.isAlwaysLosing).toBe(false);
    expect(result.quoteCount).toBe(10);
  });

  it("includes accessorial total in suggested price", () => {
    const stats = makeLaneStats({ avgMarginPercent: 25 });
    const result = computeSuggestion(stats, 2000, 150)!;
    expect(result.suggestedPrice).toBe(Math.round(2000 * 1.25 + 150));
  });

  it("has high confidence with 15+ resolved quotes", () => {
    const stats = makeLaneStats({ wonQuotes: 12, lostQuotes: 5 });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.confidence).toBe("high");
  });

  it("has low confidence with 2-4 resolved quotes", () => {
    const stats = makeLaneStats({
      wonQuotes: 1,
      lostQuotes: 2,
      totalQuotes: 3,
      winRate: 0.333,
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.confidence).toBe("low");
  });

  // ── All wins (potential under-pricing) ───────────────────────────

  it("suggests higher margin when all quotes are won", () => {
    const stats = makeLaneStats({
      wonQuotes: 8,
      lostQuotes: 0,
      totalQuotes: 8,
      winRate: 1.0,
      avgMarginPercent: 22, // currently winning at 22%
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result).not.toBeNull();
    expect(result.isAlwaysWinning).toBe(true);
    // Should suggest 22% + 5% = 27%
    expect(result.optimalMarginPercent).toBeCloseTo(0.27);
    expect(result.suggestedPrice).toBe(Math.round(2500 * 1.27));
    expect(result.reasoning).toContain("win every quote");
    expect(result.reasoning).toContain("raising your margin");
  });

  // ── All losses ───────────────────────────────────────────────────

  it("suggests price below avg losing target when all quotes are lost", () => {
    const stats = makeLaneStats({
      wonQuotes: 0,
      lostQuotes: 6,
      totalQuotes: 6,
      winRate: 0,
      avgLosingTarget: 2800,
      avgMarginPercent: 0,
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result).not.toBeNull();
    expect(result.isAlwaysLosing).toBe(true);
    expect(result.expectedWinRate).toBe(0);
    // Target margin = (2800-2500)/2500 = 0.12, minus 0.05 discount = 0.07, clamped to 0.10 min
    expect(result.optimalMarginPercent).toBeGreaterThanOrEqual(0.10);
    expect(result.suggestedPrice).toBeLessThan(2800 + 1); // should be at or below target
    expect(result.reasoning).toContain("lost");
  });

  it("uses minimum margin when all losses and no useful target price", () => {
    const stats = makeLaneStats({
      wonQuotes: 0,
      lostQuotes: 3,
      totalQuotes: 3,
      winRate: 0,
      avgLosingTarget: 0, // no target recorded
      avgMarginPercent: 0,
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.optimalMarginPercent).toBe(0.10);
    expect(result.suggestedPrice).toBe(Math.round(2500 * 1.10));
  });

  it("uses minimum margin when losing target is below carrier cost", () => {
    const stats = makeLaneStats({
      wonQuotes: 0,
      lostQuotes: 4,
      totalQuotes: 4,
      winRate: 0,
      avgLosingTarget: 2000, // below carrier cost of 2500
      avgMarginPercent: 0,
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.optimalMarginPercent).toBe(0.10); // falls back to minimum
  });

  // ── Margin clamping ──────────────────────────────────────────────

  it("clamps margin to minimum 10%", () => {
    const stats = makeLaneStats({
      wonQuotes: 5,
      lostQuotes: 5,
      winRate: 0.5,
      avgMarginPercent: 5, // 5% — below minimum
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.optimalMarginPercent).toBe(0.10);
  });

  it("clamps margin to maximum 60%", () => {
    const stats = makeLaneStats({
      wonQuotes: 5,
      lostQuotes: 5,
      winRate: 0.5,
      avgMarginPercent: 75, // 75% — above maximum
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.optimalMarginPercent).toBe(0.60);
  });

  // ── Reasoning text ───────────────────────────────────────────────

  it("includes quote count and win rate in reasoning for normal case", () => {
    const stats = makeLaneStats({
      wonQuotes: 8,
      lostQuotes: 4,
      winRate: 0.667,
      avgMarginPercent: 30,
    });
    const result = computeSuggestion(stats, 2500)!;
    expect(result.reasoning).toContain("12 quotes");
    expect(result.reasoning).toContain("67% win rate");
    expect(result.reasoning).toContain("30%");
  });
});

// ── Display helpers ────────────────────────────────────────────────

describe("confidenceDotColor", () => {
  it("returns green for high confidence", () => {
    expect(confidenceDotColor("high")).toBe("bg-green-500");
  });

  it("returns yellow for medium confidence", () => {
    expect(confidenceDotColor("medium")).toBe("bg-yellow-400");
  });

  it("returns gray for low confidence", () => {
    expect(confidenceDotColor("low")).toBe("bg-slate-300");
  });
});

describe("confidenceLabel", () => {
  it("returns correct labels", () => {
    expect(confidenceLabel("high")).toBe("High");
    expect(confidenceLabel("medium")).toBe("Medium");
    expect(confidenceLabel("low")).toBe("Low");
  });
});
```

### 1c. Run tests

- [ ] Run `npx vitest run client/src/lib/pricingSuggestion.test.ts` and verify all tests pass

---

## Task 2: Create `PricingSuggestionCard.tsx` — the UI component

### 2a. Create `client/src/components/PricingSuggestionCard.tsx`

- [ ] Create file at `client/src/components/PricingSuggestionCard.tsx`

```typescript
/**
 * PricingSuggestionCard.tsx
 *
 * Renders a data-driven pricing suggestion based on the carrier's
 * own quote history for the current lane. Phase 1 = internal signal only.
 *
 * Shown below the pricing section in the route builder when:
 * 1. A route is calculated (carrierCost > 0)
 * 2. Lane history exists (laneStats is not null)
 * 3. The suggestion algorithm produces a result
 * 4. User has Pro or Premium subscription
 */

import { Lightbulb, TrendingUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type PricingSuggestion,
  confidenceDotColor,
  confidenceLabel,
} from "@/lib/pricingSuggestion";

interface PricingSuggestionCardProps {
  suggestion: PricingSuggestion;
  /** Callback to set the custom quote amount when user clicks "Use This Price" */
  onUsePrice: (price: number) => void;
  /** Currency formatting function from the parent context */
  formatCurrency: (n: number) => string;
}

export function PricingSuggestionCard({
  suggestion,
  onUsePrice,
  formatCurrency,
}: PricingSuggestionCardProps) {
  const {
    suggestedPrice,
    optimalMarginPercent,
    confidence,
    reasoning,
    expectedWinRate,
    quoteCount,
    isAlwaysWinning,
    isAlwaysLosing,
  } = suggestion;

  // Pick the right icon based on edge cases
  const Icon = isAlwaysWinning
    ? TrendingUp
    : isAlwaysLosing
      ? AlertTriangle
      : Lightbulb;

  const iconColor = isAlwaysWinning
    ? "text-green-500"
    : isAlwaysLosing
      ? "text-amber-500"
      : "text-orange-500";

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 space-y-2"
      data-testid="pricing-suggestion-card"
    >
      {/* Header row: icon + label + confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Suggested Price
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${confidenceDotColor(confidence)}`}
            aria-label={`${confidenceLabel(confidence)} confidence`}
          />
          <span className="text-[11px] font-medium text-slate-400">
            {confidenceLabel(confidence)}
          </span>
        </div>
      </div>

      {/* Price + margin */}
      <div>
        <div className="text-xl font-bold text-slate-900 tabular-nums tracking-tight">
          {formatCurrency(suggestedPrice)}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {(optimalMarginPercent * 100).toFixed(0)}% margin
          {" \u00B7 "}
          Based on {quoteCount} quote{quoteCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Win rate (shown for normal and always-winning cases) */}
      {expectedWinRate > 0 && (
        <div className="text-xs text-slate-500">
          Your win rate at this margin:{" "}
          <span className="font-semibold text-slate-700">
            {(expectedWinRate * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Edge case messages */}
      {isAlwaysWinning && (
        <div className="text-xs text-green-600 bg-green-50 rounded px-2 py-1.5">
          You win every quote on this lane — you may be able to increase your margin.
        </div>
      )}
      {isAlwaysLosing && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
          All recent quotes on this lane were lost. This is a more competitive price point.
        </div>
      )}

      {/* Reasoning */}
      <div className="text-[11px] text-slate-400 leading-relaxed">
        {reasoning}
      </div>

      {/* Use This Price button */}
      <Button
        size="sm"
        className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white"
        onClick={() => onUsePrice(suggestedPrice)}
        data-testid="button-use-suggested-price"
      >
        Use This Price
      </Button>
    </div>
  );
}
```

---

## Task 3: Add `canUsePricingSuggestions()` gate to `subscription.ts`

### 3a. Add the gate function

- [ ] Add the following to `client/src/lib/subscription.ts`, after the existing `canExportCsv` function (around line 109):

```typescript
/** Whether the user can see AI-powered pricing suggestions. Pro + Premium only. */
export function canUsePricingSuggestions(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}
```

### 3b. Add tests

- [ ] Add the following test block to `client/src/lib/subscription.test.ts`, after the existing `canExportCsv` tests. First, add `canUsePricingSuggestions` to the import statement at the top of the file:

Update the import to include `canUsePricingSuggestions`:

```typescript
import {
  getUserTier,
  isPaid,
  isPro,
  isFleet,
  costProfileLimit,
  yardLimit,
  teamMemberLimit,
  favLaneLimit,
  monthlyQuoteLimit,
  quoteHistoryDays,
  canInviteTeam,
  canExportPdf,
  canExportCsv,
  canUsePricingSuggestions,
  tierLabel,
  limitLabel,
} from "./subscription";
```

Then add the test block:

```typescript
describe("canUsePricingSuggestions", () => {
  it("returns false for free tier", () => {
    expect(canUsePricingSuggestions(makeUser("free"))).toBe(false);
    expect(canUsePricingSuggestions(null)).toBe(false);
    expect(canUsePricingSuggestions(undefined)).toBe(false);
  });

  it("returns true for pro tier", () => {
    expect(canUsePricingSuggestions(makeUser("pro"))).toBe(true);
  });

  it("returns true for fleet/premium tier", () => {
    expect(canUsePricingSuggestions(makeUser("fleet"))).toBe(true);
  });
});
```

### 3c. Run tests

- [ ] Run `npx vitest run client/src/lib/subscription.test.ts` and verify all tests pass

---

## Task 4: Integrate `PricingSuggestionCard` into `route-builder.tsx`

### 4a. Add imports

- [ ] Add these imports to `client/src/pages/route-builder.tsx` with the existing imports:

```typescript
import { computeSuggestion } from "@/lib/pricingSuggestion";
import { PricingSuggestionCard } from "@/components/PricingSuggestionCard";
import { canUsePricingSuggestions } from "@/lib/subscription";
```

Note: `matchLane`, `computeLaneStats`, and `LaneStats` are already imported by Feature 3. The `laneStats` variable for the current route should already be available in the component from Feature 3's integration. If Feature 3's route-builder integration is not yet merged, the lane stats variable needs to be created — see the conditional note below.

### 4b. Add the suggestion memo

- [ ] Add a `useMemo` hook after the existing lane stats logic (which should be present from Feature 3). Place it near the other derived pricing values (around line 1717, after `const allInCost = carrierCost + accessorialTotal;`):

```typescript
  // ── AI Pricing Suggestion (Phase 1: internal signal only) ────────
  const pricingSuggestionResult = useMemo(() => {
    if (!canUsePricingSuggestions(user)) return null;
    // laneStats comes from Feature 3's lane intelligence integration
    // If Feature 3 is not yet integrated, this will be null and no suggestion shown
    if (typeof currentLaneStats === "undefined") return null;
    return computeSuggestion(currentLaneStats ?? null, carrierCost, accessorialTotal);
  }, [user, currentLaneStats, carrierCost, accessorialTotal]);
```

**Important:** `currentLaneStats` is the variable name used in Feature 3's route-builder integration to hold the `LaneStats | null` for the current route. If Feature 3 used a different variable name (e.g., `laneStats` or `matchedLaneStats`), use that name instead. The variable is computed by calling `matchLane(origin, destination, laneStatsMap)` where `laneStatsMap` comes from `computeLaneStats(quotes)`.

**If Feature 3's route-builder integration is NOT yet merged**, add this temporary block to create the lane stats variable. Place it right before the `pricingSuggestionResult` memo:

```typescript
  // Temporary: compute lane stats inline until Feature 3's route-builder integration is merged
  const laneStatsMap = useMemo(() => {
    if (!quotes || quotes.length === 0) return new Map();
    return computeLaneStats(quotes);
  }, [quotes]);

  const currentLaneStats = useMemo(() => {
    if (!stops[0]?.address || !stops[stops.length - 1]?.address) return null;
    return matchLane(stops[0].address, stops[stops.length - 1].address, laneStatsMap);
  }, [stops, laneStatsMap]);
```

And add these imports if not already present from Feature 3:

```typescript
import { computeLaneStats, matchLane } from "@/lib/laneIntelligence";
```

### 4c. Add the card to the render

- [ ] Insert the `PricingSuggestionCard` in the JSX, immediately after the pricing card's closing `</div>` (after the `</Card>` that wraps the margin tiers and "Your Quote" section — around line 2075 where `</div>` closes the pricing section wrapper). Place it **before** the accessorial charges section comment.

Find this exact code block in route-builder.tsx:

```tsx
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          ACCESSORIAL CHARGES (Advanced mode only)
          ═══════════════════════════════════════════════════════════ */}
```

Insert the suggestion card between `</div>` and the accessorial charges comment:

```tsx
          </CardContent>
        </Card>
      </div>

      {/* ── AI Pricing Suggestion ──────────────────────────────── */}
      {pricingSuggestionResult && routeCalc && carrierCost > 0 && (
        <PricingSuggestionCard
          suggestion={pricingSuggestionResult}
          onUsePrice={(price) => setCustomQuoteAmount(String(price))}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════
          ACCESSORIAL CHARGES (Advanced mode only)
          ═══════════════════════════════════════════════════════════ */}
```

### 4d. Verify the integration

- [ ] Verify that the `formatCurrency` function is available in scope (it should already be imported/defined in route-builder.tsx for the pricing tiers)
- [ ] Verify that `setCustomQuoteAmount` is in scope (it is — defined on line 577)
- [ ] Verify there are no TypeScript errors: run `npx tsc --noEmit` from the `client/` directory

---

## Task 5: Final test and commit

### 5a. Run all related tests

- [ ] Run `npx vitest run client/src/lib/pricingSuggestion.test.ts` — all tests pass
- [ ] Run `npx vitest run client/src/lib/subscription.test.ts` — all tests pass (including the new `canUsePricingSuggestions` tests)

### 5b. Run TypeScript check

- [ ] Run `npx tsc --noEmit` from `client/` — no new errors (existing known errors in FeedbackSheet.tsx and currency.ts are acceptable)

### 5c. Visual check

- [ ] Start the dev server and verify the suggestion card:
  1. Does NOT appear for Free tier users
  2. Does NOT appear when no route is calculated
  3. Does NOT appear when no lane history exists for the current route
  4. Appears with correct price, margin, and confidence when lane history exists (Pro/Premium)
  5. "Use This Price" button sets the custom quote amount field
  6. Shows "always winning" message when all quotes on the lane were won
  7. Shows "always losing" message when all quotes on the lane were lost
  8. Confidence dot color matches: green (high), yellow (medium), gray (low)

### 5d. Commit

- [ ] Stage and commit all new/modified files:
  - `client/src/lib/pricingSuggestion.ts` (new)
  - `client/src/lib/pricingSuggestion.test.ts` (new)
  - `client/src/components/PricingSuggestionCard.tsx` (new)
  - `client/src/lib/subscription.ts` (modified)
  - `client/src/lib/subscription.test.ts` (modified)
  - `client/src/pages/route-builder.tsx` (modified)

Commit message: `feat: add AI-powered pricing suggestions (Phase 1, internal signal only)`

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `client/src/lib/pricingSuggestion.ts` | Create | Suggestion algorithm: computeSuggestion(), confidence helpers |
| `client/src/lib/pricingSuggestion.test.ts` | Create | Unit tests for all edge cases |
| `client/src/components/PricingSuggestionCard.tsx` | Create | UI card showing suggestion with confidence dot and "Use This Price" |
| `client/src/lib/subscription.ts` | Modify | Add `canUsePricingSuggestions()` gate (Pro + Premium) |
| `client/src/lib/subscription.test.ts` | Modify | Add tests for `canUsePricingSuggestions` |
| `client/src/pages/route-builder.tsx` | Modify | Import + memo + render PricingSuggestionCard below pricing section |
