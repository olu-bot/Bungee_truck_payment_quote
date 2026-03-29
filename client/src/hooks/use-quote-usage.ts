import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { workspaceFirestoreId } from "@/lib/workspace";
import { getQuoteUsage, incrementQuoteUsage } from "@/lib/firebaseDb";
import { getUserTier, monthlyQuoteLimit } from "@/lib/subscription";
import { useCallback } from "react";

/**
 * Hook that tracks monthly quote usage for the current company.
 *
 * Returns:
 *  - used:       number of quotes used this month
 *  - limit:      monthly cap (-1 = unlimited)
 *  - remaining:  quotes left (-1 = unlimited)
 *  - isAtLimit:  true when the user has hit their cap
 *  - increment:  call after a successful quote to bump the counter
 *  - isLoading:  true while the initial fetch is in-flight
 */
export function useQuoteUsage() {
  const { user } = useFirebaseAuth();
  const scopeId = workspaceFirestoreId(user);
  const queryClient = useQueryClient();

  const tier = getUserTier(user);
  const limit = monthlyQuoteLimit(user);

  const { data, isLoading } = useQuery({
    queryKey: ["firebase", "quoteUsage", scopeId ?? ""],
    queryFn: () => getQuoteUsage(scopeId),
    enabled: !!scopeId,
    staleTime: 30_000, // refresh every 30s at most
  });

  const used = data?.count ?? 0;
  const remaining = limit === -1 ? -1 : Math.max(0, limit - used);
  const isAtLimit = limit !== -1 && used >= limit;

  const increment = useCallback(async () => {
    if (!scopeId) return;
    const newCount = await incrementQuoteUsage(scopeId);
    // Optimistically update the cache
    queryClient.setQueryData(
      ["firebase", "quoteUsage", scopeId],
      { month: data?.month ?? "", count: newCount },
    );
  }, [scopeId, queryClient, data?.month]);

  return { used, limit, remaining, isAtLimit, increment, isLoading, tier };
}
