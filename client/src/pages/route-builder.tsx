import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { geocodeLocation, getOSRMRoute } from "@/lib/geo";
import { calculateRouteCost, getPricingAdvice } from "@/lib/routeCalc";
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
import {
  MapPin,
  Plus,
  Trash2,
  Route,
  MessageSquare,
  DollarSign,
  Clock,
  Fuel,
  Send,
  Loader2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  GripVertical,
} from "lucide-react";
import type { CostProfile, Yard, RouteStop, Quote } from "@shared/schema";
import type { RouteBuilderSnapshot } from "@/lib/routeBuilderSnapshot";
import { RouteMapGoogle } from "@/components/RouteMapGoogle";
import {
  currencyPerLitreLabel,
  currencySymbol,
  formatCurrencyAmount,
  resolveWorkspaceCurrency,
} from "@/lib/currency";

let stopIdCounter = 0;
function nextStopId(): string {
  return `stop-${Date.now()}-${++stopIdCounter}`;
}

function marginQualityLabel(percent: number): { label: string; color: string } {
  if (percent < 10) return { label: "Low", color: "text-red-600" };
  if (percent < 25) return { label: "Fair", color: "text-yellow-600" };
  if (percent < 50) return { label: "Good", color: "text-green-600" };
  if (percent < 75) return { label: "Great", color: "text-green-600 font-semibold" };
  return { label: "Outstanding", color: "text-green-700 font-bold" };
}

// ── Geocode (client-side) ────────────────────────────────────────────

const geocodeCache = new Map<string, { lat: number; lng: number }>();

async function geocodeViaBackend(
  location: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  const coords = await geocodeLocation(location);
  if (coords) {
    geocodeCache.set(key, coords);
    return coords;
  }
  return null;
}

async function getDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  return getOSRMRoute(fromLat, fromLng, toLat, toLng);
}

// ── Types ──────────────────────────────────────────────────────────

type LegBreakdown = {
  from: string;
  to: string;
  type?: string;
  isLocal?: boolean;
  distanceKm: number;
  driveMinutes: number;
  dockMinutes: number;
  totalBillableHours: number;
  laborCost: number;
  fuelCost: number;
  legCost: number;
  isDeadhead?: boolean;
};

type RouteCalculation = {
  legs: LegBreakdown[];
  totalDistanceKm: number;
  totalDriveMinutes: number;
  totalDockMinutes: number;
  totalHours: number;
  allInHourlyRate: number;
  fixedCostPerHour: number;
  fuelPerKm: number;
  deliveryCost: number;
  deadheadCost: number;
  fullTripCost: number;
};

type PricingTier = {
  label: string;
  percent: number;
  price: number;
};

type PricingAdvice = {
  totalCost: number;
  tiers: (PricingTier & { marginAmount: number })[];
  customPercent?: { label: string; percent: number; price: number; marginAmount: number } | null;
  customQuote?: { label: string; quoteAmount: number; marginPercent: number; marginAmount: number } | null;
};

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
    chatUserMessage?: string;
  },
): Promise<Quote> {
  const nonYard = stops.filter((s) => s.type !== "yard");
  const origin = nonYard[0]?.location ?? stops[0]?.location ?? "";
  const destination =
    nonYard[nonYard.length - 1]?.location ?? stops[stops.length - 1]?.location ?? "";
  const laborSum = meta.calc.legs.reduce((s, l) => s + l.laborCost, 0);
  const fuelSum = meta.calc.legs.reduce((s, l) => s + l.fuelCost, 0);
  const distMi = meta.calc.totalDistanceKm * 0.621371;
  const tier20 = meta.pricing.tiers[0];
  const snapshot: RouteBuilderSnapshot = {
    routeSummary: stops.map((s) => s.location).filter(Boolean).join(" \u2192 "),
    totalKm: meta.calc.totalDistanceKm,
    totalMin: meta.calc.totalDriveMinutes,
    returnKm: meta.calc.legs
      .filter((l) => l.type === "return")
      .reduce((s, l) => s + l.distanceKm, 0),
    includeReturn: meta.includeReturn,
    fuelPricePerLitre: meta.fuelPricePerLitre,
    yardLabel: meta.yardLabel,
    deliveryCost: meta.calc.deliveryCost,
    deadheadCost: meta.calc.deadheadCost,
    fullTripCost: meta.calc.fullTripCost,
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
    chatUserMessage: meta.chatUserMessage,
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
    totalCarrierCost: meta.calc.fullTripCost,
    marginType: "percentage",
    marginValue: tier20?.percent ?? 20,
    marginAmount: tier20?.marginAmount ?? 0,
    customerPrice: tier20?.price ?? meta.calc.fullTripCost,
    grossProfit: tier20?.marginAmount ?? 0,
    profitMarginPercent: tier20?.percent ?? 0,
    quoteSource: "route_builder",
    routeSnapshotJson: JSON.stringify(snapshot),
  });
}

// ── Main Component ─────────────────────────────────────────────────

export default function RouteBuilder() {
  const { toast } = useToast();

  // ── Controls ──────────────────────────────────────────────────

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedYardId, setSelectedYardId] = useState("none");
  const [includeReturn, setIncludeReturn] = useState(true);
  const [fuelPrice, setFuelPrice] = useState("1.65");

  // ── Build Route form ──────────────────────────────────────────

  type FormStop = { id: string; location: string; dockMinutes: number };
  const [formStops, setFormStops] = useState<FormStop[]>([
    { id: nextStopId(), location: "", dockMinutes: 30 },
    { id: nextStopId(), location: "", dockMinutes: 30 },
  ]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Convenience getters for origin/destination
  const origin = formStops[0]?.location ?? "";
  const destination = formStops[formStops.length - 1]?.location ?? "";

  // ── Stops (computed from form) ────────────────────────────────

  const [stops, setStops] = useState<RouteStop[]>([]);

  // ── Chat ──────────────────────────────────────────────────────

  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { role: "bot" | "user"; text: string }[]
  >([
    {
      role: "bot",
      text: 'Hi! Type a route below \u2014 e.g. "Mississauga to Kingston" \u2014 and I\'ll update the map, dropdowns, and cost estimate automatically.',
    },
  ]);

  // ── Calculation results ───────────────────────────────────────

  const [routeCalc, setRouteCalc] = useState<RouteCalculation | null>(null);
  const [pricingAdvice, setPricingAdvice] = useState<PricingAdvice | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [customQuoteAmount, setCustomQuoteAmount] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeocodingRoute, setIsGeocodingRoute] = useState(false);

  // ── Queries ───────────────────────────────────────────────────

  const { user } = useFirebaseAuth();
  const isAdmin = user?.role === "admin";
  const scopeId = workspaceFirestoreId(user);
  const queryClient = useQueryClient();

  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );

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

  const selectedYard = useMemo(
    () => yards.find((y) => y.id === selectedYardId) ?? null,
    [yards, selectedYardId],
  );

  // If the user didn't pick a yard yet (selectedYardId === "none"),
  // use the city from onboarding signup as a lightweight "yard" source.
  const cityYard = useMemo(() => {
    if (selectedYardId !== "none") return null;
    const city = user?.operatingCity?.trim();
    if (!city) return null;
    return {
      id: "__city__",
      name: city,
      address: city,
      isDefault: true,
    } as Yard;
  }, [selectedYardId, user?.operatingCity]);

  const effectiveYard = selectedYard ?? cityYard;

  // Auto-select first profile
  useEffect(() => {
    if (profiles.length > 0 && !selectedProfileId) {
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

  // ── Build stops from form values ──────────────────────────────

  const buildStopsFromForm = useCallback(
    async (
      fStops: FormStop[],
      yard: Yard | null,
      doReturn: boolean,
    ): Promise<RouteStop[]> => {
      const locations: { name: string; type: RouteStop["type"]; dockMinutes: number }[] = [];

      if (yard) {
        locations.push({ name: yard.address || yard.name, type: "yard", dockMinutes: 0 });
      }

      for (let i = 0; i < fStops.length; i++) {
        const s = fStops[i];
        if (!s.location.trim()) continue;
        const type: RouteStop["type"] = i === 0 ? "pickup" : i === fStops.length - 1 ? "delivery" : "stop";
        locations.push({ name: s.location.trim(), type, dockMinutes: s.dockMinutes });
      }

      if (yard && doReturn) {
        locations.push({ name: yard.address || yard.name, type: "yard", dockMinutes: 0 });
      }

      if (locations.length < 2) return [];

      // Geocode all
      const geocoded = await Promise.all(
        locations.map(async (loc) => {
          const coords = await geocodeViaBackend(loc.name);
          return { ...loc, lat: coords?.lat, lng: coords?.lng };
        }),
      );

      // Get distances for consecutive pairs
      const result: RouteStop[] = [];
      for (let i = 0; i < geocoded.length; i++) {
        const g = geocoded[i];
        let distanceFromPrevKm = 0;
        let driveMinutesFromPrev = 0;

        if (i > 0) {
          const prev = geocoded[i - 1];
          if (
            prev.lat != null &&
            prev.lng != null &&
            g.lat != null &&
            g.lng != null
          ) {
            const dist = await getDistance(prev.lat, prev.lng, g.lat, g.lng);
            if (dist) {
              distanceFromPrevKm = dist.distanceKm;
              driveMinutesFromPrev = dist.durationMinutes;
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
      const built = await buildStopsFromForm(
        stopsToUse,
        effectiveYard,
        includeReturn,
      );
      setStops(built);
      if (built.length >= 2 && selectedProfileId) {
        await calculateRoute(built, undefined, {
          saveToHistory,
          chatUserMessage,
        });
      }
    } catch (err: any) {
      toast({
        title: "Route build error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsGeocodingRoute(false);
    }
  }

  // Debounced recalc when fuel price, return toggle, or profile changes
  useEffect(() => {
    if (stops.length < 2 || !selectedProfileId) return;
    if (calcTimerRef.current) clearTimeout(calcTimerRef.current);
    calcTimerRef.current = setTimeout(() => {
      calculateRoute(stops);
    }, 600);
    return () => {
      if (calcTimerRef.current) clearTimeout(calcTimerRef.current);
    };
  }, [selectedProfileId, fuelPrice, includeReturn]);

  // ── Calculate route ───────────────────────────────────────────

  async function calculateRoute(
    routeStops: RouteStop[],
    returnDistance?: { distanceKm: number; durationMinutes: number } | null,
    options?: { saveToHistory?: boolean; chatUserMessage?: string },
  ) {
    if (!selectedProfileId || routeStops.length < 2 || !scopeId) return;
    const fp = parseFloat(fuelPrice);
    if (isNaN(fp) || fp <= 0) return;

    setIsCalculating(true);
    try {
      const profile = await firebaseDb.getProfile(scopeId, selectedProfileId);
      if (!profile) throw new Error("Cost profile not found");

      const data = calculateRouteCost(
        profile,
        routeStops,
        includeReturn,
        fp,
        returnDistance?.distanceKm,
        returnDistance?.durationMinutes,
      ) as RouteCalculation;
      setRouteCalc(data);
      const customAmt = parseFloat(customQuoteAmount);
      const pricing = getPricingAdvice(
        data.fullTripCost,
        undefined,
        !isNaN(customAmt) && customAmt > 0 ? customAmt : undefined,
      ) as PricingAdvice;
      setPricingAdvice(pricing);

      if (options?.saveToHistory && data.fullTripCost > 0) {
        try {
          const quote = await persistRouteBuilderQuote(scopeId, profile, routeStops, {
            includeReturn,
            fuelPricePerLitre: fp,
            yardLabel: effectiveYard?.name ?? undefined,
            calc: data,
            pricing,
            customQuoteInput: customQuoteAmount,
            chatUserMessage: options.chatUserMessage,
          });
          queryClient.invalidateQueries({
            queryKey: ["firebase", "quotes", scopeId ?? ""],
          });
          toast({
            title: "Saved to history",
            description: `${quote.origin} \u2192 ${quote.destination}`,
          });
        } catch (histErr: unknown) {
          toast({
            title: "Could not save to history",
            description:
              histErr instanceof Error ? histErr.message : "Sign in to save quotes.",
            variant: "destructive",
          });
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

  // Refetch pricing when custom quote amount changes
  useEffect(() => {
    if (!routeCalc || routeCalc.fullTripCost <= 0) return;
    const timer = setTimeout(() => {
      fetchPricingAdvice(routeCalc.fullTripCost);
    }, 400);
    return () => clearTimeout(timer);
  }, [customQuoteAmount]);

  // ── Chat route mutation ───────────────────────────────────────

  function populateFormFromLocations(locations: string[]) {
    const newStops: FormStop[] = locations.map((loc) => ({
      id: nextStopId(),
      location: loc,
      dockMinutes: 30,
    }));
    setFormStops(newStops);
    return newStops;
  }

  const chatRouteMutation = useMutation({
    mutationFn: async (payload: { message: string; userMessage: string }) =>
      processChatRoute(payload.message),
    onSuccess: async (data: ChatRouteResult, variables) => {
      const userMessage = variables.userMessage;
      try {
        if (data.success && data.stops && data.stops.length > 0) {
          const parsed = data.stops as RouteStop[];
          const nonYard = parsed.filter((s) => s.type !== "yard");
          if (nonYard.length >= 1) {
            populateFormFromLocations(nonYard.map((s) => s.location));
          }

          const hasDistances = parsed.some((s) => (s.distanceFromPrevKm ?? 0) > 0);
          if (hasDistances) {
            let allStops = [...parsed];
            if (effectiveYard && !parsed.some((s) => s.type === "yard")) {
              const yardStop: RouteStop = {
                id: nextStopId(),
                type: "yard",
                location: effectiveYard.address || effectiveYard.name,
                lat: effectiveYard.lat ?? undefined,
                lng: effectiveYard.lng ?? undefined,
                dockTimeMinutes: 0,
                distanceFromPrevKm: 0,
                driveMinutesFromPrev: 0,
              };
              allStops = [yardStop, ...allStops];
              if (includeReturn) {
                allStops.push({ ...yardStop, id: nextStopId() });
              }
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
                  const coords = await geocodeViaBackend(s.location);
                  return {
                    ...s,
                    lat: coords?.lat,
                    lng: coords?.lng,
                  };
                })
              );
            }

            setStops(stopsForCalcAndMap);
            if (stopsForCalcAndMap.length >= 2 && selectedProfileId) {
              await calculateRoute(stopsForCalcAndMap, data.returnDistance ?? undefined, {
                saveToHistory: true,
                chatUserMessage: userMessage,
              });
            }
          } else {
            const newStops = nonYard.map((s) => ({
              id: nextStopId(),
              location: s.location,
              dockMinutes: s.dockTimeMinutes ?? 30,
            }));
            await triggerRouteBuild(newStops, true, userMessage);
          }

          setChatHistory((prev) => [
            ...prev,
            { role: "bot", text: data.message },
          ]);
          setChatMessage("");
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

  // ── Quick route chips ─────────────────────────────────────────

  const quickRoutes = [
    "Mississauga to Toronto",
    "Brampton to Kingston",
    "Toronto to Hamilton, London",
    "Ottawa to Sudbury, Thunder Bay",
  ];

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

  // ── Route summary line ────────────────────────────────────────

  const routeSummaryText = useMemo(() => {
    if (stops.length < 2) return null;
    const names = stops.map((s) => s.location).filter(Boolean);
    return names.join(" \u2192 ");
  }, [stops]);

  const routeSummaryStats = useMemo(() => {
    if (!routeCalc) return null;
    const totalKm = routeCalc.totalDistanceKm;
    const totalMin = routeCalc.totalDriveMinutes;
    const returnKm =
      routeCalc.legs
        ?.filter((l) => l.type === "return")
        .reduce((sum, l) => sum + l.distanceKm, 0) ?? 0;
    return { totalKm, totalMin, returnKm };
  }, [routeCalc]);

  // ── Derived pricing values (client-side fallbacks) ────────────

  const deliveryCost = routeCalc?.deliveryCost ?? 0;
  const deadheadCost = routeCalc?.deadheadCost ?? 0;
  const fullTripCost = routeCalc?.fullTripCost ?? 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4" data-testid="route-builder-page">
      {/* ── Section 0: Controls Bar ────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1 min-w-[180px]">
          <Label className="text-xs text-muted-foreground">Cost Profile</Label>
          <Select
            value={selectedProfileId}
            onValueChange={setSelectedProfileId}
          >
            <SelectTrigger data-testid="select-profile" className="h-9">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 min-w-[180px]">
          <Label className="text-xs text-muted-foreground">Yard</Label>
          <Select value={selectedYardId} onValueChange={setSelectedYardId}>
            <SelectTrigger data-testid="select-yard" className="h-9">
              <SelectValue placeholder={user?.operatingCity?.trim() || ""} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{user?.operatingCity?.trim() || ""}</SelectItem>
              {yards.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 w-[120px]">
          <Label className="text-xs text-muted-foreground">
            <Fuel className="w-3 h-3 inline mr-1" />
            Fuel {currencyPerLitreLabel(currency)}
          </Label>
          <Input
            data-testid="input-fuel-price"
            type="number"
            step="0.05"
            min="0"
            className="h-9"
            value={fuelPrice}
            onChange={(e) => setFuelPrice(e.target.value)}
          />
        </div>

        {effectiveYard && (
          <div className="flex items-center gap-2 pb-0.5">
            <Switch
              data-testid="switch-include-return"
              checked={includeReturn}
              onCheckedChange={setIncludeReturn}
            />
            <Label className="text-sm cursor-pointer">Include return</Label>
          </div>
        )}

        {isGeocodingRoute && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Calculating route...
          </div>
        )}
      </div>

      {/* ── Section 1: Route Summary Bar ───────────────────────── */}
      {routeSummaryText && routeCalc && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5"
          data-testid="route-summary-bar"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Route className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold truncate">
              {routeSummaryText}
            </span>
            {routeSummaryStats && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {routeSummaryStats.totalKm.toFixed(0)} km &middot;{" "}
                {routeSummaryStats.totalMin.toFixed(0)} min (est.)
                {routeSummaryStats.returnKm > 0 &&
                  ` + ${routeSummaryStats.returnKm.toFixed(0)} km return`}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs shrink-0"
            data-testid="button-toggle-breakdown"
            onClick={() => setShowBreakdown((p) => !p)}
          >
            {showBreakdown ? "Hide breakdown" : "Show breakdown"}
          </Button>
        </div>
      )}

      {/* ── Section 2: Pricing Row ─────────────────────────────── */}
      {routeCalc && fullTripCost > 0 && (
        <div
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
          data-testid="pricing-row"
        >
          {/* DELIVERY */}
          <div className="rounded-lg border border-border p-3 space-y-0.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Delivery
            </div>
            <div
              className="text-xl font-bold"
              style={{ color: "#ea580c" }}
              data-testid="pricing-delivery"
            >
              {formatCurrency(deliveryCost)}
            </div>
            <div className="text-[10px] text-muted-foreground">with fuel</div>
          </div>

          {/* FULL TRIP */}
          <div className="rounded-lg border border-border p-3 space-y-0.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Full Trip
            </div>
            <div
              className="text-xl font-bold"
              data-testid="pricing-full-trip"
            >
              {formatCurrency(fullTripCost)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              +{formatCurrency(deadheadCost)} deadhead
            </div>
          </div>

          {/* Margin Tiers */}
          {(pricingAdvice?.tiers || []).map((tier, i) => {
            const tierColors = [
              "#ea580c",
              "#16a34a",
              "#16a34a",
            ];
            return (
              <div
                key={tier.label}
                className="rounded-lg border border-border p-3 space-y-0.5"
                data-testid={`pricing-tier-${tier.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {tier.label}
                </div>
                <div
                  className="text-xl font-bold"
                  style={{ color: tierColors[i] || "#16a34a" }}
                >
                  {formatCurrency(tier.price)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  +{formatCurrency(tier.price - fullTripCost)}
                </div>
              </div>
            );
          })}

          {/* CUSTOM QUOTE */}
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Custom Quote
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">{currencySymbol(currency)}</span>
              <Input
                data-testid="input-custom-quote"
                type="number"
                step="1"
                placeholder="0"
                className="h-8 text-sm w-[80px]"
                value={customQuoteAmount}
                onChange={(e) => setCustomQuoteAmount(e.target.value)}
              />
            </div>
            {pricingAdvice?.customQuote ? (
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-bold">
                  {pricingAdvice.customQuote.marginPercent.toFixed(1)}%
                </span>
                <span
                  className={`text-xs ${marginQualityLabel(pricingAdvice.customQuote.marginPercent).color}`}
                >
                  {marginQualityLabel(pricingAdvice.customQuote.marginPercent).label}
                </span>
              </div>
            ) : customQuoteAmount && fullTripCost > 0 ? (
              (() => {
                const amt = parseFloat(customQuoteAmount);
                if (!isNaN(amt) && amt > 0) {
                  const pct = ((amt - fullTripCost) / fullTripCost) * 100;
                  const q = marginQualityLabel(pct);
                  return (
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-bold">
                        {pct.toFixed(1)}%
                      </span>
                      <span className={`text-xs ${q.color}`}>{q.label}</span>
                    </div>
                  );
                }
                return null;
              })()
            ) : null}
          </div>
        </div>
      )}

      {/* ── Section 3: Leg Breakdown (collapsible) ─────────────── */}
      {routeCalc && routeCalc.legs && routeCalc.legs.length > 0 && showBreakdown && (
        <div className="space-y-3" data-testid="leg-breakdown">
          {routeCalc.legs
            .filter((leg) => isAdmin || leg.type !== "return")
            .map((leg, i) => {
            const isLocal = leg.isLocal ?? leg.distanceKm < 100;
            const isDeadhead = leg.type === "return";
            const billableHrs = leg.totalBillableHours ?? ((leg.driveMinutes + (isDeadhead ? 0 : leg.dockMinutes)) / 60);
            return (
              <Card key={i} className="border-border" data-testid={`leg-card-${i}`}>
                <CardContent className="py-3 px-4 space-y-2">
                  {/* Leg header */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {isDeadhead
                        ? `Deadhead Return \u00B7 ${leg.from} \u2192 ${leg.to}`
                        : `Leg ${i + 1} \u00B7 ${leg.from} \u2192 ${leg.to} (est.)`}
                    </span>
                    {isLocal && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-blue-600 text-white border-0">
                        LOCAL
                      </Badge>
                    )}
                  </div>

                  {/* Details grid */}
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Drive time</span>
                      <span>{leg.driveMinutes} min</span>
                    </div>
                    {!isDeadhead && leg.dockMinutes > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Load + Unload
                        </span>
                        <span>{(leg.dockMinutes / 60).toFixed(0)} hrs</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium">
                      <span>Total billable hrs</span>
                      <span>{billableHrs.toFixed(2)} hrs</span>
                    </div>

                    <Separator className="my-1" />

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Labor (no fuel)
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {billableHrs.toFixed(2)} &times;{" "}
                          {formatCurrency(routeCalc.allInHourlyRate)}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(leg.laborCost)}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Fuel ({leg.distanceKm.toFixed(0)} km)
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {leg.distanceKm.toFixed(0)} km &times;{" "}
                          {formatCurrency(routeCalc.fuelPerKm)}/km
                        </span>
                        <span className="font-medium">
                          {formatCurrency(leg.fuelCost)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Total row */}
                  <div
                    className="flex justify-between items-center rounded px-3 py-1.5 -mx-1"
                    style={{ backgroundColor: "rgba(234, 88, 12, 0.08)" }}
                  >
                    <span className="text-sm font-bold">
                      {isDeadhead ? "Deadhead Total w/ Fuel" : "Total w/ Fuel"}
                    </span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: "#ea580c" }}
                    >
                      {formatCurrency(leg.legCost)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Section 4: Bottom — Chat (left) + Map & Form (right) ─ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Left: Route Chat ─────────────────────────────────── */}
        <Card className="border-border" data-testid="chat-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Route Chat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Chat messages */}
            <div
              className="space-y-2 min-h-[200px] max-h-[300px] overflow-y-auto"
              data-testid="chat-messages"
            >
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-lg px-3 py-2 max-w-[90%] ${
                    msg.role === "bot"
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground ml-auto"
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
            <div className="flex flex-wrap gap-1.5">
              {quickRoutes.map((route) => (
                <Button
                  key={route}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 px-2.5"
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
            <div className="flex gap-2">
              <Input
                data-testid="chat-input"
                placeholder='e.g. "Toronto to Hamilton, London, Windsor"'
                className="text-sm"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat(chatMessage);
                  }
                }}
              />
              <Button
                data-testid="button-send-chat"
                disabled={!chatMessage.trim() || chatRouteMutation.isPending}
                onClick={() => sendChat(chatMessage)}
                className="shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Right: Map + Build Route Form ────────────────────── */}
        <div className="space-y-4">
          {/* Map */}
          <Card className="border-border overflow-hidden">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                Route Map
                <span className="text-[10px] font-normal text-blue-500">
                  via Google Maps
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-1">
              <RouteMapGoogle
                stops={stops}
                fallbackCenter={effectiveYard?.address || effectiveYard?.name || user?.operatingCity}
              />
            </CardContent>
          </Card>

          {/* Build Route Form */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                Build Route
                <span className="text-[10px] font-normal text-muted-foreground">
                  &mdash; or use chat above
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                  <div
                    key={stop.id}
                    className={`space-y-1 rounded-md transition-all ${
                      isDragging ? "opacity-40" : ""
                    } ${isDragOver ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                    }}
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
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {stopLabel}
                    </Label>
                    <div className="flex items-center gap-1.5">
                      {/* Drag handle */}
                      <div
                        className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
                        data-testid={`drag-handle-${idx}`}
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {/* Location input */}
                      <Input
                        data-testid={`input-stop-${idx}`}
                        placeholder={
                          isFirst
                            ? "e.g. Mississauga"
                            : isLast
                              ? "e.g. Scarborough"
                              : "Location"
                        }
                        className="text-sm flex-1"
                        value={stop.location}
                        onChange={(e) => {
                          setFormStops((prev) =>
                            prev.map((s, i) =>
                              i === idx ? { ...s, location: e.target.value } : s,
                            ),
                          );
                        }}
                        onBlur={() => {
                          const filled = formStops.filter((s) => s.location.trim());
                          if (filled.length >= 2) triggerRouteBuild();
                        }}
                      />

                      {/* Dock time */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <Input
                          data-testid={`input-dock-${idx}`}
                          type="number"
                          min="0"
                          step="5"
                          className="text-sm h-9 w-[60px] text-center"
                          value={stop.dockMinutes}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setFormStops((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, dockMinutes: val } : s,
                              ),
                            );
                          }}
                          onBlur={() => {
                            const filled = formStops.filter((s) => s.location.trim());
                            if (filled.length >= 2) triggerRouteBuild();
                          }}
                        />
                        <span className="text-[10px] text-muted-foreground">min</span>
                      </div>

                      {/* Swap button (only on first row) */}
                      {isFirst && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 h-9 w-9 p-0"
                          data-testid="button-swap"
                          onClick={swapOriginDest}
                        >
                          <ArrowUpDown className="w-4 h-4" />
                        </Button>
                      )}

                      {/* Remove button (only for middle stops, and only if more than 2 stops) */}
                      {!isFirst && !isLast && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          data-testid={`button-remove-stop-${idx}`}
                          onClick={() => {
                            setFormStops((prev) =>
                              prev.filter((_, i) => i !== idx),
                            );
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add Stop — inserts before the last (destination) stop */}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                data-testid="button-add-stop"
                onClick={() => {
                  setFormStops((prev) => {
                    const copy = [...prev];
                    copy.splice(prev.length - 1, 0, {
                      id: nextStopId(),
                      location: "",
                      dockMinutes: 30,
                    });
                    return copy;
                  });
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Stop
              </Button>

              {/* Manual Build button */}
              {formStops.filter((s) => s.location.trim()).length >= 2 && (
                <Button
                  className="w-full"
                  data-testid="button-build-route"
                  disabled={isGeocodingRoute || isCalculating}
                  onClick={() => void triggerRouteBuild(undefined, true)}
                >
                  {isGeocodingRoute || isCalculating ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Route className="w-4 h-4 mr-1.5" />
                  )}
                  Build Route
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
