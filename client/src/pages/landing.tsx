import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
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
import type { MeasurementUnit } from "@/lib/measurement";
import { fetchPlaceSuggestions, resolvePlaceDetails, type PlaceDetails } from "@/lib/geo";
import { isConnectGuestUser } from "@/lib/connectGuest";

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
  const [companyName, setCompanyName] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit | "">("");
  const [preferredCurrency, setPreferredCurrency] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [cityDropOpen, setCityDropOpen] = useState(false);
  const [cityResolving, setCityResolving] = useState(false);
  const [resolvedPlace, setResolvedPlace] = useState<PlaceDetails | null>(null);
  const cityDropRef = useRef<HTMLDivElement>(null);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [showPasswordSignup, setShowPasswordSignup] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsShake, setTermsShake] = useState(false);

  const marketingRef = useRef<HTMLDivElement>(null);

  const marketingHtmlLocalized = useMemo(() => {
    const currency = currencyForCountryCode(countryCode || user?.operatingCountryCode);
    const sym = currencySymbol(currency);
    // Localize $ elsewhere on the page, but keep literal "$" in the pricing / paywall section only.
    const pricingBlock = marketingHtml.match(
      /<section class="pricing" id="pricing"[^>]*>[\s\S]*?<\/section>/,
    );
    if (!pricingBlock || pricingBlock.index === undefined) {
      return marketingHtml.replaceAll("$", sym);
    }
    const { index } = pricingBlock;
    const block = pricingBlock[0];
    const before = marketingHtml.slice(0, index).replaceAll("$", sym);
    const after = marketingHtml.slice(index + block.length).replaceAll("$", sym);
    const localized = before + block + after;
    // Sanitize to prevent XSS — allows only safe HTML tags and attributes.
    return DOMPurify.sanitize(localized, {
      ADD_TAGS: ["section", "nav", "footer", "iframe"],
      ADD_ATTR: [
        "data-action", "data-scroll", "data-testid", "data-billing-toggle",
        "data-demo-carousel", "data-demo-caption", "data-demo-prev", "data-demo-next",
        "data-demo-dots", "data-demo-phases", "data-dot", "data-slide", "data-phase-slides",
        "src", "loading", "allowfullscreen", "referrerpolicy",
      ],
    });
  }, [countryCode, user?.operatingCountryCode]);

  useEffect(() => {
    if (!user && isOnboardingActive()) setOnboardingActive(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!isOnboardingActive()) return;
    const step = getOnboardingStep();
    if (step != null && step >= 3) {
      // Step 3+ now handled by the cost profiles page, not the onboarding widget
      localStorage.setItem("bungee_open_cost_wizard", "1");
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

  // ── Interactive Demo: flat 9-step carousel ────────
  useEffect(() => {
    if (view !== "landing") return;
    const root = marketingRef.current;
    if (!root) return;

    const CAPTIONS = [
      "<strong>Step 1 of 10:</strong> Pick your truck type, enter your real costs — or use industry averages to start instantly.",
      '<strong>Step 2 of 10:</strong> Type "Toronto to Montreal" in the AI Route Chat. The route builds, map updates, and costs calculate in seconds.',
      "<strong>Step 3 of 10:</strong> See your carrier cost, 20/30/40% margin tiers, and pricing quality at a glance. Dock time, deadhead, and surcharges are all adjustable.",
      '<strong>Step 4 of 10:</strong> Type "Toronto to Kingston to Ottawa" — Bungee builds a 3-stop route and prices each leg separately.',
      "<strong>Step 5 of 10:</strong> Per-leg breakdown: drive time (adjustable), dock time, fixed cost, driver cost, and Total w/ Fuel for each leg.",
      "<strong>Step 6 of 10:</strong> Add accessorial charges — detention, extra stops, lumper, border crossing, TONU, tailgate, and surcharge. All factored into your total.",
      '<strong>Step 7 of 10:</strong> Enter your customer price ($1,050 → 29.6% margin), add a note like "ABC Logistics — RFQ #2847", then save.',
      "<strong>Step 8 of 10:</strong> Quote saved as Won! Download a branded PDF or share a link. Status, margin, and note are all tracked.",
      "<strong>Step 9 of 10:</strong> Quote History shows every saved quote — win rate, average margin, and total revenue update automatically.",
      '<strong>Step 10 of 10:</strong> Type "Walmart" to filter — only matching quotes appear. Search by lane, customer, note, or status.',
    ];

    const carousel = root.querySelector<HTMLElement>("[data-demo-carousel]");
    if (!carousel) return;

    const slides = carousel.querySelectorAll<HTMLElement>(".demo-slide");
    const dots = carousel.querySelectorAll<HTMLElement>(".demo-dot");
    const phases = carousel.querySelectorAll<HTMLElement>(".demo-phase");
    const caption = carousel.querySelector<HTMLElement>("[data-demo-caption]");
    const prevBtn = carousel.querySelector<HTMLButtonElement>("[data-demo-prev]");
    const nextBtn = carousel.querySelector<HTMLButtonElement>("[data-demo-next]");
    const total = slides.length;

    function goTo(idx: number) {
      if (idx < 0 || idx >= total) return;
      slides.forEach((s, i) => s.classList.toggle("active", i === idx));
      dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      if (caption) caption.innerHTML = CAPTIONS[idx] ?? "";
      if (prevBtn) prevBtn.disabled = idx === 0;
      if (nextBtn) nextBtn.disabled = idx === total - 1;
      // Highlight active phase title
      phases.forEach((p) => {
        const slideIds = (p.getAttribute("data-phase-slides") ?? "").split(",").map(Number);
        p.classList.toggle("active", slideIds.includes(idx));
      });
    }

    function getCurrent() {
      let c = 0;
      slides.forEach((s, i) => { if (s.classList.contains("active")) c = i; });
      return c;
    }

    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-demo-prev]")) { e.preventDefault(); goTo(getCurrent() - 1); return; }
      if (el.closest("[data-demo-next]")) { e.preventDefault(); goTo(getCurrent() + 1); return; }
      const dot = el.closest<HTMLElement>("[data-dot]");
      if (dot) { e.preventDefault(); goTo(parseInt(dot.getAttribute("data-dot") ?? "0")); return; }
      const phase = el.closest<HTMLElement>("[data-phase-slides]");
      if (phase) { e.preventDefault(); const first = parseInt((phase.getAttribute("data-phase-slides") ?? "0").split(",")[0]); goTo(first); }
    };

    carousel.addEventListener("click", handler);
    goTo(0); // initialize
    return () => carousel.removeEventListener("click", handler);
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
      const msg = sanitizeAuthErrorMessage(err, "Please check your credentials.");
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
    if (!resolvedPlace) {
      toast({ title: "City required", description: "Type your city and select it from the suggestions.", variant: "destructive" });
      return;
    }
    const effectiveCountryCode = countryCode || resolvedPlace.countryCode;
    if (!effectiveCountryCode) {
      toast({ title: "Country required", description: "Select your country.", variant: "destructive" });
      return;
    }
    const stateName = resolvedPlace.stateName || resolvedPlace.stateCode || "";
    const operatingCityValue = resolvedPlace.city || cityInput.trim();
    const yardLat = resolvedPlace.lat ?? null;
    const yardLng = resolvedPlace.lng ?? null;
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
      const countryLabel = resolvedPlace?.countryName ||
        COUNTRY_OPTIONS.find((c) => c.value === effectiveCountryCode)?.label || "";
      const countries = countryLabel ? [countryLabel] : [];
      const operatingRegions = stateName ? [stateName] : [];
      if (user) {
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
        localStorage.setItem("bungee_open_cost_wizard", "1");
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
      localStorage.setItem("bungee_open_cost_wizard", "1");
      setOnboardingActive(false);
      setLocation("/profiles");
      toast({ title: "Account created", description: "Set up your equipment cost profile to get started." });
    } catch (err: unknown) {
      setOnboardingActive(false);
      const msg = sanitizeAuthErrorMessage(err, "Please check your details.");
      toast({ title: "Sign up failed", description: msg, variant: "destructive" });
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
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    const strongPw = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()\-_=+])/;
    if (!strongPw.test(password)) {
      toast({ title: "Weak password", description: "Include uppercase, lowercase, a number, and a special character (e.g. @$!%*?).", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please make sure both password fields are identical.", variant: "destructive" });
      return;
    }
    setSignupStep(2);
    window.scrollTo(0, 0);
  }

  // Debounced Google Places suggestions
  useEffect(() => {
    if (cityInput.length < 2) { setCitySuggestions([]); return; }
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    cityDebounceRef.current = setTimeout(async () => {
      const suggestions = await fetchPlaceSuggestions(cityInput);
      setCitySuggestions(suggestions);
      if (suggestions.length > 0) setCityDropOpen(true);
    }, 300);
    return () => { if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current); };
  }, [cityInput]);

  // Close city dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cityDropRef.current && !cityDropRef.current.contains(e.target as Node)) {
        setCityDropOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Reset city when country changes
  useEffect(() => {
    setCityInput("");
    setResolvedPlace(null);
    setCitySuggestions([]);
  }, [countryCode]);

  // Signed-in real users shouldn't see this screen unless they're in onboarding — but never hide for Connect guest.
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
                onClick={() => { window.location.href = "/connect/"; }}
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
                <div className="password-input-wrap">
                  <input
                    id="login-password"
                    className="form-input form-input-password"
                    type={showPasswordLogin ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="password-toggle-btn" onClick={() => setShowPasswordLogin(v => !v)} aria-label={showPasswordLogin ? "Hide password" : "Show password"}>
                    {showPasswordLogin ? (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
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
                    type={showPasswordSignup ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Min 8 chars, uppercase, number, symbol"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="password-toggle-btn" onClick={() => setShowPasswordSignup(v => !v)} aria-label={showPasswordSignup ? "Hide password" : "Show password"}>
                    {showPasswordSignup ? (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                <div className="form-helper">At least 8 characters with uppercase, lowercase, number &amp; special character.</div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="su-confirm-password">
                  Confirm Password <span className="req">*</span>
                </label>
                <div className="password-input-wrap">
                  <input
                    id="su-confirm-password"
                    className="form-input form-input-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="password-toggle-btn" onClick={() => setShowConfirmPassword(v => !v)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                    {showConfirmPassword ? (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
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

              {/* ── City / Province autocomplete (Google Places) ─── */}
              <div className="form-group" ref={cityDropRef} style={{ position: "relative" }}>
                <label className="form-label" htmlFor="su-city">
                  City / Province <span className="req">*</span>
                </label>
                <input
                  id="su-city"
                  className="form-input"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Toronto, ON"
                  value={cityInput}
                  onChange={(e) => {
                    setCityInput(e.target.value);
                    setResolvedPlace(null);
                  }}
                  required={!resolvedPlace}
                />
                {cityResolving && (
                  <div style={{ fontSize: 11, color: "var(--slate-400)", marginTop: 3 }}>Resolving location…</div>
                )}
                {resolvedPlace && (
                  <div style={{ fontSize: 11, color: "var(--green-500, #22c55e)", marginTop: 3 }}>
                    ✓ {resolvedPlace.city}{resolvedPlace.stateName ? `, ${resolvedPlace.stateName}` : ""}, {resolvedPlace.countryName}
                  </div>
                )}
                {cityDropOpen && citySuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                      maxHeight: 200, overflowY: "auto",
                      background: "#fff", border: "1px solid var(--slate-200, #e2e8f0)",
                      borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", marginTop: 2,
                    }}
                  >
                    {citySuggestions.map((s) => (
                      <div
                        key={s}
                        onMouseDown={async (e) => {
                          e.preventDefault();
                          setCityInput(s);
                          setCityDropOpen(false);
                          setCitySuggestions([]);
                          setCityResolving(true);
                          const place = await resolvePlaceDetails(s);
                          setCityResolving(false);
                          if (place) {
                            setResolvedPlace(place);
                            if (!countryCode && place.countryCode) setCountryCode(place.countryCode);
                          }
                        }}
                        style={{
                          padding: "9px 12px", cursor: "pointer", fontSize: 14,
                          color: "var(--slate-700, #334155)",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--orange-50, #fff7ed)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        {s}
                      </div>
                    ))}
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
