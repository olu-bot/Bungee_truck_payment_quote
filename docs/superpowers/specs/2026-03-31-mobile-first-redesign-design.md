# Mobile-First Redesign — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-03-31
> **Feature:** Responsive overhaul optimized for quick quoting on phones
> **Priority:** Do this last — after all new features are built, so the redesign includes them

---

## Problem

Carriers and dispatchers often need to price loads on the road from their phones. The current app has basic responsive styles but isn't optimized for the "phone in the cab" use case — touch targets are too small, the two-column route builder layout doesn't stack well, and the chat input dominates too much screen space.

## Solution

Responsive CSS overhaul of the existing codebase. No separate mobile layout — just better Tailwind breakpoints, touch-optimized sizing, and smart stacking for small screens. Primary goal: a dispatcher can build a route and get a quote in under 30 seconds on a phone.

---

## Design Principles

1. **Chat-first on mobile** — The chat input is the fastest way to enter a route. On mobile, make it the hero element.
2. **Progressive disclosure** — Show the essential info (cost, margin, price) immediately. Details (leg breakdown, IFTA, analytics) behind taps.
3. **Thumb-friendly** — All interactive elements ≥44px touch target. Bottom-anchored actions.
4. **Minimal scrolling** — Key information (cost + quick quote) visible without scrolling.

---

## Page-by-Page Changes

### Route Builder (Home) — The Critical Path

**Current desktop layout:** Two columns — left (chat + quote pricing) and right (map + build route form + cost breakdown)

**Mobile layout (< 640px):**

```
┌──────────────────────────┐
│ Profile selector  │ Fuel │  ← compact header row
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ Chat input (1 line)  │ │  ← sticky at top, always visible
│ │ [Send]               │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│        Route Map         │  ← collapsed to ~150px height
│   (tap to expand full)   │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ COST: $2,847         │ │  ← big, bold, immediately visible
│ │ YOUR QUOTE: $___     │ │
│ │ [Won] [Pending] [Lost]│ │
│ └──────────────────────┘ │
├──────────────────────────┤
│ Chat history (scrollable)│  ← below the fold
├──────────────────────────┤
│ Build Route form         │  ← below chat, for manual entry
│ (origin / dest / stops)  │
├──────────────────────────┤
│ Cost Breakdown           │  ← collapsible, closed by default
│ (tap to expand legs)     │
└──────────────────────────┘
```

**Key changes:**
- Chat input sticky at top (not buried below chat history)
- Map compressed to thumbnail, expandable on tap
- Cost + Quote + Save buttons visible without scrolling
- Cost breakdown collapsed by default on mobile
- Accessorials section hidden behind "Advanced" toggle on mobile
- Favorite lanes: swipe-friendly horizontal scroll instead of sidebar list

### Quote History / Analytics

**Mobile layout:**
- KPI cards: 2×2 grid instead of 4-column row
- Top lanes table: horizontal scroll with sticky first column
- Chart: full-width, simplified axis labels
- Quote list: card layout instead of table rows (each quote = a card with key info)

### Cost Profiles

**Mobile layout:**
- Profile list as cards (not table)
- Profile edit form: single-column stack, full-width inputs
- Wizard: one field per screen (step-through) instead of all fields visible

### Settings / Team

- Already mostly single-column — minor spacing/sizing tweaks
- Team member cards instead of table rows

### Navigation

**Current:** Left sidebar, collapses to hamburger on mobile
**Change:** Keep hamburger pattern but add a **bottom tab bar** on mobile for the 3 most-used pages:

```
┌──────────────────────────────┐
│ [🏠 Home] [📊 Analytics] [⚙️ Settings] │
└──────────────────────────────┘
```

Use Lucide icons. Tab bar is `position: fixed; bottom: 0`. Hide the sidebar hamburger when tab bar is visible.

---

## Specific CSS Changes

### Touch Targets

All interactive elements on mobile must be ≥ 44px:

```css
/* Buttons */
@media (max-width: 640px) {
  button, [role="button"] { min-height: 44px; }
  input, select, textarea { min-height: 44px; font-size: 16px; } /* 16px prevents iOS zoom */
}
```

### Breakpoints

Follow the existing Tailwind breakpoints:
- `sm:` (640px) — phone → tablet transition
- `md:` (768px) — tablet
- `lg:` (1024px) — desktop

Most changes are at the `sm:` breakpoint. Mobile-first: write the mobile style as default, add `sm:` for tablet+.

### Card Padding

Cards on mobile use tighter padding:
```
Mobile: p-2.5 (current p-3 sm:p-4)
```

### Font Sizes

No changes needed — the existing typography scale (text-xs, text-sm) is already appropriate for mobile. The key issue is layout, not font size.

---

## Implementation Strategy

This is **not** a rewrite. It's a pass through each page adding/improving responsive classes:

1. **Audit each page** at 375px width (iPhone SE) and 390px (iPhone 14)
2. **Fix layout breaks** — columns that don't stack, overflowing elements
3. **Add mobile-specific layouts** — stacking order, collapsed sections, bottom tab bar
4. **Test touch targets** — ensure all buttons/inputs are ≥44px on mobile
5. **Test with real content** — long location names, large numbers, multi-stop routes

### Files to Modify

| File | Changes |
|------|---------|
| `client/src/App.tsx` | Add bottom tab bar component for mobile, adjust route layout |
| `client/src/pages/route-builder.tsx` | Reorder sections for mobile, sticky chat input, collapsible sections |
| `client/src/pages/quote-history.tsx` | Card layout for quotes on mobile |
| `client/src/pages/analytics/dashboard.tsx` | 2×2 KPI grid, responsive charts |
| `client/src/pages/cost-profiles.tsx` | Card layout, single-column form |
| `client/src/pages/team-management.tsx` | Card layout for members |
| `client/src/components/ui/` | Touch target minimums on base components |

### New Components

| Component | Purpose |
|-----------|---------|
| `client/src/components/MobileTabBar.tsx` | Bottom navigation tab bar (mobile only) |

---

## Testing Approach

- **Device testing:** iPhone SE (375px), iPhone 14 (390px), Galaxy S21 (360px)
- **Key flow test:** Open app → type route in chat → see cost → set quote → save as Won. Must complete in <30 seconds on a phone.
- **No new unit tests needed** — this is purely CSS/layout. Visual regression testing via screenshots at different widths.

---

## Tier Gating

None — mobile responsiveness is available to all tiers.

---

## Out of Scope

- Native mobile app (iOS/Android)
- PWA manifest / offline support
- Push notifications
- Gesture-based navigation (swipe between pages)
- Dark mode (already partially supported via next-themes)
