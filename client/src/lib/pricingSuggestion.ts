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
