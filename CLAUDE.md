# Bungee Connect — Development Guide

## Stack

React 18 + TypeScript + Vite 5 SPA with hash-based routing (Wouter).
Firebase Auth + Firestore. TanStack React Query for data fetching.
Radix UI (Tooltip, Select, Switch, Dialog) + Tailwind CSS + Lucide icons.
shadcn/ui component library (`client/src/components/ui/`).

## Design Language

Every page and component MUST follow these tokens. The home page
(`client/src/pages/route-builder.tsx`) is the canonical reference.

### Color Palette

| Role | Token | Notes |
|---|---|---|
| Primary text | `text-slate-900` | Headings, values, names |
| Secondary text | `text-slate-500` | Descriptions, labels, hints |
| Tertiary text | `text-slate-400` | Uppercase section labels, timestamps, faint hints |
| Accent | `text-orange-600` | Links, highlighted values, accent text |
| Borders | `border-slate-200` | All card borders, dividers, input borders |
| Light dividers | `border-slate-100` | Inside cards — between rows |
| Backgrounds | `bg-slate-50` | Muted backgrounds, info strips, disabled inputs |
| Primary button | `bg-orange-500 hover:bg-orange-600 text-white` | All primary CTAs |
| Outline button (accent) | `border-orange-300 text-orange-600 hover:bg-orange-50` | Secondary actions |
| Destructive | `text-red-600 border-red-200 hover:bg-red-50` | Delete, sign-out |

**NEVER use semantic design tokens** (`text-muted-foreground`, `border-border`,
`bg-muted`, `text-foreground`, `text-primary`) in page-level code. Use the
explicit slate/orange values above. Semantic tokens are only used inside
`client/src/components/ui/` base components.

### Typography Scale

| Usage | Classes |
|---|---|
| Page title (App.tsx header) | `text-sm font-semibold` |
| Page subtitle | `text-xs text-slate-500` |
| Section headings inside cards | `text-sm font-semibold text-slate-900` |
| Uppercase section labels | `text-[11px] font-semibold text-slate-400 uppercase tracking-wider` |
| Body / field values | `text-sm` or `text-[13px]` |
| Descriptions / captions | `text-xs text-slate-500` |
| Tiny labels / timestamps | `text-[11px] text-slate-400` |
| Badge text | `text-[10px]` |
| Footer | `text-[11px] text-slate-400` |

### Spacing

| Context | Value |
|---|---|
| Page-level gap between sections | `space-y-3` |
| Card internal content | `space-y-2.5` |
| Grid gaps | `gap-3` |
| Inline element gaps | `gap-2` |

### Card Anatomy

All cards use `<Card className="border-slate-200">` as the wrapper.

```
CardHeader:  className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2"
CardContent: className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0"
```

For cards with no header:
```
CardContent: className="p-3 sm:p-4"
```

**NEVER** use the default `p-6` card padding. It is too wide for this app.

### Input Fields

| Size | Classes | Use |
|---|---|---|
| Small | `h-7 text-[11px]` or `h-7 text-xs` | Header controls, inline selects |
| Medium | `h-8 text-xs` | Accessorial inputs, compact forms |
| Standard | `h-9 text-sm` | Main form inputs |

### Buttons

| Type | Classes |
|---|---|
| Primary | `bg-orange-500 hover:bg-orange-600 text-white` |
| Outline (accent) | `variant="outline" border-orange-300 text-orange-600 hover:bg-orange-50` |
| Ghost | `variant="ghost"` |
| Destructive outline | `variant="outline" text-red-600 border-red-200 hover:bg-red-50` |

Always use `size="sm"` for action buttons inside cards.

### Icons

Use Lucide icons exclusively. Standard size: `w-4 h-4`.
Small inline: `w-3 h-3` or `w-3.5 h-3.5`.
Icon color in section headings: `text-orange-500`.
Icon color in form rows: `text-slate-500`.

### Tabs

```
Container: flex gap-1 border-b border-slate-200
Tab button: px-3 py-2 text-xs font-medium border-b-2 -mb-px
Active:     border-orange-500 text-slate-900
Inactive:   border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300
```

### Tooltips (Info Bubbles)

Use `<Tooltip>` + `<TooltipTrigger>` + `<TooltipContent>` from Radix.
Trigger is always `<Info className="w-3 h-3 text-slate-400 cursor-help" />`.
Content: `className="max-w-[220px] text-xs"`.

### Do NOT

- Use `text-lg`, `text-xl`, `text-2xl` for headings inside cards or page sections
- Use `p-6` or `px-6` padding on cards (too wide)
- Use `space-y-6` or `gap-6` (too much breathing room)
- Use semantic tokens (`text-muted-foreground`, `border-border`, `bg-muted`) outside of `components/ui/`
- Add redundant section labels above cards when the card already has its own title
- Use `CA$` prefix — currency is shown in the header badge; use plain `$`
- Use emoji as icons — use Lucide SVG icons only

## Industry Terminology

| Term | Notes |
|---|---|
| Dock Time | Not "Load/Unload". Time spent at loading/unloading docks. |
| Surcharge | Not "Inflation". Hazmat, regulatory, or seasonal percentage on base cost. |
| Deadhead | Empty miles from yard to first pickup or from last delivery back to yard. |
| Detention | Waiting time charges beyond free dock time allowance. |
| TONU | Truck Ordered Not Used — cancellation fee. |
| Lumper | Third-party loading/unloading labor fee. |

## Geocoding

The server uses Nominatim with `countrycodes=us,ca` bias by default.
All geocoding goes through `/api/geocode` which accepts optional `countrycodes`
query param. This prevents ambiguous city names (e.g. "Aberdeen") from resolving
to non-North American locations.

## Fuel Pricing

Default fuel price comes from EIA (U.S. Energy Information Administration)
weekly diesel data, cached client-side for 24 hours. Users can override
manually; manual overrides persist in localStorage for 7 days. The initial
default uses `getFuelPricesSync()` to avoid showing a stale hardcoded value
before the async EIA fetch completes.

## Pre-existing TypeScript Errors (safe to ignore)

- `FeedbackSheet.tsx(70)`: `Record<string, unknown>` not assignable to `AppUser`
- `currency.ts(105)`: `MXN` not in `SupportedCurrency`

These are known and do not affect runtime behavior.
