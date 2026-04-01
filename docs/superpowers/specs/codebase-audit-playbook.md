# Bungee Connect — Codebase Audit & Hardening Playbook

> **Purpose:** Reusable instructions for an agentic session to audit and harden the Bungee Connect codebase. Run this against whatever the current version is — don't assume specific file paths or line numbers. Read the code first, then apply each fix.

---

## Pre-flight

1. **Read `CLAUDE.md`** at the repo root for project conventions, dev commands, and architecture.
2. **Run `npm install`** to ensure dependencies are current.
3. **Run the existing test suite** (`npx vitest run`) to establish a baseline. Note how many tests pass/fail. If there's no test config yet, that's Task 6.
4. **Run `npx tsc --noEmit`** to see current type errors. Note them so you don't confuse pre-existing issues with ones you introduce.
5. **Work on a feature branch** (not main) so the user can review before merging. Use a git worktree if available.

---

## Phase 1: Security (do these first — they're the highest impact)

### 1A. Default role for legacy users
- **Find:** The permissions module (likely `client/src/lib/permissions.ts`)
- **Look for:** A `getCompanyRole()` or similar function that returns a default role when `companyRole` is missing from the user object
- **Fix if:** The default is `"owner"` or any admin-level role. Change it to `"member"` (the least-privileged role)
- **Why:** Old accounts created before the role system was added should not silently get full admin access

### 1B. API endpoint authentication
- **Find:** The server routes file (likely `server/routes.ts`)
- **Look for:** Express route handlers (`app.get`, `app.post`) that handle sensitive data without any auth check
- **Fix:** Create an auth middleware (`server/authMiddleware.ts`) that:
  - Reads `Authorization: Bearer <token>` from the request header
  - Verifies the token with Firebase Admin SDK (`admin.auth().verifyIdToken(token)`)
  - Attaches the decoded user to `req.firebaseUser`
  - Returns 401 if missing/invalid
- **Apply** `requireAuth` to all endpoints that read/write user data. Public endpoints (health checks, place autocomplete for signup) can stay open.
- **Client side:** Update the API client (likely `client/src/lib/queryClient.ts`) to attach the Firebase auth token to every outgoing request.
- **Gotcha from last time:** If there's an `apiUrl()` helper for URL resolution, keep it AND add auth headers. Don't replace one with the other.

### 1C. Bound in-memory caches
- **Find:** Server-side caches (usually `Map` objects in `server/routes.ts`)
- **Look for:** Caches that grow without limit — `new Map()` with `.set()` calls but no `.delete()` or size checks
- **Fix:** Add a max size constant (e.g. `MAX_CACHE_SIZE = 10_000`) and a sweep function that evicts the oldest entries when the cache exceeds the limit.
- **Gotcha from last time:** Make sure you only declare `MAX_CACHE_SIZE` once, not once per cache.

### 1D. Environment variable validation
- **Find:** Server entry point or a config module
- **Look for:** Bare `process.env.SOME_VAR` reads with no validation
- **Fix:** Create a validation module (`server/envValidation.ts`) using Zod that:
  - In production: fails hard with clear error messages if critical vars are missing
  - In development: warns but allows startup with missing vars
- **Import and call** the validation at the top of the server startup

### 1E. CORS restriction
- **Find:** CORS configuration in the Express setup
- **Look for:** `cors({ origin: "*" })` or `cors({ origin: true })` in production
- **Fix:** Read allowed origins from an env var (`ALLOWED_ORIGINS`), fall back to permissive only when `NODE_ENV !== "production"`

---

## Phase 2: Testing (do this before making architecture changes)

### 2A. Set up Vitest (skip if already configured)
- Create `vitest.config.ts` with:
  - Path aliases matching `vite.config.ts` (`@/` -> `client/src/`, `@shared/` -> `shared/`)
  - `environment: "jsdom"` for React component tests
  - Coverage via v8
- Add `"test": "vitest run"` to `package.json` scripts

### 2B. Write unit tests for core business logic
Target these modules (read each one first to understand current signatures):

| Module | What to test |
|--------|-------------|
| Route calculation (`lib/routeCalc.ts`) | Hourly vs per-mile pay modes, deadhead discounts, fuel calculations, multi-leg routes, edge cases (zero distance, missing profile fields) |
| Permissions (`lib/permissions.ts`) | `can()` checks for each permission, role hierarchy (member < admin < owner), default role behavior |
| Subscriptions (`lib/subscription.ts`) | Tier detection functions, all limit functions (match current values!), feature gates (PDF, chat, accessorials) |
| Currency (`lib/currency.ts`) | Symbol lookup, workspace currency resolution, conversion between currencies, formatting |
| Measurement (`lib/measurement.ts`) | Country-based unit defaults, km/mi conversion, L/gal conversion |
| Schemas (`shared/schema.ts`) | Zod validation for all shared schemas — valid data passes, invalid data fails with correct errors |

- **Critical lesson from last time:** Read the actual return values from the code before writing test expectations. Subscription limits and formatting behavior changed between versions. Always derive expected values from the source code, not from memory.

---

## Phase 3: Stability & Type Safety

### 3A. React Error Boundary
- **Create** `client/src/components/ErrorBoundary.tsx` — a class component that catches rendering errors and shows a fallback with a reload button
- **Wrap** the main page routes in `App.tsx` with `<ErrorBoundary>` inside the `<Suspense>` boundary
- **Gotcha from last time:** `App.tsx` changes frequently. Keep the ErrorBoundary wrapper minimal.

### 3B. Eliminate unsafe type casts
- **Search for:** `as any`, `as unknown as`, and unnecessary `as SomeType` assertions
- **Fix by:** Adding proper type narrowing, runtime checks, or fixing the upstream type
- **Fix all** `catch (err: any)` to `catch (err: unknown)` with `err instanceof Error ? err.message : String(err)`

### 3C. Lazy-load heavy libraries
- **Find:** Static imports of large libraries only used in specific user flows
- **Common candidate:** `jsPDF` (390KB) — only needed when exporting PDF quotes
- **Fix:** Change `import { jsPDF } from "jspdf"` to `const { jsPDF } = await import("jspdf")` inside the function. Keep a `type` import for TypeScript.

---

## Phase 4: Architecture (optional — only if the codebase is stable)

### 4A. Route builder decomposition
- **Context:** The route builder page is typically 2,000-3,000 lines
- **Lesson from last time:** This file changes constantly with UI updates. Decomposition got reverted during merge because main's UI had diverged. **Only do this if the user confirms the UI is stable.**
- **Safe first step:** Extract type definitions to `route-builder/types.ts`
- **If proceeding further:**
  - Move to directory structure: `route-builder/index.tsx`
  - Extract stop state management into `hooks/useRouteStops.ts`
  - Extract type definitions into `hooks/useRouteCalculation.ts`
  - Extract presentational components: `StopsList`, `CostBreakdownPanel`, `QuotePricingPanel`
  - Wrap presentational components in `React.memo`
- **Do NOT extract:** The main `calculateRoute` function — it has deep coupling with scope/currency/profile state
- **Do NOT remove:** `setDragIdx`/`setDragOverIdx` raw setters from the hook if the inline JSX uses them directly

---

## Verification checklist (run before committing)

```bash
# All tests pass
npx vitest run

# TypeScript compiles (ignore pre-existing errors you noted in pre-flight)
npx tsc --noEmit

# Production build succeeds
npm run build

# No conflict markers left in any file
grep -rn "<<<<<<" client/ server/ shared/
```

---

## Lessons learned (from the 2026-03-31 run)

1. **Work on a branch, merge at the end.** Main had 36 new commits during the audit, causing painful merge conflicts. Keep the branch short-lived if possible.
2. **Don't decompose the route builder unless UI is frozen.** It's the most-edited file in the repo. Decomposition work gets thrown away if the UI changes.
3. **queryClient.ts is a merge conflict magnet.** Multiple features touch it (URL routing, auth headers, retry config). Make minimal changes and don't restructure.
4. **Test expectations must match current code.** Don't hardcode expected values from an old version. Read the actual function, then write the assertion.
5. **The `.env` file doesn't exist in git worktrees.** Copy it manually or the dev server starts without Firebase config and auth silently fails.
6. **`extractCityFromAddress` and `getDistance` are used both inside hooks and in the main component.** If you extract them to a hook, export them so the inline code can still import them.
7. **The `buildStopsFromForm` function evolves fast** (name-based directions, geocode fallbacks, repair functions). Don't extract it to a hook — it'll be stale by the next merge.
