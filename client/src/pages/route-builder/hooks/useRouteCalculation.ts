import { useState, useRef, useEffect, useCallback } from "react";
import * as firebaseDb from "@/lib/firebaseDb";
import { calculateRouteCost, getPricingAdvice, type PayMode } from "@/lib/routeCalc";
import {
  convertCurrency,
  convertCostProfileCurrency,
  type SupportedCurrency,
} from "@/lib/currency";
import { displayDistance, distanceLabel, type MeasurementUnit } from "@/lib/measurement";
import type { RouteStop, CostProfile } from "@shared/schema";
import type { FormStop } from "./useRouteStops";

// ── Types ──────────────────────────────────────────────────────────
export type LegBreakdown = {
  from: string;
  to: string;
  type?: string;
  isLocal?: boolean;
  distanceKm: number;
  driveMinutes: number;
  dockMinutes: number;
  totalBillableHours: number;
  fixedCost: number;
  driverCost: number;
  fuelCost: number;
  legCost: number;
  isDeadhead?: boolean;
};

export type RouteCalculation = {
  legs: LegBreakdown[];
  totalDistanceKm: number;
  totalDriveMinutes: number;
  totalDockMinutes: number;
  totalHours: number;
  allInHourlyRate: number;
  fixedCostPerHour: number;
  fuelPerKm: number;
  payMode: PayMode;
  driverPayPerMile: number;
  deadheadPayPercent: number;
  tripCost: number;
  deadheadCost: number;
  fullTripCost: number;
};

export type PricingTier = {
  label: string;
  percent: number;
  price: number;
};

export type PricingAdvice = {
  totalCost: number;
  tiers: (PricingTier & { marginAmount: number })[];
  customPercent?: { label: string; percent: number; price: number; marginAmount: number } | null;
  customQuote?: { label: string; quoteAmount: number; marginPercent: number; marginAmount: number } | null;
};

type UseRouteCalculationParams = {
  scopeId: string;
  selectedProfileId: string;
  fuelPrice: string;
  includeReturn: boolean;
  measureUnit: MeasurementUnit;
  currency: SupportedCurrency;
  customQuoteAmount: string;
  quoteUsage: { isAtLimit: boolean; limit: number; increment: () => Promise<void> };
  onToast: (opts: { title: string; description: string; variant?: "destructive" | "default" }) => void;
  onUpgrade: (title: string, description: string) => void;
};

export function useRouteCalculation(params: UseRouteCalculationParams) {
  const {
    scopeId,
    selectedProfileId,
    fuelPrice,
    includeReturn,
    measureUnit,
    currency,
    customQuoteAmount,
    quoteUsage,
    onToast,
    onUpgrade,
  } = params;

  const dLabel = distanceLabel(measureUnit);

  const [routeCalc, setRouteCalc] = useState<RouteCalculation | null>(null);
  const [pricingAdvice, setPricingAdvice] = useState<PricingAdvice | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeocodingRoute, setIsGeocodingRoute] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("perHour");
  const [payModeManualOverride, setPayModeManualOverride] = useState(false);
  const [showLocalAlert, setShowLocalAlert] = useState(false);

  const calcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoDetectPayMode = useCallback((totalDistanceKm: number): PayMode => {
    const totalMiles = totalDistanceKm / 1.609344;
    if (totalMiles > 300) return "perMile";
    return "perHour";
  }, []);

  const calculateRoute = useCallback(
    async (
      routeStops: RouteStop[],
      returnDistance?: { distanceKm: number; durationMinutes: number } | null,
      options?: { saveToHistory?: boolean; chatUserMessage?: string; countQuote?: boolean },
    ) => {
      if (!selectedProfileId || routeStops.length < 2 || !scopeId) return;
      const fp = parseFloat(fuelPrice);
      if (isNaN(fp) || fp <= 0) return;

      if (quoteUsage.isAtLimit) {
        onUpgrade(
          "Monthly quote limit reached",
          `You've used all ${quoteUsage.limit.toLocaleString()} free route quotes this month. Upgrade to Pro or Premium for unlimited quotes.`,
        );
        return;
      }

      setIsCalculating(true);
      try {
        const rawProfile = await firebaseDb.getProfile(scopeId, selectedProfileId);
        if (!rawProfile) throw new Error("Equipment cost profile not found");

        const profileCurrency = (rawProfile.currency as SupportedCurrency) || "USD";
        const profile = convertCostProfileCurrency(rawProfile, profileCurrency, currency) as typeof rawProfile;

        const preCalc = calculateRouteCost(profile, routeStops, includeReturn, fp, returnDistance?.distanceKm, returnDistance?.durationMinutes, "perHour", measureUnit);
        let effectivePayMode = payMode;
        if (!payModeManualOverride) {
          const tripDistKm = preCalc.legs.filter((l: any) => !l.isDeadhead).reduce((s: number, l: any) => s + l.distanceKm, 0);
          const tripMiles = tripDistKm / 1.609344;
          effectivePayMode = autoDetectPayMode(tripDistKm);

          if (tripMiles > 300) {
            const perMileRate = profile.driverPayPerMile || 0;
            if (perMileRate <= 0) {
              effectivePayMode = "perHour";
              onToast({
                title: `Per ${dLabel === "mi" ? "mile" : "km"} rate unavailable`,
                description: `This trip is ${Math.round(tripMiles)} miles — per ${dLabel === "mi" ? "mile" : "km"} billing is recommended but your equipment cost profile has no per ${dLabel === "mi" ? "mile" : "km"} rate set. Using per hour instead. Update your cost profile to add a per ${dLabel === "mi" ? "mile" : "km"} rate.`,
                variant: "destructive",
              });
            }
          }

          if (effectivePayMode !== payMode) setPayMode(effectivePayMode);
          setShowLocalAlert(tripMiles <= 50 && tripMiles > 0 && effectivePayMode !== "perHour");
        }

        const data = calculateRouteCost(
          profile,
          routeStops,
          includeReturn,
          fp,
          returnDistance?.distanceKm,
          returnDistance?.durationMinutes,
          effectivePayMode,
          measureUnit,
        ) as RouteCalculation;
        setRouteCalc(data);
        const customAmt = parseFloat(customQuoteAmount);
        const pricing = getPricingAdvice(
          data.fullTripCost,
          undefined,
          !isNaN(customAmt) && customAmt > 0 ? customAmt : undefined,
        ) as PricingAdvice;
        setPricingAdvice(pricing);

        if (options?.countQuote && quoteUsage.limit !== -1) {
          quoteUsage.increment().catch(() => {});
        }

        // Return profile + data for callers that need them (e.g., save-to-history)
        return { profile, data };
      } catch (err: unknown) {
        onToast({
          title: "Calculation error",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        return undefined;
      } finally {
        setIsCalculating(false);
      }
    },
    [selectedProfileId, scopeId, fuelPrice, includeReturn, measureUnit, currency, customQuoteAmount, payMode, payModeManualOverride, quoteUsage, onToast, onUpgrade, autoDetectPayMode, dLabel],
  );

  const fetchPricingAdvice = useCallback(
    (totalCost: number) => {
      if (totalCost <= 0) return;
      const customAmt = parseFloat(customQuoteAmount);
      const data = getPricingAdvice(
        totalCost,
        undefined,
        !isNaN(customAmt) && customAmt > 0 ? customAmt : undefined,
      );
      setPricingAdvice(data as PricingAdvice);
    },
    [customQuoteAmount],
  );

  return {
    routeCalc,
    setRouteCalc,
    pricingAdvice,
    setPricingAdvice,
    showBreakdown,
    setShowBreakdown,
    isCalculating,
    setIsCalculating,
    isGeocodingRoute,
    setIsGeocodingRoute,
    payMode,
    setPayMode,
    payModeManualOverride,
    setPayModeManualOverride,
    showLocalAlert,
    setShowLocalAlert,
    calcTimerRef,
    calculateRoute,
    fetchPricingAdvice,
  };
}
