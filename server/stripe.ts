import type { Express, Request, Response } from "express";
import Stripe from "stripe";

type RequestWithRaw = Request & { rawBody?: Buffer };

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Stripe Checkout (subscriptions) + webhook handler.
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_PRO, STRIPE_PRICE_ID_FLEET, STRIPE_WEBHOOK_SECRET,
 *      PUBLIC_APP_URL (optional, e.g. https://app.example.com for success/cancel URLs)
 */
export function registerStripeRoutes(app: Express): void {
  app.post("/api/stripe/create-checkout-session", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });
    }

    const tier = (req.body?.tier as string)?.toLowerCase();
    const proPrice = process.env.STRIPE_PRICE_ID_PRO;
    const fleetPrice = process.env.STRIPE_PRICE_ID_FLEET;

    const priceId =
      tier === "fleet" ? fleetPrice : tier === "pro" ? proPrice : null;

    if (!priceId) {
      if (tier !== "pro" && tier !== "fleet") {
        return res.status(400).json({ error: "Invalid tier. Use \"pro\" or \"fleet\"." });
      }
      return res.status(503).json({
        error: `Missing Stripe price ID for ${tier}. Set STRIPE_PRICE_ID_${tier === "fleet" ? "FLEET" : "PRO"}.`,
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
            tier: tier === "fleet" ? "fleet" : "pro",
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

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[stripe] checkout.session.completed", session.id, session.customer);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        console.log("[stripe]", event.type, sub.id, sub.status);
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  });
}
