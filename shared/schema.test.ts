import { describe, it, expect } from "vitest";
import {
  routeStopSchema,
  calculateRouteSchema,
  pricingTiersSchema,
  chatRouteSchema,
  insertCostProfileSchema,
  insertYardSchema,
  insertTeamMemberSchema,
  insertLaneSchema,
} from "./schema";

// ── routeStopSchema ─────────────────────────────────────────────

describe("routeStopSchema", () => {
  it("validates a complete route stop", () => {
    const result = routeStopSchema.safeParse({
      id: "s1",
      type: "pickup",
      location: "Toronto, ON",
      lat: 43.65,
      lng: -79.38,
      dockTimeMinutes: 30,
      distanceFromPrevKm: 100,
      driveMinutesFromPrev: 60,
    });
    expect(result.success).toBe(true);
  });

  it("validates with only required fields", () => {
    const result = routeStopSchema.safeParse({
      id: "s1",
      type: "delivery",
      location: "Montreal, QC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = routeStopSchema.safeParse({ id: "s1" });
    expect(result.success).toBe(false);
  });
});

// ── calculateRouteSchema ────────────────────────────────────────

describe("calculateRouteSchema", () => {
  it("validates a route calculation request", () => {
    const result = calculateRouteSchema.safeParse({
      profileId: "p1",
      stops: [
        { id: "s1", type: "pickup", location: "A" },
        { id: "s2", type: "delivery", location: "B" },
      ],
      includeReturn: true,
      fuelPricePerLitre: 1.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing profileId", () => {
    const result = calculateRouteSchema.safeParse({
      stops: [],
      includeReturn: false,
      fuelPricePerLitre: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ── pricingTiersSchema ──────────────────────────────────────────

describe("pricingTiersSchema", () => {
  it("validates with required totalCost", () => {
    expect(pricingTiersSchema.safeParse({ totalCost: 500 }).success).toBe(true);
  });

  it("validates with optional custom fields", () => {
    const result = pricingTiersSchema.safeParse({
      totalCost: 500,
      customMarginPercent: 25,
      customQuoteAmount: 750,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing totalCost", () => {
    expect(pricingTiersSchema.safeParse({}).success).toBe(false);
  });
});

// ── chatRouteSchema ─────────────────────────────────────────────

describe("chatRouteSchema", () => {
  it("validates a chat message", () => {
    expect(chatRouteSchema.safeParse({ message: "Toronto to Montreal" }).success).toBe(true);
  });

  it("validates with optional dockTimeMinutes", () => {
    expect(chatRouteSchema.safeParse({ message: "A to B", dockTimeMinutes: 45 }).success).toBe(true);
  });

  it("rejects empty message", () => {
    expect(chatRouteSchema.safeParse({ message: "" }).success).toBe(false);
  });
});

// ── insertCostProfileSchema ─────────────────────────────────────

describe("insertCostProfileSchema", () => {
  const validProfile = {
    name: "My Truck",
    truckType: "dry_van",
    monthlyTruckPayment: 1500,
    monthlyInsurance: 800,
    monthlyMaintenance: 400,
    monthlyPermitsPlates: 200,
    monthlyOther: 100,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: 25,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: 50,
  };

  it("validates a complete cost profile", () => {
    expect(insertCostProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("validates with optional advanced fields", () => {
    const result = insertCostProfileSchema.safeParse({
      ...validProfile,
      driverPayPerMile: 0.55,
      deadheadPayPercent: 75,
      monthlyTrailerLease: 500,
      monthlyEldTelematics: 100,
      currency: "CAD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(insertCostProfileSchema.safeParse({ name: "Test" }).success).toBe(false);
  });
});

// ── insertYardSchema ────────────────────────────────────────────

describe("insertYardSchema", () => {
  it("validates a yard", () => {
    expect(insertYardSchema.safeParse({
      name: "Main Yard",
      address: "123 Industrial Ave",
    }).success).toBe(true);
  });

  it("validates with optional coords", () => {
    expect(insertYardSchema.safeParse({
      name: "Yard",
      address: "Addr",
      lat: 43.65,
      lng: -79.38,
      isDefault: true,
    }).success).toBe(true);
  });

  it("rejects missing address", () => {
    expect(insertYardSchema.safeParse({ name: "Yard" }).success).toBe(false);
  });
});

// ── insertTeamMemberSchema ──────────────────────────────────────

describe("insertTeamMemberSchema", () => {
  it("validates a team member", () => {
    expect(insertTeamMemberSchema.safeParse({
      name: "John",
      role: "member",
      pin: "1234",
    }).success).toBe(true);
  });

  it("rejects missing pin", () => {
    expect(insertTeamMemberSchema.safeParse({
      name: "John",
      role: "member",
    }).success).toBe(false);
  });
});

// ── insertLaneSchema ────────────────────────────────────────────

describe("insertLaneSchema", () => {
  it("validates a lane", () => {
    expect(insertLaneSchema.safeParse({
      origin: "Toronto",
      destination: "Montreal",
      truckType: "dry_van",
      fixedPrice: 2500,
      estimatedMiles: 335,
    }).success).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(insertLaneSchema.safeParse({
      origin: "Toronto",
      destination: "Montreal",
    }).success).toBe(false);
  });
});
