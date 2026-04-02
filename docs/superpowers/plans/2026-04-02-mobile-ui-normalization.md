# Mobile UI Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize 11 font sizes → 4, standardize touch target heights, and consolidate padding/gap/spacing values across the mobile baseline in `route-builder.tsx` and `App.tsx`.

**Architecture:** Mobile-first Tailwind CSS means base (non-prefixed) classes apply at all breakpoints unless overridden by `sm:` variants. We only touch base classes — never `sm:` classes. Desktop layout is preserved because `sm:` overrides remain unchanged.

**Tech Stack:** Tailwind CSS class substitution in React/TSX files. No logic changes, no JSX restructuring.

---

## Files Modified

| File | Responsibility |
|---|---|
| `client/src/pages/route-builder.tsx` | Main page — all quote builder UI |
| `client/src/App.tsx` | App shell — mobile nav, sidebar fav lanes |
| `CHANGELOG-v1.4.01.md` | Record the changes |
| `CLAUDE.md` | Update mobile design token docs |

---

## Token Map (reference for all tasks)

### Font Sizes
| Old | New | Rule |
|---|---|---|
| `text-[9px]` | `text-[10px]` | Tiny labels → 10px minimum |
| `text-[11px]` | `text-xs` | Most labels/captions → 12px |
| `text-[12px]` | `text-xs` | Consolidate with text-xs |
| `text-[13px]` | `text-sm` | Body/values → 14px |
| `text-[15px]` | `text-sm` | Route title → 14px |

**Preserve:** `sm:text-[11px]`, `sm:text-[13px]` (sm: overrides untouched)

### Heights (interactive elements only)
| Old | New | Rule |
|---|---|---|
| Any tappable element at `h-7` | `h-8` | Minimum 32px touch target (except ± adjuster pairs) |
| Primary inputs / action buttons | `h-9` | 36px for primary actions |

**Exceptions:** Drive/dock time `−` `+` adjuster buttons keep `h-7 w-7`.

### Padding
| Old | New |
|---|---|
| `px-2.5` | `px-3` |
| `px-3.5` | `px-3` |
| `px-5` | `px-4` |
| `px-6` | `px-4` |

### Gaps
| Old | New |
|---|---|
| `gap-0.5` | `gap-1` |
| `gap-1.5` | `gap-2` |
| `gap-2.5` | `gap-2` |

### Vertical Padding
| Old | New |
|---|---|
| `py-1.5` | `py-2` |
| `py-2.5` | `py-2` |

### Space-Y
| Old | New |
|---|---|
| `space-y-0.5` | `space-y-1` |
| `space-y-2.5` | `space-y-2` |

### Border Radius
| Old | New |
|---|---|
| `rounded` (no suffix, standalone) | `rounded-md` |
| `rounded-xl` | `rounded-lg` |

---

### Task 1: Font Size Normalization — route-builder.tsx

**Files:**
- Modify: `client/src/pages/route-builder.tsx`

- [ ] **Step 1: Verify current counts**

```bash
grep -c 'text-\[9px\]\|text-\[11px\]\|text-\[12px\]\|text-\[13px\]\|text-\[15px\]' client/src/pages/route-builder.tsx
```

Expected: ~64 total matches.

- [ ] **Step 2: Replace text-[9px] → text-[10px]**

Use sed or editor find-and-replace. Only replace standalone occurrences (not `sm:text-[9px]`).

```bash
sed -i '' 's/\btext-\[9px\]/text-[10px]/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 3: Replace text-[11px] → text-xs (skip sm: occurrences)**

```bash
# Replace standalone text-[11px] (not preceded by sm:)
sed -i '' 's/\btext-\[11px\]/text-xs/g' client/src/pages/route-builder.tsx
```

Verify no `sm:text-xs` was created where `sm:text-[11px]` should remain:
```bash
grep 'sm:text-xs' client/src/pages/route-builder.tsx
```
If any appear where `sm:text-[11px]` was intended, restore them manually.

- [ ] **Step 4: Replace text-[12px] → text-xs**

```bash
sed -i '' 's/\btext-\[12px\]/text-xs/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 5: Replace text-[13px] → text-sm**

```bash
sed -i '' 's/\btext-\[13px\]/text-sm/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 6: Replace text-[15px] → text-sm**

```bash
sed -i '' 's/\btext-\[15px\]/text-sm/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 7: Verify no banned sizes remain in mobile baseline**

```bash
grep -n 'text-\[9px\]\|text-\[11px\]\|text-\[12px\]\|text-\[13px\]\|text-\[15px\]' client/src/pages/route-builder.tsx
```

Expected: only lines with `sm:` prefix (if any exist). Zero standalone occurrences.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/route-builder.tsx
git commit -m "style(mobile): normalize font sizes in route-builder — 11 sizes → 4"
```

---

### Task 2: Font Size Normalization — App.tsx

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Check counts**

```bash
grep -c 'text-\[9px\]\|text-\[11px\]\|text-\[12px\]\|text-\[13px\]\|text-\[15px\]' client/src/App.tsx
```

- [ ] **Step 2: Apply all font size replacements**

```bash
sed -i '' 's/\btext-\[9px\]/text-[10px]/g; s/\btext-\[11px\]/text-xs/g; s/\btext-\[12px\]/text-xs/g; s/\btext-\[13px\]/text-sm/g; s/\btext-\[15px\]/text-sm/g' client/src/App.tsx
```

- [ ] **Step 3: Verify**

```bash
grep -n 'text-\[9px\]\|text-\[11px\]\|text-\[12px\]\|text-\[13px\]\|text-\[15px\]' client/src/App.tsx
```

Expected: zero standalone occurrences.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "style(mobile): normalize font sizes in App.tsx"
```

---

### Task 3: Element Height Normalization — route-builder.tsx

**Files:**
- Modify: `client/src/pages/route-builder.tsx`

Context: The `h-7 w-7` adjuster button pairs (drive time − / + and dock time − / +) must stay at `h-7 w-7`. All other tappable `h-7` elements upgrade to `h-8`. Identify these by searching for `h-7` in context.

- [ ] **Step 1: Find all h-7 occurrences**

```bash
grep -n 'h-7' client/src/pages/route-builder.tsx
```

Review the list. Lines with `h-7 w-7` are the ±adjuster buttons — leave those. Any other `h-7` on a tappable element (button, input, select) → change to `h-8`.

- [ ] **Step 2: Apply targeted height upgrades**

For each non-adjuster `h-7` found, use the Edit tool to change `h-7` → `h-8` on that specific line. Do NOT use global sed (would break adjuster buttons).

- [ ] **Step 3: Verify adjuster buttons are still h-7 w-7**

```bash
grep -n 'w-7' client/src/pages/route-builder.tsx
```

Expected: all `h-7 w-7` occurrences intact (drive time and dock time adjusters).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/route-builder.tsx
git commit -m "style(mobile): raise tappable element minimum height to h-8"
```

---

### Task 4: Padding Normalization — route-builder.tsx + App.tsx

**Files:**
- Modify: `client/src/pages/route-builder.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace px-2.5 → px-3 in route-builder.tsx**

```bash
sed -i '' 's/\bpx-2\.5\b/px-3/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 2: Replace px-3.5 → px-3 in route-builder.tsx**

```bash
sed -i '' 's/\bpx-3\.5\b/px-3/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 3: Replace px-5 → px-4 in route-builder.tsx (standalone only)**

```bash
sed -i '' 's/\bpx-5\b/px-4/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 4: Replace px-6 → px-4 in route-builder.tsx (standalone only, skip sm:px-6)**

```bash
sed -i '' 's/\bpx-6\b/px-4/g' client/src/pages/route-builder.tsx
```

Verify: `grep 'sm:px-4' client/src/pages/route-builder.tsx` — if `sm:px-6` was replaced with `sm:px-4`, revert those occurrences.

- [ ] **Step 5: Apply same padding replacements to App.tsx**

```bash
sed -i '' 's/\bpx-2\.5\b/px-3/g; s/\bpx-3\.5\b/px-3/g; s/\bpx-5\b/px-4/g; s/\bpx-6\b/px-4/g' client/src/App.tsx
```

- [ ] **Step 6: Verify no banned padding remains**

```bash
grep -n 'px-2\.5\|px-3\.5\|px-5\b\|px-6\b' client/src/pages/route-builder.tsx client/src/App.tsx
```

Expected: zero standalone occurrences (sm: variants are fine).

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/route-builder.tsx client/src/App.tsx
git commit -m "style(mobile): standardize horizontal padding to 3 values"
```

---

### Task 5: Gap, Vertical Padding, and Space-Y Normalization

**Files:**
- Modify: `client/src/pages/route-builder.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace gap values in route-builder.tsx**

```bash
sed -i '' 's/\bgap-0\.5\b/gap-1/g; s/\bgap-1\.5\b/gap-2/g; s/\bgap-2\.5\b/gap-2/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 2: Replace py values in route-builder.tsx**

```bash
sed -i '' 's/\bpy-1\.5\b/py-2/g; s/\bpy-2\.5\b/py-2/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 3: Replace space-y values in route-builder.tsx**

```bash
sed -i '' 's/\bspace-y-0\.5\b/space-y-1/g; s/\bspace-y-2\.5\b/space-y-2/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 4: Apply same to App.tsx**

```bash
sed -i '' 's/\bgap-0\.5\b/gap-1/g; s/\bgap-1\.5\b/gap-2/g; s/\bgap-2\.5\b/gap-2/g; s/\bpy-1\.5\b/py-2/g; s/\bpy-2\.5\b/py-2/g; s/\bspace-y-0\.5\b/space-y-1/g; s/\bspace-y-2\.5\b/space-y-2/g' client/src/App.tsx
```

- [ ] **Step 5: Verify no banned values remain**

```bash
grep -n 'gap-0\.5\|gap-1\.5\|gap-2\.5\|py-1\.5\|py-2\.5\|space-y-0\.5\|space-y-2\.5' client/src/pages/route-builder.tsx client/src/App.tsx
```

Expected: zero matches.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/route-builder.tsx client/src/App.tsx
git commit -m "style(mobile): standardize gap, py, and space-y to 3 values each"
```

---

### Task 6: Border Radius Normalization

**Files:**
- Modify: `client/src/pages/route-builder.tsx`
- Modify: `client/src/App.tsx`

Note: `rounded` (bare, no suffix) in Tailwind means 4px. We replace it with `rounded-md` (6px). Use word-boundary-aware replacement: `rounded` not followed by `-`.

- [ ] **Step 1: Replace rounded-xl → rounded-lg in route-builder.tsx**

```bash
sed -i '' 's/\brounded-xl\b/rounded-lg/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 2: Replace bare rounded → rounded-md in route-builder.tsx**

The bare `rounded` class appears as `rounded ` (space), `rounded"`, `rounded'` but NOT `rounded-*`. Use careful replacement:

```bash
sed -i '' 's/\brounded\b/rounded-md/g' client/src/pages/route-builder.tsx
```

- [ ] **Step 3: Verify — no rounded-md-* or double replacements**

```bash
grep -n 'rounded-md-\|rounded-md-md' client/src/pages/route-builder.tsx
```

Expected: zero matches (the replacement must not have double-applied).

- [ ] **Step 4: Apply to App.tsx**

```bash
sed -i '' 's/\brounded-xl\b/rounded-lg/g; s/\brounded\b/rounded-md/g' client/src/App.tsx
grep -n 'rounded-md-\|rounded-md-md' client/src/App.tsx
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/route-builder.tsx client/src/App.tsx
git commit -m "style(mobile): standardize border radius to rounded-md / rounded-lg"
```

---

### Task 7: Success Criteria Verification

**Files:**
- Read: `client/src/pages/route-builder.tsx`
- Read: `client/src/App.tsx`

- [ ] **Step 1: Font size check**

```bash
grep -n 'text-\[9px\]\|text-\[11px\]\|text-\[12px\]\|text-\[13px\]\|text-\[15px\]' client/src/pages/route-builder.tsx client/src/App.tsx
```

Expected: zero lines without `sm:` prefix.

- [ ] **Step 2: Height check — confirm no bare tappable h-7**

```bash
grep -n '\bh-7\b' client/src/pages/route-builder.tsx
```

Expected: only lines that also contain `w-7` (the ± adjuster buttons).

- [ ] **Step 3: Spacing check**

```bash
grep -n 'px-2\.5\|px-3\.5\|px-5\b\|px-6\b\|gap-0\.5\|gap-1\.5\|gap-2\.5\|py-1\.5\|py-2\.5\|space-y-0\.5\|space-y-2\.5' client/src/pages/route-builder.tsx client/src/App.tsx
```

Expected: zero standalone (non-`sm:`) occurrences.

- [ ] **Step 4: Visual check in browser**

Run `npm run dev` and open `http://localhost:5555` on mobile viewport (375px). Confirm:
- Text is readable (no 9px text)
- Buttons are tappable (not cramped)
- Layout structure is identical to before

- [ ] **Step 5: Update CHANGELOG**

Add entry 17 to `CHANGELOG-v1.4.01.md`:

```markdown
### 17. Mobile UI Normalization — Token Cleanup
**Files:** `client/src/pages/route-builder.tsx`, `client/src/App.tsx`

- Collapsed 11 font sizes → 4: `text-[9px]`→`text-[10px]`, `text-[11px]`/`text-[12px]`→`text-xs`, `text-[13px]`/`text-[15px]`→`text-sm`; display prices (`text-base`/`text-lg`/`text-2xl`) unchanged.
- Raised minimum tappable element height to `h-8` (32px); primary inputs and action buttons at `h-9` (36px). Drive/dock time ± adjuster pairs remain `h-7 w-7`.
- Standardized horizontal padding to 3 values: `px-2` / `px-3` / `px-4`.
- Standardized gap to 3 values: `gap-1` / `gap-2` / `gap-3`.
- Standardized vertical padding to 3 values: `py-1` / `py-2` / `py-3`.
- Standardized `space-y` to 3 values: `space-y-1` / `space-y-2` / `space-y-3`.
- Standardized border radius to 2 values: `rounded-md` / `rounded-lg`.
- Desktop (`sm:`) layout unchanged.
```

- [ ] **Step 6: Update CLAUDE.md typography scale**

Update the Typography Scale table in `CLAUDE.md` to reflect the new mobile baseline tokens:

```markdown
| Uppercase section labels | `text-[10px] font-semibold text-slate-400 uppercase tracking-wider` |
| Body / field values | `text-sm` |
| Descriptions / captions | `text-xs text-slate-500` |
| Tiny labels / timestamps | `text-xs text-slate-400` |
| Badge text | `text-[10px]` |
```

- [ ] **Step 7: Final commit**

```bash
git add CHANGELOG-v1.4.01.md CLAUDE.md
git commit -m "docs: update CHANGELOG and CLAUDE.md for mobile UI normalization"
```
