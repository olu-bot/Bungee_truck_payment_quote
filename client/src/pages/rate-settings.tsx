import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationSuggestInput } from "@/components/LocationSuggestInput";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Settings,
  DollarSign,
  Fuel,
  Plus,
  Trash2,
  ArrowRight,
  Package,
  Snowflake,
  Layers,
  Save,
  Route,
  Clock,
  User,
  Truck,
  Shield,
  Wrench,
  MoreHorizontal,
  Gauge,
  Timer,
} from "lucide-react";
import type { RateTable, Lane, HourlyRate } from "@shared/schema";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { currencySymbol, formatCurrencyAmount, resolveWorkspaceCurrency } from "@/lib/currency";

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

// Field config for hourly rate editing
const HOURLY_FIELDS: {
  key: keyof HourlyRate;
  label: string;
  suffix: string;
  step: string;
  icon: typeof User;
}[] = [
  { key: "driverPayPerHour", label: "Driver Pay", suffix: "/hr", step: "1", icon: User },
  { key: "truckCostPerHour", label: "Truck Cost", suffix: "/hr", step: "0.5", icon: Truck },
  { key: "insurancePerHour", label: "Insurance", suffix: "/hr", step: "0.5", icon: Shield },
  { key: "maintenancePerHour", label: "Maintenance", suffix: "/hr", step: "0.5", icon: Wrench },
  { key: "miscPerHour", label: "Misc / Other", suffix: "/hr", step: "0.5", icon: MoreHorizontal },
  { key: "fuelPerKm", label: "Fuel Cost", suffix: "/km", step: "0.01", icon: Fuel },
  { key: "citySpeedKmh", label: "Avg City Speed", suffix: "km/h", step: "1", icon: Gauge },
  { key: "detentionRatePerHour", label: "Detention Rate", suffix: "/hr", step: "5", icon: Timer },
];

export default function RateSettings() {
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const currencySym = useMemo(() => currencySymbol(currency), [currency]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );

  // Rate editing state
  const [editingRates, setEditingRates] = useState<
    Record<string, { ratePerMile: string; fuelSurchargePercent: string; minCharge: string }>
  >({});

  // Hourly rate editing state
  const [editingHourly, setEditingHourly] = useState<
    Record<string, Record<string, string>>
  >({});

  // Lane form state
  const [laneDialogOpen, setLaneDialogOpen] = useState(false);
  const [newLane, setNewLane] = useState({
    origin: "",
    destination: "",
    truckType: "dry_van",
    fixedPrice: "",
    estimatedMiles: "",
  });

  const { data: rates = [] } = useQuery<RateTable[]>({
    queryKey: ["/api/rates"],
  });

  const { data: lanes = [] } = useQuery<Lane[]>({
    queryKey: ["/api/lanes"],
  });

  const { data: hourlyRates = [] } = useQuery<HourlyRate[]>({
    queryKey: ["/api/hourly-rates"],
  });

  // Rate update mutation
  const updateRateMutation = useMutation({
    mutationFn: async ({
      truckType,
      ratePerMile,
      fuelSurchargePercent,
      minCharge,
    }: {
      truckType: string;
      ratePerMile: number;
      fuelSurchargePercent: number;
      minCharge: number;
    }) => {
      const res = await apiRequest("PUT", `/api/rates/${truckType}`, {
        ratePerMile,
        fuelSurchargePercent,
        minCharge,
      });
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rates"] });
      setEditingRates((prev) => {
        const next = { ...prev };
        delete next[vars.truckType];
        return next;
      });
      toast({ title: "Rate updated", description: `${TRUCK_LABELS[vars.truckType]} rates saved.` });
    },
  });

  // Hourly rate update mutation
  const updateHourlyMutation = useMutation({
    mutationFn: async ({
      truckType,
      data,
    }: {
      truckType: string;
      data: Record<string, number>;
    }) => {
      const res = await apiRequest("PUT", `/api/hourly-rates/${truckType}`, data);
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hourly-rates"] });
      setEditingHourly((prev) => {
        const next = { ...prev };
        delete next[vars.truckType];
        return next;
      });
      toast({ title: "Hourly rates updated", description: `${TRUCK_LABELS[vars.truckType]} hourly costs saved.` });
    },
  });

  // Lane mutations
  const createLaneMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lanes", {
        origin: newLane.origin,
        destination: newLane.destination,
        truckType: newLane.truckType,
        fixedPrice: Number(newLane.fixedPrice),
        estimatedMiles: Number(newLane.estimatedMiles),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lanes"] });
      setNewLane({
        origin: "",
        destination: "",
        truckType: "dry_van",
        fixedPrice: "",
        estimatedMiles: "",
      });
      setLaneDialogOpen(false);
      toast({ title: "Lane added" });
    },
  });

  const deleteLaneMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lanes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lanes"] });
      toast({ title: "Lane removed" });
    },
  });

  function startEditing(rate: RateTable) {
    setEditingRates((prev) => ({
      ...prev,
      [rate.truckType]: {
        ratePerMile: String(rate.ratePerMile),
        fuelSurchargePercent: String(rate.fuelSurchargePercent),
        minCharge: String(rate.minCharge),
      },
    }));
  }

  function saveRate(truckType: string) {
    const edit = editingRates[truckType];
    if (!edit) return;
    updateRateMutation.mutate({
      truckType,
      ratePerMile: Number(edit.ratePerMile),
      fuelSurchargePercent: Number(edit.fuelSurchargePercent),
      minCharge: Number(edit.minCharge),
    });
  }

  function startEditingHourly(rate: HourlyRate) {
    const fields: Record<string, string> = {};
    for (const f of HOURLY_FIELDS) {
      fields[f.key] = String(rate[f.key]);
    }
    setEditingHourly((prev) => ({ ...prev, [rate.truckType]: fields }));
  }

  function saveHourlyRate(truckType: string) {
    const edit = editingHourly[truckType];
    if (!edit) return;
    const payload: Record<string, any> = { truckType };
    for (const f of HOURLY_FIELDS) {
      payload[f.key] = Number(edit[f.key]);
    }
    updateHourlyMutation.mutate({ truckType, data: payload });
  }

  function getAllInHourly(rate: HourlyRate): number {
    return rate.driverPayPerHour + rate.truckCostPerHour +
      rate.insurancePerHour + rate.maintenancePerHour + rate.miscPerHour;
  }

  return (
    <div className="space-y-8">
      {/* Per-Mile Rates */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            Per-Mile Rate Table
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Base carrier rates used for per-mile calculations. Click a row to
            edit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {rates.map((rate) => {
            const Icon = TRUCK_ICONS[rate.truckType] || Package;
            const isEditing = !!editingRates[rate.truckType];
            const edit = editingRates[rate.truckType];

            return (
              <Card
                key={rate.truckType}
                className="border-border cursor-pointer"
                data-testid={`card-rate-${rate.truckType}`}
                onClick={() => !isEditing && startEditing(rate)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    {TRUCK_LABELS[rate.truckType]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <div
                      className="space-y-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Rate/Mile ({currencySym})</Label>
                        <Input
                          data-testid={`input-rate-${rate.truckType}`}
                          type="number"
                          step="0.05"
                          value={edit.ratePerMile}
                          onChange={(e) =>
                            setEditingRates((prev) => ({
                              ...prev,
                              [rate.truckType]: {
                                ...prev[rate.truckType],
                                ratePerMile: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fuel Surcharge %</Label>
                        <Input
                          data-testid={`input-fsc-${rate.truckType}`}
                          type="number"
                          step="0.5"
                          value={edit.fuelSurchargePercent}
                          onChange={(e) =>
                            setEditingRates((prev) => ({
                              ...prev,
                              [rate.truckType]: {
                                ...prev[rate.truckType],
                                fuelSurchargePercent: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Min Charge ({currencySym})</Label>
                        <Input
                          data-testid={`input-min-${rate.truckType}`}
                          type="number"
                          value={edit.minCharge}
                          onChange={(e) =>
                            setEditingRates((prev) => ({
                              ...prev,
                              [rate.truckType]: {
                                ...prev[rate.truckType],
                                minCharge: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          data-testid={`button-save-rate-${rate.truckType}`}
                          size="sm"
                          onClick={() => saveRate(rate.truckType)}
                          disabled={updateRateMutation.isPending}
                        >
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditingRates((prev) => {
                              const next = { ...prev };
                              delete next[rate.truckType];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Rate/mile</span>
                        <span className="font-medium">
                          {formatCurrency(rate.ratePerMile)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Fuel className="w-3 h-3" />
                          Fuel surcharge
                        </span>
                        <span className="font-medium">
                          {rate.fuelSurchargePercent}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min charge</span>
                        <span className="font-medium">
                          {formatCurrency(rate.minCharge)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground pt-1">
                        Click to edit
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* Hourly Operating Costs (Local P&D) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Hourly Operating Costs
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Time-based cost inputs for Local P&D quotes. Click a card to edit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {hourlyRates.map((rate) => {
            const Icon = TRUCK_ICONS[rate.truckType] || Package;
            const isEditing = !!editingHourly[rate.truckType];
            const edit = editingHourly[rate.truckType];
            const allIn = getAllInHourly(rate);

            return (
              <Card
                key={rate.truckType}
                className="border-border cursor-pointer"
                data-testid={`card-hourly-${rate.truckType}`}
                onClick={() => !isEditing && startEditingHourly(rate)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {TRUCK_LABELS[rate.truckType]}
                    </span>
                    <Badge variant="secondary" className="text-xs font-semibold">
                      {formatCurrency(allIn)}/hr
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <div
                      className="space-y-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {HOURLY_FIELDS.map((f) => {
                        const FieldIcon = f.icon;
                        return (
                          <div key={f.key} className="space-y-1">
                            <Label className="text-xs flex items-center gap-1">
                              <FieldIcon className="w-3 h-3 text-muted-foreground" />
                              {f.label} ({f.suffix})
                            </Label>
                            <Input
                              data-testid={`input-hourly-${rate.truckType}-${f.key}`}
                              type="number"
                              step={f.step}
                              value={edit[f.key]}
                              onChange={(e) =>
                                setEditingHourly((prev) => ({
                                  ...prev,
                                  [rate.truckType]: {
                                    ...prev[rate.truckType],
                                    [f.key]: e.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 pt-1">
                        <Button
                          data-testid={`button-save-hourly-${rate.truckType}`}
                          size="sm"
                          onClick={() => saveHourlyRate(rate.truckType)}
                          disabled={updateHourlyMutation.isPending}
                        >
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditingHourly((prev) => {
                              const next = { ...prev };
                              delete next[rate.truckType];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" /> Driver
                        </span>
                        <span className="font-medium">{formatCurrency(rate.driverPayPerHour)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Truck className="w-3 h-3" /> Truck
                        </span>
                        <span className="font-medium">{formatCurrency(rate.truckCostPerHour)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Shield className="w-3 h-3" /> Insurance
                        </span>
                        <span className="font-medium">{formatCurrency(rate.insurancePerHour)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Wrench className="w-3 h-3" /> Maint.
                        </span>
                        <span className="font-medium">{formatCurrency(rate.maintenancePerHour)}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <MoreHorizontal className="w-3 h-3" /> Misc
                        </span>
                        <span className="font-medium">{formatCurrency(rate.miscPerHour)}/hr</span>
                      </div>
                      <Separator className="my-1.5" />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Fuel className="w-3 h-3" /> Fuel
                        </span>
                        <span className="font-medium">{formatCurrency(rate.fuelPerKm)}/km</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Gauge className="w-3 h-3" /> City Speed
                        </span>
                        <span className="font-medium">{rate.citySpeedKmh} km/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Timer className="w-3 h-3" /> Detention
                        </span>
                        <span className="font-medium">{formatCurrency(rate.detentionRatePerHour)}/hr</span>
                      </div>
                      <p className="text-xs text-muted-foreground pt-1">
                        Click to edit
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* Fixed Lane Pricing */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              Fixed Lane Pricing
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Pre-negotiated carrier rates for known routes.
            </p>
          </div>
          <Dialog open={laneDialogOpen} onOpenChange={setLaneDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-lane">
                <Plus className="w-4 h-4 mr-1" />
                Add Lane
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Fixed Lane</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Origin</Label>
                    <LocationSuggestInput
                      data-testid="input-new-lane-origin"
                      placeholder="e.g. Toronto, ON"
                      value={newLane.origin}
                      onChange={(v) =>
                        setNewLane({ ...newLane, origin: v })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Destination</Label>
                    <LocationSuggestInput
                      data-testid="input-new-lane-destination"
                      placeholder="e.g. Montreal, QC"
                      value={newLane.destination}
                      onChange={(v) =>
                        setNewLane({ ...newLane, destination: v })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Truck Type</Label>
                  <Select
                    value={newLane.truckType}
                    onValueChange={(v) =>
                      setNewLane({ ...newLane, truckType: v })
                    }
                  >
                    <SelectTrigger data-testid="select-new-lane-truck">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dry_van">Dry Van</SelectItem>
                      <SelectItem value="reefer">Reefer</SelectItem>
                      <SelectItem value="flatbed">Flatbed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Fixed Price ({currencySym})</Label>
                    <Input
                      data-testid="input-new-lane-price"
                      type="number"
                      placeholder="0.00"
                      value={newLane.fixedPrice}
                      onChange={(e) =>
                        setNewLane({ ...newLane, fixedPrice: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Est. Miles</Label>
                    <Input
                      data-testid="input-new-lane-miles"
                      type="number"
                      placeholder="0"
                      value={newLane.estimatedMiles}
                      onChange={(e) =>
                        setNewLane({
                          ...newLane,
                          estimatedMiles: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <Button
                  data-testid="button-save-lane"
                  className="w-full"
                  onClick={() => createLaneMutation.mutate()}
                  disabled={
                    createLaneMutation.isPending ||
                    !newLane.origin ||
                    !newLane.destination ||
                    !newLane.fixedPrice
                  }
                >
                  {createLaneMutation.isPending ? "Saving..." : "Save Lane"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {lanes.length === 0 ? (
          <Card className="border-dashed border-border">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Route className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No fixed lanes configured. Add a lane to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="text-right w-[100px]">
                      Price
                    </TableHead>
                    <TableHead className="text-right w-[80px]">
                      Miles
                    </TableHead>
                    <TableHead className="text-right w-[100px]">
                      {currencySym}/Mile
                    </TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lanes.map((lane) => {
                    const Icon = TRUCK_ICONS[lane.truckType] || Package;
                    const perMile =
                      lane.estimatedMiles > 0
                        ? lane.fixedPrice / lane.estimatedMiles
                        : 0;
                    return (
                      <TableRow key={lane.id} data-testid={`row-lane-${lane.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            <span>{lane.origin}</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span>{lane.destination}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Icon className="w-3 h-3" />
                            {TRUCK_LABELS[lane.truckType]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          {formatCurrency(lane.fixedPrice)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {lane.estimatedMiles.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatCurrency(perMile)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-delete-lane-${lane.id}`}
                            onClick={() => deleteLaneMutation.mutate(lane.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
