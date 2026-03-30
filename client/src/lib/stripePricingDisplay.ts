/** Response shape from GET /api/stripe/pricing-display */

export type StripePricingSlot = {
  amount: number;
  currency: string;
  interval: "month" | "year";
  /** For yearly prices: amount / 12 (major units), for display as “/ month” when yearly is selected */
  monthlyEquivalent?: number;
};

export type StripePricingDisplayResponse = {
  pro: { month: StripePricingSlot | null; year: StripePricingSlot | null };
  premium: { month: StripePricingSlot | null; year: StripePricingSlot | null };
};

export function formatMoney(amount: number, currency: string): string {
  const cur = currency.length === 3 ? currency.toUpperCase() : "USD";
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: cur,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
