import { describe, it, expect } from "vitest";
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
  canUseIFTA,
  tierLabel,
  limitLabel,
} from "./subscription";
import type { AppUser } from "@/components/firebase-auth";

function makeUser(tier?: string): AppUser {
  return { uid: "u1", email: "t@t.com", subscriptionTier: tier } as AppUser;
}

// ── Tier detection ──────────────────────────────────────────────

describe("getUserTier", () => {
  it("returns free for null/undefined user", () => {
    expect(getUserTier(null)).toBe("free");
    expect(getUserTier(undefined)).toBe("free");
  });

  it("returns correct tier for each subscription level", () => {
    expect(getUserTier(makeUser("free"))).toBe("free");
    expect(getUserTier(makeUser("pro"))).toBe("pro");
    expect(getUserTier(makeUser("fleet"))).toBe("fleet");
  });

  it("returns free for unknown tier values", () => {
    expect(getUserTier(makeUser("enterprise"))).toBe("free");
    expect(getUserTier(makeUser(undefined))).toBe("free");
  });
});

describe("tier booleans", () => {
  it("isPaid returns true for pro and fleet", () => {
    expect(isPaid(makeUser("pro"))).toBe(true);
    expect(isPaid(makeUser("fleet"))).toBe(true);
    expect(isPaid(makeUser("free"))).toBe(false);
    expect(isPaid(null)).toBe(false);
  });

  it("isPro/isFleet are specific", () => {
    expect(isPro(makeUser("pro"))).toBe(true);
    expect(isPro(makeUser("fleet"))).toBe(false);
    expect(isFleet(makeUser("fleet"))).toBe(true);
    expect(isFleet(makeUser("pro"))).toBe(false);
  });
});

// ── Feature limits ──────────────────────────────────────────────

describe("feature limits", () => {
  it("costProfileLimit: 2 free, unlimited paid", () => {
    expect(costProfileLimit(makeUser("free"))).toBe(2);
    expect(costProfileLimit(makeUser("pro"))).toBe(-1);
    expect(costProfileLimit(makeUser("fleet"))).toBe(-1);
  });

  it("yardLimit: 1 free, unlimited paid", () => {
    expect(yardLimit(makeUser("free"))).toBe(1);
    expect(yardLimit(makeUser("pro"))).toBe(-1);
  });

  it("teamMemberLimit: 1 free, 5 pro, unlimited fleet", () => {
    expect(teamMemberLimit(makeUser("free"))).toBe(1);
    expect(teamMemberLimit(makeUser("pro"))).toBe(5);
    expect(teamMemberLimit(makeUser("fleet"))).toBe(-1);
  });

  it("favLaneLimit: 5 free, 20 pro, unlimited fleet", () => {
    expect(favLaneLimit(makeUser("free"))).toBe(5);
    expect(favLaneLimit(makeUser("pro"))).toBe(20);
    expect(favLaneLimit(makeUser("fleet"))).toBe(-1);
  });

  it("monthlyQuoteLimit: 300 free, unlimited paid", () => {
    expect(monthlyQuoteLimit(makeUser("free"))).toBe(300);
    expect(monthlyQuoteLimit(makeUser("pro"))).toBe(-1);
  });

  it("quoteHistoryDays: 30 free, unlimited paid", () => {
    expect(quoteHistoryDays(makeUser("free"))).toBe(30);
    expect(quoteHistoryDays(makeUser("pro"))).toBe(-1);
  });
});

// ── Feature gates ───────────────────────────────────────────────

describe("feature gates", () => {
  it("canInviteTeam requires paid tier", () => {
    expect(canInviteTeam(makeUser("free"))).toBe(false);
    expect(canInviteTeam(makeUser("pro"))).toBe(true);
  });

  it("canExportPdf requires paid tier", () => {
    expect(canExportPdf(makeUser("free"))).toBe(false);
    expect(canExportPdf(makeUser("fleet"))).toBe(true);
  });

  it("canExportCsv requires paid tier", () => {
    expect(canExportCsv(makeUser("free"))).toBe(false);
    expect(canExportCsv(makeUser("pro"))).toBe(true);
  });

  it("canUseIFTA requires paid tier", () => {
    expect(canUseIFTA(makeUser("free"))).toBe(false);
    expect(canUseIFTA(null)).toBe(false);
    expect(canUseIFTA(makeUser("pro"))).toBe(true);
    expect(canUseIFTA(makeUser("fleet"))).toBe(true);
  });
});

// ── Display helpers ─────────────────────────────────────────────

describe("display helpers", () => {
  it("tierLabel returns human-readable names", () => {
    expect(tierLabel(makeUser("free"))).toBe("Free");
    expect(tierLabel(makeUser("pro"))).toBe("Pro");
    expect(tierLabel(makeUser("fleet"))).toBe("Premium");
  });

  it("limitLabel formats numbers and unlimited", () => {
    expect(limitLabel(5)).toBe("5");
    expect(limitLabel(-1)).toBe("Unlimited");
    expect(limitLabel(0)).toBe("0");
  });
});
