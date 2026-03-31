import { describe, it, expect } from "vitest";
import {
  routeStopSchema,
  calculateRouteSchema,
  insertCostProfileSchema,
  insertYardSchema,
  insertTeamMemberSchema,
  insertLaneSchema,
  chatRouteSchema,
} from "./schema";

describe("routeStopSchema", () => {
  it("accepts valid stop", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "pickup",
      location: "Toronto, ON",
      lat: 43.6532,
      lng: -79.3832,
    });
    expect(result.success).toBe(true);
  });

  it("allows optional lat/lng", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "pickup",
      location: "Somewhere",
    });
    expect(result.success).toBe(true);
  });

  it("allows null lat/lng", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "delivery",
      location: "X",
      lat: null,
      lng: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = routeStopSchema.safeParse({
      type: "pickup",
      location: "Somewhere",
    });
    expect(result.success).toBe(false);
  });
});

describe("insertCostProfileSchema", () => {
  const validProfile = {
    name: "Test",
    truckType: "dry_van",
    monthlyTruckPayment: 2000,
    monthlyInsurance: 800,
    monthlyMaintenance: 500,
    monthlyPermitsPlates: 200,
    monthlyOther: 100,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: 25,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: 75,
  };

  it("accepts valid profile", () => {
    expect(insertCostProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("accepts optional advanced fields", () => {
    const result = insertCostProfileSchema.safeParse({
      ...validProfile,
      monthlyTrailerLease: 500,
      monthlyEldTelematics: 50,
      driverPayPerMile: 0.55,
      currency: "CAD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field", () => {
    const { name, ...noName } = validProfile;
    expect(insertCostProfileSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects string where number expected", () => {
    const result = insertCostProfileSchema.safeParse({
      ...validProfile,
      monthlyTruckPayment: "two thousand",
    });
    expect(result.success).toBe(false);
  });
});

describe("chatRouteSchema", () => {
  it("accepts valid message", () => {
    expect(chatRouteSchema.safeParse({ message: "Toronto to Montreal" }).success).toBe(true);
  });

  it("rejects empty message", () => {
    expect(chatRouteSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("accepts optional dockTimeMinutes", () => {
    expect(chatRouteSchema.safeParse({ message: "A to B", dockTimeMinutes: 30 }).success).toBe(true);
  });
});

describe("insertYardSchema", () => {
  it("accepts valid yard", () => {
    expect(insertYardSchema.safeParse({
      name: "Main Yard",
      address: "123 Main St",
    }).success).toBe(true);
  });
});

describe("insertTeamMemberSchema", () => {
  it("accepts valid team member", () => {
    expect(insertTeamMemberSchema.safeParse({
      name: "John",
      role: "driver",
      pin: "1234",
    }).success).toBe(true);
  });
});

describe("insertLaneSchema", () => {
  it("accepts valid lane", () => {
    expect(insertLaneSchema.safeParse({
      origin: "Toronto",
      destination: "Montreal",
      truckType: "dry_van",
      fixedPrice: 1500,
      estimatedMiles: 340,
    }).success).toBe(true);
  });
});
