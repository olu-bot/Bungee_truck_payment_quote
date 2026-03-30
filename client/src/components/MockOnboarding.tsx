/**
 * MockOnboarding.tsx
 * ──────────────────────────────────────────────────────────
 * 5-step self-contained onboarding tour for first-time users.
 *
 * This component renders a FULL-SCREEN duplicate of the real Bungee Connect UI
 * using the exact same Tailwind classes, shadcn/ui components, and lucide-react
 * icons as the actual app. The onboarding flow is completely decoupled from the
 * real app pages — changes to the real home page or settings page won't break
 * this tour.
 *
 * Flow:
 *   1. Welcome — quick cost profile setup  (screen: profile)
 *   2. Save profile                        (screen: profile)
 *   3. Build a route from chatbox          (screen: home)
 *   4. Fuel price + Advanced toggle        (screen: home)
 *   5. Done — confetti + CTA              (screen: done)
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Route as RouteIcon,
  History,
  Settings,
  Star,
  MapPin,
  Shield,
  LogOut,
  MessageSquare,
  HelpCircle,
  PanelLeftClose,
  Truck,
  Snowflake,
  Layers,
  Package,
  Container,
  ChevronDown,
  ChevronUp,
  Save,
  FileDown,
  FileText,
  Info,
  Zap,
  ArrowLeft,
  X,
  Lock,
  CheckCircle2,
  DollarSign,
  Calendar,
  Clock,
  User,
  Fuel,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

/* ─── Types ─── */
interface Props {
  onComplete: () => void;
  onDismiss: () => void;
}

type Screen = "profile" | "home" | "done";

/* ─── Constants ─── */
const TOTAL_STEPS = 5;

const TOOLTIP_CONFIG = [
  {
    title: "Welcome to Bungee Connect!",
    body: "Let\u2019s get you set up in under a minute. First, we\u2019ll create your equipment cost profile so Bungee can calculate accurate per-trip costs.",
    hint: null,
    nextLabel: "Let\u2019s go \u2192",
    orange: true,
  },
  {
    title: "Save your cost profile",
    body: "We\u2019ve pre-filled regional averages for a Dry Van in Ontario. Adjust any numbers to match your real costs, then save.",
    hint: "Click \u201cSave Profile\u201d to continue.",
    nextLabel: null,
    orange: false,
  },
  {
    title: "Build a route from chat",
    body: "Type a route like \u201cToronto to Montreal\u201d and Bungee instantly calculates distance, fuel, and your carrier cost.",
    hint: "Click a suggested route to continue.",
    nextLabel: null,
    orange: false,
  },
  {
    title: "Live fuel & cost breakdown",
    body: "Bungee pulls regional fuel prices daily and applies them to your route. The advanced panel shows exactly how your carrier cost is calculated.",
    hint: null,
    nextLabel: "See Advanced \u2192",
    orange: false,
  },
  {
    title: "You\u2019re ready!",
    body: "That\u2019s it \u2014 you know the essentials. Build routes, see your real costs, and quote with confidence.",
    hint: null,
    nextLabel: "Start Using Bungee \u2192",
    orange: true,
  },
];

const EQUIP_TYPES = [
  { key: "dry_van", label: "Dry Van", Icon: Package },
  { key: "reefer", label: "Reefer", Icon: Snowflake },
  { key: "flatbed", label: "Flatbed", Icon: Layers },
  { key: "step_deck", label: "Step Deck", Icon: Layers },
  { key: "tanker", label: "Tanker", Icon: Container },
];

const ROUTE_CHIPS = ["Toronto to Toronto", "Toronto to Montreal", "Toronto to Vancouver"];

/* ─── Component ─── */
export default function MockOnboarding({ onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [screen, setScreen] = useState<Screen>("profile");
  const [equipType, setEquipType] = useState("dry_van");
  const [chatMessages, setChatMessages] = useState<{ from: "bot" | "user"; text: string }[]>([
    {
      from: "bot",
      text: "Hi! Type a route below \u2014 e.g. \u201cToronto to Montreal\u201d \u2014 and I\u2019ll update the map, dropdowns, and cost estimate automatically.",
    },
  ]);
  const [routeSet, setRouteSet] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  /* ─── Navigation ─── */
  const goStep = useCallback((s: number) => {
    setStep(s);
    if (s <= 1) setScreen("profile");
    else if (s <= 3) setScreen("home");
    else setScreen("done");
  }, []);

  const next = useCallback(() => {
    if (step < TOTAL_STEPS - 1) goStep(step + 1);
  }, [step, goStep]);

  /* ─── Actions ─── */
  const handleSaveProfile = useCallback(() => {
    if (step === 1) next();
  }, [step, next]);

  const handleRouteClick = useCallback(
    (route: string) => {
      setChatMessages((prev) => [...prev, { from: "user", text: route }]);
      setRouteSet(true);
      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            from: "bot",
            text: "Route set! Toronto \u2192 Montreal \u2014 541 km, ~5.4 hrs. Your carrier cost is $1,847.32.",
          },
        ]);
        if (step === 2) setTimeout(() => next(), 600);
      }, 500);
    },
    [step, next],
  );

  const handleAdvanced = useCallback(() => {
    setAdvOpen(true);
    setTimeout(() => next(), 500);
  }, [next]);

  const handleFinish = useCallback(() => {
    setShowConfetti(true);
    setTimeout(() => onComplete(), 2500);
  }, [onComplete]);

  const handleNextClick = useCallback(() => {
    if (step === 0) next();
    else if (step === 3) handleAdvanced();
    else if (step === 4) handleFinish();
  }, [step, next, handleAdvanced, handleFinish]);

  const tc = TOOLTIP_CONFIG[step];

  /* ─── Sidebar nav items (matches real app) ─── */
  const navItems = [
    { label: "Home", Icon: RouteIcon, active: screen === "home" || screen === "done" },
    { label: "Settings", Icon: Settings, active: screen === "profile" },
    { label: "Quote History", Icon: History, active: false },
    { label: "Help", Icon: HelpCircle, active: false },
  ];

  /* ─── Render ─── */
  return (
    <div className="fixed inset-0 z-[9998] flex bg-background" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* ─── Sidebar (exact duplicate of real sidebar) ─── */}
      <aside className="hidden md:flex flex-col border-r border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 h-screen z-40 transition-all duration-200 w-[240px]">
        {/* Logo */}
        <div className="relative flex items-center h-14 border-b border-border shrink-0 justify-center px-4">
          <div className="flex items-center gap-2">
            <img src="/lottie/BungeeConnect-logo.png" alt="Bungee Connect" className="h-7 shrink-0 object-contain" />
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 absolute right-2 top-1/2 -translate-y-1/2">
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <div className="flex flex-col gap-0.5">
            {navItems.map(({ label, Icon, active }) => (
              <button
                key={label}
                className={`relative flex items-center gap-2.5 w-full rounded-md text-sm transition-colors px-3 py-2 ${
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
            <button className="flex items-center gap-2.5 w-full rounded-md text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 px-3 py-2">
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span>Feedback</span>
            </button>
          </div>
        </nav>

        {/* Favorite Lanes */}
        <div className="border-t border-border shrink-0 px-3 py-3">
          <div className="flex items-center gap-1.5 px-1 mb-2">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Favorite Lanes</span>
          </div>
          <p className="text-xs text-muted-foreground/60 px-1 py-2">No saved lanes yet. Add lanes from the Route Builder to see them here.</p>
        </div>

        {/* Monthly Quotes */}
        <div className="border-t border-border shrink-0 px-3 py-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">Monthly Quotes</span>
              <span className="text-[11px] font-semibold tabular-nums text-foreground">1,000 left</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 bg-primary" style={{ width: "0%" }} />
            </div>
            <p className="text-[10px] text-muted-foreground/70">0 / 1,000 used this month</p>
          </div>
        </div>

        {/* User info */}
        <div className="border-t border-border shrink-0 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className="text-xs gap-1 truncate">
                <Shield className="w-3 h-3 shrink-0" />
                <span className="truncate">New User</span>
              </Badge>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main content area ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
          {screen === "profile" && <ProfileScreen equipType={equipType} setEquipType={setEquipType} onSave={handleSaveProfile} />}
          {screen === "home" && (
            <HomeScreen
              chatMessages={chatMessages}
              chatEndRef={chatEndRef}
              routeSet={routeSet}
              advOpen={advOpen}
              onRouteClick={handleRouteClick}
              onChatSubmit={handleRouteClick}
            />
          )}
          {screen === "done" && <DoneScreen onFinish={handleFinish} />}
        </main>

        <footer className="border-t border-border py-3 mt-auto">
          <div className="px-4 sm:px-6 flex items-center justify-center">
            <span className="text-[11px] text-slate-400">&copy; {new Date().getFullYear()} Bungee Supply Chain Ltd.</span>
          </div>
        </footer>
      </div>

      {/* ─── Walkthrough tooltip overlay ─── */}
      {step < TOTAL_STEPS && (
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          {(step === 0 || step === 4) && <div className="absolute inset-0 bg-black/45 pointer-events-auto" />}
          {step === 1 && <SpotlightRing selector='[data-onboarding="save-profile"]' />}
          {step === 2 && <SpotlightRing selector='[data-onboarding="chat-panel"]' />}
          {step === 3 && <SpotlightRing selector='[data-onboarding="fuel-section"]' />}

          <div
            className="absolute w-[320px] bg-white border border-slate-200/80 rounded-[14px] shadow-lg z-[10002] pointer-events-auto overflow-hidden"
            style={
              step === 0 || step === 4
                ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
                : step === 1
                  ? { bottom: 80, right: 60 }
                  : step === 2
                    ? { bottom: 40, left: 280 }
                    : { right: 60, top: "50%", transform: "translateY(-50%)" }
            }
          >
            <div className="h-[3px] bg-slate-100">
              <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
            </div>
            <button onClick={onDismiss} className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className="px-[18px] pt-4 pb-3.5">
              <div className="text-[11px] font-medium text-slate-400 mb-1.5">{step + 1} of {TOTAL_STEPS}</div>
              <div className="text-sm font-semibold text-slate-900 mb-1.5">{tc.title}</div>
              <div className="text-[13px] text-slate-500 leading-relaxed">{tc.body}</div>
              {tc.hint && <div className="text-xs text-orange-500 font-medium mt-2">{tc.hint}</div>}
            </div>
            <div className="flex justify-between items-center px-[18px] pb-3.5 pt-2.5">
              <button onClick={onDismiss} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Skip tour</button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => goStep(step - 1)}>
                    {"\u2190"} Back
                  </Button>
                )}
                {tc.nextLabel && (
                  <Button
                    size="sm"
                    className={`h-8 text-xs ${tc.orange ? "bg-orange-400 hover:bg-orange-500 text-white" : ""}`}
                    onClick={handleNextClick}
                  >
                    {tc.nextLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfetti && <Confetti />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROFILE SCREEN — duplicates the Settings page + CostDiscoveryWizard
   Matches: CostDiscoveryWizard.tsx exactly
   ═══════════════════════════════════════════════════════════ */
function ProfileScreen({
  equipType,
  setEquipType,
  onSave,
}: {
  equipType: string;
  setEquipType: (t: string) => void;
  onSave: () => void;
}) {
  return (
    <div>
      {/* Page title — matches real Settings page */}
      <div className="mb-3">
        <h1 className="text-sm font-semibold">Settings</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
          <p className="text-xs text-slate-500">Manage your account, company info, and equipment cost profiles.</p>
        </div>
      </div>

      {/* CostDiscoveryWizard duplicate */}
      <div className="space-y-3 pb-32">
        {/* Heading */}
        <h2 className="text-base font-semibold text-slate-900">Create Equipment Cost Profile</h2>

        {/* Privacy / encryption banner */}
        <div
          className="flex items-center gap-2.5 rounded-lg px-3.5 py-3"
          style={{ background: "linear-gradient(135deg, #065f46 0%, #047857 100%)", color: "#fff" }}
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white/15 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <span className="text-[13px] font-semibold leading-snug">
            Your equipment cost profile is encrypted &amp; private. No one can access it {"\u2014"} not even us.
          </span>
        </div>

        {/* Quick Start banner */}
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-orange-50 shrink-0">
            <Zap className="w-4 h-4 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">Don{"\u2019"}t have your numbers handy?</p>
            <p className="text-xs text-slate-500 mt-0.5">Start with industry defaults {"\u2014"} you can fine-tune later.</p>
          </div>
          <Button size="sm" className="shrink-0 bg-orange-400 text-white hover:bg-orange-500 shadow-sm">
            Quick Start
          </Button>
        </div>

        {/* Setup: Name, Equipment, Location */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4 space-y-4">
            {/* Profile Name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Profile Name</Label>
              <Input
                placeholder="e.g. My Dry Van, Reefer Unit #3"
                className="h-9 text-sm border-slate-200 focus:border-slate-400 transition-colors"
              />
            </div>

            {/* Equipment + Location side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Equipment Type</Label>
                <div className="space-y-2.5">
                  <div className="flex flex-wrap gap-2">
                    {EQUIP_TYPES.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setEquipType(key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors border cursor-pointer
                          ${equipType === key
                            ? "bg-orange-400 text-white border-orange-400"
                            : "bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600"
                          }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors border cursor-pointer bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      Other
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Where are you based?</Label>
                <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 cursor-pointer hover:border-slate-400 transition-colors h-9">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-sm flex-1">Ontario (ON)</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <p className="text-[11px] text-orange-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  Ontario {"\u2014"} costs auto-filled from regional averages
                </p>
              </div>
            </div>

            {/* Regional averages notice */}
            <div className="flex items-center gap-2.5 rounded-md bg-orange-50 border border-orange-200 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-orange-500 shrink-0" />
              <p className="text-[13px] text-orange-700 leading-snug">
                All fields pre-filled with regional averages for your equipment type. Adjust any values that differ for your operation.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Monthly Fixed Costs section ── */}
        <CostSection
          title="Monthly Fixed Costs"
          Icon={DollarSign}
          fields={[
            { key: "truckPayment", label: "Truck payment", icon: Truck, value: "2048", suffix: "$", benchmark: "$2,048" },
            { key: "insurance", label: "Insurance", icon: Shield, value: "1170", suffix: "$", benchmark: "$1,170" },
            { key: "maintenance", label: "Maintenance & tires", icon: DollarSign, value: "528", suffix: "$", benchmark: "$528" },
            { key: "permits", label: "Permits & plates", icon: Shield, value: "98", suffix: "$", benchmark: "$98" },
            { key: "other", label: "Other (ELD, parking, etc.)", icon: DollarSign, value: "161", suffix: "$", benchmark: "$161" },
          ]}
        />

        {/* ── Working Schedule section ── */}
        <CostSection
          title="Working Schedule"
          Icon={Calendar}
          fields={[
            { key: "workDays", label: "Working days / month", icon: Calendar, value: "22", suffix: "days", benchmark: "22" },
            { key: "billableHours", label: "Billable hours / day", icon: Clock, value: "10", suffix: "hrs", benchmark: "10" },
          ]}
        />

        {/* ── Driver Pay section ── */}
        <CostSection
          title="Driver Pay"
          Icon={User}
          fields={[
            { key: "hourlyRate", label: "Hourly rate", icon: User, value: "30.78", suffix: "$/hr", benchmark: "$30.78" },
            { key: "perKmRate", label: "Per-km rate (long haul)", icon: User, value: "0.52", suffix: "$/km", benchmark: "$0.52", optional: true },
            { key: "deadhead", label: "Deadhead pay (%)", icon: User, value: "80", suffix: "%", benchmark: "80", optional: true },
          ]}
        />

        {/* ── Fuel section ── */}
        <CostSection
          title="Fuel"
          Icon={Fuel}
          fields={[
            { key: "fuelConsumption", label: "Fuel consumption (L/100km)", icon: Fuel, value: "38.1", suffix: "L/100km", benchmark: "38.1" },
          ]}
        />

        {/* ── Save button ── */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            data-onboarding="save-profile"
            className="gap-2 min-w-[200px] h-10 text-sm font-semibold bg-orange-400 hover:bg-orange-500 text-white shadow-sm hover:shadow-md transition-all"
            onClick={onSave}
          >
            <Save className="w-5 h-5" />
            Save Profile
          </Button>
        </div>

        {/* ── Sticky cost summary bar ── */}
        <div className="sticky bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="space-y-0.5">
                <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Monthly Fixed</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">$4,005.00</p>
              </div>
              <div className="space-y-0.5 border-l border-slate-200 pl-3">
                <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">All-In Hourly</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">$48.98/hr</p>
              </div>
              <div className="space-y-0.5 border-l border-slate-200 pl-3">
                <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Est. Cost/KM</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">~$0.61</p>
              </div>
              <div className="space-y-0.5 border-l border-slate-200 pl-3">
                <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Fixed/Hour</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">$18.20/hr</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-2">* Excludes fuel {"\u2014"} calculated per-route</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable cost section card (matches CostDiscoveryWizard sections) ── */
type FieldDef = {
  key: string;
  label: string;
  icon: typeof Truck;
  value: string;
  suffix: string;
  benchmark: string;
  optional?: boolean;
};

function CostSection({
  title,
  Icon,
  fields,
}: {
  title: string;
  Icon: typeof Truck;
  fields: FieldDef[];
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-slate-50">
            <Icon className="w-3.5 h-3.5 text-slate-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>

        <div className="space-y-3">
          {fields.map((field) => {
            const FieldIcon = field.icon;
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5 flex-1 min-w-0">
                    <FieldIcon className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">{field.label}</span>
                    {field.optional && (
                      <span className="text-[10px] font-normal text-slate-400">(optional)</span>
                    )}
                  </Label>
                  <button
                    type="button"
                    title="Click to use regional average"
                    className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2 py-0.5 rounded-md transition-colors shrink-0 cursor-pointer"
                  >
                    avg: {field.benchmark}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-9 text-sm flex-1 border-slate-200 focus:border-slate-400 transition-colors tabular-nums"
                    defaultValue={field.value}
                    readOnly
                  />
                  <span className="text-xs font-medium text-slate-400 w-12 text-right shrink-0">
                    {field.suffix}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   HOME SCREEN — duplicates the Route Builder (home) page
   Matches: route-builder.tsx + App.tsx header
   ═══════════════════════════════════════════════════════════ */
function HomeScreen({
  chatMessages,
  chatEndRef,
  routeSet,
  advOpen,
  onRouteClick,
  onChatSubmit,
}: {
  chatMessages: { from: "bot" | "user"; text: string }[];
  chatEndRef: React.RefObject<HTMLDivElement>;
  routeSet: boolean;
  advOpen: boolean;
  onRouteClick: (route: string) => void;
  onChatSubmit: (text: string) => void;
}) {
  return (
    <div>
      {/* Page title */}
      <div className="mb-3">
        <h1 className="text-sm font-semibold">Home</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
          <p className="text-xs text-slate-500">Build routes, calculate costs, and get pricing advice.</p>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            $ CAD
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Metric (km, L)
          </span>
          {/* Profile selector + Fuel + Toggle — matches route-builder header */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Profile selector */}
            <div className="flex items-center border border-slate-200 rounded-md h-8 px-2.5 text-xs text-slate-600 gap-1.5">
              <span className="text-slate-400">Profile</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </div>
            {/* Fuel price */}
            <div className="flex items-center gap-1 border border-slate-200 rounded-md h-8 px-2">
              <Input type="number" className="h-7 text-xs w-[50px] border-0 shadow-none focus-visible:ring-0 px-0 text-center" defaultValue="2.55" readOnly />
              <span className="text-[11px] text-slate-400">$/L</span>
            </div>
            {/* Quick Quote / Advanced toggle */}
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden h-8 text-xs font-medium select-none">
              <button className="px-3 flex items-center bg-white text-slate-500">Quick Quote</button>
              <button className="px-3 flex items-center border-l border-slate-200 bg-slate-900 text-white">Advanced</button>
            </div>
          </div>
        </div>
      </div>

      {/* Cost card (sticky) */}
      <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-1 bg-background">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3 sm:p-4 space-y-2.5">
            {/* Row 1: Route name + stats */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
                <button className="shrink-0 p-0.5 rounded transition-colors text-amber-400">
                  <Star className="w-4 h-4 fill-amber-400" />
                </button>
                <span className="text-[15px] font-semibold text-slate-900 truncate tracking-tight">
                  {routeSet ? "Toronto \u2192 Montreal" : "Toronto"}
                </span>
                {routeSet && (
                  <span className="text-[13px] text-slate-400 whitespace-nowrap">541 km {"\u00b7"} 5h 24m (est.)</span>
                )}
              </div>
            </div>

            {/* Row 2: Pricing columns */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-slate-100">
              <div className="space-y-1 pr-4 sm:pr-6">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Carrier Cost</div>
                <div className="text-2xl font-bold text-orange-600 tabular-nums tracking-tight">
                  {routeSet ? "$1,847" : "$0.00"}
                </div>
                <div className="text-[11px] text-slate-400">with fuel</div>
              </div>
              {[
                { label: "20% Margin", value: routeSet ? "$2,309" : "set route", sub: routeSet ? "+$462" : "" },
                { label: "30% Margin", value: routeSet ? "$2,639" : "set route", sub: routeSet ? "+$792" : "" },
                { label: "40% Margin", value: routeSet ? "$3,079" : "set route", sub: routeSet ? "+$1,232" : "" },
              ].map((tier) => (
                <div key={tier.label} className="space-y-1 px-4 sm:px-6">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{tier.label}</div>
                  <div className={`text-2xl font-bold tabular-nums tracking-tight ${routeSet ? "text-slate-700" : "text-slate-300"}`}>
                    {tier.value}
                  </div>
                  {tier.sub && <div className="text-[11px] text-slate-400">{tier.sub}</div>}
                </div>
              ))}
            </div>

            {/* Row 3: Quote bar */}
            <div className="flex items-center gap-2 pt-1.5 border-t border-slate-100">
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium whitespace-nowrap">Your Quote</span>
                <div className="flex items-center border border-slate-200 rounded-md overflow-hidden h-9">
                  <span className="text-sm text-slate-400 pl-2 pr-0.5">$</span>
                  <Input className="h-9 text-sm w-[90px] border-0 shadow-none focus-visible:ring-0 px-1" defaultValue={routeSet ? "2400" : "0"} readOnly />
                </div>
              </div>
              <div className="relative flex-1">
                <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <Input className="h-9 text-sm pl-8 border-slate-200" placeholder={"Note \u2014 RFQ#, customer, lane memo..."} readOnly />
              </div>
              <Button className="h-9 w-[160px] bg-orange-400 hover:bg-orange-500 text-white gap-1.5 shrink-0 justify-center">
                <Save className="w-3.5 h-3.5" />
                Save Quote
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fuel section (highlighted in step 3) */}
      {routeSet && (
        <div data-onboarding="fuel-section" className="mt-3">
          <Card className="border-orange-200 bg-orange-50/50 shadow-sm">
            <CardContent className="p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{"\u26fd"}</span>
                  <span className="text-xs font-semibold text-orange-800 uppercase tracking-wider">Live Fuel Price {"\u2014"} Ontario</span>
                </div>
                <span className="text-[11px] text-slate-500">Updated daily</span>
              </div>
              <div className="text-2xl font-bold text-orange-600 tabular-nums">$2.50 / L</div>
              <div className="text-xs text-slate-500">Diesel avg. for Ontario region {"\u2022"} Applied to route distance automatically</div>
              <div className="flex gap-4 text-xs">
                <span className="text-slate-500">Fuel cost this trip: <strong className="text-orange-600">$412.50</strong></span>
                <span className="text-slate-500">Distance: <strong className="text-slate-700">541 km</strong></span>
                <span className="text-slate-500">Consumption: <strong className="text-slate-700">35 L/100km</strong></span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Advanced cost breakdown */}
      {routeSet && (
        <div className="mt-3">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="pt-3 pb-3 space-y-2.5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Cost Breakdown {"\u2014"} Advanced</h4>
                  <div className="flex-1 border-t border-slate-100" />
                  {advOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
                {advOpen && (
                  <div className="space-y-0">
                    {[
                      ["Fixed cost / hour", "$18.20/hr"],
                      ["Trip hours (est.)", "5.4 hrs"],
                      ["Fixed portion", "$983.32"],
                      ["Fuel portion", "$412.50"],
                      ["Driver pay", "$324.00"],
                      ["Deadhead (return)", "$127.50"],
                    ].map(([label, val]) => (
                      <div key={label} className="flex justify-between items-center py-2 border-b border-slate-50 text-sm">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-semibold text-slate-700">{val}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2.5 border-t-2 border-slate-100 mt-1 text-sm">
                      <span className="font-semibold text-slate-700">Total Carrier Cost</span>
                      <span className="font-bold text-orange-600 text-[15px]">$1,847.32</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chat + Map grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        {/* Chat panel */}
        <Card className="border-slate-200 flex flex-col" data-onboarding="chat-panel">
          <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2 shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Route Chat</h3>
          </div>
          <CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 flex flex-col flex-1 min-h-0 space-y-3">
            <div className="space-y-2 flex-1 min-h-[180px] overflow-y-auto">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-xl px-3.5 py-2.5 max-w-[85%] leading-relaxed ${
                    msg.from === "bot"
                      ? "bg-slate-100 text-slate-700"
                      : "bg-orange-400 text-white ml-auto"
                  }`}
                >
                  {msg.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {!routeSet && (
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {ROUTE_CHIPS.map((route) => (
                  <Button key={route} variant="outline" size="sm" className="text-xs h-7 px-2.5" onClick={() => onRouteClick(route)}>
                    {route}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex gap-2 shrink-0">
              <Input
                placeholder={"e.g. \u201cToronto to Hamilton, London, Windsor\u201d"}
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                    onChatSubmit((e.target as HTMLInputElement).value.trim());
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
              />
              <Button className="shrink-0 bg-orange-400 hover:bg-orange-500 text-white px-5">Send</Button>
            </div>
          </CardContent>
        </Card>

        {/* Map + Build Route */}
        <div className="space-y-3 flex flex-col">
          <Card className="border-slate-200 overflow-hidden flex-1">
            <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                Route Map
                <span className="text-[10px] font-normal text-slate-400">via Google Maps</span>
              </h3>
            </div>
            <CardContent className="p-1.5">
              <div className="bg-slate-100 h-[220px] rounded-md relative flex items-center justify-center">
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: "linear-gradient(rgba(148,163,184,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.12) 1px, transparent 1px)",
                    backgroundSize: "30px 30px",
                  }}
                />
                {routeSet ? (
                  <>
                    <div className="absolute" style={{ top: "30%", left: "20%", width: "60%", height: 2, background: "#3b82f6", transform: "rotate(-8deg)" }}>
                      <div className="absolute w-2.5 h-2.5 rounded-full bg-green-500" style={{ top: -4, left: -5 }} />
                      <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500" style={{ top: -4, right: -5 }} />
                    </div>
                    <span className="absolute bg-white text-[11px] font-semibold text-slate-600 px-2 py-0.5 rounded shadow-sm" style={{ top: "20%", left: "12%" }}>Toronto</span>
                    <span className="absolute bg-white text-[11px] font-semibold text-slate-600 px-2 py-0.5 rounded shadow-sm" style={{ top: "38%", right: "12%" }}>Montreal</span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400 z-10">Enter a route to see the map</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shrink-0">
            <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                Build Route
                <span className="text-[10px] font-normal text-slate-400">{"\u2014"} or use chat</span>
              </h3>
            </div>
            <CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 space-y-3.5">
              <div className="space-y-1 rounded-md">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Origin</Label>
                <Input placeholder="e.g. Mississauga" className="text-sm h-9" defaultValue={routeSet ? "Toronto, ON" : ""} />
              </div>
              <div className="space-y-1 rounded-md">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Destination</Label>
                <Input placeholder="e.g. Scarborough" className="text-sm h-9" defaultValue={routeSet ? "Montreal, QC" : ""} />
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs">
                + Add Stop
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DONE SCREEN
   ═══════════════════════════════════════════════════════════ */
function DoneScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center">
      <div className="text-6xl mb-4">{"\ud83c\udf89"}</div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">You{"\u2019"}re all set!</h1>
      <p className="text-[15px] text-slate-500 leading-relaxed mb-8">
        You just set up your cost profile and built your first route quote. Bungee calculates your real carrier cost so
        you never underquote again.
      </p>
      <Button className="bg-orange-400 hover:bg-orange-500 text-white text-[15px] px-9 py-3 h-auto" onClick={onFinish}>
        Start Using Bungee Connect {"\u2192"}
      </Button>
      <div className="mt-6 flex justify-center gap-6">
        {[
          { val: "1,000", sub: "Free quotes/month" },
          { val: "$0", sub: "To get started" },
          { val: "\u221e", sub: "Routes & stops" },
        ].map((s) => (
          <div key={s.sub} className="text-center">
            <div className="text-2xl font-bold text-orange-500">{s.val}</div>
            <div className="text-xs text-slate-400">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Spotlight ring helper ─── */
function SpotlightRing({ selector }: { selector: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [selector]);

  if (!rect) return null;
  const pad = 8;
  return (
    <>
      <div
        className="absolute rounded-xl pointer-events-none z-[1001]"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 4000px rgba(0,0,0,.4)",
        }}
      />
      <div
        className="absolute rounded-[14px] border-2 border-orange-500/50 pointer-events-none z-[1001] animate-pulse"
        style={{
          top: rect.top - pad - 2,
          left: rect.left - pad - 2,
          width: rect.width + pad * 2 + 4,
          height: rect.height + pad * 2 + 4,
        }}
      />
    </>
  );
}

/* ─── Confetti component ─── */
function Confetti() {
  const colors = ["#f97316", "#3b82f6", "#22c55e", "#eab308", "#ec4899", "#8b5cf6"];
  return (
    <div className="fixed inset-0 pointer-events-none z-[10000]">
      {Array.from({ length: 60 }).map((_, i) => {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = 5 + Math.random() * 8;
        const left = Math.random() * 100;
        const dur = 2 + Math.random() * 2;
        const delay = Math.random() * 1.5;
        return (
          <div
            key={i}
            className="absolute rounded-sm"
            style={{
              width: size,
              height: size,
              background: color,
              left: `${left}%`,
              top: -10,
              animation: `mock-confetti ${dur}s ease-in ${delay}s forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ─── Keyframe injection (once) ─── */
if (typeof document !== "undefined" && !document.getElementById("mock-onboarding-keyframes")) {
  const style = document.createElement("style");
  style.id = "mock-onboarding-keyframes";
  style.textContent = `
    @keyframes mock-confetti {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
