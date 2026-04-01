import { describe, it, expect } from "vitest";
import { canUseIFTA, isPaid, getUserTier } from "./subscription";
import type { AppUser } from "@/components/firebase-auth";

function makeUser(tier: "free" | "pro" | "fleet"): AppUser {
  return {
    uid: "test-uid",
    name: "Test User",
    email: "test@example.com",
    companyName: "Test Co",
    sector: "carriers",
    role: "user",
    subscriptionTier: tier,
  };
}

describe("canUseIFTA", () => {
  it("returns false for free tier", () => {
    expect(canUseIFTA(makeUser("free"))).toBe(false);
  });

  it("returns false for null/undefined user", () => {
    expect(canUseIFTA(null)).toBe(false);
    expect(canUseIFTA(undefined)).toBe(false);
  });

  it("returns true for pro tier", () => {
    expect(canUseIFTA(makeUser("pro"))).toBe(true);
  });

  it("returns true for fleet tier", () => {
    expect(canUseIFTA(makeUser("fleet"))).toBe(true);
  });
});
