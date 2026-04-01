import { z } from "zod";

const envSchema = z.object({
  // VITE_FIREBASE_* are baked into the frontend bundle at build time — not needed here.
  // Optional server-side vars (warn if missing, but don't crash)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
});

type EnvWarning = { key: string; message: string };

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    if (isProd) {
      console.error("[env] Missing required environment variables:\n" + missing.join("\n"));
      process.exit(1);
    } else {
      console.warn("[env] Missing environment variables (dev mode — continuing):\n" + missing.join("\n"));
    }
  }

  // Warn about important optional vars
  const warnings: EnvWarning[] = [];
  if (!process.env.STRIPE_SECRET_KEY) {
    warnings.push({ key: "STRIPE_SECRET_KEY", message: "Stripe checkout will return 503" });
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.K_SERVICE) {
    warnings.push({ key: "FIREBASE_SERVICE_ACCOUNT_JSON", message: "Firebase Admin unavailable — webhook sync and admin features disabled" });
  }
  if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.VITE_GOOGLE_MAPS_API_KEY) {
    warnings.push({ key: "GOOGLE_MAPS_API_KEY", message: "Place suggestions will be disabled" });
  }

  if (warnings.length > 0) {
    console.warn("[env] Optional variables not set:");
    for (const w of warnings) {
      console.warn(`  - ${w.key}: ${w.message}`);
    }
  }
}
