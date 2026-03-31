import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import marketingHtml from "./landing-hero.html?raw";
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
import { auth, db, firebaseConfigured } from "@/lib/firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import { currencyForCountryCode, currencySymbol } from "@/lib/currency";
import { safeStorageSet } from "@/lib/safeStorage";
import type { MeasurementUnit } from "@/lib/measurement";
import { fetchPlaceSuggestions, resolvePlaceDetails, type PlaceDetails } from "@/lib/geo";
import { isConnectGuestUser } from "@/lib/connectGuest";
import { Eye, EyeOff } from "lucide-react";

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

function sanitizeAuthErrorMessage(
  err: unknown,
  fallback: string,
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();
  // Never surface provider/internal auth strings in production UI.
  if (
    lower.includes("firebase") ||
    lower.includes("auth/") ||
    lower.includes("invalid-credential") ||
    lower.includes("invalid credential")
  ) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function getFirebaseAuthErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string" && c.startsWith("auth/")) return c;
  }
  return undefined;
}

/** Maps Firebase Auth errors to inline login form state (field highlights + messages). */
type LoginAuthUiState = {
  emailError?: string;
  passwordError?: string;
  formBanner?: string;
  highlightEmail?: boolean;
  highlightPassword?: boolean;
};

function mapLoginAuthUiErrors(err: unknown): LoginAuthUiState {
  const code = getFirebaseAuthErrorCode(err);
  switch (code) {
    case "auth/invalid-email":
      return {
        emailError: "Enter a valid email address.",
        highlightEmail: true,
      };
    case "auth/user-disabled":
      return {
        emailError: "This account has been disabled.",
        highlightEmail: true,
      };
    case "auth/user-not-found":
      return {
        emailError: "No account found with this email.",
        highlightEmail: true,
      };
    case "auth/wrong-password":
      return {
        passwordError: "Incorrect password.",
        highlightPassword: true,
      };
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return {
        formBanner: "Email or password doesn't match our records. Check both fields.",
        highlightEmail: true,
        highlightPassword: true,
      };
    case "auth/too-many-requests":
      return {
        formBanner: "Too many sign-in attempts. Try again in a few minutes.",
      };
    case "auth/network-request-failed":
      return {
        formBanner: "Network error. Check your connection and try again.",
      };
    case "auth/operation-not-allowed":
      return {
        formBanner: "Email/password sign-in is not enabled for this app.",
      };
    case "auth/missing-email":
      return {
        emailError: "Enter your email.",
        highlightEmail: true,
      };
    case "auth/internal-error":
      return {
        formBanner: "Something went wrong. Try again.",
      };
    default:
      return {
        formBanner: "Couldn't sign you in. Try again.",
      };
  }
}

/** Sign-up errors: do NOT use sanitizeAuthErrorMessage — Firebase messages always contain auth/ / firebase. */
function mapSignupErrorToast(err: unknown): { title: string; description: string } {
  const code = getFirebaseAuthErrorCode(err);
  switch (code) {
    case "auth/email-already-in-use":
      return {
        title: "Email already registered",
        description: "An account already uses this email. Try logging in, or use a different email.",
      };
    case "auth/invalid-email":
      return {
        title: "Invalid email",
        description: "Go back to step 1 and enter a valid email address.",
      };
    case "auth/weak-password":
      return {
        title: "Password too weak",
        description: "Use at least 8 characters with uppercase, lowercase, a number, and a symbol.",
      };
    case "auth/operation-not-allowed":
      return {
        title: "Sign-up unavailable",
        description: "Email/password registration is not enabled. Contact support.",
      };
    case "auth/network-request-failed":
      return {
        title: "Connection problem",
        description: "Check your internet connection and try again.",
      };
    case "auth/too-many-requests":
      return {
        title: "Too many attempts",
        description: "Wait a few minutes, then try again.",
      };
    case "auth/internal-error":
      return {
        title: "Something went wrong",
        description: "Try again in a moment. If it keeps happening, contact support.",
      };
    default:
      break;
  }

  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/not configured|VITE_FIREBASE|missing.*env/i.test(raw)) {
    return {
      title: "App configuration",
      description: "Sign-up is not fully configured on this site. Please contact support.",
    };
  }

  if (err && typeof err === "object" && "code" in err) {
    const c = String((err as { code?: unknown }).code);
    if (c === "permission-denied") {
      return {
        title: "Could not save profile",
        description: "Permission was denied. Try again or contact support.",
      };
    }
  }

  return {
    title: "Sign up failed",
    description: "Something went wrong. Check your company details and try again. If you already have an account, use Log in instead.",
  };
}

type View = "landing" | "onboarding";
type AuthMode = "login" | "signup";

const FLEET_SIZE_OPTIONS = ["1 - 10", "11 - 20", "21 - 50", "51 - 100", "100+"];

const COUNTRY_OPTIONS = [
  { value: "CA", label: "Canada" },
  { value: "US", label: "USA" },
] as const;

const MEASUREMENT_UNIT_OPTIONS: { value: MeasurementUnit; label: string; hint: string }[] = [
  { value: "metric", label: "Metric", hint: "Kilometres, litres (L/100 km)" },
  { value: "imperial", label: "Imperial / US customary", hint: "Miles, gallons context where applicable" },
];

const SIGNUP_FLOW_STEPS = 2;

/** Minimum length for email sign-up (Firebase allows 6+; we enforce stronger policy in UI). */
const SIGNUP_PASSWORD_MIN_LEN = 8;

/** Returns a user-facing error message or null if the password meets policy. */
function validateSignupPasswordStrength(password: string): string | null {
  if (password.length < SIGNUP_PASSWORD_MIN_LEN) {
    return `Use at least ${SIGNUP_PASSWORD_MIN_LEN} characters.`;
  }
  if (!/[a-z]/.test(password)) return "Include at least one lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Include at least one uppercase letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Include at least one symbol (e.g. ! @ # $).";
  return null;
}

// Cost profile creation now happens on /#/profiles after signup redirect

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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [resolvedPlace, setResolvedPlace] = useState<PlaceDetails | null>(null);
  const [cityResolving, setCityResolving] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [cityDropOpen, setCityDropOpen] = useState(false);
  const cityDropRef = useRef<HTMLDivElement>(null);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit | "">("");
  const [preferredCurrency, setPreferredCurrency] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsShake, setTermsShake] = useState(false);
  const [loginAuthUi, setLoginAuthUi] = useState<LoginAuthUiState>({});
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupPasswordConfirm, setShowSignupPasswordConfirm] = useState(false);

  // Fetch city autocomplete suggestions as user types (debounced, uses Google Places via server).
  useEffect(() => {
    const q = cityInput.trim();
    if (q.length < 2) { setCitySuggestions([]); return; }
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    cityDebounceRef.current = setTimeout(() => {
      fetchPlaceSuggestions(q).then(setCitySuggestions).catch(() => setCitySuggestions([]));
    }, 300);
    return () => { if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current); };
  }, [cityInput]);

  // Close city dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (cityDropRef.current && !cityDropRef.current.contains(e.target as Node)) {
        setCityDropOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const marketingRef = useRef<HTMLDivElement>(null);

  const marketingHtmlLocalized = useMemo(() => {
    if (view !== "landing") return "";
    const currency = currencyForCountryCode(countryCode || user?.operatingCountryCode);
    const sym = currencySymbol(currency);
    try {
      // Keep processing simple for iOS Safari/Chrome: avoid heavy regex/sanitize paths that can overflow stack.
      const openTag = '<section class="pricing" id="pricing"';
      const start = marketingHtml.indexOf(openTag);
      if (start === -1) {
        return marketingHtml.replaceAll("$", sym);
      }
      const end = marketingHtml.indexOf("</section>", start);
      if (end === -1) return marketingHtml.replaceAll("$", sym);
      const pricingSectionEnd = end + "</section>".length;
      const before = marketingHtml.slice(0, start).replaceAll("$", sym);
      const block = marketingHtml.slice(start, pricingSectionEnd);
      const after = marketingHtml.slice(pricingSectionEnd).replaceAll("$", sym);
      // Source is a local checked-in HTML file (not user input), so no runtime sanitization needed here.
      return before + block + after;
    } catch (err) {
      console.error("[landing] Failed to prepare marketing HTML", err);
      return marketingHtml;
    }
  }, [countryCode, user?.operatingCountryCode, view]);

  useEffect(() => {
    if (!user && isOnboardingActive()) setOnboardingActive(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!isOnboardingActive()) return;
    const step = getOnboardingStep();
    if (step != null && step >= 3) {
      // Step 3+ now handled by the cost profiles page, not the onboarding widget
      safeStorageSet("bungee_open_cost_wizard", "1", "local");
      setOnboardingActive(false);
      setLocation("/profiles");
    }
  }, [user, setLocation]);

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
    setConfirmPassword("");
    setLoginAuthUi({});
    setShowLoginPassword(false);
    setShowSignupPassword(false);
    setShowSignupPasswordConfirm(false);
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
      if (action === "set-billing") {
        e.preventDefault();
        const billing = el.getAttribute("data-billing-toggle");
        if (billing !== "month" && billing !== "year") return;
        const pricingRoot = root.querySelector<HTMLElement>("#pricing");
        if (!pricingRoot) return;
        pricingRoot.setAttribute("data-billing", billing);
        root.querySelectorAll<HTMLElement>("[data-billing-toggle]").forEach((btn) => {
          const isActive = btn.getAttribute("data-billing-toggle") === billing;
          btn.classList.toggle("is-active", isActive);
        });
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
    setLoginAuthUi({});
    setLoginLoading(true);
    try {
      await login({ email: email.trim(), password });
      setLoginAuthUi({});
      toast({ title: "Logged in", description: "Welcome back." });
    } catch (err: unknown) {
      const ui = mapLoginAuthUiErrors(err);
      setLoginAuthUi(ui);
      queueMicrotask(() => {
        if (ui.highlightEmail) {
          document.getElementById("login-email")?.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById("login-email")?.focus();
        } else if (ui.highlightPassword) {
          document.getElementById("login-password")?.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById("login-password")?.focus();
        } else if (ui.formBanner) {
          document.getElementById("login-auth-banner")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
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
      const msg = sanitizeAuthErrorMessage(err, "Sign-in failed.");
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
    if (!agreedToTerms) {
      setTermsShake(true);
      setTimeout(() => setTermsShake(false), 1400);
      // Scroll the checkbox into view so the user sees the alert
      document.getElementById("terms-checkbox")?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast({ title: "Agreement required", description: "Please accept the User Agreement and Privacy Policy to continue.", variant: "destructive" });
      return;
    }
    if (!companyName.trim()) {
      toast({ title: "Company required", description: "Enter your company name.", variant: "destructive" });
      return;
    }
    if (!fleetSize) {
      toast({ title: "Fleet size required", description: "Select your fleet size.", variant: "destructive" });
      return;
    }
    if (!resolvedPlace && !countryCode) {
      toast({ title: "City required", description: "Type your city and select a suggestion from the list.", variant: "destructive" });
      document.getElementById("su-city")?.focus();
      return;
    }
    if (!resolvedPlace) {
      toast({ title: "City required", description: "Type your city and select a suggestion from the list.", variant: "destructive" });
      document.getElementById("su-city")?.focus();
      return;
    }
    const stateName = resolvedPlace.stateName;
    const operatingCityValue = resolvedPlace.city || cityInput.trim();
    const yardLat: number | null = resolvedPlace.lat ?? null;
    const yardLng: number | null = resolvedPlace.lng ?? null;
    // Use resolved country if the user left the country dropdown blank.
    const effectiveCountryCode = countryCode || resolvedPlace.countryCode;
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
      const resolvedCountryLabel = resolvedPlace.countryName || COUNTRY_OPTIONS.find((c) => c.value === effectiveCountryCode)?.label || effectiveCountryCode;
      const countries = resolvedCountryLabel ? [resolvedCountryLabel] : COUNTRY_OPTIONS.filter((c) => c.value === effectiveCountryCode).map((c) => c.label);
      const operatingRegions = stateName ? [stateName] : [];
      // Guest mode uses a synthetic user with reserved Firestore ids — never write those paths.
      if (user && !isConnectGuestUser(user)) {
        const companyId = user.companyId || doc(collection(db, "companies")).id;
        await setDoc(
          doc(db, "companies", companyId),
          {
            id: companyId,
            name: companyName.trim(),
            sector: "carriers",
            fleetSize,
            operatingCountryCode: effectiveCountryCode,
            operatingCountries: countries,
            operatingRegions,
            operatingCity: operatingCityValue,
            measurementUnit,
            ...(preferredCurrency ? { preferredCurrency } : {}),
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
            operatingCountryCode: effectiveCountryCode,
            operatingCountries: countries,
            operatingRegions,
            operatingCity: operatingCityValue,
            measurementUnit,
            ...(preferredCurrency ? { preferredCurrency } : {}),
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
        // Redirect to cost profiles page with auto-open wizard flag
        safeStorageSet("bungee_open_cost_wizard", "1", "local");
        setOnboardingActive(false);
        setLocation("/profiles");
        toast({ title: "Company profile saved", description: "Set up your equipment cost profile to get started." });
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
        operatingCountryCode: effectiveCountryCode,
        operatingCountries: countries,
        operatingRegions,
        operatingCity: operatingCityValue,
        measurementUnit,
      });
      // Redirect to cost profiles page with auto-open wizard flag
      safeStorageSet("bungee_open_cost_wizard", "1", "local");
      setOnboardingActive(false);
      setLocation("/profiles");
      toast({ title: "Account created", description: "Set up your equipment cost profile to get started." });
    } catch (err: unknown) {
      setOnboardingActive(false);
      if (import.meta.env.DEV) console.error("[landing signup]", err);
      const { title, description } = mapSignupErrorToast(err);
      toast({ title, description, variant: "destructive" });
    } finally {
      setSignupLoading(false);
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
    const strengthMsg = validateSignupPasswordStrength(password);
    if (strengthMsg) {
      toast({
        title: "Password requirements",
        description: strengthMsg,
        variant: "destructive",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Re-enter your password in both fields so they match.",
        variant: "destructive",
      });
      return;
    }
    setSignupStep(2);
    window.scrollTo(0, 0);
  }

  // Reset city when country changes.
  useEffect(() => {
    setCityInput("");
    setResolvedPlace(null);
    setCitySuggestions([]);
  }, [countryCode]);

  // Signed-in real users shouldn't see this screen unless they're in onboarding.
  // Use an effect to navigate away so the component never renders blank.
  useEffect(() => {
    if (user && !isConnectGuestUser(user) && !isOnboardingActive()) {
      setLocation("/");
    }
  }, [user, setLocation]);
  if (user && !isConnectGuestUser(user) && !isOnboardingActive()) return null;

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
            <div className="top-bar-left">
              <button
                type="button"
                className="onboarding-back"
                onClick={showLanding}
              >
                ← Back to site
              </button>
            </div>
            <div className="top-bar-center">
              <div className="logo">
                <img src={`${import.meta.env.BASE_URL}lottie/BungeeConnect-logo.png`} alt="Bungee Connect" className="logo-img" />
              </div>
            </div>
            <div className="top-bar-right">
              <div className="step-indicator">
                {authMode === "login"
                  ? "Log in"
                  : signupStep === 4
                    ? "You're all set!"
                    : `Step ${Math.min(signupStep, SIGNUP_FLOW_STEPS)} of ${SIGNUP_FLOW_STEPS}`}
              </div>
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
              </div>
            </>
          )}

          {authMode === "login" && (
            <form className="card" onSubmit={handleLogin} style={{ marginTop: 0 }}>
              <h2 className="card-title">Welcome back</h2>
              <p className="card-sub">Sign in with Google or use your email and password.</p>
              {loginAuthUi.formBanner ? (
                <div id="login-auth-banner" className="login-auth-banner" role="alert">
                  {loginAuthUi.formBanner}
                </div>
              ) : null}
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
                  className={`form-input${loginAuthUi.highlightEmail || loginAuthUi.emailError ? " form-input-error" : ""}`}
                  type="email"
                  autoComplete="email"
                  placeholder="john@myfleet.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setLoginAuthUi({});
                  }}
                  aria-invalid={Boolean(loginAuthUi.emailError || loginAuthUi.highlightEmail)}
                  aria-describedby={loginAuthUi.emailError ? "login-email-error" : undefined}
                  required
                />
                {loginAuthUi.emailError ? (
                  <div id="login-email-error" className="form-error-text">
                    {loginAuthUi.emailError}
                  </div>
                ) : null}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">
                  Password <span className="req">*</span>
                </label>
                <div className="password-input-wrap">
                  <input
                    id="login-password"
                    className={`form-input form-input-password${loginAuthUi.highlightPassword || loginAuthUi.passwordError ? " form-input-error" : ""}`}
                    type={showLoginPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setLoginAuthUi({});
                    }}
                    aria-invalid={Boolean(loginAuthUi.passwordError || loginAuthUi.highlightPassword)}
                    aria-describedby={loginAuthUi.passwordError ? "login-password-error" : undefined}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    aria-label={showLoginPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowLoginPassword((v) => !v)}
                  >
                    {showLoginPassword ? <EyeOff className="password-toggle-icon" /> : <Eye className="password-toggle-icon" />}
                  </button>
                </div>
                {loginAuthUi.passwordError ? (
                  <div id="login-password-error" className="form-error-text">
                    {loginAuthUi.passwordError}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", borderTop: "none", marginTop: 24, paddingTop: 0, flexDirection: "column", gap: 16, alignItems: "flex-end" }}>
                <button type="submit" className="btn btn-primary" style={{ padding: "10px 28px", fontSize: 14 }} disabled={loginLoading}>
                  {loginLoading ? "Signing in…" : "Log in"}
                </button>
                <p className="form-helper" style={{ margin: 0, textAlign: "center", alignSelf: "center" }}>
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

          {/* Guest mode still has a synthetic `user` — must not hide the form with `!user` only */}
          {authMode === "signup" && signupStep === 1 && (!user || isConnectGuestUser(user)) && (
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
                <div className="password-input-wrap">
                  <input
                    id="su-password"
                    className="form-input form-input-password"
                    type={showSignupPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={`At least ${SIGNUP_PASSWORD_MIN_LEN} characters`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={SIGNUP_PASSWORD_MIN_LEN}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    aria-label={showSignupPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowSignupPassword((v) => !v)}
                  >
                    {showSignupPassword ? <EyeOff className="password-toggle-icon" /> : <Eye className="password-toggle-icon" />}
                  </button>
                </div>
                <div className="form-helper">
                  Use {SIGNUP_PASSWORD_MIN_LEN}+ characters with uppercase, lowercase, a number, and a symbol.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="su-password-confirm">
                  Confirm password <span className="req">*</span>
                </label>
                <div className="password-input-wrap">
                  <input
                    id="su-password-confirm"
                    className="form-input form-input-password"
                    type={showSignupPasswordConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={SIGNUP_PASSWORD_MIN_LEN}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    aria-label={showSignupPasswordConfirm ? "Hide confirm password" : "Show confirm password"}
                    onClick={() => setShowSignupPasswordConfirm((v) => !v)}
                  >
                    {showSignupPasswordConfirm ? <EyeOff className="password-toggle-icon" /> : <Eye className="password-toggle-icon" />}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", borderTop: "none", marginTop: 24, paddingTop: 0, flexDirection: "column", gap: 16, alignItems: "flex-end" }}>
                <button type="submit" className="btn btn-primary" style={{ padding: "10px 28px", fontSize: 14 }}>
                  Continue
                </button>
                <p className="form-helper" style={{ margin: 0, textAlign: "center", alignSelf: "center" }}>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => showOnboarding("login")}
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
                    Log in
                  </button>
                </p>
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

              {/* ── City autocomplete (Google Places, US/CA) ── */}
              <div className="form-group" ref={cityDropRef} style={{ position: "relative" }}>
                <label className="form-label" htmlFor="su-city">
                  City / Province <span className="req">*</span>
                </label>
                <input
                  id="su-city"
                  className="form-input"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Toronto, Hamilton, Dallas…"
                  value={cityInput}
                  onChange={(e) => {
                    setCityInput(e.target.value);
                    setResolvedPlace(null);
                    setCityDropOpen(true);
                  }}
                  onFocus={() => { if (citySuggestions.length > 0) setCityDropOpen(true); }}
                  required={!resolvedPlace}
                />
                {/* Hidden input satisfies native form required validation once a place is resolved */}
                <input type="hidden" value={resolvedPlace ? resolvedPlace.city : ""} required />
                {cityResolving && (
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#888" }}>
                    Resolving…
                  </span>
                )}
                {cityDropOpen && citySuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                      maxHeight: 220, overflowY: "auto",
                      background: "var(--bg, #fff)", border: "1px solid var(--border, #ddd)",
                      borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", marginTop: 2,
                    }}
                  >
                    {citySuggestions.map((s, i) => (
                      <div
                        key={`${s}-${i}`}
                        onMouseDown={async (e) => {
                          e.preventDefault();
                          setCityInput(s);
                          setCityDropOpen(false);
                          setCitySuggestions([]);
                          setCityResolving(true);
                          try {
                            const details = await resolvePlaceDetails(s);
                            if (details) {
                              setResolvedPlace(details);
                              // Auto-fill country if blank
                              if (!countryCode && details.countryCode) setCountryCode(details.countryCode);
                            }
                          } finally {
                            setCityResolving(false);
                          }
                        }}
                        style={{
                          padding: "8px 12px", cursor: "pointer", fontSize: 14,
                          background: "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--orange-light, #fff7ed)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        📍 {s}
                      </div>
                    ))}
                  </div>
                )}
                {resolvedPlace && (
                  <div style={{ fontSize: 12, color: "var(--orange, #ea580c)", marginTop: 4, fontWeight: 500 }}>
                    ✓ {resolvedPlace.city}{resolvedPlace.stateName ? `, ${resolvedPlace.stateName}` : ""}{resolvedPlace.countryName ? `, ${resolvedPlace.countryName}` : ""}
                  </div>
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

              <div className="form-group">
                <label className="form-label" htmlFor="su-currency">
                  Preferred Currency
                </label>
                <select
                  id="su-currency"
                  className="form-input form-select"
                  value={preferredCurrency}
                  onChange={(e) => setPreferredCurrency(e.target.value)}
                >
                  <option value="">Auto-detect from country</option>
                  <option value="CAD">CA$ — Canadian Dollar</option>
                  <option value="USD">$ — US Dollar</option>
                </select>
                <span style={{ fontSize: 12, color: "#888", marginTop: 2, display: "block" }}>
                  {preferredCurrency
                    ? `All costs and quotes will display in ${preferredCurrency}.`
                    : `Defaults to ${countryCode === "US" ? "USD" : "CAD"} based on your country.`}
                </span>
              </div>

              {/* ── Agreement checkbox ────────────────── */}
              <label
                id="terms-checkbox"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  marginTop: 16,
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: termsShake
                    ? "2px solid #ef4444"
                    : agreedToTerms
                      ? "1.5px solid var(--orange)"
                      : "1.5px solid var(--border)",
                  background: termsShake
                    ? "rgba(239,68,68,0.08)"
                    : agreedToTerms
                      ? "rgba(234,88,12,0.04)"
                      : "transparent",
                  cursor: "pointer",
                  transition: "border 0.2s, background 0.2s",
                  animation: termsShake ? "shake 0.5s ease-in-out, blink-border 0.4s ease-in-out 3" : "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  style={{ marginTop: 3, accentColor: "var(--orange)", width: 16, height: 16, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--muted-fg, #666)" }}>
                  <span className="req">*</span> I agree to the{" "}
                  <a
                    href="/user-agreement.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--orange)", fontWeight: 600, textDecoration: "underline" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    User Agreement
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy-policy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--orange)", fontWeight: 600, textDecoration: "underline" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                  </a>
                  . Your equipment cost profile is encrypted and private.
                </span>
              </label>

              <div style={{ display: "flex", marginTop: 24, gap: 12, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-secondary" style={{ padding: "10px 28px", fontSize: 14 }} onClick={() => setSignupStep(1)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: "10px 28px", fontSize: 14 }} disabled={signupLoading}>
                  {signupLoading ? "Creating account…" : "Create account"}
                </button>
              </div>
            </form>
          )}

          {/* Steps 3 & 4 removed — after account creation, user is redirected to /#/profiles
             where the CostDiscoveryWizard opens automatically */}
        </div>
      </div>
    </div>
  );
}
