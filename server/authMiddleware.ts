import type { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type AuthenticatedRequest = Request & {
  uid?: string;
};

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const app = getFirebaseAdmin();
  if (!app) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] Firebase Admin not configured — skipping auth check (dev only)");
      next();
      return;
    }
    res.status(503).json({ error: "Authentication service unavailable" });
    return;
  }

  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const idToken = raw.slice(7);
  admin.auth(app).verifyIdToken(idToken)
    .then((decoded) => {
      req.uid = decoded.uid;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid or expired token" });
    });
}
