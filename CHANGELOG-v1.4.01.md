# Bug Fix V1.4.01 — Changelog

## Branch: `bug-fix-V1.4.01`

---

### 1. Accessorial Charges — Detention & Stops Layout Alignment
**File:** `client/src/pages/route-builder.tsx`

- Moved the rate text (`$75/hr`, `$75/stop`) **inline on the same row** as the label for **Detention** and **Stops**, using a `<span>` inside the label div.
- Layout is now 2-row (label+rate on row 1, input on row 2), matching Lumper/Border/TONU/Tailgate and keeping all input boxes vertically aligned.
- Removed the `× ` prefix and the separate rate row.

---

### 2. Narrower Inputs for Lumper, Border, TONU, Tailgate
**File:** `client/src/pages/route-builder.tsx`

- Changed input `width` to `calc(100% - 5px)` for **Lumper**, **Border**, **TONU**, and **Tailgate** inputs, making each 5px narrower.
- Frees up space, giving the **Other** charges column more room for user text entry.
- Restructured **Other** field: "Other:" label and the custom label text input are now inline on the same row (`Other: ________`), with a bottom border underline on the text field. The amount input remains on row 2.

---

### 3. Single-Page Layout — No Scroll on Login
**Files:** `client/src/App.tsx`, `client/src/pages/route-builder.tsx`, `client/src/components/RouteMapGoogle.tsx`

- **App.tsx**: Reduced main content vertical padding from `py-6 pb-6` to `py-3 pb-3`.
- **RouteMapGoogle.tsx**: Shrunk map height from `420px` to `280px` (both the map container and the empty-state placeholder).
- **Route Chat box**: Reduced message area min-height from `180px` to `80px`. Shrunk textarea from `72px` (3 rows) to `48px` (2 rows).
- **Build Route form**: Tightened internal spacing from `space-y-3.5` to `space-y-2`, padding from `pb-3/pb-4` to `pb-2/pb-3`.
- **Page sections**: Reduced all vertical gaps from `space-y-3` to `space-y-2` and grid gap from `gap-3` to `gap-2`.

---

### 4. All Stops Deletable (Including Origin & Destination)
**File:** `client/src/pages/route-builder.tsx`

- Removed all conditional hiding — every stop (origin, destination, intermediate) always shows a delete button.
- Deleting a stop automatically adds a fresh empty stop if fewer than 2 remain, ensuring there is always at least an origin and destination.
- Delete button styled with `text-slate-300 hover:text-red-500` for subtle appearance that highlights on hover.

---

### 5. Local Dev Environment Setup
**File:** `server/index.ts`

- Added `http://localhost:5555` to the CORS allowed origins list so the dev server works on port 5555.

**File:** `.env`

- Copied production environment variables (Firebase, Google Maps API key, Stripe) from `BungeeConnectFinal` to enable full local development matching the live version.

---

### 6. Drag & Drop — Handle-Only + Improved UI
**File:** `client/src/pages/route-builder.tsx`

- Moved `draggable` and `onDragStart` from the outer row `<div>` to the grip handle element only. Users can now only initiate drag by clicking and holding the grip icon, not by dragging the text input.
- The row container remains the drop target (`onDragOver`, `onDrop`, `onDragLeave`).
- Improved drag handle styling: lighter default color (`text-slate-300`), hover highlight (`hover:text-slate-500 hover:bg-slate-100`), rounded padding, and a "Drag to reorder" tooltip.
- Improved drag-over visual: orange-tinted ring (`ring-orange-400/50`) and background (`bg-orange-50/50`) instead of generic primary color.
- Dragging item now scales down slightly (`scale-[0.98]`) with lower opacity (`opacity-30`) for a cleaner drag effect.

---

### 7. Surcharge Applies in Both Quick and Advanced Mode
**File:** `client/src/pages/route-builder.tsx`

- Removed the `quoteMode !== "advanced"` guard from `costInflationAmount` so the surcharge % applies to the base trip cost whenever a value is entered, regardless of mode.
- Other accessorial charges (detention, stops, lumper, etc.) remain Advanced-mode only.

---

### 8. Reset Quote, Note, and Surcharge on New Route
**File:** `client/src/pages/route-builder.tsx`

- When a new route is built via `triggerRouteBuild`, the following fields now reset automatically:
  - **Your Quote** (`customQuoteAmount`) → clears to empty
  - **Note** (`customerNote`) → clears to empty
  - **Surcharge %** (`costInflationPct`) → resets to 0

---

### 9. Pricing Table — Match Landing Page
**File:** `client/src/components/UpgradeDialog.tsx`

- Updated all three tier feature lists to exactly match the landing page:
  - **Free**: "AI Chatbot routing", "Google Maps visualization", "Custom quote amount", "Won / Pending / Lost tracking", "Live EIA fuel price updates", "Mobile-optimized layout" (renamed/added)
  - **Pro**: Added "IFTA fuel tax estimator", "Analytics dashboard", "Lane rate intelligence", "AI pricing suggestions"; renamed "5 users with role-based access"; reordered to match landing page
  - **Premium**: Replaced "Dispatch view" with "Market rate comparison"; updated seat pricing text; removed non-landing items

---

### 10. Mobile — PDF Button Moved to Note Row
**File:** `client/src/pages/route-builder.tsx`

- On mobile, the PDF button is now on the same row as the "Add a note…" field (row 2), instead of crowding the Won/Pending/Lost buttons row.
- On desktop (`sm:` and above), PDF button remains inline with the save buttons on row 1, unchanged.

---

### 11. Drive Time Adjustors — Breakdown Only
**File:** `client/src/pages/route-builder.tsx`

- Removed the drive time ±5m adjustor controls from the Build Route / Route Map section.
- Adjustors remain available in the Breakdown section only.

---

### 12. Drive Time Adjustors — 30-Minute Steps & Reset Button Repositioned
**File:** `client/src/pages/route-builder.tsx`

- Changed adjustor increment from **5 minutes to 30 minutes** (both `+` and `−` buttons).
- Updated disabled threshold for the `−` button from `<= 5` to `<= 30` (cannot go below 30 minutes).
- Moved the **reset** button to the **left of the minus sign** (before the `−` button) instead of after the `+` button.
- Reset button only appears when `driveAdj !== 0` (unchanged).

---

### 13. Drive Time Adjustors — Delta Indicator Moved to Front
**File:** `client/src/pages/route-builder.tsx`

- Moved the `+Xm` / `−Xm` adjustment delta indicator to the **front of the adjustor row** (before reset and `−` button), so the order is: delta → reset → `−` → time → `+`.
- Subsequently swapped reset and delta so the final order is: **reset → delta → `−` → time → `+`**.

---

### 14. Bug Fix — Favorite Lanes: Intermediate Stops Not Saved/Shown
**Files:** `client/src/pages/route-builder.tsx`, `client/src/App.tsx`

- **Loading bug**: `handleLoadLane` was always calling `populateFormFromLocations([origin, destination])`, resetting the form to 2 inputs regardless of how many stops were cached. Fixed to pass all stop locations from `cachedStops` when available.
- **Display bug**: The sidebar (desktop and mobile) only rendered `lane.origin` and `lane.destination`. Fixed to extract intermediate stops from `cachedStops` and render each as `→ stop` between origin and destination.
- Hover tooltip on lane buttons now shows the full route (`origin → stop1 → … → destination`).

---

### 15. Breakdown — Dock Time Renamed + Interactive Adjuster
**Files:** `client/src/pages/route-builder.tsx`, `client/src/pages/route-builder/types.ts`

- Renamed **"Load + Unload"** to **"Dock Time"** in the breakdown section.
- Added interactive `−` / `+` adjuster buttons (30-minute steps) for dock time on each non-deadhead leg, matching the style of the drive time adjuster.
- Dock time defaults to the value set by the user in the Cost section (`defaultDockMinutes`). The **reset** button (shown only when changed) restores it to that default.
- Delta indicator (`+Xm` / `−Xm`) appears when dock time differs from the default.
- Extended `applyDriveAdjustments` to also propagate per-stop dock time overrides from `formStops` into the `RouteStop` array before each cost recalculation.

---

### 16. Favorite Lanes — Save & Restore Full Cost/Charge State
**Files:** `client/src/pages/route-builder.tsx`, `client/src/pages/route-builder/types.ts`, `client/src/App.tsx`

- When a user favorites a lane, all cost and charge settings are now saved alongside the route (`cachedCosts`):
  - All accessorial charges (detention, lumper, stops, border, TONU, tailgate, other, surcharge %)
  - Custom quote amount and customer note
  - Quote mode (Quick / Advanced)
  - Pay mode (Per Hour / Per KM)
  - Default dock time
  - Include deadhead toggle
  - Selected cost profile
- Loading a favorite lane restores all of the above, so the quote reloads exactly as it was when saved.
- Added `CachedCosts` type to `types.ts` and updated `LaneWithCache` to include it.
- `App.tsx` now passes `cachedCosts` through the `bungee:load-lane` custom event.

---

### 17. Mobile UI Normalization — Token Cleanup
**Files:** `client/src/pages/route-builder.tsx`, `client/src/App.tsx`

- Collapsed 11 font sizes → 4: `text-[9px]`→`text-[10px]`, `text-[11px]`/`text-[12px]`→`text-xs` (12px), `text-[13px]`/`text-[15px]`→`text-sm` (14px). Display prices (`text-base`/`text-lg`/`text-2xl`) unchanged.
- Raised minimum tappable element height to `h-8` (32px); primary inputs and action buttons at `h-9` (36px). Drive/dock time ± adjuster pairs remain `w-5 h-5`.
- Standardized horizontal padding to 3 values: `px-2` / `px-3` / `px-4`. Removed `px-2.5`, `px-3.5`.
- Standardized gap to 3 values: `gap-1` / `gap-2` / `gap-3`. Removed `gap-0.5`, `gap-1.5`, `gap-2.5`.
- Standardized vertical padding to 3 values: `py-1` / `py-2` / `py-3`. Removed `py-1.5`, `py-2.5`.
- Standardized `space-y` to 3 values: `space-y-1` / `space-y-2` / `space-y-3`. Removed `space-y-0.5`, `space-y-2.5`.
- Standardized border radius to 2 values: `rounded-md` / `rounded-lg`. Removed bare `rounded`, `rounded-xl`.
- Desktop (`sm:`) layout unchanged.

---

### 18. Fix — Duplicate Divider Between Dock Time and Deadhead
**Files:** `client/src/pages/route-builder.tsx`

- Removed the second `w-px h-5 bg-slate-200` vertical divider that appeared between "Dock Time" and "Deadhead" on desktop. The mobile-only surcharge block was hidden (`sm:hidden`) but its surrounding dividers were both still visible, producing a double bar.

---

### 19. Toll Surcharge Field ($/km or $/mi)
**Files:** `client/src/pages/route-builder.tsx`, `client/src/pages/route-builder/types.ts`

- Added `tollRatePerKm` field to `accessorials` state (default `0`).
- Added `tollAmount` computed value: `tollRatePerKm × totalDistanceKm` (rate auto-converts $/mi → $/km for imperial users).
- `carrierCost` now includes `tollAmount` alongside `costInflationAmount`.
- UI: unlabelled `$ | 0 | /km` (or `/mi`) input box rendered directly next to the `%` surcharge box on both mobile and desktop, always on the same row.
- Surcharge tooltip updated to explain both fields and includes average toll reference (~$0.25–$0.40/km on Canadian toll highways, ~$0.15–$0.25/mi on US toll roads).
- Pricing advice effect updated to include `tollAmount` in the cost basis so margin tiers recalculate when toll changes.
- `CachedCosts.accessorials` type updated to include `tollRatePerKm` for fav lane save/restore.
- Resets to `0` on new route build.

---

### 20. Walkthrough Tour Updates — Fav Lane & Multi-Stop Steps
**Files:** `client/src/components/Walkthrough.tsx`

- Added "Save a Favorite Lane" step to the **overview** tour (step 2, after building first route). Targets `button-fav-lane`, auto-advances on click.
- Added "Multi-Stop Routes" step to the **advanced-quote** tour (step 0, before entering Advanced mode). Targets `button-add-stop`, informational.
- Overview tour: 8 → 9 steps. Advanced-quote tour: 6 → 7 steps.

---

### 21. Workflow Screenshot Recordings for Landing Page
**Files:** N/A (browser output)

- Captured 13 screenshots across 4 key workflows using Chrome automation:
  - **Workflow 1** (7 shots): Create cost profile → build Toronto→Montreal route → favorite the lane
  - **Workflow 2** (2 shots): Multi-stop Toronto→Kingston→Ottawa → per-leg breakdown with adjusters
  - **Workflow 3** (2 shots): Enter custom quote $1,050 + customer note → save as Won
  - **Workflow 4** (2 shots): Quote History dashboard (4 quotes, 67% win rate) → search filter "Walmart"
- Screenshots saved to disk for landing page embedding.
- Resets to `0` on new route build.
