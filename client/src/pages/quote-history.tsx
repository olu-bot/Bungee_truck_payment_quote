import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  ArrowRight,
  Package,
  Snowflake,
  Layers,
  FileText,
  Eye,
} from "lucide-react";
import type { Quote } from "@shared/schema";
import {
  parseRouteBuilderSnapshot,
  type RouteBuilderSnapshot,
} from "@/lib/routeBuilderSnapshot";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  currencySymbol,
  formatCurrencyAmount,
  type SupportedCurrency,
  resolveWorkspaceCurrency,
} from "@/lib/currency";
import {
  type MeasurementUnit,
  resolveMeasurementUnit,
  displayDistance,
  distanceLabel,
} from "@/lib/measurement";

const TRUCK_ICONS: Record<string, typeof Package> = {
  dry_van: Package,
  reefer: Snowflake,
  flatbed: Layers,
};

const TRUCK_LABELS: Record<string, string> = {
  dry_van: "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RouteBuilderSnapshotView({
  snap,
  currency,
  measureUnit,
}: {
  snap: RouteBuilderSnapshot;
  currency: SupportedCurrency;
  measureUnit: MeasurementUnit;
}) {
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const sym = currencySymbol(currency);
  const dLabel = distanceLabel(measureUnit);
  return (
    <div className="space-y-4 text-sm max-h-[70vh] overflow-y-auto pr-1">
      {snap.chatUserMessage ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Chat: </span>
          {snap.chatUserMessage}
        </p>
      ) : null}
      <div>
        <p className="font-semibold">{snap.routeSummary}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {displayDistance(snap.totalKm, measureUnit).toFixed(0)} {dLabel} · {snap.totalMin.toFixed(0)} min (est.)
          {snap.returnKm > 0 ? ` + ${displayDistance(snap.returnKm, measureUnit).toFixed(0)} ${dLabel} return` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Fuel {formatCurrencyAmount(snap.fuelPricePerLitre, currency)}/L
          {snap.yardLabel ? ` · Yard: ${snap.yardLabel}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-border p-2">
          <div className="text-muted-foreground uppercase tracking-wide">Delivery</div>
          <div className="font-semibold text-primary">{formatCurrency(snap.deliveryCost)}</div>
          <div className="text-muted-foreground">with fuel</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="text-muted-foreground uppercase tracking-wide">Full trip</div>
          <div className="font-semibold">{formatCurrency(snap.fullTripCost)}</div>
          <div className="text-muted-foreground">+{formatCurrency(snap.deadheadCost)} deadhead</div>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Margins</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {snap.tiers.map((t) => (
            <div key={t.label} className="rounded border border-border p-2 text-xs">
              <div className="text-muted-foreground">{t.label}</div>
              <div className="font-semibold">{formatCurrency(t.price)}</div>
              <div className="text-muted-foreground">+{formatCurrency(t.marginAmount)}</div>
            </div>
          ))}
        </div>
      </div>
      {snap.customQuoteInput || snap.customQuote ? (
        <div className="text-xs rounded border border-border p-2">
          <span className="text-muted-foreground">Custom quote: </span>
          {snap.customQuoteInput ? `${sym}${snap.customQuoteInput}` : "—"}
          {snap.customQuote ? (
            <span className="ml-2">
              → {snap.customQuote.marginPercent.toFixed(1)}% margin (
              {formatCurrency(snap.customQuote.marginAmount)})
            </span>
          ) : null}
        </div>
      ) : null}
      <Separator />
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase">Leg breakdown</div>
        {(() => {
          let legNum = 0;
          return snap.legs.map((leg, i) => {
            const isDeadhead = leg.isDeadhead ?? (leg.type === "return" || leg.type === "deadhead");
            if (!isDeadhead) legNum += 1;
            const billableHrs = leg.totalBillableHours;
            return (
            <div key={i} className="rounded border border-border p-3 space-y-2 text-xs">
              <div className="font-medium">
                {isDeadhead
                  ? `Deadhead · ${leg.from} → ${leg.to}`
                  : `Leg ${legNum} · ${leg.from} → ${leg.to} (est.)`}
                {isDeadhead ? (
                  <Badge className="ml-2 text-[10px] bg-orange-600 text-white border-0">
                    EMPTY
                  </Badge>
                ) : leg.isLocal ? (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    LOCAL
                  </Badge>
                ) : null}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Drive time</span>
                <span>{leg.driveMinutes} min</span>
              </div>
              {!isDeadhead && leg.dockMinutes > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Load + unload</span>
                  <span>{(leg.dockMinutes / 60).toFixed(0)} hrs</span>
                </div>
              ) : null}
              <div className="flex justify-between font-medium">
                <span>Total billable hrs</span>
                <span>{billableHrs.toFixed(2)} hrs</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Labor (no fuel)</span>
                <span>
                  {billableHrs.toFixed(2)} × {formatCurrency(snap.allInHourlyRate)} ={" "}
                  {formatCurrency(leg.laborCost)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fuel ({displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel})</span>
                <span>
                  {displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel} × {formatCurrency(measureUnit === "imperial" ? snap.fuelPerKm * 1.609344 : snap.fuelPerKm)}/{dLabel} ={" "}
                  {formatCurrency(leg.fuelCost)}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-primary pt-1">
                <span>Total w/ fuel</span>
                <span>{formatCurrency(leg.legCost)}</span>
              </div>
            </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

export default function QuoteHistory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, currency),
    [currency]
  );
  const [detailQuote, setDetailQuote] = useState<Quote | null>(null);
  const detailSnap = detailQuote
    ? parseRouteBuilderSnapshot(detailQuote.routeSnapshotJson)
    : null;

  const { data: quotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["firebase", "quotes", scopeId ?? ""],
    queryFn: () => firebaseDb.getQuotes(scopeId),
    enabled: !!scopeId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const ok = await firebaseDb.deleteQuote(scopeId, id);
      if (!ok) throw new Error("Quote not found");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "quotes", scopeId ?? ""] });
      toast({ title: "Quote deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 bg-muted/50 rounded-md animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium mb-1">No saved quotes yet</h3>
          <p className="text-sm text-muted-foreground max-w-[280px]">
            Route builds (Build Route or Route Chat) and saved quotes from the calculator appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {quotes.length} saved quote{quotes.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Mobile cards */}
      <div className="block lg:hidden space-y-3">
        {quotes.map((q) => {
          const Icon = TRUCK_ICONS[q.truckType] || Package;
          const rbSnap = parseRouteBuilderSnapshot(q.routeSnapshotJson);
          return (
            <Card key={q.id} className="border-border" data-testid={`card-quote-${q.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Icon className="w-3 h-3" />
                      {TRUCK_LABELS[q.truckType] || q.truckType}
                    </Badge>
                    {q.quoteSource === "route_builder" ? (
                      <Badge variant="outline" className="text-[10px]">
                        Route build
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground font-mono">
                      {q.quoteNumber}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {rbSnap ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-view-quote-${q.id}`}
                        onClick={() => setDetailQuote(q)}
                        className="h-8 w-8 p-0 text-muted-foreground"
                        title="View route details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-delete-quote-${q.id}`}
                      onClick={() => deleteMutation.mutate(q.id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>{q.origin}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span>{q.destination}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Carrier</span>
                    <span className="font-medium">
                      {formatCurrency(q.totalCarrierCost)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">
                      Customer
                    </span>
                    <span className="font-medium text-primary">
                      {formatCurrency(q.customerPrice)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">GP</span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {formatCurrency(q.grossProfit)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(q.createdAt)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <Card className="border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Quote #</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="w-[90px]">Type</TableHead>
                  <TableHead className="text-right w-[100px]">
                    {measureUnit === "imperial" ? "Miles" : "KM"}
                  </TableHead>
                  <TableHead className="text-right w-[120px]">
                    Carrier Cost
                  </TableHead>
                  <TableHead className="text-right w-[120px]">
                    Customer Price
                  </TableHead>
                  <TableHead className="text-right w-[100px]">GP</TableHead>
                  <TableHead className="text-right w-[60px]">GP%</TableHead>
                  <TableHead className="w-[140px]">Date</TableHead>
                  <TableHead className="w-[88px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => {
                  const Icon = TRUCK_ICONS[q.truckType] || Package;
                  const rbSnap = parseRouteBuilderSnapshot(q.routeSnapshotJson);
                  return (
                    <TableRow key={q.id} data-testid={`row-quote-${q.id}`}>
                      <TableCell className="font-mono text-xs">
                        {q.quoteNumber}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="truncate max-w-[120px]">
                            {q.origin}
                          </span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="truncate max-w-[120px]">
                            {q.destination}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Icon className="w-3 h-3" />
                            {TRUCK_LABELS[q.truckType]}
                          </Badge>
                          {q.quoteSource === "route_builder" ? (
                            <Badge variant="outline" className="text-[10px] px-1.5">
                              Route build
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(measureUnit === "imperial" ? q.distance : q.distance * 1.609344).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(q.totalCarrierCost)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-primary">
                        {formatCurrency(q.customerPrice)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-green-600 dark:text-green-400">
                        {formatCurrency(q.grossProfit)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {q.profitMarginPercent.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(q.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          {rbSnap ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`button-view-${q.id}`}
                              onClick={() => setDetailQuote(q)}
                              className="h-7 w-7 p-0 text-muted-foreground"
                              title="View route details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-delete-${q.id}`}
                            onClick={() => deleteMutation.mutate(q.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>

    <Dialog
      open={!!detailQuote}
      onOpenChange={(open) => {
        if (!open) setDetailQuote(null);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Route build snapshot</DialogTitle>
          {detailQuote ? (
            <p className="text-xs text-muted-foreground font-mono pt-1">
              {detailQuote.quoteNumber}
            </p>
          ) : null}
        </DialogHeader>
        {detailSnap ? (
          <RouteBuilderSnapshotView snap={detailSnap} currency={currency} measureUnit={measureUnit} />
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            Details are not available for this entry.
          </p>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
