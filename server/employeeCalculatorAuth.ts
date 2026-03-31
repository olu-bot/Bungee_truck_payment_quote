import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { getAdminFirestore } from "./firebaseAdmin";

/** Server-only secret. Create in Firestore (Firebase Console → Firestore): */
export const EMPLOYEE_CALCULATOR_FIRESTORE = {
  collection: "admin_only_config",
  docId: "employee_calculator",
  passwordField: "password",
} as const;

function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Password for `/calculator.html` employee gate.
 * 1) Firestore `admin_only_config/employee_calculator` field `password` (preferred in production)
 * 2) Fallback: `SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD` (local dev / emergency)
 */
export async function getExpectedEmployeeCalculatorPassword(): Promise<string | null> {
  const db = getAdminFirestore();
  if (db) {
    try {
      const snap = await db
        .collection(EMPLOYEE_CALCULATOR_FIRESTORE.collection)
        .doc(EMPLOYEE_CALCULATOR_FIRESTORE.docId)
        .get();
      const p = snap.data()?.[EMPLOYEE_CALCULATOR_FIRESTORE.passwordField];
      if (typeof p === "string" && p.length > 0) return p;
    } catch (e) {
      console.error("[employee-calculator-auth] Firestore read failed:", e);
    }
  }
  const env = process.env.SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD?.trim();
  return env && env.length > 0 ? env : null;
}

export function registerEmployeeCalculatorAuthRoutes(app: Express): void {
  app.post("/api/employee-calculator-auth", async (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const expected = await getExpectedEmployeeCalculatorPassword();
    if (!expected) {
      return res.status(503).json({ ok: false, error: "not_configured" });
    }
    if (!timingSafeEqualString(password, expected)) {
      return res.status(401).json({ ok: false });
    }
    res.json({ ok: true });
  });
}
