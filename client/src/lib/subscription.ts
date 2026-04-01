/**
 * subscription.ts
 *
 * Central utility for subscription-tier checks and feature gating.
 * All paywall decisions should flow through this module so limits
 * stay consistent across the app.
 *
 * Tiers (matches Stripe pricing):
 *   free  — $0/mo   — limited features
 *   pro   — $29/mo  — most professional features
 *   fleet — $59/mo  — shown as "Premium", everything unlocked
 *
 * ┌──────────────────────┬────────┬────────┬──────────┐
 * │ Feature              │ Free   │ Pro    │ Premium  │
 * ├──────────────────────┼────────┼────────┼──────────┤
 * │ Cost profiles        │ 2      │ ∞      │ ∞        │
 * │ Yards                │ 1      │ ∞      │ ∞        │
 * │ Team members         │ 1      │ 5      │ ∞        │
 * │ Favorite lanes       │ 5      │ 20     │ ∞        │
 * │ Monthly route quotes  │ 300    │ ∞      │ ∞        │
 * │ Quote history        │ 30 day │ ∞      │ ∞        │
 * │ Branded PDF export   │ ✗      │ ✓      │ ✓        │
 * │ PDF template editor  │ ✗      │ ✓      │ ✓        │
 * │ CSV export           │ ✗      │ ✓      │ ✓        │
 * │ IFTA fuel tax         │ ✗      │ ✓      │ ✓        │
 * │ Live fuel prices     │ ✓      │ ✓      │ ✓        │
 * └──────────────────────┴────────┴────────┴──────────┘
 */

import type { AppUser } from "@/components/firebase-auth";

// ── Tier helpers ────────────────────────────────────────────────

export type SubscriptionTier = "free" | "pro" | "fleet";

export function getUserTier(user: AppUser | null | undefined): SubscriptionTier {
  if (!user) return "free";
  const t = user.subscriptionTier;
  if (t === "pro" || t === "fleet") return t;
  return "free";
}

export function isPaid(user: AppUser | null | undefined): boolean {
  const t = getUserTier(user);
  return t === "pro" || t === "fleet";
}

export function isPro(user: AppUser | null | undefined): boolean {
  return getUserTier(user) === "pro";
}

export function isFleet(user: AppUser | null | undefined): boolean {
  return getUserTier(user) === "fleet";
}

// ── Feature limits (return -1 for unlimited) ────────────────────

export function costProfileLimit(user: AppUser | null | undefined): number {
  return isPaid(user) ? -1 : 2;
}

export function yardLimit(user: AppUser | null | undefined): number {
  return isPaid(user) ? -1 : 1;
}

export function teamMemberLimit(user: AppUser | null | undefined): number {
  const t = getUserTier(user);
  if (t === "fleet") return -1;  // unlimited
  if (t === "pro") return 5;
  return 1;                       // free — just the owner
}

export function favLaneLimit(user: AppUser | null | undefined): number {
  const t = getUserTier(user);
  if (t === "fleet") return -1;  // unlimited
  if (t === "pro") return 20;
  return 5;                       // free
}

/** Monthly route-quote limit. -1 = unlimited. */
export function monthlyQuoteLimit(user: AppUser | null | undefined): number {
  return isPaid(user) ? -1 : 300;
}

/** Quote history retention in days. -1 = unlimited. */
export function quoteHistoryDays(user: AppUser | null | undefined): number {
  return isPaid(user) ? -1 : 30;
}

// ── Feature gates ───────────────────────────────────────────────

/** Whether the user can invite team members (paid only). */
export function canInviteTeam(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can export quotes as branded PDF. */
export function canExportPdf(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can customize the PDF template settings. */
export function canCustomizePdfTemplate(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can export CSV. */
export function canExportCsv(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can see the IFTA fuel tax breakdown on routes. */
export function canUseIFTA(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can view the Analytics dashboard tab (charts, KPIs). Pro/Premium only. */
export function canUseAnalytics(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

/** Whether the user can see lane intelligence hints in route builder. Pro/Premium only. */
export function canUseLaneIntelligence(user: AppUser | null | undefined): boolean {
  return isPaid(user);
}

// ── Display helpers ─────────────────────────────────────────────

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  pro: "Pro",
  fleet: "Premium",
};

export function tierLabel(user: AppUser | null | undefined): string {
  return TIER_LABELS[getUserTier(user)];
}

/** Human-readable limit string, e.g. "5" or "Unlimited". */
export function limitLabel(n: number): string {
  return n === -1 ? "Unlimited" : String(n);
}
