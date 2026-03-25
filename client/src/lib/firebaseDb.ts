import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db, firebaseConfigured } from "@/lib/firebase";
import type {
  CostProfile,
  Yard,
  Quote,
  SavedRoute,
  Lane,
  TeamMember,
} from "@shared/schema";

/** Resolves storage scope — callers should pass `workspaceFirestoreId(user)` from @/lib/workspace */
function requireSignedInScope(scopeId: string | undefined): asserts scopeId is string {
  if (!scopeId) throw new Error("Please sign in to save your data.");
}

function id() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function toRecord<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v instanceof Timestamp) (out as Record<string, unknown>)[k] = v.toDate().toISOString();
  }
  return out;
}

// ─── Admin directory (requires Firestore rules: global admin read on users) ─

export type DirectoryUser = {
  uid: string;
  name: string;
  email: string;
  companyName: string;
  companyId?: string;
  sector: string;
  role: string;
  operatingCountryCode?: string;
  operatingCountries?: string[];
};

export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
  if (!firebaseConfigured) return [];
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        name: String(data.name ?? ""),
        email: String(data.email ?? ""),
        companyName: String(data.companyName ?? ""),
        companyId: typeof data.companyId === "string" ? data.companyId : undefined,
        sector: String(data.sector ?? ""),
        role: String(data.role ?? "user"),
        operatingCountryCode:
          typeof data.operatingCountryCode === "string" ? data.operatingCountryCode : undefined,
        operatingCountries: Array.isArray(data.operatingCountries)
          ? data.operatingCountries.map(String)
          : undefined,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: "base" }));
}

// ─── Cost Profiles ─────────────────────────────────────────────────

export async function getProfiles(companyId: string | undefined): Promise<CostProfile[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "profiles"));
  return snap.docs
    .map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as CostProfile))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getProfile(
  companyId: string | undefined,
  profileId: string
): Promise<CostProfile | undefined> {
  if (!firebaseConfigured || !companyId) return undefined;
  const snap = await getDoc(doc(db, "companies", companyId, "profiles", profileId));
  if (!snap.exists()) return undefined;
  return { id: snap.id, ...toRecord(snap.data() as Record<string, unknown>) } as CostProfile;
}

export async function createProfile(
  companyId: string | undefined,
  data: Omit<CostProfile, "id">
): Promise<CostProfile> {
  requireSignedInScope(companyId);
  const profileId = `cp_${id()}`;
  const profile: CostProfile = { ...data, id: profileId } as CostProfile;
  await setDoc(doc(db, "companies", companyId, "profiles", profileId), profile);
  return profile;
}

export async function updateProfile(
  companyId: string | undefined,
  profileId: string,
  data: Partial<Omit<CostProfile, "id">>
): Promise<CostProfile | undefined> {
  requireSignedInScope(companyId);
  const ref = doc(db, "companies", companyId, "profiles", profileId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return undefined;
  const updated = { ...existing.data(), ...data } as CostProfile;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(ref, data as any);
  return updated;
}

export async function deleteProfile(
  companyId: string | undefined,
  profileId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "profiles", profileId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

// ─── Yards ────────────────────────────────────────────────────────

export async function getYards(companyId: string | undefined): Promise<Yard[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "yards"));
  return snap.docs.map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as Yard));
}

export async function createYard(
  companyId: string | undefined,
  data: Omit<Yard, "id">
): Promise<Yard> {
  requireSignedInScope(companyId);
  const yardId = `yd_${id()}`;
  const yard: Yard = { ...data, id: yardId } as Yard;
  await setDoc(doc(db, "companies", companyId, "yards", yardId), yard);
  return yard;
}

export async function updateYard(
  companyId: string | undefined,
  yardId: string,
  data: Partial<Omit<Yard, "id">>
): Promise<Yard | undefined> {
  requireSignedInScope(companyId);
  const ref = doc(db, "companies", companyId, "yards", yardId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(ref, data as any);
  return { ...existing.data(), ...data } as Yard;
}

export async function deleteYard(
  companyId: string | undefined,
  yardId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "yards", yardId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

/** Create or update the default yard from onboarding (city, region, country). */
export async function syncDefaultYardFromOperatingCity(
  companyId: string | undefined,
  args: {
    city: string;
    stateOrProvinceName: string;
    countryLabel: string;
    lat?: number | null;
    lng?: number | null;
  }
): Promise<void> {
  if (!firebaseConfigured || !companyId) return;
  const city = args.city.trim();
  if (!city) return;
  const state = args.stateOrProvinceName.trim();
  const country = args.countryLabel.trim();
  const address = [city, state, country].filter(Boolean).join(", ");
  const lat =
    args.lat != null && args.lng != null && Number.isFinite(args.lat) && Number.isFinite(args.lng)
      ? args.lat
      : null;
  const lng = lat != null && args.lng != null ? args.lng : null;

  const yardsList = await getYards(companyId);
  const target = yardsList.find((y) => y.isDefault) ?? yardsList[0];

  if (target) {
    await updateYard(companyId, target.id, {
      name: city,
      address,
      lat,
      lng,
      isDefault: true,
    });
  } else {
    await createYard(companyId, {
      name: city,
      address,
      lat,
      lng,
      isDefault: true,
    });
  }
}

// ─── Feedback (global collection) ──────────────────────────────────

export type FeedbackTicket = {
  id: string;
  userId: string;
  companyId?: string;
  companyName: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  area: string;
  createdAt: string;
  status: "open" | "replied";
  readByAdmin: boolean;
  adminReply?: string | null;
  adminReplyAt?: string | null;
  adminReplyByUid?: string | null;
  replyEmailedAt?: string | null;
};

export async function createFeedbackTicket(
  uid: string | undefined,
  data: Omit<
    FeedbackTicket,
    "id" | "userId" | "createdAt" | "status" | "readByAdmin" | "adminReply" | "adminReplyAt" | "adminReplyByUid" | "replyEmailedAt"
  >
): Promise<FeedbackTicket> {
  if (!firebaseConfigured || !db || !uid) throw new Error("Sign in to send feedback.");
  const feedbackId = `fb_${id()}`;
  const row: FeedbackTicket = {
    id: feedbackId,
    userId: uid,
    ...data,
    createdAt: new Date().toISOString(),
    status: "open",
    readByAdmin: false,
  };
  await setDoc(doc(db, "feedback", feedbackId), row);
  return row;
}

export async function listFeedbackForUser(uid: string | undefined): Promise<FeedbackTicket[]> {
  if (!firebaseConfigured || !db || !uid) return [];
  const q = query(
    collection(db, "feedback"),
    where("userId", "==", uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as FeedbackTicket));
}

export async function listAllFeedbackForAdmin(): Promise<FeedbackTicket[]> {
  if (!firebaseConfigured || !db) return [];
  const q = query(collection(db, "feedback"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as FeedbackTicket));
}

export async function updateFeedbackByAdmin(
  feedbackId: string,
  patch: Partial<
    Pick<
      FeedbackTicket,
      "adminReply" | "adminReplyAt" | "adminReplyByUid" | "readByAdmin" | "status" | "replyEmailedAt"
    >
  >
): Promise<void> {
  if (!firebaseConfigured || !db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, "feedback", feedbackId), patch as Record<string, unknown>);
}

// ─── Quotes ───────────────────────────────────────────────────────

export async function getQuotes(companyId: string | undefined): Promise<Quote[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "quotes"));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return { id: d.id, ...toRecord(data), distance: Number(data.distance), profitMarginPercent: Number(data.profitMarginPercent) } as Quote;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createQuote(
  companyId: string | undefined,
  data: Omit<Quote, "id" | "quoteNumber" | "createdAt">
): Promise<Quote> {
  requireSignedInScope(companyId);
  const quoteId = `qt_${id()}`;
  const quoteNumber = `BQ-${Date.now().toString(36).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const quote: Quote = { ...data, id: quoteId, quoteNumber, createdAt } as Quote;
  await setDoc(doc(db, "companies", companyId, "quotes", quoteId), quote);
  return quote;
}

export async function deleteQuote(
  companyId: string | undefined,
  quoteId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "quotes", quoteId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────

export async function getRoutes(companyId: string | undefined): Promise<SavedRoute[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "routes"));
  return snap.docs
    .map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as SavedRoute))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createRoute(
  companyId: string | undefined,
  data: Omit<SavedRoute, "id">
): Promise<SavedRoute> {
  requireSignedInScope(companyId);
  const routeId = `rt_${id()}`;
  const route: SavedRoute = { ...data, id: routeId } as SavedRoute;
  await setDoc(doc(db, "companies", companyId, "routes", routeId), route);
  return route;
}

export async function deleteRoute(
  companyId: string | undefined,
  routeId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "routes", routeId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

// ─── Lanes ────────────────────────────────────────────────────────

export async function getLanes(companyId: string | undefined): Promise<Lane[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "lanes"));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return { id: d.id, ...toRecord(data), estimatedMiles: Number(data.estimatedMiles) } as Lane;
  });
}

export async function createLane(
  companyId: string | undefined,
  data: Omit<Lane, "id">
): Promise<Lane> {
  requireSignedInScope(companyId);
  const laneId = `ln_${id()}`;
  const lane: Lane = { ...data, id: laneId } as Lane;
  await setDoc(doc(db, "companies", companyId, "lanes", laneId), lane);
  return lane;
}

export async function deleteLane(
  companyId: string | undefined,
  laneId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "lanes", laneId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

// ─── Team ─────────────────────────────────────────────────────────

export async function getTeamMembers(companyId: string | undefined): Promise<TeamMember[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "team"));
  return snap.docs
    .map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as TeamMember))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createTeamMember(
  companyId: string | undefined,
  data: Omit<TeamMember, "id">
): Promise<TeamMember> {
  requireSignedInScope(companyId);
  const memberId = `tm_${id()}`;
  const member: TeamMember = { ...data, id: memberId } as TeamMember;
  await setDoc(doc(db, "companies", companyId, "team", memberId), member);
  return member;
}

export async function updateTeamMember(
  companyId: string | undefined,
  memberId: string,
  data: Partial<Omit<TeamMember, "id">>
): Promise<TeamMember | undefined> {
  requireSignedInScope(companyId);
  const ref = doc(db, "companies", companyId, "team", memberId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(ref, data as any);
  return { ...existing.data(), ...data } as TeamMember;
}

export async function deleteTeamMember(
  companyId: string | undefined,
  memberId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "team", memberId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await deleteDoc(ref);
  return true;
}

export async function authenticateTeamByPin(
  companyId: string | undefined,
  pin: string
): Promise<TeamMember | undefined> {
  const members = await getTeamMembers(companyId);
  return members.find((m) => m.pin === pin);
}
