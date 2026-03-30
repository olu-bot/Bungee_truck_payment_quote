import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  Package,
  Snowflake,
  Layers,
  Truck,
  Shield,
  Fuel,
  Clock,
  User,
  Timer,
  DollarSign,
  Calendar,
  Zap,
  Container,
  AlertTriangle,
} from "lucide-react";
// Alert is inline — no separate component needed
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

type WizardField = {
  key: string;
  label: string;
  presets: number[];
  suffix?: string;
  step?: string;
};

type WizardStep = {
  title: string;
  icon: typeof Truck;
  fields: WizardField[];
};

function getWizardSteps(unit: MeasurementUnit): WizardStep[] {
  const isImperial = unit === "imperial";
  return [
    {
      title: "Vehicle",
      icon: Truck,
      fields: [
        { key: "monthlyTruckPayment", label: "Monthly truck payment", presets: [1500, 2500, 3500], suffix: "$", step: "any" },
      ],
    },
    {
      title: "Insurance & Overhead",
      icon: Shield,
      fields: [
        { key: "monthlyInsurance", label: "Monthly insurance", presets: [800, 1200, 1600], suffix: "$", step: "any" },
        { key: "monthlyMaintenance", label: "Monthly maintenance", presets: [400, 600, 800], suffix: "$", step: "any" },
        { key: "monthlyPermitsPlates", label: "Monthly permits & plates", presets: [150, 200, 250], suffix: "$", step: "any" },
        { key: "monthlyOther", label: "Monthly other costs", presets: [100, 150, 250], suffix: "$", step: "any" },
      ],
    },
    {
      title: "Operations",
      icon: Calendar,
      fields: [
        { key: "workingDaysPerMonth", label: "Working days per month", presets: [20, 22, 24], step: "any" },
        { key: "workingHoursPerDay", label: "Working hours per day", presets: [8, 10, 12], step: "any" },
      ],
    },
    {
      title: "Driver",
      icon: User,
      fields: [
        { key: "driverPayPerHour", label: "Driver hourly wage", presets: [22, 25, 28], suffix: "$/hr", step: "any" },
        isImperial
          ? { key: "driverPayPerMile", label: "Driver per-mile rate (long haul)", presets: [0.55, 0.65, 0.75], suffix: "$/mi", step: "any" }
          : { key: "driverPayPerMile", label: "Driver per-km rate (long haul)", presets: [0.34, 0.40, 0.47], suffix: "$/km", step: "any" },
        { key: "deadheadPayPercent", label: "Deadhead rate (% of loaded)", presets: [70, 80, 100], suffix: "%", step: "any" },
      ],
    },
    {
      title: "Fuel Consumption",
      icon: Fuel,
      fields: [
        isImperial
          ? { key: "fuelConsumptionPer100km", label: `Fuel consumption (${fuelConsumptionLabel(unit)})`, presets: [5.6, 6.7, 7.8], suffix: "MPG", step: "any" }
          : { key: "fuelConsumptionPer100km", label: `Fuel consumption (${fuelConsumptionLabel(unit)})`, presets: [30, 35, 42], suffix: "L/100km", step: "any" },
      ],
    },
    {
      title: "Dock & Detention",
      icon: Timer,
      fields: [
        { key: "defaultDockTimeMinutes", label: "Default dock time", presets: [30, 60, 90], suffix: "min", step: "any" },
        { key: "detentionRatePerHour", label: "Detention rate/hr", presets: [50, 60, 75], suffix: "$/hr", step: "any" },
      ],
    },
  ];
}

// STEP_LABELS are the same regardless of measurement unit
const STEP_LABELS = ["Vehicle", "Insurance & Overhead", "Operations", "Driver", "Fuel Consumption", "Dock & Detention"];

type WizardValues = Record<string, number | string>;

function defaultWizardValues(): WizardValues {
  return {
    name: "",
    truckType: "",
    monthlyTruckPayment: 0,
    monthlyInsurance: 0,
    monthlyMaintenance: 0,
    monthlyPermitsPlates: 0,
    monthlyOther: 0,
    workingDaysPerMonth: 0,
    workingHoursPerDay: 0,
    driverPayPerHour: 0,
    driverPayPerMile: 0,
    deadheadPayPercent: 100,
    fuelConsumptionPer100km: 0,
    defaultDockTimeMinutes: 0,
    detentionRatePerHour: 0,
  };
}

const EDITABLE_FIELD_KEYS: (keyof Omit<CostProfile, "id" | "name" | "truckType" | "createdAt">)[] = [
  "monthlyTruckPayment",
  "monthlyInsurance",
  "monthlyMaintenance",
  "monthlyPermitsPlates",
  "monthlyOther",
  "workingDaysPerMonth",
  "workingHoursPerDay",
  "driverPayPerHour",
  "driverPayPerMile",
  "fuelConsumptionPer100km",
  "defaultDockTimeMinutes",
  "detentionRatePerHour",
];

// Fields where 0 is a valid value (optional fields)
const OPTIONAL_FIELDS = new Set(["driverPayPerMile", "deadheadPayPercent"]);
// Fields that must be > 0 to avoid division-by-zero in cost calculations
const MUST_BE_POSITIVE = new Set(["workingDaysPerMonth", "workingHoursPerDay", "fuelConsumptionPer100km"]);

function PresetButton({
  value,
  selected,
  suffix,
  formatMoney,
  onClick,
  testId,
}: {
  value: number;
  selected: boolean;
  suffix?: string;
  formatMoney: (n: number) => string;
  onClick: () => void;
  testId: string;
}) {
  const isMoney = suffix === "$" || suffix === "$/hr" || suffix === "$/L" || suffix === "$/mi" || suffix === "$/km";
  const display = isMoney
    ? formatMoney(value)
    : `${value}${suffix ? ` ${suffix}` : ""}`;

  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="sm"
      className="flex-1"
      data-testid={testId}
      onClick={onClick}
    >
      {display}
    </Button>
  );
}

const EQUIPMENT_TYPES = [
  { key: "dry_van", label: "Dry Van", Icon: Package },
  { key: "reefer", label: "Reefer", Icon: Snowflake },
  { key: "flatbed", label: "Flatbed", Icon: Layers },
  { key: "step_deck", label: "Step Deck", Icon: Layers },
  { key: "tanker", label: "Tanker", Icon: Container },
];

function EquipmentTypeSelector({
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
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        {EQUIPMENT_TYPES.map(({ key, label, Icon }) => (
          <Button
            key={key}
            type="button"
            variant={value === key ? "default" : "outline"}
            className="gap-2 text-xs"
            size="sm"
            data-testid={`wizard-equip-${key}`}
            onClick={() => onChange(key)}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant={isCustom ? "default" : "outline"}
          className="gap-2 text-xs"
          size="sm"
          data-testid="wizard-equip-custom"
          onClick={() => onChange("__custom__")}
        >
          <Truck className="w-3.5 h-3.5" />
          Other
        </Button>
      </div>
      {isCustom && (
        <Input
          data-testid="wizard-equip-custom-input"
          placeholder="e.g. Lowboy, Car Hauler, Conestoga..."
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** Default values for a quick-start profile so new users can jump right in */
function quickProfileDefaults(currency: SupportedCurrency): Omit<CostProfile, "id"> {
  // Base values are in USD — convert to user's currency
  const cx = (v: number) => Math.round(convertCurrency(v, "USD", currency) * 100) / 100;
  return {
    name: "Quick Start Profile",
    truckType: "dry_van",
    monthlyTruckPayment: cx(2500),
    monthlyInsurance: cx(1200),
    monthlyMaintenance: cx(600),
    monthlyPermitsPlates: cx(200),
    monthlyOther: cx(150),
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: cx(25),
    driverPayPerMile: cx(0.65),
    deadheadPayPercent: 80,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: cx(60),
    currency,
    createdAt: new Date().toISOString(),
  };
}

export type CostProfileWizardProps = {
  onSave: (data: Omit<CostProfile, "id">) => void | Promise<void>;
  onBack?: () => void;
  onSkip?: () => void;
  backLabel?: string;
  saveLabel?: string;
  skipLabel?: string;
  defaultValues?: Partial<WizardValues>;
  /** When true, shows Skip button on first step (e.g. onboarding). */
  allowSkip?: boolean;
  isSaving?: boolean;
  backTestId?: string;
  /** Display currency for money presets and suffixes (from user / onboarding country). */
  currency?: SupportedCurrency;
  /** Measurement unit for fuel consumption display (metric = L/100km, imperial = MPG). */
  measurementUnit?: MeasurementUnit;
};

export function CostProfileWizard({
  onSave,
  onBack,
  onSkip,
  backLabel = "Back",
  saveLabel = "Save Profile",
  skipLabel = "Skip for now",
  defaultValues,
  allowSkip = false,
  isSaving = false,
  backTestId = "wizard-back",
  currency = "CAD",
  measurementUnit = "metric",
}: CostProfileWizardProps) {
  const formatMoney = useMemo(
    () => (n: number) => formatCurrencyAmount(n, currency),
    [currency]
  );
  const WIZARD_STEPS = useMemo(() => getWizardSteps(measurementUnit), [measurementUnit]);
  const isImperial = measurementUnit === "imperial";
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardValues, setWizardValues] = useState<WizardValues>(() => {
    const base = defaultWizardValues();
    if (defaultValues) {
      for (const [k, v] of Object.entries(defaultValues)) {
        if (v !== undefined) (base as Record<string, string | number>)[k] = v as string | number;
      }
    }
    return base;
  });
  const [selectedPresets, setSelectedPresets] = useState<Record<string, number>>({});
  const [customEquipment, setCustomEquipment] = useState("");
  const [quickProfileCreated, setQuickProfileCreated] = useState(false);

  function setWizardField(key: string, value: number | string) {
    setWizardValues((prev) => ({ ...prev, [key]: value }));
  }

  function selectPreset(key: string, value: number) {
    setSelectedPresets((prev) => ({ ...prev, [key]: value }));
    setWizardField(key, value);
  }

  function handleCustomInput(key: string, rawValue: string) {
    const num = parseFloat(rawValue);
    if (!isNaN(num)) {
      setWizardField(key, num);
      setSelectedPresets((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else if (rawValue === "") {
      setWizardField(key, 0);
      setSelectedPresets((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function canProceed(): boolean {
    const hasName = typeof wizardValues.name === "string" && wizardValues.name.trim().length > 0;
    const rawType = wizardValues.truckType as string;
    const hasTruckType = rawType === "__custom__" ? customEquipment.trim().length > 0 : rawType.trim().length > 0;

    if (wizardStep === 0) {
      return hasName && hasTruckType;
    }

    const isLastStep = wizardStep === WIZARD_STEPS.length - 1;
    if (isLastStep) {
      const allNumericFieldsValid = EDITABLE_FIELD_KEYS.every((k) => {
        const v = wizardValues[k];
        if (MUST_BE_POSITIVE.has(k)) return typeof v === "number" && v > 0;
        return typeof v === "number" && v >= 0;
      });
      return hasName && hasTruckType && allNumericFieldsValid;
    }

    const step = WIZARD_STEPS[wizardStep];
    return step.fields.every((f) => {
      const v = wizardValues[f.key];
      if (MUST_BE_POSITIVE.has(f.key)) return typeof v === "number" && v > 0;
      return typeof v === "number" && v >= 0;
    });
  }

  function handleQuickProfile() {
    const defaults = quickProfileDefaults(currency);
    onSave(defaults);
    setQuickProfileCreated(true);
  }

  function handleSaveProfile() {
    const v = wizardValues;
    // Convert fuel consumption from display unit to internal L/100km
    const fuelValue = v.fuelConsumptionPer100km as number;
    const fuelAsLPer100km = isImperial ? mpgToLPer100km(fuelValue) : fuelValue;
    const resolvedType = (v.truckType as string) === "__custom__" ? customEquipment.trim() : (v.truckType as string);
    onSave({
      name: v.name as string,
      truckType: resolvedType,
      monthlyTruckPayment: v.monthlyTruckPayment as number,
      monthlyInsurance: v.monthlyInsurance as number,
      monthlyMaintenance: v.monthlyMaintenance as number,
      monthlyPermitsPlates: v.monthlyPermitsPlates as number,
      monthlyOther: v.monthlyOther as number,
      workingDaysPerMonth: v.workingDaysPerMonth as number,
      workingHoursPerDay: v.workingHoursPerDay as number,
      driverPayPerHour: v.driverPayPerHour as number,
      driverPayPerMile: (v.driverPayPerMile as number) || 0,
      deadheadPayPercent: (v.deadheadPayPercent as number) || 100,
      fuelConsumptionPer100km: Math.round(fuelAsLPer100km * 100) / 100,
      defaultDockTimeMinutes: v.defaultDockTimeMinutes as number,
      detentionRatePerHour: v.detentionRatePerHour as number,
      currency, // Store which currency the values were entered in
      createdAt: new Date().toISOString(),
    });
  }

  const step = WIZARD_STEPS[wizardStep];
  const StepIcon = step.icon;
  const progressPercent = ((wizardStep + 1) / WIZARD_STEPS.length) * 100;
  const isLastStep = wizardStep === WIZARD_STEPS.length - 1;

  return (
    <div className="space-y-3">
      {onBack && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            data-testid={backTestId}
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {backLabel}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-wider">
          <span>
            Step {wizardStep + 1} of {WIZARD_STEPS.length}
          </span>
          <span>{STEP_LABELS[wizardStep]}</span>
        </div>
        <Progress value={progressPercent} className="h-2" data-testid="wizard-progress" />
        <div className="flex gap-1">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= wizardStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <StepIcon className="w-4 h-4 text-primary" />
            {step.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-3 space-y-3">
          {wizardStep === 0 && (
            <>
              {/* Quick Profile alert — shown after creation */}
              {quickProfileCreated && (
                <div className="flex items-start gap-2 rounded-md border border-orange-300 bg-orange-50 p-3">
                  <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-orange-800">
                    Quick profile created with industry-average values. For the most accurate cost estimates, fine-tune your profile in <strong>Company Profile</strong>.
                  </p>
                </div>
              )}

              {/* Quick Profile button */}
              {!quickProfileCreated && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                  data-testid="wizard-quick-profile"
                  disabled={isSaving}
                  onClick={handleQuickProfile}
                >
                  <Zap className="w-4 h-4" />
                  {isSaving ? "Creating..." : "Quick Profile — Start with defaults"}
                </Button>
              )}

              {!quickProfileCreated && (
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <div className="flex-1 h-px bg-slate-200" />
                  or build your own
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-500">Profile Name</Label>
                <Input
                  data-testid="wizard-profile-name"
                  placeholder="e.g. My Dry Van, Reefer Unit #3"
                  value={wizardValues.name as string}
                  onChange={(e) => setWizardField("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-500">Equipment Type</Label>
                <EquipmentTypeSelector
                  value={wizardValues.truckType as string}
                  customValue={customEquipment}
                  onChange={(v) => setWizardField("truckType", v)}
                  onCustomChange={setCustomEquipment}
                />
              </div>
            </>
          )}

          {step.fields.map((field) => {
            const currentValue = wizardValues[field.key] as number;
            return (
              <div key={field.key} className="space-y-2">
                <Label className="text-xs font-medium text-slate-500">{field.label}</Label>
                <div className="flex gap-3">
                  {field.presets.map((preset) => (
                    <PresetButton
                      key={preset}
                      value={preset}
                      selected={selectedPresets[field.key] === preset}
                      suffix={field.suffix}
                      formatMoney={formatMoney}
                      testId={`wizard-preset-${field.key}-${preset}`}
                      onClick={() => selectPreset(field.key, preset)}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">Custom:</span>
                  <Input
                    data-testid={`wizard-custom-${field.key}`}
                    type="number"
                    step="any"
                    placeholder="Enter value"
                    value={currentValue > 0 ? String(currentValue) : ""}
                    onChange={(e) => handleCustomInput(field.key, e.target.value)}
                  />
                  {field.suffix && (
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {localizeMoneySuffix(field.suffix, currency) ?? field.suffix}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <div>
          {allowSkip && wizardStep === 0 && onSkip && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSkip}
            >
              {skipLabel}
            </Button>
          )}
        </div>
        <div className="flex gap-2 ml-auto">
          <Button
            variant="destructive"
            size="sm"
            data-testid="wizard-prev"
            disabled={wizardStep === 0}
            onClick={() => setWizardStep((s) => s - 1)}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          {isLastStep ? (
            <Button
              size="sm"
              data-testid="wizard-save"
              disabled={!canProceed() || isSaving}
              onClick={handleSaveProfile}
            >
              <Save className="w-4 h-4 mr-1" />
              {isSaving ? "Saving..." : saveLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              data-testid="wizard-next"
              disabled={!canProceed()}
              onClick={() => setWizardStep((s) => s + 1)}
            >
              Next
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
