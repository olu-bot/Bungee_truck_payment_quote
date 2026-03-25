import { Switch, Route, Router, Link, Redirect, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import Landing from "@/pages/landing";
import { isOnboardingActive } from "@/lib/onboarding";
import { FirebaseAuthProvider, useFirebaseAuth } from "@/components/firebase-auth";
import RouteBuilder from "@/pages/route-builder";
import CostProfiles from "@/pages/cost-profiles";
import TeamManagement from "@/pages/team-management";
import QuoteHistory from "@/pages/quote-history";
import AdminAllUsers from "@/pages/admin-all-users";
import AdminFeedback from "@/pages/admin-feedback";
import NotFound from "@/pages/not-found";
import { FeedbackSheet } from "@/components/FeedbackSheet";
import { db, firebaseConfigured } from "@/lib/firebase";
import { useState, useEffect } from "react";
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
  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        Team management is available to company admins only.
      </div>
    );
  }
  return <TeamManagement />;
}

const NAV_ITEMS = [
  { path: "/", label: "Home", icon: RouteIcon, requiresAdmin: false },
  { path: "/profiles", label: "Cost Profiles", icon: Settings, requiresAdmin: false },
  { path: "/history", label: "History", icon: History, requiresAdmin: false },
  { path: "/team", label: "Team", icon: Users, requiresAdmin: true },
  { path: "/admin/users", label: "View all users", icon: ContactRound, requiresAdmin: true },
  { path: "/admin/feedback", label: "Feedback inbox", icon: Inbox, requiresAdmin: true },
];

function AppLayout() {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /** Bump to remount RouteBuilder (clear home) — logo click while already on Home, or full page reload */
  const [routeBuilderKey, setRouteBuilderKey] = useState(0);
  const { user, logout, authLoading } = useFirebaseAuth();
  /** Firebase session is restoring — avoid treating as logged out (no signup flash on refresh). */
  const sessionPending = authLoading && !user;
  const isAdmin = user?.role === "admin";
  const isHome = location === "/";
  const [feedbackUnread, setFeedbackUnread] = useState(0);

  useEffect(() => {
    if (!isAdmin || !firebaseConfigured || !db) {
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
  }, [isAdmin]);

  function handleLogoutClick() {
    setLogoutDialogOpen(true);
  }

  async function confirmLogout() {
    setLogoutDialogOpen(false);
    setMobileNavOpen(false);
    await logout();
  }

  const ROLE_COLORS: Record<string, string> = {
    admin: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    user: "bg-green-500/10 text-green-600 dark:text-green-400",
  };

  const visibleNav = sessionPending
    ? NAV_ITEMS.filter((item) => !item.requiresAdmin)
    : NAV_ITEMS.filter((item) => {
        if (!user) return false;
        if (item.requiresAdmin) return isAdmin;
        return true;
      });

  const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
    "/": { title: "Home", subtitle: "Build routes, calculate costs, and get pricing advice." },
    "/profiles": { title: "Cost Profiles", subtitle: "Configure your truck operating costs." },
    "/history": { title: "Quote History", subtitle: "View and manage your saved quotes." },
    "/team": { title: "Team Management", subtitle: "Manage team members and access roles." },
    "/admin/users": {
      title: "All users",
      subtitle: "Directory of every account — open a user to see their quote history and cost profiles.",
    },
    "/admin/feedback": {
      title: "Feedback inbox",
      subtitle: "Review submissions, reply in the app, and optionally email users.",
    },
  };

  const page = PAGE_TITLES[location] || PAGE_TITLES["/"];

  // Definitely signed out — only after Firebase has finished restoring the session.
  if (!authLoading && !user) {
    if (location === "/signup") return <Landing />;
    return <Redirect to="/signup" />;
  }

  // Session still restoring: keep current app URL (e.g. Home) instead of redirecting to signup.
  if (sessionPending && location === "/signup") {
    return <Landing />;
  }

  // Signed in on /signup: onboarding vs home.
  if (user && location === "/signup") {
    if (isOnboardingActive()) return <Landing />;
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2"
            onClick={(e) => {
              if (location === "/") {
                e.preventDefault();
                setRouteBuilderKey((k) => k + 1);
              }
            }}
            title={
              location === "/"
                ? "Reset home (clear route & quote)"
                : "Go to home"
            }
          >
            <img
              src="/lottie/logo.jpg"
              alt="Bungee Connect"
              className="h-16 w-16 shrink-0 rounded-md object-contain"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1" data-testid="nav-desktop">
            {visibleNav.map(({ path, label, icon: Icon }) => {
              const isActive = location === path;
              const inboxBadge = path === "/admin/feedback" && feedbackUnread > 0;
              return (
                <Link key={path} href={path}>
                  <button
                    data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors
                      ${
                        isActive
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {inboxBadge ? (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {feedbackUnread > 99 ? "99+" : feedbackUnread}
                      </span>
                    ) : null}
                  </button>
                </Link>
              );
            })}
            <button
              type="button"
              data-testid="nav-feedback"
              onClick={() => setFeedbackOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Feedback
            </button>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              {user ? (
                <>
                  <Badge variant="outline" className={`text-xs gap-1 ${ROLE_COLORS[user.role] || ""}`}>
                    <Shield className="w-3 h-3" />
                    {user.name}
                  </Badge>
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
                </>
              ) : (
                <div className="h-8 w-[148px] rounded-md bg-muted/30" aria-hidden />
              )}
            </div>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 md:hidden"
              data-testid="button-mobile-menu"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
            >
              {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileNavOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-2">
            {visibleNav.map(({ path, label, icon: Icon }) => {
              const isActive = location === path;
              const inboxBadge = path === "/admin/feedback" && feedbackUnread > 0;
              return (
                <Link key={path} href={path}>
                  <button
                    onClick={() => setMobileNavOpen(false)}
                    className={`relative flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors
                      ${isActive ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                    {inboxBadge ? (
                      <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
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
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
            >
              <MessageSquare className="w-4 h-4" />
              Feedback
            </button>
            {user ? (
              <button
                type="button"
                onClick={handleLogoutClick}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
              >
                <LogOut className="w-4 h-4" />
                Switch User
              </button>
            ) : null}
          </div>
        )}
      </header>

      <FeedbackSheet open={feedbackOpen} onOpenChange={setFeedbackOpen} />

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold" data-testid="text-page-title">
            {page.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {page.subtitle}
          </p>
        </div>

        {/* Keep RouteBuilder mounted while signed in so form/route state survives nav away from Home */}
        <div className={isHome ? "block" : "hidden"} aria-hidden={!isHome}>
          <RouteBuilder key={routeBuilderKey} />
        </div>
        {!isHome && (
          <Switch>
            <Route path="/profiles" component={CostProfiles} />
            <Route path="/history" component={QuoteHistory} />
            <Route path="/team" component={TeamRoute} />
            <Route path="/admin/users" component={AdminAllUsers} />
            <Route path="/admin/feedback" component={AdminFeedback} />
            <Route component={NotFound} />
          </Switch>
        )}
      </main>

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

      {/* Footer */}
      <footer className="border-t border-border py-4 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between">
          <PerplexityAttribution />
        </div>
      </footer>
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
