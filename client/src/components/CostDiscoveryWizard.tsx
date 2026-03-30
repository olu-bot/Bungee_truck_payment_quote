/**
 * Cost Discovery Wizard — single-page form that helps trucking companies
 * discover their real operating costs with inline guidance and regional benchmarks.
 *
 * Selecting equipment type + location auto-fills all fields with regional averages.
 * Users just tweak what's different from the benchmark. Minimal clicks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Save,
  Package,
  Snowflake,
  Layers,
  Truck,
  Shield,
  Fuel,
  Clock,
  User,
  DollarSign,
  Calendar,
  Zap,
  Container,
  AlertTriangle,
  MapPin,
  ChevronDown,
  Search,
  CheckCircle2,
  Info,
  Lock,
  HelpCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { CostProfile } from "@shared/schema";
import {
  formatCurrencyAmount,
  localizeMoneySuffix,
  convertCurrency,
  type SupportedCurrency,
} from "@/lib/currency";
import {
  type MeasurementUnit,
  fuelConsumptionLabel,
  lPer100kmToMpg,
  mpgToLPer100km,
} from "@/lib/measurement";
import {
  REGIONS,
  EQUIPMENT_BASELINES,
  ALL_STATES,
  getRegionalEstimate,
  findRegionByState,
  type RegionData,
  type EquipmentBaseline,
} from "@/lib/regionalCostData";

// ── Types ──────────────────────────────────────────────────────────

type FieldDef = {
  key: string;
  label: string;
  suffix?: string;
  step?: string;
  icon: typeof Truck;
  hint: string;           // always-visible one-liner below the field
  benchmarkKey?: keyof EquipmentBaseline;
  optional?: boolean;
};

type SectionDef = {
  id: string;
  title: string;
  icon: typeof Truck;
  fields: FieldDef[];
  /** If true, section is hidden behind an "Advanced" toggle */
  advanced?: boolean;
};

// ── Field definitions with inline hints ────────────────────────────

function getSections(unit: MeasurementUnit): SectionDef[] {
  const isImperial = unit === "imperial";
  return [
    {
      id: "fixed",
      title: "Monthly Fixed Costs",
      icon: DollarSign,
      fields: [
        {
          key: "monthlyTruckPayment",
          label: "Truck payment",
          suffix: "$", step: "any", icon: Truck,
          benchmarkKey: "monthlyTruckPayment",
          hint: "Monthly cost to lease or finance your tractor. Enter $0 if owned outright.",
        },
        {
          key: "monthlyInsurance",
          label: "Insurance",
          suffix: "$", step: "any", icon: Shield,
          benchmarkKey: "monthlyInsurance",
          hint: "Total monthly commercial truck insurance premium — liability, cargo, and physical damage.",
        },
        {
          key: "monthlyMaintenance",
          label: "Maintenance & tires",
          suffix: "$", step: "any", icon: DollarSign,
          benchmarkKey: "monthlyMaintenance",
          hint: "Average monthly budget for repairs, oil changes, tire replacements, and upkeep.",
        },
        {
          key: "monthlyPermitsPlates",
          label: "Permits & plates",
          suffix: "$", step: "any", icon: Shield,
          benchmarkKey: "monthlyPermitsPlates",
          hint: "Annual regulatory costs (IRP, IFTA, UCR, plates) divided by 12 months.",
        },
        {
          key: "monthlyOther",
          label: "Other (ELD, parking, etc.)",
          suffix: "$", step: "any", icon: DollarSign,
          benchmarkKey: "monthlyOther",
          hint: "Monthly recurring costs not listed above — ELD, GPS, parking, truck washes, scale fees.",
        },
      ],
    },
    {
      id: "operations",
      title: "Working Schedule",
      icon: Calendar,
      fields: [
        {
          key: "workingDaysPerMonth",
          label: "Working days / month",
          suffix: "days", step: "1", icon: Calendar,
          benchmarkKey: "workingDaysPerMonth",
          hint: "Days per month your truck is actively hauling freight. Exclude downtime and off-days.",
        },
        {
          key: "workingHoursPerDay",
          label: "Billable hours / day",
          suffix: "hrs", step: "0.5", icon: Clock,
          benchmarkKey: "workingHoursPerDay",
          hint: "Average daily on-duty hours when the truck is working, including drive and dock time.",
        },
      ],
    },
    {
      id: "driver",
      title: "Driver Pay",
      icon: User,
      fields: [
        {
          key: "driverPayPerHour",
          label: "Hourly rate",
          suffix: "$/hr", step: "0.50", icon: User,
          benchmarkKey: "driverPayPerHour",
          hint: "Hourly wage paid to the driver. Owner-operators: enter what you pay yourself per hour.",
        },
        {
          key: "driverPayPerMile",
          label: isImperial ? "Per-mile rate (long haul)" : "Per-km rate (long haul)",
          suffix: isImperial ? "$/mi" : "$/km",
          step: "0.01", icon: User,
          benchmarkKey: "driverPayPerMile",
          hint: `Mileage pay per ${isImperial ? "mile" : "km"} for over-the-road freight. Enter 0 if using hourly pay only.`,
          optional: true,
        },
        {
          key: "deadheadPayPercent",
          label: "Deadhead pay (%)",
          suffix: "%", step: "5", icon: User,
          benchmarkKey: "deadheadPayPercent",
          hint: "Percentage of normal mileage pay given for empty return miles (e.g. 80 = 80%).",
          optional: true,
        },
      ],
    },
    {
      id: "fuel",
      title: "Fuel",
      icon: Fuel,
      fields: [
        {
          key: "fuelConsumptionPer100km",
          label: `Fuel consumption (${fuelConsumptionLabel(unit)})`,
          suffix: isImperial ? "MPG" : "L/100km",
          step: "0.1", icon: Fuel,
          benchmarkKey: "fuelConsumptionLPer100km",
          hint: isImperial
            ? "Your truck's average fuel efficiency in miles per gallon when loaded."
            : "Your truck's average fuel consumption in liters per 100km when loaded.",
        },
      ],
    },
  ];
}

const EQUIPMENT_TYPES = [
  { key: "dry_van", label: "Dry Van", Icon: Package },
  { key: "reefer", label: "Reefer", Icon: Snowflake },
  { key: "flatbed", label: "Flatbed", Icon: Layers },
  { key: "step_deck", label: "Step Deck", Icon: Layers },
  { key: "tanker", label: "Tanker", Icon: Container },
];

// ── Sub-components ─────────────────────────────────────────────────

/** Compact equipment selector — single row of chips */
function EquipmentChips({
  value,
  customValue,
  onChange,
  onCustomChange,
}: {
  value: string;
  customValue: string;
  onChange: (v: string) => void;
  onCustomChange: (v: string) => void;
}) {
  const isCustom = value === "__custom__";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {EQUIPMENT_TYPES.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors border cursor-pointer
              ${value === key
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
          onClick={() => onChange("__custom__")}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors border cursor-pointer
            ${isCustom
              ? "bg-orange-400 text-white border-orange-400"
              : "bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600"
            }`}
        >
          <Truck className="w-3.5 h-3.5" />
          Other
        </button>
      </div>
      {isCustom && (
        <Input
          placeholder="e.g. Lowboy, Car Hauler, Conestoga..."
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          className="h-9 text-sm"
        />
      )}
    </div>
  );
}

/** State/province dropdown */
function LocationSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return ALL_STATES;
    const q = search.toLowerCase();
    return ALL_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [search]);

  const selected = ALL_STATES.find((s) => s.code === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div
        className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 cursor-pointer hover:border-slate-400 transition-colors h-9"
        onClick={() => setOpen((v) => !v)}
      >
        <MapPin className="w-3.5 h-3.5 text-slate-500" />
        <span className={`text-sm flex-1 ${selected ? "" : "text-slate-500"}`}>
          {selected ? `${selected.name} (${selected.code})` : "Select state / province..."}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </div>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full border border-slate-200 rounded-xl bg-background shadow-lg max-h-60 overflow-hidden">
          <div className="p-2 border-b border-slate-200">
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="h-7 text-sm"
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-500 p-3">No results</p>
            )}
            {filtered.some((s) => s.country === "US") && (
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                United States
              </div>
            )}
            {filtered.filter((s) => s.country === "US").map((s) => (
              <button
                key={s.code}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors ${
                  value === s.code ? "bg-primary/10 text-primary font-medium" : ""
                }`}
                onClick={() => { onChange(s.code); setOpen(false); setSearch(""); }}
              >
                {s.name} <span className="text-xs text-slate-500">({s.code})</span>
              </button>
            ))}
            {filtered.some((s) => s.country === "CA") && (
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                Canada
              </div>
            )}
            {filtered.filter((s) => s.country === "CA").map((s) => (
              <button
                key={s.code}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors ${
                  value === s.code ? "bg-primary/10 text-primary font-medium" : ""
                }`}
                onClick={() => { onChange(s.code); setOpen(false); setSearch(""); }}
              >
                {s.name} <span className="text-xs text-slate-500">({s.code})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Live cost summary bar */
function CostSummaryBar({
  values,
  isImperial,
  formatMoney,
}: {
  values: Record<string, number | string>;
  isImperial: boolean;
  formatMoney: (n: number) => string;
}) {
  const monthlyFixed =
    (values.monthlyTruckPayment as number || 0) +
    (values.monthlyInsurance as number || 0) +
    (values.monthlyMaintenance as number || 0) +
    (values.monthlyPermitsPlates as number || 0) +
    (values.monthlyOther as number || 0) +
    (values.monthlyTrailerLease as number || 0) +
    (values.monthlyEldTelematics as number || 0) +
    (values.monthlyAccountingOffice as number || 0) +
    (values.monthlyTireReserve as number || 0);
  const workingDays = (values.workingDaysPerMonth as number) || 22;
  const workingHours = (values.workingHoursPerDay as number) || 10;
  const monthlyHours = workingDays * workingHours;
  const fixedPerHour = monthlyHours > 0 ? monthlyFixed / monthlyHours : 0;
  const driverPerHour = (values.driverPayPerHour as number) || 0;
  const allInHourly = fixedPerHour + driverPerHour;
  const avgSpeedMph = 50;
  const costPerMile = avgSpeedMph > 0 ? allInHourly / avgSpeedMph : 0;

  return (
    <div className="sticky bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-4 py-3">
      <div className="max-w-2xl mx-auto">
        <div className="grid grid-cols-4 gap-3 text-center">
          <div className="space-y-0.5">
            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Monthly Fixed</p>
            <p className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(monthlyFixed)}</p>
          </div>
          <div className="space-y-0.5 border-l border-slate-200 pl-3">
            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">All-In Hourly</p>
            <p className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(allInHourly)}/hr</p>
          </div>
          <div className="space-y-0.5 border-l border-slate-200 pl-3">
            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Est. Cost/{isImperial ? "Mile" : "KM"}</p>
            <p className="text-sm font-bold text-slate-900 tabular-nums">~{formatMoney(isImperial ? costPerMile : costPerMile / 1.609)}</p>
          </div>
          <div className="space-y-0.5 border-l border-slate-200 pl-3">
            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase">Fixed/Hour</p>
            <p className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(fixedPerHour)}/hr</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 text-center mt-2">* Excludes fuel — calculated per-route</p>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

type WizardValues = Record<string, number | string>;

function defaultWizardValues(): WizardValues {
  return {
    name: "",
    truckType: "dry_van",
    stateCode: "",
    monthlyTruckPayment: 0,
    monthlyInsurance: 0,
    monthlyMaintenance: 0,
    monthlyPermitsPlates: 0,
    monthlyOther: 0,
    monthlyTrailerLease: 0,
    monthlyEldTelematics: 0,
    monthlyAccountingOffice: 0,
    monthlyTireReserve: 0,
    workingDaysPerMonth: 0,
    workingHoursPerDay: 0,
    driverPayPerHour: 0,
    driverPayPerMile: 0,
    deadheadPayPercent: 80,
    fuelConsumptionPer100km: 0,
    defaultDockTimeMinutes: 45,
    detentionRatePerHour: 50,
  };
}

const OPTIONAL_FIELDS = new Set([
  "driverPayPerMile", "deadheadPayPercent",
  "monthlyTrailerLease", "monthlyEldTelematics", "monthlyAccountingOffice", "monthlyTireReserve",
]);

export type CostDiscoveryWizardProps = {
  onSave: (data: Omit<CostProfile, "id">) => void | Promise<void>;
  onBack?: () => void;
  onSkip?: () => void;
  backLabel?: string;
  saveLabel?: string;
  skipLabel?: string;
  defaultValues?: Partial<WizardValues>;
  allowSkip?: boolean;
  isSaving?: boolean;
  currency?: SupportedCurrency;
  measurementUnit?: MeasurementUnit;
};

export function CostDiscoveryWizard({
  onSave,
  onBack,
  onSkip,
  backLabel = "Back",
  saveLabel = "Save Profile",
  skipLabel = "Skip for now",
  defaultValues,
  allowSkip = false,
  isSaving = false,
  currency = "CAD",
  measurementUnit = "metric",
}: CostDiscoveryWizardProps) {
  const formatMoney = useMemo(
    () => (n: number) => formatCurrencyAmount(n, currency),
    [currency]
  );
  const isImperial = measurementUnit === "imperial";
  const sections = useMemo(() => getSections(measurementUnit), [measurementUnit]);
  const formRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<WizardValues>(() => {
    const base = defaultWizardValues();
    if (defaultValues) {
      for (const [k, v] of Object.entries(defaultValues)) {
        if (v !== undefined) (base as Record<string, string | number>)[k] = v as string | number;
      }
    }
    return base;
  });
  const [customEquipment, setCustomEquipment] = useState("");
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [benchmarksApplied, setBenchmarksApplied] = useState(false);
  /** Track which fields the user manually edited so auto-fill doesn't overwrite them */
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Derived
  const region = useMemo(
    () => findRegionByState(values.stateCode as string),
    [values.stateCode]
  );
  const estimate = useMemo(
    () => getRegionalEstimate(values.truckType as string, region),
    [values.truckType, region]
  );

  const setField = useCallback((key: string, value: number | string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // The region's native currency (USD for US states, CAD for Canadian provinces)
  const regionCurrency: SupportedCurrency = region?.currency === "CAD" ? "CAD" : "USD";

  /** Convert a monetary benchmark from the region's currency to the user's currency */
  const cx = useCallback(
    (amount: number) => {
      if (regionCurrency === currency) return amount;
      return Math.round(convertCurrency(amount, regionCurrency, currency) * 100) / 100;
    },
    [regionCurrency, currency]
  );

  // Auto-fill fields with regional benchmarks when equipment or location changes
  useEffect(() => {
    if (!estimate) return;
    setValues((prev) => {
      const next = { ...prev };
      // Monetary fields — convert from region currency to user currency
      const moneyFills: [string, number][] = [
        ["monthlyTruckPayment", cx(estimate.monthlyTruckPayment)],
        ["monthlyInsurance", cx(estimate.monthlyInsurance)],
        ["monthlyMaintenance", cx(estimate.monthlyMaintenance)],
        ["monthlyPermitsPlates", cx(estimate.monthlyPermitsPlates)],
        ["monthlyOther", cx(estimate.monthlyOther)],
        ["driverPayPerHour", cx(estimate.driverPayPerHour)],
        ["driverPayPerMile", cx(estimate.driverPayPerMile)],
        ["detentionRatePerHour", cx(estimate.detentionRatePerHour)],
      ];
      // Non-monetary fields — no currency conversion needed
      const plainFills: [string, number][] = [
        ["workingDaysPerMonth", estimate.workingDaysPerMonth],
        ["workingHoursPerDay", estimate.workingHoursPerDay],
        ["deadheadPayPercent", estimate.deadheadPayPercent],
        ["defaultDockTimeMinutes", estimate.defaultDockTimeMinutes],
      ];
      const fuelVal = isImperial
        ? Math.round(lPer100kmToMpg(estimate.fuelConsumptionLPer100km) * 10) / 10
        : estimate.fuelConsumptionLPer100km;
      plainFills.push(["fuelConsumptionPer100km", fuelVal]);

      for (const [key, val] of [...moneyFills, ...plainFills]) {
        if (!touchedFields.has(key)) {
          next[key] = val;
        }
      }
      return next;
    });
    setBenchmarksApplied(true);
  }, [estimate, isImperial, cx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    const v = values;
    const hasName = typeof v.name === "string" && v.name.trim().length > 0;
    return hasName || touchedFields.size > 0;
  }, [values, touchedFields]);

  function handleExitClick() {
    if (hasUnsavedChanges) {
      setShowExitWarning(true);
    } else {
      onBack?.();
    }
  }

  // Quick profile — one click, done
  function handleQuickProfile() {
    const base = EQUIPMENT_BASELINES.dry_van;
    // Baselines are in USD — convert monetary fields to user's currency
    const qx = (v: number) => Math.round(convertCurrency(v, "USD", currency) * 100) / 100;
    onSave({
      name: "Quick Start Profile",
      truckType: "dry_van",
      monthlyTruckPayment: qx(base.monthlyTruckPayment),
      monthlyInsurance: qx(base.monthlyInsurance),
      monthlyMaintenance: qx(base.monthlyMaintenance),
      monthlyPermitsPlates: qx(base.monthlyPermitsPlates),
      monthlyOther: qx(base.monthlyOther),
      workingDaysPerMonth: base.workingDaysPerMonth,
      workingHoursPerDay: base.workingHoursPerDay,
      driverPayPerHour: qx(base.driverPayPerHour),
      driverPayPerMile: qx(base.driverPayPerMile),
      deadheadPayPercent: base.deadheadPayPercent,
      fuelConsumptionPer100km: base.fuelConsumptionLPer100km,
      defaultDockTimeMinutes: base.defaultDockTimeMinutes,
      detentionRatePerHour: qx(base.detentionRatePerHour),
      currency,
      createdAt: new Date().toISOString(),
    });
  }

  function handleSave() {
    const v = values;
    // Guard: critical fields must be > 0 (prevents division-by-zero and $0 quotes)
    const workDays = v.workingDaysPerMonth as number;
    const workHours = v.workingHoursPerDay as number;
    const fuelValue = v.fuelConsumptionPer100km as number;
    if (workDays <= 0 || workHours <= 0 || fuelValue <= 0) return;

    const fuelAsLPer100km = isImperial ? mpgToLPer100km(fuelValue) : fuelValue;
    const resolvedType = (v.truckType as string) === "__custom__" ? customEquipment.trim() : (v.truckType as string);
    // Clamp all monetary values to >= 0 (no negatives)
    const clamp0 = (n: number) => Math.max(0, n);
    onSave({
      name: (v.name as string) || "My Equipment Cost Profile",
      truckType: resolvedType || "dry_van",
      monthlyTruckPayment: clamp0(v.monthlyTruckPayment as number),
      monthlyInsurance: clamp0(v.monthlyInsurance as number),
      monthlyMaintenance: clamp0(v.monthlyMaintenance as number),
      monthlyPermitsPlates: clamp0(v.monthlyPermitsPlates as number),
      monthlyOther: clamp0(v.monthlyOther as number),
      monthlyTrailerLease: clamp0((v.monthlyTrailerLease as number) || 0),
      monthlyEldTelematics: clamp0((v.monthlyEldTelematics as number) || 0),
      monthlyAccountingOffice: clamp0((v.monthlyAccountingOffice as number) || 0),
      monthlyTireReserve: clamp0((v.monthlyTireReserve as number) || 0),
      workingDaysPerMonth: Math.max(1, workDays),
      workingHoursPerDay: Math.max(1, workHours),
      driverPayPerHour: clamp0(v.driverPayPerHour as number),
      driverPayPerMile: clamp0((v.driverPayPerMile as number) || 0),
      deadheadPayPercent: Math.min(100, Math.max(0, (v.deadheadPayPercent as number) || 100)),
      fuelConsumptionPer100km: Math.max(0.1, Math.round(fuelAsLPer100km * 100) / 100),
      defaultDockTimeMinutes: clamp0(v.defaultDockTimeMinutes as number),
      detentionRatePerHour: clamp0(v.detentionRatePerHour as number),
      currency,
      createdAt: new Date().toISOString(),
    });
  }

  // Validation — all required fields must be > 0
  const canSave = useMemo(() => {
    const allFieldKeys = sections.flatMap((s) => s.fields.map((f) => f.key));
    return allFieldKeys.every((key) => {
      const v = values[key];
      if (OPTIONAL_FIELDS.has(key)) return typeof v === "number" && v >= 0;
      return typeof v === "number" && v > 0;
    });
  }, [values, sections]);

  // Helper: get benchmark for display
  // Monetary benchmark keys that need currency conversion
  const MONEY_BENCHMARK_KEYS = new Set<string>([
    "monthlyTruckPayment", "monthlyInsurance", "monthlyMaintenance",
    "monthlyPermitsPlates", "monthlyOther", "driverPayPerHour",
    "driverPayPerMile", "detentionRatePerHour",
  ]);

  function getBenchmark(benchmarkKey?: keyof EquipmentBaseline): number | undefined {
    if (!benchmarkKey || !estimate) return undefined;
    const val = estimate[benchmarkKey] as number;
    if (benchmarkKey === "fuelConsumptionLPer100km" && isImperial) {
      return Math.round(lPer100kmToMpg(val) * 10) / 10;
    }
    // Convert monetary benchmarks from region currency to user currency
    if (MONEY_BENCHMARK_KEYS.has(benchmarkKey)) {
      return cx(val);
    }
    return val;
  }

  const moneyKeys = new Set(["$", "$/hr", "$/mi", "$/km"]);

  return (
    <div className="space-y-3 pb-32" ref={formRef}>
      {/* Back / exit */}
      {onBack && (
        <Button variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:text-slate-900 transition-colors duration-200" onClick={handleExitClick}>
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Button>
      )}

      {/* Exit warning dialog */}
      <Dialog open={showExitWarning} onOpenChange={setShowExitWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes. If you leave now, your progress will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setShowExitWarning(false)}>
              Keep Editing
            </Button>
            <Button variant="destructive" size="sm" onClick={() => { setShowExitWarning(false); onBack?.(); }}>
              Discard & Exit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Privacy / encryption banner (top) ──────── */}
      <div className="flex items-center gap-2.5 rounded-lg px-3.5 py-3" style={{ background: "linear-gradient(135deg, #065f46 0%, #047857 100%)", color: "#fff" }}>
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white/15 shrink-0">
          <Lock className="w-4 h-4" />
        </div>
        <span className="text-[13px] font-semibold leading-snug">Your equipment cost profile is encrypted &amp; private. No one can access it — not even us.</span>
      </div>

      {/* ── Quick Start banner ───────────────────────── */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-orange-50 shrink-0">
          <Zap className="w-4 h-4 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Don't have your numbers handy?</p>
          <p className="text-xs text-slate-500 mt-0.5">Start with industry defaults — you can fine-tune later.</p>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-orange-400 text-white hover:bg-orange-500 shadow-sm transition-all duration-200"
          disabled={isSaving}
          onClick={handleQuickProfile}
          data-testid="button-quick-start"
        >
          {isSaving ? "Creating..." : "Quick Start"}
        </Button>
      </div>

      {/* ── Setup: Name, Equipment, Location ──────── */}
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4 space-y-4">
          {/* Profile name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Profile Name</Label>
            <Input
              placeholder="e.g. My Dry Van, Reefer Unit #3"
              value={values.name as string}
              onChange={(e) => setField("name", e.target.value)}
              className="h-9 text-sm border-slate-200 focus:border-slate-400 transition-colors"
            />
          </div>

          {/* Equipment + Location side by side on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Equipment Type</Label>
              <EquipmentChips
                value={values.truckType as string}
                customValue={customEquipment}
                onChange={(v) => {
                  setField("truckType", v);
                  setBenchmarksApplied(false);
                  setTouchedFields(new Set()); // reset so new benchmarks fill
                }}
                onCustomChange={setCustomEquipment}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Where are you based?</Label>
              <LocationSelector
                value={values.stateCode as string}
                onChange={(code) => {
                  setField("stateCode", code);
                  setBenchmarksApplied(false);
                  setTouchedFields(new Set()); // reset so new benchmarks fill
                }}
              />
              {region && (
                <p className="text-[11px] text-orange-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {region.name} — costs auto-filled from regional averages
                </p>
              )}
            </div>
          </div>

          {benchmarksApplied && estimate && (
            <div className="flex items-center gap-2.5 rounded-md bg-orange-50 border border-orange-200 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-orange-500 shrink-0" />
              <p className="text-[13px] text-orange-700 leading-snug">
                All fields pre-filled with regional averages for your equipment type. Adjust any values that differ for your operation.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Cost Sections ─────────────────────────── */}
      {sections.map((section) => {
        const SectionIcon = section.icon;
        return (
          <Card key={section.id} className="border-slate-200">
            <CardContent className="p-3 sm:p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-slate-50">
                  <SectionIcon className="w-3.5 h-3.5 text-slate-600" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                {section.advanced && (
                  <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">Optional</span>
                )}
              </div>

              <div className="space-y-3">
                {section.fields.map((field) => {
                  const currentValue = values[field.key] as number;
                  const benchmark = getBenchmark(field.benchmarkKey);
                  const isMoney = moneyKeys.has(field.suffix ?? "");
                  const suffixLabel = isMoney
                    ? localizeMoneySuffix(field.suffix ?? "", currency)
                    : field.suffix ?? "";

                  return (
                    <div key={field.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5 flex-1 min-w-0">
                          <field.icon className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{field.label}</span>
                          {field.optional && (
                            <span className="text-[10px] font-normal text-slate-400">(optional)</span>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors">
                                <HelpCircle className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              {field.hint}
                            </TooltipContent>
                          </Tooltip>
                        </Label>
                        {/* Benchmark chip */}
                        {benchmark !== undefined && benchmark > 0 && (
                          <button
                            type="button"
                            title="Click to use regional average"
                            className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2 py-0.5 rounded-md transition-colors shrink-0 cursor-pointer"
                            onClick={() => {
                              setField(field.key, benchmark);
                              setTouchedFields((prev) => {
                                const next = new Set(prev);
                                next.delete(field.key);
                                return next;
                              });
                            }}
                          >
                            avg: {isMoney ? formatMoney(benchmark) : benchmark}{" "}
                            {!isMoney && suffixLabel ? suffixLabel : ""}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step={field.step || "any"}
                          min={field.optional ? 0 : (["workingDaysPerMonth", "workingHoursPerDay", "fuelConsumptionPer100km"].includes(field.key) ? 1 : 0)}
                          className="h-9 text-sm flex-1 border-slate-200 focus:border-slate-400 transition-colors tabular-nums"
                          value={currentValue || ""}
                          placeholder={benchmark ? String(benchmark) : "0"}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const num = parseFloat(raw);
                            if (!isNaN(num) && num >= 0) {
                              setField(field.key, num);
                            } else if (raw === "" || raw === "-") {
                              setField(field.key, 0);
                            }
                            setTouchedFields((prev) => new Set(prev).add(field.key));
                          }}
                        />
                        <span className="text-xs font-medium text-slate-400 w-12 text-right shrink-0">
                          {suffixLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Save button ───────────────────────────── */}
      <div className="flex items-center justify-center gap-3 pt-2">
        <Button
          size="default"
          className="gap-2 min-w-[200px] h-10 text-sm font-semibold bg-orange-400 hover:bg-orange-500 text-white shadow-sm hover:shadow-md transition-all"
          disabled={!canSave || isSaving}
          onClick={handleSave}
        >
          <Save className="w-5 h-5" />
          {isSaving ? "Saving..." : saveLabel}
        </Button>
      </div>

      {!canSave && (
        <p className="text-center text-sm font-medium text-slate-400 flex items-center justify-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Fill in all required fields above to save
        </p>
      )}

      {/* ── Sticky cost summary bar (always visible) ── */}
      <CostSummaryBar values={values} isImperial={isImperial} formatMoney={formatMoney} />
    </div>
  );
}
