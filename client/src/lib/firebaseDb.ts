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

/** Firestore rejects `undefined` as a field value. */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
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

// ─── User Profile ────────────────────────────────────────────────

export async function updateUserProfile(
  uid: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!firebaseConfigured || !uid) return;
  const ref = doc(db, "users", uid);
  await updateDoc(ref, data);
}

// ─── Company Accessorial Policy ─────────────────────────────────────

export type CompanyAccessorialPolicy = {
  detentionRate: number;      // $/hr
  stopOffRate: number;        // $ per extra stop
  costInflationPct: number;   // % markup for hazmat, regulatory, etc.
};

const DEFAULT_ACCESSORIAL_POLICY: CompanyAccessorialPolicy = {
  detentionRate: 75,
  stopOffRate: 75,
  costInflationPct: 0,
};

export async function getAccessorialPolicy(
  companyId: string | undefined,
): Promise<CompanyAccessorialPolicy> {
  if (!firebaseConfigured || !companyId) return { ...DEFAULT_ACCESSORIAL_POLICY };
  try {
    const ref = doc(db, "companies", companyId);
    const snap = await getDoc(ref);
    const data = snap.data();
    if (!data?.accessorialPolicy) return { ...DEFAULT_ACCESSORIAL_POLICY };
    return { ...DEFAULT_ACCESSORIAL_POLICY, ...data.accessorialPolicy } as CompanyAccessorialPolicy;
  } catch {
    return { ...DEFAULT_ACCESSORIAL_POLICY };
  }
}

export async function updateAccessorialPolicy(
  companyId: string | undefined,
  policy: Partial<CompanyAccessorialPolicy>,
): Promise<void> {
  if (!firebaseConfigured || !companyId) return;
  const ref = doc(db, "companies", companyId);
  await updateDoc(ref, { accessorialPolicy: policy });
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
  scopeId: string | undefined,
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
  try {
    await setDoc(doc(db, "feedback", feedbackId), row);
  } catch (e: unknown) {
    // Some projects run older Firestore rules that block global /feedback writes.
    // Fallback to a per-workspace path allowed by company-scoped rules.
    const code = (e as { code?: string } | null)?.code ?? "";
    const isPermissionDenied = typeof code === "string" && code.includes("permission-denied");
    if (!isPermissionDenied) throw e;
    const fallbackScope = (scopeId ?? uid).trim();
    await setDoc(doc(db, "companies", fallbackScope, "feedback", feedbackId), row);
  }
  return row;
}

export async function listFeedbackForUser(uid: string | undefined, scopeId?: string): Promise<FeedbackTicket[]> {
  if (!firebaseConfigured || !db || !uid) return [];
  const out: FeedbackTicket[] = [];
  const seen = new Set<string>();

  // Primary path (global feedback collection)
  try {
    const q = query(
      collection(db, "feedback"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const row = { id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as FeedbackTicket;
      seen.add(row.id);
      out.push(row);
    }
  } catch {
    // ignore: may be blocked by rules on some deployments
  }

  // Fallback workspace path (used when global writes are denied)
  const scoped = (scopeId ?? uid).trim();
  try {
    const scopedQuery = query(collection(db, "companies", scoped, "feedback"), orderBy("createdAt", "desc"));
    const snap = await getDocs(scopedQuery);
    for (const d of snap.docs) {
      const row = { id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as FeedbackTicket;
      if (row.userId !== uid || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  } catch {
    // ignore: collection may not exist yet
  }

  return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  await setDoc(
    doc(db, "companies", companyId, "quotes", quoteId),
    omitUndefined(quote as unknown as Record<string, unknown>) as Quote,
  );
  return quote;
}

export async function updateQuote(
  companyId: string | undefined,
  quoteId: string,
  data: Partial<Pick<Quote, "customerNote" | "status" | "wonRate" | "statusNote" | "lostTargetPrice" | "customerPrice" | "grossProfit" | "profitMarginPercent" | "marginValue" | "marginAmount">>
): Promise<void> {
  requireSignedInScope(companyId);
  const ref = doc(db, "companies", companyId, "quotes", quoteId);
  await updateDoc(ref, omitUndefined(data as Record<string, unknown>));
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

// ─── Chat Quote Logs (admin-only, not shown in user quote history) ─

export async function createChatQuoteLog(
  uid: string | undefined,
  companyId: string | undefined,
  data: Omit<Quote, "id" | "quoteNumber" | "createdAt">
): Promise<Quote> {
  if (!firebaseConfigured || !db || !uid) throw new Error("Sign in required.");
  const logId = `cql_${id()}`;
  const quoteNumber = `CQL-${Date.now().toString(36).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const entry: Quote & { userId: string; companyId: string } = {
    ...data,
    id: logId,
    quoteNumber,
    createdAt,
    userId: uid,
    companyId: companyId || uid,
  } as Quote & { userId: string; companyId: string };
  await setDoc(
    doc(db, "chatQuoteLogs", logId),
    omitUndefined(entry as unknown as Record<string, unknown>),
  );
  return entry;
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

// ─── Invites ──────────────────────────────────────────────────────

export type Invite = {
  id: string;
  email: string;
  role: string; // CompanyRole value
  invitedBy: string; // uid of inviter
  inviterName: string;
  companyName: string;
  companyId: string;
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
  acceptedAt?: string;
};

export async function getInvites(companyId: string | undefined): Promise<Invite[]> {
  if (!firebaseConfigured || !companyId) return [];
  const snap = await getDocs(collection(db, "companies", companyId, "invites"));
  return snap.docs
    .map((d) => ({ id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as Invite))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createInvite(
  companyId: string | undefined,
  data: Omit<Invite, "id">
): Promise<Invite> {
  requireSignedInScope(companyId);
  const inviteId = `inv_${id()}`;
  const invite: Invite = { ...data, id: inviteId };
  await setDoc(doc(db, "companies", companyId, "invites", inviteId), invite);
  return invite;
}

export async function revokeInvite(
  companyId: string | undefined,
  inviteId: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "invites", inviteId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await updateDoc(ref, { status: "revoked" });
  return true;
}

export async function acceptInvite(
  companyId: string | undefined,
  inviteId: string,
  uid: string
): Promise<boolean> {
  if (!companyId) return false;
  const ref = doc(db, "companies", companyId, "invites", inviteId);
  const existing = await getDoc(ref);
  if (!existing.exists()) return false;
  await updateDoc(ref, { status: "accepted", acceptedAt: new Date().toISOString(), acceptedByUid: uid });
  return true;
}

/** Find a pending invite by email across a specific company. */
export async function findPendingInviteByEmail(
  companyId: string,
  email: string
): Promise<Invite | undefined> {
  if (!firebaseConfigured || !companyId) return undefined;
  const q = query(
    collection(db, "companies", companyId, "invites"),
    where("email", "==", email.toLowerCase()),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  if (snap.empty) return undefined;
  const d = snap.docs[0];
  return { id: d.id, ...toRecord(d.data() as Record<string, unknown>) } as Invite;
}

/** Get all company members (users who belong to a company). */
export async function getCompanyMembers(companyId: string | undefined): Promise<Array<{
  uid: string;
  name: string;
  email: string;
  companyRole: string;
  createdAt?: string;
}>> {
  if (!firebaseConfigured || !companyId) return [];
  const q = query(collection(db, "users"), where("companyId", "==", companyId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      uid: d.id,
      name: (data.name as string) || "",
      email: (data.email as string) || "",
      companyRole: (data.companyRole as string) || "member",
      createdAt: (data.createdAt as string) || undefined,
    };
  });
}

/** Update a user's company role. */
export async function updateUserCompanyRole(
  uid: string,
  companyRole: string
): Promise<void> {
  if (!firebaseConfigured || !uid) return;
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { companyRole });
}

/** Remove a user from a company (reset their companyId). */
export async function removeUserFromCompany(uid: string): Promise<void> {
  if (!firebaseConfigured || !uid) return;
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { companyId: null, companyRole: null });
}

// ── PDF Quote Template Settings ──────────────────────────────────

export type PdfTemplateSettings = {
  /** Displayed on PDF header — defaults to user's company name if blank */
  businessName: string;
  /** Tagline or description under the business name */
  tagline: string;
  /** Contact phone shown on PDF */
  contactPhone: string;
  /** Contact email override (defaults to user.email) */
  contactEmail: string;
  /** Full business address (street, city, province/state, postal code) shown on PDF */
  address: string;
  /** Base64-encoded company logo (data URL) for the PDF header */
  logoBase64: string;
  /** Quote validity period in days */
  validityDays: number;
  /** Payment terms */
  paymentTerms: string;
  /** Free detention hours before charges apply */
  freeDetentionHours: number;
  /** Detention rate per hour */
  detentionRate: number;
  /** Whether to show fuel surcharge clause */
  showFuelClause: boolean;
  /** Whether to show accessorial charges clause */
  showAccessorialClause: boolean;
  /** Additional custom terms — one per line */
  customTerms: string;
  /** Footer note */
  footerNote: string;
};

export const DEFAULT_PDF_TEMPLATE: PdfTemplateSettings = {
  businessName: "",
  tagline: "",
  contactPhone: "",
  contactEmail: "",
  address: "",
  logoBase64: "",
  validityDays: 7,
  paymentTerms: "Net 30",
  freeDetentionHours: 2,
  detentionRate: 75,
  showFuelClause: true,
  showAccessorialClause: true,
  customTerms: "",
  footerNote: "",
};

export async function getPdfTemplate(companyId: string | undefined): Promise<PdfTemplateSettings> {
  if (!firebaseConfigured || !companyId) return { ...DEFAULT_PDF_TEMPLATE };
  const snap = await getDoc(doc(db, "companies", companyId, "settings", "pdfTemplate"));
  if (!snap.exists()) return { ...DEFAULT_PDF_TEMPLATE };
  return { ...DEFAULT_PDF_TEMPLATE, ...(snap.data() as Partial<PdfTemplateSettings>) };
}

export async function savePdfTemplate(
  companyId: string | undefined,
  settings: PdfTemplateSettings,
): Promise<void> {
  requireSignedInScope(companyId);
  await setDoc(
    doc(db, "companies", companyId, "settings", "pdfTemplate"),
    settings,
  );
}

// ─── Quote Usage Tracking ────────────────────────────────────────

/** Current YYYY-MM key for quota tracking. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type QuoteUsage = { month: string; count: number };

/** Read the current month's quote usage count for a company. */
export async function getQuoteUsage(companyId: string | undefined): Promise<QuoteUsage> {
  const month = currentMonthKey();
  if (!firebaseConfigured || !companyId) return { month, count: 0 };
  const ref = doc(db, "companies", companyId, "usage", "quoteUsage");
  const snap = await getDoc(ref);
  if (!snap.exists()) return { month, count: 0 };
  const data = snap.data() as QuoteUsage;
  // If the stored month doesn't match current month, treat as 0 (new month)
  if (data.month !== month) return { month, count: 0 };
  return { month, count: data.count ?? 0 };
}

/** Increment the quote usage count. Returns new count. */
export async function incrementQuoteUsage(companyId: string | undefined): Promise<number> {
  requireSignedInScope(companyId);
  const month = currentMonthKey();
  const ref = doc(db, "companies", companyId, "usage", "quoteUsage");
  const snap = await getDoc(ref);
  let newCount = 1;
  if (snap.exists()) {
    const data = snap.data() as QuoteUsage;
    // Reset if new month
    newCount = data.month === month ? (data.count ?? 0) + 1 : 1;
  }
  await setDoc(ref, { month, count: newCount });
  return newCount;
}
