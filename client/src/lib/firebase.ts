import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

const envKeysPresent = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/**
 * Safari Private / strict modes often block localStorage + IndexedDB.
 * Firestore's default persistence uses IndexedDB and can fail; memory cache avoids that.
 */
function browserStorageLikelyBlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = "__bungee_ls_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return false;
  } catch {
    return true;
  }
}

function openFirestore(app: FirebaseApp): Firestore {
  if (browserStorageLikelyBlocked()) {
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
  return getFirestore(app);
}

function bootstrap(): { auth: Auth; db: Firestore; ok: true } | { auth: Auth; db: Firestore; ok: false } {
  if (!envKeysPresent) {
    return {
      auth: undefined as unknown as Auth,
      db: undefined as unknown as Firestore,
      ok: false,
    };
  }
  try {
    const app: FirebaseApp = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = openFirestore(app);
    return { auth, db, ok: true };
  } catch (err) {
    console.warn("[firebase] Bootstrap failed (try private mode / allow storage for this site):", err);
    return {
      auth: undefined as unknown as Auth,
      db: undefined as unknown as Firestore,
      ok: false,
    };
  }
}

const boot = bootstrap();

/** True when env keys exist and Firebase Auth + Firestore initialized without throwing. */
export const firebaseConfigured = envKeysPresent && boot.ok;

export const auth = boot.auth;
export const db = boot.db;
