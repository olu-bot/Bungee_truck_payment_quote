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

/** One Price ID per tier in env (e.g. monthly only — do not list year + month for the same tier). */
function premiumPriceEnv(): string | undefined {
  return (
    process.env.STRIPE_PRICE_ID_PREMIUM?.trim() || process.env.STRIPE_PRICE_ID_FLEET?.trim() || undefined
  );
}

function tierFromPriceId(priceId: string | null): "free" | "pro" | "fleet" {
  const premium = premiumPriceEnv();
  const pro = process.env.STRIPE_PRICE_ID_PRO?.trim();
  const free = process.env.STRIPE_PRICE_ID_FREE?.trim();
  if (priceId && premium && priceId === premium) return "fleet";
  if (priceId && pro && priceId === pro) return "pro";
  if (priceId && free && priceId === free) return "free";
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
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *      STRIPE_PRICE_ID_PRO, STRIPE_PRICE_ID_PREMIUM (or STRIPE_PRICE_ID_FLEET), optional STRIPE_PRICE_ID_FREE.
 *      Use one price_… per tier (e.g. monthly only).
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
    const proPrice = process.env.STRIPE_PRICE_ID_PRO?.trim();
    const premiumPrice = premiumPriceEnv();

    const priceId =
      tier === "fleet" ? premiumPrice : tier === "pro" ? proPrice : null;

    if (!priceId) {
      if (tier !== "pro" && tier !== "fleet") {
        return res.status(400).json({ error: "Invalid tier. Use \"pro\" or \"fleet\"." });
      }
      return res.status(503).json({
        error:
          tier === "fleet"
            ? "Missing Premium price ID. Set STRIPE_PRICE_ID_PREMIUM (or STRIPE_PRICE_ID_FLEET)."
            : "Missing Pro price ID. Set STRIPE_PRICE_ID_PRO.",
      });
    }

    try {
      const host = req.get("host") || "localhost";
      const origin =
        process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
        `${req.protocol}://${host}`;

      const customerEmail =
        typeof req.body?.customerEmail === "string" && req.body.customerEmail.includes("@")
          ? req.body.customerEmail
          : undefined;

      const clientReferenceId =
        typeof req.body?.clientReferenceId === "string" && req.body.clientReferenceId.length > 0
          ? req.body.clientReferenceId
          : undefined;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/#/profiles?checkout=success`,
        cancel_url: `${origin}/#/profiles?checkout=cancel`,
        customer_email: customerEmail,
        client_reference_id: clientReferenceId,
        subscription_data: {
          metadata: {
            tier: tier === "fleet" ? "premium" : "pro",
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
