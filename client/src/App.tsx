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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { db, firebaseConfigured } from "@/lib/firebase";
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { resolveWorkspaceCurrency, currencySymbol } from "@/lib/currency";
import { resolveMeasurementUnit } from "@/lib/measurement";
import { getLanes } from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import type { Lane, RouteStop } from "@shared/schema";
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
  { path: "/profiles", label: "Settings", icon: Settings, requiredPermission: null },
  { path: "/history", label: "Quote History", icon: History, requiredPermission: null },
  { path: "/team", label: "Team", icon: Users, requiredPermission: "team:view" },
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
    const cachedStops = "cachedStops" in lane && Array.isArray((lane as Record<string, unknown>).cachedStops)
      ? (lane as Record<string, unknown>).cachedStops as RouteStop[]
      : null;
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
          <ErrorBoundary>
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
                ) : routePath === "/admin/users" ? (
                  isSuperAdmin(user) ? <AdminAllUsers /> : <NotFound />
                ) : routePath === "/admin/feedback" ? (
                  isSuperAdmin(user) ? <AdminFeedback /> : <NotFound />
                ) : (
                  <NotFound />
                ))}
            </Suspense>
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-3 mt-auto">
          <div className="px-4 sm:px-6 flex items-center justify-center">
            <span className="text-[11px] text-slate-400">&copy; {new Date().getFullYear()} Bungee Supply Chain Ltd.</span>
          </div>
        </footer>
      </div>

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
