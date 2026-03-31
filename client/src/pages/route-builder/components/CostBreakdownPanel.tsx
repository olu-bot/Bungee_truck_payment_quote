import { memo } from "react";
import { Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { displayDistance, type MeasurementUnit } from "@/lib/measurement";
import type { RouteCalculation } from "../hooks/useRouteCalculation";

type CostBreakdownPanelProps = {
  routeCalc: RouteCalculation;
  formatCurrency: (value: number) => string;
  measureUnit: MeasurementUnit;
  dLabel: string;
};

export const CostBreakdownPanel = memo(function CostBreakdownPanel({
  routeCalc,
  formatCurrency,
  measureUnit,
  dLabel,
}: CostBreakdownPanelProps) {
  return (
    <div className="space-y-2.5 pt-1" data-testid="leg-breakdown">
      {routeCalc.legs.map((leg, i) => {
        const isLocal = leg.isLocal ?? leg.distanceKm < 100;
        const isDeadhead = leg.isDeadhead ?? leg.type === "deadhead";
        const billableHrs = leg.totalBillableHours ?? ((leg.driveMinutes + (isDeadhead ? 0 : leg.dockMinutes)) / 60);
        return (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 space-y-2" data-testid={`leg-card-${i}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {isDeadhead
                  ? `Deadhead Return \u00B7 ${leg.from} \u2192 ${leg.to}`
                  : `Leg ${routeCalc.legs.filter((l, j) => j < i && !(l.isDeadhead ?? l.type === "deadhead")).length + 1} \u00B7 ${leg.from} \u2192 ${leg.to} (est.)`}
              </span>
              {!isDeadhead && (
                <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">
                  {isLocal ? "Local" : "Long Dist."}
                </span>
              )}
            </div>
            <div className="space-y-0.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  Drive time
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-slate-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                      Google Maps may show longer times due to real-time traffic. Cost calculations use traffic-free estimates.
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span>{`${Math.floor(leg.driveMinutes / 60)}h ${String(Math.round(leg.driveMinutes % 60)).padStart(2, "0")}m`}</span>
              </div>
              {!isDeadhead && leg.dockMinutes > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Load + Unload</span>
                  <span>{(leg.dockMinutes / 60) % 1 === 0 ? (leg.dockMinutes / 60).toFixed(0) : (leg.dockMinutes / 60).toFixed(1)} hrs</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span>Total billable hrs</span>
                <span>{billableHrs.toFixed(2)} hrs</span>
              </div>
              <Separator className="my-1" />
              {/* Fixed cost */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fixed Cost</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {billableHrs.toFixed(2)} hrs &times; {formatCurrency(routeCalc.fixedCostPerHour)}/hr
                  </span>
                  <span className="font-medium">{formatCurrency(leg.fixedCost)}</span>
                </div>
              </div>
              {/* Driver cost — per-mile/km or per-hour */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Driver Cost{routeCalc.payMode === "perMile" ? ` (per ${dLabel})` : " (per hour)"}
                  {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` @ ${routeCalc.deadheadPayPercent}%` : ""}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {routeCalc.payMode === "perMile" ? (
                      <>
                        {displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel} &times; {formatCurrency(measureUnit === "imperial" ? routeCalc.driverPayPerMile : routeCalc.driverPayPerMile / 1.609344)}/{dLabel}
                        {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` × ${routeCalc.deadheadPayPercent}%` : ""}
                      </>
                    ) : (
                      <>
                        {billableHrs.toFixed(2)} hrs &times; {formatCurrency(routeCalc.allInHourlyRate - routeCalc.fixedCostPerHour)}/hr
                        {isDeadhead && routeCalc.deadheadPayPercent < 100 ? ` × ${routeCalc.deadheadPayPercent}%` : ""}
                      </>
                    )}
                  </span>
                  <span className="font-medium">{formatCurrency(leg.driverCost)}</span>
                </div>
              </div>
              {/* Fuel cost */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Fuel Cost ({displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel})
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {displayDistance(leg.distanceKm, measureUnit).toFixed(0)} {dLabel} &times;{" "}
                    {formatCurrency(measureUnit === "imperial" ? routeCalc.fuelPerKm * 1.609344 : routeCalc.fuelPerKm)}/{dLabel}
                  </span>
                  <span className="font-medium">{formatCurrency(leg.fuelCost)}</span>
                </div>
              </div>
            </div>
            <div
              className="flex justify-between items-center rounded-md px-3 py-1.5 -mx-1"
              style={{ backgroundColor: "rgba(234, 88, 12, 0.08)" }}
            >
              <span className="text-[13px] font-bold text-slate-800">{isDeadhead ? "Deadhead Total w/ Fuel" : "Total w/ Fuel"}</span>
              <span className="text-[13px] font-bold text-orange-600 tabular-nums">
                {formatCurrency(leg.legCost)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
});
