import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Truck,
  DollarSign,
  Calculator,
  Save,
  TrendingUp,
  Fuel,
  ArrowRight,
  Snowflake,
  Package,
  Layers,
  Clock,
  Plus,
  X,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import type { Lane, RateTable, HourlyRate } from "@shared/schema";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { LocationSuggestInput } from "@/components/LocationSuggestInput";
import { currencySymbol, formatCurrencyAmount, resolveWorkspaceCurrency } from "@/lib/currency";
import {
  kmToMiles,
  milesToKm,
  resolveMeasurementUnit,
  type MeasurementUnit,
} from "@/lib/measurement";

const TRUCK_TYPES = [
  { value: "dry_van", label: "Dry Van", icon: Package },
  { value: "reefer", label: "Reefer", icon: Snowflake },
  { value: "flatbed", label: "Flatbed", icon: Layers },
];

const DOCK_TIME_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
  { value: "90", label: "1.5 hr" },
  { value: "120", label: "2 hr" },
  { value: "180", label: "3 hr" },
];

function formatTime(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// === Per-mile / Fixed lane quote result ===
interface QuoteResult {
  carrierCost: number;
  fuelSurcharge: number;
  totalCarrierCost: number;
  marginAmount: number;
  customerPrice: number;
  grossProfit: number;
  profitMarginPercent: number;
  ratePerMile: number;
  fuelSurchargePercent: number;
  minCharge: number;
}

// === Local P&D result ===
interface LocalResult {
  driveTimeMinutes: number;
  dockTimeMinutes: number;
  returnTimeMinutes: number;
  totalMinutes: number;
  totalHours: number;
  oneWayKm: number;
  returnKm: number;
  totalKm: number;
  allInHourlyRate: number;
  timeCost: number;
  fuelCost: number;
  totalCarrierCost: number;
  marginAmount: number;
  customerPrice: number;
  grossProfit: number;
  profitMarginPercent: number;
  fuelPerKm: number;
  citySpeedKmh: number;
  rushMultiplier: number;
  stopsCount: number;
}

interface AdditionalStop {
  id: string;
  location: string;
  dockTimeMinutes: number;
  distanceKm: number;
}

function standardDistanceAsMiles(
  pricingMode: "per_mile" | "fixed_lane" | "local_pd",
  distanceStr: string,
  unit: MeasurementUnit
): number {
  const n = Number(distanceStr);
  if (!n || n <= 0) return 0;
  if (pricingMode === "local_pd") return 0;
  if (pricingMode === "fixed_lane") return n;
  return unit === "metric" ? kmToMiles(n) : n;
}

export default function QuoteCalculator() {
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const currencySym = useMemo(() => currencySymbol(currency), [currency]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const measurementUnit = useMemo(() => resolveMeasurementUnit(user), [user]);

  // Shared state
  const [truckType, setTruckType] = useState("dry_van");
  const [pricingMode, setPricingMode] = useState<"per_mile" | "fixed_lane" | "local_pd">("per_mile");
  const [marginType, setMarginType] = useState<"flat" | "percentage">("flat");
  const [marginValue, setMarginValue] = useState<string>("200");

  // Per-mile / fixed lane state
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [distance, setDistance] = useState<string>("");
  const [selectedLaneId, setSelectedLaneId] = useState<string>("");

  // Local P&D state
  const [localOrigin, setLocalOrigin] = useState("");
  const [localDestination, setLocalDestination] = useState("");
  const [localDistanceKm, setLocalDistanceKm] = useState<string>("");
  const [pickupDockMinutes, setPickupDockMinutes] = useState<string>("60");
  const [deliveryDockMinutes, setDeliveryDockMinutes] = useState<string>("60");
  const [isRoundTrip, setIsRoundTrip] = useState(true);
  const [isRushHour, setIsRushHour] = useState(false);
  const [additionalStops, setAdditionalStops] = useState<AdditionalStop[]>([]);

  // Results
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [localResult, setLocalResult] = useState<LocalResult | null>(null);

  const standardMiles = useMemo(
    () => standardDistanceAsMiles(pricingMode, distance, measurementUnit),
    [pricingMode, distance, measurementUnit]
  );
  const standardDistanceLabel = useMemo(() => {
    if (pricingMode === "local_pd") return "";
    const n = Number(distance);
    if (!distance || Number.isNaN(n)) return "";
    if (pricingMode === "fixed_lane") {
      return measurementUnit === "metric" ? `${milesToKm(n).toFixed(0)} km` : `${n} mi`;
    }
    return measurementUnit === "metric" ? `${n} km` : `${n} mi`;
  }, [pricingMode, distance, measurementUnit]);

  // Fetch data
  const { data: rates = [] } = useQuery<RateTable[]>({ queryKey: ["/api/rates"] });
  const { data: lanes = [] } = useQuery<Lane[]>({ queryKey: ["/api/lanes"] });
  const { data: hourlyRates = [] } = useQuery<HourlyRate[]>({ queryKey: ["/api/hourly-rates"] });

  const filteredLanes = useMemo(() => lanes.filter((l) => l.truckType === truckType), [lanes, truckType]);

  useEffect(() => {
    if (selectedLaneId && pricingMode === "fixed_lane") {
      const lane = lanes.find((l) => l.id === selectedLaneId);
      if (lane) { setOrigin(lane.origin); setDestination(lane.destination); setDistance(String(lane.estimatedMiles)); }
    }
  }, [selectedLaneId, lanes, pricingMode]);

  const currentRate = useMemo(() => rates.find((r) => r.truckType === truckType), [rates, truckType]);
  const currentHourlyRate = useMemo(() => hourlyRates.find((r) => r.truckType === truckType), [hourlyRates, truckType]);
  const allInHourly = currentHourlyRate
    ? currentHourlyRate.driverPayPerHour + currentHourlyRate.truckCostPerHour +
      currentHourlyRate.insurancePerHour + currentHourlyRate.maintenancePerHour +
      currentHourlyRate.miscPerHour
    : 0;

  // Clear results when mode/truck changes
  useEffect(() => { setQuoteResult(null); setLocalResult(null); }, [pricingMode, truckType]);

  // === Per-mile / fixed lane calculate ===
  const calculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/calculate", {
        origin,
        destination,
        truckType,
        distance: standardMiles,
        pricingMode,
        laneId: pricingMode === "fixed_lane" ? selectedLaneId : undefined,
        marginType,
        marginValue: Number(marginValue),
      });
      return res.json();
    },
    onSuccess: (data: QuoteResult) => { setQuoteResult(data); setLocalResult(null); },
    onError: (err: Error) => { toast({ title: "Calculation Error", description: err.message, variant: "destructive" }); },
  });

  // === Local P&D calculate ===
  const calculateLocalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/calculate-local", {
        origin: localOrigin, destination: localDestination, truckType,
        distanceKm: Number(localDistanceKm),
        pickupDockMinutes: Number(pickupDockMinutes),
        deliveryDockMinutes: Number(deliveryDockMinutes),
        additionalStops: additionalStops.map(s => ({
          location: s.location, dockTimeMinutes: s.dockTimeMinutes, distanceKm: s.distanceKm,
        })),
        isRoundTrip, isRushHour,
        marginType, marginValue: Number(marginValue),
      });
      return res.json();
    },
    onSuccess: (data: LocalResult) => { setLocalResult(data); setQuoteResult(null); },
    onError: (err: Error) => { toast({ title: "Calculation Error", description: err.message, variant: "destructive" }); },
  });

  // === Save quote (unified) ===
  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = pricingMode === "local_pd" ? localResult : quoteResult;
      if (!result) throw new Error("No quote to save");
      const o = pricingMode === "local_pd" ? localOrigin : origin;
      const d = pricingMode === "local_pd" ? localDestination : destination;
      const dist =
        pricingMode === "local_pd" ? Number(localDistanceKm) : standardMiles;
      const res = await apiRequest("POST", "/api/quotes", {
        origin: o, destination: d, truckType, distance: dist, pricingMode,
        carrierCost: pricingMode === "local_pd" ? (localResult!.timeCost + localResult!.fuelCost) : quoteResult!.carrierCost,
        fuelSurcharge: pricingMode === "local_pd" ? localResult!.fuelCost : quoteResult!.fuelSurcharge,
        totalCarrierCost: result.totalCarrierCost,
        marginType, marginValue: Number(marginValue),
        marginAmount: result.marginAmount,
        customerPrice: result.customerPrice,
        grossProfit: result.grossProfit,
        profitMarginPercent: result.profitMarginPercent,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Quote Saved", description: `Quote ${data.quoteNumber} saved.` });
    },
    onError: (err: Error) => { toast({ title: "Save Error", description: err.message, variant: "destructive" }); },
  });

  // Add stop
  function addStop() {
    setAdditionalStops(prev => [...prev, {
      id: crypto.randomUUID().slice(0, 8),
      location: "", dockTimeMinutes: 45, distanceKm: 0,
    }]);
  }
  function removeStop(id: string) {
    setAdditionalStops(prev => prev.filter(s => s.id !== id));
  }
  function updateStop(id: string, field: keyof AdditionalStop, value: string | number) {
    setAdditionalStops(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }

  const canCalculateStandard = origin.trim() && destination.trim() && standardMiles > 0;
  const canCalculateLocal = localOrigin.trim() && localDestination.trim() && Number(localDistanceKm) > 0;

  const truckLabel = TRUCK_TYPES.find((t) => t.value === truckType)?.label || truckType;
  const activeResult = pricingMode === "local_pd" ? localResult : quoteResult;

  return (
    <div className="space-y-6">
      {/* Rate info banner */}
      {pricingMode !== "local_pd" && currentRate && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{truckLabel} Rates:</span>
          <Badge variant="secondary" data-testid="badge-rate-per-mile">{formatCurrency(currentRate.ratePerMile)}/mi</Badge>
          <Badge variant="secondary" data-testid="badge-fuel-surcharge"><Fuel className="w-3 h-3 mr-1" />{currentRate.fuelSurchargePercent}% FSC</Badge>
          <Badge variant="secondary" data-testid="badge-min-charge">Min {formatCurrency(currentRate.minCharge)}</Badge>
        </div>
      )}
      {pricingMode === "local_pd" && currentHourlyRate && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{truckLabel} Hourly:</span>
          <Badge variant="secondary" data-testid="badge-hourly-rate"><Clock className="w-3 h-3 mr-1" />{formatCurrency(allInHourly)}/hr</Badge>
          <Badge variant="secondary" data-testid="badge-fuel-km"><Fuel className="w-3 h-3 mr-1" />{formatCurrency(currentHourlyRate.fuelPerKm)}/km</Badge>
          <Badge variant="secondary" data-testid="badge-city-speed">{currentHourlyRate.citySpeedKmh} km/h avg</Badge>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Input form */}
        <div className="lg:col-span-3 space-y-5">
          {/* Truck type selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Equipment Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {TRUCK_TYPES.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" data-testid={`button-truck-${value}`}
                  onClick={() => { setTruckType(value); setSelectedLaneId(""); }}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors border
                    ${truckType === value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-accent"}`}>
                  <Icon className="w-4 h-4" />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing mode tabs — 3 tabs now */}
          <Tabs value={pricingMode} onValueChange={(v) => setPricingMode(v as any)}>
            <TabsList className="w-full" data-testid="tabs-pricing-mode">
              <TabsTrigger value="per_mile" className="flex-1 text-xs sm:text-sm">Per-Mile</TabsTrigger>
              <TabsTrigger value="fixed_lane" className="flex-1 text-xs sm:text-sm">Fixed Lane</TabsTrigger>
              <TabsTrigger value="local_pd" className="flex-1 text-xs sm:text-sm">Local P&D</TabsTrigger>
            </TabsList>

            {/* === PER MILE TAB === */}
            <TabsContent value="per_mile" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="origin" className="text-sm">Origin</Label>
                  <LocationSuggestInput
                    id="origin"
                    data-testid="input-origin"
                    placeholder="e.g. Toronto, ON"
                    value={origin}
                    onChange={setOrigin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="destination" className="text-sm">Destination</Label>
                  <LocationSuggestInput
                    id="destination"
                    data-testid="input-destination"
                    placeholder="e.g. Montreal, QC"
                    value={destination}
                    onChange={setDestination}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="distance" className="text-sm">
                  Distance ({measurementUnit === "metric" ? "km" : "miles"})
                </Label>
                <Input
                  id="distance"
                  data-testid="input-distance"
                  type="number"
                  placeholder={
                    measurementUnit === "metric" ? "Enter distance in km" : "Enter distance in miles"
                  }
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  min={0}
                />
              </div>
            </TabsContent>

            {/* === FIXED LANE TAB === */}
            <TabsContent value="fixed_lane" className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Select Lane</Label>
                <Select value={selectedLaneId} onValueChange={setSelectedLaneId}>
                  <SelectTrigger data-testid="select-lane"><SelectValue placeholder="Choose a saved lane" /></SelectTrigger>
                  <SelectContent>
                    {filteredLanes.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No {truckLabel} lanes saved yet</div>
                    ) : filteredLanes.map((lane) => (
                      <SelectItem key={lane.id} value={lane.id}>
                        <span className="flex items-center gap-2">
                          {lane.origin} <ArrowRight className="w-3 h-3 text-muted-foreground" /> {lane.destination}
                          <span className="text-muted-foreground ml-1">({formatCurrency(lane.fixedPrice)})</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedLaneId && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-muted-foreground block text-xs">Origin</span>
                    <span className="font-medium">{origin}</span>
                  </div>
                  <div className="bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-muted-foreground block text-xs">Destination</span>
                    <span className="font-medium">{destination}</span>
                  </div>
                  <div className="bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-muted-foreground block text-xs">Est. Distance</span>
                    <span className="font-medium">{standardDistanceLabel || "—"}</span>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* === LOCAL P&D TAB === */}
            <TabsContent value="local_pd" className="space-y-4 mt-4">
              {/* Origin / Destination */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">Pickup Location</Label>
                  <LocationSuggestInput
                    data-testid="input-local-origin"
                    placeholder="e.g. Burlington, ON"
                    value={localOrigin}
                    onChange={setLocalOrigin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Final Delivery</Label>
                  <LocationSuggestInput
                    data-testid="input-local-destination"
                    placeholder="e.g. Mississauga, ON"
                    value={localDestination}
                    onChange={setLocalDestination}
                  />
                </div>
              </div>

              {/* Distance + dock times */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">Distance (km)</Label>
                  <Input data-testid="input-local-distance" type="number" placeholder="e.g. 30"
                    value={localDistanceKm} onChange={(e) => setLocalDistanceKm(e.target.value)} min={0} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Pickup Dock Time</Label>
                  <Select value={pickupDockMinutes} onValueChange={setPickupDockMinutes}>
                    <SelectTrigger data-testid="select-pickup-dock"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCK_TIME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Delivery Dock Time</Label>
                  <Select value={deliveryDockMinutes} onValueChange={setDeliveryDockMinutes}>
                    <SelectTrigger data-testid="select-delivery-dock"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCK_TIME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Additional stops */}
              {additionalStops.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Additional Stops</Label>
                  {additionalStops.map((stop, idx) => (
                    <div key={stop.id} className="flex items-start gap-2 bg-muted/30 rounded-md p-3">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Stop {idx + 1} Location</Label>
                          <LocationSuggestInput
                            leadingIcon={false}
                            inputClassName="h-9"
                            placeholder="e.g. Brampton, ON"
                            value={stop.location}
                            data-testid={`input-stop-location-${idx}`}
                            onChange={(v) => updateStop(stop.id, "location", v)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Dock Time</Label>
                          <Select value={String(stop.dockTimeMinutes)}
                            onValueChange={(v) => updateStop(stop.id, "dockTimeMinutes", Number(v))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DOCK_TIME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">KM from Previous</Label>
                          <Input type="number" placeholder="0" value={stop.distanceKm || ""}
                            data-testid={`input-stop-km-${idx}`}
                            onChange={(e) => updateStop(stop.id, "distanceKm", Number(e.target.value))} min={0} />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-5 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-stop-${idx}`}
                        onClick={() => removeStop(stop.id)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button variant="outline" size="sm" onClick={addStop} data-testid="button-add-stop" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Stop
              </Button>

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch checked={isRoundTrip} onCheckedChange={setIsRoundTrip} id="roundtrip"
                    data-testid="switch-roundtrip" />
                  <Label htmlFor="roundtrip" className="text-sm flex items-center gap-1.5 cursor-pointer">
                    <RotateCcw className="w-3.5 h-3.5" /> Round Trip (deadhead back)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={isRushHour} onCheckedChange={setIsRushHour} id="rushhour"
                    data-testid="switch-rushhour" />
                  <Label htmlFor="rushhour" className="text-sm flex items-center gap-1.5 cursor-pointer">
                    <AlertTriangle className="w-3.5 h-3.5" /> Rush Hour (+40% drive time)
                  </Label>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Margin controls */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Margin / Markup</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={marginType} onValueChange={(v) => setMarginType(v as "flat" | "percentage")}>
                  <SelectTrigger data-testid="select-margin-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat Amount ({currencySym})</SelectItem>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {marginType === "flat" ? `Amount (${currencySym})` : "Percentage"}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {marginType === "flat" ? currencySym : "%"}
                  </span>
                  <Input data-testid="input-margin-value" type="number" value={marginValue}
                    onChange={(e) => setMarginValue(e.target.value)}
                    className={currencySym.length <= 1 ? "pl-8" : "pl-10"}
                    min={0}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Calculate button */}
          <Button data-testid="button-calculate" size="lg" className="w-full h-11 text-sm font-semibold"
            onClick={() => pricingMode === "local_pd" ? calculateLocalMutation.mutate() : calculateMutation.mutate()}
            disabled={pricingMode === "local_pd"
              ? (!canCalculateLocal || calculateLocalMutation.isPending)
              : (!canCalculateStandard || calculateMutation.isPending)}>
            <Calculator className="w-4 h-4 mr-2" />
            {(calculateMutation.isPending || calculateLocalMutation.isPending) ? "Calculating..." : "Calculate Quote"}
          </Button>
        </div>

        {/* Right: Quote result */}
        <div className="lg:col-span-2">
          {/* === Local P&D Result === */}
          {localResult && pricingMode === "local_pd" ? (
            <Card className="border-border" data-testid="card-local-result">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Local P&D Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Route summary */}
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Badge variant="outline" className="text-xs">{truckLabel}</Badge>
                  <span className="text-muted-foreground truncate">{localOrigin}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground truncate">{localDestination}</span>
                  {localResult.stopsCount > 2 && (
                    <Badge variant="secondary" className="text-xs">+{localResult.stopsCount - 2} stop{localResult.stopsCount - 2 > 1 ? "s" : ""}</Badge>
                  )}
                  {isRushHour && <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">Rush</Badge>}
                </div>

                <Separator />

                {/* Time breakdown */}
                <div className="space-y-2 text-sm">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Drive Time{isRushHour ? " (rush)" : ""}</span>
                    <span className="font-medium">{formatTime(localResult.driveTimeMinutes - localResult.returnTimeMinutes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dock / Wait Time</span>
                    <span className="font-medium">{formatTime(localResult.dockTimeMinutes)}</span>
                  </div>
                  {localResult.returnTimeMinutes > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Return Deadhead</span>
                      <span className="font-medium">{formatTime(localResult.returnTimeMinutes)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium pt-1 border-t border-dashed">
                    <span>Total Time</span>
                    <span data-testid="text-total-time">{formatTime(localResult.totalMinutes)} ({localResult.totalHours.toFixed(1)} hrs)</span>
                  </div>
                </div>

                <Separator />

                {/* Cost breakdown */}
                <div className="space-y-2 text-sm">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time ({localResult.totalHours.toFixed(1)}h × {formatCurrency(localResult.allInHourlyRate)}/hr)</span>
                    <span className="font-medium">{formatCurrency(localResult.timeCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fuel ({localResult.totalKm} km × {formatCurrency(localResult.fuelPerKm)}/km)</span>
                    <span className="font-medium">{formatCurrency(localResult.fuelCost)}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1 border-t border-dashed">
                    <span>Total Carrier Cost</span>
                    <span data-testid="text-total-carrier-cost">{formatCurrency(localResult.totalCarrierCost)}</span>
                  </div>
                </div>

                <Separator />

                {/* Margin */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Margin ({marginType === "flat" ? `Flat ${formatCurrency(Number(marginValue))}` : `${marginValue}%`})
                  </span>
                  <span className="font-medium text-primary" data-testid="text-margin-amount">
                    +{formatCurrency(localResult.marginAmount)}
                  </span>
                </div>

                <Separator />

                {/* Customer price */}
                <div className="bg-primary/8 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-medium">Customer Price</span>
                    <span className="text-xl font-bold text-primary" data-testid="text-customer-price">
                      {formatCurrency(localResult.customerPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />Gross Profit</span>
                    <span className="font-medium text-foreground" data-testid="text-gross-profit">
                      {formatCurrency(localResult.grossProfit)} ({localResult.profitMarginPercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                <Button data-testid="button-save-quote" onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending} variant="outline" className="w-full">
                  <Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? "Saving..." : "Save Quote"}
                </Button>
              </CardContent>
            </Card>

          ) : quoteResult && pricingMode !== "local_pd" ? (
            /* === Standard Result (per-mile / fixed lane) === */
            <Card className="border-border" data-testid="card-quote-result">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-primary" /> Quote Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">{truckLabel}</Badge>
                  <span className="text-muted-foreground truncate">{origin}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground truncate">{destination}</span>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {pricingMode === "fixed_lane"
                        ? "Fixed Lane Price"
                        : `Base Cost (${standardDistanceLabel} × ${formatCurrency(quoteResult.ratePerMile)}/mi)`}
                    </span>
                    <span className="font-medium">{formatCurrency(quoteResult.carrierCost)}</span>
                  </div>
                  {quoteResult.fuelSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fuel Surcharge ({quoteResult.fuelSurchargePercent}%)</span>
                      <span className="font-medium">{formatCurrency(quoteResult.fuelSurcharge)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium pt-1 border-t border-dashed">
                    <span>Total Carrier Cost</span>
                    <span>{formatCurrency(quoteResult.totalCarrierCost)}</span>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Margin ({marginType === "flat" ? `Flat ${formatCurrency(Number(marginValue))}` : `${marginValue}%`})
                  </span>
                  <span className="font-medium text-primary">+{formatCurrency(quoteResult.marginAmount)}</span>
                </div>
                <Separator />
                <div className="bg-primary/8 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-medium">Customer Price</span>
                    <span className="text-xl font-bold text-primary">{formatCurrency(quoteResult.customerPrice)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />Gross Profit</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(quoteResult.grossProfit)} ({quoteResult.profitMarginPercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <Button data-testid="button-save-quote" onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending} variant="outline" className="w-full">
                  <Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? "Saving..." : "Save Quote"}
                </Button>
              </CardContent>
            </Card>

          ) : (
            /* === Empty state === */
            <Card className="border-dashed border-border">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  {pricingMode === "local_pd"
                    ? <Clock className="w-6 h-6 text-muted-foreground" />
                    : <Truck className="w-6 h-6 text-muted-foreground" />}
                </div>
                <p className="text-sm text-muted-foreground max-w-[220px]">
                  {pricingMode === "local_pd"
                    ? "Set up your local route, dock times, and stops to see the time-based cost breakdown."
                    : "Fill in the route details and calculate to see your quote breakdown here."}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
