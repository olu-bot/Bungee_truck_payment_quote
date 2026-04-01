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
