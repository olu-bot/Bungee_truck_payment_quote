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
  tierLabel,
  limitLabel,
} from "./subscription";
import type { AppUser } from "@/components/firebase-auth";

function makeUser(tier?: string): AppUser {
  return {
    uid: "u1",
    email: "a@b.com",
    displayName: "Test",
    role: "user",
    companyRole: "owner",
    subscriptionTier: tier,
  } as AppUser;
}

describe("getUserTier", () => {
  it("returns 'free' for null/undefined user", () => {
    expect(getUserTier(null)).toBe("free");
    expect(getUserTier(undefined)).toBe("free");
  });

  it("returns 'free' for users with no tier or unknown tier", () => {
    expect(getUserTier(makeUser())).toBe("free");
    expect(getUserTier(makeUser("unknown"))).toBe("free");
  });

  it("returns correct tier for pro and fleet", () => {
    expect(getUserTier(makeUser("pro"))).toBe("pro");
    expect(getUserTier(makeUser("fleet"))).toBe("fleet");
  });
});

describe("tier checks", () => {
  it("isPaid is true for pro and fleet", () => {
    expect(isPaid(makeUser("pro"))).toBe(true);
    expect(isPaid(makeUser("fleet"))).toBe(true);
    expect(isPaid(makeUser())).toBe(false);
    expect(isPaid(null)).toBe(false);
  });

  it("isPro / isFleet are mutually exclusive", () => {
    expect(isPro(makeUser("pro"))).toBe(true);
    expect(isFleet(makeUser("pro"))).toBe(false);
    expect(isFleet(makeUser("fleet"))).toBe(true);
    expect(isPro(makeUser("fleet"))).toBe(false);
  });
});

describe("limits", () => {
  it("free tier has restricted limits", () => {
    const free = makeUser();
    expect(costProfileLimit(free)).toBe(2);
    expect(yardLimit(free)).toBe(1);
    expect(teamMemberLimit(free)).toBe(1);
    expect(favLaneLimit(free)).toBe(5);
    expect(monthlyQuoteLimit(free)).toBe(300);
    expect(quoteHistoryDays(free)).toBe(30);
  });

  it("pro tier has expanded limits", () => {
    const pro = makeUser("pro");
    expect(costProfileLimit(pro)).toBe(-1);
    expect(yardLimit(pro)).toBe(-1);
    expect(teamMemberLimit(pro)).toBe(5);
    expect(favLaneLimit(pro)).toBe(20);
    expect(monthlyQuoteLimit(pro)).toBe(-1);
    expect(quoteHistoryDays(pro)).toBe(-1);
  });

  it("fleet tier has unlimited everything", () => {
    const fleet = makeUser("fleet");
    expect(teamMemberLimit(fleet)).toBe(-1);
    expect(favLaneLimit(fleet)).toBe(-1);
  });
});

describe("feature gates", () => {
  it("free users cannot access paid features", () => {
    const free = makeUser();
    expect(canInviteTeam(free)).toBe(false);
    expect(canExportPdf(free)).toBe(false);
    expect(canExportCsv(free)).toBe(false);
  });

  it("paid users can access paid features", () => {
    const pro = makeUser("pro");
    expect(canInviteTeam(pro)).toBe(true);
    expect(canExportPdf(pro)).toBe(true);
    expect(canExportCsv(pro)).toBe(true);
  });
});

describe("display helpers", () => {
  it("tierLabel returns correct labels", () => {
    expect(tierLabel(makeUser())).toBe("Free");
    expect(tierLabel(makeUser("pro"))).toBe("Pro");
    expect(tierLabel(makeUser("fleet"))).toBe("Premium");
  });

  it("limitLabel shows 'Unlimited' for -1", () => {
    expect(limitLabel(-1)).toBe("Unlimited");
    expect(limitLabel(5)).toBe("5");
    expect(limitLabel(0)).toBe("0");
  });
});
