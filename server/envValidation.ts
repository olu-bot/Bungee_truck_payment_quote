import { z } from "zod";

/**
 * Validates environment variables at startup.
 * - Production: throws on missing critical vars (server won't start).
 * - Development: warns but allows startup.
 *
 * Firebase Admin vars are validated by the Firebase SDK itself and are
 * intentionally excluded here.
 */

const envSchema = z.object({
  // Google Maps — at least one required for geocoding / directions
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),
  VITE_GOOGLE_MAPS_EMBED_KEY: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // SMTP (feedback form)
  FEEDBACK_SMTP_HOST: z.string().optional(),
  FEEDBACK_SMTP_PORT: z.string().optional(),
  FEEDBACK_SMTP_USER: z.string().optional(),
  FEEDBACK_SMTP_PASS: z.string().optional(),

  // Employee calculator password
  SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD: z.string().optional(),
});

type EnvKey = keyof z.infer<typeof envSchema>;

interface CriticalCheck {
  /** At least one of these keys must have a non-empty value. */
  keys: EnvKey[];
  /** Human-readable consequence when missing. */
  message: string;
}

const criticalChecks: CriticalCheck[] = [
  {
    keys: ["GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_API_KEY"],
    message:
      "Missing GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY — geocoding, directions, and place suggestions will fail",
  },
  {
    keys: ["STRIPE_SECRET_KEY"],
    message:
      "Missing STRIPE_SECRET_KEY — Stripe checkout and subscription management will fail",
  },
  {
    keys: ["STRIPE_WEBHOOK_SECRET"],
    message:
      "Missing STRIPE_WEBHOOK_SECRET — Stripe webhook signature verification will fail",
  },
];

const optionalChecks: CriticalCheck[] = [
  {
    keys: ["VITE_GOOGLE_MAPS_EMBED_KEY"],
    message: "Missing VITE_GOOGLE_MAPS_EMBED_KEY — embedded map iframe will not render",
  },
  {
    keys: ["FEEDBACK_SMTP_HOST"],
    message:
      "Missing FEEDBACK_SMTP_HOST — feedback email submissions will be rejected (503)",
  },
  {
    keys: ["FEEDBACK_SMTP_PORT"],
    message: "Missing FEEDBACK_SMTP_PORT — defaulting SMTP port behaviour to Nodemailer defaults",
  },
  {
    keys: ["FEEDBACK_SMTP_USER", "FEEDBACK_SMTP_PASS"],
    message: "Missing FEEDBACK_SMTP_USER / FEEDBACK_SMTP_PASS — SMTP auth will fail",
  },
  {
    keys: ["SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD"],
    message:
      "Missing SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD — employee calculator will rely on Firestore password only",
  },
];

function hasValue(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";

  // Run Zod parse to surface unexpected shape issues (purely structural).
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    console.warn("[env] Schema validation issues:", formatted);
  }

  const errors: string[] = [];

  // --- Critical vars ---
  for (const check of criticalChecks) {
    const present = check.keys.some(hasValue);
    if (!present) {
      if (isProd) {
        errors.push(check.message);
      } else {
        console.warn(`[env] WARNING: ${check.message}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed (NODE_ENV=production):\n  - ${errors.join("\n  - ")}`,
    );
  }

  // --- Optional vars (warn only) ---
  for (const check of optionalChecks) {
    const present = check.keys.some(hasValue);
    if (!present) {
      console.warn(`[env] WARNING: ${check.message}`);
    }
  }

  if (isProd) {
    console.log("[env] All critical environment variables are set.");
  }
}
