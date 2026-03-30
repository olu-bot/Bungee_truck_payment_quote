import { useState, useEffect, useCallback, useRef } from "react";
import { X, ArrowRight, ArrowLeft, Sparkles, ChevronRight } from "lucide-react";

/* ══════════════════════════════════════════════════════════════
   INTERACTIVE WALKTHROUGH OVERLAY  v7 — MULTI-TOUR
   ══════════════════════════════════════════════════════════════
   Supports multiple tour definitions selected by `tourId` prop.
   Available tours:
     "overview"       — 8-step first-time onboarding
     "quote-history"  — 6-step Quote History & Win/Loss Tracking
     "advanced-quote" — 6-step Advanced Quoting Mode
   ══════════════════════════════════════════════════════════════ */

/* ── Step definition ───────────────────────────────────────── */
export interface WalkthroughStep {
  target: string;
  title: string;
  body: string;
  placement: "top" | "bottom" | "left" | "right";
  /** Orange hint — tells user what to do */
  action?: string;
  /** How the step auto-advances (if set, Next is hidden on first visit) */
  advanceWhen?:
    | "click"           // user clicks the target element
    | "value-changed"   // target input value changes
    | "element-added";  // advanceSelector element appears in DOM
  /** CSS selector watched for "element-added" advance mode */
  advanceSelector?: string;
  /** Hash route to navigate to before measuring target */
  navigateTo?: string;
  /** Delay before measuring target (ms) — useful after page navigation */
  measureDelay?: number;
  /** Selectors to click in order before measuring target (setup actions) */
  setupClicks?: string[];
  /** Arbitrary setup function to run before measuring (e.g. clear an input) */
  setupFn?: () => void;
  /** Preferred side to offset tooltip when placement causes overlap */
  tooltipOffset?: { x?: number; y?: number };
}

/* ── Tour ID type ─────────────────────────────────────────── */
export type TourId = "overview" | "quote-history" | "advanced-quote";

export const TOUR_META: Record<TourId, { title: string; description: string }> = {
  overview: {
    title: "Getting Started",
    description: "Build your first quote in 2 minutes",
  },
  "quote-history": {
    title: "Quote History & Win/Loss",
    description: "Track quotes, mark wins & losses, download PDFs",
  },
  "advanced-quote": {
    title: "Advanced Quoting Mode",
    description: "Unlock cost breakdowns, charges, and leg details",
  },
};

/* ══════════════════════════════════════════════════════════════
   TOUR: OVERVIEW (8 steps)
   ══════════════════════════════════════════════════════════════ */
const OVERVIEW_STEPS: WalkthroughStep[] = [
  // 0 — Quick Start in Cost Profiles
  {
    target: '[data-testid="button-quick-start"]',
    title: "Quick Start \u2014 Set Up in Seconds",
    body: "Welcome to Bungee Connect! Let\u2019s get you quoting in under a minute. Click Quick Start to create a cost profile with industry-standard defaults \u2014 you can fine-tune the numbers anytime.",
    placement: "left",
    action: "Click Quick Start to create your first cost profile.",
    advanceWhen: "click",
    navigateTo: "#/profiles?tab=company",
    setupClicks: [
      '[data-testid="button-create-first-profile"]',
      '[data-testid="button-create-profile"]',
    ],
    measureDelay: 1000,
  },
  // 1 — Click a lane chip to build a route
  {
    target: '[data-testid^="chip-"]:nth-child(2)',
    title: "Build Your First Route",
    body: "Let\u2019s build a route! Click one of these quick lane suggestions to instantly calculate driving distance, time, and your full cost estimate.",
    placement: "top",
    action: "Click a lane to build the route.",
    advanceWhen: "click",
    navigateTo: "#/",
    measureDelay: 600,
  },
  // 2 — Fuel price explanation
  {
    target: '[data-testid="input-fuel-price"]',
    title: "Your Fuel Cost",
    body: "This is your diesel price per litre (or gallon). Bungee multiplies it by your truck\u2019s fuel consumption rate and route distance to calculate the fuel cost for each trip. You can change this number anytime to match your actual pump price, or Pro users get live EIA pricing that updates automatically.",
    placement: "bottom",
    navigateTo: "#/",
    measureDelay: 5000,
    tooltipOffset: { x: -120 },
  },
  // 3 — Click Advanced button
  {
    target: '[data-testid="button-advanced"]',
    title: "Advanced Mode",
    body: "Want more control over your cost and pricing? Click Advanced to unlock extra fields like detention, surcharges, per-mile overrides, and a full cost breakdown.",
    placement: "bottom",
    action: "Click Advanced to expand.",
    advanceWhen: "click",
    navigateTo: "#/",
    measureDelay: 400,
    tooltipOffset: { x: -80 },
  },
  // 4 — Showcase advanced fields (manual Next — user reads about them)
  {
    target: '[data-testid="advanced-section"]',
    title: "Advanced Cost & Charge Fields",
    body: "Here you can fine-tune dock time, deadhead costs, accessorial surcharges, and per-mile overrides. Toggle the full breakdown to see exactly how each cost component adds up to your trip cost.",
    placement: "top",
    navigateTo: "#/",
    measureDelay: 800,
  },
  // 5 — Enter custom quote price
  {
    target: '[data-testid="input-custom-quote"]',
    title: "Set Your Price",
    body: "Type your customer price here \u2014 your profit margin updates in real time based on your carrier cost. Use the preset margin tiers above as a guide, or enter any number you like.",
    placement: "top",
    action: "Type a price to see your margin update.",
    advanceWhen: "value-changed",
    navigateTo: "#/",
    measureDelay: 400,
  },
  // 6 — Enter customer note
  {
    target: '[data-testid="input-customer-note"]',
    title: "Add a Note",
    body: "Add a memo for this quote \u2014 broker name, RFQ number, load details, or any reference you\u2019ll want later. It appears on your saved quote and the PDF you can share.",
    placement: "top",
    action: "Type a quick note (e.g. your name or a load number).",
    advanceWhen: "value-changed",
    navigateTo: "#/",
    measureDelay: 400,
  },
  // 7 — Save quote to finish
  {
    target: '[data-testid="button-save-quote"]',
    title: "Save Your Quote",
    body: "You\u2019re all set! Every quote can be saved with an instant outcome \u2014 Won, Pending, or Lost. For now, let\u2019s save this one as Pending. You can always update the status later from Quote History.",
    placement: "left",
    action: "Click Pending to save your quote and complete the tour!",
    advanceWhen: "click",
    navigateTo: "#/",
    measureDelay: 400,
  },
];

/* ══════════════════════════════════════════════════════════════
   TOUR: QUOTE HISTORY & WIN/LOSS TRACKING (6 steps)
   ══════════════════════════════════════════════════════════════ */
/* Helper: clear the search input on Quote History */
const clearQuoteSearch = () => {
  const input = document.querySelector('[data-testid="input-search-quotes"]') as HTMLInputElement | null;
  if (input && input.value) {
    // Use native setter to trigger React's onChange
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
};

const QUOTE_HISTORY_STEPS: WalkthroughStep[] = [
  // 0 — Navigate to Quote History and show the stats bar
  {
    target: '[data-testid="quote-stats-bar"]',
    title: "Your Quote Dashboard",
    body: "This stats bar gives you a quick overview: total quotes saved, win rate, average margin, and total revenue. It updates automatically as you mark quotes won or lost.",
    placement: "bottom",
    navigateTo: "#/history",
    measureDelay: 800,
  },
  // 1 — Show the status badge area
  {
    target: '[data-testid="status-badge"]',
    title: "Quote Status Tracking",
    body: "Every quote has a status: Pending (waiting for response), Won (you got the load), or Lost (didn\u2019t win it). The coloured badge makes it easy to see where each quote stands at a glance.",
    placement: "left",
    navigateTo: "#/history",
    measureDelay: 400,
  },
  // 2 — Click the Won button (clear any search filter first to ensure PENDING quotes are visible)
  {
    target: '[data-testid="button-won"]',
    title: "Mark a Quote as Won",
    body: "Click the trophy icon to mark this quote as Won. You can optionally enter the rate you closed at \u2014 Bungee tracks your actual vs. quoted margin so you can see how accurate your pricing is over time.",
    placement: "left",
    action: "Click the trophy to mark this quote as Won.",
    advanceWhen: "click",
    navigateTo: "#/history",
    setupFn: clearQuoteSearch,
    measureDelay: 600,
  },
  // 3 — Won rate input (appears after clicking Won)
  {
    target: '[data-testid="input-won-rate"]',
    title: "Record Your Winning Rate",
    body: "Enter the actual rate you closed the deal at. This feeds into your win/loss analytics so you can track how your quoted price compares to what you actually get paid.",
    placement: "left",
    action: "Type a rate to record it.",
    advanceWhen: "value-changed",
    navigateTo: "#/history",
    measureDelay: 600,
  },
  // 4 — Download PDF
  {
    target: '[data-testid="button-download-pdf"]',
    title: "Share a Professional PDF",
    body: "Generate a branded PDF quote to email brokers or save for your records. It includes your company logo, lane details, pricing, and any notes \u2014 a professional touch that sets you apart.",
    placement: "left",
    navigateTo: "#/history",
    setupFn: clearQuoteSearch,
    measureDelay: 400,
  },
  // 5 — Search and filter (last step — so filter doesn't break earlier steps)
  {
    target: '[data-testid="input-search-quotes"]',
    title: "Find Any Quote Fast",
    body: "Search by lane, customer name, or note. Start typing and quotes filter in real time \u2014 great when you need to pull up that quote from last week.",
    placement: "bottom",
    navigateTo: "#/history",
    measureDelay: 400,
  },
];

/* ══════════════════════════════════════════════════════════════
   TOUR: ADVANCED QUOTING MODE (6 steps)
   ══════════════════════════════════════════════════════════════ */
/* Setup: ensure Quick mode + build a route so Advanced fields have data */
const setupAdvancedTour = () => {
  // Force Quick Quote mode so clicking Advanced toggles it ON
  localStorage.setItem("bungee_quote_mode", "quick");
  // Click a lane chip to trigger route calculation
  const chip = document.querySelector('[data-testid^="chip-"]') as HTMLElement | null;
  if (chip) chip.click();
};

const ADVANCED_QUOTE_STEPS: WalkthroughStep[] = [
  // 0 — Toggle Advanced mode (first builds a route via setupFn)
  {
    target: '[data-testid="button-advanced"]',
    title: "Enter Advanced Mode",
    body: "Advanced Mode unlocks the full power of Bungee\u2019s quoting engine. You\u2019ll get granular cost controls, accessorial charges, per-leg breakdowns, and real-time profit analysis.",
    placement: "bottom",
    action: "Click Advanced to expand all fields.",
    advanceWhen: "click",
    navigateTo: "#/",
    setupFn: setupAdvancedTour,
    measureDelay: 5000,
    tooltipOffset: { x: -80 },
  },
  // 1 — COST section: Pay Mode + Breakdown toggle
  {
    target: '[data-testid="switch-pay-mode"]',
    title: "Per Hour or Per KM",
    body: "Toggle between Per Hour and Per KM pay modes. Per Hour is common for local/drayage work; Per KM suits long-haul. Your cost profile rates adjust automatically \u2014 and the breakdown below updates in real time.",
    placement: "bottom",
    navigateTo: "#/",
    measureDelay: 1200,
  },
  // 2 — Dock Time & Deadhead
  {
    target: '[data-testid="dock-deadhead-section"]',
    title: "Dock Time & Deadhead",
    body: "Dock time adds waiting hours at pickup/delivery (billed at your hourly rate). Deadhead accounts for empty miles to reach the shipper. Both are crucial for accurate cost-per-trip calculations.",
    placement: "bottom",
    navigateTo: "#/",
    measureDelay: 400,
  },
  // 3 — CHARGES section
  {
    target: '[data-testid="charges-section"]',
    title: "Accessorial Charges",
    body: "Add detention, extra stops, lumper fees, border crossing, and TONU charges. These line items appear on your PDF quote and get factored into your total cost \u2014 so your margin stays accurate even on complex loads.",
    placement: "top",
    navigateTo: "#/",
    measureDelay: 400,
  },
  // 4 — Toggle the cost breakdown
  {
    target: '[data-testid="button-toggle-breakdown"]',
    title: "Full Cost Breakdown",
    body: "Click to expand the detailed breakdown: fuel, labour, maintenance, insurance, admin, and more \u2014 all calculated from your cost profile. This is the carrier\u2019s true cost of the trip, line by line.",
    placement: "bottom",
    action: "Click to see the full breakdown.",
    advanceWhen: "click",
    navigateTo: "#/",
    measureDelay: 400,
  },
  // 5 — Leg breakdown (if visible)
  {
    target: '[data-testid="leg-breakdown"]',
    title: "Per-Leg Analysis",
    body: "For multi-stop routes, each leg shows its own distance, time, and cost. This helps you spot which segments are profitable and which ones eat into your margin \u2014 essential for LTL and multi-drop quotes.",
    placement: "top",
    navigateTo: "#/",
    measureDelay: 800,
  },
];

/* ── All tours map ────────────────────────────────────────── */
const TOURS: Record<TourId, WalkthroughStep[]> = {
  overview: OVERVIEW_STEPS,
  "quote-history": QUOTE_HISTORY_STEPS,
  "advanced-quote": ADVANCED_QUOTE_STEPS,
};

/* ── Helpers ──────────────────────────────────────────────── */
const PAD = 8;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

/* ══════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function Walkthrough({
  tourId = "overview",
  onComplete,
  onDismiss,
}: {
  tourId?: TourId;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const steps = TOURS[tourId];
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);
  /** Steps the user has already advanced past (for back-nav) */
  const [completed, setCompleted] = useState<Set<number>>(() => new Set());

  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const stepRef = useRef(currentStep);
  stepRef.current = currentStep;

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const progress = ((currentStep + 1) / steps.length) * 100;

  // Hide Next only on interactive steps the user hasn't completed yet
  const hideNext = !!step.advanceWhen && !completed.has(currentStep);

  /* ── Measure target element ──────────────────────────────── */
  const measureTarget = useCallback(() => {
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    if (rect.top < 80 || rect.bottom > viewH - 40) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTargetRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        });
      }, 350);
    } else {
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      });
    }
  }, [step.target]);

  /* ── Tooltip position — avoids overlapping the target ───── */
  const computeTooltipPosition = useCallback((): React.CSSProperties => {
    if (!targetRect || !tooltipRef.current) {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    const tt = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 14;
    let top = 0;
    let left = 0;

    switch (step.placement) {
      case "bottom":
        top = targetRect.bottom + gap;
        left = targetRect.left + targetRect.width / 2 - tt.width / 2;
        break;
      case "top":
        top = targetRect.top - tt.height - gap;
        left = targetRect.left + targetRect.width / 2 - tt.width / 2;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tt.height / 2;
        left = targetRect.right + gap;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tt.height / 2;
        left = targetRect.left - tt.width - gap;
        break;
    }

    // Apply per-step offset to avoid overlap
    const offset = step.tooltipOffset;
    if (offset) {
      if (offset.x) left += offset.x;
      if (offset.y) top += offset.y;
    }

    // Clamp to viewport
    top = Math.max(12, Math.min(top, vh - tt.height - 12));
    left = Math.max(12, Math.min(left, vw - tt.width - 12));

    // Final overlap check — if tooltip overlaps target, shift it
    const ttBottom = top + tt.height;
    const ttRight = left + tt.width;
    const tTop = targetRect.top - PAD;
    const tBottom = targetRect.bottom + PAD;
    const tLeft = targetRect.left - PAD;
    const tRight = targetRect.right + PAD;

    const overlapsV = ttBottom > tTop && top < tBottom;
    const overlapsH = ttRight > tLeft && left < tRight;

    if (overlapsV && overlapsH) {
      // Push tooltip below or above the target
      if (step.placement === "left" || step.placement === "right") {
        // For side placements, shift vertically
        if (targetRect.bottom + gap + tt.height < vh) {
          top = targetRect.bottom + gap;
        } else {
          top = targetRect.top - tt.height - gap;
        }
      } else {
        // For top/bottom, shift horizontally
        if (targetRect.right + gap + tt.width < vw) {
          left = targetRect.right + gap;
        } else {
          left = targetRect.left - tt.width - gap;
        }
      }
      // Re-clamp
      top = Math.max(12, Math.min(top, vh - tt.height - 12));
      left = Math.max(12, Math.min(left, vw - tt.width - 12));
    }

    return { position: "fixed", top, left };
  }, [targetRect, step.placement, step.tooltipOffset]);

  /* ── Step change → navigate, setup clicks, measure, reveal ── */
  useEffect(() => {
    setReady(false);
    setTargetRect(null);
    let cancelled = false;

    const s = steps[currentStep];

    // Navigate to the correct page if needed
    if (s.navigateTo) {
      if (window.location.hash !== s.navigateTo) {
        window.location.hash = s.navigateTo;
      }
    }

    // Perform setup actions before measuring target
    const runSetup = async () => {
      // Run arbitrary setup function first (e.g. clear search input)
      if (s.setupFn) {
        await new Promise((r) => setTimeout(r, 300));
        s.setupFn();
        await new Promise((r) => setTimeout(r, 400));
      }
      // Then click setup elements (e.g., open wizard before spotlighting Quick Start)
      if (s.setupClicks && s.setupClicks.length > 0) {
        // Wait for page to settle after navigation
        await new Promise((r) => setTimeout(r, 600));
        for (const selector of s.setupClicks) {
          if (cancelled) return;
          const el = document.querySelector(selector) as HTMLElement | null;
          if (el) {
            el.click();
            // Wait for the UI to react
            await new Promise((r) => setTimeout(r, 400));
            break; // Only click the first found button (alternatives list)
          }
        }
      }
      if (cancelled) return;
      const delay = s.measureDelay ?? 120;
      setTimeout(() => {
        if (!cancelled) measureTarget();
      }, delay);
    };

    runSetup();
    return () => {
      cancelled = true;
    };
  }, [currentStep, measureTarget]);

  /* ── Retry polling: if target not found, keep trying ─────── */
  useEffect(() => {
    if (targetRect !== null) {
      const t = setTimeout(() => setReady(true), 60);
      return () => clearTimeout(t);
    }

    // Target not found — poll every 300ms for up to 15s
    let attempts = 0;
    const maxAttempts = 50;
    const poll = setInterval(() => {
      attempts++;
      const el = document.querySelector(steps[currentStep].target);
      if (el) {
        clearInterval(poll);
        measureTarget();
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
      }
    }, 300);

    return () => clearInterval(poll);
  }, [targetRect, currentStep, measureTarget]);

  /* ── Track resize / scroll ──────────────────────────────── */
  useEffect(() => {
    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measureTarget);
    };
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [measureTarget]);

  /* ── Navigation ──────────────────────────────────────────── */
  const goNext = useCallback(() => {
    setCompleted((prev) => new Set(prev).add(stepRef.current));
    if (stepRef.current >= steps.length - 1) {
      setExiting(true);
      window.dispatchEvent(new CustomEvent("bungee:tour-complete", { detail: { tourId } }));
      setTimeout(() => onComplete(), 200);
      return;
    }
    setReady(false);
    setCurrentStep((s) => s + 1);
  }, [onComplete, steps, tourId]);

  const goPrev = () => {
    setReady(false);
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const handleDismiss = () => {
    setExiting(true);
    window.dispatchEvent(new CustomEvent("bungee:tour-dismiss", { detail: { tourId } }));
    setTimeout(() => onDismiss(), 200);
  };

  // Stable ref so effects can call goNext without stale closures
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  /* ── Keyboard nav ────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
      if (e.key === "ArrowRight" && !hideNext && stepRef.current < steps.length - 1)
        goNextRef.current();
      if (e.key === "ArrowLeft" && stepRef.current > 0) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ═══════════════════════════════════════════════════════════
     AUTO-ADVANCE EFFECT
     Watches for the user's action and advances automatically.
     Skipped on already-completed steps (user navigated back).
     ═══════════════════════════════════════════════════════════ */
  useEffect(() => {
    const s = steps[currentStep];
    if (!s.advanceWhen || completed.has(currentStep)) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let cleanupFn: (() => void) | undefined;
    const frozenStep = currentStep;

    const startWatcher = () => {
      if (cancelled) return;

      switch (s.advanceWhen) {
        /* ── User clicked the target element ──────────────── */
        case "click": {
          const attach = (el: HTMLElement) => {
            const handler = () => {
              if (!cancelled && stepRef.current === frozenStep) {
                setTimeout(() => goNextRef.current(), 300);
              }
            };
            el.addEventListener("click", handler, { once: true });
            cleanupFn = () => el.removeEventListener("click", handler);
          };

          const el = document.querySelector(s.target) as HTMLElement | null;
          if (el) {
            attach(el);
          } else {
            // Poll for element after navigation
            interval = setInterval(() => {
              const found = document.querySelector(s.target) as HTMLElement | null;
              if (found && !cancelled) {
                clearInterval(interval);
                attach(found);
              }
            }, 200);
          }
          break;
        }

        /* ── Target input value changed (debounced — waits 2s after user stops typing) ── */
        case "value-changed": {
          const input = document.querySelector(s.target) as HTMLInputElement | null;
          const initial = input?.value || "";
          let lastSeen = initial;
          let debounceTimer: ReturnType<typeof setTimeout> | undefined;
          interval = setInterval(() => {
            if (!input) return;
            const v = input.value.trim();
            if (v !== lastSeen) {
              // Value changed since last poll — restart the 2s idle timer
              lastSeen = v;
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = undefined;
              if (v !== initial && v !== "" && v !== "0") {
                debounceTimer = setTimeout(() => {
                  if (!cancelled && stepRef.current === frozenStep) {
                    clearInterval(interval);
                    goNextRef.current();
                  }
                }, 2000);
              }
            }
          }, 200);
          // Extend cleanup to also clear the debounce timer
          const origCleanup = cleanupFn;
          cleanupFn = () => { origCleanup?.(); if (debounceTimer) clearTimeout(debounceTimer); };
          break;
        }

        /* ── A new DOM element appeared ───────────────────── */
        case "element-added": {
          const sel = s.advanceSelector!;
          // If element already exists, advance immediately
          if (document.querySelector(sel)) {
            setTimeout(() => {
              if (!cancelled && stepRef.current === frozenStep) goNextRef.current();
            }, 200);
            break;
          }
          interval = setInterval(() => {
            if (document.querySelector(sel)) {
              if (!cancelled && stepRef.current === frozenStep) {
                clearInterval(interval);
                setTimeout(() => goNextRef.current(), 300);
              }
            }
          }, 200);
          break;
        }
      }
    };

    // Small delay so step has time to settle
    const delay = s.measureDelay ? s.measureDelay + 200 : 300;
    const startDelay = setTimeout(startWatcher, delay);

    return () => {
      cancelled = true;
      clearTimeout(startDelay);
      if (interval) clearInterval(interval);
      cleanupFn?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  /* ── Computed tooltip style ──────────────────────────────── */
  const tooltipStyle = ready
    ? computeTooltipPosition()
    : ({ position: "fixed", top: -9999, left: -9999 } as React.CSSProperties);

  return (
    <div
      className={`fixed inset-0 z-[9999] transition-opacity duration-200 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
      style={{ pointerEvents: "none" }}
    >
      {/* ── Backdrop with spotlight cutout ──────────────────── */}
      <svg
        className="fixed inset-0 w-full h-full"
        style={{ pointerEvents: "none" }}
      >
        <defs>
          <mask id="wt-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - PAD}
                y={targetRect.top - PAD}
                width={targetRect.width + PAD * 2}
                height={targetRect.height + PAD * 2}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.45)"
          mask="url(#wt-mask)"
        />
      </svg>

      {/* ── Spotlight ring ─────────────────────────────────── */}
      {targetRect && ready && (
        <div
          className="fixed rounded-[10px] ring-2 ring-orange-400/60 pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
          }}
        >
          <div className="absolute -top-1.5 -right-1.5 w-3 h-3">
            <span className="absolute inset-0 rounded-full bg-orange-400 animate-ping opacity-75" />
            <span className="absolute inset-0 rounded-full bg-orange-400" />
          </div>
        </div>
      )}

      {/* ── Tooltip ────────────────────────────────────────── */}
      <div
        ref={tooltipRef}
        className={`fixed z-[10001] w-[340px] transition-opacity duration-150 ${
          ready ? "opacity-100" : "opacity-0"
        }`}
        style={{ ...tooltipStyle, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-slate-200/80 overflow-hidden">
          {/* Progress bar */}
          <div className="h-[3px] bg-slate-100">
            <div
              className="h-full bg-orange-400 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-slate-400">
                {currentStep + 1} of {steps.length}
              </span>
              <button
                onClick={handleDismiss}
                className="w-6 h-6 rounded-md hover:bg-slate-100 flex items-center justify-center transition-colors"
                aria-label="Close tour"
              >
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">
              {step.title}
            </h3>
            <p className="text-[13px] text-slate-500 leading-[1.65] mb-1">
              {step.body}
            </p>

            {/* Action hint */}
            {step.action && (
              <p className="text-[12px] text-orange-600 font-medium leading-relaxed mb-3 mt-2">
                {step.action}
              </p>
            )}
            {!step.action && <div className="mb-3" />}

            {/* Controls */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleDismiss}
                className="text-[12px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
              >
                Skip tour
              </button>

              <div className="flex items-center gap-1.5">
                {!isFirst && (
                  <button
                    onClick={goPrev}
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                )}
                {!hideNext && (
                  <button
                    onClick={goNext}
                    className="h-8 px-3.5 rounded-lg bg-slate-900 text-white text-[12px] font-medium flex items-center gap-1.5 hover:bg-slate-800 transition-colors"
                  >
                    {isLast ? "Finish" : "Next"}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   WELCOME BANNER — re-entry point on Help page
   ══════════════════════════════════════════════════════════════ */

export function WalkthroughTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 w-full rounded-xl border border-dashed border-orange-300/60 bg-orange-50/40 px-4 py-3 hover:bg-orange-50 hover:border-orange-300 transition-all"
    >
      <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-200 transition-colors">
        <Sparkles className="w-4 h-4 text-orange-500" />
      </div>
      <div className="text-left flex-1 min-w-0">
        <p className="text-[13px] font-medium text-slate-800">
          Take the guided tour
        </p>
        <p className="text-[12px] text-slate-500">
          Learn to build your first quote in 2 minutes
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all shrink-0" />
    </button>
  );
}
