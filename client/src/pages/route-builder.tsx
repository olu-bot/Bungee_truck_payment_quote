import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { geocodeLocation, getOSRMRoute, getMultiWaypointDistances, getDirectionsByName } from "@/lib/geo";
import { calculateRouteCost, getPricingAdvice, type PayMode } from "@/lib/routeCalc";
import { processChatRoute, type ChatRouteResult } from "@/lib/chatRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { safeStorageGet, safeStorageRemove, safeStorageSet } from "@/lib/safeStorage";
import { useQuoteUsage } from "@/hooks/use-quote-usage";
import {
  MapPin,
  Plus,
  Trash2,
  Route,
  MessageSquare,
  DollarSign,
  Fuel,
  Send,
  Loader2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  AlertTriangle,
  Save,
  Trophy,
  XCircle,
  Clock,
  FileText,
  Star,
  FileDown,
  Info,
  Package,
  Phone,
  Mail,
  Hash,
  Ruler,
  Weight,
  X,
  Receipt,
  History,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { CostProfile, Yard, RouteStop, Quote } from "@shared/schema";
import type { LaneWithCache, LegBreakdown, RouteCalculation, PricingTier, PricingAdvice, FormStop, CachedCosts } from "./route-builder/types";
import type { RouteBuilderSnapshot } from "@/lib/routeBuilderSnapshot";
import { RouteMapGoogle } from "@/components/RouteMapGoogle";
import { LocationSuggestInput } from "@/components/LocationSuggestInput";
import { QuoteShareDialog } from "@/components/QuoteShareDialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { can } from "@/lib/permissions";
import { favLaneLimit, canExportPdf, canUseIFTA, tierLabel, canUseLaneIntelligence, canUsePricingSuggestions } from "@/lib/subscription";
import { calculateIFTA, type IFTAResult } from "@/lib/iftaCalc";
import { computeLaneStats, matchLane, type LaneStats } from "@/lib/laneIntelligence";
import { computeSuggestion } from "@/lib/pricingSuggestion";
import { PricingSuggestionCard } from "@/components/PricingSuggestionCard";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import {
  currencyPerLitreLabel,
  currencySymbol,
  formatCurrencyAmount,
  resolveWorkspaceCurrency,
  convertCurrency,
  convertCostProfileCurrency,
  type SupportedCurrency,
} from "@/lib/currency";
import {
  resolveMeasurementUnit,
  displayDistance,
  distanceLabel,
  fuelConsumptionLabel,
} from "@/lib/measurement";
import {
  getFuelPrices,
  getFuelPricesSync,
  getFuelPriceForRouteBuilder,
  type FuelPriceData,
} from "@/lib/fuelPriceService";

let stopIdCounter = 0;
function nextStopId(): string {
  return `stop-${Date.now()}-${++stopIdCounter}`;
}

function marginQualityLabel(percent: number): { label: string; color: string } {
  if (percent < 10) return { label: "Low", color: "text-red-500" };
  if (percent < 25) return { label: "Fair", color: "text-amber-600" };
  if (percent < 50) return { label: "Good", color: "text-slate-600 font-medium" };
  if (percent < 75) return { label: "Great", color: "text-slate-800 font-semibold" };
  return { label: "Outstanding", color: "text-slate-900 font-bold" };
}

async function getDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  return getOSRMRoute(fromLat, fromLng, toLat, toLng);
}

/**
 * Return the API-provided driveMinutesFromPrev for the Nth non-yard stop
 * (0-indexed, matching formStops order).
 */
function getBaseStopDriveMinutes(routeStops: RouteStop[], formStopIdx: number): number {
  let count = 0;
  for (const s of routeStops) {
    if (s.type === "yard") continue;
    if (count === formStopIdx) return s.driveMinutesFromPrev ?? 0;
    count++;
  }
  return 0;
}

/**
 * Apply per-stop drive time adjustments (from formStops) to the built
 * RouteStop array.  Only the /connect segment prefix of the path changes —
 * yard stops are left untouched.
 */
function applyDriveAdjustments(routeStops: RouteStop[], fStops: FormStop[]): RouteStop[] {
  let fIdx = 0;
  return routeStops.map((stop) => {
    if (stop.type === "yard") return stop;
    const driveAdj = fStops[fIdx]?.driveMinutesAdjustment ?? 0;
    const dockOverride = fStops[fIdx]?.dockMinutes;
    fIdx++;
    return {
      ...stop,
      ...(driveAdj !== 0 ? { driveMinutesFromPrev: Math.max(0, (stop.driveMinutesFromPrev ?? 0) + driveAdj) } : {}),
      ...(dockOverride !== undefined ? { dockTimeMinutes: dockOverride } : {}),
    };
  });
}

/**
 * Extract a city/region from a detailed address string.
 * Given "123 Industrial Rd, Suite 5, Toronto, ON M5V 2T6"
 * → tries "Toronto, ON M5V 2T6" then "Toronto, ON" etc.
 * Falls back to the last comma-separated segment.
 */
function extractCityFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  // Try progressively shorter suffixes (skipping street-level detail)
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(", ");
    if (candidate.length >= 3) return candidate;
  }
  return null;
}

// Types imported from ./route-builder/types

async function persistRouteBuilderQuote(
  scopeId: string,
  profile: CostProfile,
  stops: RouteStop[],
  meta: {
    includeReturn: boolean;
    fuelPricePerLitre: number;
    yardLabel?: string;
    calc: RouteCalculation;
    pricing: PricingAdvice;
    customQuoteInput: string;
    customerNote?: string;
    chatUserMessage?: string;
    accessorialTotal?: number;
    surchargePercent?: number;
    surchargeAmount?: number;
    accessorialItems?: { label: string; amount: number }[];
    payMode?: string;
    dockTimeHrs?: number;
    quoteMode?: string;
    status?: "pending" | "won" | "lost";
    wonRate?: number | null;
    lostTargetPrice?: number | null;
  },
): Promise<Quote> {
  const nonYard = stops.filter((s) => s.type !== "yard");
  const origin = nonYard[0]?.location ?? stops[0]?.location ?? "";
  const destination =
    nonYard[nonYard.length - 1]?.location ?? stops[stops.length - 1]?.location ?? "";
  const laborSum = meta.calc.legs.reduce((s, l) => s + (l.fixedCost + l.driverCost), 0);
  const fuelSum = meta.calc.legs.reduce((s, l) => s + l.fuelCost, 0);
  const distMi = meta.calc.totalDistanceKm * 0.621371;
  const tier20 = meta.pricing.tiers[0];

  // Accessorials are pass-throughs added to the final quote, not the cost base
  const accTotal = meta.accessorialTotal ?? 0;
  // carrierCost = base trip cost (inflation already included in accTotal by caller if applicable)
  const carrierCostPersist = meta.calc.fullTripCost;

  // If user entered a custom quote, use that as the customer price
  // Otherwise: tier price + accessorial pass-through
  const customAmt = parseFloat(meta.customQuoteInput);
  const hasCustomQuote = !isNaN(customAmt) && customAmt > 0;
  const customerPrice = hasCustomQuote ? customAmt : ((tier20?.price ?? carrierCostPersist) + accTotal);
  const grossProfit = customerPrice - accTotal - carrierCostPersist;
  const profitMarginPercent = carrierCostPersist > 0 ? (grossProfit / carrierCostPersist) * 100 : 0;

  // Exclude yard from summary when deadhead is off
  const summaryStops = meta.includeReturn
    ? stops
    : stops.filter((s) => s.type !== "yard");
  const snapshot: RouteBuilderSnapshot = {
    routeSummary: summaryStops.map((s) => shortLocation(s.location)).filter(Boolean).join(" \u2192 "),
    totalKm: meta.calc.totalDistanceKm,
    totalMin: meta.calc.totalDriveMinutes,
    returnKm: meta.calc.legs
      .filter((l) => l.isDeadhead ?? l.type === "deadhead")
      .reduce((s, l) => s + l.distanceKm, 0),
    includeReturn: meta.includeReturn,
    fuelPricePerLitre: meta.fuelPricePerLitre,
    yardLabel: meta.yardLabel,
    deliveryCost: meta.calc.tripCost,
    deadheadCost: meta.calc.deadheadCost,
    fullTripCost: meta.calc.fullTripCost,
    surchargePercent: meta.surchargePercent || undefined,
    surchargeAmount: meta.surchargeAmount || undefined,
    carrierCost: (meta.surchargeAmount ?? 0) > 0 ? carrierCostPersist + (meta.surchargeAmount ?? 0) : undefined,
    accessorialTotal: accTotal > 0 ? accTotal : undefined,
    accessorialItems: meta.accessorialItems?.length ? meta.accessorialItems : undefined,
    allInCost: accTotal > 0 ? (carrierCostPersist + (meta.surchargeAmount ?? 0) + accTotal) : undefined,
    allInHourlyRate: meta.calc.allInHourlyRate,
    fuelPerKm: meta.calc.fuelPerKm,
    tiers: meta.pricing.tiers.map((t) => ({
      label: t.label,
      percent: t.percent,
      price: t.price,
      marginAmount: t.marginAmount,
    })),
    customQuoteInput: meta.customQuoteInput || undefined,
    customQuote: meta.pricing.customQuote ?? undefined,
    legs: meta.calc.legs,
    payMode: meta.payMode,
    dockTimeHrs: meta.dockTimeHrs,
    quoteMode: meta.quoteMode,
    chatUserMessage: meta.chatUserMessage,
    customerNote: meta.customerNote?.trim() || "",
  };

  return firebaseDb.createQuote(scopeId, {
    profileId: profile.id,
    routeId: null,
    origin,
    destination,
    truckType: profile.truckType,
    distance: distMi,
    pricingMode: "route_builder",
    carrierCost: laborSum,
    fuelSurcharge: fuelSum,
    totalCarrierCost: carrierCostPersist,
    accessorialTotal: accTotal > 0 ? accTotal : null,
    marginType: "percentage",
    marginValue: profitMarginPercent,
    marginAmount: grossProfit,
    customerPrice,
    grossProfit,
    profitMarginPercent,
    quoteSource: "route_builder",
    routeSnapshotJson: JSON.stringify(snapshot),
    customerNote: meta.customerNote?.trim() ?? "",
    status: meta.status ?? "pending",
    wonRate: meta.wonRate ?? null,
    lostTargetPrice: meta.lostTargetPrice ?? null,
  });
}

// ── Module-level constants ──────────────────────────────────────────
const FUEL_STORAGE_KEY = "bungee_custom_fuel_price";

// ── Portal component for header controls ────────────────────────────
// Uses useEffect + useState to wait for the portal target to appear in the DOM,
// which avoids the stale-null problem with the IIFE approach.
function RouteControlsPortal({
  selectedProfileId,
  setSelectedProfileId,
  profiles,
  fuelPrice,
  setFuelPrice,
  fuelPriceManual,
  setFuelPriceManual,
  fuelPriceRegion,
  fuelPriceDate,
  fuelPriceData,
  measureUnit,
  currency,
  quoteMode,
  setQuoteMode,
}: {
  selectedProfileId: string;
  setSelectedProfileId: (id: string) => void;
  profiles: CostProfile[];
  fuelPrice: string;
  setFuelPrice: (v: string) => void;
  fuelPriceManual: boolean;
  setFuelPriceManual: (v: boolean) => void;
  fuelPriceRegion: string;
  fuelPriceDate: string;
  fuelPriceData: FuelPriceData | null;
  measureUnit: string;
  currency: SupportedCurrency;
  quoteMode: "quick" | "advanced";
  setQuoteMode: (mode: "quick" | "advanced") => void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Continuously track the portal target element.
    // The target is conditionally rendered in App.tsx (`{isHome && <div id="...">}`)
    // and gets unmounted/remounted when the user navigates away from Home and back.
    // Because RouteBuilder itself stays mounted (never unmounts), a one-shot effect
    // would hold a stale reference to the old detached DOM node. Instead, we keep
    // the MutationObserver running so it always picks up the latest element.
    const sync = () => {
      const el = document.getElementById("route-controls-portal");
      setPortalTarget((prev) => {
        // Only update state if the element actually changed (avoids unnecessary re-renders)
        if (prev === el) return prev;
        return el ?? null;
      });
    };

    // Check immediately
    sync();

    // Keep watching for the element to appear/disappear (navigation)
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!portalTarget) return null;

  const LITRES_PER_GAL = 3.78541;
  const isImp = measureUnit === "imperial";
  const internalVal = parseFloat(fuelPrice) || 0;
  const displayVal = isImp
    ? (Math.round(internalVal * LITRES_PER_GAL * 100) / 100).toString()
    : fuelPrice;

  return createPortal(
    <>
      <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
        <SelectTrigger data-testid="select-profile" className="h-8 py-0 text-xs w-[110px] sm:w-[150px]">
          <SelectValue placeholder="Profile" />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1 h-8">
        <Fuel className="w-3 h-3 text-muted-foreground shrink-0" />
        <Input
          data-testid="input-fuel-price"
          type="number"
          step="0.05"
          min="0"
          className="h-8 text-xs w-[60px] sm:w-[76px] shrink-0"
          value={displayVal}
          onChange={(e) => {
            const raw = e.target.value;
            if (isImp) {
              const galVal = parseFloat(raw);
              if (!isNaN(galVal)) {
                setFuelPrice(String(Math.round((galVal / LITRES_PER_GAL) * 1000) / 1000));
              } else {
                setFuelPrice(raw);
              }
            } else {
              setFuelPrice(raw);
            }
            setFuelPriceManual(true);
            try {
              const valToStore = isImp
                ? String(Math.round((parseFloat(raw) / LITRES_PER_GAL) * 1000) / 1000)
                : raw;
              safeStorageSet(
                FUEL_STORAGE_KEY,
                JSON.stringify({ price: valToStore, savedAt: Date.now() }),
                "local",
              );
            } catch { /* ignore */ }
          }}
        />
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {currencySymbol(currency)}/{isImp ? "gal" : "L"}
        </span>
        {fuelPriceRegion && !fuelPriceManual && (
          <span
            className="text-xs text-slate-500 whitespace-nowrap hidden md:inline cursor-help"
            title={`${fuelPriceRegion} diesel price from U.S. Energy Information Administration (EIA) weekly report, updated ${fuelPriceDate}. Canadian prices estimated from US data + exchange rate. Refreshed daily.`}
          >
            {fuelPriceRegion} · EIA
          </span>
        )}
        {fuelPriceManual && fuelPriceData && (
          <button
            type="button"
            className="text-xs text-orange-500 hover:text-orange-600 whitespace-nowrap hidden md:inline"
            title="Reset to the latest regional fuel price from EIA weekly data"
            onClick={() => {
              setFuelPriceManual(false);
              safeStorageRemove(FUEL_STORAGE_KEY, "local");
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Quick Quote / Advanced toggle */}
      <div className="inline-flex rounded-md border border-orange-300 overflow-hidden h-8 text-xs font-medium select-none">
        <button
          type="button"
          onClick={() => setQuoteMode("quick")}
          className={`px-3 flex items-center justify-center h-8 transition-colors ${
            quoteMode === "quick"
              ? "bg-orange-400 text-white"
              : "bg-white text-slate-500 hover:bg-orange-50"
          }`}
        >
          <span className="sm:hidden">Quick</span>
          <span className="hidden sm:inline">Quick Quote</span>
        </button>
        <button
          type="button"
          data-testid="button-advanced"
          onClick={() => setQuoteMode("advanced")}
          className={`px-3 flex items-center justify-center h-8 transition-colors border-l border-orange-200 ${
            quoteMode === "advanced"
              ? "bg-orange-400 text-white"
              : "bg-white text-slate-500 hover:bg-orange-50"
          }`}
        >
          <span className="sm:hidden">Adv</span>
          <span className="hidden sm:inline">Advanced</span>
        </button>
      </div>
    </>,
    portalTarget
  );
}

// ── Location formatting ────────────────────────────────────────────

const PROVINCE_ABBR: Record<string, string> = {
  "ontario": "ON", "quebec": "QC", "british columbia": "BC",
  "alberta": "AB", "manitoba": "MB", "saskatchewan": "SK",
  "nova scotia": "NS", "new brunswick": "NB",
  "prince edward island": "PE", "newfoundland and labrador": "NL",
  "newfoundland": "NL", "northwest territories": "NT",
  "nunavut": "NU", "yukon": "YT",
  "california": "CA", "texas": "TX", "florida": "FL",
  "new york": "NY", "illinois": "IL", "pennsylvania": "PA",
  "ohio": "OH", "georgia": "GA", "michigan": "MI",
  "north carolina": "NC", "new jersey": "NJ", "virginia": "VA",
  "washington": "WA", "arizona": "AZ", "massachusetts": "MA",
  "tennessee": "TN", "indiana": "IN", "missouri": "MO",
  "maryland": "MD", "wisconsin": "WI", "colorado": "CO",
  "minnesota": "MN", "oregon": "OR", "connecticut": "CT",
};

/** Normalize "Mississauga, Ontario, Canada" → "Mississauga, ON" */
export function shortLocation(raw: string): string {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return raw;
  const country = parts[parts.length - 1]!.toLowerCase();
  if (["canada", "usa", "united states", "us"].includes(country)) parts.pop();
  if (parts.length <= 1) return parts.join(", ");
  const first = parts[0] ?? "";
  const isStreet = /\d/.test(first) || /\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|hwy|highway)\b/i.test(first);
  const cityIdx = isStreet ? 1 : 0;
  const city = parts[cityIdx] ?? first;
  const rest = parts.slice(cityIdx + 1);
  for (const r of rest) {
    const abbr = PROVINCE_ABBR[r.toLowerCase()];
    if (abbr) return `${city}, ${abbr}`;
    if (/^[A-Za-z]{2,3}$/.test(r)) return `${city}, ${r.toUpperCase()}`;
  }
  return `${city}${rest.length > 0 ? ", " + rest[0] : ""}`;
}

// ── Main Component ─────────────────────────────────────────────────

export default function RouteBuilder() {
  const { toast } = useToast();

  // ── Controls ──────────────────────────────────────────────────

  const [selectedProfileId, setSelectedProfileId] = useState(
    () => safeStorageGet("bungee_selected_profile", "local") || "",
  );
  const [selectedYardId, setSelectedYardId] = useState("none");
  const [includeReturn, setIncludeReturn] = useState(false);
  // ── Persisted custom fuel price (kept for 1 week) ──────────
  const FUEL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

  function loadSavedFuel(): { price: string; manual: boolean } {
    try {
      const raw = safeStorageGet(FUEL_STORAGE_KEY, "local");
      if (raw) {
        const { price, savedAt } = JSON.parse(raw);
        if (Date.now() - savedAt < FUEL_TTL_MS) {
          return { price, manual: true };
        }
        safeStorageRemove(FUEL_STORAGE_KEY, "local");
      }
    } catch { /* ignore */ }
    // Use best available EIA price from cache/defaults instead of a stale hardcoded value
    try {
      const sync = getFuelPricesSync();
      const usAvg = sync.regions.find((r) => r.id === "us_average");
      if (usAvg?.pricePerLitre) {
        return { price: String(Math.round(usAvg.pricePerLitre * 100) / 100), manual: false };
      }
    } catch { /* ignore */ }
    return { price: "1.65", manual: false };
  }
  const savedFuel = loadSavedFuel();

  const [fuelPrice, setFuelPrice] = useState(savedFuel.price);
  const [defaultDockMinutes, setDefaultDockMinutes] = useState(90);
  const [payMode, setPayMode] = useState<PayMode>("perHour");
  const [payModeManualOverride, setPayModeManualOverride] = useState(false);
  const [showLocalAlert, setShowLocalAlert] = useState(false);
  const [fuelPriceData, setFuelPriceData] = useState<FuelPriceData | null>(null);
  const [fuelPriceRegion, setFuelPriceRegion] = useState("");
  const [fuelPriceDate, setFuelPriceDate] = useState("");
  const [fuelPriceManual, setFuelPriceManual] = useState(savedFuel.manual);

  // ── Build Route form ──────────────────────────────────────────

  const [formStops, setFormStops] = useState<FormStop[]>([
    { id: nextStopId(), location: "", dockMinutes: defaultDockMinutes },
    { id: nextStopId(), location: "", dockMinutes: defaultDockMinutes },
  ]);
  const formStopsRef = useRef<FormStop[]>(formStops);
  formStopsRef.current = formStops;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Convenience getters for origin/destination
  const origin = formStops[0]?.location ?? "";
  const destination = formStops[formStops.length - 1]?.location ?? "";

  // ── Stops (computed from form) ────────────────────────────────

  const [stops, setStops] = useState<RouteStop[]>([]);
  const stopsRef = useRef<RouteStop[]>([]);
  // Keep ref in sync so debounced callbacks always see latest stops
  stopsRef.current = stops;

  // ── Cross-border route detection ──────────────────────────────
  const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"]);
  const isCrossBorder = useMemo(() => {
    if (stops.length < 2) return false;
    const locations = stops.map((s) => s.location.toUpperCase());
    let hasCA = false;
    let hasUS = false;
    for (const loc of locations) {
      for (const prov of CA_PROVINCES) {
        if (loc.includes(`, ${prov}`) || loc.endsWith(` ${prov}`)) { hasCA = true; break; }
      }
      if (!hasCA || hasUS) {
        const parts = loc.split(",").map((p) => p.trim());
        const last = parts[parts.length - 1];
        if (last && last.length === 2 && !CA_PROVINCES.has(last)) hasUS = true;
        if (loc.includes("USA") || loc.includes("UNITED STATES")) hasUS = true;
      }
      if (loc.includes("CANADA") || loc.includes("ONTARIO") || loc.includes("QUEBEC") || loc.includes("ALBERTA")) hasCA = true;
    }
    return hasCA && hasUS;
  }, [stops]);

  // ── Chat ──────────────────────────────────────────────────────

  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { role: "bot" | "user"; text: string }[]
  >([
    {
      role: "bot",
      text: 'Hi! Type a route \u2014 e.g. "Toronto to Montreal"',
    },
  ]);
  const [activeShipment, setActiveShipment] = useState<import("@/lib/chatRoute").ShipmentInfo | null>(null);
  const [activeFreightMeta, setActiveFreightMeta] = useState<import("@/lib/chatRoute").FreightMeta | null>(null);



  // ── Calculation results ───────────────────────────────────────

  const [routeCalc, setRouteCalc] = useState<RouteCalculation | null>(null);
  const [pricingAdvice, setPricingAdvice] = useState<PricingAdvice | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showIFTA, setShowIFTA] = useState(false);
  const [showMobileCharges, setShowMobileCharges] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [customQuoteAmount, setCustomQuoteAmount] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [isSavingQuote, setIsSavingQuote] = useState(false);
  const [lastSavedQuote, setLastSavedQuote] = useState<Quote | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeocodingRoute, setIsGeocodingRoute] = useState(false);
  const [isSavingFav, setIsSavingFav] = useState(false);
  const [favLaneIds, setFavLaneIds] = useState<Set<string>>(new Set());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState({ title: "", description: "" });
  const quoteUsage = useQuoteUsage();

  // ── Quote Mode (Quick / Advanced) — persisted to localStorage ──
  const QUOTE_MODE_KEY = "bungee_quote_mode";
  const [quoteMode, setQuoteModeRaw] = useState<"quick" | "advanced">(() => {
    const v = safeStorageGet(QUOTE_MODE_KEY, "local");
    if (v === "advanced") return "advanced";
    return "quick";
  });
  const setQuoteMode = useCallback((mode: "quick" | "advanced") => {
    setQuoteModeRaw(mode);
    safeStorageSet(QUOTE_MODE_KEY, mode, "local");
  }, []);

  // ── Accessorial Charges (one-time per-load, Advanced mode) ────
  const [accessorials, setAccessorials] = useState({
    detentionHours: 0,
    detentionRate: 75,       // $/hr — default industry standard
    lumperFee: 0,
    stopOffCount: 0,
    stopOffRate: 75,         // $ per extra stop
    borderCrossing: 0,
    tonu: 0,                 // Truck Ordered Not Used
    tailgateFee: 0,          // Tailgate / liftgate delivery fee
    customAccessorialLabel: "",
    customAccessorialAmount: 0,
    costInflationPct: 0,         // Hazmat, regulatory overhead, etc. — applied to base trip cost
    tollRatePerKm: 0,            // Toll estimation — $/km or $/mi applied to trip distance
  });

  const accessorialTotal = useMemo(() => {
    if (quoteMode !== "advanced") return 0;
    const flatCharges =
      accessorials.detentionHours * accessorials.detentionRate +
      accessorials.lumperFee +
      accessorials.stopOffCount * accessorials.stopOffRate +
      accessorials.borderCrossing +
      accessorials.tonu +
      accessorials.tailgateFee +
      accessorials.customAccessorialAmount;
    return flatCharges;
  }, [quoteMode, accessorials]);

  /** Inflation surcharge applied to base trip cost (hazmat, regulatory, etc.) */
  const costInflationAmount = useMemo(() => {
    if (!accessorials.costInflationPct) return 0;
    const base = routeCalc?.fullTripCost ?? 0;
    return Math.round(base * (accessorials.costInflationPct / 100) * 100) / 100;
  }, [accessorials.costInflationPct, routeCalc?.fullTripCost]);

  // ── Queries ───────────────────────────────────────────────────

  const { user } = useFirebaseAuth();
  const isAdmin = user?.role === "admin";
  const scopeId = workspaceFirestoreId(user);
  const queryClient = useQueryClient();

  // Update initial bot message example to match user's country once loaded
  const chatExampleSetRef = useRef(false);
  useEffect(() => {
    if (chatExampleSetRef.current || !user?.operatingCountryCode) return;
    const cc = user.operatingCountryCode.toUpperCase();
    const isUS = cc === "US" || cc === "USA";
    if (isUS) {
      chatExampleSetRef.current = true;
      setChatHistory((prev) => {
        if (prev.length === 1 && prev[0].role === "bot") {
          return [{ role: "bot", text: 'Hi! Type a route \u2014 e.g. "Dallas to Atlanta"' }];
        }
        return prev;
      });
    } else {
      chatExampleSetRef.current = true;
    }
  }, [user?.operatingCountryCode]);

  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);
  const dLabel = distanceLabel(measureUnit);

  /** Toll estimate — $/km (or $/mi converted to $/km) × trip distance */
  const tollAmount = useMemo(() => {
    if (!accessorials.tollRatePerKm) return 0;
    const distKm = routeCalc?.totalDistanceKm ?? 0;
    const ratePerKm = measureUnit === "imperial"
      ? accessorials.tollRatePerKm / 1.609344
      : accessorials.tollRatePerKm;
    return Math.round(ratePerKm * distKm * 100) / 100;
  }, [accessorials.tollRatePerKm, routeCalc?.totalDistanceKm, measureUnit]);

  const { data: profiles = [] } = useQuery<CostProfile[]>({
    queryKey: ["firebase", "profiles", scopeId ?? ""],
    queryFn: () => firebaseDb.getProfiles(scopeId),
    enabled: !!scopeId,
  });

  const { data: yards = [] } = useQuery<Yard[]>({
    queryKey: ["firebase", "yards", scopeId ?? ""],
    queryFn: () => firebaseDb.getYards(scopeId),
    enabled: !!scopeId,
  });

  // ── Company accessorial policy (company-wide defaults) ──────
  const { data: companyAccessorialPolicy } = useQuery({
    queryKey: ["firebase", "accessorial-policy", scopeId ?? ""],
    queryFn: () => firebaseDb.getAccessorialPolicy(scopeId),
    enabled: !!scopeId,
  });

  // Seed accessorial defaults from company policy when it loads
  const policyApplied = useRef(false);
  useEffect(() => {
    if (!companyAccessorialPolicy || policyApplied.current) return;
    policyApplied.current = true;
    setAccessorials((prev) => ({
      ...prev,
      detentionRate: companyAccessorialPolicy.detentionRate,
      stopOffRate: companyAccessorialPolicy.stopOffRate,
      costInflationPct: companyAccessorialPolicy.costInflationPct,
    }));
  }, [companyAccessorialPolicy]);

  // ── Favorite lanes (for star button) ──────────────────────────
  const { data: savedLanes = [] } = useQuery({
    queryKey: ["firebase", "lanes", scopeId ?? ""],
    queryFn: () => firebaseDb.getLanes(scopeId),
    enabled: !!scopeId,
  });

  // Build a set of full route keys (all stops) so we can check if the current route is a fav
  useEffect(() => {
    const keys = new Set(savedLanes.map((l) => {
      // Use cached stops for full route key if available
      const cached = (l as LaneWithCache).cachedStops;
      if (cached && cached.length >= 2) {
        const nonYard = cached.filter((s) => s.type !== "yard");
        const fullKey = nonYard.map((s) => s.location).filter(Boolean).join("→");
        if (fullKey) return fullKey;
      }
      return `${l.origin}→${l.destination}`;
    }));
    setFavLaneIds(keys);
  }, [savedLanes]);

  // ── Lane intelligence ──────────────────────────────────────────
  const showLaneIntel = canUseLaneIntelligence(user);

  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ["firebase", "quotes", scopeId ?? ""],
    queryFn: () => firebaseDb.getQuotes(scopeId),
    enabled: !!scopeId && showLaneIntel,
  });

  const laneStatsMap = useMemo(
    () => (showLaneIntel ? computeLaneStats(allQuotes) : new Map()),
    [allQuotes, showLaneIntel],
  );

  // Match current route's origin/destination against historical lanes
  const currentLaneStats: LaneStats | null = useMemo(() => {
    if (!showLaneIntel || stops.length < 2) return null;
    const nonYard = stops.filter((s) => s.type !== "yard");
    if (nonYard.length < 2) return null;
    const originLoc = nonYard[0]?.location;
    const dest = nonYard[nonYard.length - 1]?.location;
    if (!originLoc || !dest) return null;
    return matchLane(originLoc, dest, laneStatsMap);
  }, [showLaneIntel, stops, laneStatsMap]);

  const selectedYard = useMemo(
    () => yards.find((y) => y.id === selectedYardId) ?? null,
    [yards, selectedYardId],
  );

  // If the user didn't pick a yard yet (selectedYardId === "none") AND
  // has no real yards defined, use the operating city as a lightweight fallback.
  // When real yards exist, "None" means no yard — don't use operating city.
  const cityYard = useMemo(() => {
    if (selectedYardId !== "none") return null;
    if (yards.length > 0) return null; // User has real yards; "None" means no yard
    const city = user?.operatingCity?.trim();
    if (!city) return null;
    return {
      id: "__city__",
      name: city,
      address: city,
      isDefault: true,
    } as Yard;
  }, [selectedYardId, user?.operatingCity, yards.length]);

  const effectiveYard = selectedYard ?? cityYard;

  // Persist selected profile to localStorage
  useEffect(() => {
    if (selectedProfileId) {
      safeStorageSet("bungee_selected_profile", selectedProfileId, "local");
    }
  }, [selectedProfileId]);

  // Auto-select first profile when none selected or selection no longer valid
  useEffect(() => {
    if (profiles.length === 0) return;
    const isValid = profiles.some((p) => p.id === selectedProfileId);
    if (!isValid) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  /** After onboarding, yards load once — pre-select default without overriding explicit "none". */
  const prevYardsLenRef = useRef(0);
  useEffect(() => {
    if (yards.length === 0) {
      prevYardsLenRef.current = 0;
      return;
    }
    if (selectedYardId !== "none") {
      prevYardsLenRef.current = yards.length;
      return;
    }
    if (prevYardsLenRef.current === 0) {
      const def = yards.find((y) => y.isDefault) ?? yards[0];
      if (def) setSelectedYardId(def.id);
    }
    prevYardsLenRef.current = yards.length;
  }, [yards, selectedYardId]);

  // ── Auto-fetch fuel prices and set regional price ────────────
  useEffect(() => {
    getFuelPrices().then((data) => setFuelPriceData(data)).catch(() => {});
  }, []);

  // Extract state/province from yard address (format: "City, State, Country")
  const yardStateCode = useMemo(() => {
    const addr = effectiveYard?.address || user?.operatingCity || "";
    // Try to extract a 2-letter state/province code from the address
    const parts = addr.split(",").map((p: string) => p.trim());
    for (const part of parts) {
      // Check for 2-letter code (e.g., "ON", "TX", "CA")
      const upper = part.toUpperCase();
      if (/^[A-Z]{2}$/.test(upper)) return upper;
      // Check for "State ZIP" pattern (e.g., "Ontario" → need to match)
      // Check if it matches a known state/province name
    }
    return "";
  }, [effectiveYard?.address, user?.operatingCity]);

  // Auto-set fuel price when data loads or yard changes (only if user hasn't manually edited)
  useEffect(() => {
    if (!fuelPriceData || fuelPriceManual) return;
    const result = getFuelPriceForRouteBuilder(yardStateCode, measureUnit, fuelPriceData);
    // Convert from source currency to the user's display currency
    const converted = convertCurrency(
      result.pricePerLitre,
      result.sourceCurrency as SupportedCurrency,
      currency,
    );
    const rounded = Math.round(converted * 100) / 100;
    setFuelPrice(String(rounded));
    setFuelPriceRegion(result.regionName);
    setFuelPriceDate(result.updatedAt);
  }, [fuelPriceData, yardStateCode, measureUnit, fuelPriceManual, currency]);

  // ── Build stops from form values ──────────────────────────────

  const buildStopsFromForm = useCallback(
    async (
      fStops: FormStop[],
      yard: Yard | null,
      _doReturn: boolean, // ignored — return yard is always included; calc toggle controls cost
    ): Promise<RouteStop[]> => {
      const locations: { name: string; type: RouteStop["type"]; dockMinutes: number; knownLat?: number; knownLng?: number }[] = [];

      // Use pre-stored yard lat/lng when available to avoid re-geocoding
      const yardLat = yard?.lat ?? undefined;
      const yardLng = yard?.lng ?? undefined;

      // Routes start at the PICKUP, not the yard.
      // Yard is only used for the return deadhead leg at the end.
      for (let i = 0; i < fStops.length; i++) {
        const s = fStops[i];
        if (!s.location.trim()) continue;
        const type: RouteStop["type"] = i === 0 ? "pickup" : i === fStops.length - 1 ? "delivery" : "stop";
        locations.push({ name: s.location.trim(), type, dockMinutes: s.dockMinutes });
      }

      // Append return yard for deadhead calculation.
      // The "Include deadhead" toggle controls whether this leg enters the cost.
      if (yard) {
        locations.push({ name: yard.address || yard.name, type: "yard", dockMinutes: 0, knownLat: yardLat, knownLng: yardLng });
      }

      if (locations.length < 2) return [];

      // ── PRIMARY: Name-based Google Directions (matches embed) ──
      // Pass location names directly to Google Directions API so the
      // resolved distance/duration matches the Google Maps Embed exactly.
      const locationNames = locations.map((l) => l.name);
      const dirResult = await getDirectionsByName(locationNames);

      if (dirResult && dirResult.legs.length === locations.length - 1) {
        console.log("[buildStops] Using name-based directions (matches Google Maps embed):", dirResult.source);
        const result: RouteStop[] = [];
        for (let i = 0; i < locations.length; i++) {
          const loc = locations[i];
          const coord = dirResult.resolvedCoords[i];
          result.push({
            id: nextStopId(),
            type: loc.type,
            location: loc.name,
            lat: coord?.lat ?? loc.knownLat,
            lng: coord?.lng ?? loc.knownLng,
            dockTimeMinutes: loc.dockMinutes,
            distanceFromPrevKm: i > 0 ? dirResult.legs[i - 1].distanceKm : 0,
            driveMinutesFromPrev: i > 0 ? dirResult.legs[i - 1].durationMinutes : 0,
          });
        }
        return result;
      }

      // ── FALLBACK: Geocode each name → coordinates, then route ──
      console.log("[buildStops] Name-based directions unavailable, falling back to geocode+route");

      // Geocode all — use pre-stored coords when available, with city extraction fallback
      const geocoded = await Promise.all(
        locations.map(async (loc) => {
          // If we already have valid coordinates, skip geocoding
          if (loc.knownLat != null && loc.knownLng != null && Number.isFinite(loc.knownLat) && Number.isFinite(loc.knownLng)) {
            return { ...loc, lat: loc.knownLat, lng: loc.knownLng };
          }
          // Try geocoding the full address first
          let coords = await geocodeLocation(loc.name);
          // If full address fails, try extracting a city/region from it
          if (!coords) {
            const cityPart = extractCityFromAddress(loc.name);
            if (cityPart && cityPart !== loc.name) {
              coords = await geocodeLocation(cityPart);
            }
          }
          return { ...loc, lat: coords?.lat, lng: coords?.lng };
        }),
      );

      // Build waypoints for multi-distance call (single OSRM request)
      const validWaypoints: { lat: number; lng: number }[] = [];
      const waypointIndices: number[] = []; // maps waypoint index → geocoded index
      for (let i = 0; i < geocoded.length; i++) {
        const g = geocoded[i];
        if (g.lat != null && g.lng != null) {
          validWaypoints.push({ lat: g.lat, lng: g.lng });
          waypointIndices.push(i);
        }
      }

      // Fetch all leg distances in one call
      let legDistances: { distanceKm: number; durationMinutes: number }[] | null = null;
      if (validWaypoints.length >= 2) {
        legDistances = await getMultiWaypointDistances(validWaypoints);
        console.log("[buildStops] Multi-waypoint distances:", legDistances);
      }

      // Build result, mapping multi-distances back to the correct legs
      const result: RouteStop[] = [];
      for (let i = 0; i < geocoded.length; i++) {
        const g = geocoded[i];
        let distanceFromPrevKm = 0;
        let driveMinutesFromPrev = 0;

        if (i > 0) {
          // Check if both this stop and the previous one were in the valid waypoints
          const prevWpIdx = waypointIndices.indexOf(i - 1);
          const curWpIdx = waypointIndices.indexOf(i);
          if (prevWpIdx >= 0 && curWpIdx >= 0 && curWpIdx === prevWpIdx + 1 && legDistances && legDistances[prevWpIdx]) {
            distanceFromPrevKm = legDistances[prevWpIdx].distanceKm;
            driveMinutesFromPrev = legDistances[prevWpIdx].durationMinutes;
          } else if (g.lat != null && g.lng != null) {
            // Fallback to single-pair call if multi failed
            const prev = geocoded[i - 1];
            if (prev.lat != null && prev.lng != null) {
              const dist = await getDistance(prev.lat, prev.lng, g.lat, g.lng);
              if (dist) {
                distanceFromPrevKm = dist.distanceKm;
                driveMinutesFromPrev = dist.durationMinutes;
              }
            }
          }
        }

        result.push({
          id: nextStopId(),
          type: g.type,
          location: g.name,
          lat: g.lat,
          lng: g.lng,
          dockTimeMinutes: g.dockMinutes,
          distanceFromPrevKm,
          driveMinutesFromPrev,
        });
      }

      return result;
    },
    [],
  );

  /**
   * Safety net: if any consecutive leg has valid coords on both endpoints but
   * 0 distance/duration, re-fetch the distance from the API so drive time
   * always matches the Google Maps embed.
   */
  async function repairMissingDistances(stops: RouteStop[]): Promise<RouteStop[]> {
    let needsRepair = false;
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const cur = stops[i];
      if (
        prev.lat != null && prev.lng != null &&
        cur.lat != null && cur.lng != null &&
        (cur.distanceFromPrevKm ?? 0) === 0 &&
        (cur.driveMinutesFromPrev ?? 0) === 0
      ) {
        needsRepair = true;
        break;
      }
    }
    if (!needsRepair) return stops;

    console.log("[repairMissingDistances] Detected 0-distance legs with valid coords, re-fetching…");
    const repaired = [...stops];
    for (let i = 1; i < repaired.length; i++) {
      const prev = repaired[i - 1];
      const cur = repaired[i];
      if (
        prev.lat != null && prev.lng != null &&
        cur.lat != null && cur.lng != null &&
        (cur.distanceFromPrevKm ?? 0) === 0 &&
        (cur.driveMinutesFromPrev ?? 0) === 0
      ) {
        const dist = await getOSRMRoute(prev.lat, prev.lng, cur.lat, cur.lng);
        if (dist) {
          repaired[i] = {
            ...cur,
            distanceFromPrevKm: dist.distanceKm,
            driveMinutesFromPrev: dist.durationMinutes,
          };
        }
      }
    }
    return repaired;
  }

  // ── Trigger route build ───────────────────────────────────────

  const calcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function triggerRouteBuild(
    fStops?: FormStop[],
    saveToHistory = false,
    chatUserMessage?: string,
  ) {
    const stopsToUse = fStops ?? formStops;
    const filled = stopsToUse.filter((s) => s.location.trim());
    if (filled.length < 2) return;
    setIsGeocodingRoute(true);
    try {
      const rawBuilt = await buildStopsFromForm(
        stopsToUse,
        effectiveYard,
        includeReturn,
      );
      const built = await repairMissingDistances(rawBuilt);
      setStops(built);
      // Reset any user-applied drive time adjustments — fresh API data just arrived
      setFormStops((prev) => prev.map((s) => ({ ...s, driveMinutesAdjustment: 0 })));
      // Reset user quote, note, and surcharge for the new route
      setCustomQuoteAmount("");
      setCustomerNote("");
      setAccessorials((prev) => ({ ...prev, costInflationPct: 0, tollRatePerKm: 0 }));
      if (built.length >= 2 && selectedProfileId) {
        await calculateRoute(built, undefined, {
          saveToHistory,
          chatUserMessage,
          countQuote: true,
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Route build error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsGeocodingRoute(false);
    }
  }

  // ── Listen for favorite lane clicks from sidebar ─────────────
  // Use refs so the event listener always calls the latest versions of these
  // functions (they close over selectedProfileId, effectiveYard, etc.)
  const populateFormRef = useRef(populateFormFromLocations);
  populateFormRef.current = populateFormFromLocations;
  const triggerRouteBuildRef = useRef(triggerRouteBuild);
  triggerRouteBuildRef.current = triggerRouteBuild;
  const calculateRouteRef = useRef(calculateRoute);
  calculateRouteRef.current = calculateRoute;

  useEffect(() => {
    function handleLoadLane(e: Event) {
      const detail = (e as CustomEvent).detail as {
        origin: string;
        destination: string;
        cachedStops?: RouteStop[] | null;
        cachedCosts?: CachedCosts | null;
      };
      const { origin, destination, cachedStops, cachedCosts } = detail;
      if (!origin || !destination) return;

      // Restore all cost/charge state saved when the lane was favorited
      if (cachedCosts) {
        setAccessorials(cachedCosts.accessorials);
        setCustomQuoteAmount(cachedCosts.customQuoteAmount);
        setCustomerNote(cachedCosts.customerNote);
        setQuoteMode(cachedCosts.quoteMode);
        setPayMode(cachedCosts.payMode as PayMode);
        setPayModeManualOverride(true);
        setDefaultDockMinutes(cachedCosts.defaultDockMinutes);
        setIncludeReturn(cachedCosts.includeReturn);
        if (cachedCosts.selectedProfileId) setSelectedProfileId(cachedCosts.selectedProfileId);
      }

      if (cachedStops && cachedStops.length >= 2) {
        // ── Fast path: use cached stops (skip geocoding + OSRM) ──
        // Populate form with non-yard stop locations only (yard is kept in cachedStops for deadhead calc).
        populateFormRef.current(cachedStops.filter((s) => s.type !== "yard").map((s) => s.location));
        setStops(cachedStops);
        stopsRef.current = cachedStops;
        void calculateRouteRef.current(cachedStops);
      } else {
        // ── Slow path: no cache, do full geocode + route build ──
        const newStops = populateFormRef.current([origin, destination]);
        void triggerRouteBuildRef.current(newStops);
      }
    }
    window.addEventListener("bungee:load-lane", handleLoadLane);
    return () => window.removeEventListener("bungee:load-lane", handleLoadLane);
  }, []);

  // Debounced recalc when fuel price, return toggle, or profile changes.
  // Uses stopsRef to always read the latest stops regardless of closure timing.
  useEffect(() => {
    const currentStops = stopsRef.current;
    if (currentStops.length < 2 || !selectedProfileId) return;
    if (calcTimerRef.current) clearTimeout(calcTimerRef.current);
    calcTimerRef.current = setTimeout(() => {
      calculateRoute(applyDriveAdjustments(stopsRef.current, formStopsRef.current));
    }, 600);
    return () => {
      if (calcTimerRef.current) clearTimeout(calcTimerRef.current);
    };
  }, [selectedProfileId, fuelPrice, includeReturn, defaultDockMinutes, payMode]);

  // When default dock time changes, update all existing form stops and built stops so recalc uses the new value
  useEffect(() => {
    setFormStops((prev) =>
      prev.map((s) => ({ ...s, dockMinutes: defaultDockMinutes }))
    );
    // Also update the built RouteStop[] so the debounced recalc picks up the new dock time
    setStops((prev) =>
      prev.map((s) =>
        s.type === "yard" ? s : { ...s, dockTimeMinutes: defaultDockMinutes }
      )
    );
  }, [defaultDockMinutes]);

  // When the yard selection changes and we already have a built route, rebuild
  // stops so the yard (deadhead) leg is added/removed and recalculate.
  const prevYardIdRef = useRef(effectiveYard?.id);
  useEffect(() => {
    const prevId = prevYardIdRef.current;
    const newId = effectiveYard?.id;
    prevYardIdRef.current = newId;
    if (prevId === newId) return; // no change
    const filled = formStops.filter((s) => s.location.trim());
    if (filled.length < 2) return; // no route to rebuild
    void triggerRouteBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveYard?.id]);

  // ── Auto-detect pay mode based on total TRIP distance (excludes deadhead) ──
  // >300 mi (~483 km) → per-mile/km; ≤50 mi (~80 km) → per-hour; 50–300 → per-hour
  // User can manually override via toggle; override resets when new route is built
  const autoDetectPayMode = useCallback((totalDistanceKm: number): PayMode => {
    const totalMiles = totalDistanceKm / 1.609344;
    if (totalMiles > 300) return "perMile";
    return "perHour";
  }, []);

  // ── Calculate route ───────────────────────────────────────────

  async function calculateRoute(
    routeStops: RouteStop[],
    returnDistance?: { distanceKm: number; durationMinutes: number } | null,
    options?: { saveToHistory?: boolean; chatUserMessage?: string; countQuote?: boolean },
  ) {
    if (!selectedProfileId || routeStops.length < 2 || !scopeId) return;
    const fp = parseFloat(fuelPrice);
    if (isNaN(fp) || fp <= 0) return;

    // ── Enforce monthly quote limit for free-tier users ──
    if (quoteUsage.isAtLimit) {
      setUpgradeReason({
        title: "Monthly quote limit reached",
        description: `You've used all ${quoteUsage.limit.toLocaleString()} free route quotes this month. Upgrade to Pro or Premium for unlimited quotes.`,
      });
      setUpgradeOpen(true);
      return;
    }

    setIsCalculating(true);
    try {
      const rawProfile = await firebaseDb.getProfile(scopeId, selectedProfileId);
      if (!rawProfile) throw new Error("Equipment cost profile not found");

      // Convert profile costs to the user's display currency
      const profileCurrency = (rawProfile.currency as SupportedCurrency) || "USD";
      const profile = convertCostProfileCurrency(rawProfile, profileCurrency, currency) as typeof rawProfile;

      // First pass: compute distances to determine pay mode
      const preCalc = calculateRouteCost(profile, routeStops, includeReturn, fp, returnDistance?.distanceKm, returnDistance?.durationMinutes, "perHour", measureUnit);
      // Auto-detect pay mode unless user manually overrode
      let effectivePayMode = payMode;
      if (!payModeManualOverride) {
        // Only auto-detect on the non-deadhead distance (trip distance, not individual legs)
        const tripDistKm = preCalc.legs.filter(l => !l.isDeadhead).reduce((s, l) => s + l.distanceKm, 0);
        const tripMiles = tripDistKm / 1.609344;
        effectivePayMode = autoDetectPayMode(tripDistKm);

        // >300 mi: auto-switch to per-mile/km — alert if per-mile rate is missing
        if (tripMiles > 300) {
          const perMileRate = profile.driverPayPerMile || 0;
          if (perMileRate <= 0) {
            // Per-mile rate not set — alert user, fall back to per-hour
            effectivePayMode = "perHour";
            toast({
              title: `Per ${dLabel === "mi" ? "mile" : "km"} rate unavailable`,
              description: `This trip is ${Math.round(tripMiles)} miles — per ${dLabel === "mi" ? "mile" : "km"} billing is recommended but your equipment cost profile has no per ${dLabel === "mi" ? "mile" : "km"} rate set. Using per hour instead. Update your cost profile to add a per ${dLabel === "mi" ? "mile" : "km"} rate.`,
              variant: "destructive",
            });
          }
        }

        if (effectivePayMode !== payMode) setPayMode(effectivePayMode);
        // Show local alert when trip ≤ 50 miles
        setShowLocalAlert(tripMiles <= 50 && tripMiles > 0 && effectivePayMode !== "perHour");
      }

      const data = calculateRouteCost(
        profile,
        routeStops,
        includeReturn,
        fp,
        returnDistance?.distanceKm,
        returnDistance?.durationMinutes,
        effectivePayMode,
        measureUnit,
      ) as RouteCalculation;
      setRouteCalc(data);
      const customAmt = parseFloat(customQuoteAmount);
      const pricing = getPricingAdvice(
        data.fullTripCost,
        undefined,
        !isNaN(customAmt) && customAmt > 0 ? customAmt : undefined,
      ) as PricingAdvice;
      setPricingAdvice(pricing);

      // Increment monthly quote usage counter (free-tier limit tracking)
      // Only count when explicitly flagged — debounced recalcs from state
      // changes (payMode, fuelPrice, etc.) should NOT consume a credit.
      if (options?.countQuote && quoteUsage.limit !== -1) {
        quoteUsage.increment().catch(() => {});
      }

      // Chat-generated routes: log to admin-only collection (not user quote history)
      if (options?.saveToHistory && data.fullTripCost > 0) {
        try {
          const nonYard = routeStops.filter((s) => s.type !== "yard");
          const chatOrigin = nonYard[0]?.location ?? routeStops[0]?.location ?? "";
          const chatDest = nonYard[nonYard.length - 1]?.location ?? routeStops[routeStops.length - 1]?.location ?? "";
          const distMi = data.totalDistanceKm * 0.621371;
          await firebaseDb.createChatQuoteLog(user?.uid, scopeId, {
            profileId: profile.id,
            routeId: null,
            origin: chatOrigin,
            destination: chatDest,
            truckType: profile.truckType,
            distance: distMi,
            pricingMode: "chat_route",
            carrierCost: data.legs.reduce((s, l) => s + (l.fixedCost + l.driverCost), 0),
            fuelSurcharge: data.legs.reduce((s, l) => s + l.fuelCost, 0),
            totalCarrierCost: data.fullTripCost,
            marginType: "percentage",
            marginValue: 0,
            marginAmount: 0,
            customerPrice: data.fullTripCost,
            grossProfit: 0,
            profitMarginPercent: 0,
            quoteSource: "chat_route",
            routeSnapshotJson: JSON.stringify({
              routeSummary: (includeReturn ? routeStops : routeStops.filter((s) => s.type !== "yard")).map((s) => shortLocation(s.location)).filter(Boolean).join(" \u2192 "),
              totalKm: data.totalDistanceKm,
              totalMin: data.totalDriveMinutes,
              chatUserMessage: options.chatUserMessage,
            }),
            customerNote: options.chatUserMessage ?? "",
            status: "pending",
          });
        } catch {
          // Silent — admin log failure should not interrupt user flow
        }
      }
    } catch (err: unknown) {
      toast({
        title: "Calculation error",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCalculating(false);
    }
  }

  // ── Pricing advice ────────────────────────────────────────────

  function fetchPricingAdvice(totalCost: number) {
    if (totalCost <= 0) return;
    const customAmt = parseFloat(customQuoteAmount);
    const data = getPricingAdvice(
      totalCost,
      undefined,
      !isNaN(customAmt) && customAmt > 0 ? customAmt : undefined,
    );
    setPricingAdvice(data as PricingAdvice);
  }

  // Refetch pricing when custom quote amount, inflation, or toll change
  // NOTE: accessorials are NOT included — they are added to the final quote, not the cost base
  useEffect(() => {
    const cost = (routeCalc?.fullTripCost ?? 0) + costInflationAmount + tollAmount;
    if (!routeCalc || cost <= 0) return;
    const timer = setTimeout(() => {
      fetchPricingAdvice(cost);
    }, 400);
    return () => clearTimeout(timer);
  }, [customQuoteAmount, costInflationAmount, tollAmount]);

  // ── Manual Save Quote ────────────────────────────────────────

  async function handleSaveQuote(status: "pending" | "won" | "lost" = "pending") {
    if (!routeCalc || !pricingAdvice || !scopeId || !selectedProfileId) return;
    const fp = parseFloat(fuelPrice);
    if (isNaN(fp) || fp <= 0) return;

    // Require a valid quote amount before saving
    const quoteAmt = parseFloat(customQuoteAmount);
    if (!customQuoteAmount.trim() || isNaN(quoteAmt) || quoteAmt <= 0) {
      toast({
        title: "Enter your quote amount",
        description: "Please enter a price in the \"Your Quote\" field before saving.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingQuote(true);
    try {
      const rawProfile = await firebaseDb.getProfile(scopeId, selectedProfileId);
      if (!rawProfile) throw new Error("Equipment cost profile not found");
      const profileCurrency = (rawProfile.currency as SupportedCurrency) || "USD";
      const profile = convertCostProfileCurrency(rawProfile, profileCurrency, currency) as typeof rawProfile;

      const quote = await persistRouteBuilderQuote(scopeId, profile, stops, {
        includeReturn,
        fuelPricePerLitre: fp,
        yardLabel: effectiveYard?.name ?? undefined,
        calc: routeCalc,
        pricing: pricingAdvice,
        customQuoteInput: customQuoteAmount,
        customerNote,
        accessorialTotal,
        surchargePercent: accessorials.costInflationPct || undefined,
        surchargeAmount: costInflationAmount || undefined,
        accessorialItems: (() => {
          const items: { label: string; amount: number }[] = [];
          const a = accessorials;
          if (a.detentionHours > 0) items.push({ label: `Detention (${a.detentionHours}h × $${a.detentionRate})`, amount: a.detentionHours * a.detentionRate });
          if (a.stopOffCount > 0) items.push({ label: `Stop-off (${a.stopOffCount} × $${a.stopOffRate})`, amount: a.stopOffCount * a.stopOffRate });
          if (a.lumperFee > 0) items.push({ label: "Lumper", amount: a.lumperFee });
          if (a.borderCrossing > 0) items.push({ label: "Border crossing", amount: a.borderCrossing });
          if (a.tonu > 0) items.push({ label: "TONU", amount: a.tonu });
          if (a.tailgateFee > 0) items.push({ label: "Tailgate", amount: a.tailgateFee });
          if (a.customAccessorialAmount > 0) items.push({ label: a.customAccessorialLabel || "Other", amount: a.customAccessorialAmount });
          return items;
        })(),
        payMode,
        dockTimeHrs: defaultDockMinutes / 60,
        quoteMode,
        status,
        wonRate: status === "won" ? quoteAmt : null,
      });
      queryClient.invalidateQueries({
        queryKey: ["firebase", "quotes", scopeId ?? ""],
      });
      setCustomerNote("");
      setLastSavedQuote(quote);

      const statusLabel = status === "won" ? "Won" : status === "lost" ? "Lost" : "Pending";
      toast({
        title: `Quote saved as ${statusLabel}`,
        description: `${quote.quoteNumber} · ${quote.origin} → ${quote.destination}`,
      });
    } catch (err: unknown) {
      toast({
        title: "Could not save quote",
        description: err instanceof Error ? err.message : "Sign in to save quotes.",
        variant: "destructive",
      });
    } finally {
      setIsSavingQuote(false);
    }
  }

  // ── Save / unsave favorite lane ──────────────────────────────
  async function handleToggleFavLane() {
    if (!routeCalc || !scopeId || stops.length < 2) return;
    const nonYard = stops.filter((s) => s.type !== "yard");
    const origin = nonYard[0]?.location ?? stops[0]?.location ?? "";
    const destination = nonYard[nonYard.length - 1]?.location ?? stops[stops.length - 1]?.location ?? "";
    if (!origin || !destination) return;

    // Full route key includes all stops (not just origin/destination)
    const key = nonYard.map((s) => s.location).filter(Boolean).join("→");
    const isAlreadyFav = favLaneIds.has(key);

    setIsSavingFav(true);
    try {
      if (isAlreadyFav) {
        // Find and delete the matching lane (match on full route key)
        const match = savedLanes.find((l) => {
          const cached = (l as LaneWithCache).cachedStops;
          if (cached && cached.length >= 2) {
            const laneKey = cached.filter((s) => s.type !== "yard").map((s) => s.location).filter(Boolean).join("→");
            return laneKey === key;
          }
          return `${l.origin}→${l.destination}` === key;
        });
        if (match) {
          await firebaseDb.deleteLane(scopeId, match.id);
        }
        toast({ title: "Lane removed from favorites" });
      } else {
        // Check favorite lane limit based on subscription tier
        const limit = favLaneLimit(user);
        if (limit !== -1 && savedLanes.length >= limit) {
          setUpgradeReason({
            title: "Favorite lane limit reached",
            description: `Your ${tierLabel(user)} plan allows ${limit} favorite lanes. Upgrade for more.`,
          });
          setUpgradeOpen(true);
          setIsSavingFav(false);
          return;
        }
        const distMi = routeCalc.totalDistanceKm * 0.621371;
        // Cache the fully-built stops (with lat/lng & distances) so reloading
        // this lane later skips geocoding & OSRM API calls entirely.
        const cachedStops = stops.map((s) => ({
          id: s.id,
          type: s.type,
          location: s.location,
          lat: s.lat ?? null,
          lng: s.lng ?? null,
          dockTimeMinutes: s.dockTimeMinutes ?? 0,
          distanceFromPrevKm: s.distanceFromPrevKm ?? 0,
          driveMinutesFromPrev: s.driveMinutesFromPrev ?? 0,
        }));
        const cachedCosts: CachedCosts = {
          accessorials: { ...accessorials },
          customQuoteAmount,
          customerNote,
          quoteMode,
          payMode,
          defaultDockMinutes,
          includeReturn,
          selectedProfileId,
        };
        await firebaseDb.createLane(scopeId, {
          origin,
          destination,
          truckType: profiles.find((p) => p.id === selectedProfileId)?.truckType ?? "General",
          fixedPrice: 0,
          estimatedMiles: Math.round(distMi),
          cachedStops,
          cachedCosts,
        } as Parameters<typeof firebaseDb.createLane>[1] & { cachedStops: typeof cachedStops; cachedCosts: CachedCosts });
        toast({ title: "Lane saved to favorites", description: `${origin} → ${destination}` });
      }
      queryClient.invalidateQueries({ queryKey: ["firebase", "lanes", scopeId ?? ""] });
    } catch (err: unknown) {
      toast({
        title: "Could not update favorite",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingFav(false);
    }
  }

  // ── Drive time adjustment ─────────────────────────────────────

  function handleAdjustDriveTime(formStopIdx: number, deltaMinutes: number) {
    const newFormStops = formStops.map((s, i) => {
      if (i !== formStopIdx) return s;
      const base = getBaseStopDriveMinutes(stopsRef.current, formStopIdx);
      const currentAdj = s.driveMinutesAdjustment ?? 0;
      // Clamp so effective drive time never goes below 0
      const newAdj = Math.max(-base, currentAdj + deltaMinutes);
      return { ...s, driveMinutesAdjustment: newAdj };
    });
    setFormStops(newFormStops);
    const currentStops = stopsRef.current;
    if (currentStops.length >= 2 && selectedProfileId) {
      void calculateRoute(applyDriveAdjustments(currentStops, newFormStops));
    }
  }

  function handleResetDriveTime(formStopIdx: number) {
    const newFormStops = formStops.map((s, i) =>
      i === formStopIdx ? { ...s, driveMinutesAdjustment: 0 } : s,
    );
    setFormStops(newFormStops);
    const currentStops = stopsRef.current;
    if (currentStops.length >= 2 && selectedProfileId) {
      void calculateRoute(applyDriveAdjustments(currentStops, newFormStops));
    }
  }

  // ── Dock time adjustment ──────────────────────────────────────

  function handleAdjustDockTime(formStopIdx: number, deltaMinutes: number) {
    const newFormStops = formStops.map((s, i) => {
      if (i !== formStopIdx) return s;
      const newDock = Math.max(0, (s.dockMinutes ?? defaultDockMinutes) + deltaMinutes);
      return { ...s, dockMinutes: newDock };
    });
    setFormStops(newFormStops);
    const currentStops = stopsRef.current;
    if (currentStops.length >= 2 && selectedProfileId) {
      void calculateRoute(applyDriveAdjustments(currentStops, newFormStops));
    }
  }

  function handleResetDockTime(formStopIdx: number) {
    const newFormStops = formStops.map((s, i) =>
      i === formStopIdx ? { ...s, dockMinutes: defaultDockMinutes } : s,
    );
    setFormStops(newFormStops);
    const currentStops = stopsRef.current;
    if (currentStops.length >= 2 && selectedProfileId) {
      void calculateRoute(applyDriveAdjustments(currentStops, newFormStops));
    }
  }

  // ── Chat route mutation ───────────────────────────────────────

  function populateFormFromLocations(locations: string[]) {
    const newStops: FormStop[] = locations.map((loc) => ({
      id: nextStopId(),
      location: loc,
      dockMinutes: defaultDockMinutes,
    }));
    setFormStops(newStops);
    return newStops;
  }

  const chatRouteMutation = useMutation({
    mutationFn: async (payload: { message: string; userMessage: string }) =>
      processChatRoute(payload.message, defaultDockMinutes),
    onSuccess: async (data: ChatRouteResult, variables) => {
      const userMessage = variables.userMessage;
      // Capture shipment info and freight metadata if the server extracted them
      if (data.shipment) setActiveShipment(data.shipment);
      if (data.freightMeta) setActiveFreightMeta(data.freightMeta);
      try {
        if (data.success && data.stops && data.stops.length > 0) {
          const parsed = data.stops as RouteStop[];
          const nonYard = parsed.filter((s) => s.type !== "yard");
          if (nonYard.length >= 1) {
            populateFormFromLocations(nonYard.map((s) => s.location));
          }

          // Override server-hardcoded dockTimeMinutes with the user's UI Load/Unload value
          const parsedWithDock = parsed.map((s) =>
            s.type === "yard" ? s : { ...s, dockTimeMinutes: defaultDockMinutes }
          );

          const hasDistances = parsedWithDock.some((s) => (s.distanceFromPrevKm ?? 0) > 0);
          if (hasDistances) {
            let allStops = [...parsedWithDock];
            // Routes start at pickup, not yard. Only append yard at end for return deadhead.
            if (effectiveYard && !parsed.some((s) => s.type === "yard")) {
              // Compute actual distance from last stop to yard
              const lastStop = allStops[allStops.length - 1];
              const yardLat = effectiveYard.lat ?? undefined;
              const yardLng = effectiveYard.lng ?? undefined;
              let deadheadDistKm = 0;
              let deadheadDriveMin = 0;

              if (
                lastStop?.lat != null && lastStop?.lng != null &&
                yardLat != null && yardLng != null &&
                Number.isFinite(yardLat) && Number.isFinite(yardLng)
              ) {
                const dist = await getDistance(lastStop.lat, lastStop.lng, yardLat, yardLng);
                if (dist) {
                  deadheadDistKm = dist.distanceKm;
                  deadheadDriveMin = dist.durationMinutes;
                }
              } else if (yardLat == null || yardLng == null) {
                // Yard has no coords — try geocoding
                const yardLocation = effectiveYard.address || effectiveYard.name;
                const coords = await geocodeLocation(yardLocation);
                if (coords && lastStop?.lat != null && lastStop?.lng != null) {
                  const dist = await getDistance(lastStop.lat, lastStop.lng, coords.lat, coords.lng);
                  if (dist) {
                    deadheadDistKm = dist.distanceKm;
                    deadheadDriveMin = dist.durationMinutes;
                  }
                }
              }

              const yardStop: RouteStop = {
                id: nextStopId(),
                type: "yard",
                location: effectiveYard.address || effectiveYard.name,
                lat: yardLat,
                lng: yardLng,
                dockTimeMinutes: 0,
                distanceFromPrevKm: deadheadDistKm,
                driveMinutesFromPrev: deadheadDriveMin,
              };
              allStops.push({ ...yardStop, id: nextStopId() });
            }
            let stopsForCalcAndMap = allStops;
            const hasMissingLatLng = allStops.some(
              (s) =>
                (s.lat == null || s.lng == null) &&
                typeof s.location === "string" &&
                s.location.trim().length > 0
            );

            if (hasMissingLatLng) {
              // Chat can return stops with distances but without coordinates.
              // The route map requires `lat`/`lng`, while cost calc uses the provided
              // `distanceFromPrevKm`/`driveMinutesFromPrev` fields.
              stopsForCalcAndMap = await Promise.all(
                allStops.map(async (s) => {
                  if (
                    s.lat != null &&
                    s.lng != null &&
                    Number.isFinite(s.lat) &&
                    Number.isFinite(s.lng)
                  ) {
                    return s;
                  }
                  const coords = await geocodeLocation(s.location);
                  return {
                    ...s,
                    lat: coords?.lat,
                    lng: coords?.lng,
                  };
                })
              );
            }

            const repairedStops = await repairMissingDistances(stopsForCalcAndMap);
            setStops(repairedStops);
            if (repairedStops.length >= 2 && selectedProfileId) {
              await calculateRoute(repairedStops, data.returnDistance ?? undefined, {
                saveToHistory: true,
                chatUserMessage: userMessage,
                countQuote: true,
              });
            }
          } else {
            const newStops = nonYard.map((s) => ({
              id: nextStopId(),
              location: s.location,
              dockMinutes: s.dockTimeMinutes ?? defaultDockMinutes,
            }));
            await triggerRouteBuild(newStops, true, userMessage);
          }

          setChatHistory((prev) => [
            ...prev,
            { role: "bot", text: data.message },
          ]);
          setChatMessage("");

          // Suggest saving as favorite lane if user has none yet
          if (savedLanes.length === 0) {
            toast({
              title: "Save as favorite lane?",
              description: "Click the ☆ star icon on the route header to save this lane for quick access next time.",
            });
          }
        } else if (data.locations && data.locations.length >= 2) {
          const newStops = populateFormFromLocations(data.locations);
          await triggerRouteBuild(newStops, true, userMessage);
          setChatHistory((prev) => [
            ...prev,
            { role: "bot", text: data.message || "Route parsed. Calculating..." },
          ]);
          setChatMessage("");
        } else {
          setChatHistory((prev) => [
            ...prev,
            {
              role: "bot",
              text: data.message || "Could not parse route. Try again.",
            },
          ]);
        }
      } catch (e: unknown) {
        setChatHistory((prev) => [
          ...prev,
          {
            role: "bot",
            text: `Error: ${e instanceof Error ? e.message : "Unknown error"}`,
          },
        ]);
      }
    },
    onError: (err: Error) => {
      setChatHistory((prev) => [
        ...prev,
        { role: "bot", text: `Error: ${err.message}` },
      ]);
    },
  });

  function sendChat(msg: string) {
    if (!msg.trim()) return;
    setChatHistory((prev) => [...prev, { role: "user", text: msg.trim() }]);
    chatRouteMutation.mutate({
      message: msg.trim(),
      userMessage: msg.trim(),
    });
  }

  // ── Quick route chips (based on user base location) ──────────

  const quickRoutes = useMemo(() => {
    // Prefer user's favorite lanes as quick route chips (up to 3)
    if (savedLanes.length > 0) {
      return savedLanes.slice(0, 3).map((l) => `${l.origin} to ${l.destination}`);
    }
    // Fallback: generic suggestions based on user's operating location
    const base = effectiveYard?.name || user?.operatingCity?.trim();
    if (!base) return [];
    const countryCode = user?.operatingCountryCode?.toUpperCase();
    const isUS = countryCode === "US" || countryCode === "USA";
    const isCA = countryCode === "CA" || countryCode === "CAN";
    if (isUS) {
      return [
        `${base} to Chicago`,
        `${base} to Atlanta`,
        `${base} to Dallas`,
      ];
    }
    if (isCA) {
      return [
        `${base} to Toronto`,
        `${base} to Montreal`,
        `${base} to Vancouver`,
      ];
    }
    return [
      `${base} to Chicago`,
      `${base} to Toronto`,
      `${base} to Atlanta`,
    ];
  }, [savedLanes, effectiveYard?.name, user?.operatingCity, user?.operatingCountryCode]);

  // ── Swap origin/destination ───────────────────────────────────

  function swapOriginDest() {
    setFormStops((prev) => {
      if (prev.length < 2) return prev;
      const copy = [...prev];
      const first = copy[0];
      copy[0] = copy[copy.length - 1];
      copy[copy.length - 1] = first;
      return copy;
    });
  }

  // ── Lane Intelligence Popover ──────────────────────────────────
  function LaneIntelligencePopover({ stats }: { stats: LaneStats }) {
    const wsCurrency = resolveWorkspaceCurrency(user) as SupportedCurrency;
    const sym = currencySymbol(wsCurrency);
    const lastDate = stats.lastQuotedAt
      ? new Date(stats.lastQuotedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "--";
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 transition-colors"
            aria-label="Lane history"
          >
            <History className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{stats.totalQuotes} prev</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-[260px] p-3 text-xs"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {stats.displayOrigin}
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              {stats.displayDestination}
              <span className="text-xs font-normal text-slate-400 ml-auto">
                {stats.totalQuotes} quotes
              </span>
            </div>
            <div className="border-t border-slate-100 pt-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Win rate</span>
                <span className="text-slate-900 font-medium">
                  {Math.round(stats.winRate * 100)}% ({stats.wonQuotes}/{stats.wonQuotes + stats.lostQuotes})
                </span>
              </div>
              {stats.avgWinningPrice > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg winning price</span>
                  <span className="text-slate-900 font-medium">
                    {sym}{formatCurrencyAmount(stats.avgWinningPrice, wsCurrency)}
                  </span>
                </div>
              )}
              {stats.avgLosingTarget > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg losing target</span>
                  <span className="text-slate-900 font-medium">
                    {sym}{formatCurrencyAmount(stats.avgLosingTarget, wsCurrency)}
                  </span>
                </div>
              )}
              {stats.avgMarginPercent > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Your avg margin</span>
                  <span className="text-slate-900 font-medium">
                    {stats.avgMarginPercent.toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Last quoted</span>
                <span className="text-slate-400">{lastDate}</span>
              </div>
            </div>
            {stats.lastWinningPrice > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <p className="text-xs text-slate-400">
                  Last won at <span className="text-orange-600 font-medium">{sym}{formatCurrencyAmount(stats.lastWinningPrice, wsCurrency)}</span>
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Auto-suggest last winning price when lane is detected and no custom quote entered yet
  useEffect(() => {
    if (
      currentLaneStats &&
      currentLaneStats.lastWinningPrice > 0 &&
      !customQuoteAmount // Only suggest if user hasn't already typed a value
    ) {
      setCustomQuoteAmount(String(Math.round(currentLaneStats.lastWinningPrice)));
    }
    // Only run when lane stats change (new route entered), not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLaneStats?.laneKey]);

  // ── Route summary line ────────────────────────────────────────

  const routeSummaryText = useMemo(() => {
    if (stops.length < 2) return null;
    // Hide the return yard from the summary when deadhead toggle is off
    const displayStops = includeReturn
      ? stops
      : stops.filter((s, i) => !(i === stops.length - 1 && s.type === "yard"));

    const names = displayStops.map((s) => shortLocation(s.location)).filter(Boolean);
    return names.join(" \u2192 ");
  }, [stops, includeReturn]);

  const routeSummaryStats = useMemo(() => {
    if (!routeCalc) return null;
    const totalKm = routeCalc.totalDistanceKm;
    const driveMin = routeCalc.totalDriveMinutes;
    const dockMin = routeCalc.totalDockMinutes;
    const deadheadKm =
      routeCalc.legs
        ?.filter((l) => l.isDeadhead ?? l.type === "deadhead")
        .reduce((sum, l) => sum + l.distanceKm, 0) ?? 0;
    return { totalKm, driveMin, dockMin, deadheadKm };
  }, [routeCalc]);

  // Is the current route already saved as a favorite lane?
  const isFavLane = useMemo(() => {
    if (stops.length < 2) return false;
    const nonYard = stops.filter((s) => s.type !== "yard");
    // Include ALL stops in the key so adding a middle stop changes the match
    const fullKey = nonYard.map((s) => s.location).filter(Boolean).join("→");
    return favLaneIds.has(fullKey);
  }, [stops, favLaneIds]);

  // ── Derived pricing values (client-side fallbacks) ────────────

  const tripCost = routeCalc?.tripCost ?? 0;
  const deadheadCost = routeCalc?.deadheadCost ?? 0;
  const fullTripCost = routeCalc?.fullTripCost ?? 0;
  /** Carrier cost = base trip + inflation surcharge + toll estimate (margin tiers apply to this) */
  const carrierCost = fullTripCost + costInflationAmount + tollAmount;
  /** All-in cost = carrier cost + accessorial pass-throughs (accessorials added after margin) */
  const allInCost = carrierCost + accessorialTotal;

  // ── AI Pricing Suggestion (Phase 1: internal signal only) ────────
  const pricingSuggestionResult = useMemo(() => {
    if (!canUsePricingSuggestions(user)) return null;
    // laneStats comes from Feature 3's lane intelligence integration
    if (typeof currentLaneStats === "undefined") return null;
    return computeSuggestion(currentLaneStats ?? null, carrierCost, accessorialTotal);
  }, [user, currentLaneStats, carrierCost, accessorialTotal]);

  // ── IFTA fuel tax calculation ─────────────────────────────────
  const iftaResult = useMemo<IFTAResult | null>(() => {
    if (!routeCalc || !stops || stops.length < 2) return null;
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) return null;
    return calculateIFTA(stops, profile.fuelConsumptionPer100km);
  }, [routeCalc, stops, profiles, selectedProfileId]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <>
    <div className="space-y-2" data-testid="route-builder-page">
      {/* No cost profile alert */}
      {profiles.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-900">No Equipment Cost Profile Found</p>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              Create an equipment cost profile so Bungee can calculate accurate trip costs from your real operating expenses.
            </p>
            <a
              href="#/profiles?action=create"
              className="inline-flex items-center gap-2 mt-3 text-xs font-semibold text-white bg-orange-400 hover:bg-orange-500 rounded-md px-3 py-2 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Equipment Cost Profile
            </a>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          Route Controls — portaled into the App header row
          ═══════════════════════════════════════════════════════════ */}
      <RouteControlsPortal
        selectedProfileId={selectedProfileId}
        setSelectedProfileId={setSelectedProfileId}
        profiles={profiles}
        fuelPrice={fuelPrice}
        setFuelPrice={setFuelPrice}
        fuelPriceManual={fuelPriceManual}
        setFuelPriceManual={setFuelPriceManual}
        fuelPriceRegion={fuelPriceRegion}
        fuelPriceDate={fuelPriceDate}
        fuelPriceData={fuelPriceData}
        measureUnit={measureUnit}
        currency={currency}
        quoteMode={quoteMode}
        setQuoteMode={setQuoteMode}
      />

      {/* Quick Start Profile reminder */}
      {profiles.find((p) => p.id === selectedProfileId)?.name === "Quick Start Profile" && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <p className="text-sm text-slate-600 leading-snug">
            You're using the <strong className="text-slate-800">Quick Start Profile</strong> with industry-average values. For accurate quotes,{" "}
            <a href="#/profiles?action=create" className="underline font-semibold text-orange-600 hover:text-orange-500">
              create your own profile
            </a>{" "}
            with your real costs.
          </p>
        </div>
      )}

      {/* Local load alert: shown when per-mile is active on a < 50mi trip */}
      {showLocalAlert && payMode === "perMile" && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-sm text-slate-600 leading-snug">
            <strong className="text-slate-800">Local load detected.</strong> This route is under 50 miles — hourly billing is usually more accurate for short trips.{" "}
            <button
              className="underline font-semibold text-orange-600 hover:text-orange-500"
              onClick={() => {
                setPayModeManualOverride(true);
                setPayMode("perHour");
                setShowLocalAlert(false);
              }}
            >
              Switch to hourly
            </button>
          </p>
        </div>
      )}

      {/* Cross-border fuel price notice */}
      {isCrossBorder && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-sm text-slate-600 leading-snug">
            <strong className="text-slate-800">Cross-border route.</strong> Fuel price is based on your departure region — adjust manually for cross-border accuracy.
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1: Route + Cost Card (sticky, always visible)
          ═══════════════════════════════════════════════════════════ */}
      <div className="sticky top-12 sm:top-14 md:top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-1 bg-background">
        <Card className="border-slate-200 shadow-sm" data-testid="route-cost-section">
          <CardContent className="p-3 sm:p-4 space-y-2">
            {/* Row 1: Star + Route name + stats */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Favorite lane star button */}
                <button
                  type="button"
                  data-testid="button-fav-lane"
                  disabled={isSavingFav || stops.length < 2 || !routeCalc}
                  onClick={handleToggleFavLane}
                  title={isFavLane ? "Remove from favorite lanes" : "Save as favorite lane"}
                  className={`shrink-0 p-0.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    isFavLane
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-slate-300 hover:text-amber-400"
                  }`}
                >
                  <Star className={`w-4.5 h-4.5 ${isFavLane ? "fill-amber-400" : ""}`} />
                </button>
                <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center sm:flex-wrap sm:gap-2">
                  <span className="text-sm font-semibold text-slate-900 truncate tracking-tight">
                    {routeSummaryText || effectiveYard?.name || user?.operatingCity || "New Route"}
                  </span>
                  {/* Route stats — below on mobile, inline on desktop */}
                  {routeSummaryStats && (
                    <span className="text-xs sm:text-sm text-slate-400 whitespace-nowrap truncate">
                      {displayDistance(routeSummaryStats.totalKm, measureUnit).toFixed(0)} {dLabel}
                      {" · "}
                      {Math.floor(routeSummaryStats.driveMin / 60)}h {String(Math.round(routeSummaryStats.driveMin % 60)).padStart(2, "0")}m drive
                      {routeSummaryStats.dockMin > 0
                        ? ` + ${Math.floor(routeSummaryStats.dockMin / 60)}h ${String(Math.round(routeSummaryStats.dockMin % 60)).padStart(2, "0")}m dock`
                        : ""}
                      {includeReturn && routeSummaryStats.deadheadKm > 0
                        ? ` + ${displayDistance(routeSummaryStats.deadheadKm, measureUnit).toFixed(0)} ${dLabel} return`
                        : ""}
                    </span>
                  )}
                  {/* Lane Intelligence — show when a matching lane exists */}
                  {currentLaneStats && <LaneIntelligencePopover stats={currentLaneStats} />}
                  {isGeocodingRoute && (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calculating...
                    </span>
                  )}
                </div>
              </div>

            </div>

            {/* Row 2: Pricing grid — always visible; labels/sublabels hidden when collapsed */}
            <div
              className="grid grid-cols-4 gap-0 divide-x divide-slate-100 items-start"
              data-testid="pricing-row"
            >
              {/* CARRIER COST */}
              <div className="space-y-1 pr-2 sm:pr-6">
                <div className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  Cost
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-slate-400 hover:text-slate-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                      This is an estimated cost based on your equipment cost profile. It does not reflect real-world carrier rates — use it as guidance only.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div
                  className="text-lg sm:text-2xl font-extrabold sm:font-bold text-orange-600 tabular-nums tracking-tight"
                  data-testid="pricing-trip-cost"
                >
                  {formatCurrency(includeReturn ? carrierCost : (tripCost + costInflationAmount + tollAmount))}
                </div>
                <div className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                  {costInflationAmount > 0 && <span>+{formatCurrency(costInflationAmount)} surcharge · </span>}
                  {tollAmount > 0 && <span>+{formatCurrency(tollAmount)} toll · </span>}
                  {includeReturn && deadheadCost > 0 ? `incl. ${formatCurrency(deadheadCost)} deadhead · ` : ""}
                  with fuel
                </div>
              </div>

              {/* Margin tiers */}
              {(pricingAdvice?.tiers || []).map((tier) => {
                const tierColor = tier.label.startsWith("20%") ? "text-red-500" : tier.label.startsWith("40%") ? "text-green-600" : "text-orange-600";
                return (
                  <div
                    key={tier.label}
                    className="space-y-1 px-2 sm:px-6"
                    data-testid={`pricing-tier-${tier.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <div className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">
                      {tier.label.replace(" Margin", "")}
                      <span className="hidden sm:inline"> Margin</span>
                    </div>
                    {carrierCost > 0 ? (
                      <>
                        <div className={`text-lg sm:text-2xl font-extrabold sm:font-bold tabular-nums tracking-tight ${tierColor}`}>
                          {formatCurrency(tier.price + accessorialTotal)}
                        </div>
                        <div className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                          +{formatCurrency(tier.marginAmount)}{accessorialTotal > 0 ? ` +${formatCurrency(accessorialTotal)} acc.` : ""}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm text-slate-300">&mdash;</div>
                        <div className="text-[10px] sm:text-xs text-slate-400">set route</div>
                      </>
                    )}
                  </div>
                );
              })}
              {/* Placeholders when no tiers yet */}
              {(!pricingAdvice?.tiers || pricingAdvice.tiers.length === 0) && (
                <>
                  {["20% Margin", "30% Margin", "40% Margin"].map((label) => (
                    <div key={label} className="space-y-1 px-2 sm:px-6">
                      <div className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {label.replace(" Margin", "")}
                        <span className="hidden sm:inline"> Margin</span>
                      </div>
                      <div className="text-sm text-slate-300">&mdash;</div>
                      <div className="text-[10px] sm:text-xs text-slate-400">set route</div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Row 3: Your Quote + Buttons */}
            <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-100">
              {/* Line A: quote input + margin indicator + save buttons — all on one row */}
              <div className="flex items-center gap-1 flex-nowrap">
                {/* Your Quote label + input */}
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium whitespace-nowrap shrink-0">Your Quote</span>
                <div className="flex items-center border border-slate-200 rounded-md overflow-hidden h-8 shrink-0">
                  <span className="text-sm text-slate-400 pl-2 pr-0.5">{currencySymbol(currency)}</span>
                  <Input
                    data-testid="input-custom-quote"
                    type="number"
                    step="1"
                    placeholder="0"
                    className="h-8 text-sm w-[80px] border-0 shadow-none focus-visible:ring-0 px-1"
                    value={customQuoteAmount}
                    onChange={(e) => setCustomQuoteAmount(e.target.value)}
                  />
                </div>
                  {/* Margin % indicator */}
                {/* Margin % indicator */}
                {pricingAdvice?.customQuote ? (
                  <span className="text-xs font-bold shrink-0 ml-0.5">
                    <span>{pricingAdvice.customQuote.marginPercent.toFixed(1)}%</span>
                    <span className={`ml-0.5 ${marginQualityLabel(pricingAdvice.customQuote.marginPercent).color}`}>
                      {marginQualityLabel(pricingAdvice.customQuote.marginPercent).label}
                    </span>
                  </span>
                ) : customQuoteAmount && carrierCost > 0 ? (
                  (() => {
                    const amt = parseFloat(customQuoteAmount);
                    if (!isNaN(amt) && amt > 0) {
                      const pct = ((amt - accessorialTotal - carrierCost) / carrierCost) * 100;
                      const q = marginQualityLabel(pct);
                      return (
                        <span className="text-xs font-bold shrink-0 ml-0.5">
                          <span>{pct.toFixed(1)}%</span>
                          <span className={`ml-0.5 ${q.color}`}>{q.label}</span>
                        </span>
                      );
                    }
                    return null;
                  })()
                ) : null}
                {/* Note field — desktop only (inline between margin % and save buttons) */}
                <Input
                  data-testid="input-customer-note"
                  placeholder="Add a note…"
                  className="hidden sm:block h-8 text-xs flex-1 min-w-0 border-input bg-white placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-slate-200"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                />
                {/* Won / Pending / Lost */}
                <div className="flex items-center gap-1 shrink-0 ml-auto sm:ml-0" data-testid="save-quote-group">
                  <Button
                    data-testid="button-save-won"
                    size="sm"
                    className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white gap-1 justify-center text-xs font-semibold"
                    disabled={isSavingQuote || !routeCalc || carrierCost <= 0}
                    onClick={() => handleSaveQuote("won")}
                    title="Won"
                  >
                    {isSavingQuote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trophy className="w-3 h-3" />}
                    <span className="hidden sm:inline">Won</span>
                  </Button>
                  <Button
                    data-testid="button-save-quote"
                    size="sm"
                    className="h-8 px-3 bg-orange-400 hover:bg-orange-500 text-white gap-1 justify-center text-xs font-semibold"
                    disabled={isSavingQuote || !routeCalc || carrierCost <= 0}
                    onClick={() => handleSaveQuote("pending")}
                    title="Pending"
                  >
                    {isSavingQuote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                    <span className="hidden sm:inline">Pending</span>
                  </Button>
                  <Button
                    data-testid="button-save-lost"
                    size="sm"
                    className="h-8 px-3 bg-red-500 hover:bg-red-600 text-white gap-1 justify-center text-xs font-semibold"
                    disabled={isSavingQuote || !routeCalc || carrierCost <= 0}
                    onClick={() => handleSaveQuote("lost")}
                    title="Lost"
                  >
                    {isSavingQuote ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                    <span className="hidden sm:inline">Lost</span>
                  </Button>
                  {/* PDF button — desktop only (mobile version is next to note field below) */}
                  {lastSavedQuote && can(user, "quote:sharePdf") && (
                    canExportPdf(user) ? (
                      <Button
                        data-testid="button-share-pdf"
                        variant="outline"
                        size="sm"
                        className="hidden sm:flex h-8 px-3 gap-1 shrink-0 border-orange-300 text-orange-600 hover:bg-orange-50 text-xs font-semibold"
                        onClick={() => setPdfDialogOpen(true)}
                      >
                        <FileDown className="w-3 h-3" />
                        PDF
                      </Button>
                    ) : (
                      <Button
                        data-testid="button-share-pdf"
                        variant="outline"
                        size="sm"
                        className="hidden sm:flex h-8 px-3 gap-1 shrink-0 text-slate-400 text-xs font-semibold"
                        onClick={() => {
                          setUpgradeReason({
                            title: "Upgrade to export branded PDFs",
                            description: "Branded quote PDFs are available on Pro and Premium plans.",
                          });
                          setUpgradeOpen(true);
                        }}
                      >
                        <FileDown className="w-3 h-3" />
                        PDF
                        <Badge variant="outline" className="text-[10px] ml-0.5 border-orange-300 text-orange-600">Pro</Badge>
                      </Button>
                    )
                  )}
                </div>
              </div>
              {currentLaneStats && currentLaneStats.lastWinningPrice > 0 && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Last won at {currencySymbol(resolveWorkspaceCurrency(user) as SupportedCurrency)}
                  {formatCurrencyAmount(currentLaneStats.lastWinningPrice, resolveWorkspaceCurrency(user) as SupportedCurrency)}
                </p>
              )}
              {/* Note field + PDF button — mobile only (second row below quote + buttons) */}
              <div className="sm:hidden flex items-center gap-2">
                <Input
                  data-testid="input-customer-note-mobile"
                  placeholder="Add a note…"
                  className="h-8 text-xs flex-1 min-w-0 border-slate-100 bg-slate-50 placeholder:text-slate-300 focus-visible:ring-1 focus-visible:ring-slate-200"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                />
                {lastSavedQuote && can(user, "quote:sharePdf") && (
                  canExportPdf(user) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 gap-1 shrink-0 border-orange-300 text-orange-600 hover:bg-orange-50 text-xs font-semibold"
                      onClick={() => setPdfDialogOpen(true)}
                    >
                      <FileDown className="w-3 h-3" />
                      PDF
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 gap-1 shrink-0 text-slate-400 text-xs font-semibold"
                      onClick={() => {
                        setUpgradeReason({
                          title: "Upgrade to export branded PDFs",
                          description: "Branded quote PDFs are available on Pro and Premium plans.",
                        });
                        setUpgradeOpen(true);
                      }}
                    >
                      <FileDown className="w-3 h-3" />
                      PDF
                      <Badge variant="outline" className="text-[10px] ml-0.5 border-orange-300 text-orange-600">Pro</Badge>
                    </Button>
                  )
                )}
              </div>
            </div>

          </CardContent>
        </Card>
      </div>

      {/* ── AI Pricing Suggestion ──────────────────────────────── */}
      {pricingSuggestionResult && routeCalc && carrierCost > 0 && (
        <PricingSuggestionCard
          suggestion={pricingSuggestionResult}
          onUsePrice={(price) => setCustomQuoteAmount(String(price))}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════
          ACCESSORIAL CHARGES (Advanced mode only)
          ═══════════════════════════════════════════════════════════ */}
      {quoteMode === "advanced" && routeCalc && routeCalc.fullTripCost > 0 && (
        <Card className="border-slate-200 shadow-sm" data-testid="advanced-section">
          <CardContent className="pt-3 pb-3 space-y-2">
            {/* ── ROW 1: COST — pay mode, dock time, deadhead, surcharge, breakdown ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Cost</h4>
                <div className="flex-1 border-t border-slate-100" />
                {costInflationAmount > 0 && <span className="text-xs font-semibold text-slate-500">+{formatCurrency(costInflationAmount)} surcharge</span>}
                {tollAmount > 0 && <span className="text-xs font-semibold text-slate-500">+{formatCurrency(tollAmount)} toll</span>}
              </div>
              <div className="flex items-center gap-x-3 sm:gap-x-4 gap-y-2 flex-wrap [&_input]:h-8 [&_button]:leading-8">
                {/* Pay mode toggle */}
                <div
                  data-testid="switch-pay-mode"
                  className="inline-flex rounded-md border border-orange-300 overflow-hidden h-8 text-xs font-medium select-none"
                >
                  <button
                    type="button"
                    onClick={() => { setPayModeManualOverride(true); setPayMode("perHour"); setShowLocalAlert(false); }}
                    className={`px-3 flex items-center justify-center h-8 transition-colors ${payMode === "perHour" ? "bg-orange-400 text-white" : "bg-white text-slate-500 hover:bg-orange-50"}`}
                  >Per Hour</button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayModeManualOverride(true); setPayMode("perMile");
                      if (routeCalc) { const km = routeCalc.legs.filter(l => !l.isDeadhead).reduce((s, l) => s + l.distanceKm, 0); setShowLocalAlert(km / 1.609344 < 50 && km > 0); }
                    }}
                    className={`px-3 flex items-center justify-center h-8 transition-colors border-l border-slate-200 ${payMode === "perMile" ? "bg-orange-400 text-white" : "bg-white text-slate-500 hover:bg-orange-50"}`}
                  >Per {dLabel === "mi" ? "Mile" : "KM"}</button>
                </div>
                {/* Breakdown toggle */}
                {routeCalc && routeCalc.legs && routeCalc.legs.length > 0 && (
                  <button
                    type="button"
                    data-testid="button-toggle-breakdown"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-md px-2 h-8 transition-colors"
                    onClick={() => setShowBreakdown((prev) => !prev)}
                  >
                    {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Breakdown
                  </button>
                )}
                <div className="hidden sm:block w-px h-5 bg-slate-200" />
                {/* Dock time + Deadhead group */}
                <div className="flex items-center gap-x-4 gap-y-2 flex-wrap" data-testid="dock-deadhead-section">
                {/* Dock time */}
                <div className="flex items-center gap-2 h-8">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1 cursor-help">
                        Dock Time
                        <Info className="w-3 h-3 text-slate-300" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                      Total loading and unloading time per stop. Applied to all stops in this quote.
                    </TooltipContent>
                  </Tooltip>
                  <Input
                    data-testid="input-dock-time"
                    type="number"
                    step="0.5"
                    min="0"
                    className="h-8 text-xs w-[60px] text-center"
                    value={defaultDockMinutes / 60}
                    onChange={(e) => {
                      const hrs = parseFloat(e.target.value);
                      if (!isNaN(hrs) && hrs >= 0) setDefaultDockMinutes(Math.round(hrs * 60));
                    }}
                  />
                  <span className="text-xs text-slate-400">hrs</span>
                </div>
                <div className="hidden sm:block w-px h-5 bg-slate-200" />
                {/* Surcharge + Toll — next to Dock Time on mobile only */}
                <div className="flex sm:hidden items-center gap-2 h-8">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1 cursor-help">
                        Surcharge
                        <Info className="w-3 h-3 text-slate-300" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                      <p>% adds a percentage surcharge to the base cost (e.g. hazmat, regulatory). Industry standard is 5–15%.</p>
                      <p className="mt-1">The $/km (or $/mi) field estimates toll costs. Average toll for tractor-trailers: ~$0.25–$0.40/km on major toll highways (e.g. 407 ETR, ON-400 series), ~$0.15–$0.25/mi on US toll roads.</p>
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex items-center rounded-md border border-slate-200 overflow-hidden h-8">
                    <Input type="number" min="0" max="100" step="0.5" className="h-8 text-xs border-0 shadow-none rounded-none w-[50px] text-center focus-visible:ring-0 px-0" placeholder="0" value={accessorials.costInflationPct || ""} onChange={(e) => setAccessorials((p) => ({ ...p, costInflationPct: parseFloat(e.target.value) || 0 }))} data-testid="input-surcharge-pct" />
                    <span className="text-[10px] text-slate-400 px-1 border-l border-slate-200 bg-slate-50 h-full flex items-center">%</span>
                  </div>
                  <div className="flex items-center rounded-md border border-slate-200 overflow-hidden h-8">
                    <span className="text-[10px] text-slate-400 px-1 border-r border-slate-200 bg-slate-50 h-full flex items-center">$</span>
                    <Input type="number" min="0" step="0.01" className="h-8 text-xs border-0 shadow-none rounded-none w-[50px] text-center focus-visible:ring-0 px-0" placeholder="0" value={accessorials.tollRatePerKm || ""} onChange={(e) => setAccessorials((p) => ({ ...p, tollRatePerKm: parseFloat(e.target.value) || 0 }))} data-testid="input-toll-rate" />
                    <span className="text-[10px] text-slate-400 px-1 border-l border-slate-200 bg-slate-50 h-full flex items-center">/{measureUnit === "imperial" ? "mi" : "km"}</span>
                  </div>
                </div>
                {/* Deadhead toggle + Yard selector */}
                <div className="flex items-center gap-2 h-8">
                  <Switch
                    data-testid="switch-include-return"
                    checked={includeReturn}
                    onCheckedChange={setIncludeReturn}
                    className="scale-75"
                    disabled={!effectiveYard}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`text-xs flex items-center gap-1 cursor-help ${effectiveYard ? "text-slate-500" : "text-slate-300"}`}>
                        Deadhead
                        <Info className="w-3 h-3 text-slate-300" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                      Empty return trip from final stop back to your yard. Select a yard to enable.
                    </TooltipContent>
                  </Tooltip>
                  <Select value={selectedYardId} onValueChange={setSelectedYardId}>
                    <SelectTrigger data-testid="select-yard" className="h-8 py-0 text-xs w-[120px] sm:w-[140px]">
                      <SelectValue placeholder="Select yard" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {yards.map((y) => (
                        <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                </div>{/* end dock-deadhead-section */}
                <div className="hidden sm:block w-px h-5 bg-slate-200" />
                {/* Surcharge + Toll — desktop position (after deadhead) */}
                <div className="hidden sm:flex items-center gap-2 h-8">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1 cursor-help">
                        Surcharge
                        <Info className="w-3 h-3 text-slate-300" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                      <p>% adds a percentage surcharge to the base cost (e.g. hazmat, regulatory). Industry standard is 5–15%.</p>
                      <p className="mt-1">The $/km (or $/mi) field estimates toll costs. Average toll for tractor-trailers: ~$0.25–$0.40/km on major toll highways (e.g. 407 ETR, ON-400 series), ~$0.15–$0.25/mi on US toll roads.</p>
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex items-center rounded-md border border-slate-200 overflow-hidden h-8">
                    <Input type="number" min="0" max="100" step="0.5" className="h-8 text-xs border-0 shadow-none rounded-none w-[50px] text-center focus-visible:ring-0 px-0" placeholder="0" value={accessorials.costInflationPct || ""} onChange={(e) => setAccessorials((p) => ({ ...p, costInflationPct: parseFloat(e.target.value) || 0 }))} data-testid="input-surcharge-pct-desktop" />
                    <span className="text-[10px] text-slate-400 px-1 border-l border-slate-200 bg-slate-50 h-full flex items-center">%</span>
                  </div>
                  <div className="flex items-center rounded-md border border-slate-200 overflow-hidden h-8">
                    <span className="text-[10px] text-slate-400 px-1 border-r border-slate-200 bg-slate-50 h-full flex items-center">$</span>
                    <Input type="number" min="0" step="0.01" className="h-8 text-xs border-0 shadow-none rounded-none w-[50px] text-center focus-visible:ring-0 px-0" placeholder="0" value={accessorials.tollRatePerKm || ""} onChange={(e) => setAccessorials((p) => ({ ...p, tollRatePerKm: parseFloat(e.target.value) || 0 }))} data-testid="input-toll-rate-desktop" />
                    <span className="text-[10px] text-slate-400 px-1 border-l border-slate-200 bg-slate-50 h-full flex items-center">/{measureUnit === "imperial" ? "mi" : "km"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── ROW 2: CHARGES — accessorial pass-throughs ── */}
            <div className="space-y-2" data-testid="charges-section">
              <div className="flex items-center gap-2">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest shrink-0">Charges</h4>
                <button
                  type="button"
                  className="sm:hidden text-xs text-orange-500 hover:text-orange-600 flex items-center gap-1 shrink-0"
                  onClick={() => setShowMobileCharges((v) => !v)}
                >
                  {showMobileCharges ? "Hide" : "Show"}
                  {showMobileCharges ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <div className="flex-1 border-t border-slate-100" />
                {accessorialTotal > 0 && <span className="text-xs font-semibold text-orange-600 shrink-0">+{formatCurrency(accessorialTotal)}</span>}
                <a href="#/profiles?tab=company" className="text-xs text-orange-500 underline underline-offset-2 hover:text-orange-600 shrink-0" data-testid="link-adjust-defaults">Adjust Defaults</a>
              </div>
              <div className={`grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 ${showMobileCharges ? "" : "hidden sm:grid"}`}>
                {/* Detention */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    Detention
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Wait time charged when loading or unloading exceeds the allotted free time window.</TooltipContent>
                    </Tooltip>
                    <span className="text-[10px] font-normal text-slate-400 ml-0.5">{formatCurrency(accessorials.detentionRate)}/hr</span>
                  </div>
                  <Input type="number" min="0" step="0.5" className="h-8 text-xs text-center" placeholder="hours" value={accessorials.detentionHours || ""} onChange={(e) => setAccessorials((p) => ({ ...p, detentionHours: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Extra Stops */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    Stops
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Additional stop-off fee for multi-drop or multi-pickup loads beyond the standard origin/destination.</TooltipContent>
                    </Tooltip>
                    <span className="text-[10px] font-normal text-slate-400 ml-0.5">{formatCurrency(accessorials.stopOffRate)}/stop</span>
                  </div>
                  <Input type="number" min="0" step="1" className="h-8 text-xs text-center" placeholder="# stops" value={accessorials.stopOffCount || ""} onChange={(e) => setAccessorials((p) => ({ ...p, stopOffCount: parseInt(e.target.value) || 0 }))} />
                </div>
                {/* Lumper */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    Lumper
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Third-party labor fee for loading or unloading freight at warehouse facilities.</TooltipContent>
                    </Tooltip>
                  </div>
                  <Input type="number" min="0" step="10" className="h-8 text-xs text-center"  placeholder="$0" value={accessorials.lumperFee || ""} onChange={(e) => setAccessorials((p) => ({ ...p, lumperFee: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Border */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    Border
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Customs brokerage and border crossing fees for cross-border shipments (US/Canada).</TooltipContent>
                    </Tooltip>
                  </div>
                  <Input type="number" min="0" step="25" className="h-8 text-xs text-center"  placeholder="$0" value={accessorials.borderCrossing || ""} onChange={(e) => setAccessorials((p) => ({ ...p, borderCrossing: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* TONU */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    TONU
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Truck Ordered Not Used. Compensation when a load is cancelled after the carrier has dispatched.</TooltipContent>
                    </Tooltip>
                  </div>
                  <Input type="number" min="0" step="50" className="h-8 text-xs text-center"  placeholder="$0" value={accessorials.tonu || ""} onChange={(e) => setAccessorials((p) => ({ ...p, tonu: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Tailgate */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    Tailgate
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-slate-300 cursor-help" /></TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-xs">Liftgate/tailgate fee for deliveries requiring hydraulic lift for loading or unloading.</TooltipContent>
                    </Tooltip>
                  </div>
                  <Input type="number" min="0" step="25" className="h-8 text-xs text-center"  placeholder="$0" value={accessorials.tailgateFee || ""} onChange={(e) => setAccessorials((p) => ({ ...p, tailgateFee: parseFloat(e.target.value) || 0 }))} />
                </div>
                {/* Other (custom) */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <span className="shrink-0">Other:</span>
                    <input type="text" className="flex-1 min-w-0 bg-transparent text-[10px] font-normal text-slate-400 outline-none placeholder:text-slate-300 border-b border-slate-200" placeholder="" value={accessorials.customAccessorialLabel} onChange={(e) => setAccessorials((p) => ({ ...p, customAccessorialLabel: e.target.value }))} />
                  </div>
                  <Input type="number" min="0" step="10" className="h-8 text-xs text-center" placeholder="$0" value={accessorials.customAccessorialAmount || ""} onChange={(e) => setAccessorials((p) => ({ ...p, customAccessorialAmount: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>

            {/* ── BREAKDOWN: collapsed by default, toggled from header ── */}
            {routeCalc && routeCalc.legs && routeCalc.legs.length > 0 && showBreakdown && (
              <div className="space-y-2 pt-1" data-testid="leg-breakdown">
                {routeCalc.legs.map((leg, i) => {
                  const isLocal = leg.isLocal ?? leg.distanceKm < 100;
                  const isDeadhead = leg.isDeadhead ?? leg.type === "deadhead";
                  const billableHrs = leg.totalBillableHours ?? ((leg.driveMinutes + (isDeadhead ? 0 : leg.dockMinutes)) / 60);
                  return (
                    <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 space-y-2" data-testid={`leg-card-${i}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          {isDeadhead
                            ? `Deadhead Return \u00B7 ${leg.from} \u2192 ${leg.to}`
                            : `Leg ${routeCalc.legs.filter((l, j) => j < i && !(l.isDeadhead ?? l.type === "deadhead")).length + 1} \u00B7 ${leg.from} \u2192 ${leg.to} (est.)`}
                        </span>
                        {!isDeadhead && (
                          <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">
                            {isLocal ? "Local" : "Long Dist."}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        {/* Drive time row — interactive adjuster for non-deadhead legs */}
                        {(() => {
                          if (isDeadhead) {
                            return (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Drive time</span>
                                <span>{`${Math.floor(leg.driveMinutes / 60)}h ${String(Math.round(leg.driveMinutes % 60)).padStart(2, "0")}m`}</span>
                              </div>
                            );
                          }
                          // Map this leg to the corresponding formStop index (leg N → formStops[N])
                          const nonDeadheadLegNum = routeCalc.legs.filter((l, j) => j < i && !(l.isDeadhead ?? l.type === "deadhead")).length + 1;
                          const fIdx = nonDeadheadLegNum;
                          const driveAdj = formStops[fIdx]?.driveMinutesAdjustment ?? 0;
                          const adjH = Math.floor(leg.driveMinutes / 60);
                          const adjM = Math.round(leg.driveMinutes % 60);
                          return (
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground flex items-center gap-1 shrink-0">
                                Drive time
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-3 h-3 text-slate-400 cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                                    Google Maps may show longer times due to real-time traffic. Cost calculations use traffic-free estimates. Use − / + to adjust.
                                  </TooltipContent>
                                </Tooltip>
                              </span>
                              <span className="flex items-center gap-1 select-none">
                                {driveAdj !== 0 && (
                                  <button
                                    type="button"
                                    aria-label="Reset to Google estimate"
                                    className="text-[10px] text-muted-foreground hover:text-foreground underline"
                                    onClick={() => handleResetDriveTime(fIdx)}
                                  >
                                    reset
                                  </button>
                                )}
                                {driveAdj !== 0 && (
                                  <span className={`text-[10px] ${driveAdj > 0 ? "text-amber-600" : "text-blue-500"}`}>
                                    {driveAdj > 0 ? "+" : ""}{driveAdj}m
                                  </span>
                                )}
                                <button
                                  type="button"
                                  aria-label="Decrease drive time by 30 minutes"
                                  disabled={leg.driveMinutes <= 30}
                                  className="w-5 h-5 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                                  onClick={() => handleAdjustDriveTime(fIdx, -30)}
                                >
                                  −
                                </button>
                                <span className="tabular-nums font-medium min-w-[52px] text-center">
                                  {adjH}h {String(adjM).padStart(2, "0")}m
                                </span>
                                <button
                                  type="button"
                                  aria-label="Increase drive time by 30 minutes"
                                  className="w-5 h-5 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground text-base leading-none"
                                  onClick={() => handleAdjustDriveTime(fIdx, +30)}
                                >
                                  +
                                </button>
                              </span>
                            </div>
                          );
                        })()}
                        {!isDeadhead && (() => {
                          const nonDeadheadLegNumDock = routeCalc.legs.filter((l, j) => j < i && !(l.isDeadhead ?? l.type === "deadhead")).length + 1;
                          const dIdx = nonDeadheadLegNumDock;
                          const currentDock = formStops[dIdx]?.dockMinutes ?? defaultDockMinutes;
                          const dockDelta = currentDock - defaultDockMinutes;
                          const dockH = Math.floor(currentDock / 60);
                          const dockM = Math.round(currentDock % 60);
                          return (
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground shrink-0">Dock Time</span>
                              <span className="flex items-center gap-1 select-none">
                                {dockDelta !== 0 && (
                                  <button
                                    type="button"
                                    aria-label="Reset dock time to default"
                                    className="text-[10px] text-muted-foreground hover:text-foreground underline"
                                    onClick={() => handleResetDockTime(dIdx)}
                                  >
                                    reset
                                  </button>
                                )}
                                {dockDelta !== 0 && (
                                  <span className={`text-[10px] ${dockDelta > 0 ? "text-amber-600" : "text-blue-500"}`}>
                                    {dockDelta > 0 ? "+" : ""}{dockDelta}m
                                  </span>
                                )}
                                <button
                                  type="button"
                                  aria-label="Decrease dock time by 30 minutes"
                                  disabled={currentDock <= 0}
                                  className="w-5 h-5 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed text-base leading-none"
                                  onClick={() => handleAdjustDockTime(dIdx, -30)}
                                >
                                  −
                                </button>
                                <span className="tabular-nums font-medium min-w-[52px] text-center">
                                  {dockH}h {String(dockM).padStart(2, "0")}m
                                </span>
                                <button
                                  type="button"
                                  aria-label="Increase dock time by 30 minutes"
                                  className="w-5 h-5 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground text-base leading-none"
                                  onClick={() => handleAdjustDockTime(dIdx, +30)}
                                >
                                  +
                                </button>
                              </span>
                            </div>
                          );
                        })()}
                        <div className="flex justify-between font-medium">
                          <span>Total billable hrs</span>
                          <span>{billableHrs.toFixed(2)} hrs</span>
                        </div>
                        <Separator className="my-1" />
                        {/* Fixed cost */}
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-muted-foreground shrink-0">Fixed Cost</span>
                          <span className="text-xs text-muted-foreground text-right flex-1">
                            {billableHrs.toFixed(2)} hrs &times; {formatCurrency(routeCalc.fixedCostPerHour)}/hr
                          </span>
                          <span className="font-medium shrink-0 tabular-nums">{formatCurrency(leg.fixedCost)}</span>
                        </div>
                        {/* Driver cost — per-mile/km or per-hour */}
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-muted-foreground shrink-0">
                            Driver Cost{routeCalc.payMode === "perMile" ? ` (per ${dLabel})` : ""}
                            {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` @ ${routeCalc.deadheadPayPercent}%` : ""}
                          </span>
                          <span className="text-xs text-muted-foreground text-right flex-1">
                            {routeCalc.payMode === "perMile" ? (
                              <>
                                {displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel} &times; {formatCurrency(measureUnit === "imperial" ? routeCalc.driverPayPerMile : routeCalc.driverPayPerMile / 1.609344)}/{dLabel}
                                {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` × ${routeCalc.deadheadPayPercent}%` : ""}
                              </>
                            ) : (
                              <>
                                {billableHrs.toFixed(2)} hrs &times; {formatCurrency(routeCalc.allInHourlyRate - routeCalc.fixedCostPerHour)}/hr
                                {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` × ${routeCalc.deadheadPayPercent}%` : ""}
                              </>
                            )}
                          </span>
                          <span className="font-medium shrink-0 tabular-nums">{formatCurrency(leg.driverCost)}</span>
                        </div>
                        {/* Fuel cost */}
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-muted-foreground shrink-0">
                            Fuel Cost ({displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel})
                          </span>
                          <span className="text-xs text-muted-foreground text-right flex-1">
                            {displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel} &times;{" "}
                            {formatCurrency(measureUnit === "imperial" ? routeCalc.fuelPerKm * 1.609344 : routeCalc.fuelPerKm)}/{dLabel}
                          </span>
                          <span className="font-medium shrink-0 tabular-nums">{formatCurrency(leg.fuelCost)}</span>
                        </div>
                      </div>
                      <div
                        className="flex justify-between items-center rounded-md px-3 py-2 -mx-1"
                        style={{ backgroundColor: "rgba(234, 88, 12, 0.08)" }}
                      >
                        <span className="text-sm font-bold text-slate-800">{isDeadhead ? "Deadhead Total w/ Fuel" : "Total w/ Fuel"}</span>
                        <span className="text-sm font-bold text-orange-600 tabular-nums">
                          {formatCurrency(leg.legCost)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── IFTA Fuel Tax Breakdown ── */}
            {iftaResult && canUseIFTA(user) && showBreakdown && (
              <div className="rounded-lg border border-slate-200 px-4 py-3 space-y-2" data-testid="ifta-section">
                <button
                  type="button"
                  className="flex items-center justify-between w-full group"
                  onClick={() => setShowIFTA((prev) => !prev)}
                  data-testid="ifta-toggle"
                >
                  <div className="flex items-center gap-2">
                    <Receipt className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Fuel Tax (IFTA)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(iftaResult.totalTaxUSD)}
                    </span>
                    {showIFTA ? (
                      <ChevronUp className="w-3 h-3 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    )}
                  </div>
                </button>

                {showIFTA && (
                  <div className="space-y-1 pt-1">
                    {iftaResult.jurisdictions.map((j) => (
                      <div
                        key={j.code}
                        className="flex items-center justify-between text-sm"
                        data-testid={`ifta-row-${j.code}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">
                            {j.name} ({j.code})
                          </span>
                          <span className="text-xs text-slate-400 tabular-nums">
                            {(measureUnit === "imperial" ? j.distanceMiles : j.distanceKm).toFixed(0)} {dLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {j.note && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-slate-400 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[220px] text-xs">
                                {j.note}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <span className="font-medium tabular-nums">
                            {formatCurrency(j.taxUSD)}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-slate-400 pt-1 border-t border-slate-100">
                      Rates as of {iftaResult.quarter} ({iftaResult.effectiveDate})
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* IFTA upsell for free tier */}
            {iftaResult && !canUseIFTA(user) && showBreakdown && (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 flex items-center gap-2 flex-nowrap" data-testid="ifta-upsell">
                <Receipt className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                <span className="text-xs text-slate-400 flex-1">
                  Fuel Tax (IFTA) breakdown
                </span>
                <a
                  href="#/settings?tab=billing"
                  className="text-xs font-medium text-orange-500 hover:text-orange-600 shrink-0 whitespace-nowrap"
                >
                  Upgrade to Pro
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2 + 3: Chatbot (left) + Map & Build Route (right)
          ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 lg:auto-rows-fr">
          {/* ── Left: Route Chat ─────────────────────────────────── */}
          <Card className="border-slate-200 flex flex-col" data-testid="chat-panel">
            <CardHeader className="px-3 sm:px-4 pt-2 sm:pt-4 pb-1 sm:pb-2 shrink-0">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                Route Chat
                <button
                  type="button"
                  className="sm:hidden text-xs text-orange-500 hover:text-orange-600 flex items-center gap-1 font-medium normal-case tracking-normal"
                  onClick={() => setChatMinimized((v) => !v)}
                >
                  {chatMinimized ? "Expand" : "Minimize"}
                  {chatMinimized ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className={`px-3 sm:px-4 pb-3 sm:pb-4 pt-0 flex flex-col flex-1 min-h-0 space-y-2 sm:space-y-3 ${chatMinimized ? "hidden sm:flex" : ""}`}>
              {/* Chat messages — stretches to match right column height */}
              <div
                className="space-y-2 flex-1 min-h-[60px] sm:min-h-[80px] max-h-[160px] sm:max-h-none overflow-y-auto"
                data-testid="chat-messages"
              >
                {chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-sm rounded-lg px-3 py-2 max-w-[85%] leading-relaxed whitespace-pre-wrap ${
                      msg.role === "bot"
                        ? "bg-slate-100 text-slate-700"
                        : "bg-orange-400 text-white ml-auto"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}
                {chatRouteMutation.isPending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground px-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Thinking...
                  </div>
                )}
              </div>

              {/* Quick route chips */}
              <div className="flex flex-wrap gap-2 shrink-0">
                {quickRoutes.map((route) => (
                  <Button
                    key={route}
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 sm:h-8 px-2"
                    data-testid={`chip-${route.replace(/\s+/g, "-").toLowerCase()}`}
                    onClick={() => {
                      setChatMessage(route);
                      sendChat(route);
                    }}
                  >
                    {route}
                  </Button>
                ))}
              </div>

              {/* Chat input */}
              <div className="flex gap-2 sm:gap-2 shrink-0 items-center">
                <input
                  type="text"
                  data-testid="chat-input"
                  placeholder='e.g. "Toronto to Montreal"'
                  className="flex-1 text-xs sm:text-sm rounded-md border border-slate-200 bg-white px-3 sm:px-3 h-8 sm:h-9 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent placeholder:text-slate-400"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendChat(chatMessage);
                    }
                  }}
                />
                <Button
                  data-testid="button-send-chat"
                  disabled={!chatMessage.trim() || chatRouteMutation.isPending}
                  onClick={() => sendChat(chatMessage)}
                  className="shrink-0 bg-orange-400 hover:bg-orange-500 text-white px-4 sm:px-5 h-8 sm:h-9 text-xs sm:text-sm"
                >
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Right: Map + Build Route Form ────────────────────── */}
          <div className="space-y-2 flex flex-col">
            {/* Map */}
            <Card className="border-slate-200 overflow-hidden flex-1">
              <CardHeader className="px-3 sm:px-4 pt-2 sm:pt-3 pb-1">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  Route Map
                  <span className="text-[10px] font-normal text-slate-400">
                    via Google Maps
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-1.5 max-h-[180px] sm:max-h-none overflow-hidden">
                <RouteMapGoogle
                  stops={includeReturn ? stops : stops.filter(s => s.type !== "yard")}
                  fallbackCenter={effectiveYard?.address || effectiveYard?.name || user?.operatingCity}
                />
              </CardContent>
            </Card>

            {/* Build Route Form */}
            <Card className="border-slate-200 shrink-0">
              <CardHeader className="px-3 sm:px-4 pt-2 sm:pt-3 pb-1 sm:pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  Build Route
                  <span className="text-[10px] font-normal text-slate-400">
                    &mdash; or use chat
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-4 pb-2 sm:pb-3 pt-0 space-y-2">
                {/* Unified stops list with drag-and-drop */}
                {formStops.map((stop, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === formStops.length - 1;
                  const stopLabel = isFirst
                    ? "Origin"
                    : isLast
                      ? "Destination"
                      : `Stop ${idx}`;
                  const isDragging = dragIdx === idx;
                  const isDragOver = dragOverIdx === idx;

                  return (
                    <Fragment key={stop.id}>
                    {null /* Drive time adjustors are shown in Breakdown only */}
                    <div
                      className={`rounded-md transition-all ${
                        isDragging ? "opacity-30 scale-[0.98]" : ""
                      } ${isDragOver ? "ring-2 ring-orange-400/50 bg-orange-50/50" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverIdx(idx);
                      }}
                      onDragLeave={() => setDragOverIdx(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIdx != null && dragIdx !== idx) {
                          setFormStops((prev) => {
                            const copy = [...prev];
                            const [moved] = copy.splice(dragIdx, 1);
                            copy.splice(idx, 0, moved);
                            // Auto-build after reorder
                            setTimeout(() => {
                              const current = formStopsRef.current;
                              if (current.filter((s) => s.location.trim()).length >= 2) {
                                void triggerRouteBuild(current, false);
                              }
                            }, 50);
                            return copy;
                          });
                        }
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                    >
                      <Label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {stopLabel}
                      </Label>
                      <div className="flex items-center gap-2">
                        {/* Drag handle — only this element is draggable */}
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDragIdx(idx);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 rounded-md p-1 hover:bg-slate-100 transition-colors"
                          data-testid={`drag-handle-${idx}`}
                          title="Drag to reorder"
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>

                        {/* Location input — Google suggestions + shared geo cache */}
                        <div className="flex-1 min-w-0">
                          <LocationSuggestInput
                            data-testid={`input-stop-${idx}`}
                            leadingIcon={false}
                            inputClassName="text-sm h-9"
                            placeholder={
                              isFirst
                                ? "e.g. Mississauga"
                                : isLast
                                  ? "e.g. Scarborough"
                                  : "Location"
                            }
                            value={stop.location}
                            onChange={(v) => {
                              setFormStops((prev) =>
                                prev.map((s, i) => (i === idx ? { ...s, location: v } : s)),
                              );
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                const current = formStopsRef.current;
                                if (current.filter((s) => s.location.trim()).length >= 2) {
                                  void triggerRouteBuild(current, false);
                                }
                              }, 0);
                            }}
                          />
                        </div>

                        {/* Remove button — always visible on every stop */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-slate-300 hover:text-red-500 shrink-0"
                          data-testid={`button-remove-stop-${idx}`}
                          onClick={() => {
                            setFormStops((prev) => {
                              let updated = prev.filter((_, i) => i !== idx);
                              // Always keep at least 2 stops (origin + destination)
                              while (updated.length < 2) {
                                updated.push({ id: nextStopId(), location: "", dockMinutes: defaultDockMinutes });
                              }
                              // Auto-build after removing a stop
                              setTimeout(() => {
                                const current = formStopsRef.current;
                                if (current.filter((s) => s.location.trim()).length >= 2) {
                                  void triggerRouteBuild(current, false);
                                }
                              }, 50);
                              return updated;
                            });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    </Fragment>
                  );
                })}

                {/* Add Stop — inserts after the last (destination) stop */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  data-testid="button-add-stop"
                  onClick={() => {
                    setFormStops((prev) => [
                      ...prev,
                      {
                        id: nextStopId(),
                        location: "",
                        dockMinutes: defaultDockMinutes,
                      },
                    ]);
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Stop
                </Button>

                {/* Auto-building indicator (route builds automatically on input/drag/remove) */}
                {(isGeocodingRoute || isCalculating) && (
                  <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Calculating route…
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>


      {/* PDF Share Dialog */}
      {lastSavedQuote && (
        <QuoteShareDialog
          open={pdfDialogOpen}
          onOpenChange={setPdfDialogOpen}
          quote={lastSavedQuote}
        />
      )}

      {/* Upgrade Dialog */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title={upgradeReason.title}
        description={upgradeReason.description}
      />
    </>
  );
}
