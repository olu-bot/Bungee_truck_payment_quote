import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import type { DirectoryUser } from "@/lib/firebaseDb";
import { firebaseConfigured } from "@/lib/firebase";
import { auth } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ArrowRight, Package, Snowflake, Layers, Loader2, Crown, Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Quote, CostProfile } from "@shared/schema";
import { formatCurrencyAmount, resolveWorkspaceCurrency } from "@/lib/currency";

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

type Tier = "free" | "pro" | "fleet";

const TIER_CONFIG: Record<Tier, { label: string; color: string; badge: string }> = {
  free:  { label: "Free",    color: "text-slate-500",  badge: "secondary" },
  pro:   { label: "Pro",     color: "text-blue-600",   badge: "default"   },
  fleet: { label: "Premium", color: "text-amber-600",  badge: "outline"   },
};

function TierBadge({ tier }: { tier: Tier }) {
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.free;
  return (
    <Badge
      variant={cfg.badge as "default" | "secondary" | "outline"}
      className={`text-[10px] font-semibold ${tier === "fleet" ? "border-amber-400 text-amber-600" : ""}`}
    >
      {tier === "fleet" && <Crown className="w-2.5 h-2.5 mr-0.5" />}
      {cfg.label}
    </Badge>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workspaceId(u: DirectoryUser): string {
  return u.companyId ?? u.uid;
}

function profileAllInHourly(p: CostProfile): number {
  const monthlyFixed =
    p.monthlyTruckPayment +
    p.monthlyInsurance +
    p.monthlyMaintenance +
    p.monthlyPermitsPlates +
    p.monthlyOther;
  const monthlyHours = p.workingDaysPerMonth * p.workingHoursPerDay;
  const fixedCostPerHour = monthlyHours > 0 ? monthlyFixed / monthlyHours : 0;
  return fixedCostPerHour + p.driverPayPerHour;
}

export default function AdminAllUsers() {
  const PAGE_SIZE = 20;
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const [page, setPage] = useState(1);
  const [tierLoading, setTierLoading] = useState(false);
  const [search, setSearch] = useState("");

  const sheetCurrency = useMemo(() => resolveWorkspaceCurrency(selected ?? undefined), [selected]);
  const formatCurrency = useCallback(
    (value: number) => formatCurrencyAmount(value, sheetCurrency),
    [sheetCurrency],
  );

  const scope = selected ? workspaceId(selected) : undefined;

  const { data: directory = [], isLoading } = useQuery<DirectoryUser[]>({
    queryKey: ["firebase", "admin", "directory-users"],
    queryFn: () => firebaseDb.listDirectoryUsers(),
    enabled: Boolean(isAdmin && firebaseConfigured),
  });

  const filteredDirectory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.companyName?.toLowerCase().includes(q) ||
        u.sector?.toLowerCase().includes(q),
    );
  }, [directory, search]);

  const totalPages = Math.max(1, Math.ceil(filteredDirectory.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedDirectory = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredDirectory.slice(start, start + PAGE_SIZE);
  }, [filteredDirectory, currentPage]);

  const pageStart = filteredDirectory.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(filteredDirectory.length, currentPage * PAGE_SIZE);

  const { data: quotes = [], isLoading: quotesLoading } = useQuery<Quote[]>({
    queryKey: ["firebase", "admin", "user-quotes", scope],
    queryFn: () => firebaseDb.getQuotes(scope),
    enabled: Boolean(sheetOpen && scope && isAdmin),
  });

  const { data: profiles = [], isLoading: profilesLoading } = useQuery<CostProfile[]>({
    queryKey: ["firebase", "admin", "user-profiles", scope],
    queryFn: () => firebaseDb.getProfiles(scope),
    enabled: Boolean(sheetOpen && scope && isAdmin),
  });

  function openUser(u: DirectoryUser) {
    setSelected(u);
    setSheetOpen(true);
  }

  async function handleSetTier(targetUid: string, tier: Tier) {
    setTierLoading(true);
    try {
      const token = await auth?.currentUser?.getIdToken();
      const res = await fetch("/api/admin/set-user-tier", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ uid: targetUid, tier }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to update tier");
      }
      // Optimistically update the selected user in state
      setSelected((prev) => (prev ? { ...prev, subscriptionTier: tier } : prev));
      // Refresh the directory list
      await queryClient.invalidateQueries({ queryKey: ["firebase", "admin", "directory-users"] });
      toast({
        title: "Subscription updated",
        description: `User set to ${TIER_CONFIG[tier].label}.`,
      });
    } catch (e: unknown) {
      toast({
        title: "Failed to update tier",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setTierLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        This directory is available to company admins only.
      </div>
    );
  }

  if (!firebaseConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        Firebase is not configured; user directory is unavailable.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="admin-users-loading">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-muted/50 rounded-md animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-users-page">
      {/* ── Search bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder="Search by name, email, company or sector…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { setSearch(""); setPage(1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {search
          ? `${filteredDirectory.length} of ${directory.length} user${directory.length !== 1 ? "s" : ""} match "${search}". Showing ${pageStart}–${pageEnd}.`
          : `${directory.length} user${directory.length !== 1 ? "s" : ""} registered. Showing ${pageStart}–${pageEnd}. Select a row to open their workspace, quote history, and subscription controls.`
        }
      </p>

      {/* ── Empty search state ── */}
      {filteredDirectory.length === 0 && search && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Search className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No users found</p>
          <p className="text-xs text-muted-foreground">No match for "{search}". Try a different name, email, or company.</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setSearch(""); setPage(1); }}>
            Clear search
          </Button>
        </div>
      )}

      {/* ── Mobile cards ── */}
      <div className="block lg:hidden space-y-2">
        {pagedDirectory.map((u) => (
          <Card
            key={u.uid}
            className="border-border cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => openUser(u)}
            data-testid={`card-admin-user-${u.uid}`}
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{u.name || "—"}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <TierBadge tier={u.subscriptionTier ?? "free"} />
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px]">
                    {u.role}
                  </Badge>
                </div>
              </div>
              <p className="text-xs">
                <span className="text-muted-foreground">Company: </span>
                {u.companyName || "—"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <Card className="hidden lg:block border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="w-[90px]">Sector</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-[90px]">Plan</TableHead>
                <TableHead className="w-[80px]">Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedDirectory.map((u) => (
                <TableRow
                  key={u.uid}
                  data-testid={`row-admin-user-${u.uid}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openUser(u)}
                >
                  <TableCell className="font-medium">{u.name || "—"}</TableCell>
                  <TableCell>{u.companyName || "—"}</TableCell>
                  <TableCell className="capitalize text-sm">{u.sector || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email || "—"}</TableCell>
                  <TableCell>
                    <TierBadge tier={u.subscriptionTier ?? "free"} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px]">
                      {u.role}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Page {currentPage} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
            Next
          </Button>
        </div>
      </div>

      {/* ── User detail sheet ── */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setSelected(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name || "User"}</SheetTitle>
                <SheetDescription className="text-left space-y-1 font-normal">
                  <span className="block text-foreground">{selected.email}</span>
                  <span className="block">
                    <span className="text-muted-foreground">Company: </span>
                    {selected.companyName}
                  </span>
                  <span className="block capitalize">
                    <span className="text-muted-foreground">Sector: </span>
                    {selected.sector}
                  </span>
                  <span className="block text-xs font-mono text-muted-foreground">
                    Workspace: {workspaceId(selected)}
                  </span>
                </SheetDescription>
              </SheetHeader>

              {/* ── Subscription tier control ── */}
              <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    Subscription plan
                  </p>
                  <TierBadge tier={selected.subscriptionTier ?? "free"} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Override this user's plan. Changes take effect immediately — no payment required.
                </p>
                <div className="flex gap-2">
                  {(["free", "pro", "fleet"] as Tier[]).map((tier) => {
                    const cfg = TIER_CONFIG[tier];
                    const isCurrent = (selected.subscriptionTier ?? "free") === tier;
                    return (
                      <Button
                        key={tier}
                        type="button"
                        size="sm"
                        variant={isCurrent ? "default" : "outline"}
                        disabled={tierLoading || isCurrent}
                        className={`flex-1 text-xs ${isCurrent ? "" : "hover:border-primary"}`}
                        onClick={() => handleSetTier(selected.uid, tier)}
                      >
                        {tierLoading && !isCurrent ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : tier === "fleet" ? (
                          <Crown className="w-3 h-3 mr-1 text-amber-500" />
                        ) : null}
                        {cfg.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <Tabs defaultValue="history" className="mt-5">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="history" data-testid="tab-user-history">
                    Quote history
                  </TabsTrigger>
                  <TabsTrigger value="profiles" data-testid="tab-user-profiles">
                    Cost profiles
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="history" className="mt-4 space-y-3">
                  {quotesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading quotes…</p>
                  ) : quotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No saved quotes in this workspace.</p>
                  ) : (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {quotes.map((q) => {
                        const Icon = TRUCK_ICONS[q.truckType] || Package;
                        return (
                          <div
                            key={q.id}
                            className="rounded-lg border border-border p-3 text-sm space-y-1"
                            data-testid={`admin-quote-${q.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{q.quoteNumber}</span>
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Icon className="w-3 h-3" />
                                {TRUCK_LABELS[q.truckType] || q.truckType}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1 text-xs flex-wrap">
                              <span className="truncate max-w-[100px]">{q.origin}</span>
                              <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                              <span className="truncate max-w-[100px]">{q.destination}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              <span>
                                <span className="text-muted-foreground">Carrier: </span>
                                {formatCurrency(q.totalCarrierCost)}
                              </span>
                              <span>
                                <span className="text-muted-foreground">Customer: </span>
                                {formatCurrency(q.customerPrice)}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">{formatDate(q.createdAt)}</p>
                            {q.quoteSource === "route_builder" && (
                              <Badge variant="outline" className="text-[10px]">Route build</Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="profiles" className="mt-4 space-y-3">
                  {profilesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading profiles…</p>
                  ) : profiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No equipment cost profiles in this workspace.</p>
                  ) : (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {profiles.map((p) => {
                        const Icon = TRUCK_ICONS[p.truckType] || Package;
                        const allInHourly = profileAllInHourly(p);
                        return (
                          <div
                            key={p.id}
                            className="rounded-lg border border-border p-3 text-sm space-y-1"
                            data-testid={`admin-profile-${p.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{p.name}</span>
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Icon className="w-3 h-3" />
                                {TRUCK_LABELS[p.truckType] || p.truckType}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              All-in hourly (est.): {formatCurrency(allInHourly)}/hr
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Updated {formatDate(p.createdAt)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
