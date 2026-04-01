# Mobile-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Responsive overhaul so carriers can build a route and get a quote in under 30 seconds on a phone

**Architecture:** CSS-only changes using Tailwind responsive classes. No new components except MobileTabBar. No layout restructuring -- just better stacking, sizing, and progressive disclosure on small screens.

**Tech Stack:** React, Tailwind CSS

**Spec:** `/docs/superpowers/specs/2026-03-31-mobile-first-redesign-design.md`

**Design tokens (from CLAUDE.md):** Cards use `p-3 sm:p-4`, text is `text-xs`/`text-sm`, inputs are `h-7`/`h-8`/`h-9`, spacing is `space-y-3`/`gap-3`, breakpoints are `sm:` (640px), `md:` (768px), `lg:` (1024px).

---

## Task 1: Create MobileTabBar.tsx

**File:** `client/src/components/MobileTabBar.tsx` (NEW)

Fixed bottom tab bar visible only below `sm:` breakpoint, with Home / Quote History / Settings tabs. Uses Lucide icons matching the NAV_ITEMS in App.tsx.

- [ ] Create `client/src/components/MobileTabBar.tsx` with the following complete implementation:

```tsx
import { Link, useLocation } from "wouter";
import { Route as RouteIcon, History, Settings } from "lucide-react";

const TABS = [
  { path: "/", label: "Home", icon: RouteIcon },
  { path: "/history", label: "Quotes", icon: History },
  { path: "/profiles", label: "Settings", icon: Settings },
] as const;

export function MobileTabBar() {
  const [location] = useLocation();
  const routePath = location.split("?")[0] || "/";

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex items-stretch">
        {TABS.map(({ path, label, icon: Icon }) => {
          const isActive = routePath === path;
          return (
            <Link key={path} href={path} className="flex-1">
              <button
                type="button"
                className={`flex flex-col items-center justify-center w-full py-2 gap-0.5 transition-colors ${
                  isActive
                    ? "text-orange-600"
                    : "text-slate-400 active:text-slate-600"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            </Link>
          );
        })}
      </div>
      {/* Safe area spacer for iOS home indicator */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
```

**Verification:** Component renders three tabs with correct icons. Active tab is orange, inactive is slate-400. Only visible below 640px (`sm:hidden`). Fixed to bottom with z-50.

---

## Task 2: Update App.tsx -- add MobileTabBar, hide hamburger, add bottom padding

**File:** `client/src/App.tsx`

Three changes: (A) import and render MobileTabBar, (B) hide the mobile hamburger menu button when tab bar is visible, (C) add padding-bottom on main content so the tab bar doesn't overlap footer/content.

- [ ] **2a.** Add import for MobileTabBar at the top of App.tsx (near other component imports, around line 12):

```tsx
// BEFORE (around line 12):
import { FeedbackSheet } from "@/components/FeedbackSheet";

// AFTER:
import { FeedbackSheet } from "@/components/FeedbackSheet";
import { MobileTabBar } from "@/components/MobileTabBar";
```

- [ ] **2b.** Render MobileTabBar inside the AppLayout return, just before the closing `</div>` of the outermost flex container (after the footer, before the walkthrough overlay). Find the line (around line 1046):

```tsx
// BEFORE (line ~1046):
      </div>

      {/* Multi-tour walkthrough overlay (first login + Help page replay) */}

// AFTER:
      </div>

      {/* Bottom tab bar (mobile only) */}
      <MobileTabBar />

      {/* Multi-tour walkthrough overlay (first login + Help page replay) */}
```

- [ ] **2c.** Hide the hamburger button on mobile since the tab bar replaces it. The hamburger is only needed for accessing pages NOT in the tab bar (Team, Admin, Feedback). Change the mobile top bar header (around line 941-953) to remove the hamburger and replace with a smaller menu:

```tsx
// BEFORE (line ~941-983):
        <header className="md:hidden sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="px-4 h-14 grid grid-cols-3 items-center">
            {/* Left: hamburger */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid="button-mobile-menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="w-4 h-4" />
              </Button>
            </div>

// AFTER:
        <header className="md:hidden sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="px-4 h-12 grid grid-cols-3 items-center">
            {/* Left: overflow menu (for Team, Admin, Feedback -- pages not in tab bar) */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid="button-mobile-menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="w-4 h-4" />
              </Button>
            </div>
```

Note: We keep the hamburger for overflow access but shrink the header from `h-14` to `h-12` to save vertical space on mobile.

- [ ] **2d.** Add bottom padding to `<main>` so content does not get hidden behind the tab bar. Find the main element (around line 988):

```tsx
// BEFORE (line ~988):
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">

// AFTER:
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 pb-20 sm:pb-6 max-w-6xl mx-auto">
```

The `pb-20` on mobile gives 80px of bottom padding (enough for the ~56px tab bar plus breathing room). `sm:pb-6` restores normal padding on tablet+.

- [ ] **2e.** Hide the footer on mobile (it is redundant with the tab bar and wastes space). Find the footer (around line 1041):

```tsx
// BEFORE (line ~1041):
        <footer className="border-t border-border py-3 mt-auto">

// AFTER:
        <footer className="hidden sm:block border-t border-border py-3 mt-auto">
```

**Verification:** On viewports < 640px, the bottom tab bar is visible with Home/Quotes/Settings. Tapping each navigates correctly. The hamburger menu still opens the full overlay for Team/Admin/Feedback access. Footer is hidden on mobile. No content is obscured by the tab bar.

---

## Task 3: Update route-builder.tsx mobile layout

**File:** `client/src/pages/route-builder.tsx`

This is the biggest task. Four sub-changes: (A) compress map on mobile, (B) reorder columns so chat input is above the fold, (C) make cost breakdown collapsed by default on mobile, (D) make accessorials section hidden behind toggle on mobile.

- [ ] **3a.** Compress the map to a fixed height on mobile. The map card is around line 2512. Change the map container:

```tsx
// BEFORE (line ~2512):
            <Card className="border-slate-200 overflow-hidden flex-1">
              <CardHeader className="px-3 sm:px-4 pt-3 sm:pt-4 pb-1.5">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  Route Map
                  <span className="text-[10px] font-normal text-slate-400">
                    via Google Maps
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-1.5">

// AFTER:
            <Card className="border-slate-200 overflow-hidden flex-1">
              <CardHeader className="px-3 sm:px-4 pt-2 sm:pt-4 pb-1">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  Route Map
                  <span className="text-[10px] font-normal text-slate-400">
                    via Google Maps
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-1.5 max-h-[180px] sm:max-h-none overflow-hidden">
```

The `max-h-[180px] sm:max-h-none` compresses the map to ~180px on mobile (a thumbnail), and removes the height constraint on `sm:` and above. The `overflow-hidden` clips the map content neatly.

- [ ] **3b.** Reorder the two-column grid so on mobile the chat input section renders ABOVE the map/build-route section. The main grid is around line 2428:

```tsx
// BEFORE (line ~2428):
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:auto-rows-fr">

// AFTER:
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:auto-rows-fr">
```

The grid is already `grid-cols-1` by default (mobile stacks), so the order in DOM determines mobile order. The chat panel (left column) already renders first, which is correct. No change needed to the grid itself.

However, on mobile the chat history takes too much space above the input. We should limit the chat message area height on mobile. Find the chat messages div (around line 2438):

```tsx
// BEFORE (line ~2438-2439):
              <div
                className="space-y-2 flex-1 min-h-[180px] overflow-y-auto"
                data-testid="chat-messages"
              >

// AFTER:
              <div
                className="space-y-2 flex-1 min-h-[80px] sm:min-h-[180px] max-h-[200px] sm:max-h-none overflow-y-auto"
                data-testid="chat-messages"
              >
```

This limits chat history to 200px on mobile (scrollable) so the cost card and other content are reachable without excessive scrolling. On `sm:` and above, the original behavior is restored.

- [ ] **3c.** Make the Route + Cost Card sticky section use tighter spacing on mobile. The sticky card container is around line 1813:

```tsx
// BEFORE (line ~1813):
      <div className="sticky top-14 md:top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-1 bg-background">

// AFTER:
      <div className="sticky top-12 sm:top-14 md:top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-1 bg-background">
```

This adjusts the sticky top offset to match the new `h-12` mobile header (changed in Task 2c).

- [ ] **3d.** On mobile, collapse the cost breakdown legs by default and hide the accessorials grid behind a toggle. The breakdown is already collapsible via `showBreakdown` state (line 576). We need to make the accessorials section (advanced mode) also collapsible on mobile.

Add a new state variable near the other state declarations (around line 576):

```tsx
// BEFORE (line ~576):
  const [showBreakdown, setShowBreakdown] = useState(false);

// AFTER:
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showMobileCharges, setShowMobileCharges] = useState(false);
```

Then wrap the charges grid (around line 2228) with a mobile toggle:

```tsx
// BEFORE (line ~2228-2235):
            <div className="space-y-2" data-testid="charges-section">
              <div className="flex items-center gap-2">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Charges</h4>
                <div className="flex-1 border-t border-slate-100" />
                {accessorialTotal > 0 && <span className="text-[11px] font-semibold text-orange-600">+{formatCurrency(accessorialTotal)}</span>}
                <a href="#/profiles?tab=company" className="text-[11px] text-orange-500 underline underline-offset-2 hover:text-orange-600" data-testid="link-adjust-defaults">Adjust Defaults</a>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">

// AFTER:
            <div className="space-y-2" data-testid="charges-section">
              <div className="flex items-center gap-2">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Charges</h4>
                <div className="flex-1 border-t border-slate-100" />
                {accessorialTotal > 0 && <span className="text-[11px] font-semibold text-orange-600">+{formatCurrency(accessorialTotal)}</span>}
                <button
                  type="button"
                  className="sm:hidden text-[11px] text-orange-500 hover:text-orange-600 flex items-center gap-0.5"
                  onClick={() => setShowMobileCharges((v) => !v)}
                >
                  {showMobileCharges ? "Hide" : "Show"}
                  {showMobileCharges ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <a href="#/profiles?tab=company" className="text-[11px] text-orange-500 underline underline-offset-2 hover:text-orange-600" data-testid="link-adjust-defaults">Adjust Defaults</a>
              </div>
              <div className={`grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 ${showMobileCharges ? "" : "hidden sm:grid"}`}>
```

The charges grid is now hidden on mobile by default (`hidden sm:grid`), and toggled via the "Show/Hide" button which is only visible on mobile (`sm:hidden`). On `sm:` and above, the grid is always visible.

- [ ] **3e.** Make the pricing row (4-column grid at line 1865) more compact on mobile. The pricing columns have `pr-2 sm:pr-6` already but the font sizes can be tighter:

```tsx
// BEFORE (line ~1865):
              className="grid grid-cols-4 gap-0 divide-x divide-slate-100"

// AFTER:
              className="grid grid-cols-4 gap-0 divide-x divide-slate-100"
```

No grid change needed -- the existing responsive font sizes (`text-[9px] sm:text-[11px]`) are already mobile-aware. The layout is already tight.

**Verification:** On mobile (375px):
- Map is compressed to ~180px thumbnail
- Chat messages area is limited to 200px with scroll
- Cost card is sticky below the shorter header
- Charges section in advanced mode is collapsed with a "Show" toggle
- All content is reachable without excessive scrolling

---

## Task 4: Update quote-history.tsx -- card layout improvements on mobile

**File:** `client/src/pages/quote-history.tsx`

The stats bar should wrap into a 2x2 grid on mobile. The QuoteRow already has responsive styles (`flex-col sm:flex-row`) so it is mostly mobile-ready. We just need to improve the stats bar.

- [ ] **4a.** Change the stats bar to a grid on mobile instead of a flex row that wraps awkwardly. Find the stats bar (around line 576):

```tsx
// BEFORE (line ~576):
        <div className="flex items-center gap-4 flex-wrap" data-testid="quote-stats-bar">
          <p className="text-sm font-medium">
            {effectiveQuotes.length} quote{effectiveQuotes.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-slate-500">
              <Clock className="w-3 h-3" /> {pendingQuotes.length} pending
            </span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Trophy className="w-3 h-3" /> {wonQuotes.length} won
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="w-3 h-3" /> {lostQuotes.length} lost
            </span>
            {winRate !== null && (
              <span className="font-semibold text-slate-900">
                {winRate}% win rate
              </span>
            )}
          </div>
        </div>

// AFTER:
        <div data-testid="quote-stats-bar">
          <p className="text-sm font-medium mb-2">
            {effectiveQuotes.length} quote{effectiveQuotes.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-3 text-xs">
            <span className="flex items-center gap-1 text-slate-500">
              <Clock className="w-3 h-3" /> {pendingQuotes.length} pending
            </span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Trophy className="w-3 h-3" /> {wonQuotes.length} won
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="w-3 h-3" /> {lostQuotes.length} lost
            </span>
            {winRate !== null && (
              <span className="font-semibold text-slate-900">
                {winRate}% win rate
              </span>
            )}
          </div>
        </div>
```

The stats use `grid grid-cols-2` on mobile for a 2x2 layout, and `sm:flex sm:items-center` on tablet+ for the original inline flow.

- [ ] **4b.** Make the search input taller on mobile for touch targets. Find the search input (around line 601):

```tsx
// BEFORE (line ~601):
          <Input
            placeholder="Search by lane, quote #, status, note..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            data-testid="input-search-quotes"
          />

// AFTER:
          <Input
            placeholder="Search by lane, quote #, status, note..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-11 sm:h-9 text-sm"
            data-testid="input-search-quotes"
          />
```

The `h-11` (44px) on mobile meets the touch target minimum. `sm:h-9` restores the compact size on tablet+.

**Verification:** On mobile (375px), stats show in a 2x2 grid. Search input is 44px tall. Quote cards stack vertically with clear status/actions.

---

## Task 5: Update cost-profiles.tsx -- single-column form on mobile

**File:** `client/src/pages/cost-profiles.tsx`

The profile edit form already uses `grid-cols-1 sm:grid-cols-2` and `grid-cols-1 sm:grid-cols-3` which is correct for mobile. Minor touch target improvements needed.

- [ ] **5a.** Make the profile detail form grids use tighter column layouts on mobile. Find the company info grid (around line 398):

```tsx
// BEFORE (line ~398):
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

// (no change -- already single-column on mobile)
```

Already correct. The forms use `grid-cols-1 sm:grid-cols-2` which stacks on mobile.

- [ ] **5b.** Make profile list items (the editable field rows) have larger touch targets on mobile. Find the field display section in the profile detail view. The individual field items in the profile edit grid (around line 495) use `sm:grid-cols-3`:

```tsx
// BEFORE (line ~495):
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

// (no change -- already single-column on mobile)
```

Already correct.

- [ ] **5c.** Make the profile cards in the list view have tighter padding on mobile. Find the profile list card content (around line 721):

```tsx
// BEFORE (line ~721):
      <CardContent className="px-4 pb-4 pt-0 space-y-3">

// AFTER:
      <CardContent className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 space-y-3">
```

This matches the CLAUDE.md card padding convention: `p-3 sm:p-4`.

- [ ] **5d.** Make the settings section grids (around line 1115) use CLAUDE.md-compliant spacing:

```tsx
// BEFORE (line ~1115):
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

// AFTER:
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
```

Change `gap-4` to `gap-3` to match the design token for grid gaps.

**Verification:** On mobile (375px), all profile forms show single-column. Card padding matches design tokens. No content overflows.

---

## Task 6: Update team-management.tsx -- card layout for members on mobile

**File:** `client/src/pages/team-management.tsx`

The member list uses `divide-y` rows. On mobile, these should have more vertical padding for touch targets and the role badge should wrap below the name.

- [ ] **6a.** Change the outer spacing to match CLAUDE.md. Find the outer div (around line 283):

```tsx
// BEFORE (line ~283):
    <div className="space-y-6">

// AFTER:
    <div className="space-y-4 sm:space-y-6">
```

Tighter vertical spacing on mobile.

- [ ] **6b.** Make member list rows taller on mobile for better touch targets. Find the member row div (around line 357-359):

```tsx
// BEFORE (line ~357-359):
                  <div
                    key={m.uid}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"

// AFTER:
                  <div
                    key={m.uid}
                    className="flex items-center gap-3 py-3.5 sm:py-3 first:pt-0 last:pb-0"
```

The `py-3.5` gives slightly more breathing room on mobile (28px padding vs 24px), making rows easier to tap.

- [ ] **6c.** Change the Team Members card header to use CLAUDE.md-compliant sizing. Find the CardHeader (around line 334-338):

```tsx
// BEFORE (line ~334-338):
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Team Members
          </CardTitle>
        </CardHeader>

// AFTER:
        <CardHeader className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-500" />
            Team Members
          </CardTitle>
        </CardHeader>
```

This applies the CLAUDE.md card header padding convention and changes `text-base` to `text-sm font-semibold` (the design token for section headings inside cards). The icon color changes to `text-orange-500` per the icon color convention.

**Verification:** On mobile (375px), team member rows have adequate touch targets. The layout remains single-column. Card headers match design tokens.

---

## Task 7: Add touch target CSS and iOS zoom prevention

**File:** `client/src/index.css` (or wherever global styles live)

All interactive elements on mobile need a minimum 44px touch target, and inputs need 16px font-size to prevent iOS auto-zoom.

- [ ] **7a.** Find the global CSS file. It is likely `client/src/index.css`. Add mobile touch target rules at the end of the file:

```css
/* ── Mobile touch targets & iOS zoom prevention ───────────────── */
@media (max-width: 639px) {
  /* Minimum touch target size for all interactive elements */
  button,
  [role="button"],
  a {
    min-height: 44px;
  }

  /* Prevent iOS zoom on input focus (requires 16px minimum) */
  input,
  select,
  textarea {
    font-size: 16px !important;
  }

  /* Exception: elements explicitly marked as compact (badges, inline chips) */
  .touch-target-exempt {
    min-height: auto;
  }
}
```

**IMPORTANT:** The `min-height: 44px` on buttons will affect small inline buttons (status action buttons in quote rows, close buttons, etc.). Some buttons use `h-6` or `h-7` classes which will now be overridden on mobile. This is intentional -- those buttons were too small for touch. However, we need to exempt certain decorative/badge elements.

- [ ] **7b.** Audit and add `touch-target-exempt` class to any small buttons that should NOT grow on mobile. The main candidates are:

In `quote-history.tsx`, the status action buttons (Won/Lost/Reset) at line ~259-269 use `h-6` which is intentionally small. These should grow to 44px on mobile for better touch targets, so no exemption needed.

The `Info` tooltip triggers throughout route-builder.tsx are `w-3 h-3` icons wrapped in `TooltipTrigger`. These are not buttons, so the CSS rule does not affect them.

No exemptions are needed for this codebase. The 44px minimum is appropriate for all button/link elements on mobile.

- [ ] **7c.** Add viewport meta tag adjustment for safe-area support. Check `client/index.html` for the viewport meta tag and ensure it includes `viewport-fit=cover` for the safe area insets used by the tab bar:

The viewport meta tag should be:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

If `viewport-fit=cover` is not already present, add it. This enables `env(safe-area-inset-bottom)` used in the MobileTabBar component.

**Verification:** On iPhone Safari, inputs do not trigger auto-zoom. All buttons are at least 44px tall on mobile. The tab bar respects the iOS safe area (home indicator).

---

## Task 8: Visual testing pass and commit

This is a manual verification task, not a code change.

- [ ] **8a.** Run the dev server and test at these viewports:
  - 375px (iPhone SE)
  - 390px (iPhone 14)
  - 768px (iPad)
  - 1280px (desktop)

- [ ] **8b.** Test the critical flow at 375px:
  1. Open app -- tab bar is visible at bottom
  2. Type a route in chat input ("Toronto to Montreal")
  3. See cost card with pricing
  4. Set a custom quote amount
  5. Tap Save Quote with Won status
  6. Navigate to Quotes tab via bottom tab bar
  7. See the saved quote in the list
  **Target: complete in under 30 seconds.**

- [ ] **8c.** Verify no regressions at 1280px desktop:
  - Sidebar shows normally
  - Two-column layout works
  - Tab bar is hidden
  - Footer is visible
  - All inputs are normal size (not forced to 44px/16px)

- [ ] **8d.** Commit all changes with message: `feat: mobile-first responsive redesign with bottom tab bar and touch-optimized layout`

---

## Files Modified Summary

| File | Type | Changes |
|------|------|---------|
| `client/src/components/MobileTabBar.tsx` | NEW | Bottom tab bar component (Home/Quotes/Settings) |
| `client/src/App.tsx` | EDIT | Import MobileTabBar, render it, shrink mobile header, add pb-20 to main, hide footer on mobile |
| `client/src/pages/route-builder.tsx` | EDIT | Compress map, limit chat history height, collapsible charges on mobile, adjust sticky offset |
| `client/src/pages/quote-history.tsx` | EDIT | 2x2 stats grid on mobile, taller search input |
| `client/src/pages/cost-profiles.tsx` | EDIT | Card padding to match CLAUDE.md, gap-3 on settings grid |
| `client/src/pages/team-management.tsx` | EDIT | Tighter spacing, larger row padding, CLAUDE.md-compliant card header |
| `client/src/index.css` | EDIT | Touch target minimums (44px buttons, 16px input font), iOS zoom prevention |
| `client/index.html` | EDIT | viewport-fit=cover for safe area insets |

## Dependencies Between Tasks

- Task 2 depends on Task 1 (MobileTabBar must exist before importing it)
- Task 3c depends on Task 2c (sticky offset references the new header height)
- All other tasks are independent and can be parallelized
- Task 8 depends on all other tasks being complete
