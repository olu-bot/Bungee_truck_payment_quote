# Historical Rate Intelligence — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-03-31
> **Feature:** Lane-level insights in route builder + company-wide analytics dashboard

---

## Problem

Carriers quote the same lanes repeatedly but have no visibility into their own historical performance. They don't know their win rate on a lane, what price wins vs. loses, or which lanes are most profitable. This leads to inconsistent pricing and missed revenue.

## Solution

Two components:

1. **Lane Intelligence in Route Builder** — When building a route on a previously quoted lane, show historical stats and auto-suggest a winning price
2. **Analytics Page** — New top-level nav page with a Dashboard tab and the existing Quote History as a second tab

---

## Part A: Lane Intelligence in Route Builder

### How It Works

When the user enters origin and destination in the route builder, check the quote history for matching lanes. If matches exist, show a history icon that reveals lane stats on click.

### Lane Matching

Exact address matching is too strict (same lane quoted with slightly different addresses). Use **city-level fuzzy matching**:

1. Extract city from origin/destination using `extractCityFromAddress()` (already exists in route-builder.tsx)
2. Normalize: lowercase, trim, remove province/state suffixes that vary (e.g., "Toronto, ON" vs "Toronto, Ontario")
3. Match if both origin city AND destination city match a previous quote's origin/destination cities
4. Also match reversed routes (A→B matches B→A) since carriers often run the same lane in both directions

### UI: History Icon + Tooltip

When a matching lane is found, show a small `<History>` icon (Lucide) next to the route display. Clicking/hovering reveals a popover card:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Toronto → Montreal  (8 quotes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Win rate:        62% (5/8)
 Avg winning price:  $3,180
 Avg losing target:  $2,840
 Your avg margin:    28%
 Last quoted:        Mar 15, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Auto-Suggest Winning Price

When a known lane is detected, pre-fill the "Your Quote" input field with the **last winning price** on that lane (not the average — the most recent win is more relevant due to rate changes). Show a subtle label: "Last won at $3,180".

User can always override. The suggestion is just a starting point.

### Data Source

All data comes from the existing `quotes` collection in Firestore. No new data collection needed — quotes already store origin, destination, customerPrice, status (won/pending/lost), lostTargetPrice, and createdAt.

### Computation

Lane stats are computed client-side from the quotes already fetched by React Query. No new API endpoint needed — just a utility function that:
1. Groups quotes by normalized lane (origin city → destination city)
2. Computes: count, win count, loss count, avg winning price, avg losing target, avg margin, last quoted date
3. Returns stats for the current route's lane if a match exists

```typescript
// client/src/lib/laneIntelligence.ts

export type LaneStats = {
  laneKey: string;           // "toronto→montreal"
  totalQuotes: number;
  wonQuotes: number;
  lostQuotes: number;
  winRate: number;           // 0-1
  avgWinningPrice: number;
  avgLosingTarget: number;   // avg lostTargetPrice from lost quotes
  avgMarginPercent: number;
  lastWinningPrice: number;
  lastQuotedAt: string;      // ISO date
};

export function computeLaneStats(quotes: Quote[]): Map<string, LaneStats>;
export function matchLane(origin: string, destination: string, statsMap: Map<string, LaneStats>): LaneStats | null;
```

---

## Part B: Analytics Page

### Navigation Change

- Rename sidebar nav item from "Quote History" to "Analytics"
- New route: `/analytics`
- Page has two tabs: **Dashboard** | **Quote History**
- Quote History tab = the existing quote-history.tsx content (moved, not duplicated)
- Lazy-loaded like all other pages

### Dashboard Tab — KPI Cards

Top row of 4 cards:

| Card | Value | Subtitle |
|------|-------|----------|
| Total Quotes | 247 | 38 this month |
| Win Rate | 64% | ↑ 3% vs last month |
| Avg Margin | 28.5% | On won quotes |
| Revenue | $142,800 | Won quotes, last 90 days |

### Dashboard Tab — Top Lanes Table

Table showing the most-quoted lanes, sortable by quotes, win rate, or revenue:

| Lane | Quotes | Win Rate | Avg Price | Revenue |
|------|--------|----------|-----------|---------|
| Toronto → Montreal | 24 | 67% | $3,180 | $50,880 |
| Calgary → Edmonton | 18 | 72% | $1,240 | $16,120 |
| Vancouver → Seattle | 12 | 50% | $2,800 | $16,800 |

### Dashboard Tab — Revenue Over Time Chart

Simple bar chart showing monthly revenue (sum of customerPrice on Won quotes). Last 12 months by default, adjustable via date range filter.

**Chart library:** Use [Recharts](https://recharts.org) — it's React-native, lightweight (~45KB gzipped), and the most common choice for React dashboards. Add as a dependency.

### Dashboard Tab — Win/Loss Breakdown

Donut chart or horizontal bar chart:
- By status: Won / Pending / Lost (count and %)
- By truck type: breakdown of won quotes per equipment type

### Date Range Filter

Dropdown at top of dashboard: Last 30 days | Last 90 days | Last 12 months | All time

Filters all KPI cards, charts, and tables. Default: Last 90 days.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `client/src/lib/laneIntelligence.ts` | Lane matching + stats computation |
| `client/src/pages/analytics.tsx` | Analytics page shell with tabs |
| `client/src/pages/analytics/dashboard.tsx` | Dashboard tab with KPIs, charts, tables |

### Modified Files

| File | Change |
|------|--------|
| `client/src/App.tsx` | Add `/analytics` route, update nav item |
| `client/src/pages/route-builder.tsx` | Add lane history icon + auto-suggest |
| `client/src/pages/quote-history.tsx` | Export as component (no longer a standalone page route) |
| `package.json` | Add `recharts` dependency |

### Data Flow

```
Firestore quotes (already cached by React Query)
  → laneIntelligence.ts groups by normalized lane
  → Route builder: show icon + tooltip + auto-suggest for current lane
  → Analytics dashboard: aggregate into KPIs, charts, tables
```

No new API endpoints. No new Firestore queries. Everything computed client-side from the quotes collection already being fetched.

---

## Tier Gating

- **Free tier:** Lane intelligence hidden, Analytics page shows only Quote History tab (dashboard hidden)
- **Pro / Premium:** Full lane intelligence + dashboard with all charts

---

## Edge Cases

1. **No quotes yet:** Dashboard shows empty state: "Start quoting to see your analytics"
2. **Lane with only 1 quote:** Show stats but note "Limited data (1 quote)"
3. **Reversed lane matching:** Toronto→Montreal and Montreal→Toronto are treated as the same lane for stats
4. **Currency mixing:** If quotes span USD and CAD, convert all to workspace currency before aggregating
5. **Deleted quotes:** Excluded from stats (they're already removed from Firestore)
6. **Large quote history (1000+):** Client-side computation should be fast since we're just iterating an array. If performance becomes an issue, cache computed stats in a useMemo.

---

## Testing

Unit tests for `laneIntelligence.ts`:
- `computeLaneStats` groups quotes correctly by lane
- Win rate calculation is accurate
- Reversed lanes match (A→B = B→A)
- City normalization handles variations ("Toronto, ON" vs "Toronto, Ontario" vs "Toronto")
- Auto-suggest returns last winning price, not average
- Empty quotes array returns empty map
- Currency conversion applied before aggregation

---

## Out of Scope

- Market rate comparison (DAT/Truckstop integration)
- Competitor pricing data
- Predictive analytics / ML models (that's Feature 4)
- Export analytics to CSV/PDF
- Per-driver or per-truck analytics
