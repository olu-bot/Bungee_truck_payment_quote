import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  ArrowRight,
  Package,
  Snowflake,
  Layers,
  FileText,
  Eye,
  Trophy,
  XCircle,
  Clock,
} from "lucide-react";
import type { Quote, QuoteStatus } from "@shared/schema";
import {
  parseRouteBuilderSnapshot,
  type RouteBuilderSnapshot,
} from "@/lib/routeBuilderSnapshot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

// ── Helpers ──────────────────────────────────────────────────────

const TRUCK_ICONS: Record<string, typeof Package> = { dry_van: Package, reefer: Snowflake, flatbed: Layers };
const TRUCK_LABELS: Record<string, string> = { dry_van: "Dry Van", reefer: "Reefer", flatbed: "Flatbed" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status?: QuoteStatus }) {
  const s = status || "pending";
  if (s === "won")
    return <Badge className="text-[10px] bg-green-600 text-white border-0 gap-0.5"><Trophy className="w-2.5 h-2.5" />WON</Badge>;
  if (s === "lost")
    return <Badge className="text-[10px] bg-red-500 text-white border-0 gap-0.5"><XCircle className="w-2.5 h-2.5" />LOST</Badge>;
  return <Badge variant="outline" className="text-[10px] gap-0.5 text-muted-foreground"><Clock className="w-2.5 h-2.5" />PENDING</Badge>;
}

// ── Snapshot Detail View ─────────────────────────────────────────

function RouteBuilderSnapshotView({ snap, currency, measureUnit }: { snap: RouteBuilderSnapshot; currency: SupportedCurrency; measureUnit: MeasurementUnit }) {
  const fmt = useCallback((v: number) => formatCurrencyAmount(v, currency), [currency]);
  const sym = currencySymbol(currency);
  const dLabel = distanceLabel(measureUnit);
  return (
    <div className="space-y-4 text-sm max-h-[70vh] overflow-y-auto pr-1">
      {snap.chatUserMessage && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Chat: </span>{snap.chatUserMessage}</p>}
      {snap.customerNote && (
        <div className="text-xs rounded border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-2">
          <span className="font-medium text-blue-700 dark:text-blue-300">Note: </span>
          <span className="text-blue-900 dark:text-blue-100">{snap.customerNote}</span>
        </div>
      )}
      <div>
        <p className="font-semibold">{snap.routeSummary}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {displayDistance(snap.totalKm, measureUnit).toFixed(0)} {dLabel} · {snap.totalMin.toFixed(0)} min
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
          <div className="font-semibold text-primary">{fmt(snap.deliveryCost)}</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="text-muted-foreground uppercase tracking-wide">Full trip</div>
          <div className="font-semibold">{fmt(snap.fullTripCost)}</div>
          <div className="text-muted-foreground">+{fmt(snap.deadheadCost)} deadhead</div>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Margins</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {snap.tiers.map((t) => (
            <div key={t.label} className="rounded border border-border p-2 text-xs">
              <div className="text-muted-foreground">{t.label}</div>
              <div className="font-semibold">{fmt(t.price)}</div>
              <div className="text-muted-foreground">+{fmt(t.marginAmount)}</div>
            </div>
          ))}
        </div>
      </div>
      {(snap.customQuoteInput || snap.customQuote) && (
        <div className="text-xs rounded border border-border p-2">
          <span className="text-muted-foreground">Custom quote: </span>
          {snap.customQuoteInput ? `${sym}${snap.customQuoteInput}` : "—"}
          {snap.customQuote && <span className="ml-2">→ {snap.customQuote.marginPercent.toFixed(1)}% margin ({fmt(snap.customQuote.marginAmount)})</span>}
        </div>
      )}
      <Separator />
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase">Leg breakdown</div>
        {(() => {
          let legNum = 0;
          return snap.legs.map((leg, i) => {
            const isDeadhead = leg.isDeadhead ?? (leg.type === "return" || leg.type === "deadhead");
            if (!isDeadhead) legNum += 1;
            return (
              <div key={i} className="rounded border border-border p-3 space-y-2 text-xs">
                <div className="font-medium">
                  {isDeadhead ? `Deadhead · ${leg.from} → ${leg.to}` : `Leg ${legNum} · ${leg.from} → ${leg.to}`}
                  {isDeadhead && <Badge className="ml-2 text-[10px] bg-orange-600 text-white border-0">EMPTY</Badge>}
                  {!isDeadhead && leg.isLocal && <Badge variant="secondary" className="ml-2 text-[10px]">LOCAL</Badge>}
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Billable</span><span>{leg.totalBillableHours.toFixed(2)} hrs</span></div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labor</span>
                  <span>{fmt((leg as any).fixedCost != null ? (leg as any).fixedCost + (leg as any).driverCost : (leg as any).laborCost ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fuel ({displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel})</span>
                  <span>{fmt(leg.fuelCost)}</span>
                </div>
                <div className="flex justify-between font-semibold text-primary pt-1">
                  <span>Total</span><span>{fmt(leg.legCost)}</span>
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// ── Quote Card (shared between mobile and desktop) ───────────────

function QuoteRow({
  q,
  formatCurrency,
  onView,
  onWon,
  onLost,
  onReset,
  onDelete,
}: {
  q: Quote;
  formatCurrency: (v: number) => string;
  onView: () => void;
  onWon: () => void;
  onLost: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const rbSnap = parseRouteBuilderSnapshot(q.routeSnapshotJson);
  const qStatus = q.status || "pending";

  return (
    <Card className="border-border" data-testid={`card-quote-${q.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Left: status indicator */}
          <div className="pt-0.5 shrink-0">
            <StatusBadge status={q.status} />
          </div>

          {/* Middle: main content */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Route + quote number */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{q.origin}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate">{q.destination}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{q.quoteNumber}</span>
            </div>

            {/* Note */}
            {q.customerNote && (
              <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 rounded px-2 py-0.5 inline-block">
                {q.customerNote}
              </p>
            )}

            {/* Pricing row */}
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">
                Cost <span className="font-medium text-foreground">{formatCurrency(q.totalCarrierCost)}</span>
              </span>
              <span className="text-muted-foreground">
                Quoted <span className="font-semibold text-primary">{formatCurrency(q.customerPrice)}</span>
              </span>
              <span className="text-muted-foreground">
                Margin <span className="font-semibold text-green-600 dark:text-green-400">{q.profitMarginPercent.toFixed(1)}%</span>
              </span>
              {qStatus === "won" && q.wonRate != null && q.wonRate !== q.customerPrice && (
                <span className="text-green-700 dark:text-green-300 font-medium">
                  Won @ {formatCurrency(q.wonRate)}
                </span>
              )}
            </div>

            {/* Status note */}
            {q.statusNote && (
              <p className={`text-xs rounded px-2 py-0.5 inline-block ${
                qStatus === "lost"
                  ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30"
                  : "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/30"
              }`}>
                {q.statusNote}
              </p>
            )}

            {/* Date + actions */}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[10px] text-muted-foreground">{formatDate(q.createdAt)}</span>

              <div className="flex items-center gap-0.5">
                {qStatus === "pending" && (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30" onClick={onWon}>
                      <Trophy className="w-3 h-3 mr-0.5" /> Won
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={onLost}>
                      <XCircle className="w-3 h-3 mr-0.5" /> Lost
                    </Button>
                  </>
                )}
                {(qStatus === "won" || qStatus === "lost") && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground" onClick={onReset}>
                    <Clock className="w-3 h-3 mr-0.5" /> Reset
                  </Button>
                )}
                {rbSnap && (
                  <Button variant="ghost" size="sm" onClick={onView} className="h-6 w-6 p-0 text-muted-foreground" title="View details">
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onDelete} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function QuoteHistory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const currency = useMemo(() => resolveWorkspaceCurrency(user), [user]);
  const measureUnit = useMemo(() => resolveMeasurementUnit(user), [user]);
  const sym = currencySymbol(currency);
  const formatCurrency = useCallback((v: number) => formatCurrencyAmount(v, currency), [currency]);

  const [detailQuote, setDetailQuote] = useState<Quote | null>(null);
  const detailSnap = detailQuote ? parseRouteBuilderSnapshot(detailQuote.routeSnapshotJson) : null;

  // Status dialog state
  const [statusDialog, setStatusDialog] = useState<{ quote: Quote; action: "won" | "lost" } | null>(null);
  const [wonRateInput, setWonRateInput] = useState("");
  const [statusNoteInput, setStatusNoteInput] = useState("");

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
      setDeleteConfirmId(null);
      toast({ title: "Quote deleted" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (args: { id: string; status: QuoteStatus; wonRate?: number | null; statusNote?: string }) => {
      await firebaseDb.updateQuote(scopeId, args.id, {
        status: args.status,
        wonRate: args.wonRate ?? null,
        statusNote: args.statusNote || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "quotes", scopeId ?? ""] });
      setStatusDialog(null);
      setWonRateInput("");
      setStatusNoteInput("");
    },
  });

  function openStatusDialog(quote: Quote, action: "won" | "lost") {
    setStatusDialog({ quote, action });
    setWonRateInput(action === "won" ? String(quote.customerPrice) : "");
    setStatusNoteInput("");
  }

  function confirmStatus() {
    if (!statusDialog) return;
    const { quote, action } = statusDialog;
    let wonRate: number | null = null;
    if (action === "won") {
      const parsed = parseFloat(wonRateInput);
      wonRate = !isNaN(parsed) && parsed > 0 ? parsed : quote.customerPrice;
    }
    updateStatusMutation.mutate({
      id: quote.id,
      status: action,
      wonRate,
      statusNote: statusNoteInput.trim() || undefined,
    });
  }

  function resetToPending(quoteId: string) {
    updateStatusMutation.mutate({ id: quoteId, status: "pending", wonRate: null, statusNote: undefined });
  }

  // ── Loading / Empty ────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted/50 rounded-md animate-pulse" />)}
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
            Use the Save Quote button on the Route Builder to record quotes here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Stats ──────────────────────────────────────────────────────

  const wonQuotes = quotes.filter((q) => q.status === "won");
  const lostQuotes = quotes.filter((q) => q.status === "lost");
  const pendingQuotes = quotes.filter((q) => !q.status || q.status === "pending");
  const winRate = wonQuotes.length + lostQuotes.length > 0
    ? ((wonQuotes.length / (wonQuotes.length + lostQuotes.length)) * 100).toFixed(0)
    : null;

  return (
    <>
      <div className="space-y-4">
        {/* Stats bar */}
        <div className="flex items-center gap-4 flex-wrap">
          <p className="text-sm font-medium">
            {quotes.length} quote{quotes.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" /> {pendingQuotes.length} pending
            </span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Trophy className="w-3 h-3" /> {wonQuotes.length} won
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="w-3 h-3" /> {lostQuotes.length} lost
            </span>
            {winRate !== null && (
              <span className="font-semibold text-foreground">
                {winRate}% win rate
              </span>
            )}
          </div>
        </div>

        {/* Quote list — card-based for all screen sizes */}
        <div className="space-y-2">
          {quotes.map((q) => (
            <QuoteRow
              key={q.id}
              q={q}
              formatCurrency={formatCurrency}
              onView={() => setDetailQuote(q)}
              onWon={() => openStatusDialog(q, "won")}
              onLost={() => openStatusDialog(q, "lost")}
              onReset={() => resetToPending(q.id)}
              onDelete={() => setDeleteConfirmId(q.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Detail Dialog ────────────────────────────────────────── */}
      <Dialog open={!!detailQuote} onOpenChange={(open) => { if (!open) setDetailQuote(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Route build snapshot</DialogTitle>
            {detailQuote && (
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <p className="text-xs text-muted-foreground font-mono">{detailQuote.quoteNumber}</p>
                <StatusBadge status={detailQuote.status} />
                {detailQuote.status === "won" && detailQuote.wonRate != null && (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">
                    Won at {formatCurrency(detailQuote.wonRate)}
                  </span>
                )}
              </div>
            )}
            {detailQuote?.customerNote && (
              <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 rounded px-2 py-1 mt-1">
                {detailQuote.customerNote}
              </p>
            )}
            {detailQuote?.statusNote && (
              <p className={`text-xs rounded px-2 py-1 mt-1 ${
                detailQuote.status === "lost"
                  ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30"
                  : "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/30"
              }`}>
                {detailQuote.statusNote}
              </p>
            )}
          </DialogHeader>
          {detailSnap ? (
            <RouteBuilderSnapshotView snap={detailSnap} currency={currency} measureUnit={measureUnit} />
          ) : (
            <p className="text-sm text-muted-foreground py-4">Details are not available for this entry.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Won / Lost Dialog ────────────────────────────────────── */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => { if (!open) { setStatusDialog(null); setWonRateInput(""); setStatusNoteInput(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {statusDialog?.action === "won" ? "Mark as Won" : "Mark as Lost"}
            </DialogTitle>
            <DialogDescription>
              {statusDialog?.quote.origin} → {statusDialog?.quote.destination}
              {statusDialog?.quote.customerNote ? ` · ${statusDialog.quote.customerNote}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Won rate (only for Won) */}
            {statusDialog?.action === "won" && (
              <div>
                <label className="text-sm font-medium">Won Rate</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Final agreed rate. Quoted {statusDialog ? formatCurrency(statusDialog.quote.customerPrice) : ""}.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{sym}</span>
                  <Input
                    data-testid="input-won-rate"
                    type="number"
                    step="1"
                    placeholder={statusDialog ? String(statusDialog.quote.customerPrice) : ""}
                    className="h-9"
                    value={wonRateInput}
                    onChange={(e) => setWonRateInput(e.target.value)}
                    autoFocus
                  />
                </div>
                {wonRateInput && statusDialog && (() => {
                  const rate = parseFloat(wonRateInput);
                  if (isNaN(rate) || rate <= 0) return null;
                  const margin = ((rate - statusDialog.quote.totalCarrierCost) / statusDialog.quote.totalCarrierCost) * 100;
                  const diff = rate - statusDialog.quote.customerPrice;
                  return (
                    <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                      <p>Margin: <span className={`font-medium ${margin >= 0 ? "text-green-600" : "text-red-500"}`}>{margin.toFixed(1)}%</span></p>
                      {diff !== 0 && (
                        <p>{diff < 0 ? "Discount" : "Increase"}: <span className={`font-medium ${diff < 0 ? "text-red-500" : "text-green-600"}`}>{formatCurrency(Math.abs(diff))}</span> from quoted</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Note — available for both Won and Lost */}
            <div>
              <label className="text-sm font-medium">
                {statusDialog?.action === "won" ? "Note (optional)" : "Reason lost (optional)"}
              </label>
              <Textarea
                data-testid="input-status-note"
                placeholder={statusDialog?.action === "won"
                  ? "e.g. Negotiated down from $2,450..."
                  : "e.g. Competitor offered lower rate, customer went with XYZ..."
                }
                className="mt-1.5 text-sm min-h-[60px]"
                value={statusNoteInput}
                onChange={(e) => setStatusNoteInput(e.target.value)}
                autoFocus={statusDialog?.action === "lost"}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setStatusDialog(null); setWonRateInput(""); setStatusNoteInput(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className={statusDialog?.action === "won"
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-red-500 hover:bg-red-600 text-white"
              }
              onClick={confirmStatus}
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending ? "Saving..." : statusDialog?.action === "won" ? "Confirm Won" : "Confirm Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ───────────────────────────────────── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete quote?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
