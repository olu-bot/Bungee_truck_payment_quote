import { randomUUID } from "crypto";
import type { CostProfile, HourlyRate, Lane, Quote, RateTable, SavedRoute, TeamMember, Yard } from "@shared/schema";
import {
  insertCostProfileSchema,
  insertLaneSchema,
  insertTeamMemberSchema,
  insertYardSchema,
} from "@shared/schema";
import type { z } from "zod";

type InsertCostProfile = z.infer<typeof insertCostProfileSchema>;
type InsertYard = z.infer<typeof insertYardSchema>;
type InsertTeam = z.infer<typeof insertTeamMemberSchema>;
type InsertLane = z.infer<typeof insertLaneSchema>;

function defaultRates(): RateTable[] {
  return [
    { truckType: "dry_van", ratePerMile: 2.4, fuelSurchargePercent: 18, minCharge: 350 },
    { truckType: "reefer", ratePerMile: 2.85, fuelSurchargePercent: 22, minCharge: 450 },
    { truckType: "flatbed", ratePerMile: 2.65, fuelSurchargePercent: 20, minCharge: 400 },
  ];
}

function defaultHourly(): HourlyRate[] {
  return [
    {
      truckType: "dry_van",
      driverPayPerHour: 28,
      truckCostPerHour: 18,
      insurancePerHour: 4,
      maintenancePerHour: 3,
      miscPerHour: 2,
      fuelPerKm: 0.42,
      citySpeedKmh: 45,
      detentionRatePerHour: 75,
    },
    {
      truckType: "reefer",
      driverPayPerHour: 32,
      truckCostPerHour: 22,
      insurancePerHour: 5,
      maintenancePerHour: 4,
      miscPerHour: 2.5,
      fuelPerKm: 0.52,
      citySpeedKmh: 42,
      detentionRatePerHour: 85,
    },
    {
      truckType: "flatbed",
      driverPayPerHour: 30,
      truckCostPerHour: 20,
      insurancePerHour: 4.5,
      maintenancePerHour: 3.5,
      miscPerHour: 2.2,
      fuelPerKm: 0.48,
      citySpeedKmh: 44,
      detentionRatePerHour: 80,
    },
  ];
}

class MemStorage {
  private profiles = new Map<string, CostProfile>();
  private yards = new Map<string, Yard>();
  private team = new Map<string, TeamMember>();
  private routes = new Map<string, SavedRoute>();
  private lanes = new Map<string, Lane>();
  private quotes = new Map<string, Quote>();
  private rateTables: RateTable[] = defaultRates();
  private hourlyRates: HourlyRate[] = defaultHourly();

  async getCostProfiles(): Promise<CostProfile[]> {
    return [...this.profiles.values()];
  }

  async getCostProfile(id: string): Promise<CostProfile | undefined> {
    return this.profiles.get(id);
  }

  async createCostProfile(data: InsertCostProfile): Promise<CostProfile> {
    const id = randomUUID().slice(0, 12);
    const createdAt = data.createdAt ?? new Date().toISOString();
    const row: CostProfile = { ...data, id, createdAt } as CostProfile;
    this.profiles.set(id, row);
    return row;
  }

  async updateCostProfile(id: string, data: Partial<CostProfile>): Promise<CostProfile | undefined> {
    const cur = this.profiles.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...data, id: cur.id } as CostProfile;
    this.profiles.set(id, next);
    return next;
  }

  async deleteCostProfile(id: string): Promise<boolean> {
    return this.profiles.delete(id);
  }

  async getYards(): Promise<Yard[]> {
    return [...this.yards.values()];
  }

  async createYard(data: InsertYard): Promise<Yard> {
    const id = randomUUID().slice(0, 12);
    const row: Yard = { ...data, id } as Yard;
    this.yards.set(id, row);
    return row;
  }

  async updateYard(id: string, data: Partial<Yard>): Promise<Yard | undefined> {
    const cur = this.yards.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...data, id: cur.id } as Yard;
    this.yards.set(id, next);
    return next;
  }

  async deleteYard(id: string): Promise<boolean> {
    return this.yards.delete(id);
  }

  async getTeamMembers(): Promise<TeamMember[]> {
    return [...this.team.values()];
  }

  async createTeamMember(data: InsertTeam): Promise<TeamMember> {
    const id = randomUUID().slice(0, 12);
    const createdAt = data.createdAt ?? new Date().toISOString();
    const row: TeamMember = { ...data, id, createdAt } as TeamMember;
    this.team.set(id, row);
    return row;
  }

  async updateTeamMember(id: string, data: Partial<TeamMember>): Promise<TeamMember | undefined> {
    const cur = this.team.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...data, id: cur.id } as TeamMember;
    this.team.set(id, next);
    return next;
  }

  async deleteTeamMember(id: string): Promise<boolean> {
    return this.team.delete(id);
  }

  async authenticateByPin(pin: string): Promise<TeamMember | undefined> {
    return [...this.team.values()].find((m) => m.pin === pin);
  }

  async getRoutes(): Promise<SavedRoute[]> {
    return [...this.routes.values()];
  }

  async createRoute(body: Record<string, unknown>): Promise<SavedRoute> {
    const id = randomUUID().slice(0, 12);
    const createdAt = new Date().toISOString();
    const row = { ...body, id, createdAt } as SavedRoute;
    this.routes.set(id, row);
    return row;
  }

  async deleteRoute(id: string): Promise<boolean> {
    return this.routes.delete(id);
  }

  async getLanes(): Promise<Lane[]> {
    return [...this.lanes.values()];
  }

  async getLane(id: string): Promise<Lane | undefined> {
    return this.lanes.get(id);
  }

  async createLane(data: InsertLane): Promise<Lane> {
    const id = randomUUID().slice(0, 12);
    const row: Lane = { ...data, id } as Lane;
    this.lanes.set(id, row);
    return row;
  }

  async deleteLane(id: string): Promise<boolean> {
    return this.lanes.delete(id);
  }

  async getQuotes(): Promise<Quote[]> {
    return [...this.quotes.values()];
  }

  async createQuote(data: Omit<Quote, "id"> & { id?: string }): Promise<Quote> {
    const id = data.id ?? randomUUID().slice(0, 12);
    const row = { ...data, id } as Quote;
    this.quotes.set(id, row);
    return row;
  }

  async deleteQuote(id: string): Promise<boolean> {
    return this.quotes.delete(id);
  }

  async getRates(): Promise<RateTable[]> {
    return this.rateTables.map((r) => ({ ...r }));
  }

  async updateRate(truckType: string, patch: Partial<RateTable>): Promise<RateTable | undefined> {
    const idx = this.rateTables.findIndex((r) => r.truckType === truckType);
    if (idx < 0) return undefined;
    this.rateTables[idx] = { ...this.rateTables[idx], ...patch, truckType };
    return { ...this.rateTables[idx] };
  }

  async getHourlyRates(): Promise<HourlyRate[]> {
    return this.hourlyRates.map((r) => ({ ...r }));
  }

  async updateHourlyRate(truckType: string, patch: Partial<HourlyRate>): Promise<HourlyRate | undefined> {
    const idx = this.hourlyRates.findIndex((r) => r.truckType === truckType);
    if (idx < 0) return undefined;
    this.hourlyRates[idx] = { ...this.hourlyRates[idx], ...patch, truckType };
    return { ...this.hourlyRates[idx] };
  }
}

export const storage = new MemStorage();
