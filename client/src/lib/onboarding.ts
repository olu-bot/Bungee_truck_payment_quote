const ACTIVE_KEY = "bungee_onboarding_active";
const STEP_KEY = "bungee_onboarding_step";

export function isOnboardingActive(): boolean {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOnboardingActive(active: boolean): void {
  try {
    sessionStorage.setItem(ACTIVE_KEY, active ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getOnboardingStep(): number {
  try {
    const v = sessionStorage.getItem(STEP_KEY);
    return v ? Number(v) || 1 : 1;
  } catch {
    return 1;
  }
}

export function setOnboardingStep(step: number): void {
  try {
    sessionStorage.setItem(STEP_KEY, String(step));
  } catch {
    /* ignore */
  }
}
