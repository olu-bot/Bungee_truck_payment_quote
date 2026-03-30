import { useQuery } from "@tanstack/react-query";
import type { StripePricingDisplayResponse } from "@/lib/stripePricingDisplay";

export function useStripePricingDisplay(enabled = true) {
  return useQuery({
    queryKey: ["/api/stripe/pricing-display"] as const,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StripePricingDisplayResponse> => {
      const res = await fetch("/api/stripe/pricing-display");
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json() as Promise<StripePricingDisplayResponse>;
    },
  });
}
