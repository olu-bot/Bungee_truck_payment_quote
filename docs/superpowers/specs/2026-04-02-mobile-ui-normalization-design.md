# Mobile UI Normalization — Design Spec
**Date:** 2026-04-02
**Scope:** Mobile baseline only (no `sm:` breakpoint changes)
**Files:** `client/src/pages/route-builder.tsx`, `client/src/App.tsx`

---

## Problem

The mobile UI has 67 distinct sizing classes across 463 uses:
- **11 font sizes** (text-[9px] through text-2xl) — a professional mobile UI uses 3–4
- **11 element heights** (h-2.5 through h-9) — inconsistent touch targets
- **9 horizontal padding values** — no rhythm
- **7 gap values** — spacing feels random

Result: fonts are too small to read comfortably, interactive elements are cramped, and the page feels like a compressed desktop rather than a designed mobile experience.

---

## Approach: Token Cleanup (Approach A)

Normalize to a consistent design token set. **No layout changes.** Same structure, same sections, same element positions — only sizes, fonts, and spacing are updated.

---

## Design Tokens

### Type Scale (11 sizes → 4)

| Token | Size | Mobile use |
|-------|------|------------|
| `text-[10px]` | 10px | Section labels (COST, CHARGES), tier % badges (20%, 30%), "Coming Soon" chips |
| `text-xs` | 12px | Sublabels, captions, stats row, helper text, note placeholder, form field labels |
| `text-sm` | 14px | Button labels (Won/Pending/Lost), input values, field labels (Dock Time, Surcharge), route title |
| `text-base` / `text-lg` / `text-2xl` | 16px+ | Price displays — keep as-is, intentionally large |

**Replacements:**
- `text-[9px]` → `text-[10px]`
- `text-[10px]` (non-badge uses, e.g. body text) → `text-xs`
- `text-[11px]` → `text-xs`
- `text-[12px]` → `text-xs`
- `text-[13px]` → `text-sm`
- `text-[15px]` → `text-sm`

### Element Heights (interactive elements only)

| Token | Size | Use |
|-------|------|-----|
| `h-7` | 28px | Icon-only buttons, secondary compact controls |
| `h-8` | 32px | Secondary inputs (surcharge %, small fields), tab buttons (Per Hour/Per KM/Breakdown) |
| `h-9` | 36px | Primary inputs (dock time, your quote, stop location inputs), main action buttons |

**Rule:** All tappable interactive elements are `h-8` minimum. Primary inputs and action buttons are `h-9`.
**Exception:** Drive/dock time adjuster buttons (± pairs in the Breakdown section) stay at `h-7 w-7` — they are compact paired controls always used together, not standalone tap targets.
**Do not change:** Icon sizes (w-3, h-3, w-4, h-4, etc.) — these are decorative, not tappable.

### Spacing System

**Padding (horizontal):** Standardize to 3 values
- `px-2` — tight inline elements (chips, badges)
- `px-3` — card content, section inner padding
- `px-4` — card outer padding, section containers

Remove arbitrary values: `px-2.5` → `px-3`, `px-3.5` → `px-3`, `px-5` → `px-4`, `px-6` → `px-4`

**Gap:** Standardize to 3 values
- `gap-1` — icon + label rows, tight inline groups
- `gap-2` — element groups within a form row
- `gap-3` — between distinct form rows/sections

Remove: `gap-0.5` → `gap-1`, `gap-1.5` → `gap-2`, `gap-2.5` → `gap-2`

**Space-y:** Standardize to 3 values
- `space-y-1` — very tight stacks (items within a single control)
- `space-y-2` — card content rows
- `space-y-3` — between card sections

Remove: `space-y-0.5` → `space-y-1`, `space-y-2.5` → `space-y-2`

**Padding (vertical):** Standardize to 3 values
- `py-1` — compact chips and badges
- `py-2` — standard interactive elements
- `py-3` — section/card containers

Remove: `py-1.5` → `py-2`, `py-2.5` → `py-2`

### Border Radius

Standardize to 2 values:
- `rounded-md` — inputs, chips, small controls
- `rounded-lg` — cards, buttons, section containers

Remove: `rounded` (no suffix) → `rounded-md`, `rounded-xl` → `rounded-lg`

---

## Section-by-Section Changes

### Quote Summary Card
- Route title: `text-sm` (currently `text-[15px]`)
- Stats row (km · drive · dock): `text-xs` (currently `text-[11px]`)
- Tier % labels (20%, 30%, 40%): `text-[10px]` (currently `text-[9px]`)
- Price values: keep `text-xl` / `text-2xl`
- "YOUR QUOTE" label: `text-[10px]` uppercase (currently `text-[10px]` — already ok)
- Quote input: `h-9 text-sm`
- Won/Pending/Lost buttons: `h-9 text-sm`
- Note textarea: `text-sm`

### Cost Section
- "COST" section label: `text-[10px]` uppercase
- Per Hour / Per KM / Breakdown tabs: `h-8 text-xs`
- Dock Time / Surcharge labels: `text-xs`
- Dock Time / Surcharge inputs: `h-8 text-sm`
- "hrs" / "%" suffixes: `text-xs`
- Deadhead label: `text-xs`
- "CHARGES" label: `text-[10px]` uppercase
- "Show" / "Adjust Defaults" links: `text-xs`
- Accessorial field labels: `text-xs`
- Accessorial inputs: `h-8 text-sm`

### Build Route Form
- Stop inputs (Origin/Stop/Destination): `h-9 text-sm`
- Stop type labels: `text-xs`
- "+ Add Stop" button: `h-8 text-xs`
- Drag handle: keep icon size

### Route Chat
- Section header "ROUTE CHAT": `text-[10px]` uppercase
- "Minimize" link: `text-xs`
- Chat message text: `text-sm`
- Input placeholder: `text-sm`
- Send button: `h-9 text-sm`
- Suggestion chips: `text-xs`

### Breakdown Section
- Leg header labels: `text-[10px]` uppercase
- Row labels (Drive time, Dock Time, etc.): `text-xs`
- Row values: `text-sm`
- Adjuster buttons (− and +): `h-7 w-7` (keep compact — they're paired with text)

### App.tsx Mobile Nav
- Nav item labels: `text-xs`
- Favorite lane entries: `text-xs`
- Section headers: `text-[10px]` uppercase

---

## Out of Scope
- Desktop layout (`sm:` and above) — untouched
- Functional behavior — no logic changes
- Component structure — no JSX restructuring
- CLAUDE.md design tokens — will update to reflect new mobile baseline

---

## Success Criteria
1. No `text-[9px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[15px]` remain in mobile baseline
2. All tappable interactive elements ≥ `h-8` (32px)
3. No `px-2.5`, `px-3.5`, `px-5`, `gap-0.5`, `gap-1.5`, `gap-2.5`, `py-1.5`, `py-2.5`, `space-y-0.5`, `space-y-2.5` in mobile baseline
4. Desktop (`sm:`) layout unchanged and visually identical to current
