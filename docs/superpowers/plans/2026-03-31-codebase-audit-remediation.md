# Codebase Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all security vulnerabilities, add test coverage, decompose the route-builder monolith, and improve type safety across the Bungee Connect freight pricing SaaS.

**Architecture:** Security-First Spiral — fix bugs and security issues first (Phase 1), add test coverage to protect against regressions (Phase 2), then refactor architecture and types (Phase 3), and finally tune performance (Phase 4). Each phase builds on the previous.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, Firebase Auth + Firestore, TanStack Query 5, Radix UI, Tailwind CSS 3, Express 4, Stripe, wouter, Vitest (new)

---

## Phase 1: Security & Bug Fixes

### Task 1: Fix permissions.ts Default Role Bug

**Files:**
- Modify: `client/src/lib/permissions.ts:82`

- [ ] **Step 1: Fix the ternary that always returns "owner"**

In `client/src/lib/permissions.ts`, line 82 currently reads:

```typescript
return user.companyRole ?? (user.role === "admin" ? "owner" : "owner");
```

Change it to:

```typescript
return user.companyRole ?? (user.role === "admin" ? "owner" : "member");
```

This ensures legacy users without `companyRole` who are NOT app-level admins get `"member"` permissions instead of `"owner"`.

- [ ] **Step 2: Verify the fix doesn't break the type check**

Run: `npm run check`
Expected: No type errors. The return type is `CompanyRole` which includes `"member"`.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/permissions.ts
git commit -m "fix: default legacy users without companyRole to member, not owner"
```

---

### Task 2: Add requireAuth() Middleware for API Routes

**Files:**
- Create: `server/authMiddleware.ts`
- Modify: `server/routes.ts` (add middleware to route registrations)

- [ ] **Step 1: Create the auth middleware**

Create `server/authMiddleware.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type AuthenticatedRequest = Request & {
  uid?: string;
};

/**
 * Express middleware that verifies a Firebase ID token from the
 * Authorization: Bearer <token> header.
 *
 * On success, sets `req.uid` to the Firebase user's UID.
 * On failure, returns 401.
 *
 * When Firebase Admin is not configured (local dev without service
 * account), falls through with a warning — endpoints remain open
 * in development but protected in production.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const app = getFirebaseAdmin();
  if (!app) {
    // Dev without Firebase Admin — allow through with warning
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
```

- [ ] **Step 2: Apply middleware to compute-heavy endpoints in routes.ts**

In `server/routes.ts`, add the import at the top:

```typescript
import { requireAuth, type AuthenticatedRequest } from "./authMiddleware";
```

Then add `requireAuth` as middleware to the actively-used compute endpoints. For example, change:

```typescript
app.post("/api/calculate-route", async (req, res) => {
```

to:

```typescript
app.post("/api/calculate-route", requireAuth, async (req: AuthenticatedRequest, res) => {
```

Apply to these endpoints:
- `POST /api/calculate-route`
- `GET /api/geocode`
- `GET /api/place-suggestions`
- `GET /api/distance`
- `POST /api/distances`
- `POST /api/pricing-advice`
- `POST /api/chat-route`
- `POST /api/calculate`
- `POST /api/calculate-local`
- `POST /api/feedback`

Leave Stripe endpoints as-is (they use their own webhook signature verification).
Leave the in-memory CRUD endpoints (profiles, yards, team, routes, lanes, quotes, rates) — these are legacy/unused since client uses Firestore directly.

- [ ] **Step 3: Update the client to send Firebase ID tokens**

In `client/src/lib/queryClient.ts`, update the `apiRequest` function to include the Firebase auth token:

```typescript
import { auth } from "@/lib/firebase";

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";

  // Attach Firebase ID token if signed in
  const currentUser = auth?.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // Continue without token — server will reject if auth is required
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* keep message */
    }
    throw new Error(message);
  }

  return res;
}
```

Also update the default `queryFn` in the QueryClient config to include the token:

```typescript
queryFn: async ({ queryKey }) => {
  const path = queryKey[0];
  if (typeof path === "string" && path.startsWith("/api/")) {
    const headers: Record<string, string> = {};
    const currentUser = auth?.currentUser;
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      } catch { /* continue without */ }
    }
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  throw new Error(`Missing queryFn for key: ${JSON.stringify(queryKey)}`);
},
```

- [ ] **Step 4: Verify the app still works**

Run: `npm run check`
Expected: No type errors.

Run: `npm run dev` and test that route calculation still works when signed in.

- [ ] **Step 5: Commit**

```bash
git add server/authMiddleware.ts server/routes.ts client/src/lib/queryClient.ts
git commit -m "feat: add Firebase auth middleware to compute API endpoints"
```

---

### Task 3: Bound In-Memory Caches

**Files:**
- Modify: `server/routes.ts:30-51`

- [ ] **Step 1: Add MAX_CACHE_SIZE and eviction logic**

In `server/routes.ts`, after the TTL constants (around line 23), add:

```typescript
const MAX_CACHE_SIZE = 10_000;
```

Then replace the `cacheSet` function (around line 49) with:

```typescript
function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  // Evict oldest entries if cache exceeds max size
  if (cache.size >= MAX_CACHE_SIZE) {
    // Delete the first (oldest-inserted) entry
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: nowMs() + ttlMs });
}
```

- [ ] **Step 2: Add periodic expired-entry sweep**

After the cache helper functions (around line 55), add:

```typescript
// Sweep expired entries every 30 minutes to prevent memory buildup
setInterval(() => {
  const now = nowMs();
  for (const cache of [geocodeCache, distanceCache, multiRouteCache, placeSuggestCache]) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  }
}, 1000 * 60 * 30);
```

- [ ] **Step 3: Verify type check passes**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "fix: bound in-memory caches to 10k entries with periodic sweep"
```

---

### Task 4: Add Environment Variable Validation

**Files:**
- Create: `server/env.ts`
- Modify: `server/index.ts` (import and call validator at startup)

- [ ] **Step 1: Create the env validation module**

Create `server/env.ts`:

```typescript
import { z } from "zod";

const envSchema = z.object({
  // Required in production
  VITE_FIREBASE_API_KEY: z.string().min(1, "Firebase API key is required"),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),

  // Optional but warned
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
```

- [ ] **Step 2: Call validateEnv() at startup**

In `server/index.ts`, add after the `import "dotenv/config";` line:

```typescript
import { validateEnv } from "./env";
```

Then at the top of the `main()` function, add:

```typescript
validateEnv();
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add server/env.ts server/index.ts
git commit -m "feat: add Zod-based env validation with prod fail-fast and dev warnings"
```

---

### Task 5: Restrict CORS Origins

**Files:**
- Modify: `server/index.ts:11`

- [ ] **Step 1: Replace open CORS with origin whitelist**

In `server/index.ts`, replace:

```typescript
app.use(cors({ origin: true, credentials: true }));
```

with:

```typescript
const allowedOrigins = [
  process.env.PUBLIC_APP_URL,
  "http://localhost:5000",
  "http://localhost:5173",
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "fix: restrict CORS to known origins instead of reflecting all"
```

---

## Phase 2: Testing Foundation

### Task 6: Set Up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add test scripts and devDependencies)

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom happy-dom
```

- [ ] **Step 2: Create vitest.config.ts**

Create `vitest.config.ts` in the project root:

```typescript
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client", "src"),
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: [
      "client/src/**/*.test.{ts,tsx}",
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "client/src/lib/**",
        "server/**",
        "shared/**",
      ],
    },
  },
});
```

- [ ] **Step 3: Add test scripts to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Verify Vitest runs (no tests yet — should exit cleanly)**

Run: `npx vitest run`
Expected: "No test files found" or similar clean exit.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "feat: set up Vitest with path aliases and coverage config"
```

---

### Task 7: Unit Tests for Permissions

**Files:**
- Create: `client/src/lib/permissions.test.ts`

- [ ] **Step 1: Write permission tests**

Create `client/src/lib/permissions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getCompanyRole,
  can,
  canAll,
  canAny,
  isManager,
  isOwner,
  isSuperAdmin,
  canManageUser,
  assignableRoles,
} from "./permissions";
import type { AppUser } from "@/components/firebase-auth";

// Minimal AppUser factory — only the fields permissions.ts reads
function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    uid: "test-uid",
    email: "test@example.com",
    displayName: "Test User",
    role: "user",
    companyRole: "member",
    ...overrides,
  } as AppUser;
}

describe("getCompanyRole", () => {
  it("returns 'member' for null user", () => {
    expect(getCompanyRole(null)).toBe("member");
  });

  it("returns 'member' for undefined user", () => {
    expect(getCompanyRole(undefined)).toBe("member");
  });

  it("returns companyRole when set", () => {
    expect(getCompanyRole(makeUser({ companyRole: "owner" }))).toBe("owner");
    expect(getCompanyRole(makeUser({ companyRole: "admin" }))).toBe("admin");
    expect(getCompanyRole(makeUser({ companyRole: "member" }))).toBe("member");
  });

  it("defaults to 'owner' for legacy admin users without companyRole", () => {
    expect(getCompanyRole(makeUser({ companyRole: undefined, role: "admin" }))).toBe("owner");
  });

  it("defaults to 'member' for legacy non-admin users without companyRole", () => {
    expect(getCompanyRole(makeUser({ companyRole: undefined, role: "user" }))).toBe("member");
  });
});

describe("can", () => {
  it("owner has all standard permissions", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(can(owner, "route:create")).toBe(true);
    expect(can(owner, "billing:manage")).toBe(true);
    expect(can(owner, "team:manage")).toBe(true);
    expect(can(owner, "profile:edit")).toBe(true);
  });

  it("member cannot edit profiles or manage team", () => {
    const member = makeUser({ companyRole: "member" });
    expect(can(member, "route:create")).toBe(true);
    expect(can(member, "profile:edit")).toBe(false);
    expect(can(member, "team:manage")).toBe(false);
    expect(can(member, "billing:manage")).toBe(false);
  });

  it("admin cannot manage billing", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(can(admin, "billing:manage")).toBe(false);
    expect(can(admin, "team:manage")).toBe(true);
  });

  it("null user has no permissions", () => {
    expect(can(null, "route:create")).toBe(false);
  });
});

describe("canAll / canAny", () => {
  it("canAll requires every permission", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canAll(member, ["route:create", "route:view"])).toBe(true);
    expect(canAll(member, ["route:create", "profile:edit"])).toBe(false);
  });

  it("canAny requires at least one permission", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canAny(member, ["profile:edit", "route:create"])).toBe(true);
    expect(canAny(member, ["profile:edit", "billing:manage"])).toBe(false);
  });
});

describe("role checks", () => {
  it("isManager returns true for owner and admin", () => {
    expect(isManager(makeUser({ companyRole: "owner" }))).toBe(true);
    expect(isManager(makeUser({ companyRole: "admin" }))).toBe(true);
    expect(isManager(makeUser({ companyRole: "member" }))).toBe(false);
  });

  it("isOwner returns true only for owner", () => {
    expect(isOwner(makeUser({ companyRole: "owner" }))).toBe(true);
    expect(isOwner(makeUser({ companyRole: "admin" }))).toBe(false);
  });

  it("isSuperAdmin checks app-level role, not companyRole", () => {
    expect(isSuperAdmin(makeUser({ role: "admin" }))).toBe(true);
    expect(isSuperAdmin(makeUser({ role: "user" }))).toBe(false);
    expect(isSuperAdmin(makeUser({ companyRole: "owner", role: "user" }))).toBe(false);
  });
});

describe("canManageUser", () => {
  it("owner can manage admin and member", () => {
    const owner = makeUser({ companyRole: "owner" });
    expect(canManageUser(owner, "admin")).toBe(true);
    expect(canManageUser(owner, "member")).toBe(true);
    expect(canManageUser(owner, "owner")).toBe(false);
  });

  it("admin can only manage member", () => {
    const admin = makeUser({ companyRole: "admin" });
    expect(canManageUser(admin, "member")).toBe(true);
    expect(canManageUser(admin, "admin")).toBe(false);
    expect(canManageUser(admin, "owner")).toBe(false);
  });

  it("member cannot manage anyone", () => {
    const member = makeUser({ companyRole: "member" });
    expect(canManageUser(member, "member")).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("owner can assign admin and member", () => {
    expect(assignableRoles(makeUser({ companyRole: "owner" }))).toEqual(["admin", "member"]);
  });

  it("admin can assign member only", () => {
    expect(assignableRoles(makeUser({ companyRole: "admin" }))).toEqual(["member"]);
  });

  it("member cannot assign any roles", () => {
    expect(assignableRoles(makeUser({ companyRole: "member" }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run client/src/lib/permissions.test.ts`
Expected: All tests PASS. (The `getCompanyRole` legacy user test depends on the Task 1 fix being applied.)

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/permissions.test.ts
git commit -m "test: add comprehensive unit tests for permission system"
```

---

### Task 8: Unit Tests for Subscription Limits

**Files:**
- Create: `client/src/lib/subscription.test.ts`

- [ ] **Step 1: Write subscription tests**

Create `client/src/lib/subscription.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getUserTier,
  isPaid,
  isPro,
  isFleet,
  costProfileLimit,
  yardLimit,
  teamMemberLimit,
  favLaneLimit,
  monthlyQuoteLimit,
  quoteHistoryDays,
  canInviteTeam,
  canExportPdf,
  canExportCsv,
  tierLabel,
  limitLabel,
} from "./subscription";
import type { AppUser } from "@/components/firebase-auth";

function makeUser(tier?: string): AppUser {
  return {
    uid: "u1",
    email: "a@b.com",
    displayName: "Test",
    role: "user",
    companyRole: "owner",
    subscriptionTier: tier,
  } as AppUser;
}

describe("getUserTier", () => {
  it("returns 'free' for null/undefined user", () => {
    expect(getUserTier(null)).toBe("free");
    expect(getUserTier(undefined)).toBe("free");
  });

  it("returns 'free' for users with no tier or unknown tier", () => {
    expect(getUserTier(makeUser())).toBe("free");
    expect(getUserTier(makeUser("unknown"))).toBe("free");
  });

  it("returns correct tier for pro and fleet", () => {
    expect(getUserTier(makeUser("pro"))).toBe("pro");
    expect(getUserTier(makeUser("fleet"))).toBe("fleet");
  });
});

describe("tier checks", () => {
  it("isPaid is true for pro and fleet", () => {
    expect(isPaid(makeUser("pro"))).toBe(true);
    expect(isPaid(makeUser("fleet"))).toBe(true);
    expect(isPaid(makeUser())).toBe(false);
    expect(isPaid(null)).toBe(false);
  });

  it("isPro / isFleet are mutually exclusive", () => {
    expect(isPro(makeUser("pro"))).toBe(true);
    expect(isFleet(makeUser("pro"))).toBe(false);
    expect(isFleet(makeUser("fleet"))).toBe(true);
    expect(isPro(makeUser("fleet"))).toBe(false);
  });
});

describe("limits", () => {
  it("free tier has restricted limits", () => {
    const free = makeUser();
    expect(costProfileLimit(free)).toBe(2);
    expect(yardLimit(free)).toBe(1);
    expect(teamMemberLimit(free)).toBe(1);
    expect(favLaneLimit(free)).toBe(5);
    expect(monthlyQuoteLimit(free)).toBe(1000);
    expect(quoteHistoryDays(free)).toBe(30);
  });

  it("pro tier has expanded limits", () => {
    const pro = makeUser("pro");
    expect(costProfileLimit(pro)).toBe(-1);
    expect(yardLimit(pro)).toBe(-1);
    expect(teamMemberLimit(pro)).toBe(5);
    expect(favLaneLimit(pro)).toBe(20);
    expect(monthlyQuoteLimit(pro)).toBe(-1);
    expect(quoteHistoryDays(pro)).toBe(-1);
  });

  it("fleet tier has unlimited everything", () => {
    const fleet = makeUser("fleet");
    expect(teamMemberLimit(fleet)).toBe(-1);
    expect(favLaneLimit(fleet)).toBe(-1);
  });
});

describe("feature gates", () => {
  it("free users cannot access paid features", () => {
    const free = makeUser();
    expect(canInviteTeam(free)).toBe(false);
    expect(canExportPdf(free)).toBe(false);
    expect(canExportCsv(free)).toBe(false);
  });

  it("paid users can access paid features", () => {
    const pro = makeUser("pro");
    expect(canInviteTeam(pro)).toBe(true);
    expect(canExportPdf(pro)).toBe(true);
    expect(canExportCsv(pro)).toBe(true);
  });
});

describe("display helpers", () => {
  it("tierLabel returns correct labels", () => {
    expect(tierLabel(makeUser())).toBe("Free");
    expect(tierLabel(makeUser("pro"))).toBe("Pro");
    expect(tierLabel(makeUser("fleet"))).toBe("Premium");
  });

  it("limitLabel shows 'Unlimited' for -1", () => {
    expect(limitLabel(-1)).toBe("Unlimited");
    expect(limitLabel(5)).toBe("5");
    expect(limitLabel(0)).toBe("0");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run client/src/lib/subscription.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/subscription.test.ts
git commit -m "test: add unit tests for subscription tier limits and feature gates"
```

---

### Task 9: Unit Tests for Route Cost Calculations

**Files:**
- Create: `client/src/lib/routeCalc.test.ts`

- [ ] **Step 1: Write route calculation tests**

Create `client/src/lib/routeCalc.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateRouteCost, getPricingAdvice } from "./routeCalc";
import type { CostProfile, RouteStop } from "@shared/schema";

function makeProfile(overrides: Partial<CostProfile> = {}): CostProfile {
  return {
    id: "p1",
    name: "Test Profile",
    truckType: "dry_van",
    monthlyTruckPayment: 2000,
    monthlyInsurance: 800,
    monthlyMaintenance: 500,
    monthlyPermitsPlates: 200,
    monthlyOther: 100,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: 25,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: 75,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStop(location: string, overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: `stop-${location}`,
    type: "delivery",
    location,
    lat: 0,
    lng: 0,
    ...overrides,
  };
}

describe("calculateRouteCost", () => {
  const profile = makeProfile();
  const fuelPrice = 1.50; // $/L

  it("returns empty legs for fewer than 2 stops", () => {
    const result = calculateRouteCost(profile, [makeStop("A")], false, fuelPrice);
    expect(result.legs).toHaveLength(0);
    expect(result.fullTripCost).toBe(0);
  });

  it("calculates a simple 2-stop route (per-hour)", () => {
    const stops: RouteStop[] = [
      makeStop("Origin", { type: "pickup" }),
      makeStop("Dest", { type: "delivery", distanceFromPrevKm: 200, driveMinutesFromPrev: 120, dockTimeMinutes: 30 }),
    ];
    const result = calculateRouteCost(profile, stops, false, fuelPrice);

    expect(result.legs).toHaveLength(1);
    expect(result.totalDistanceKm).toBe(200);
    expect(result.totalDriveMinutes).toBe(120);
    expect(result.totalDockMinutes).toBe(30);
    // Fixed cost = (3600/220) * 2.5h = ~40.91
    // Driver cost = 25 * 2.5h = 62.50
    // Fuel cost = 200 * (35/100 * 1.50) = 105
    expect(result.fullTripCost).toBeGreaterThan(0);
    expect(result.legs[0].fixedCost).toBeGreaterThan(0);
    expect(result.legs[0].driverCost).toBeGreaterThan(0);
    expect(result.legs[0].fuelCost).toBeCloseTo(105, 0);
  });

  it("skips deadhead leg when includeDeadhead is false", () => {
    const stops: RouteStop[] = [
      makeStop("Pickup", { type: "pickup" }),
      makeStop("Delivery", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 30 }),
      makeStop("Yard", { type: "yard", distanceFromPrevKm: 50, driveMinutesFromPrev: 30 }),
    ];
    const withoutDH = calculateRouteCost(profile, stops, false, fuelPrice);
    const withDH = calculateRouteCost(profile, stops, true, fuelPrice);

    expect(withoutDH.legs).toHaveLength(1);
    expect(withDH.legs).toHaveLength(2);
    expect(withDH.deadheadCost).toBeGreaterThan(0);
    expect(withoutDH.deadheadCost).toBe(0);
  });

  it("applies deadhead pay percent", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
      makeStop("Y", { type: "yard", distanceFromPrevKm: 100, driveMinutesFromPrev: 60 }),
    ];
    const full = calculateRouteCost(makeProfile({ deadheadPayPercent: 100 }), stops, true, fuelPrice);
    const half = calculateRouteCost(makeProfile({ deadheadPayPercent: 50 }), stops, true, fuelPrice);

    const fullDHDriver = full.legs[1].driverCost;
    const halfDHDriver = half.legs[1].driverCost;
    expect(halfDHDriver).toBeCloseTo(fullDHDriver * 0.5, 1);
  });

  it("uses per-mile driver pay when set", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 160.934, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
    ];
    const result = calculateRouteCost(
      makeProfile({ driverPayPerMile: 0.60 }),
      stops, false, fuelPrice, undefined, undefined, "perMile", "imperial",
    );
    // 160.934 km ≈ 100 miles, at $0.60/mi = $60
    expect(result.legs[0].driverCost).toBeCloseTo(60, 0);
  });

  it("falls back to perHour when perMile requested but rate is 0", () => {
    const stops: RouteStop[] = [
      makeStop("P", { type: "pickup" }),
      makeStop("D", { type: "delivery", distanceFromPrevKm: 100, driveMinutesFromPrev: 60, dockTimeMinutes: 0 }),
    ];
    const result = calculateRouteCost(
      makeProfile({ driverPayPerMile: 0 }),
      stops, false, fuelPrice, undefined, undefined, "perMile",
    );
    expect(result.payMode).toBe("perHour");
  });
});

describe("getPricingAdvice", () => {
  it("returns 3 standard tiers at 20%, 30%, 40%", () => {
    const result = getPricingAdvice(1000);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0].price).toBe(1200);
    expect(result.tiers[1].price).toBe(1300);
    expect(result.tiers[2].price).toBe(1400);
  });

  it("calculates custom margin percentage", () => {
    const result = getPricingAdvice(1000, 15);
    expect(result.customPercent).not.toBeNull();
    expect(result.customPercent!.price).toBe(1150);
    expect(result.customPercent!.marginAmount).toBe(150);
  });

  it("calculates custom quote amount with reverse margin", () => {
    const result = getPricingAdvice(1000, undefined, 1250);
    expect(result.customQuote).not.toBeNull();
    expect(result.customQuote!.marginPercent).toBe(25);
    expect(result.customQuote!.marginAmount).toBe(250);
  });

  it("returns null customPercent when margin is 0 or undefined", () => {
    expect(getPricingAdvice(1000).customPercent).toBeNull();
    expect(getPricingAdvice(1000, 0).customPercent).toBeNull();
  });

  it("returns null customQuote when totalCost is 0", () => {
    expect(getPricingAdvice(0, undefined, 500).customQuote).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run client/src/lib/routeCalc.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/routeCalc.test.ts
git commit -m "test: add unit tests for route cost calculations and pricing advice"
```

---

### Task 10: Unit Tests for Currency and Measurement

**Files:**
- Create: `client/src/lib/currency.test.ts`
- Create: `client/src/lib/measurement.test.ts`

- [ ] **Step 1: Write currency tests**

Create `client/src/lib/currency.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  currencyForCountryCode,
  resolveWorkspaceCurrency,
  formatCurrencyAmount,
  convertCurrency,
  currencySymbol,
  currencyFromOperatingCountryLabels,
} from "./currency";

describe("currencyForCountryCode", () => {
  it("returns CAD for CA", () => expect(currencyForCountryCode("CA")).toBe("CAD"));
  it("returns USD for US", () => expect(currencyForCountryCode("US")).toBe("USD"));
  it("is case-insensitive", () => expect(currencyForCountryCode("us")).toBe("USD"));
  it("defaults to CAD for unknown codes", () => expect(currencyForCountryCode("XX")).toBe("CAD"));
  it("defaults to CAD for null/undefined", () => {
    expect(currencyForCountryCode(null)).toBe("CAD");
    expect(currencyForCountryCode(undefined)).toBe("CAD");
  });
});

describe("currencyFromOperatingCountryLabels", () => {
  it("returns USD for USA-like labels", () => {
    expect(currencyFromOperatingCountryLabels(["USA"])).toBe("USD");
    expect(currencyFromOperatingCountryLabels(["United States"])).toBe("USD");
  });
  it("returns CAD for Canada", () => {
    expect(currencyFromOperatingCountryLabels(["Canada"])).toBe("CAD");
  });
  it("defaults to CAD for empty/undefined", () => {
    expect(currencyFromOperatingCountryLabels([])).toBe("CAD");
    expect(currencyFromOperatingCountryLabels(undefined)).toBe("CAD");
  });
});

describe("resolveWorkspaceCurrency", () => {
  it("uses preferredCurrency first", () => {
    expect(resolveWorkspaceCurrency({ preferredCurrency: "USD" })).toBe("USD");
  });
  it("falls back to operatingCountryCode", () => {
    expect(resolveWorkspaceCurrency({ operatingCountryCode: "US" })).toBe("USD");
  });
  it("falls back to operatingCountries labels", () => {
    expect(resolveWorkspaceCurrency({ operatingCountries: ["United States"] })).toBe("USD");
  });
  it("defaults to CAD for null", () => {
    expect(resolveWorkspaceCurrency(null)).toBe("CAD");
  });
});

describe("convertCurrency", () => {
  it("returns same amount for same currency", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
  });
  it("converts USD to CAD (roughly 1.44x)", () => {
    const cad = convertCurrency(100, "USD", "CAD");
    expect(cad).toBeGreaterThan(130);
    expect(cad).toBeLessThan(150);
  });
  it("converts CAD to USD (roughly 0.69x)", () => {
    const usd = convertCurrency(100, "CAD", "USD");
    expect(usd).toBeGreaterThan(60);
    expect(usd).toBeLessThan(75);
  });
});

describe("currencySymbol", () => {
  it("returns $ for CAD and USD", () => {
    expect(currencySymbol("CAD")).toBe("$");
    expect(currencySymbol("USD")).toBe("$");
  });
});

describe("formatCurrencyAmount", () => {
  it("formats with 2 decimal places", () => {
    const formatted = formatCurrencyAmount(1234.5, "USD");
    expect(formatted).toContain("1,234.50");
  });
});
```

- [ ] **Step 2: Write measurement tests**

Create `client/src/lib/measurement.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  resolveMeasurementUnit,
  milesToKm,
  kmToMiles,
  lPer100kmToMpg,
  mpgToLPer100km,
  displayDistance,
  displayFuelConsumption,
  inputToLPer100km,
  distanceLabel,
  fuelConsumptionLabel,
  KM_PER_MILE,
} from "./measurement";

describe("resolveMeasurementUnit", () => {
  it("returns 'imperial' by default", () => {
    expect(resolveMeasurementUnit(null)).toBe("imperial");
    expect(resolveMeasurementUnit(undefined)).toBe("imperial");
    expect(resolveMeasurementUnit({})).toBe("imperial");
  });
  it("returns stored value when valid", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "metric" })).toBe("metric");
    expect(resolveMeasurementUnit({ measurementUnit: "imperial" })).toBe("imperial");
  });
  it("rejects invalid values", () => {
    expect(resolveMeasurementUnit({ measurementUnit: "banana" })).toBe("imperial");
  });
});

describe("distance conversions", () => {
  it("milesToKm converts correctly", () => {
    expect(milesToKm(1)).toBeCloseTo(KM_PER_MILE, 4);
    expect(milesToKm(100)).toBeCloseTo(160.9344, 2);
  });
  it("kmToMiles converts correctly", () => {
    expect(kmToMiles(KM_PER_MILE)).toBeCloseTo(1, 4);
    expect(kmToMiles(100)).toBeCloseTo(62.1371, 2);
  });
  it("round-trips are identity", () => {
    expect(kmToMiles(milesToKm(42))).toBeCloseTo(42, 6);
  });
});

describe("fuel consumption conversions", () => {
  it("converts L/100km to MPG", () => {
    // 10 L/100km ≈ 23.5 MPG
    expect(lPer100kmToMpg(10)).toBeCloseTo(23.52, 1);
  });
  it("converts MPG to L/100km", () => {
    expect(mpgToLPer100km(23.52)).toBeCloseTo(10, 0);
  });
  it("handles zero values gracefully", () => {
    expect(lPer100kmToMpg(0)).toBe(0);
    expect(mpgToLPer100km(0)).toBe(0);
  });
  it("round-trips are identity", () => {
    expect(mpgToLPer100km(lPer100kmToMpg(35))).toBeCloseTo(35, 6);
  });
});

describe("display helpers", () => {
  it("displayDistance converts km for imperial", () => {
    expect(displayDistance(100, "imperial")).toBeCloseTo(62.14, 1);
    expect(displayDistance(100, "metric")).toBe(100);
  });
  it("displayFuelConsumption converts for imperial", () => {
    expect(displayFuelConsumption(10, "imperial")).toBeCloseTo(23.52, 1);
    expect(displayFuelConsumption(10, "metric")).toBe(10);
  });
  it("inputToLPer100km converts MPG for imperial", () => {
    expect(inputToLPer100km(23.52, "imperial")).toBeCloseTo(10, 0);
    expect(inputToLPer100km(10, "metric")).toBe(10);
  });
  it("distanceLabel returns correct unit", () => {
    expect(distanceLabel("imperial")).toBe("mi");
    expect(distanceLabel("metric")).toBe("km");
  });
  it("fuelConsumptionLabel returns correct unit", () => {
    expect(fuelConsumptionLabel("imperial")).toBe("MPG");
    expect(fuelConsumptionLabel("metric")).toBe("L/100km");
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS across all test files.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/currency.test.ts client/src/lib/measurement.test.ts
git commit -m "test: add unit tests for currency and measurement utilities"
```

---

### Task 11: Unit Tests for Zod Schemas

**Files:**
- Create: `shared/schema.test.ts`

- [ ] **Step 1: Write schema validation tests**

Create `shared/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  routeStopSchema,
  calculateRouteSchema,
  insertCostProfileSchema,
  insertYardSchema,
  insertTeamMemberSchema,
  insertLaneSchema,
  chatRouteSchema,
} from "./schema";

describe("routeStopSchema", () => {
  it("accepts valid stop", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "pickup",
      location: "Toronto, ON",
      lat: 43.6532,
      lng: -79.3832,
    });
    expect(result.success).toBe(true);
  });

  it("allows optional lat/lng", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "pickup",
      location: "Somewhere",
    });
    expect(result.success).toBe(true);
  });

  it("allows null lat/lng", () => {
    const result = routeStopSchema.safeParse({
      id: "stop-1",
      type: "delivery",
      location: "X",
      lat: null,
      lng: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = routeStopSchema.safeParse({
      type: "pickup",
      location: "Somewhere",
    });
    expect(result.success).toBe(false);
  });
});

describe("insertCostProfileSchema", () => {
  const validProfile = {
    name: "Test",
    truckType: "dry_van",
    monthlyTruckPayment: 2000,
    monthlyInsurance: 800,
    monthlyMaintenance: 500,
    monthlyPermitsPlates: 200,
    monthlyOther: 100,
    workingDaysPerMonth: 22,
    workingHoursPerDay: 10,
    driverPayPerHour: 25,
    fuelConsumptionPer100km: 35,
    defaultDockTimeMinutes: 30,
    detentionRatePerHour: 75,
  };

  it("accepts valid profile", () => {
    expect(insertCostProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("accepts optional advanced fields", () => {
    const result = insertCostProfileSchema.safeParse({
      ...validProfile,
      monthlyTrailerLease: 500,
      monthlyEldTelematics: 50,
      driverPayPerMile: 0.55,
      currency: "CAD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field", () => {
    const { name, ...noName } = validProfile;
    expect(insertCostProfileSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects string where number expected", () => {
    const result = insertCostProfileSchema.safeParse({
      ...validProfile,
      monthlyTruckPayment: "two thousand",
    });
    expect(result.success).toBe(false);
  });
});

describe("chatRouteSchema", () => {
  it("accepts valid message", () => {
    expect(chatRouteSchema.safeParse({ message: "Toronto to Montreal" }).success).toBe(true);
  });

  it("rejects empty message", () => {
    expect(chatRouteSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("accepts optional dockTimeMinutes", () => {
    expect(chatRouteSchema.safeParse({ message: "A to B", dockTimeMinutes: 30 }).success).toBe(true);
  });
});

describe("insertYardSchema", () => {
  it("accepts valid yard", () => {
    expect(insertYardSchema.safeParse({
      name: "Main Yard",
      address: "123 Main St",
    }).success).toBe(true);
  });
});

describe("insertTeamMemberSchema", () => {
  it("accepts valid team member", () => {
    expect(insertTeamMemberSchema.safeParse({
      name: "John",
      role: "driver",
      pin: "1234",
    }).success).toBe(true);
  });
});

describe("insertLaneSchema", () => {
  it("accepts valid lane", () => {
    expect(insertLaneSchema.safeParse({
      origin: "Toronto",
      destination: "Montreal",
      truckType: "dry_van",
      fixedPrice: 1500,
      estimatedMiles: 340,
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/schema.test.ts
git commit -m "test: add unit tests for Zod validation schemas"
```

---

## Phase 3: Architecture & Type Safety

### Task 12: Add React Error Boundary

**Files:**
- Create: `client/src/components/ErrorBoundary.tsx`
- Modify: `client/src/App.tsx` (wrap router content)

- [ ] **Step 1: Create ErrorBoundary component**

Create `client/src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h2 className="text-lg font-semibold">
            {this.props.fallbackTitle ?? "Something went wrong"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap the main page content in App.tsx**

In `client/src/App.tsx`, add the import:

```typescript
import { ErrorBoundary } from "@/components/ErrorBoundary";
```

Then wrap the `<Suspense>` that contains the page routes with:

```tsx
<ErrorBoundary>
  <Suspense fallback={<PageLoader />}>
    {/* ...existing route rendering... */}
  </Suspense>
</ErrorBoundary>
```

- [ ] **Step 3: Verify type check**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ErrorBoundary.tsx client/src/App.tsx
git commit -m "feat: add React Error Boundary to catch rendering crashes"
```

---

### Task 13: Fix Unsafe Type Casts

**Files:**
- Modify: `client/src/App.tsx:200`
- Modify: `client/src/lib/queryClient.ts`

- [ ] **Step 1: Fix the `as any` cast in App.tsx**

In `client/src/App.tsx`, around line 200, replace:

```typescript
const cachedStops = (lane as any).cachedStops ?? null;
```

with a properly typed approach. First, find the `Lane` type import and extend it, or use a type guard:

```typescript
const cachedStops = "cachedStops" in lane && Array.isArray((lane as Record<string, unknown>).cachedStops)
  ? (lane as Record<string, unknown>).cachedStops as RouteStop[]
  : null;
```

Or, if `Lane` type should include `cachedStops`, update `shared/schema.ts` to add it to the `Lane` type:

```typescript
export type Lane = z.infer<typeof insertLaneSchema> & {
  id: string;
  cachedStops?: RouteStop[];
};
```

Then the App.tsx line becomes:

```typescript
const cachedStops = lane.cachedStops ?? null;
```

- [ ] **Step 2: Add type to queryClient default queryFn return**

In `client/src/lib/queryClient.ts`, the default `queryFn` returns `res.json()` which is `Promise<any>`. This is acceptable for a generic default queryFn since the actual type is provided at the `useQuery` call site. No change needed — the `any` is inherent to `Response.json()` and is resolved by TanStack Query's generic parameter at usage.

- [ ] **Step 3: Verify type check**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx shared/schema.ts
git commit -m "fix: eliminate unsafe 'as any' cast for lane.cachedStops"
```

---

### Task 14: Decompose route-builder.tsx — Extract Hooks

**Files:**
- Create: `client/src/pages/route-builder/hooks/useRouteStops.ts`
- Create: `client/src/pages/route-builder/hooks/useRouteCalculation.ts`

This task extracts the stop management and route calculation state into custom hooks. The main component will import these hooks. This is the first step of decomposition — extract logic before extracting UI components.

- [ ] **Step 1: Read the full route-builder.tsx to identify state boundaries**

Read `client/src/pages/route-builder.tsx` completely. Identify:
1. All `useState` calls related to stops (stops array, adding/removing/reordering stops)
2. All `useState`/`useMutation` calls related to route calculation (distances, costs, loading states)
3. All `useState` calls related to quote pricing (margin, customer price, accessorials)

Document the state variables and their dependencies.

- [ ] **Step 2: Create useRouteStops hook**

Create `client/src/pages/route-builder/hooks/useRouteStops.ts` extracting:
- `stops` state array
- `addStop`, `removeStop`, `updateStop`, `reorderStops` functions
- `loadStopsFromLane` function (from the custom event handler)
- Stop ID generation

The hook should accept initial stops and return the state + mutators.

- [ ] **Step 3: Create useRouteCalculation hook**

Create `client/src/pages/route-builder/hooks/useRouteCalculation.ts` extracting:
- Distance fetching logic (calls to `getOSRMRoute`, `getMultiWaypointDistances`)
- Cost calculation logic (calls to `calculateRouteCost`)
- Loading/error states for calculations
- The `recalculate` function

The hook should accept `stops`, `profile`, `fuelPrice`, and `payMode` as inputs.

- [ ] **Step 4: Update route-builder.tsx to use the new hooks**

Replace the inline state management with calls to `useRouteStops()` and `useRouteCalculation()`. The component should get shorter by the extracted logic.

- [ ] **Step 5: Verify the app works**

Run: `npm run check`
Expected: No type errors.

Run: `npm run dev` and test route building with multiple stops.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/route-builder/
git commit -m "refactor: extract useRouteStops and useRouteCalculation hooks from route-builder"
```

---

### Task 15: Decompose route-builder.tsx — Extract UI Components

**Files:**
- Create: `client/src/pages/route-builder/components/StopsList.tsx`
- Create: `client/src/pages/route-builder/components/CostBreakdownPanel.tsx`
- Create: `client/src/pages/route-builder/components/QuotePricingPanel.tsx`
- Modify: `client/src/pages/route-builder.tsx` → move to `client/src/pages/route-builder/index.tsx`

This task extracts UI sections into focused sub-components.

- [ ] **Step 1: Move route-builder.tsx to route-builder/index.tsx**

```bash
mkdir -p client/src/pages/route-builder/components
mv client/src/pages/route-builder.tsx client/src/pages/route-builder/index.tsx
```

Update the lazy import in `App.tsx`:

```typescript
const RouteBuilder = lazy(() => import("@/pages/route-builder"));
```

This should work unchanged since `index.tsx` is the default module for directory imports.

- [ ] **Step 2: Extract StopsList component**

Create `client/src/pages/route-builder/components/StopsList.tsx` containing:
- The stop list rendering (each stop row with location input, type selector, dock time, delete button)
- The "Add Stop" button
- Drag-and-drop reorder handle
- The component receives stops array + mutators from the parent via props

- [ ] **Step 3: Extract CostBreakdownPanel component**

Create `client/src/pages/route-builder/components/CostBreakdownPanel.tsx` containing:
- The legs breakdown table (from/to, distance, drive time, fixed/driver/fuel costs)
- Trip totals row
- Deadhead totals row
- The component receives the `calculateRouteCost` result as props

- [ ] **Step 4: Extract QuotePricingPanel component**

Create `client/src/pages/route-builder/components/QuotePricingPanel.tsx` containing:
- Margin type selector (%, flat)
- Custom margin input
- Pricing tiers display (20/30/40%)
- Customer price calculation
- Save quote / export actions
- The component receives cost totals and save/export callbacks as props

- [ ] **Step 5: Wire sub-components into the index**

Update `client/src/pages/route-builder/index.tsx` to import and render the extracted components, passing appropriate props.

- [ ] **Step 6: Verify**

Run: `npm run check`
Expected: No type errors.

Run: `npm run dev` and test route building end-to-end.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/route-builder/ client/src/App.tsx
git commit -m "refactor: decompose route-builder into StopsList, CostBreakdown, QuotePricing components"
```

---

## Phase 4: Performance

### Task 16: Add React.memo to Decomposed Components

**Files:**
- Modify: `client/src/pages/route-builder/components/StopsList.tsx`
- Modify: `client/src/pages/route-builder/components/CostBreakdownPanel.tsx`
- Modify: `client/src/pages/route-builder/components/QuotePricingPanel.tsx`

- [ ] **Step 1: Wrap leaf components in React.memo**

For each extracted component, wrap the default export:

```typescript
export const CostBreakdownPanel = memo(function CostBreakdownPanel(props: CostBreakdownProps) {
  // ... component body
});
```

Import `memo` from `"react"`.

Apply to:
- `CostBreakdownPanel` — only re-renders when cost data changes
- `QuotePricingPanel` — only re-renders when pricing inputs change
- Individual stop items in `StopsList` (if extracted as a sub-component)

Do NOT memo `StopsList` itself if it receives frequently-changing callbacks.

- [ ] **Step 2: Stabilize callback props with useCallback in index.tsx**

In `client/src/pages/route-builder/index.tsx`, wrap callback props passed to memoized children in `useCallback`:

```typescript
const handleRemoveStop = useCallback((id: string) => {
  // ... existing logic
}, [/* dependencies */]);
```

- [ ] **Step 3: Verify type check**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/route-builder/
git commit -m "perf: add React.memo to decomposed route-builder components"
```

---

### Task 17: Dynamic Import for jsPDF

**Files:**
- Modify: `client/src/lib/generateQuotePdf.ts`

- [ ] **Step 1: Convert jsPDF import to dynamic**

In `client/src/lib/generateQuotePdf.ts`, if the import is static:

```typescript
import { jsPDF } from "jspdf";
```

Change to dynamic import inside the function that uses it:

```typescript
export async function generateQuotePdf(/* params */) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  // ... rest of function
}
```

This removes ~280KB from the main bundle since jsPDF is only needed when exporting PDFs (a paid feature).

- [ ] **Step 2: Verify the function is already async or update callers**

If `generateQuotePdf` was synchronous, update all call sites to `await` it.

- [ ] **Step 3: Verify type check**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/generateQuotePdf.ts
git commit -m "perf: lazy-load jsPDF to reduce main bundle by ~280KB"
```

---

### Task 18: Tune TanStack Query Configuration

**Files:**
- Modify: `client/src/lib/queryClient.ts`

- [ ] **Step 1: Add retry and adjust staleTime**

In `client/src/lib/queryClient.ts`, update the default options:

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes — data refreshes on next query after this
      retry: 1, // Retry failed requests once (handles transient network errors)
      // ... existing queryFn
    },
    mutations: { retry: false },
  },
});
```

- [ ] **Step 2: Verify type check**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/queryClient.ts
git commit -m "perf: tune TanStack Query with 5m staleTime and 1 retry"
```

---

### Task 19: Run Full Test Suite and Final Verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 2: Run type check**

```bash
npm run check
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, build succeeds"
```
