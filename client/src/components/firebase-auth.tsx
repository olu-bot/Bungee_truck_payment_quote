import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";

import { auth, db, firebaseConfigured } from "@/lib/firebase";
import * as firebaseDb from "@/lib/firebaseDb";
import {
  connectGuestAppUser,
  isConnectGuestBuild,
  isConnectGuestUser,
  readConnectGuestDeclined,
  setConnectGuestDeclined,
} from "@/lib/connectGuest";
import { queryClient } from "@/lib/queryClient";
import type { MeasurementUnit } from "@/lib/measurement";

export type AppUserRole = "admin" | "user";
export type AppSector = "brokers" | "carriers" | "shippers";

export type AppUser = {
  uid: string;
  name: string;
  email: string;
  companyName: string;
  companyId?: string;
  sector: AppSector;
  fleetSize?: string;
  /** ISO country code for primary operating country (e.g. CA, US) — drives display currency. */
  operatingCountryCode?: string;
  operatingCountries?: string[];
  operatingRegions?: string[];
  /** Primary operating city (matches GeoNames-backed lists from onboarding). */
  operatingCity?: string;
  /** Distances / labels: metric (km, L) vs imperial (mi). */
  measurementUnit?: MeasurementUnit;
  role: AppUserRole;
  logoUrl?: string;
};

type FirebaseAuthContextValue = {
  user: AppUser | null;
  authLoading: boolean;
  login: (args: { email: string; password: string }) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (args: {
    name: string;
    companyName: string;
    sector: AppSector;
    email: string;
    password: string;
    fleetSize?: string;
    operatingCountryCode?: string;
    operatingCountries?: string[];
    operatingRegions?: string[];
    operatingCity?: string;
    measurementUnit?: MeasurementUnit;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<FirebaseAuthContextValue>({
  user: null,
  authLoading: true,
  login: async () => {},
  loginWithGoogle: async () => {},
  signup: async () => {},
  logout: async () => {},
});

export function useFirebaseAuth(): FirebaseAuthContextValue {
  return useContext(AuthContext);
}

async function loadUserProfile(fbUser: FirebaseUser): Promise<AppUser | null> {
  const userDoc = await getDoc(doc(db, "users", fbUser.uid));
  if (!userDoc.exists()) return null;

  const data = userDoc.data() as Omit<AppUser, "uid">;
  return {
    uid: fbUser.uid,
    ...data,
  };
}

/** Waits briefly for signup’s background Firestore write so we don’t create a second company. */
async function loadUserProfileWithRetry(
  fbUser: FirebaseUser,
  attempts = 10,
  delayMs = 120
): Promise<AppUser | null> {
  for (let i = 0; i < attempts; i++) {
    const p = await loadUserProfile(fbUser);
    if (p) return p;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Ensures the signed-in user always has a companyId in Firestore (and in memory).
 * Handles legacy profiles missing companyId and Auth accounts with no users/{uid} doc.
 */
async function resolveAppUser(fbUser: FirebaseUser): Promise<AppUser> {
  const userRef = doc(db, "users", fbUser.uid);
  const snap = await getDoc(userRef);
  const email = fbUser.email ?? "";

  if (snap.exists()) {
    const data = snap.data() as Omit<AppUser, "uid">;
    if (data.companyId) {
      return { uid: fbUser.uid, ...data };
    }

    const companyRef = doc(collection(db, "companies"));
    const companyId = companyRef.id;
    await setDoc(companyRef, {
      id: companyId,
      name: data.companyName || "My Company",
      sector: data.sector || "carriers",
      logoUrl: data.logoUrl ?? null,
      createdAt: new Date().toISOString(),
    });
    await setDoc(userRef, { companyId }, { merge: true });
    return { uid: fbUser.uid, ...data, companyId };
  }

  const companyRef = doc(collection(db, "companies"));
  const companyId = companyRef.id;
  const nameFromEmail = email.includes("@") ? email.split("@")[0] : "User";
  const name = fbUser.displayName || nameFromEmail || "User";
  await setDoc(companyRef, {
    id: companyId,
    name: "My Company",
    sector: "carriers",
    logoUrl: null,
    createdAt: new Date().toISOString(),
  });
  await setDoc(userRef, {
    name,
    email,
    companyId,
    companyName: "My Company",
    sector: "carriers",
    role: "user" as AppUserRole,
    logoUrl: null,
    createdAt: new Date().toISOString(),
  });
  return {
    uid: fbUser.uid,
    name,
    email,
    companyName: "My Company",
    companyId,
    sector: "carriers",
    role: "user",
  };
}

function buildFallbackUser(fbUser: FirebaseUser): AppUser {
  const email = fbUser.email ?? "";
  const nameFromEmail = email.includes("@") ? email.split("@")[0] : "User";
  return {
    uid: fbUser.uid,
    name: fbUser.displayName || nameFromEmail || "User",
    email,
    companyName: "My Company",
    sector: "carriers",
    role: "user",
  };
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!firebaseConfigured) {
      setAuthLoading(false);
      if (isConnectGuestBuild() && !readConnectGuestDeclined()) {
        setUser(connectGuestAppUser() as AppUser);
      } else {
        setUser(null);
      }
      return;
    }

    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        if (isConnectGuestBuild() && !readConnectGuestDeclined()) {
          setUser(connectGuestAppUser() as AppUser);
        } else {
          setUser(null);
        }
        setAuthLoading(false);
        return;
      }

      setConnectGuestDeclined(false);

      try {
        const existing = await loadUserProfile(fbUser);
        if (existing?.companyId) {
          setUser(existing);
          setAuthLoading(false);
          return;
        }
        if (existing && !existing.companyId) {
          const fixed = await resolveAppUser(fbUser);
          setUser(fixed);
          setAuthLoading(false);
          return;
        }

        // No users/{uid} yet — often signup still writing; keep in-memory user if it already has companyId.
        let keepOptimisticSignup = false;
        setUser((prev) => {
          if (prev?.uid === fbUser.uid && prev.companyId) {
            keepOptimisticSignup = true;
            return prev;
          }
          if (prev?.uid === fbUser.uid) return prev;
          return buildFallbackUser(fbUser);
        });
        if (keepOptimisticSignup) {
          setAuthLoading(false);
          return;
        }

        const retried = await loadUserProfileWithRetry(fbUser);
        if (retried?.companyId) {
          setUser(retried);
          setAuthLoading(false);
          return;
        }
        if (retried && !retried.companyId) {
          const fixed = await resolveAppUser(fbUser);
          setUser(fixed);
          setAuthLoading(false);
          return;
        }

        try {
          const created = await resolveAppUser(fbUser);
          setUser(created);
        } catch {
          setUser(buildFallbackUser(fbUser));
        }
        setAuthLoading(false);
      } catch {
        setUser((prev) => (prev?.uid === fbUser.uid ? prev : buildFallbackUser(fbUser)));
        setAuthLoading(false);
      }
    });
  }, []);

  const login = useCallback(async (args: { email: string; password: string }) => {
    if (!firebaseConfigured) throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env vars).");
    const cred = await signInWithEmailAndPassword(auth, args.email, args.password);
    try {
      setUser(await resolveAppUser(cred.user));
    } catch {
      setUser(buildFallbackUser(cred.user));
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (!firebaseConfigured) throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env vars).");
    const provider = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(auth, provider);
      try {
        setUser(await resolveAppUser(cred.user));
      } catch {
        setUser(buildFallbackUser(cred.user));
      }
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code: unknown }).code)
          : "";
      if (code === "auth/popup-blocked") {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw e;
    }
  }, []);

  const signup = useCallback(
    async (args: {
      name: string;
      companyName: string;
      sector: AppSector;
      email: string;
      password: string;
      fleetSize?: string;
      operatingCountryCode?: string;
      operatingCountries?: string[];
      operatingRegions?: string[];
      operatingCity?: string;
      measurementUnit?: MeasurementUnit;
    }) => {
      if (!firebaseConfigured) throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env vars).");
      const cred = await createUserWithEmailAndPassword(auth, args.email, args.password);
      const uid = cred.user.uid;
      const companyRef = doc(collection(db, "companies"));
      const companyId = companyRef.id;

      // Set user immediately so the app navigates to home right away.
      setUser({
        uid,
        name: args.name,
        email: args.email,
        companyName: args.companyName,
        companyId,
        sector: args.sector,
        fleetSize: args.fleetSize,
        operatingCountryCode: args.operatingCountryCode,
        operatingCountries: args.operatingCountries,
        operatingRegions: args.operatingRegions,
        operatingCity: args.operatingCity,
        measurementUnit: args.measurementUnit,
        role: "user",
      });

      // Firestore writes in background (do not block navigation).
      (async () => {
        try {
          await setDoc(companyRef, {
            id: companyId,
            name: args.companyName,
            sector: args.sector,
            fleetSize: args.fleetSize || null,
            operatingCountryCode: args.operatingCountryCode || null,
            operatingCountries: args.operatingCountries || [],
            operatingRegions: args.operatingRegions || [],
            operatingCity: args.operatingCity || null,
            measurementUnit: args.measurementUnit ?? null,
            logoUrl: null,
            createdAt: new Date().toISOString(),
          });
          await setDoc(doc(db, "users", uid), {
            name: args.name,
            email: args.email,
            companyId,
            companyName: args.companyName,
            sector: args.sector,
            fleetSize: args.fleetSize || null,
            operatingCountryCode: args.operatingCountryCode || null,
            operatingCountries: args.operatingCountries || [],
            operatingRegions: args.operatingRegions || [],
            operatingCity: args.operatingCity || null,
            measurementUnit: args.measurementUnit ?? null,
            role: "user" as AppUserRole,
            logoUrl: null,
            createdAt: new Date().toISOString(),
          });
          const regionName = args.operatingRegions?.[0]?.trim() ?? "";
          const countryLabel = args.operatingCountries?.[0]?.trim() ?? "";
          if (args.operatingCity?.trim() && regionName && countryLabel) {
            await firebaseDb.syncDefaultYardFromOperatingCity(companyId, {
              city: args.operatingCity,
              stateOrProvinceName: regionName,
              countryLabel,
            });
            await queryClient.invalidateQueries({ queryKey: ["firebase", "yards", companyId] });
          }
        } catch (e) {
          console.error("Failed to save profile to Firestore", e);
        }
      })();
    },
    []
  );

  const logout = useCallback(async () => {
    if (isConnectGuestUser(user)) {
      setConnectGuestDeclined(true);
      setUser(null);
      return;
    }
    if (!firebaseConfigured) return;
    await signOut(auth);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      authLoading,
      login,
      loginWithGoogle,
      signup,
      logout,
    }),
    [user, authLoading, login, loginWithGoogle, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

