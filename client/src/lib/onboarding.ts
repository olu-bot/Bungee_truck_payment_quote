import { safeStorageGet, safeStorageSet } from "@/lib/safeStorage";

const ACTIVE_KEY = "bungee_onboarding_active";
const STEP_KEY = "bungee_onboarding_step";

export function isOnboardingActive(): boolean {
  return safeStorageGet(ACTIVE_KEY, "session") === "1";
}

export function setOnboardingActive(active: boolean): void {
  safeStorageSet(ACTIVE_KEY, active ? "1" : "0", "session");
}

export function getOnboardingStep(): number {
  const v = safeStorageGet(STEP_KEY, "session");
  return v ? Number(v) || 1 : 1;
}

export function setOnboardingStep(step: number): void {
  safeStorageSet(STEP_KEY, String(step), "session");
}
