import type { CostProfile } from "@shared/schema";
import { convertCurrency, type SupportedCurrency } from "@/lib/currency";

export const CONNECT_GUEST_UID = "__connect_guest__";
export const CONNECT_GUEST_COMPANY_ID = "__connect_guest_co__";
export const CONNECT_GUEST_PROFILE_ID = "guest-quick-start";

/** Unified shipbungee.com/connect build: allow calculator without Firebase sign-in. */
export function isConnectGuestBuild(): boolean {
  return (
    import.meta.env.VITE_CONNECT_GUEST_MODE === "true" ||
    import.meta.env.VITE_CONNECT_GUEST_MODE === "1"
  );
}

export function isConnectGuestUser(user: { uid: string } | null | undefined): boolean {
  return !!user && user.uid === CONNECT_GUEST_UID;
}

export function connectGuestAppUser() {
  return {
    uid: CONNECT_GUEST_UID,
    name: "Guest",
    email: "",
    companyName: "Guest",
    companyId: CONNECT_GUEST_COMPANY_ID,
    sector: "carriers" as const,
    role: "user" as const,
    operatingCountryCode: "CA",
    measurementUnit: "metric" as const,
  };
}

/** Same defaults as CostProfileWizard quick start, in the given display currency. */
export function buildConnectGuestQuickProfile(currency: SupportedCurrency): CostProfile {
  const cx = (v: number) => Math.round(convertCurrency(v, "USD", currency) * 100) / 100;
  return {
    id: CONNECT_GUEST_PROFILE_ID,
    name: "Quick Start Profile",
    truckType: "dry_van",
    monthlyTruckPayment: cx(2500),
    monthlyInsurance: cx(1200),
    monthlyMaintenance: cx(600),
    monthlyPermitsPlates: cx(200),
    monthlyOther: cx(150),
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: cx(25),
    driverPayPerMile: cx(0.65),
    deadheadPayPercent: 80,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: cx(60),
    currency,
    createdAt: new Date().toISOString(),
  };
}

const GUEST_DECLINED_KEY = "bungee_connect_guest_declined";

export function readConnectGuestDeclined(): boolean {
  try {
    return sessionStorage.getItem(GUEST_DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setConnectGuestDeclined(declined: boolean): void {
  try {
    if (declined) sessionStorage.setItem(GUEST_DECLINED_KEY, "1");
    else sessionStorage.removeItem(GUEST_DECLINED_KEY);
  } catch {
    /* ignore */
  }
}
