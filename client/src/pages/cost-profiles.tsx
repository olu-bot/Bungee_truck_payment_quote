import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { CostProfileWizard } from "@/components/CostProfileWizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  Package,
  Snowflake,
  Layers,
  Truck,
  Shield,
  Wrench,
  Fuel,
  Clock,
  User,
  Timer,
  DollarSign,
  Calendar,
  Pencil,
  X,
  ChevronRight,
  Lock,
  Check,
  Loader2,
  Building2,
  MapPin,
  Globe,
  Ruler,
} from "lucide-react";
import type { CostProfile, Yard } from "@shared/schema";
import {
  formatCurrencyAmount,
  localizeMoneySuffix,
  resolveWorkspaceCurrency,
} from "@/lib/currency";
import {
  resolveMeasurementUnit,
  displayFuelConsumption,
  fuelConsumptionLabel,
  displayDistance,
  distanceLabel,
  inputToLPer100km,
} from "@/lib/measurement";
import { apiRequest } from "@/lib/queryClient";
import { geocodeLocation } from "@/lib/geo";

/** Free tier: one profile (created in onboarding). Additional profiles require upgrade. */
const FREE_COST_PROFILE_LIMIT = 1;

// ── Constants ──────────────────────────────────────────────────────

const TRUCK_LABELS: Record<string, string> = {
  dry_van: "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
};

const TRUCK_ICONS: Record<string, typeof Package> = {
  dry_van: Package,
  reefer: Snowflake,
  flatbed: Layers,
};

function computeDerived(p: CostProfile) {
  const monthlyFixed =
    p.monthlyTruckPayment +
    p.monthlyInsurance +
    p.monthlyMaintenance +
    p.monthlyPermitsPlates +
    p.monthlyOther;
  const monthlyHours = p.workingDaysPerMonth * p.workingHoursPerDay;
  const fixedCostPerHour = monthlyHours > 0 ? monthlyFixed / monthlyHours : 0;
  const allInHourlyRate = fixedCostPerHour + p.driverPayPerHour;
  return { monthlyFixed, fixedCostPerHour, allInHourlyRate };
}

// ── All editable field metadata (for detail/edit view) ─────────────

type EditableField = {
  key: keyof CostProfile;
  label: string;
  suffix: string;
  step: string;
  icon: typeof Truck;
  group: string;
};

function getEditableFields(fuelLabel: string, fuelSuffix: string): EditableField[] {
  return [
    { key: "monthlyTruckPayment", label: "Monthly Truck Payment", suffix: "$", step: "100", icon: Truck, group: "Vehicle" },
    { key: "monthlyInsurance", label: "Monthly Insurance", suffix: "$", step: "50", icon: Shield, group: "Insurance & Overhead" },
    { key: "monthlyMaintenance", label: "Monthly Maintenance", suffix: "$", step: "50", icon: Wrench, group: "Insurance & Overhead" },
    { key: "monthlyPermitsPlates", label: "Monthly Permits & Plates", suffix: "$", step: "25", icon: Shield, group: "Insurance & Overhead" },
    { key: "monthlyOther", label: "Monthly Other Costs", suffix: "$", step: "25", icon: DollarSign, group: "Insurance & Overhead" },
    { key: "workingDaysPerMonth", label: "Working Days/Month", suffix: "days", step: "1", icon: Calendar, group: "Operations" },
    { key: "workingHoursPerDay", label: "Working Hours/Day", suffix: "hrs", step: "1", icon: Clock, group: "Operations" },
    { key: "driverPayPerHour", label: "Driver Pay/Hour", suffix: "$/hr", step: "1", icon: User, group: "Driver" },
    { key: "fuelConsumptionPer100km", label: `Consumption (${fuelLabel})`, suffix: fuelSuffix, step: "1", icon: Fuel, group: "Fuel Consumption" },
    { key: "defaultDockTimeMinutes", label: "Default Dock Time", suffix: "min", step: "15", icon: Timer, group: "Dock & Detention" },
    { key: "detentionRatePerHour", label: "Detention Rate/Hr", suffix: "$/hr", step: "5", icon: Timer, group: "Dock & Detention" },
  ];
}

// ── Section Heading ────────────────────────────────────────────────

function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Building2; title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        {title}
      </h2>
      <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}

// ── Company Info Section ───────────────────────────────────────────

function CompanyInfoSection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState("metric");
  const [preferredCurrency, setPreferredCurrency] = useState("CAD");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setCompanyName(user.companyName || "");
      setFleetSize(user.fleetSize || "");
      setMeasurementUnit(user.measurementUnit || "metric");
      setPreferredCurrency((user as Record<string, unknown>).preferredCurrency as string || resolveWorkspaceCurrency(user));
    }
  }, [user]);

  function startEdit() {
    if (user) {
      setCompanyName(user.companyName || "");
      setFleetSize(user.fleetSize || "");
      setMeasurementUnit(user.measurementUnit || "metric");
      setPreferredCurrency((user as Record<string, unknown>).preferredCurrency as string || resolveWorkspaceCurrency(user));
    }
    setIsEditing(true);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      await firebaseDb.updateUserProfile(user.uid, {
        companyName,
        fleetSize,
        measurementUnit,
        preferredCurrency,
      });
      toast({ title: "Company info updated" });
      setIsEditing(false);
      // Reload to pick up changes
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error saving company info", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const FLEET_SIZE_OPTIONS = [
    { value: "1", label: "1 truck" },
    { value: "2-5", label: "2–5 trucks" },
    { value: "6-20", label: "6–20 trucks" },
    { value: "21-50", label: "21–50 trucks" },
    { value: "51+", label: "51+ trucks" },
  ];

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <SectionHeading icon={Building2} title="Company Info" subtitle="Your company name, fleet size, and measurement preferences." />
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={startEdit} data-testid="company-info-edit">
              <Pencil className="w-3.5 h-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Company Name
                </label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your company name"
                  data-testid="input-company-name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" /> Fleet Size
                </label>
                <Select value={fleetSize} onValueChange={setFleetSize}>
                  <SelectTrigger data-testid="select-fleet-size">
                    <SelectValue placeholder="Select fleet size" />
                  </SelectTrigger>
                  <SelectContent>
                    {FLEET_SIZE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5" /> Measurement Unit
                </label>
                <Select value={measurementUnit} onValueChange={setMeasurementUnit}>
                  <SelectTrigger data-testid="select-measurement-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="metric">KM / L (Metric)</SelectItem>
                    <SelectItem value="imperial">MPG (Imperial)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" /> Preferred Currency
                </label>
                <Select value={preferredCurrency} onValueChange={setPreferredCurrency}>
                  <SelectTrigger data-testid="select-preferred-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAD">CAD (CA$)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Operating Region
                </label>
                <Input
                  value={[user?.operatingCity, user?.operatingCountryCode].filter(Boolean).join(", ") || "—"}
                  disabled
                  className="bg-muted/30"
                />
                <p className="text-[11px] text-muted-foreground">Change your city in Home Base below.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving...</> : <><Save className="w-3.5 h-3.5 mr-1" /> Save Changes</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Company Name</div>
                <div className="text-sm font-medium">{user?.companyName || "—"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Truck className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Fleet Size</div>
                <div className="text-sm font-medium">{user?.fleetSize || "—"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Ruler className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Measurement</div>
                <div className="text-sm font-medium">{user?.measurementUnit === "imperial" ? "MPG (Imperial)" : "KM / L (Metric)"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Preferred Currency</div>
                <div className="text-sm font-medium">{((user as Record<string, unknown>)?.preferredCurrency as string) === "USD" ? "USD ($)" : "CAD (CA$)"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Operating Region</div>
                <div className="text-sm font-medium">{[user?.operatingCity, user?.operatingCountryCode].filter(Boolean).join(", ") || "—"}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Home Base / Yard Section ──────────────────────────────────────

function HomeBaseSection() {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scopeId = workspaceFirestoreId(user);

  const { data: yards = [], isLoading } = useQuery<Yard[]>({
    queryKey: ["firebase", "yards", scopeId ?? ""],
    queryFn: () => firebaseDb.getYards(scopeId),
    enabled: !!scopeId,
  });

  const [editingYardId, setEditingYardId] = useState<string | null>(null);
  const [yardName, setYardName] = useState("");
  const [yardAddress, setYardAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingYard, setAddingYard] = useState(false);

  function startEditYard(yard: Yard) {
    setEditingYardId(yard.id);
    setYardName(yard.name);
    setYardAddress(yard.address);
  }

  async function saveYard() {
    if (!editingYardId || !scopeId) return;
    setSaving(true);
    try {
      const coords = await geocodeLocation(yardAddress || yardName);
      await firebaseDb.updateYard(scopeId, editingYardId, {
        name: yardName,
        address: yardAddress,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      setEditingYardId(null);
      toast({ title: "Home base updated" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: "Error updating yard", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addYard() {
    if (!scopeId) return;
    setSaving(true);
    try {
      // Geocode the address at save time so route builder has coordinates ready
      const coords = await geocodeLocation(yardAddress || yardName);
      await firebaseDb.createYard(scopeId, {
        name: yardName,
        address: yardAddress,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        isDefault: yards.length === 0,
      });
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      setAddingYard(false);
      setYardName("");
      setYardAddress("");
      toast({ title: "Yard added" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add";
      toast({ title: "Error adding yard", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteYard(yardId: string) {
    if (!scopeId) return;
    try {
      await firebaseDb.deleteYard(scopeId, yardId);
      queryClient.invalidateQueries({ queryKey: ["firebase", "yards", scopeId] });
      toast({ title: "Yard removed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete";
      toast({ title: "Error deleting yard", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <SectionHeading icon={MapPin} title="Home Base" subtitle="Your yards and depot locations. Used for deadhead (return trip) calculations." />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setAddingYard(true); setYardName(""); setYardAddress(""); }}
            data-testid="button-add-yard"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Yard
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading yards...</div>
        ) : yards.length === 0 && !addingYard ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-md">
            <MapPin className="w-7 h-7 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">No home base set yet. Add your first yard or depot.</p>
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => { setAddingYard(true); setYardName(""); setYardAddress(""); }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Your First Yard
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {yards.map((yard) => (
              <div key={yard.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                {editingYardId === yard.id ? (
                  <div className="flex-1 space-y-2">
                    <Input value={yardName} onChange={(e) => setYardName(e.target.value)} placeholder="Yard name" className="h-8" />
                    <Input value={yardAddress} onChange={(e) => setYardAddress(e.target.value)} placeholder="Address" className="h-8" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveYard} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingYardId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {yard.name}
                        {yard.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{yard.address}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEditYard(yard)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteYard(yard.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {addingYard && (
              <div className="rounded-md border border-dashed border-border p-3 space-y-2">
                <Input value={yardName} onChange={(e) => setYardName(e.target.value)} placeholder="Yard name (e.g. Main Depot)" className="h-8" />
                <Input value={yardAddress} onChange={(e) => setYardAddress(e.target.value)} placeholder="City (e.g. Mississauga, ON)" className="h-8" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addYard} disabled={saving || !yardName.trim()} className="bg-orange-500 hover:bg-orange-600 text-white">
                    {saving ? "Adding..." : "Add Yard"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAddingYard(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────

type ViewMode = "list" | "wizard" | "detail";

export default function CostProfiles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const isAdmin = user?.role === "admin";
  const scopeId = workspaceFirestoreId(user);
  const currency = useMemo(() => resolveWorkspaceCurrency(user as Record<string, unknown>), [user]);
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const EDITABLE_FIELDS = useMemo(
    () => getEditableFields(fuelConsumptionLabel(measureUnit), measureUnit === "imperial" ? "MPG" : "L"),
    [measureUnit]
  );

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<"pro" | "fleet" | null>(null);
  const stripeReturnToastDone = useRef(false);

  // ── Queries & Mutations ────────────────────────────────────────

  const { data: profiles = [], isLoading } = useQuery<CostProfile[]>({
    queryKey: ["firebase", "profiles", scopeId ?? ""],
    queryFn: () => firebaseDb.getProfiles(scopeId),
    enabled: !!scopeId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<CostProfile, "id">) => {
      const existing = await firebaseDb.getProfiles(scopeId);
      if (!isAdmin && existing.length >= FREE_COST_PROFILE_LIMIT) {
        throw new Error(
          "Your plan includes one cost profile. Upgrade to create additional profiles."
        );
      }
      return firebaseDb.createProfile(scopeId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      setViewMode("list");
      toast({ title: "Profile created", description: "Your cost profile has been saved." });
    },
    onError: (err: Error) => {
      const msg = err.message;
      if (msg.includes("Upgrade to create additional")) {
        setPaywallOpen(true);
        return;
      }
      toast({ title: "Error creating profile", description: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CostProfile> }) => {
      const updated = await firebaseDb.updateProfile(scopeId, id, data);
      if (!updated) throw new Error("Profile not found");
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Changes have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error updating profile", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const ok = await firebaseDb.deleteProfile(scopeId, id);
      if (!ok) throw new Error("Profile not found");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "profiles", scopeId ?? ""] });
      if (viewMode === "detail") {
        setViewMode("list");
        setSelectedProfileId(null);
      }
      toast({ title: "Profile deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error deleting profile", description: err.message, variant: "destructive" });
    },
  });

  // ── Detail/Edit helpers ─────────────────────────────────────────

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  function startEditingProfile(profile: CostProfile) {
    const vals: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      // Convert fuel consumption to display unit for editing
      if (f.key === "fuelConsumptionPer100km") {
        const displayVal = displayFuelConsumption(profile[f.key] as number, measureUnit);
        vals[f.key] = String(Math.round(displayVal * 10) / 10);
      } else {
        vals[f.key] = String(profile[f.key]);
      }
    }
    setEditValues(vals);
    setIsEditing(true);
  }

  function saveEditedProfile() {
    if (!selectedProfileId) return;
    const payload: Record<string, number> = {};
    for (const f of EDITABLE_FIELDS) {
      const raw = Number(editValues[f.key]);
      // Convert fuel consumption from display unit back to L/100km for storage
      if (f.key === "fuelConsumptionPer100km") {
        payload[f.key] = Math.round(inputToLPer100km(raw, measureUnit) * 100) / 100;
      } else {
        payload[f.key] = raw;
      }
    }
    updateMutation.mutate({ id: selectedProfileId, data: payload });
  }

  function openCreateProfileFlow() {
    if (!isAdmin && profiles.length >= FREE_COST_PROFILE_LIMIT) {
      setPaywallOpen(true);
      return;
    }
    setViewMode("wizard");
  }

  async function startStripeCheckout(tier: "pro" | "fleet") {
    setCheckoutTier(tier);
    try {
      const res = await apiRequest("POST", "/api/stripe/create-checkout-session", {
        tier,
        customerEmail: user?.email ?? undefined,
        clientReferenceId: user?.uid ?? undefined,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.error) {
        toast({ title: "Checkout unavailable", description: data.error, variant: "destructive" });
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      toast({ title: "Checkout failed", description: "No redirect URL from Stripe.", variant: "destructive" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      toast({ title: "Checkout failed", description: msg, variant: "destructive" });
    } finally {
      setCheckoutTier(null);
    }
  }

  useEffect(() => {
    function consumeStripeCheckoutReturn() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      const qIdx = hash.indexOf("?");
      if (qIdx === -1) return;
      const params = new URLSearchParams(hash.slice(qIdx + 1));
      const checkout = params.get("checkout");
      if (checkout !== "success" && checkout !== "cancel") return;
      if (stripeReturnToastDone.current) return;
      stripeReturnToastDone.current = true;
      if (checkout === "success") {
        toast({
          title: "Checkout complete",
          description: "Thanks! Your subscription is processing. It may take a minute to sync with your account.",
        });
      } else {
        toast({
          title: "Checkout cancelled",
          description: "You can upgrade anytime from Company Profile.",
        });
      }
      const pathOnly = hash.slice(0, qIdx);
      window.history.replaceState(null, "", window.location.pathname + pathOnly);
    }
    consumeStripeCheckoutReturn();
    window.addEventListener("hashchange", consumeStripeCheckoutReturn);
    return () => window.removeEventListener("hashchange", consumeStripeCheckoutReturn);
  }, [toast]);

  useEffect(() => {
    if (isLoading || !scopeId) return;
    if (viewMode !== "wizard") return;
    if (!isAdmin && profiles.length >= FREE_COST_PROFILE_LIMIT) {
      setViewMode("list");
      setPaywallOpen(true);
    }
  }, [isLoading, scopeId, viewMode, profiles.length]);

  // ── Render: Cost Profile List ─────────────────────────────────

  function renderProfileList() {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <SectionHeading
              icon={Truck}
              title="Cost Profiles"
              subtitle="Each profile represents a truck type with its operating costs. These are used when calculating route quotes."
            />
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              data-testid="button-create-profile"
              onClick={openCreateProfileFlow}
            >
              <Plus className="w-4 h-4 mr-1" />
              Create Profile
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-md">
              <Truck className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium mb-1">No cost profiles yet</p>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                A cost profile captures your truck's monthly expenses, driver pay, and fuel consumption so Bungee can calculate accurate per-trip pricing.
              </p>
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={openCreateProfileFlow}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Your First Profile
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {profiles.map((profile) => {
                const Icon = TRUCK_ICONS[profile.truckType] || Package;
                const derived = computeDerived(profile);

                return (
                  <Card
                    key={profile.id}
                    className="border-border cursor-pointer hover:border-primary/50 transition-colors"
                    data-testid={`card-profile-${profile.id}`}
                    onClick={() => {
                      setSelectedProfileId(profile.id);
                      setIsEditing(false);
                      setViewMode("detail");
                    }}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        <span className="flex items-center gap-2 truncate">
                          <Icon className="w-4 h-4 shrink-0" />
                          {profile.name}
                        </span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {TRUCK_LABELS[profile.truckType] || profile.truckType}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">All-in hourly</span>
                        <span className="font-medium">{formatCurrency(derived.allInHourlyRate)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Fuel className="w-3 h-3" /> Consumption
                        </span>
                        <span className="font-medium">{Math.round(displayFuelConsumption(profile.fuelConsumptionPer100km, measureUnit) * 10) / 10} {fuelConsumptionLabel(measureUnit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Monthly fixed</span>
                        <span className="font-medium">{formatCurrency(derived.monthlyFixed)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">View details</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            data-testid={`button-delete-profile-${profile.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(profile.id);
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Render: Wizard ──────────────────────────────────────────────

  function renderWizard() {
    return (
      <div className="space-y-6">
        <h2 className="text-base font-semibold">Create Cost Profile</h2>
        <CostProfileWizard
          currency={currency}
          measurementUnit={measureUnit}
          onSave={(data) => createMutation.mutate(data)}
          onBack={() => setViewMode("list")}
          backLabel="Back"
          backTestId="wizard-back-to-list"
          isSaving={createMutation.isPending}
        />
      </div>
    );
  }

  // ── Render: Detail / Edit View ──────────────────────────────────

  function renderDetail() {
    if (!selectedProfile) {
      return (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Profile not found.
          <Button variant="link" size="sm" onClick={() => setViewMode("list")}>
            Back to list
          </Button>
        </div>
      );
    }

    const Icon = TRUCK_ICONS[selectedProfile.truckType] || Package;
    const derived = computeDerived(selectedProfile);

    // Group fields for display
    const groups: Record<string, EditableField[]> = {};
    for (const f of EDITABLE_FIELDS) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    }

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              data-testid="detail-back-to-list"
              onClick={() => {
                setViewMode("list");
                setSelectedProfileId(null);
                setIsEditing(false);
              }}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">{selectedProfile.name}</h2>
              <Badge variant="secondary" className="text-xs">
                {TRUCK_LABELS[selectedProfile.truckType] || selectedProfile.truckType}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  size="sm"
                  data-testid="detail-save-edit"
                  disabled={updateMutation.isPending}
                  onClick={saveEditedProfile}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Save className="w-4 h-4 mr-1" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="detail-cancel-edit"
                  onClick={() => setIsEditing(false)}
                >
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="detail-edit-button"
                  onClick={() => startEditingProfile(selectedProfile)}
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  data-testid={`detail-delete-profile-${selectedProfile.id}`}
                  onClick={() => deleteMutation.mutate(selectedProfile.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">All-in Hourly Rate</div>
              <div className="text-lg font-semibold">{formatCurrency(derived.allInHourlyRate)}/hr</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">Fuel Consumption</div>
              <div className="text-lg font-semibold">{selectedProfile.fuelConsumptionPer100km} L/100km</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">Monthly Fixed Total</div>
              <div className="text-lg font-semibold">{formatCurrency(derived.monthlyFixed)}</div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* All fields grouped */}
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, fields]) => (
            <section key={groupName} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">{groupName}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fields.map((f) => {
                  const FieldIcon = f.icon;
                  let rawValue = selectedProfile[f.key] as number;
                  // Convert fuel consumption to display unit
                  if (f.key === "fuelConsumptionPer100km") {
                    rawValue = Math.round(displayFuelConsumption(rawValue, measureUnit) * 10) / 10;
                  }
                  const displayValue =
                    f.suffix === "$" || f.suffix === "$/hr" || f.suffix === "$/L"
                      ? formatCurrency(rawValue as number)
                      : `${rawValue} ${f.suffix}`;

                  return (
                    <div
                      key={f.key}
                      className="flex items-center justify-between rounded-md border border-border p-3"
                      data-testid={`detail-field-${f.key}`}
                    >
                      <span className="text-sm flex items-center gap-2 text-muted-foreground">
                        <FieldIcon className="w-3.5 h-3.5" />
                        {f.label}
                      </span>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            data-testid={`detail-input-${f.key}`}
                            type="number"
                            step={f.step}
                            className="w-28 text-right h-8"
                            value={editValues[f.key] ?? ""}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                            }
                          />
                          {f.suffix ? (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {localizeMoneySuffix(f.suffix, currency) ?? f.suffix}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-sm font-medium">{displayValue}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // ── Main Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="cost-profiles-page">
      {/* Company Info — always visible on list view */}
      {viewMode === "list" && (
        <>
          <CompanyInfoSection />
          <HomeBaseSection />
          {renderProfileList()}
        </>
      )}
      {viewMode === "wizard" && renderWizard()}
      {viewMode === "detail" && renderDetail()}

      <Dialog open={paywallOpen} onOpenChange={setPaywallOpen}>
        <DialogContent
          className="max-h-[92vh] max-w-4xl gap-0 overflow-y-auto p-0 sm:max-w-4xl"
          data-testid="dialog-cost-profile-paywall"
        >
          <div className="border-b border-border p-6 sm:p-8 sm:pb-6">
            <div className="mb-3 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
            <DialogHeader className="space-y-2 text-center">
              <DialogTitle className="text-xl">Upgrade to add more cost profiles</DialogTitle>
              <DialogDescription className="mx-auto max-w-2xl text-pretty text-center">
                Your account includes one cost profile and one yard. Upgrade to Pro or Fleet for unlimited profiles,
                yards, and more.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8 sm:pt-6">
            <Card className="flex flex-col border-primary shadow-md ring-1 ring-primary/20">
              <CardHeader className="pb-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <CardTitle className="text-lg font-semibold tracking-tight">Pro</CardTitle>
                  <Badge className="text-[10px] uppercase">Popular</Badge>
                </div>
                <p className="text-2xl font-bold tracking-tight">
                  $29{" "}
                  <span className="text-base font-normal text-muted-foreground">/ month</span>
                </p>
                <CardDescription className="text-sm leading-snug">
                  For growing fleets that need more power and branded quotes.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  {[
                    "Everything in your account today, plus:",
                    "Unlimited profiles & yards",
                    "Branded Quote PDFs",
                    "Live fuel prices",
                    "Lane rate intelligence",
                    "Priority support",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-auto flex-col gap-2 pt-2">
                <Button
                  type="button"
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                  disabled={checkoutTier !== null}
                  onClick={() => startStripeCheckout("pro")}
                >
                  {checkoutTier === "pro" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    "Start Pro — $29/mo"
                  )}
                </Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold tracking-tight">Fleet</CardTitle>
                <p className="text-2xl font-bold tracking-tight">
                  $79{" "}
                  <span className="text-base font-normal text-muted-foreground">/ month</span>
                </p>
                <CardDescription className="text-sm leading-snug">
                  For fleets needing dispatch, portal, and integrations.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  {[
                    "Everything in Pro",
                    "Customer quote portal",
                    "Multi-truck dispatch",
                    "Accounting export",
                    "API access",
                    "Dedicated support",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-auto flex-col gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={checkoutTier !== null}
                  onClick={() => startStripeCheckout("fleet")}
                >
                  {checkoutTier === "fleet" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    "Start Fleet — $79/mo"
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4 sm:px-8">
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => setPaywallOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
