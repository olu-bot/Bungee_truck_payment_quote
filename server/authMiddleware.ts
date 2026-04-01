import type { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import { getFirebaseAdmin } from "./firebaseAdmin";

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: admin.auth.DecodedIdToken;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const app = getFirebaseAdmin();

  // In development without Firebase Admin configured, skip auth to allow local testing.
  // In production, Firebase Admin is always configured via service account.
  if (!app) {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }
    res.status(401).json({ error: "Firebase Admin not configured" });
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = header.slice(7);
  try {
    const decoded = await admin.auth(app).verifyIdToken(token);
    req.firebaseUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
