import { describe, it, expect } from "vitest";
import {
  getUserTier,
  isPaid,
  canUseAnalytics,
  canUseLaneIntelligence,
} from "./subscription";
import type { AppUser } from "@/components/firebase-auth";

function makeUser(tier: "free" | "pro" | "fleet"): AppUser {
  return {
    uid: "u1",
    name: "Test",
    email: "test@example.com",
    companyName: "Test Co",
    sector: "brokers",
    role: "admin",
    subscriptionTier: tier,
  } as AppUser;
}

describe("canUseAnalytics", () => {
  it("returns false for free tier", () => {
    expect(canUseAnalytics(makeUser("free"))).toBe(false);
    expect(canUseAnalytics(null)).toBe(false);
  });
  it("returns true for pro", () => {
    expect(canUseAnalytics(makeUser("pro"))).toBe(true);
  });
  it("returns true for fleet", () => {
    expect(canUseAnalytics(makeUser("fleet"))).toBe(true);
  });
});

describe("canUseLaneIntelligence", () => {
  it("returns false for free tier", () => {
    expect(canUseLaneIntelligence(makeUser("free"))).toBe(false);
  });
  it("returns true for pro", () => {
    expect(canUseLaneIntelligence(makeUser("pro"))).toBe(true);
  });
  it("returns true for fleet", () => {
    expect(canUseLaneIntelligence(makeUser("fleet"))).toBe(true);
  });
});
