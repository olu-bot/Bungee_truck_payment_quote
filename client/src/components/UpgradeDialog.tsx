/**
 * UpgradeDialog.tsx
 *
 * Reusable paywall / upgrade dialog that shows the three pricing tiers
 * and handles Stripe Checkout redirects. Drop this into any page that
 * needs to prompt users to upgrade.
 *
 * Usage:
 *   <UpgradeDialog
 *     open={showPaywall}
 *     onOpenChange={setShowPaywall}
 *     title="Upgrade to invite team members"
 *     description="Your Free plan is limited to 1 user."
 *   />
 */

import { useState } from "react";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Lock } from "lucide-react";

// ── Props ────────────────────────────────────────────────────────

export type UpgradeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Headline shown above the pricing grid. */
  title?: string;
  /** Subtitle / explanation. */
  description?: string;
};

// ── Feature lists for each tier ──────────────────────────────────

const FREE_FEATURES = [
  "300 route quotes per month",
  "AI Chatbot",
  "Map visualization",
  "3-tier pricing suggestion",
  "2 cost profiles",
  "1 yard",
  "1 user",
  "Custom quote",
  "Quote history up to 30 days",
  "Quote status tracking",
  "Accessorial charges",
  "Live fuel price updates",
];

const PRO_FEATURES = [
  "Everything in free plus",
  "Unlimited cost profiles",
  "Unlimited route quotes",
  "Unlimited quote history",
  "Unlimited yards",
  "5 users",
  "Role based access",
  "CSV export",
  "Branded PDF quote export",
];

const PREMIUM_FEATURES: { text: string; comingSoon?: boolean }[] = [
  { text: "Everything in pro plus" },
  { text: "Unlimited users - $15 per seat after 5 users" },
  { text: "Lane rate intelligence" },
  { text: "Customer quote portal" },
  { text: "Dispatch view" },
  { text: "API access" },
  { text: "Priority support" },
];

// ── Component ───────────────────────────────────────────────────

export function UpgradeDialog({
  open,
  onOpenChange,
  title = "Upgrade your plan",
  description = "Unlock more features to grow your business.",
}: UpgradeDialogProps) {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const [billingPeriod, setBillingPeriod] = useState<"month" | "year">("month");
  const [checkoutTier, setCheckoutTier] = useState<"free" | "pro" | "premium" | null>(null);

  async function startStripeCheckout(tier: "free" | "pro" | "premium") {
    if (tier === "free") {
      onOpenChange(false);
      return;
    }
    setCheckoutTier(tier);
    try {
      const tierForApi = tier === "premium" ? "fleet" : tier;
      const res = await apiRequest("POST", "/api/stripe/create-checkout-session", {
        tier: tierForApi,
        billingPeriod,
        customerEmail: user?.email ?? undefined,
        clientReferenceId: user?.uid ?? undefined,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.error) {
        toast({ title: "Checkout unavailable", description: data.error, variant: "destructive" });
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      toast({ title: "Checkout failed", description: "No redirect URL from Stripe.", variant: "destructive" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      toast({ title: "Checkout failed", description: msg, variant: "destructive" });
    } finally {
      setCheckoutTier(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] max-w-4xl gap-0 overflow-y-auto p-0 sm:max-w-4xl"
      >
        {/* ── Header ── */}
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
              <Lock className="h-6 w-6 text-slate-500" />
            </div>
          </div>
          <DialogHeader className="space-y-2 text-center">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <DialogDescription className="mx-auto max-w-2xl text-pretty text-center text-xs text-slate-500">
              {description}
            </DialogDescription>
          </DialogHeader>

          {/* Billing toggle */}
          <div className="mt-5 flex justify-center">
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50/30 p-1">
              <button
                type="button"
                className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                  billingPeriod === "month" ? "bg-orange-400 text-white" : "text-slate-500 hover:text-slate-900"
                }`}
                onClick={() => setBillingPeriod("month")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                  billingPeriod === "year" ? "bg-orange-400 text-white" : "text-slate-500 hover:text-slate-900"
                }`}
                onClick={() => setBillingPeriod("year")}
              >
                Yearly <span className="text-[10px] font-semibold text-green-600 ml-1">Save up to 28%</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Pricing grid ── */}
        <div className="grid gap-6 p-4 sm:grid-cols-3">
          {/* Free */}
          <Card className="flex flex-col border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold tracking-tight">Free</CardTitle>
              <p className="text-2xl font-bold tracking-tight">
                $0 <span className="text-base font-normal text-slate-500">/ month</span>
              </p>
              <CardDescription className="text-xs text-slate-500 leading-snug">
                For owner-operators and small carriers getting started.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 pt-0">
              <ul className="space-y-2.5 text-sm text-slate-500">
                {FREE_FEATURES.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto flex-col gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={checkoutTier !== null}
                onClick={() => startStripeCheckout("free")}
              >
                Subscribe
              </Button>
            </CardFooter>
          </Card>

          {/* Pro — highlighted */}
          <Card className="flex flex-col border-orange-400 shadow-md ring-1 ring-orange-400/20">
            <CardHeader className="pb-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold tracking-tight">Pro</CardTitle>
                <Badge className="bg-orange-400 text-white text-[10px] uppercase border-0">Most Popular</Badge>
              </div>
              <p className="text-2xl font-bold tracking-tight">
                {billingPeriod === "month" ? "$29" : "$20.75"}{" "}
                <span className="text-base font-normal text-slate-500">/ month</span>
              </p>
              {billingPeriod === "year" && (
                <p className="text-xs text-slate-500">$249 billed annually</p>
              )}
              <CardDescription className="text-xs text-slate-500 leading-snug">
                For growing fleets that need more power and branded quotes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 pt-0">
              <ul className="space-y-2.5 text-sm text-slate-500">
                {PRO_FEATURES.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto flex-col gap-2 pt-2">
              <Button
                type="button"
                className="w-full bg-orange-400 hover:bg-orange-500 text-white"
                disabled={checkoutTier !== null}
                onClick={() => startStripeCheckout("pro")}
              >
                {checkoutTier === "pro" ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting…</>
                ) : (
                  `Start trial`
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Premium */}
          <Card className="flex flex-col border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold tracking-tight">Premium</CardTitle>
              <p className="text-2xl font-bold tracking-tight">
                {billingPeriod === "month" ? "$59" : "$45.75"}{" "}
                <span className="text-base font-normal text-slate-500">/ month</span>
              </p>
              {billingPeriod === "year" && (
                <p className="text-xs text-slate-500">$549 billed annually</p>
              )}
              <CardDescription className="text-xs text-slate-500 leading-snug">
                For fleets needing unlimited team, analytics, and priority support.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 pt-0">
              <ul className="space-y-2.5 text-sm text-slate-500">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f.text} className="flex gap-2">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${f.comingSoon ? "text-slate-300" : "text-green-600"}`} aria-hidden />
                    <span className={f.comingSoon ? "text-slate-400" : ""}>
                      {f.text}
                      {f.comingSoon && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
                          Coming Soon
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto flex-col gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={checkoutTier !== null}
                onClick={() => startStripeCheckout("premium")}
              >
                {checkoutTier === "premium" ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting…</>
                ) : (
                  `Subscribe`
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <DialogFooter className="border-t border-slate-200 px-4 py-4">
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
