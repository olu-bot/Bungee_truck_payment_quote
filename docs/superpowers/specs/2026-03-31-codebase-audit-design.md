# Bungee Connect Codebase Audit — Security-First Spiral

**Date**: 2026-03-31
**Stack**: React 18, TypeScript 5.6, Vite 5, Firebase (Auth + Firestore), TanStack Query 5, Radix UI, Tailwind CSS 3, Express 4, Stripe, wouter
**Status**: Pre-launch / staging
**Approach**: Security-First Spiral (Phase 1 → 4)

---

## Executive Summary

Full-stack freight pricing SaaS (~6,500 LOC across key files). Solid fundamentals — TypeScript strict mode, Zod schemas, lazy-loaded routes, Firebase security rules — but significant gaps in server-side auth, testing, error handling, and component architecture. This spec documents all findings and defines a 4-phase remediation plan.

---

## Phase 1 — Security & Bug Fixes

### 1.1 CRITICAL: API Routes Have No Auth Middleware

**Finding**: 30+ Express endpoints in `server/routes.ts` have zero authentication. Only 1 endpoint (`/api/feedback/:id/email-reply`) uses `verifyBearerIsAdmin()`. All CRUD endpoints for profiles, yards, team, routes, quotes, lanes, and rates are completely open.

**Impact**: Anyone with the server URL can read/write all in-memory data. The in-memory `storage.ts` data store has no user scoping — all users share the same data.

**Note**: The client primarily uses Firestore directly (protected by security rules), so these Express endpoints may be legacy/unused for most operations. However, endpoints like `/api/calculate-route`, `/api/geocode`, `/api/distance`, `/api/chat-route`, and `/api/pricing-advice` are actively used.

**Fix**:
- Add Firebase ID token verification middleware for all `/api/*` routes
- Create `requireAuth()` Express middleware that verifies Firebase Bearer tokens
- Audit which endpoints are actually called by the client vs. dead code
- Remove or protect unused endpoints

### 1.2 HIGH: permissions.ts Default Role Bug

**Finding** (`permissions.ts:82`):
```typescript
return user.companyRole ?? (user.role === "admin" ? "owner" : "owner");
```
Both branches return `"owner"`. A user without `companyRole` set always gets owner-level permissions regardless of their actual `role` field.

**Fix**: Change to `(user.role === "admin" ? "owner" : "member")` — non-admin legacy users should default to `"member"`, not `"owner"`.

### 1.3 HIGH: Unbounded In-Memory Caches

**Finding**: Four `Map` caches in `server/routes.ts` grow without limit:
- `geocodeCache` (24h TTL)
- `distanceCache` (6h TTL)
- `multiRouteCache` (6h TTL)
- `placeSuggestCache` (6h TTL)

Entries are only removed on access (lazy eviction). Under sustained traffic, these maps grow indefinitely → memory leak → OOM crash.

**Fix**: Add a `maxSize` parameter to `cacheSet()` that evicts oldest entries when the map exceeds a threshold (e.g., 10,000 entries per cache). Or add periodic sweep (setInterval every 30 min).

### 1.4 MEDIUM: No Environment Variable Validation

**Finding**: The app reads 15+ env vars at runtime with no validation. Missing a critical var (e.g., `STRIPE_SECRET_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`) causes silent failures or cryptic errors.

**Fix**: Add a startup env validation step using Zod or a simple custom validator. Fail fast on missing required vars in production, warn in development.

### 1.5 MEDIUM: CORS Wide Open

**Finding** (`server/index.ts`): CORS is configured with `origin: true` (reflects any origin).

**Fix**: Restrict to known origins (`PUBLIC_APP_URL` + localhost in dev).

### 1.6 LOW: Google Maps API Key in Client Bundle

**Finding**: `VITE_GOOGLE_MAPS_API_KEY` is embedded in the client bundle. This is standard for Maps JS API but the key should be restricted by HTTP referrer in Google Cloud Console.

**Fix**: Document that the key must be referrer-restricted. Verify in Google Cloud Console.

---

## Phase 2 — Testing Foundation

### 2.1 CRITICAL: Zero Test Coverage

**Finding**: No test files exist anywhere in the codebase. No `vitest.config.*`, `jest.config.*`, or any `*.test.*` / `*.spec.*` files.

**Fix — Setup**:
- Install Vitest + testing-library/react + happy-dom
- Add `vitest.config.ts` with path aliases matching `tsconfig.json`
- Add `test` and `test:coverage` scripts to `package.json`

**Fix — Priority Test Targets** (highest business-risk logic):

| Target | File | What to test |
|--------|------|-------------|
| Cost calculations | `server/routes.ts` (getFixedCostPerHour, getFuelPerKm, getAllInHourly, calculateRouteCost) | Edge cases: zero hours, zero fuel, negative values, rounding |
| Permission system | `client/src/lib/permissions.ts` | All roles × all permissions, edge cases (null user, missing companyRole) |
| Subscription limits | `client/src/lib/subscription.ts` | Tier gates, limit checks, feature flags |
| Route calculations | `client/src/lib/routeCalc.ts` | Distance/cost math, unit conversions |
| Currency helpers | `client/src/lib/currency.ts` | Formatting, conversion edge cases |
| Measurement units | `client/src/lib/measurement.ts` | km/miles, liters/gallons conversions |
| Zod schemas | `shared/schema.ts` | Valid and invalid inputs, optional fields |
| Stripe webhook | `server/stripe.ts` | Tier derivation, subscription sync logic |

### 2.2 Integration Tests

- Stripe checkout flow (mock Stripe API)
- Firebase auth flow (mock Firebase)
- API route handlers (supertest + mocked storage)

---

## Phase 3 — Architecture & Type Safety

### 3.1 HIGH: Decompose route-builder.tsx (2,533 lines)

**Finding**: Single monolith file containing route form, stop management, cost breakdown, quote panel, map integration, accessorial charges, PDF export trigger, and lane favorites.

**Proposed decomposition**:

```
pages/route-builder/
  index.tsx                  — page shell, state coordination
  components/
    StopsList.tsx            — stop CRUD, drag-reorder
    CostBreakdownPanel.tsx   — legs table, fixed/variable/fuel split
    QuotePricingPanel.tsx    — margin calculator, customer price
    AccessorialCharges.tsx   — extra charges form
    RouteToolbar.tsx         — save, export, share actions
    FuelPriceInput.tsx       — fuel price with live data
  hooks/
    useRouteCalculation.ts   — fetch distances, compute costs
    useRouteStops.ts         — stop state management
    useQuoteSave.ts          — save/export mutation
```

### 3.2 HIGH: Consolidate Data Access Patterns

**Finding**: Two competing data access patterns:
1. TanStack Query → `fetch("/api/...")` → Express → in-memory storage
2. Direct Firestore SDK calls via `firebaseDb.ts`

Most actual data lives in Firestore. The Express CRUD endpoints use an in-memory store (`storage.ts`) that resets on restart. This is confusing and potentially leads to data loss.

**Fix**:
- Decide on one source of truth (Firestore is the answer for persistence)
- Wrap all Firestore reads in TanStack Query hooks for consistent caching/refetching
- Keep Express for compute-heavy operations (route calculation, geocoding, chat-route) and Stripe
- Remove or deprecate unused in-memory CRUD endpoints

### 3.3 MEDIUM: Add React Error Boundary

**Finding**: No Error Boundary component. An unhandled error in any component crashes the entire app with a white screen.

**Fix**: Add a root-level `<ErrorBoundary>` wrapping the router in `App.tsx`. Add granular boundaries around route-builder and quote-calculator (the most complex pages).

### 3.4 MEDIUM: Eliminate Unsafe Type Casts

**Finding**: Several `as any` and unvalidated casts:
- `App.tsx:200` — `(lane as any).cachedStops`
- `queryClient.ts` — response JSON parsed without type validation
- `firebaseDb.ts` — multiple `as Record<string, unknown>` without validation

**Fix**:
- Define proper interfaces for all Firestore document shapes
- Add Zod validation at data boundaries (API responses, Firestore reads)
- Replace `as any` with proper type narrowing

### 3.5 LOW: Inconsistent Error Handling in firebaseDb.ts

**Finding**: Some functions swallow errors silently (`catch { return [] }`), others let errors bubble. No consistent pattern.

**Fix**: Establish a convention — rethrow with context for mutations, return empty + log for queries. Use a shared error handler.

---

## Phase 4 — Performance

### 4.1 MEDIUM: No React.memo Anywhere

**Finding**: Zero `React.memo` usage across all components. The route-builder has dozens of `useState` calls — any state change re-renders the entire 2,500-line component tree.

**Fix**: After decomposition (Phase 3), wrap leaf components that receive stable props in `React.memo`. Focus on:
- `StopsList` items (re-render on any form change)
- `CostBreakdownPanel` (complex table, should only update on cost data change)
- Map component (expensive re-renders)

### 4.2 LOW: Bundle Size Audit

**Finding**: Manual chunks defined in `vite.config.ts` — good start. But no analysis of actual bundle sizes or tree-shaking effectiveness.

**Fix**:
- Run `npx vite-bundle-visualizer` to identify heavy dependencies
- Check if `lucide-react` tree-shakes properly (known issue with barrel exports)
- Consider dynamic import for `jspdf` (only needed for PDF export)

### 4.3 LOW: Firestore Query Optimization

**Finding**: Some queries fetch entire collections without limits:
- `listDirectoryUsers()` — fetches all users (admin only, but still)
- Favorite lanes query in App.tsx uses `limit(10)` — good

**Fix**: Ensure all collection reads have reasonable `limit()` and pagination support.

### 4.4 LOW: TanStack Query Configuration

**Finding**: `staleTime: Infinity` and `retry: false` means data never auto-refreshes and failed requests are never retried.

**Fix**: For cost profiles and user data, use a finite `staleTime` (e.g., 5 minutes). Add `retry: 1` for network resilience. Keep `Infinity` for truly static data.

---

## Files Reference

| File | LOC | Key Issues |
|------|-----|-----------|
| `server/routes.ts` | 1,135 | No auth middleware, unbounded caches |
| `client/src/pages/route-builder.tsx` | 2,533 | Monolith component, needs decomposition |
| `client/src/pages/quote-calculator.tsx` | 772 | Large but more focused |
| `client/src/lib/firebaseDb.ts` | 822 | Inconsistent error handling, type casts |
| `client/src/components/firebase-auth.tsx` | 407 | Race condition on signup, legacy migration |
| `client/src/lib/permissions.ts` | 159 | Default role bug on line 82 |
| `server/stripe.ts` | 283 | Webhook signature verified (good) |
| `client/src/lib/subscription.ts` | 127 | Client-only enforcement |
| `client/src/lib/queryClient.ts` | 46 | No type validation on responses |
| `shared/schema.ts` | 167 | No value range validation on numbers |
| `server/storage.ts` | ~160 | In-memory store, resets on restart |
| `client/src/App.tsx` | 759 | `as any` cast, complex sidebar logic |

---

## Implementation Order (Security-First Spiral)

```
Phase 1: Security & Bugs
  1.2  Fix permissions.ts default role bug
  1.1  Add requireAuth() middleware to API routes
  1.3  Bound in-memory caches
  1.4  Add env validation
  1.5  Restrict CORS origins
  1.6  Document API key restrictions

Phase 2: Testing
  2.1  Set up Vitest + testing-library
  2.1  Write unit tests for cost calculations
  2.1  Write unit tests for permissions
  2.1  Write unit tests for subscription limits
  2.1  Write unit tests for schemas
  2.2  Integration tests for Stripe webhook

Phase 3: Architecture
  3.1  Decompose route-builder.tsx
  3.2  Consolidate data access (TanStack Query hooks)
  3.3  Add React Error Boundary
  3.4  Fix unsafe type casts
  3.5  Standardize error handling

Phase 4: Performance
  4.1  Add React.memo after decomposition
  4.2  Bundle size audit
  4.3  Firestore query pagination
  4.4  Tune TanStack Query staleTime/retry
```

---

## What's Working Well (Keep These)

- TypeScript strict mode enabled
- Zod schemas for API validation
- React.lazy for all page routes
- Firebase security rules are well-structured (role checks, scope enforcement)
- Stripe webhook signature verification
- Manual chunk splitting in Vite config
- Clean permission matrix design (just has the bug)
- Currency and measurement unit abstraction
- DOMPurify for HTML sanitization
