import { useQuery } from "@tanstack/react-query";
import type { StripePricingDisplayResponse } from "@/lib/stripePricingDisplay";
import { apiUrl } from "@/lib/apiUrl";

/** Loads Pro/Premium amounts from Stripe (same Price IDs as checkout). Preload on app load by default. */
export function useStripePricingDisplay(enabled = true) {
  return useQuery({
    queryKey: ["stripe", "pricing-display"] as const,
    enabled,
    staleTime: 5 * 60_000,
    retry: 2,
    queryFn: async (): Promise<StripePricingDisplayResponse> => {
      const res = await fetch(apiUrl("/api/stripe/pricing-display"), { credentials: "same-origin" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Pricing request failed (${res.status})`);
      }
      return res.json() as Promise<StripePricingDisplayResponse>;
    },
  });
}
