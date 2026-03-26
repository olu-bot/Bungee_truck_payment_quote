import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC = "https://js.stripe.com/v3/pricing-table.js";

/**
 * Embeds Stripe’s `<stripe-pricing-table>` (Dashboard → Product catalog → Pricing tables).
 * Set `VITE_STRIPE_PUBLISHABLE_KEY` and `VITE_STRIPE_PRICING_TABLE_ID` in `.env`.
 * Pass `client-reference-id` (Firebase uid) so `checkout.session.completed` can sync Firestore.
 */
export function StripePricingTableEmbed({
  pricingTableId,
  publishableKey,
  customerEmail,
  clientReferenceId,
}: {
  pricingTableId: string;
  publishableKey: string;
  customerEmail?: string;
  clientReferenceId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined" || !customElements) return;

    if (customElements.get("stripe-pricing-table")) {
      setScriptReady(true);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") {
        setScriptReady(true);
        return;
      }
      const onLoad = () => {
        if (!cancelled) setScriptReady(true);
      };
      existing.addEventListener("load", onLoad, { once: true });
      return () => {
        cancelled = true;
        existing.removeEventListener("load", onLoad);
      };
    }

    const s = document.createElement("script");
    s.async = true;
    s.src = SCRIPT_SRC;
    s.onload = () => {
      s.dataset.loaded = "1";
      if (!cancelled) setScriptReady(true);
    };
    document.body.appendChild(s);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !containerRef.current) return;
    const host = containerRef.current;
    host.innerHTML = "";

    const el = document.createElement("stripe-pricing-table");
    el.setAttribute("pricing-table-id", pricingTableId);
    el.setAttribute("publishable-key", publishableKey);
    if (customerEmail?.includes("@")) {
      el.setAttribute("customer-email", customerEmail);
    }
    if (clientReferenceId?.trim()) {
      el.setAttribute("client-reference-id", clientReferenceId.trim());
    }

    host.appendChild(el);

    return () => {
      host.innerHTML = "";
    };
  }, [scriptReady, pricingTableId, publishableKey, customerEmail, clientReferenceId]);

  if (!pricingTableId || !publishableKey) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Pricing table is not configured. Add VITE_STRIPE_PRICING_TABLE_ID and VITE_STRIPE_PUBLISHABLE_KEY to your
        environment.
      </p>
    );
  }

  return (
    <div className="w-full px-2 py-2">
      {!scriptReady ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
          Loading plans…
        </div>
      ) : null}
      <div ref={containerRef} className={scriptReady ? "min-h-[360px]" : "sr-only"} />
    </div>
  );
}
