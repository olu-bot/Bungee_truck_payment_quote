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
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = header.slice(7);
  try {
    const app = getFirebaseAdmin();
    if (!app) {
      res.status(401).json({ error: "Firebase Admin not configured" });
      return;
    }
    const decoded = await admin.auth(app).verifyIdToken(token);
    req.firebaseUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
