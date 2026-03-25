import admin from "firebase-admin";

/** Lazy init: FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or Cloud Run ADC. */
export function getFirebaseAdmin(): admin.app.App | null {
  if (admin.apps.length > 0) {
    return admin.app();
  }
  try {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (json) {
      const cred = JSON.parse(json) as admin.ServiceAccount;
      return admin.initializeApp({ credential: admin.credential.cert(cred) });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
      return admin.initializeApp();
    }
  } catch (e) {
    console.error("[firebase-admin] init failed:", e);
  }
  return null;
}

export function getAdminFirestore(): admin.firestore.Firestore | null {
  const app = getFirebaseAdmin();
  return app ? admin.firestore(app) : null;
}

export async function verifyBearerIsAdmin(req: {
  headers: { authorization?: string };
}): Promise<{ uid: string } | null> {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  const idToken = raw.slice(7);
  const app = getFirebaseAdmin();
  if (!app) return null;
  try {
    const decoded = await admin.auth(app).verifyIdToken(idToken);
    const doc = await admin.firestore(app).doc(`users/${decoded.uid}`).get();
    if (doc.data()?.role !== "admin") return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
