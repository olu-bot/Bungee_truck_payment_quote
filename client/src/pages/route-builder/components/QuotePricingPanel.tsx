import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, FileDown, FileText } from "lucide-react";
import { currencySymbol } from "@/lib/currency";
import type { PricingAdvice } from "../hooks/useRouteCalculation";
import type { SupportedCurrency } from "@/lib/currency";
import type { Quote } from "@shared/schema";

function marginQualityLabel(percent: number): { label: string; color: string } {
  if (percent < 10) return { label: "Low", color: "text-red-500" };
  if (percent < 25) return { label: "Fair", color: "text-amber-600" };
  if (percent < 50) return { label: "Good", color: "text-slate-600 font-medium" };
  if (percent < 75) return { label: "Great", color: "text-slate-800 font-semibold" };
  return { label: "Outstanding", color: "text-slate-900 font-bold" };
}

type QuotePricingPanelProps = {
  pricingAdvice: PricingAdvice | null;
  carrierCost: number;
  tripCost: number;
  deadheadCost: number;
  includeReturn: boolean;
  costInflationAmount: number;
  accessorialTotal: number;
  customQuoteAmount: string;
  setCustomQuoteAmount: (v: string) => void;
  customerNote: string;
  setCustomerNote: (v: string) => void;
  isSavingQuote: boolean;
  routeCalcExists: boolean;
  onSaveQuote: () => void;
  formatCurrency: (value: number) => string;
  currency: SupportedCurrency;
  // PDF
  lastSavedQuote: Quote | null;
  canSharePdf: boolean;
  canExportPdf: boolean;
  onOpenPdfDialog: () => void;
  onUpgradePdf: () => void;
};

export const QuotePricingPanel = memo(function QuotePricingPanel({
  pricingAdvice,
  carrierCost,
  tripCost,
  deadheadCost,
  includeReturn,
  costInflationAmount,
  accessorialTotal,
  customQuoteAmount,
  setCustomQuoteAmount,
  customerNote,
  setCustomerNote,
  isSavingQuote,
  routeCalcExists,
  onSaveQuote,
  formatCurrency,
  currency,
  lastSavedQuote,
  canSharePdf,
  canExportPdf,
  onOpenPdfDialog,
  onUpgradePdf,
}: QuotePricingPanelProps) {
  return (
    <>
      {/* Row 2: Pricing cards — 4 columns */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-slate-100"
        data-testid="pricing-row"
      >
        {/* CARRIER COST */}
        <div className="space-y-1 pr-4 sm:pr-6">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Carrier Cost
          </div>
          <div
            className="text-2xl font-bold text-orange-600 tabular-nums tracking-tight"
            data-testid="pricing-trip-cost"
          >
            {formatCurrency(includeReturn ? carrierCost : (tripCost + costInflationAmount))}
          </div>
          <div className="text-[11px] text-slate-400">
            {costInflationAmount > 0 && <span>+{formatCurrency(costInflationAmount)} surcharge · </span>}
            {includeReturn && deadheadCost > 0 ? `incl. ${formatCurrency(deadheadCost)} deadhead · ` : ""}
            with fuel
          </div>
        </div>

        {/* Margin tiers */}
        {(pricingAdvice?.tiers || []).map((tier) => {
          const tierColor = tier.label.startsWith("20%") ? "text-red-500" : tier.label.startsWith("40%") ? "text-green-600" : "text-orange-600";
          return (
            <div
              key={tier.label}
              className="space-y-1 px-4 sm:px-6"
              data-testid={`pricing-tier-${tier.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                {tier.label}
              </div>
              {carrierCost > 0 ? (
                <>
                  <div className={`text-2xl font-bold tabular-nums tracking-tight ${tierColor}`}>
                    {formatCurrency(tier.price + accessorialTotal)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    +{formatCurrency(tier.marginAmount)}{accessorialTotal > 0 ? ` +${formatCurrency(accessorialTotal)} acc.` : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm text-slate-300">&mdash;</div>
                  <div className="text-[11px] text-slate-400">set route</div>
                </>
              )}
            </div>
          );
        })}
        {/* Placeholders when no tiers yet */}
        {(!pricingAdvice?.tiers || pricingAdvice.tiers.length === 0) && (
          <>
            {["20% Margin", "30% Margin", "40% Margin"].map((label) => (
              <div key={label} className="space-y-1 px-4 sm:px-6">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</div>
                <div className="text-sm text-slate-300">&mdash;</div>
                <div className="text-[11px] text-slate-400">set route</div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Row 3: Your Quote + Note + Save */}
      <div className="flex items-center gap-2 pt-1.5 border-t border-slate-100">
        {/* Your Quote */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium whitespace-nowrap">Your Quote</span>
          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden h-9">
            <span className="text-sm text-slate-400 pl-2 pr-0.5">{currencySymbol(currency)}</span>
            <Input
              data-testid="input-custom-quote"
              type="number"
              step="1"
              placeholder="0"
              className="h-9 text-sm w-[90px] border-0 shadow-none focus-visible:ring-0 px-1"
              value={customQuoteAmount}
              onChange={(e) => setCustomQuoteAmount(e.target.value)}
            />
          </div>
          {/* Margin % indicator */}
          {pricingAdvice?.customQuote ? (
            <div className="flex items-center gap-0.5 ml-0.5">
              <span className="text-xs font-bold">{pricingAdvice.customQuote.marginPercent.toFixed(1)}%</span>
              <span className={`text-[10px] ${marginQualityLabel(pricingAdvice.customQuote.marginPercent).color}`}>
                {marginQualityLabel(pricingAdvice.customQuote.marginPercent).label}
              </span>
            </div>
          ) : customQuoteAmount && carrierCost > 0 ? (
            (() => {
              const amt = parseFloat(customQuoteAmount);
              if (!isNaN(amt) && amt > 0) {
                const pct = ((amt - accessorialTotal - carrierCost) / carrierCost) * 100;
                const q = marginQualityLabel(pct);
                return (
                  <div className="flex items-center gap-0.5 ml-0.5">
                    <span className="text-xs font-bold">{pct.toFixed(1)}%</span>
                    <span className={`text-[10px] ${q.color}`}>{q.label}</span>
                  </div>
                );
              }
              return null;
            })()
          ) : null}
        </div>
        {/* Note field */}
        <div className="relative flex-1">
          <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <Input
            data-testid="input-customer-note"
            placeholder={"Note \u2014 RFQ#, customer, lane memo..."}
            className="h-9 text-sm pl-8 border-slate-200"
            value={customerNote}
            onChange={(e) => setCustomerNote(e.target.value)}
            disabled={!routeCalcExists || carrierCost <= 0}
          />
        </div>
        <Button
          data-testid="button-save-quote"
          size="sm"
          className="h-9 w-[160px] bg-orange-400 hover:bg-orange-500 text-white gap-1.5 shrink-0 justify-center"
          disabled={isSavingQuote || !routeCalcExists || carrierCost <= 0}
          onClick={onSaveQuote}
        >
          {isSavingQuote ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save Quote
        </Button>
        {lastSavedQuote && canSharePdf && (
          canExportPdf ? (
            <Button
              data-testid="button-share-pdf"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 shrink-0 border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={onOpenPdfDialog}
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
            </Button>
          ) : (
            <Button
              data-testid="button-share-pdf"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 shrink-0 text-muted-foreground"
              onClick={onUpgradePdf}
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
              <Badge variant="outline" className="text-[9px] ml-0.5 border-orange-300 text-orange-600">Pro</Badge>
            </Button>
          )
        )}
      </div>
    </>
  );
});
