import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import marketingHtml from "./landing-marketing.html?raw";
import "./landing.css";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import {
  getOnboardingStep,
  isOnboardingActive,
  setOnboardingActive,
  setOnboardingStep,
} from "@/lib/onboarding";
import { CostProfileWizard } from "@/components/CostProfileWizard";
import type { CostProfile } from "@shared/schema";
import { auth, db, firebaseConfigured } from "@/lib/firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import { currencyForCountryCode, currencySymbol } from "@/lib/currency";
import type { MeasurementUnit } from "@/lib/measurement";
import { City, State, type ICity } from "country-state-city";

/** User closed Google popup or dismissed it — not a sign-in failure */
function isGooglePopupCancelled(err: unknown): boolean {
  const anyErr = err as unknown as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown } | unknown;
  };

  const code =
    (anyErr && anyErr.code != null ? String(anyErr.code) : undefined) ??
    (anyErr?.error && typeof anyErr.error === "object" && "code" in anyErr.error
      ? String((anyErr.error as { code?: unknown }).code)
      : undefined);

  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  ) {
    return true;
  }

  const msg =
    (anyErr && anyErr.message != null ? String(anyErr.message) : undefined) ??
    (anyErr?.error && typeof anyErr.error === "object" && "message" in anyErr.error
      ? String((anyErr.error as { message?: unknown }).message)
      : undefined) ??
    (err instanceof Error ? err.message : String(err));

  return /popup closed by user|popup-closed-by-user|cancelled-popup-request|auth\/popup-closed-by-user/i.test(
    msg,
  );
}

type View = "landing" | "onboarding";
type AuthMode = "login" | "signup";

const FLEET_SIZE_OPTIONS = ["1 - 10", "11 - 20", "21 - 50", "51 - 100", "100+"];

const COUNTRY_OPTIONS = [
  { value: "CA", label: "Canada" },
  { value: "US", label: "USA" },
  { value: "MX", label: "Mexico" },
] as const;

const MEASUREMENT_UNIT_OPTIONS: { value: MeasurementUnit; label: string; hint: string }[] = [
  { value: "metric", label: "Metric", hint: "Kilometres, litres (L/100 km)" },
  { value: "imperial", label: "Imperial / US customary", hint: "Miles, gallons context where applicable" },
];

const SIGNUP_FLOW_STEPS = 3;

const ONBOARDING_COST_DEFAULTS = {
  name: "",
  truckType: "dry_van",
  monthlyTruckPayment: 2500,
  monthlyInsurance: 1200,
  monthlyMaintenance: 800,
  monthlyPermitsPlates: 200,
  monthlyOther: 100,
  workingDaysPerMonth: 22,
  workingHoursPerDay: 10,
  driverPayPerHour: 28,
  fuelConsumptionPer100km: 38,
  defaultDockTimeMinutes: 60,
  detentionRatePerHour: 75,
};

export default function Landing() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, login, loginWithGoogle, signup } = useFirebaseAuth();
  const [view, setView] = useState<View>("landing");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [signupStep, setSignupStep] = useState(1);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [cityListIndex, setCityListIndex] = useState(-1);
  const [cityManual, setCityManual] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit | "">("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [costSaving, setCostSaving] = useState(false);

  const marketingRef = useRef<HTMLDivElement>(null);

  const marketingHtmlLocalized = useMemo(() => {
    const currency = currencyForCountryCode(countryCode || user?.operatingCountryCode);
    const sym = currencySymbol(currency);
    // Marketing HTML is injected as a raw string; localize the currency symbol only.
    return marketingHtml.replaceAll("$", sym);
  }, [countryCode, user?.operatingCountryCode]);

  useEffect(() => {
    if (!user && isOnboardingActive()) setOnboardingActive(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!isOnboardingActive()) return;
    const step = getOnboardingStep();
    if (step != null && step >= 3) {
      setView("onboarding");
      setAuthMode("signup");
      setSignupStep(step);
    }
  }, [user]);

  const showLanding = useCallback(() => {
    if (user) {
      setOnboardingActive(false);
      setLocation("/");
      return;
    }
    setView("landing");
    setSignupStep(1);
    window.scrollTo(0, 0);
  }, [user, setLocation]);

  const showOnboarding = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    setView("onboarding");
    setSignupStep(1);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const root = marketingRef.current;
    if (!root) return;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("[data-action], [data-scroll]");
      if (!el) return;
      const scroll = el.getAttribute("data-scroll");
      if (scroll) {
        e.preventDefault();
        document.getElementById(scroll)?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      const action = el.getAttribute("data-action");
      if (action === "landing") {
        e.preventDefault();
        showLanding();
      }
      if (action === "onboarding-login") {
        e.preventDefault();
        showOnboarding("login");
      }
      if (action === "onboarding-signup") {
        e.preventDefault();
        showOnboarding("signup");
      }
    };
    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [showLanding, showOnboarding]);

  useEffect(() => {
    if (view !== "landing") return;
    const root = marketingRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.querySelectorAll(".fade-up").forEach((n) => n.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    root.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [view]);

  function goDashboard() {
    setOnboardingActive(false);
    setLocation("/");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    try {
      await login({ email: email.trim(), password });
      toast({ title: "Logged in", description: "Welcome back." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Please check your credentials.";
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleGoogleSignIn(isSignup: boolean) {
    setGoogleLoading(true);

    // When the user closes the Google popup, Firebase sometimes rejects slowly; the window
    // regains focus first. If still no session after a short delay, clear the stuck "Signing in…" state.
    let focusFallbackTimer: number | undefined;
    const onWindowFocus = () => {
      if (focusFallbackTimer !== undefined) window.clearTimeout(focusFallbackTimer);
      focusFallbackTimer = window.setTimeout(() => {
        if (!firebaseConfigured || !auth) return;
        if (!auth.currentUser) setGoogleLoading(false);
      }, 600);
    };
    if (typeof window !== "undefined" && firebaseConfigured) {
      window.addEventListener("focus", onWindowFocus);
    }

    const GOOGLE_SIGNIN_MAX_MS = 120_000;
    let signInTimeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      signInTimeoutId = window.setTimeout(() => {
        reject(Object.assign(new Error("Sign-in timed out. Try again."), { code: "auth/sign-in-timeout" }));
      }, GOOGLE_SIGNIN_MAX_MS);
    });

    try {
      await Promise.race([loginWithGoogle(), timeoutPromise]);
      if (signInTimeoutId !== undefined) window.clearTimeout(signInTimeoutId);
      if (isSignup) {
        setOnboardingActive(true);
        setOnboardingStep(2);
        setSignupStep(2);
        toast({ title: "Signed in with Google", description: "Now tell us about your company." });
      } else {
        toast({ title: "Logged in", description: "Welcome back." });
      }
    } catch (err: unknown) {
      if (isGooglePopupCancelled(err)) {
        setGoogleLoading(false);
        return;
      }
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "auth/sign-in-timeout") {
        toast({
          title: "Sign-in timed out",
          description: "Close any Google windows and try again.",
          variant: "destructive",
        });
        return;
      }
      const msg = err instanceof Error ? err.message : "Google sign-in failed.";
      toast({ title: "Sign-in failed", description: msg, variant: "destructive" });
    } finally {
      if (signInTimeoutId !== undefined) window.clearTimeout(signInTimeoutId);
      if (focusFallbackTimer !== undefined) window.clearTimeout(focusFallbackTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onWindowFocus);
      }
      setGoogleLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      toast({ title: "Company required", description: "Enter your company name.", variant: "destructive" });
      return;
    }
    if (!fleetSize) {
      toast({ title: "Fleet size required", description: "Select your fleet size.", variant: "destructive" });
      return;
    }
    if (!countryCode) {
      toast({ title: "Country required", description: "Select your country.", variant: "destructive" });
      return;
    }
    if (!stateProvince) {
      toast({ title: "State/Province required", description: "Select your state or province.", variant: "destructive" });
      return;
    }
    const stateRecord = availableStates.find((s) => s.isoCode === stateProvince);
    const stateName = stateRecord?.name;
    if (!stateName) {
      toast({ title: "State/Province required", description: "Select your state or province.", variant: "destructive" });
      return;
    }
    let operatingCityValue = "";
    if (cityRows.length > 0) {
      if (cityListIndex < 0 || cityListIndex >= cityRows.length) {
        toast({ title: "City required", description: "Select your city.", variant: "destructive" });
        return;
      }
      operatingCityValue = cityRows[cityListIndex].name;
    } else {
      const manual = cityManual.trim();
      if (!manual) {
        toast({
          title: "City required",
          description: "Enter your city (no preset list for this state/territory).",
          variant: "destructive",
        });
        return;
      }
      operatingCityValue = manual;
    }
    let yardLat: number | null = null;
    let yardLng: number | null = null;
    if (cityRows.length > 0 && cityListIndex >= 0 && cityListIndex < cityRows.length) {
      const c = cityRows[cityListIndex];
      const la = Number(c.latitude);
      const lo = Number(c.longitude);
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        yardLat = la;
        yardLng = lo;
      }
    }
    if (!measurementUnit) {
      toast({
        title: "Units required",
        description: "Select whether you use metric or imperial measurements.",
        variant: "destructive",
      });
      return;
    }
    setSignupLoading(true);
    setOnboardingActive(true);
    setOnboardingStep(3);
    try {
      const countries = COUNTRY_OPTIONS.filter((c) => c.value === countryCode).map((c) => c.label);
      const operatingRegions = [stateName];
      if (user) {
        const companyId = user.companyId || doc(collection(db, "companies")).id;
        await setDoc(
          doc(db, "companies", companyId),
          {
            id: companyId,
            name: companyName.trim(),
            sector: "carriers",
            fleetSize,
            operatingCountryCode: countryCode,
            operatingCountries: countries,
            operatingRegions,
            operatingCity: operatingCityValue,
            measurementUnit,
            logoUrl: null,
            createdAt: new Date().toISOString(),
          },
          { merge: true }
        );
        await setDoc(
          doc(db, "users", user.uid),
          {
            companyId,
            companyName: companyName.trim(),
            sector: "carriers",
            fleetSize,
            operatingCountryCode: countryCode,
            operatingCountries: countries,
            operatingRegions,
            operatingCity: operatingCityValue,
            measurementUnit,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        const countryLabel = countries[0] ?? "";
        if (countryLabel) {
          await firebaseDb.syncDefaultYardFromOperatingCity(companyId, {
            city: operatingCityValue,
            stateOrProvinceName: stateName,
            countryLabel,
            lat: yardLat,
            lng: yardLng,
          });
          await queryClient.invalidateQueries({ queryKey: ["firebase", "yards", companyId] });
        }
        setSignupStep(3);
        toast({ title: "Company profile saved", description: "Set up your cost profile next." });
        return;
      }

      const name =
        `${firstName.trim()} ${lastName.trim()}`.trim() ||
        firstName.trim() ||
        lastName.trim() ||
        "User";
      await signup({
        name,
        companyName: companyName.trim(),
        sector: "carriers",
        email: email.trim(),
        password,
        fleetSize,
        operatingCountryCode: countryCode,
        operatingCountries: countries,
        operatingRegions,
        operatingCity: operatingCityValue,
        measurementUnit,
      });
      setSignupStep(3);
      toast({ title: "Account created", description: "Set up your cost profile next." });
    } catch (err: unknown) {
      setOnboardingActive(false);
      const msg = err instanceof Error ? err.message : "Please check your details.";
      toast({ title: "Sign up failed", description: msg, variant: "destructive" });
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleSaveCostProfile(data: Omit<CostProfile, "id">) {
    if (!user) return;
    const scopeId = workspaceFirestoreId(user);
    if (!scopeId) {
      toast({ title: "Error", description: "No workspace.", variant: "destructive" });
      return;
    }
    setCostSaving(true);
    try {
      await firebaseDb.createProfile(scopeId, data);
      await queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId] });
      setSignupStep(4);
      setOnboardingStep(4);
      toast({ title: "Cost profile saved", description: "You can edit it anytime under Cost Profiles." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save profile.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setCostSaving(false);
    }
  }

  function goSignupStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast({
        title: "Missing name",
        description: "Please enter your first and last name.",
        variant: "destructive",
      });
      return;
    }
    if (!email.trim()) {
      toast({ title: "Missing email", description: "Please enter your email.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({
        title: "Password too short",
        description: "Use at least 6 characters (Firebase minimum).",
        variant: "destructive",
      });
      return;
    }
    setSignupStep(2);
    window.scrollTo(0, 0);
  }

  function formatCityOptionLabel(c: ICity, rows: ICity[]): string {
    const dups = rows.filter((r) => r.name === c.name).length;
    if (dups <= 1) return c.name;
    return `${c.name} (${c.latitude}, ${c.longitude})`;
  }

  const availableStates = useMemo(() => {
    if (!countryCode) return [];
    return State.getStatesOfCountry(countryCode)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countryCode]);

  const cityRows = useMemo(() => {
    if (!countryCode || !stateProvince) return [];
    return City.getCitiesOfState(countryCode, stateProvince)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countryCode, stateProvince]);

  useEffect(() => {
    setStateProvince("");
    setCityListIndex(-1);
    setCityManual("");
  }, [countryCode]);

  useEffect(() => {
    setCityListIndex(-1);
    setCityManual("");
  }, [stateProvince]);

  if (user && !isOnboardingActive()) return null;

  const signupProgressPct =
    authMode === "signup" && signupStep <= SIGNUP_FLOW_STEPS
      ? (signupStep / SIGNUP_FLOW_STEPS) * 100
      : 0;

  return (
    <div className="landing-root">
      <div
        ref={marketingRef}
        id="landing-view"
        className={view === "onboarding" ? "is-hidden" : ""}
        aria-hidden={view === "onboarding"}
        dangerouslySetInnerHTML={{ __html: marketingHtmlLocalized }}
      />

      <div
        id="onboarding-view"
        className={view === "onboarding" ? "is-active" : ""}
        aria-hidden={view !== "onboarding"}
      >
        <div className="onboarding" id="app">
          <div className="top-bar">
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                className="onboarding-back"
                onClick={showLanding}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--gray-500)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  whiteSpace: "nowrap",
                }}
              >
                ← Back to site
              </button>
              <div className="logo">
                <img src="/lottie/logo.jpg" alt="Bungee Connect" className="logo-img" />
              </div>
            </div>
            <div className="step-indicator">
              {authMode === "login"
                ? "Log in"
                : signupStep === 4
                  ? "You're all set!"
                  : `Step ${Math.min(signupStep, SIGNUP_FLOW_STEPS)} of ${SIGNUP_FLOW_STEPS}`}
            </div>
          </div>

          {authMode === "signup" && signupStep <= SIGNUP_FLOW_STEPS && (
            <>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${signupProgressPct}%` }} />
              </div>
              <div className="steps-nav" id="stepsNav">
                <div className="step-col">
                  <div
                    className={
                      signupStep === 1 ? "step-dot active" : signupStep > 1 ? "step-dot completed" : "step-dot pending"
                    }
                  >
                    {signupStep > 1 ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      "1"
                    )}
                  </div>
                  <div className={signupStep === 1 ? "step-label active-label" : "step-label"}>Account</div>
                </div>
                <div className={signupStep > 1 ? "step-connector done" : "step-connector pending"} />
                <div className="step-col">
                  <div
                    className={
                      signupStep === 2
                        ? "step-dot active"
                        : signupStep > 2
                          ? "step-dot completed"
                          : "step-dot pending"
                    }
                  >
                    {signupStep > 2 ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      "2"
                    )}
                  </div>
                  <div className={signupStep === 2 ? "step-label active-label" : "step-label"}>Company</div>
                </div>
                <div className={signupStep > 2 ? "step-connector done" : "step-connector pending"} />
                <div className="step-col">
                  <div
                    className={
                      signupStep === 3
                        ? "step-dot active"
                        : signupStep > 3
                          ? "step-dot completed"
                          : "step-dot pending"
                    }
                  >
                    {signupStep > 3 ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      "3"
                    )}
                  </div>
                  <div className={signupStep === 3 ? "step-label active-label" : "step-label"}>Cost profile</div>
                </div>
              </div>
            </>
          )}

          {authMode === "login" && (
            <form className="card" onSubmit={handleLogin} style={{ marginTop: 0 }}>
              <h2 className="card-title">Welcome back</h2>
              <p className="card-sub">Sign in with Google or use your email and password.</p>
              <div className="sso-row">
                <button
                  type="button"
                  className="sso-btn"
                  onClick={() => handleGoogleSignIn(false)}
                  disabled={googleLoading}
                >
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {googleLoading ? "Signing in…" : "Continue with Google"}
                </button>
              </div>
              <div className="form-divider">
                <div className="form-divider-line" />
                <div className="form-divider-text">or sign in with email</div>
                <div className="form-divider-line" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-email">
                  Email <span className="req">*</span>
                </label>
                <input
                  id="login-email"
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  placeholder="john@myfleet.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">
                  Password <span className="req">*</span>
                </label>
                <input
                  id="login-password"
                  className="form-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="card-actions center" style={{ borderTop: "none", marginTop: 24, paddingTop: 0, flexDirection: "column", gap: 16 }}>
                <button type="submit" className="btn btn-primary btn-lg" disabled={loginLoading}>
                  {loginLoading ? "Signing in…" : "Log in"}
                </button>
                <p className="form-helper" style={{ margin: 0, textAlign: "center" }}>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => showOnboarding("signup")}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      color: "var(--orange)",
                      cursor: "pointer",
                      fontWeight: 600,
                      textDecoration: "underline",
                    }}
                  >
                    Sign up
                  </button>
                </p>
              </div>
            </form>
          )}

          {authMode === "signup" && signupStep === 1 && !user && (
            <form className="card" id="step1" onSubmit={goSignupStep2}>
              <h2 className="card-title">Create Your Account</h2>
              <p className="card-sub">Get started in under a minute. Free forever — no credit card needed.</p>

              <div className="sso-row">
                <button
                  type="button"
                  className="sso-btn"
                  onClick={() => handleGoogleSignIn(true)}
                  disabled={googleLoading}
                >
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {googleLoading ? "Signing in…" : "Continue with Google"}
                </button>
              </div>

              <div className="form-divider">
                <div className="form-divider-line" />
                <div className="form-divider-text">or sign up with email</div>
                <div className="form-divider-line" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="su-first">
                    First Name <span className="req">*</span>
                  </label>
                  <input
                    id="su-first"
                    className="form-input"
                    type="text"
                    placeholder="John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="su-last">
                    Last Name <span className="req">*</span>
                  </label>
                  <input
                    id="su-last"
                    className="form-input"
                    type="text"
                    placeholder="Smith"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="su-email">
                  Email <span className="req">*</span>
                </label>
                <input
                  id="su-email"
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  placeholder="john@myfleet.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="su-password">
                  Password <span className="req">*</span>
                </label>
                <input
                  id="su-password"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <div className="form-helper">At least 6 characters (Firebase). Use a strong password in production.</div>
              </div>

              <div className="card-actions" style={{ borderTop: "none", marginTop: 24, paddingTop: 0 }}>
                <span />
                <button type="submit" className="btn btn-primary btn-lg">
                  Continue
                </button>
              </div>
            </form>
          )}

          {authMode === "signup" && signupStep === 2 && (
            <form className="card" id="step2" onSubmit={handleSignup}>
              <h2 className="card-title">Company Profile</h2>
              <p className="card-sub">Tell us about your company profile so we can tailor your account setup.</p>

              <div className="form-group">
                <label className="form-label" htmlFor="su-company">
                  Company Name <span className="req">*</span>
                </label>
                <input
                  id="su-company"
                  className="form-input"
                  type="text"
                  placeholder="Smith Trucking Inc."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="su-fleet-size">
                  Fleet Size <span className="req">*</span>
                </label>
                <select
                  id="su-fleet-size"
                  className="form-input form-select"
                  value={fleetSize}
                  onChange={(e) => setFleetSize(e.target.value)}
                  required
                >
                  <option value="">Select fleet size</option>
                  {FLEET_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="su-country">
                  Country <span className="req">*</span>
                </label>
                <select
                  id="su-country"
                  className="form-input form-select"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  required
                >
                  <option value="">Select country</option>
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.value} value={country.value}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="su-regions">
                  State / Province <span className="req">*</span>
                </label>
                <select
                  id="su-regions"
                  className="form-input form-select"
                  value={stateProvince}
                  onChange={(e) => setStateProvince(e.target.value)}
                  disabled={availableStates.length === 0}
                  required
                >
                  <option value="">
                    {availableStates.length === 0 ? "Select a country first" : "Select state / province"}
                  </option>
                  {availableStates.map((s) => (
                    <option key={s.isoCode} value={s.isoCode}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="su-city">
                  City <span className="req">*</span>
                </label>
                {cityRows.length > 0 ? (
                  <select
                    id="su-city"
                    className="form-input form-select"
                    value={cityListIndex >= 0 ? String(cityListIndex) : ""}
                    onChange={(e) => setCityListIndex(e.target.value === "" ? -1 : Number(e.target.value))}
                    disabled={!stateProvince}
                    required
                  >
                    <option value="">{stateProvince ? "Select city" : "Select state / province first"}</option>
                    {cityRows.map((c, i) => (
                      <option key={`${c.name}-${c.latitude}-${c.longitude}-${i}`} value={String(i)}>
                        {formatCityOptionLabel(c, cityRows)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="su-city"
                    className="form-input"
                    type="text"
                    autoComplete="address-level2"
                    placeholder={
                      stateProvince
                        ? "Enter your city (no preset list for this area)"
                        : "Select state / province first"
                    }
                    value={cityManual}
                    onChange={(e) => setCityManual(e.target.value)}
                    disabled={!stateProvince}
                    required
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="su-units">
                  Unit of measurement <span className="req">*</span>
                </label>
                <select
                  id="su-units"
                  className="form-input form-select"
                  value={measurementUnit}
                  onChange={(e) => setMeasurementUnit(e.target.value as MeasurementUnit | "")}
                  required
                >
                  <option value="">Select units</option>
                  {MEASUREMENT_UNIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.hint}
                    </option>
                  ))}
                </select>
              </div>

              <div className="card-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setSignupStep(1)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={signupLoading}>
                  {signupLoading ? "Creating account…" : "Create account"}
                </button>
              </div>
            </form>
          )}

          {authMode === "signup" && signupStep === 3 && user && (
            <div className="card" id="step3">
              <h2 className="card-title">Set Up Your Cost Profile</h2>
              <p className="card-sub" style={{ marginBottom: 24 }}>
                Same as <strong>Cost Profiles</strong> in the app — saved to your company in Firebase. Complete this step
                to finish setup (you can edit the profile anytime in the app).
              </p>
              <CostProfileWizard
                currency={currencyForCountryCode(countryCode || user?.operatingCountryCode)}
                onSave={(data) => handleSaveCostProfile(data)}
                saveLabel="Save & continue"
                defaultValues={ONBOARDING_COST_DEFAULTS}
                isSaving={costSaving}
              />
            </div>
          )}

          {authMode === "signup" && signupStep === 4 && user && (
            <div className="card" id="step4-success">
              <div className="success-content">
                <div className="success-icon">
                  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <path d="M22 4L12 14.01l-3-3" />
                  </svg>
                </div>
                <h2 className="success-title">You&apos;re all set!</h2>
                <p className="success-sub">
                  Your account and cost profile are ready. Start quoting loads from the home screen.
                </p>
                <div className="success-features">
                  <div className="success-feature">
                    <svg viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>Unlimited free route quotes</span>
                  </div>
                  <div className="success-feature">
                    <svg viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>AI chatbot ready to use</span>
                  </div>
                  <div className="success-feature">
                    <svg viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>3-tier pricing on every quote</span>
                  </div>
                  <div className="success-feature">
                    <svg viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>Cost profile saved &amp; editable in Cost Profiles</span>
                  </div>
                </div>
                <button type="button" className="btn btn-primary btn-lg btn-full" onClick={goDashboard}>
                  Go to dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
