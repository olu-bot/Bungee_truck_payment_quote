import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import * as firebaseDb from "@/lib/firebaseDb";
import { workspaceFirestoreId } from "@/lib/workspace";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Trophy,
  TrendingUp,
  DollarSign,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import type { Quote } from "@shared/schema";
import {
  computeLaneStats,
  computeDashboardKPIs,
  computeMonthlyRevenue,
  computeStatusBreakdown,
  getTopLanes,
  getDateRangeBounds,
  type DateRangePreset,
} from "@/lib/laneIntelligence";
import { formatCurrencyAmount, currencySymbol, resolveWorkspaceCurrency } from "@/lib/currency";
import type { SupportedCurrency } from "@/lib/currency";

// Lazy-loaded chart components to keep the initial bundle smaller
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Date range presets ─────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

// ── Status colors ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Won: "#22c55e",    // green-500
  Lost: "#ef4444",   // red-500
  Pending: "#f59e0b", // amber-500
};

// ── Component ──────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const currency = resolveWorkspaceCurrency(user) as SupportedCurrency;
  const sym = currencySymbol(currency);

  const [dateRange, setDateRange] = useState<DateRangePreset>("90d");
  const [laneSortBy, setLaneSortBy] = useState<"totalQuotes" | "winRate" | "totalRevenue">("totalQuotes");

  const { data: quotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["firebase", "quotes", scopeId ?? ""],
    queryFn: () => firebaseDb.getQuotes(scopeId),
    enabled: !!scopeId,
  });

  const { from, to } = useMemo(() => getDateRangeBounds(dateRange), [dateRange]);

  // Filter quotes to date range for lane stats
  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (from && q.createdAt < from) return false;
      if (to && q.createdAt > to) return false;
      return true;
    });
  }, [quotes, from, to]);

  const kpis = useMemo(() => computeDashboardKPIs(quotes, from, to), [quotes, from, to]);
  const laneStatsMap = useMemo(() => computeLaneStats(filteredQuotes), [filteredQuotes]);
  const topLanes = useMemo(() => getTopLanes(laneStatsMap, 10, laneSortBy), [laneStatsMap, laneSortBy]);
  const monthlyRevenue = useMemo(() => computeMonthlyRevenue(quotes, from, to), [quotes, from, to]);
  const statusBreakdown = useMemo(() => computeStatusBreakdown(quotes, from, to), [quotes, from, to]);

  // Win rate trend arrow
  const winRateDelta = kpis.winRate - kpis.winRateLastMonth;
  const winRateDeltaPercent = Math.round(winRateDelta * 100);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-900">No quotes yet</p>
            <p className="text-xs text-slate-500 mt-1">Start quoting to see your analytics</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Date range filter */}
      <div className="flex items-center justify-end">
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangePreset)}>
          <SelectTrigger className="h-7 text-xs w-[160px] border-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Quotes */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Quotes</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{kpis.totalQuotes.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400">{kpis.quotesThisMonth} this month</p>
          </CardContent>
        </Card>

        {/* Win Rate */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Win Rate</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{Math.round(kpis.winRate * 100)}%</p>
            <div className="flex items-center gap-1 text-[11px]">
              {winRateDeltaPercent > 0 ? (
                <>
                  <ArrowUp className="w-3 h-3 text-green-600" />
                  <span className="text-green-600">{winRateDeltaPercent}% vs last month</span>
                </>
              ) : winRateDeltaPercent < 0 ? (
                <>
                  <ArrowDown className="w-3 h-3 text-red-500" />
                  <span className="text-red-500">{Math.abs(winRateDeltaPercent)}% vs last month</span>
                </>
              ) : (
                <>
                  <Minus className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-400">No change vs last month</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Avg Margin */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Avg Margin</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{kpis.avgMarginPercent.toFixed(1)}%</p>
            <p className="text-[11px] text-slate-400">On won quotes</p>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Revenue</span>
            </div>
            <p className="text-xl font-bold text-slate-900">
              {sym}{kpis.totalRevenue >= 1000
                ? `${(kpis.totalRevenue / 1000).toFixed(1)}k`
                : kpis.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
            <p className="text-[11px] text-slate-400">Won quotes, {DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label?.toLowerCase()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Lanes Table */}
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Top Lanes</h3>
            <Select value={laneSortBy} onValueChange={(v) => setLaneSortBy(v as typeof laneSortBy)}>
              <SelectTrigger className="h-7 text-[11px] w-[130px] border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="totalQuotes" className="text-xs">By Quotes</SelectItem>
                <SelectItem value="winRate" className="text-xs">By Win Rate</SelectItem>
                <SelectItem value="totalRevenue" className="text-xs">By Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {topLanes.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No lane data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-1.5 font-medium text-slate-500">Lane</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Quotes</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Win Rate</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Avg Price</th>
                    <th className="text-right py-1.5 font-medium text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topLanes.map((lane, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-900">
                        <span className="flex items-center gap-1">
                          {lane.displayOrigin}
                          <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          {lane.displayDestination}
                        </span>
                      </td>
                      <td className="text-right py-1.5 text-slate-900">{lane.totalQuotes}</td>
                      <td className="text-right py-1.5 text-slate-900">{Math.round(lane.winRate * 100)}%</td>
                      <td className="text-right py-1.5 text-slate-900">
                        {lane.avgPrice > 0 ? `${sym}${formatCurrencyAmount(lane.avgPrice, currency)}` : "--"}
                      </td>
                      <td className="text-right py-1.5 text-slate-900">
                        {lane.revenue > 0 ? `${sym}${formatCurrencyAmount(lane.revenue, currency)}` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Revenue Over Time */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Revenue Over Time</h3>
            {monthlyRevenue.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No revenue data yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenue} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) =>
                        value >= 1000 ? `${sym}${(value / 1000).toFixed(0)}k` : `${sym}${value}`
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                      formatter={(value) => [`${sym}${Number(value).toLocaleString()}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" fill="#f97316" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Win/Loss Breakdown */}
        <Card className="border-slate-200">
          <CardContent className="p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Win/Loss Breakdown</h3>
            {kpis.totalQuotes === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No data yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown.filter((s) => s.count > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="status"
                    >
                      {statusBreakdown
                        .filter((s) => s.count > 0)
                        .map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLORS[entry.status] ?? "#94a3b8"}
                          />
                        ))}
                    </Pie>
                    <Legend
                      verticalAlign="bottom"
                      iconSize={8}
                      formatter={(value: string) => (
                        <span className="text-[11px] text-slate-500">{value}</span>
                      )}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                      formatter={(value, name) => {
                        const item = statusBreakdown.find((s) => s.status === name);
                        return [`${value} (${item?.percent.toFixed(0)}%)`, String(name)];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
