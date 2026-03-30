import type { Express, Request, Response } from "express";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getAdminFirestore } from "./firebaseAdmin";

type RequestWithRaw = Request & { rawBody?: Buffer };

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

type SubscriptionTier = "free" | "pro" | "fleet";

type BillingPeriod = "month" | "year";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Stripe return URLs: SPA root + `#/profiles?...`. Use CONNECT_PUBLIC_PATH=connect when app lives at /connect/. */
function checkoutSpaRoot(req: Request): string {
  const host = req.get("host") || "localhost";
  const origin = (readEnv("PUBLIC_APP_URL") || `${req.protocol}://${host}`).replace(/\/$/, "");
  const seg = (readEnv("CONNECT_PUBLIC_PATH") || "").replace(/^\/+|\/+$/g, "");
  return seg ? `${origin}/${seg}/` : `${origin}/`;
}

function premiumPriceEnv(period: BillingPeriod = "month"): string | undefined {
  if (period === "year") {
    return (
      readEnv("STRIPE_PRICE_ID_PREMIUM_YEAR") ||
      readEnv("STRIPE_PRICE_ID_FLEET_YEAR") ||
      readEnv("STRIPE_PRICE_ID_PREMIUM") ||
      readEnv("STRIPE_PRICE_ID_FLEET")
    );
  }
  return readEnv("STRIPE_PRICE_ID_PREMIUM_MONTH") || readEnv("STRIPE_PRICE_ID_FLEET_MONTH") || readEnv("STRIPE_PRICE_ID_PREMIUM") || readEnv("STRIPE_PRICE_ID_FLEET");
}

function proPriceEnv(period: BillingPeriod = "month"): string | undefined {
  if (period === "year") {
    return readEnv("STRIPE_PRICE_ID_PRO_YEAR") || readEnv("STRIPE_PRICE_ID_PRO");
  }
  return readEnv("STRIPE_PRICE_ID_PRO_MONTH") || readEnv("STRIPE_PRICE_ID_PRO");
}

function freePriceEnv(period: BillingPeriod = "month"): string | undefined {
  if (period === "year") {
    return readEnv("STRIPE_PRICE_ID_FREE_YEAR") || readEnv("STRIPE_PRICE_ID_FREE");
  }
  return readEnv("STRIPE_PRICE_ID_FREE_MONTH") || readEnv("STRIPE_PRICE_ID_FREE");
}

function tierFromPriceId(priceId: string | null): "free" | "pro" | "fleet" {
  const premiumIds = [
    premiumPriceEnv("month"),
    premiumPriceEnv("year"),
  ].filter(Boolean);
  const proIds = [proPriceEnv("month"), proPriceEnv("year")].filter(Boolean);
  const freeIds = [freePriceEnv("month"), freePriceEnv("year")].filter(Boolean);
  if (priceId && premiumIds.includes(priceId)) return "fleet";
  if (priceId && proIds.includes(priceId)) return "pro";
  if (priceId && freeIds.includes(priceId)) return "free";
  return "pro";
}

function deriveSubscriptionFields(sub: Stripe.Subscription): {
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
} {
  const status = sub.status;
  const paidStatuses = ["active", "trialing", "past_due"];
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const meta = sub.metadata?.tier?.toLowerCase();
  let tierMeta: "free" | "pro" | "fleet" =
    meta === "fleet" || meta === "premium"
      ? "fleet"
      : meta === "pro"
        ? "pro"
        : meta === "free"
          ? "free"
          : tierFromPriceId(priceId);
  const subscriptionTier: SubscriptionTier = paidStatuses.includes(status) ? tierMeta : "free";
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  return {
    subscriptionTier,
    subscriptionStatus: status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
  };
}

/**
 * Writes Stripe subscription state to `users/{uid}` (requires Firebase Admin).
 * Without Admin credentials, paid users won’t unlock in-app until you configure the service account.
 */
/** Resolve Firebase uid from subscription metadata or Firestore lookup by Stripe customer id. */
async function resolveUidForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.firebaseUid?.trim();
  if (fromMeta) return fromMeta;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  if (!customerId) return null;
  const db = getAdminFirestore();
  if (!db) return null;
  try {
    const snap = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].id;
  } catch (e) {
    console.warn("[stripe] resolveUidForSubscription lookup failed", e);
    return null;
  }
}

async function syncSubscriptionToUser(uid: string, sub: Stripe.Subscription): Promise<void> {
  const db = getAdminFirestore();
  if (!db) {
    console.warn(
      "[stripe] Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON / ADC). Subscription not synced to Firestore.",
    );
    return;
  }
  const fields = deriveSubscriptionFields(sub);
  await db.doc(`users/${uid}`).set(
    {
      ...fields,
      subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log("[stripe] synced subscription to users/", uid, fields.subscriptionTier, fields.subscriptionStatus);
}

/**
 * Stripe Checkout (subscriptions) + webhook handler.
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *      STRIPE_PRICE_ID_{FREE,PRO,PREMIUM}_{MONTH,YEAR}
 *      (legacy fallbacks still supported: STRIPE_PRICE_ID_FREE/PRO/PREMIUM/FLEET)
 *      PUBLIC_APP_URL (optional, e.g. https://app.example.com for success/cancel URLs)
 * Server: FIREBASE_SERVICE_ACCOUNT_JSON (or Cloud Run service account) so webhooks can update Firestore.
 */
export function registerStripeRoutes(app: Express): void {
  app.post("/api/stripe/create-checkout-session", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });
    }

    const tier = (req.body?.tier as string)?.toLowerCase();
    const cycleRaw = (req.body?.billingPeriod as string)?.toLowerCase();
    const billingPeriod: BillingPeriod = cycleRaw === "year" || cycleRaw === "yearly" ? "year" : "month";

    if (tier === "free") {
      return res.json({ redirectPath: "/" });
    }

    const normalizedTier = tier === "premium" ? "fleet" : tier;
    const proPrice = proPriceEnv(billingPeriod);
    const premiumPrice = premiumPriceEnv(billingPeriod);

    const priceId = normalizedTier === "fleet" ? premiumPrice : normalizedTier === "pro" ? proPrice : null;

    if (!priceId) {
      if (normalizedTier !== "pro" && normalizedTier !== "fleet") {
        return res.status(400).json({ error: "Invalid tier. Use \"free\", \"pro\", or \"premium\"." });
      }
      return res.status(503).json({
        error:
          normalizedTier === "fleet"
            ? `Missing Premium price ID for ${billingPeriod}. Set STRIPE_PRICE_ID_PREMIUM_${billingPeriod === "year" ? "YEAR" : "MONTH"}.`
            : `Missing Pro price ID for ${billingPeriod}. Set STRIPE_PRICE_ID_PRO_${billingPeriod === "year" ? "YEAR" : "MONTH"}.`,
      });
    }

    try {
      const customerEmail =
        typeof req.body?.customerEmail === "string" && req.body.customerEmail.includes("@")
          ? req.body.customerEmail
          : undefined;

      const clientReferenceId =
        typeof req.body?.clientReferenceId === "string" && req.body.clientReferenceId.length > 0
          ? req.body.clientReferenceId
          : undefined;

      const spaRoot = checkoutSpaRoot(req);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${spaRoot}#/profiles?checkout=success`,
        cancel_url: `${spaRoot}#/profiles?checkout=cancel`,
        customer_email: customerEmail,
        client_reference_id: clientReferenceId,
        subscription_data: {
          metadata: {
            tier: normalizedTier === "fleet" ? "premium" : "pro",
            ...(clientReferenceId ? { firebaseUid: clientReferenceId } : {}),
          },
        },
        allow_promotion_codes: true,
      });

      if (!session.url) {
        return res.status(500).json({ error: "Stripe did not return a checkout URL." });
      }

      res.json({ url: session.url });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Checkout failed";
      console.error("[stripe] create-checkout-session", e);
      res.status(500).json({ error: message });
    }
  });

  /**
   * Public read: amounts for Pro / Premium from the same Price IDs used at checkout,
   * so the upgrade modal matches Stripe-hosted totals.
   */
  app.get("/api/stripe/pricing-display", async (_req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured." });
    }
    const stripeClient = stripe;

    type Slot = {
      amount: number;
      currency: string;
      interval: "month" | "year";
      monthlyEquivalent?: number;
    };

    async function loadSlot(priceId: string | undefined): Promise<Slot | null> {
      if (!priceId) return null;
      try {
        const p = await stripeClient.prices.retrieve(priceId);
        const ua = p.unit_amount;
        if (ua == null) return null;
        const currency = (p.currency || "usd").toUpperCase();
        const interval = p.recurring?.interval;
        if (interval !== "month" && interval !== "year") return null;
        const amount = ua / 100;
        if (interval === "year") {
          const monthlyEquivalent = Math.round((amount / 12) * 100) / 100;
          return { amount, currency, interval: "year", monthlyEquivalent };
        }
        return { amount, currency, interval: "month" };
      } catch (e) {
        console.warn("[stripe] pricing-display retrieve failed", priceId, e);
        return null;
      }
    }

    const proMonth = await loadSlot(proPriceEnv("month"));
    const proYear = await loadSlot(proPriceEnv("year"));
    const premiumMonth = await loadSlot(premiumPriceEnv("month"));
    const premiumYear = await loadSlot(premiumPriceEnv("year"));

    res.json({
      pro: { month: proMonth, year: proYear },
      premium: { month: premiumMonth, year: premiumYear },
    });
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    const stripe = getStripe();
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !whSecret) {
      return res.status(503).send("Stripe webhook is not configured.");
    }

    const sig = req.headers["stripe-signature"];
    const rawBody = (req as RequestWithRaw).rawBody;

    if (!sig || !Buffer.isBuffer(rawBody)) {
      return res.status(400).send("Missing stripe-signature or raw body (check JSON parser rawBody).");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[stripe] webhook signature:", msg);
      return res.status(400).send(`Webhook signature verification failed: ${msg}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const uid = session.client_reference_id;
          const subRef = session.subscription;
          const subId = typeof subRef === "string" ? subRef : subRef?.id;
          if (uid && subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await syncSubscriptionToUser(uid, sub);
          } else {
            console.warn("[stripe] checkout.session.completed missing client_reference_id or subscription", session.id);
          }
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const uid = await resolveUidForSubscription(sub);
          if (uid) {
            await syncSubscriptionToUser(uid, sub);
          } else {
            console.warn(
              "[stripe] subscription event: could not resolve user (metadata.firebaseUid or users.stripeCustomerId)",
              sub.id,
              event.type,
            );
          }
          break;
        }
        default:
          break;
      }
    } catch (e: unknown) {
      console.error("[stripe] webhook handler error", e);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    res.json({ received: true });
  });
}
