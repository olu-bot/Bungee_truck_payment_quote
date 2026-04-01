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
