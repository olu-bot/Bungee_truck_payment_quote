# AI-Powered Pricing Suggestions — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-03-31
> **Feature:** Smart pricing suggestions combining carrier's own history + market rate data
> **Depends on:** Feature 3 (Historical Rate Intelligence)

---

## Problem

Carriers set prices based on gut feel. They don't know if they're leaving money on the table or pricing themselves out of loads. They need data-driven guidance that combines their own win/loss history with external market rates.

## Solution

Add a "Suggested Price" indicator to the route builder that shows a recommended customer price with a confidence level. The suggestion combines two data sources:

1. **Internal:** The carrier's own quote history (win rate at different margins per lane)
2. **External:** Market rate data from a freight rate API (Premium only)

---

## How It Works

### Suggestion Algorithm

When a route is calculated, the pricing engine runs:

**Step 1: Internal Signal (from Feature 3's lane stats)**
- Look up the lane in quote history
- Find the margin % range where win rate is highest
- Calculate: `suggested_internal = carrier_cost × (1 + optimal_margin%)`
- Confidence based on sample size: <5 quotes = low, 5-15 = medium, 15+ = high

**Step 2: External Signal (market rate, Premium only)**
- Query market rate API for the lane (origin/dest, equipment type, distance)
- Get: average market rate, low/high range
- If carrier's cost + margin is below market low → "You're under-pricing"
- If above market high → "You're above market"

**Step 3: Combined Suggestion**
- If both signals available: weighted average (60% internal, 40% market) with combined confidence
- If only internal: use internal with its confidence
- If only market (new lane, no history): use market average with medium confidence
- If neither (new lane, no market data): fall back to existing margin tiers (no AI suggestion)

### Confidence Levels

| Level | Criteria | Display |
|-------|----------|---------|
| High | 15+ quotes on lane + market data confirms | Green dot |
| Medium | 5-15 quotes OR market data only | Yellow dot |
| Low | <5 quotes, no market data | Gray dot |

---

## UI: Pricing Suggestion Card

Appears below the margin/pricing section in the route builder when a suggestion is available:

```
┌─────────────────────────────────────────┐
│ 💡 SUGGESTED PRICE           ●● High    │
│                                         │
│    $3,150                               │
│    28% margin · Based on 18 quotes      │
│                                         │
│    Your win rate at this margin: 72%     │
│    Market range: $2,900 – $3,400        │
│                                         │
│    [Use This Price]                     │
└─────────────────────────────────────────┘
```

- "Use This Price" button sets the custom quote amount to the suggested price
- The card uses the app's design language: `border-slate-200`, `text-slate-900` for the price, `text-slate-500` for details, orange accent for the button
- Confidence dot: green/yellow/gray circle next to "High/Medium/Low"
- If no market data (Free/Pro tier): omit "Market range" line, show only internal signal

---

## Market Rate Integration

### API Selection

For market rate data, integrate with **DAT iQ API** (the industry standard for US/Canada freight rates):
- Provides lane-level rate data (spot + contract)
- Coverage: all US states + Canadian provinces
- Data: avg rate/mile, low/high range, volume, trend
- Cost: enterprise API subscription (negotiate based on usage)

**Alternative if DAT is too expensive:** [Greenscreens.ai](https://greenscreens.ai) offers a rate intelligence API at lower cost, or Truckstop's Rate Insights API.

### Server-Side Proxy

Market rate lookups go through the server (not client-side) to:
1. Keep API keys secure
2. Cache responses (rates don't change minute-to-minute)
3. Rate-limit to stay within API quotas

**New endpoint:** `POST /api/market-rate`
```json
// Request
{
  "origin": "Toronto, ON",
  "destination": "Montreal, QC",
  "equipmentType": "dry_van"
}

// Response
{
  "averageRate": 3150,
  "lowRate": 2900,
  "highRate": 3400,
  "ratePerMile": 2.45,
  "volume": "medium",
  "trend": "stable",
  "source": "dat",
  "cachedAt": "2026-03-31T12:00:00Z"
}
```

**Cache:** Server-side, 6-hour TTL per lane+equipment combo. Market rates are daily/weekly granularity so aggressive caching is fine.

### Fallback When API Is Unavailable

If the market rate API is down or the carrier doesn't have Premium:
- Show only the internal signal (own history)
- Never block the quoting flow — pricing suggestions are advisory, not required

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `client/src/lib/pricingSuggestion.ts` | Suggestion algorithm (internal + external signals) |
| `client/src/components/PricingSuggestionCard.tsx` | UI component for the suggestion card |
| `server/marketRate.ts` | Market rate API client with caching |

### Modified Files

| File | Change |
|------|--------|
| `client/src/pages/route-builder.tsx` | Add PricingSuggestionCard below pricing section |
| `server/routes.ts` | Add `POST /api/market-rate` endpoint (Premium only) |

### Data Flow

```
Route calculated in route builder
  → laneIntelligence.ts: get internal lane stats
  → If Premium: fetch /api/market-rate → server proxies to DAT API
  → pricingSuggestion.ts: combine signals → suggested price + confidence
  → PricingSuggestionCard renders suggestion
  → "Use This Price" button → sets custom quote amount
```

---

## Tier Gating

| Tier | What They Get |
|------|---------------|
| Free | No pricing suggestions |
| Pro | Internal signal only (own history-based suggestions) |
| Premium | Internal + external market rate data |

This creates a clear upgrade path: Pro users see their own data, Premium users get the full market picture.

---

## Implementation Phases

**Phase 1 (ship first):** Internal signal only — uses Feature 3's lane stats to suggest optimal margin. No external API needed. Works for Pro + Premium.

**Phase 2 (after API partnership):** Add market rate integration. Requires signing a data agreement with DAT or alternative provider. Premium only.

This phased approach lets us ship value immediately while the market data partnership is negotiated.

---

## Edge Cases

1. **New user, no quotes:** No suggestion shown. Fall back to existing margin tiers.
2. **Lane with only lost quotes:** Suggest a price below the average losing price. Low confidence.
3. **Lane with 100% win rate:** User might be under-pricing. Show: "You win every quote on this lane — consider raising your margin."
4. **Market rate significantly different from history:** Show both and let the user decide. Don't auto-blend when the gap is >30%.
5. **Currency mismatch:** Convert all prices to workspace currency before comparison.
6. **Equipment type not available in market data:** Fall back to "all equipment" average rate.

---

## Testing

Unit tests for `pricingSuggestion.ts`:
- Internal signal: optimal margin computed from win/loss distribution
- Confidence levels match sample size thresholds
- Combined signal: weighted average correct when both signals present
- Fallback to internal-only when market data unavailable
- Edge case: 100% win rate triggers "consider raising margin" message
- Edge case: no history returns null suggestion

---

## Out of Scope

- Real-time rate alerts ("rates on your lane just dropped")
- Competitor pricing intelligence
- Automated price adjustment (always advisory, user decides)
- Training a custom ML model (simple heuristics first, ML later if needed)
- Load board integration (separate feature)
