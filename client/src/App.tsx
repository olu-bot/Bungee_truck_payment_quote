import { Switch, Route, Router, Link, Redirect, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { isOnboardingActive } from "@/lib/onboarding";
import { FirebaseAuthProvider, useFirebaseAuth } from "@/components/firebase-auth";
import { FeedbackSheet } from "@/components/FeedbackSheet";
import Walkthrough from "@/components/Walkthrough";
import type { TourId } from "@/components/Walkthrough";
import { db, firebaseConfigured } from "@/lib/firebase";
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { resolveWorkspaceCurrency, currencySymbol } from "@/lib/currency";
import { resolveMeasurementUnit } from "@/lib/measurement";
import { getLanes, getProfiles, createProfile } from "@/lib/firebaseDb";
import { convertCurrency } from "@/lib/currency";
import type { SupportedCurrency } from "@/lib/currency";
import { workspaceFirestoreId } from "@/lib/workspace";
import type { Lane } from "@shared/schema";
import { can, isManager, isSuperAdmin, getCompanyRole, ROLE_LABELS, ROLE_COLORS as PERM_ROLE_COLORS } from "@/lib/permissions";
import { useQuoteUsage } from "@/hooks/use-quote-usage";
import type { Permission } from "@/lib/permissions";

// ── Lazy-loaded page components (code-split per route) ──────────
const Landing = lazy(() => import("@/pages/landing"));
const RouteBuilder = lazy(() => import("@/pages/route-builder"));
const CostProfiles = lazy(() => import("@/pages/cost-profiles"));
const QuoteHistory = lazy(() => import("@/pages/quote-history"));
const TeamManagement = lazy(() => import("@/pages/team-management"));
const AdminAllUsers = lazy(() => import("@/pages/admin-all-users"));
const AdminFeedback = lazy(() => import("@/pages/admin-feedback"));
const HelpCenter = lazy(() => import("@/pages/help-center"));
const NotFound = lazy(() => import("@/pages/not-found"));
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  Route as RouteIcon,
  History,
  Settings,
  Moon,
  Sun,
  Menu,
  X,
  Users,
  LogOut,
  Shield,
  ContactRound,
  MessageSquare,
  Inbox,
  Ruler,
  DollarSign,
  Star,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  MapPin,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  Circle,
  BarChart3,
  Calculator,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Lightweight loading placeholder shown while lazy chunks download */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );
}

/* ── Confetti celebration effect ────────────────────────────── */
function ConfettiCelebration() {
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const COLORS = [
      "#f97316", "#fb923c", "#fbbf24", "#34d399", "#22d3ee",
      "#a78bfa", "#f472b6", "#ef4444", "#3b82f6", "#10b981",
    ];
    const NUM = 150;

    type Particle = {
      x: number; y: number; w: number; h: number;
      color: string; angle: number; spin: number;
      vx: number; vy: number; gravity: number; opacity: number;
    };

    const particles: Particle[] = Array.from({ length: NUM }, () => ({
      x: W * 0.5 + (Math.random() - 0.5) * W * 0.6,
      y: -20 - Math.random() * 100,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.15,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      gravity: 0.06 + Math.random() * 0.04,
      opacity: 1,
    }));

    let frame = 0;
    const MAX_FRAMES = 200;
    let raf = 0;

    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      // Fade out in last 40 frames
      const fadeStart = MAX_FRAMES - 40;

      for (const p of particles) {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.99;
        p.angle += p.spin;
        if (frame > fadeStart) p.opacity = Math.max(0, 1 - (frame - fadeStart) / 40);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (frame < MAX_FRAMES) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[10010] pointer-events-none"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    // Default to light on first load (especially for Home), unless the user previously chose a theme.
    try {
      const saved = window.localStorage.getItem("bungee_theme");
      if (saved === "dark") return true;
      if (saved === "light") return false;
    } catch {
      // ignore
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      window.localStorage.setItem("bungee_theme", dark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="button-theme-toggle"
      onClick={() => setDark(!dark)}
      className="h-8 w-8 p-0"
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function TeamRoute() {
  const { user } = useFirebaseAuth();
  if (!can(user, "team:view")) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        You don't have access to team management.
      </div>
    );
  }
  return <TeamManagement />;
}

const NAV_ITEMS: Array<{
  path: string;
  label: string;
  icon: typeof RouteIcon;
  /** Permission required to see this nav item. null = always visible. */
  requiredPermission: Permission | null;
  /** If true, only Bungee super-admins (app-level role === "admin") can see this. */
  superAdminOnly?: boolean;
}> = [
  { path: "/", label: "Home", icon: RouteIcon, requiredPermission: null },
  { path: "/history", label: "Quote History", icon: History, requiredPermission: null },
  { path: "/profiles", label: "Settings", icon: Settings, requiredPermission: null },
  { path: "/team", label: "Team", icon: Users, requiredPermission: "team:view" },
  // { path: "/help", label: "Help", icon: HelpCircle, requiredPermission: null }, // Hidden — no real content yet
  { path: "/admin/users", label: "View all users", icon: ContactRound, requiredPermission: null, superAdminOnly: true },
  { path: "/admin/feedback", label: "Feedback inbox", icon: Inbox, requiredPermission: null, superAdminOnly: true },
];

function AppLayout() {
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /** Bump to remount RouteBuilder (clear home) — logo click while already on Home, or full page reload */
  const [routeBuilderKey, setRouteBuilderKey] = useState(0);
  const { user, logout, authLoading } = useFirebaseAuth();
  /** Firebase session is restoring — avoid treating as logged out (no signup flash on refresh). */
  const sessionPending = authLoading && !user;
  const routePath = useMemo(() => location.split("?")[0] || "/", [location]);
  const isHome = routePath === "/";
  const [feedbackUnread, setFeedbackUnread] = useState(0);

  /* ── Walkthrough / Onboarding tour state ──────────────────── */
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [activeTourId, setActiveTourId] = useState<TourId>("overview");
  const [showConfetti, setShowConfetti] = useState(false);

  // Per-tour completion tracking — keys scoped to user UID so different accounts don't share state
  const TOUR_IDS: TourId[] = ["overview", "quote-history", "advanced-quote"];
  const tourDoneKey = useCallback((id: TourId) => user ? `bungee_tour_done_${user.uid}_${id}` : `bungee_tour_done_${id}`, [user]);
  const [completedTours, setCompletedTours] = useState<Set<TourId>>(new Set());

  // Sync completedTours when user changes (read their per-UID keys)
  useEffect(() => {
    if (!user) return;
    const done = new Set<TourId>();
    TOUR_IDS.forEach((id) => {
      // Only read UID-scoped keys — non-scoped keys could belong to another user on this browser
      if (localStorage.getItem(`bungee_tour_done_${user.uid}_${id}`) === "1") done.add(id);
    });
    // Also handle the old single-key format (uid-scoped)
    if (localStorage.getItem(`bungee_tour_done_${user.uid}`)) {
      if (!done.has("overview")) {
        localStorage.setItem(`bungee_tour_done_${user.uid}_overview`, "1");
        done.add("overview");
      }
    }
    setCompletedTours(done);
  }, [user]);

  const allToursComplete = completedTours.size === TOUR_IDS.length;

  const markTourDone = useCallback((id: TourId) => {
    localStorage.setItem(tourDoneKey(id), "1");
    setCompletedTours((prev) => new Set(prev).add(id));
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3500);
  }, [tourDoneKey]);

  // Auto-trigger overview walkthrough ONLY for genuinely new users
  // A new user has: no completed tours, no legacy keys, AND no existing Firestore data (profiles/quotes)
  useEffect(() => {
    if (!user || authLoading) return;
    const uid = user.uid;

    // Already completed overview tour? Don't show.
    // ONLY check UID-scoped keys — non-scoped keys belong to a previous user on this browser.
    if (localStorage.getItem(`bungee_tour_done_${uid}_overview`) === "1") return;
    if (localStorage.getItem(`bungee_tour_done_${uid}`)) return;

    // Check Firestore for existing data — if user has profiles or lanes, they're not new
    const companyId = workspaceFirestoreId(user);
    if (!companyId) return;

    Promise.all([getProfiles(companyId), getLanes(companyId)]).then(([profiles, lanes]) => {
      const hasExistingData = (profiles && profiles.length > 0) || (lanes && lanes.length > 0);
      if (hasExistingData) {
        // Returning user — mark all tours as done so checklist doesn't show
        TOUR_IDS.forEach((id) => localStorage.setItem(`bungee_tour_done_${uid}_${id}`, "1"));
        setCompletedTours(new Set(TOUR_IDS));
        return;
      }
      // Genuinely new user — show overview tour
      setTimeout(() => setShowWalkthrough(true), 600);
    }).catch(() => {
      // Firestore error — don't block, just skip auto-trigger
    });
  }, [user, authLoading]);

  const handleWalkthroughComplete = useCallback(() => {
    setShowWalkthrough(false);
    markTourDone(activeTourId);
    // Also set legacy key for overview tour backward compat
    if (user && activeTourId === "overview") {
      window.localStorage.setItem(`bungee_tour_done_${user.uid}`, "1");
    }
  }, [user, activeTourId, markTourDone]);

  const handleWalkthroughDismiss = useCallback(() => {
    setShowWalkthrough(false);
    // Dismissing a tour also counts as "done" so it doesn't keep bugging the user
    markTourDone(activeTourId);
    if (user && activeTourId === "overview") {
      window.localStorage.setItem(`bungee_tour_done_${user.uid}`, "1");
    }
  }, [user, activeTourId, markTourDone]);

  // Listen for manual tour trigger from Help page (supports tourId)
  useEffect(() => {
    const onStartTour = (e: Event) => {
      const tourId = (e as CustomEvent)?.detail?.tourId as TourId | undefined;
      setActiveTourId(tourId ?? "overview");
      setShowWalkthrough(true);
    };
    window.addEventListener("bungee:start-tour", onStartTour);
    return () => window.removeEventListener("bungee:start-tour", onStartTour);
  }, []);

  // Sidebar tour checklist items
  const SIDEBAR_TOURS: Array<{ id: TourId; label: string; icon: typeof Sparkles }> = [
    { id: "overview", label: "Getting Started", icon: Sparkles },
    { id: "quote-history", label: "Quote History", icon: BarChart3 },
    { id: "advanced-quote", label: "Advanced Quoting", icon: Calculator },
  ];

  const startSidebarTour = useCallback((tourId: TourId) => {
    setActiveTourId(tourId);
    // Navigate to the correct starting page for each tour
    if (tourId === "quote-history") {
      window.location.hash = "#/history";
    } else {
      window.location.hash = "#/";
    }
    setTimeout(() => setShowWalkthrough(true), 300);
  }, []);

  // Load favorite lanes from Firestore via React Query (shares cache with route-builder)
  const scopeId = useMemo(() => (user ? workspaceFirestoreId(user) : undefined), [user]);
  const { data: favLanes = [] } = useQuery<Lane[]>({
    queryKey: ["firebase", "lanes", scopeId ?? ""],
    queryFn: () => getLanes(scopeId),
    enabled: !!scopeId,
  });

  // Monthly quote usage tracking (visible countdown for free users)
  const quoteUsage = useQuoteUsage();

  const canSeeFeedback = isSuperAdmin(user);
  useEffect(() => {
    if (!canSeeFeedback || !firebaseConfigured || !db) {
      setFeedbackUnread(0);
      return;
    }
    const q = query(collection(db, "feedback"), where("readByAdmin", "==", false));
    const unsub = onSnapshot(
      q,
      (snap) => setFeedbackUnread(snap.size),
      () => setFeedbackUnread(0)
    );
    return () => unsub();
  }, [canSeeFeedback]);

  function handleLogoutClick() {
    setLogoutDialogOpen(true);
  }

  async function confirmLogout() {
    setLogoutDialogOpen(false);
    setMobileNavOpen(false);
    await logout();
  }

  /** Navigate to Home and tell RouteBuilder to load a favorite lane */
  function handleFavLaneClick(lane: Lane) {
    // Navigate to home if not already there
    if (routePath !== "/") {
      setLocation("/");
    }
    // Pass cached stops (if saved) so RouteBuilder can skip geocoding/routing API calls
    const cachedStops = (lane as any).cachedStops ?? null;
    // Dispatch a custom event that RouteBuilder listens for
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("bungee:load-lane", {
          detail: { origin: lane.origin, destination: lane.destination, cachedStops },
        })
      );
    }, 50); // Small delay to ensure RouteBuilder is mounted/visible
    setMobileNavOpen(false);
  }

  const userCompanyRole = getCompanyRole(user);
  const userRoleColor = PERM_ROLE_COLORS[userCompanyRole] || "";
  const userRoleLabel = ROLE_LABELS[userCompanyRole] || "";

  const visibleNav = sessionPending
    ? NAV_ITEMS.filter((item) => !item.requiredPermission && !item.superAdminOnly)
    : NAV_ITEMS.filter((item) => {
        if (!user) return false;
        if (item.superAdminOnly) return isSuperAdmin(user);
        if (item.requiredPermission) return can(user, item.requiredPermission);
        return true;
      });

  const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
    "/": { title: "Home", subtitle: "Build routes, calculate costs, and get pricing advice." },
    "/profiles": { title: "Settings", subtitle: "Manage your account, company info, and equipment cost profiles." },
    "/history": { title: "Quote History", subtitle: "View and manage your saved quotes." },
    "/team": { title: "Team Management", subtitle: "Manage team members and access roles." },
    "/admin/users": {
      title: "All users",
      subtitle: "Directory of every account — open a user to see their quote history and equipment cost profiles.",
    },
    "/admin/feedback": {
      title: "Feedback inbox",
      subtitle: "Review submissions, reply in the app, and optionally email users.",
    },
  };

  const page = PAGE_TITLES[routePath] || PAGE_TITLES["/"];

  // Resolve user preferences for display on home page
  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);

  // Definitely signed out — only after Firebase has finished restoring the session.
  if (!authLoading && !user) {
    if (routePath === "/signup") return <Suspense fallback={<PageLoader />}><Landing /></Suspense>;
    return <Redirect to="/signup" />;
  }

  // Session still restoring: keep current app URL (e.g. Home) instead of redirecting to signup.
  if (sessionPending && routePath === "/signup") {
    return <Suspense fallback={<PageLoader />}><Landing /></Suspense>;
  }

  // Signed in on /signup: onboarding vs home.
  if (user && routePath === "/signup") {
    if (isOnboardingActive()) return <Suspense fallback={<PageLoader />}><Landing /></Suspense>;
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── Sidebar (desktop) ────────────────────────────────── */}
      <aside
        className={`hidden md:flex flex-col border-r border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 h-screen z-40 transition-all duration-200 ${
          sidebarCollapsed ? "w-[60px]" : "w-[240px]"
        }`}
      >
        {/* Sidebar top: Logo (centered) + collapse toggle */}
        <div className={`relative flex items-center h-14 border-b border-border shrink-0 ${sidebarCollapsed ? "justify-center px-2" : "justify-center px-4"}`}>
          {!sidebarCollapsed && (
            <Link
              href="/"
              className="flex items-center gap-2"
              onClick={(e) => {
                if (location === "/") {
                  e.preventDefault();
                  setRouteBuilderKey((k) => k + 1);
                }
              }}
              title={location === "/" ? "Reset home (clear route & quote)" : "Go to home"}
            >
              <img
                src="/lottie/BungeeConnect-logo.png"
                alt="Bungee Connect"
                className="h-7 shrink-0 object-contain"
              />
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 shrink-0 ${sidebarCollapsed ? "" : "absolute right-2 top-1/2 -translate-y-1/2"}`}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
        </div>

        {/* Sidebar nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2" data-testid="nav-sidebar">
          <div className="flex flex-col gap-0.5">
            {visibleNav.map(({ path, label, icon: Icon }) => {
              const isActive = routePath === path;
              const inboxBadge = path === "/admin/feedback" && feedbackUnread > 0;
              return (
                <Link key={path} href={path}>
                  <button
                    data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
                    title={sidebarCollapsed ? label : undefined}
                    className={`relative flex items-center gap-2.5 w-full rounded-md text-sm transition-colors ${
                      sidebarCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"
                    } ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{label}</span>}
                    {inboxBadge && !sidebarCollapsed ? (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                        {feedbackUnread > 99 ? "99+" : feedbackUnread}
                      </span>
                    ) : inboxBadge && sidebarCollapsed ? (
                      <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-red-600" />
                    ) : null}
                  </button>
                </Link>
              );
            })}
            <button
              type="button"
              data-testid="nav-feedback"
              title={sidebarCollapsed ? "Feedback" : undefined}
              onClick={() => setFeedbackOpen(true)}
              className={`flex items-center gap-2.5 w-full rounded-md text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 ${
                sidebarCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"
              }`}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Feedback</span>}
            </button>
          </div>
        </nav>

        {/* ── Sidebar: Getting Started Checklist ──────────────── */}
        {!allToursComplete && (
          <div className={`border-t border-border shrink-0 ${sidebarCollapsed ? "px-1 py-2" : "px-3 py-3"}`}>
            {!sidebarCollapsed ? (
              <>
                <div className="flex items-center justify-between px-1 mb-2">
                  <div className="flex items-center gap-1.5">
                    <PartyPopper className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Get Started</span>
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground/60">{completedTours.size}/{TOUR_IDS.length}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1 rounded-full bg-slate-100 mx-1 mb-2.5 overflow-hidden">
                  <div
                    className="h-full bg-orange-400 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${(completedTours.size / TOUR_IDS.length) * 100}%` }}
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  {SIDEBAR_TOURS.map(({ id, label, icon: TourIcon }) => {
                    const done = completedTours.has(id);
                    return (
                      <button
                        key={id}
                        onClick={() => !done && startSidebarTour(id)}
                        className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-all group ${
                          done
                            ? "text-green-600/70 cursor-default"
                            : "text-muted-foreground hover:text-foreground hover:bg-orange-50 cursor-pointer"
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300 group-hover:text-orange-400 shrink-0" />
                        )}
                        <TourIcon className={`w-3 h-3 shrink-0 ${done ? "text-green-500/60" : "text-slate-400 group-hover:text-orange-500"}`} />
                        <span className={done ? "line-through" : ""}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex justify-center" title="Getting Started">
                <PartyPopper className="w-4 h-4 text-orange-500" />
              </div>
            )}
          </div>
        )}

        {/* Sidebar bottom: Favorite Lanes */}
        <div className={`border-t border-border shrink-0 ${sidebarCollapsed ? "px-1 py-2" : "px-3 py-3"}`}>
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center gap-1.5 px-1 mb-2">
                <Star className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Favorite Lanes</span>
              </div>
              {favLanes.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 px-1 py-2">
                  No saved lanes yet. Add lanes from the Route Builder to see them here.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
                  {favLanes.slice(0, 10).map((lane) => (
                    <button
                      key={lane.id}
                      onClick={() => handleFavLaneClick(lane)}
                      className="flex items-start gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors hover:bg-accent/50 group cursor-pointer"
                      title={`Load route: ${lane.origin} → ${lane.destination}`}
                    >
                      <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-primary/60 group-hover:text-primary" />
                      <div className="min-w-0">
                        <div className="truncate text-foreground/80 group-hover:text-foreground">
                          {lane.origin}
                        </div>
                        <div className="truncate text-muted-foreground">
                          → {lane.destination}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex justify-center" title="Favorite Lanes">
              <Star className="w-4 h-4 text-amber-500" />
            </div>
          )}
        </div>

        {/* Monthly quote usage (free tier only) */}
        {user && quoteUsage.limit !== -1 && (
          <div className={`border-t border-border shrink-0 ${sidebarCollapsed ? "px-1 py-2" : "px-3 py-3"}`}>
            {!sidebarCollapsed ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">Monthly Quotes</span>
                  <span className={`text-[11px] font-semibold tabular-nums ${quoteUsage.remaining <= 100 ? (quoteUsage.remaining <= 0 ? "text-red-500" : "text-amber-500") : "text-foreground"}`}>
                    {quoteUsage.remaining.toLocaleString()} left
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      quoteUsage.remaining <= 0
                        ? "bg-red-500"
                        : quoteUsage.remaining <= 100
                          ? "bg-amber-500"
                          : "bg-primary"
                    }`}
                    style={{ width: `${Math.min(100, (quoteUsage.used / quoteUsage.limit) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  {quoteUsage.used.toLocaleString()} / {quoteUsage.limit.toLocaleString()} used this month
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center" title={`${quoteUsage.remaining.toLocaleString()} quotes left this month`}>
                <span className={`text-[10px] font-bold tabular-nums ${quoteUsage.remaining <= 100 ? (quoteUsage.remaining <= 0 ? "text-red-500" : "text-amber-500") : "text-muted-foreground"}`}>
                  {quoteUsage.remaining}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Sidebar footer: User info + controls */}
        <div className={`border-t border-border shrink-0 ${sidebarCollapsed ? "px-1 py-2" : "px-3 py-3"}`}>
          {!sidebarCollapsed ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {user ? (
                  <Badge variant="outline" className={`text-xs gap-1 truncate ${userRoleColor}`}>
                    <Shield className="w-3 h-3 shrink-0" />
                    <span className="truncate">{user.name}</span>
                  </Badge>
                ) : (
                  <div className="h-6 w-20 rounded-md bg-muted/30" aria-hidden />
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {/* <ThemeToggle /> */}
                {user && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleLogoutClick}
                    data-testid="button-logout"
                    title="Switch user"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              {/* <ThemeToggle /> */}
              {user && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={handleLogoutClick}
                  data-testid="button-logout"
                  title="Switch user"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ─── Mobile overlay sidebar ───────────────────────────── */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          {/* Drawer */}
          <aside className="relative w-[260px] h-full bg-background border-r border-border flex flex-col shadow-xl z-10">
            {/* Mobile drawer header */}
            <div className="flex items-center justify-between h-14 border-b border-border px-4 shrink-0">
              <Link
                href="/"
                className="flex items-center gap-2"
                onClick={(e) => {
                  setMobileNavOpen(false);
                  if (location === "/") {
                    e.preventDefault();
                    setRouteBuilderKey((k) => k + 1);
                  }
                }}
              >
                <img
                  src="/lottie/BungeeConnect-logo.png"
                  alt="Bungee Connect"
                  className="h-7 shrink-0 object-contain"
                />
              </Link>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setMobileNavOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Mobile nav items */}
            <nav className="flex-1 overflow-y-auto py-3 px-2">
              <div className="flex flex-col gap-0.5">
                {visibleNav.map(({ path, label, icon: Icon }) => {
                  const isActive = routePath === path;
                  const inboxBadge = path === "/admin/feedback" && feedbackUnread > 0;
                  return (
                    <Link key={path} href={path}>
                      <button
                        onClick={() => setMobileNavOpen(false)}
                        className={`relative flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{label}</span>
                        {inboxBadge ? (
                          <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                            {feedbackUnread > 99 ? "99+" : feedbackUnread}
                          </span>
                        ) : null}
                      </button>
                    </Link>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setFeedbackOpen(true);
                    setMobileNavOpen(false);
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50"
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span>Feedback</span>
                </button>
              </div>
            </nav>

            {/* Mobile: Getting Started Checklist */}
            {!allToursComplete && (
              <div className="border-t border-border px-3 py-3 shrink-0">
                <div className="flex items-center justify-between px-1 mb-2">
                  <div className="flex items-center gap-1.5">
                    <PartyPopper className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Get Started</span>
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground/60">{completedTours.size}/{TOUR_IDS.length}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-100 mx-1 mb-2.5 overflow-hidden">
                  <div className="h-full bg-orange-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${(completedTours.size / TOUR_IDS.length) * 100}%` }} />
                </div>
                <div className="flex flex-col gap-0.5">
                  {SIDEBAR_TOURS.map(({ id, label, icon: TourIcon }) => {
                    const done = completedTours.has(id);
                    return (
                      <button
                        key={id}
                        onClick={() => { if (!done) { setMobileNavOpen(false); startSidebarTour(id); } }}
                        className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-all group ${
                          done ? "text-green-600/70 cursor-default" : "text-muted-foreground hover:text-foreground hover:bg-orange-50 cursor-pointer"
                        }`}
                      >
                        {done ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-300 group-hover:text-orange-400 shrink-0" />}
                        <TourIcon className={`w-3 h-3 shrink-0 ${done ? "text-green-500/60" : "text-slate-400 group-hover:text-orange-500"}`} />
                        <span className={done ? "line-through" : ""}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mobile fav lanes */}
            <div className="border-t border-border px-3 py-3 shrink-0">
              <div className="flex items-center gap-1.5 px-1 mb-2">
                <Star className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Favorite Lanes</span>
              </div>
              {favLanes.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 px-1 py-1">No saved lanes yet.</p>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-[140px] overflow-y-auto">
                  {favLanes.slice(0, 10).map((lane) => (
                    <button
                      key={lane.id}
                      onClick={() => handleFavLaneClick(lane)}
                      className="flex items-start gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors hover:bg-accent/50 group cursor-pointer"
                      title={`Load route: ${lane.origin} → ${lane.destination}`}
                    >
                      <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-primary/60 group-hover:text-primary" />
                      <div className="min-w-0">
                        <div className="truncate text-foreground/80 group-hover:text-foreground">{lane.origin}</div>
                        <div className="truncate text-muted-foreground">→ {lane.destination}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile quote usage */}
            {user && quoteUsage.limit !== -1 && (
              <div className="border-t border-border px-3 py-3 shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Monthly Quotes</span>
                  <span className={`text-[11px] font-semibold tabular-nums ${quoteUsage.remaining <= 100 ? (quoteUsage.remaining <= 0 ? "text-red-500" : "text-amber-500") : "text-foreground"}`}>
                    {quoteUsage.remaining.toLocaleString()} left
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${quoteUsage.remaining <= 0 ? "bg-red-500" : quoteUsage.remaining <= 100 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, (quoteUsage.used / quoteUsage.limit) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  {quoteUsage.used.toLocaleString()} / {quoteUsage.limit.toLocaleString()} used this month
                </p>
              </div>
            )}

            {/* Mobile user controls */}
            <div className="border-t border-border px-3 py-3 shrink-0">
              <div className="flex items-center justify-between">
                {user ? (
                  <Badge variant="outline" className={`text-xs gap-1 truncate ${userRoleColor}`}>
                    <Shield className="w-3 h-3 shrink-0" />
                    <span className="truncate">{user.name}</span>
                  </Badge>
                ) : null}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* <ThemeToggle /> */}
                  {user && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleLogoutClick}>
                      <LogOut className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ─── Main content area ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar (replaces full header on small screens) */}
        <header className="md:hidden sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="px-4 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid="button-mobile-menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="w-4 h-4" />
              </Button>
              <Link
                href="/"
                onClick={(e) => {
                  if (location === "/") {
                    e.preventDefault();
                    setRouteBuilderKey((k) => k + 1);
                  }
                }}
              >
                <img
                  src="/lottie/BungeeConnect-logo.png"
                  alt="Bungee Connect"
                  className="h-7 shrink-0 object-contain"
                />
              </Link>
            </div>
            <div className="flex items-center gap-1">
              {user && (
                <Badge variant="outline" className={`text-xs gap-1 ${userRoleColor} hidden sm:flex`}>
                  <Shield className="w-3 h-3" />
                  {user.name}
                </Badge>
              )}
            </div>
          </div>
        </header>

        <FeedbackSheet open={feedbackOpen} onOpenChange={setFeedbackOpen} />

        {/* Main */}
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
          <div className="mb-3">
            <h1 className="text-sm font-semibold" data-testid="text-page-title">
              {page.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
              <p className="text-xs text-slate-500">
                {page.subtitle}
              </p>
              {isHome && user && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title="Preferred currency">
                    <DollarSign className="w-3 h-3" />
                    {currency}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title="Unit of measurement">
                    <Ruler className="w-3 h-3" />
                    {measureUnit === "imperial" ? "Imperial (mi, gal)" : "Metric (km, L)"}
                  </span>
                </div>
              )}
              {/* Portal target for RouteBuilder controls (profile, fuel, toggle) */}
              {isHome && <div id="route-controls-portal" className="flex items-center gap-3 ml-auto" />}
            </div>
          </div>

          {/* Keep RouteBuilder mounted while signed in so form/route state survives nav away from Home */}
          <Suspense fallback={<PageLoader />}>
            <div className={isHome ? "block" : "hidden"} aria-hidden={!isHome}>
              <RouteBuilder key={routeBuilderKey} />
            </div>
            {!isHome &&
              (routePath === "/profiles" ? (
                <CostProfiles />
              ) : routePath === "/history" ? (
                <QuoteHistory />
              ) : routePath === "/team" ? (
                <TeamRoute />
              ) : routePath === "/help" ? (
                <HelpCenter />
              ) : routePath === "/admin/users" ? (
                isSuperAdmin(user) ? <AdminAllUsers /> : <NotFound />
              ) : routePath === "/admin/feedback" ? (
                isSuperAdmin(user) ? <AdminFeedback /> : <NotFound />
              ) : (
                <NotFound />
              ))}
          </Suspense>
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-3 mt-auto">
          <div className="px-4 sm:px-6 flex items-center justify-center">
            <span className="text-[11px] text-slate-400">&copy; {new Date().getFullYear()} Bungee Supply Chain Ltd.</span>
          </div>
        </footer>
      </div>

      {/* Multi-tour walkthrough overlay (first login + Help page replay) */}
      {showWalkthrough && (
        <Walkthrough
          tourId={activeTourId}
          onComplete={handleWalkthroughComplete}
          onDismiss={handleWalkthroughDismiss}
        />
      )}

      {/* Confetti celebration effect on tour completion */}
      {showConfetti && <ConfettiCelebration />}

      {/* Logout confirmation dialog */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Logout?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out? You will need to sign in again to access the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLogout}>Log out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <FirebaseAuthProvider>
            <AppLayout />
          </FirebaseAuthProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
