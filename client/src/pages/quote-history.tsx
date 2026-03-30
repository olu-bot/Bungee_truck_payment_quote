import { useState, useMemo, useCallback, useEffect } from "react";
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
  FileDown,
  Search,
  Sparkles,
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
import { QuoteShareDialog } from "@/components/QuoteShareDialog";
import { can } from "@/lib/permissions";
import { canExportPdf } from "@/lib/subscription";
import { UpgradeDialog } from "@/components/UpgradeDialog";
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
  return <Badge variant="outline" className="text-[10px] gap-0.5 text-slate-500"><Clock className="w-2.5 h-2.5" />PENDING</Badge>;
}

// ── Snapshot Detail View ─────────────────────────────────────────

function RouteBuilderSnapshotView({ snap, currency, measureUnit }: { snap: RouteBuilderSnapshot; currency: SupportedCurrency; measureUnit: MeasurementUnit }) {
  const fmt = useCallback((v: number) => formatCurrencyAmount(v, currency), [currency]);
  const dLabel = distanceLabel(measureUnit);
  const accTotal = snap.accessorialTotal ?? 0;
  const surchargeAmt = snap.surchargeAmount ?? 0;
  const carrierCost = snap.carrierCost ?? snap.fullTripCost;

  return (
    <div className="space-y-4 text-sm max-h-[70vh] overflow-y-auto pr-1">
      {/* Route + meta */}
      <div>
        <p className="font-semibold">{snap.routeSummary}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1">
          <span>{displayDistance(snap.totalKm, measureUnit).toFixed(0)} {dLabel}</span>
          <span>·</span>
          <span>{Math.floor(snap.totalMin / 60)}h {String(Math.round(snap.totalMin % 60)).padStart(2, "0")}m</span>
          {snap.returnKm > 0 && <><span>·</span><span>+{displayDistance(snap.returnKm, measureUnit).toFixed(0)} {dLabel} deadhead</span></>}
          {snap.payMode && <><span>·</span><span className="capitalize">{snap.payMode === "perHour" ? "Per Hour" : `Per ${dLabel === "mi" ? "Mile" : "KM"}`}</span></>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
          <span>Fuel {fmt(snap.fuelPricePerLitre)}/L</span>
          {snap.dockTimeHrs != null && <><span>·</span><span>Dock {snap.dockTimeHrs}h</span></>}
          {snap.yardLabel && <><span>·</span><span>Yard: {snap.yardLabel}</span></>}
          {snap.quoteMode && <><span>·</span><span className="capitalize">{snap.quoteMode} quote</span></>}
        </div>
      </div>

      {/* Carrier cost */}
      <div className="rounded border border-slate-200 p-3 space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span className="text-xs text-slate-500 uppercase tracking-wide">Carrier Cost</span>
          <span className="font-semibold text-orange-600">{fmt(carrierCost)}</span>
        </div>
        <div className="text-xs text-slate-500 space-y-0.5">
          <div className="flex justify-between"><span>Base trip cost</span><span>{fmt(snap.fullTripCost)}</span></div>
          {snap.deadheadCost > 0 && (
            <div className="flex justify-between"><span>Includes deadhead</span><span>{fmt(snap.deadheadCost)}</span></div>
          )}
          {surchargeAmt > 0 && (
            <div className="flex justify-between"><span>Surcharge ({snap.surchargePercent}%)</span><span>+{fmt(surchargeAmt)}</span></div>
          )}
        </div>
      </div>

      {/* Accessorial charges */}
      {accTotal > 0 && (
        <div className="rounded border border-slate-200 p-3 space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Accessorial Charges</span>
            <span className="font-semibold text-orange-600">+{fmt(accTotal)}</span>
          </div>
          {snap.accessorialItems && snap.accessorialItems.length > 0 && (
            <div className="text-xs text-slate-500 space-y-0.5">
              {snap.accessorialItems.map((item, idx) => (
                <div key={idx} className="flex justify-between"><span>{item.label}</span><span>{fmt(item.amount)}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Margin tiers */}
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Pricing</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {snap.tiers.map((t) => (
            <div key={t.label} className="rounded border border-slate-200 p-2 text-xs">
              <div className="text-slate-500">{t.label}</div>
              <div className="font-semibold">{fmt(t.price + accTotal)}</div>
              <div className="text-slate-500">
                +{fmt(t.marginAmount)} margin{accTotal > 0 ? ` +${fmt(accTotal)} acc.` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom quote */}
      {(snap.customQuoteInput || snap.customQuote) && (
        <div className="text-xs rounded border border-slate-200 p-2">
          <span className="text-slate-500">Custom quote: </span>
          {snap.customQuoteInput ? `$${snap.customQuoteInput}` : "\u2014"}
          {snap.customQuote && <span className="ml-2">{"\u2192"} {snap.customQuote.marginPercent.toFixed(1)}% margin ({fmt(snap.customQuote.marginAmount)})</span>}
        </div>
      )}

      <Separator />

      {/* Leg breakdown */}
      <div className="space-y-2.5">
        <div className="text-xs font-semibold text-slate-500 uppercase">Leg Breakdown</div>
        {(() => {
          let legNum = 0;
          return snap.legs.map((leg, i) => {
            const isDeadhead = leg.isDeadhead ?? (leg.type === "return" || leg.type === "deadhead");
            if (!isDeadhead) legNum += 1;
            return (
              <div key={i} className="rounded border border-slate-200 p-3 space-y-1.5 text-xs">
                <div className="font-medium flex items-center gap-1.5">
                  {isDeadhead ? `Deadhead · ${leg.from} → ${leg.to}` : `Leg ${legNum} · ${leg.from} → ${leg.to}`}
                  {isDeadhead && <Badge className="text-[10px] bg-orange-600 text-white border-0 py-0">EMPTY</Badge>}
                  {!isDeadhead && leg.isLocal && <Badge variant="secondary" className="text-[10px] py-0">LOCAL</Badge>}
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Drive</span>
                  <span>{Math.floor(leg.driveMinutes / 60)}h {String(Math.round(leg.driveMinutes % 60)).padStart(2, "0")}m</span>
                </div>
                {!isDeadhead && leg.dockMinutes > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Dock time</span>
                    <span>{(leg.dockMinutes / 60).toFixed(1)} hrs</span>
                  </div>
                )}
                <div className="flex justify-between"><span className="text-slate-500">Billable</span><span className="font-medium">{leg.totalBillableHours.toFixed(2)} hrs</span></div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-slate-500">Fixed cost</span>
                  <span>{fmt(leg.fixedCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Driver cost</span>
                  <span>{fmt(leg.driverCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Fuel ({displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel})</span>
                  <span>{fmt(leg.fuelCost)}</span>
                </div>
                <div className="flex justify-between font-semibold text-orange-600 pt-1 border-t border-slate-200 mt-1">
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
  onSharePdf,
  canSharePdf,
}: {
  q: Quote;
  formatCurrency: (v: number) => string;
  onView: () => void;
  onWon: () => void;
  onLost: () => void;
  onReset: () => void;
  onDelete: () => void;
  onSharePdf: () => void;
  canSharePdf: boolean;
}) {
  const rbSnap = parseRouteBuilderSnapshot(q.routeSnapshotJson);
  const qStatus = q.status || "pending";

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50/30 transition-colors" data-testid={`card-quote-${q.id}`}>
      {/* Status badge */}
      <div className="shrink-0" data-testid="status-badge">
        <StatusBadge status={q.status} />
      </div>

      {/* Route + quote number + time */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {rbSnap?.routeSummary ? (
            <span className="text-sm font-medium truncate">{rbSnap.routeSummary}</span>
          ) : (
            <>
              <span className="text-sm font-medium truncate">{q.origin}</span>
              <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-sm font-medium truncate">{q.destination}</span>
            </>
          )}
          <span className="text-[10px] text-slate-500 font-mono ml-1">{q.quoteNumber}</span>
          <span className="text-[10px] text-slate-500 ml-auto shrink-0">{formatDateTime(q.createdAt)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs mt-0.5">
          <span className="text-slate-500">Cost <span className="font-medium text-slate-900">{formatCurrency(q.totalCarrierCost)}</span></span>
          <span className="text-slate-500">Quoted <span className="font-semibold text-orange-600">{formatCurrency(q.customerPrice)}</span></span>
          <span className="text-slate-500">Margin <span className="font-semibold text-green-600 dark:text-green-400">{q.profitMarginPercent.toFixed(1)}%</span></span>
          {qStatus === "won" && q.wonRate != null && q.wonRate !== q.customerPrice && (
            <span className="text-green-700 dark:text-green-300 font-medium text-xs">Won @ {formatCurrency(q.wonRate)}</span>
          )}
          {qStatus === "lost" && q.lostTargetPrice != null && (
            <span className="text-red-500 font-medium text-xs">Target: {formatCurrency(q.lostTargetPrice)}</span>
          )}
          {q.customerNote && (
            <span className="text-blue-600 dark:text-blue-400 truncate max-w-[160px]" title={q.customerNote}>{q.customerNote}</span>
          )}
          {q.statusNote && (
            <span className={`truncate max-w-[140px] ${qStatus === "lost" ? "text-red-500" : "text-green-600"}`} title={q.statusNote}>{q.statusNote}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {qStatus === "pending" && (
          <>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30" onClick={onWon} data-testid="button-won">
              <Trophy className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={onLost} data-testid="button-lost">
              <XCircle className="w-3 h-3" />
            </Button>
          </>
        )}
        {(qStatus === "won" || qStatus === "lost") && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5 text-slate-500" onClick={onReset} title="Reset to pending" data-testid="button-reset-status">
            <Clock className="w-3 h-3" />
          </Button>
        )}
        {canSharePdf && (
          <Button variant="ghost" size="sm" onClick={onSharePdf} className="h-6 w-6 p-0 text-slate-500 hover:text-orange-500" title="Download PDF" data-testid="button-download-pdf">
            <FileDown className="w-3.5 h-3.5" />
          </Button>
        )}
        {rbSnap && (
          <Button variant="ghost" size="sm" onClick={onView} className="h-6 w-6 p-0 text-slate-500" title="View details" data-testid="button-view-details">
            <Eye className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDelete} className="h-6 w-6 p-0 text-slate-500 hover:text-destructive" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
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
  const [lostTargetPriceInput, setLostTargetPriceInput] = useState("");

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // PDF share dialog
  const [pdfQuote, setPdfQuote] = useState<Quote | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Upgrade dialog
  const [upgradeOpen, setUpgradeOpen] = useState(false);

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
    mutationFn: async (args: { id: string; status: QuoteStatus; wonRate?: number | null; statusNote?: string; lostTargetPrice?: number | null }) => {
      const update: Record<string, unknown> = {
        status: args.status,
        wonRate: args.wonRate ?? null,
        statusNote: args.statusNote || "",
        lostTargetPrice: args.lostTargetPrice ?? null,
      };
      await firebaseDb.updateQuote(scopeId, args.id, update as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firebase", "quotes", scopeId ?? ""] });
      setStatusDialog(null);
      setWonRateInput("");
      setStatusNoteInput("");
      setLostTargetPriceInput("");
    },
  });

  function openStatusDialog(quote: Quote, action: "won" | "lost") {
    setStatusDialog({ quote, action });
    setWonRateInput(action === "won" ? String(quote.customerPrice) : "");
    setStatusNoteInput("");
    setLostTargetPriceInput("");
  }

  function confirmStatus() {
    if (!statusDialog) return;
    const { quote, action } = statusDialog;
    // Skip Firestore writes for demo quotes (used during walkthrough tour)
    if (quote.id.startsWith("demo-")) {
      setStatusDialog(null);
      setWonRateInput("");
      setStatusNoteInput("");
      setLostTargetPriceInput("");
      return;
    }
    let wonRate: number | null = null;
    let lostTargetPrice: number | null = null;
    if (action === "won") {
      const parsed = parseFloat(wonRateInput);
      wonRate = !isNaN(parsed) && parsed > 0 ? parsed : quote.customerPrice;
    }
    if (action === "lost" && lostTargetPriceInput.trim()) {
      const parsed = parseFloat(lostTargetPriceInput);
      lostTargetPrice = !isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    updateStatusMutation.mutate({
      id: quote.id,
      status: action,
      wonRate,
      lostTargetPrice,
      statusNote: statusNoteInput.trim() || "",
    });
  }

  function resetToPending(quoteId: string) {
    updateStatusMutation.mutate({ id: quoteId, status: "pending", wonRate: null, lostTargetPrice: null, statusNote: "" });
  }

  // ── Walkthrough tour detection ─────────────────────────────────
  // When the quote-history tour is active but there are no real quotes,
  // render demo data so the walkthrough targets exist in the DOM.

  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    const onStart = (e: Event) => {
      const tourId = (e as CustomEvent)?.detail?.tourId;
      if (tourId === "quote-history") setTourActive(true);
    };
    const onEnd = () => setTourActive(false);
    window.addEventListener("bungee:start-tour", onStart);
    window.addEventListener("bungee:tour-complete", onEnd);
    window.addEventListener("bungee:tour-dismiss", onEnd);
    return () => {
      window.removeEventListener("bungee:start-tour", onStart);
      window.removeEventListener("bungee:tour-complete", onEnd);
      window.removeEventListener("bungee:tour-dismiss", onEnd);
    };
  }, []);

  const DEMO_QUOTES: Quote[] = useMemo(() => {
    const now = new Date();
    return [
      {
        id: "demo-1", quoteNumber: "BQ-DEMO001", createdAt: new Date(now.getTime() - 86400000).toISOString(),
        origin: "Toronto, ON", destination: "Montreal, QC", truckType: "dry_van",
        distance: 541, pricingMode: "carrier", carrierCost: 1084.96, fuelSurcharge: 0,
        totalCarrierCost: 1084.96, marginType: "percent", marginValue: 20, marginAmount: 216.99,
        customerPrice: 1400, grossProfit: 315.04, profitMarginPercent: 22.5,
        customerNote: "Weekly lane", status: "won" as QuoteStatus, wonRate: 1375,
      },
      {
        id: "demo-2", quoteNumber: "BQ-DEMO002", createdAt: new Date(now.getTime() - 172800000).toISOString(),
        origin: "Vancouver, BC", destination: "Calgary, AB", truckType: "reefer",
        distance: 1050, pricingMode: "carrier", carrierCost: 2100, fuelSurcharge: 0,
        totalCarrierCost: 2100, marginType: "percent", marginValue: 15, marginAmount: 315,
        customerPrice: 2600, grossProfit: 500, profitMarginPercent: 19.2,
        customerNote: "Produce load", status: "lost" as QuoteStatus, lostTargetPrice: 2400,
      },
      {
        id: "demo-3", quoteNumber: "BQ-DEMO003", createdAt: new Date(now.getTime() - 3600000).toISOString(),
        origin: "Toronto, ON", destination: "Ottawa, ON", truckType: "dry_van",
        distance: 450, pricingMode: "carrier", carrierCost: 890, fuelSurcharge: 0,
        totalCarrierCost: 890, marginType: "percent", marginValue: 25, marginAmount: 222.5,
        customerPrice: 1200, grossProfit: 310, profitMarginPercent: 25.8,
        customerNote: "RFQ-4412",
      },
      {
        id: "demo-4", quoteNumber: "BQ-DEMO004", createdAt: new Date(now.getTime() - 7200000).toISOString(),
        origin: "Mississauga, ON", destination: "Windsor, ON", truckType: "flatbed",
        distance: 380, pricingMode: "carrier", carrierCost: 760, fuelSurcharge: 0,
        totalCarrierCost: 760, marginType: "percent", marginValue: 20, marginAmount: 152,
        customerPrice: 950, grossProfit: 190, profitMarginPercent: 20,
        customerNote: "Steel coils",
      },
      {
        id: "demo-5", quoteNumber: "BQ-DEMO005", createdAt: new Date(now.getTime() - 10800000).toISOString(),
        origin: "Edmonton, AB", destination: "Saskatoon, SK", truckType: "dry_van",
        distance: 525, pricingMode: "carrier", carrierCost: 1050, fuelSurcharge: 0,
        totalCarrierCost: 1050, marginType: "percent", marginValue: 18, marginAmount: 189,
        customerPrice: 1300, grossProfit: 250, profitMarginPercent: 19.2,
      },
    ];
  }, []);

  // Use demo quotes when tour is active and no real quotes exist
  const isDemo = tourActive && quotes.length === 0 && !isLoading;
  const effectiveQuotes = isDemo ? DEMO_QUOTES : quotes;

  // ── Search filter (must be before early returns — hooks can't be conditional) ──

  const filteredQuotes = useMemo(() => {
    if (!searchQuery.trim()) return effectiveQuotes;
    const q = searchQuery.toLowerCase();
    return effectiveQuotes.filter((quote) => {
      const searchable = [
        quote.origin,
        quote.destination,
        quote.quoteNumber,
        quote.truckType,
        TRUCK_LABELS[quote.truckType] || "",
        quote.customerNote || "",
        quote.statusNote || "",
        quote.status || "pending",
        String(quote.customerPrice),
        formatDateTime(quote.createdAt),
      ].join(" ").toLowerCase();
      return searchable.includes(q);
    });
  }, [effectiveQuotes, searchQuery]);

  // ── Loading / Empty ────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-50/50 rounded-md animate-pulse" />)}
      </div>
    );
  }

  if (quotes.length === 0 && !isDemo) {
    return (
      <Card className="border-dashed border-slate-200">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-slate-500" />
          </div>
          <h3 className="text-sm font-medium mb-1">No saved quotes yet</h3>
          <p className="text-sm text-slate-500 max-w-[280px]">
            Use the Save Quote button on the Route Builder to record quotes here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Stats ──────────────────────────────────────────────────────

  const wonQuotes = effectiveQuotes.filter((q) => q.status === "won");
  const lostQuotes = effectiveQuotes.filter((q) => q.status === "lost");
  const pendingQuotes = effectiveQuotes.filter((q) => !q.status || q.status === "pending");
  const winRate = wonQuotes.length + lostQuotes.length > 0
    ? ((wonQuotes.length / (wonQuotes.length + lostQuotes.length)) * 100).toFixed(0)
    : null;

  return (
    <>
      <div className="space-y-4">
        {/* Demo data banner */}
        {isDemo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>These are <strong>sample quotes</strong> for the walkthrough. Save a real quote to see your own data here.</span>
          </div>
        )}

        {/* Stats bar */}
        <div className="flex items-center gap-4 flex-wrap" data-testid="quote-stats-bar">
          <p className="text-sm font-medium">
            {effectiveQuotes.length} quote{effectiveQuotes.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-slate-500">
              <Clock className="w-3 h-3" /> {pendingQuotes.length} pending
            </span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Trophy className="w-3 h-3" /> {wonQuotes.length} won
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="w-3 h-3" /> {lostQuotes.length} lost
            </span>
            {winRate !== null && (
              <span className="font-semibold text-slate-900">
                {winRate}% win rate
              </span>
            )}
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search by lane, quote #, status, note..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            data-testid="input-search-quotes"
          />
        </div>

        {/* Quote list */}
        <div className="space-y-1">
          {filteredQuotes.length === 0 && searchQuery.trim() ? (
            <p className="text-sm text-slate-500 text-center py-6">No quotes match "{searchQuery}"</p>
          ) : (
            filteredQuotes.map((q) => (
              <QuoteRow
                key={q.id}
                q={q}
                formatCurrency={formatCurrency}
                onView={() => setDetailQuote(q)}
                onWon={() => openStatusDialog(q, "won")}
                onLost={() => openStatusDialog(q, "lost")}
                onReset={() => resetToPending(q.id)}
                onDelete={() => setDeleteConfirmId(q.id)}
                onSharePdf={() => {
                  if (canExportPdf(user)) {
                    setPdfQuote(q);
                  } else {
                    setUpgradeOpen(true);
                  }
                }}
                canSharePdf={can(user, "quote:sharePdf")}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Detail Dialog ────────────────────────────────────────── */}
      <Dialog open={!!detailQuote} onOpenChange={(open) => { if (!open) setDetailQuote(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Route build snapshot</DialogTitle>
            {detailQuote && (
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <p className="text-xs text-slate-500 font-mono">{detailQuote.quoteNumber}</p>
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
            <p className="text-sm text-slate-500 py-4">Details are not available for this entry.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Won / Lost Dialog ────────────────────────────────────── */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => { if (!open) { setStatusDialog(null); setWonRateInput(""); setStatusNoteInput(""); setLostTargetPriceInput(""); } }}>
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
                <p className="text-xs text-slate-500 mb-2">
                  Final agreed rate. Quoted {statusDialog ? formatCurrency(statusDialog.quote.customerPrice) : ""}.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">{sym}</span>
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
                    <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                      <p>Margin: <span className={`font-medium ${margin >= 0 ? "text-green-600" : "text-red-500"}`}>{margin.toFixed(1)}%</span></p>
                      {diff !== 0 && (
                        <p>{diff < 0 ? "Discount" : "Increase"}: <span className={`font-medium ${diff < 0 ? "text-red-500" : "text-green-600"}`}>{formatCurrency(Math.abs(diff))}</span> from quoted</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Customer target price (only for Lost) */}
            {statusDialog?.action === "lost" && (
              <div>
                <label className="text-sm font-medium">Customer's target price (optional)</label>
                <p className="text-xs text-slate-500 mb-2">
                  What price was the customer looking for? Your quote was {statusDialog ? formatCurrency(statusDialog.quote.customerPrice) : ""}.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">{sym}</span>
                  <Input
                    data-testid="input-lost-target-price"
                    type="number"
                    step="1"
                    placeholder="e.g. 7500"
                    className="h-9"
                    value={lostTargetPriceInput}
                    onChange={(e) => setLostTargetPriceInput(e.target.value)}
                    autoFocus
                  />
                </div>
                {lostTargetPriceInput && statusDialog && (() => {
                  const target = parseFloat(lostTargetPriceInput);
                  if (isNaN(target) || target <= 0) return null;
                  const diff = statusDialog.quote.customerPrice - target;
                  const pctOff = (diff / statusDialog.quote.customerPrice) * 100;
                  return (
                    <p className="text-xs text-slate-500 mt-1.5">
                      {diff > 0
                        ? <>You were <span className="font-medium text-red-500">{formatCurrency(diff)} ({pctOff.toFixed(1)}%)</span> above their target</>
                        : diff < 0
                        ? <>Target was <span className="font-medium text-green-600">{formatCurrency(Math.abs(diff))}</span> above your quote</>
                        : <span className="font-medium">Matches your quoted price</span>
                      }
                    </p>
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
                autoFocus={statusDialog?.action === "won"}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setStatusDialog(null); setWonRateInput(""); setStatusNoteInput(""); setLostTargetPriceInput(""); }}>
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

      {/* PDF Share Dialog */}
      {pdfQuote && (
        <QuoteShareDialog
          open={!!pdfQuote}
          onOpenChange={(open) => { if (!open) setPdfQuote(null); }}
          quote={pdfQuote}
        />
      )}

      {/* Upgrade Dialog */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title="Upgrade to export branded PDFs"
        description="Branded quote PDFs are available on Pro and Premium plans."
      />
    </>
  );
}
