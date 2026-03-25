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
} from "lucide-react";
import type { CostProfile } from "@shared/schema";
import {
  formatCurrencyAmount,
  localizeMoneySuffix,
  type SupportedCurrency,
} from "@/lib/currency";

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

const WIZARD_STEPS: WizardStep[] = [
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
    ],
  },
  {
    title: "Fuel Consumption",
    icon: Fuel,
    fields: [
      { key: "fuelConsumptionPer100km", label: "Fuel consumption (L/100km)", presets: [30, 35, 42], step: "any" },
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

const STEP_LABELS = WIZARD_STEPS.map((s) => s.title);

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
  "fuelConsumptionPer100km",
  "defaultDockTimeMinutes",
  "detentionRatePerHour",
];

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
  const display =
    suffix === "$" || suffix === "$/hr" || suffix === "$/L"
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

function TruckTypeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const types = [
    { key: "dry_van", label: "Dry Van", Icon: Package },
    { key: "reefer", label: "Reefer", Icon: Snowflake },
    { key: "flatbed", label: "Flatbed", Icon: Layers },
  ];

  return (
    <div className="flex gap-2">
      {types.map(({ key, label, Icon }) => (
        <Button
          key={key}
          type="button"
          variant={value === key ? "default" : "outline"}
          className="flex-1 gap-2"
          data-testid={`wizard-truck-${key}`}
          onClick={() => onChange(key)}
        >
          <Icon className="w-4 h-4" />
          {label}
        </Button>
      ))}
    </div>
  );
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
}: CostProfileWizardProps) {
  const formatMoney = useMemo(
    () => (n: number) => formatCurrencyAmount(n, currency),
    [currency]
  );
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
    const hasTruckType = typeof wizardValues.truckType === "string" && wizardValues.truckType.trim().length > 0;

    if (wizardStep === 0) {
      return hasName && hasTruckType;
    }

    const isLastStep = wizardStep === WIZARD_STEPS.length - 1;
    if (isLastStep) {
      const allNumericFieldsValid = EDITABLE_FIELD_KEYS.every((k) => {
        const v = wizardValues[k];
        return typeof v === "number" && v > 0;
      });
      return hasName && hasTruckType && allNumericFieldsValid;
    }

    const step = WIZARD_STEPS[wizardStep];
    return step.fields.every((f) => {
      const v = wizardValues[f.key];
      return typeof v === "number" && v > 0;
    });
  }

  function handleSaveProfile() {
    const v = wizardValues;
    onSave({
      name: v.name as string,
      truckType: v.truckType as string,
      monthlyTruckPayment: v.monthlyTruckPayment as number,
      monthlyInsurance: v.monthlyInsurance as number,
      monthlyMaintenance: v.monthlyMaintenance as number,
      monthlyPermitsPlates: v.monthlyPermitsPlates as number,
      monthlyOther: v.monthlyOther as number,
      workingDaysPerMonth: v.workingDaysPerMonth as number,
      workingHoursPerDay: v.workingHoursPerDay as number,
      driverPayPerHour: v.driverPayPerHour as number,
      fuelConsumptionPer100km: v.fuelConsumptionPer100km as number,
      defaultDockTimeMinutes: v.defaultDockTimeMinutes as number,
      detentionRatePerHour: v.detentionRatePerHour as number,
      createdAt: new Date().toISOString(),
    });
  }

  const step = WIZARD_STEPS[wizardStep];
  const StepIcon = step.icon;
  const progressPercent = ((wizardStep + 1) / WIZARD_STEPS.length) * 100;
  const isLastStep = wizardStep === WIZARD_STEPS.length - 1;

  return (
    <div className="space-y-6">
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
        <div className="flex items-center justify-between text-xs text-muted-foreground">
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

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <StepIcon className="w-4 h-4 text-primary" />
            {step.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {wizardStep === 0 && (
            <>
              <div className="space-y-2">
                <Label className="text-sm">Profile Name</Label>
                <Input
                  data-testid="wizard-profile-name"
                  placeholder="e.g. My Dry Van, Reefer Unit #3"
                  value={wizardValues.name as string}
                  onChange={(e) => setWizardField("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Truck Type</Label>
                <TruckTypeSelector
                  value={wizardValues.truckType as string}
                  onChange={(v) => setWizardField("truckType", v)}
                />
              </div>
            </>
          )}

          {step.fields.map((field) => {
            const currentValue = wizardValues[field.key] as number;
            return (
              <div key={field.key} className="space-y-2">
                <Label className="text-sm">{field.label}</Label>
                <div className="flex gap-2">
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
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Custom:</span>
                  <Input
                    data-testid={`wizard-custom-${field.key}`}
                    type="number"
                    step="any"
                    placeholder="Enter value"
                    value={
                      selectedPresets[field.key] !== undefined
                        ? ""
                        : currentValue > 0
                          ? String(currentValue)
                          : ""
                    }
                    onChange={(e) => handleCustomInput(field.key, e.target.value)}
                  />
                  {field.suffix && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
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
