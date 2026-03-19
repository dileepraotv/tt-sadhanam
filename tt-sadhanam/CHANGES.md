# TT-SADHANAM — UI/UX Consistency Patch

**Date:** March 2026  
**Scope:** 14 files changed (13 modified + 1 new), 0 schema changes, 0 dependency changes  
**Based on:** Full UI/UX consistency review findings

---

## Summary of Changes

All fixes address issues identified in the design systems audit. Every change is
backward-compatible — no database migrations, no new dependencies, no breaking API
changes are required.

---

## New Files

### `src/components/shared/FormatTypeBadge.tsx` *(new)*

**Problem:** The format-type badge ("Singles · Knockout", "Teams · Corbillon KO", etc.)
was implemented inline in four separate page files, with different labels, different font
sizes, and different color classes for the same format. `pure_round_robin` was labeled
"Singles - Round Robin" in one file and "Singles - League" in another.

**Fix:** Single canonical shared component. Two size variants (`size="sm"` | `"md"`).
One authoritative label string per format type. One import, used everywhere.

**Files it replaces:** The inline `FormatTypeBadge` / `FormatTypeLabel` functions that
were previously defined inside:
- `admin/championships/[cid]/events/[eid]/page.tsx`
- `admin/championships/[cid]/page.tsx`
- `admin/tournaments/[id]/page.tsx`
- `championships/[cid]/page.tsx`

---

## Modified Files

### `src/components/shared/MatchUI.tsx`

**Problem:** No shared color tokens for winner/loser state. Each component hard-coded
its own Tailwind classes, leading to orange winners in one card and emerald winners
in another.

**Fix:** Added six exported design-token constants:

| Token | Value |
|-------|-------|
| `WINNER_NAME_CLS` | `font-bold text-emerald-600 dark:text-emerald-400` |
| `WINNER_SCORE_CLS` | `font-bold tabular-nums text-emerald-600 dark:text-emerald-400` |
| `LOSER_NAME_CLS` | `font-normal text-muted-foreground` |
| `LOSER_SCORE_CLS` | `tabular-nums text-muted-foreground/50` |
| `GAME_CHIP_WIN_CLS` | orange chip (won game) |
| `GAME_CHIP_LOSS_CLS` | muted chip (lost game) |

**Rule encoded:** Orange = LIVE/ACTIVE only. Emerald = WINNER/COMPLETE state.

`MatchStatusBadge` updated: live state now renders `<LiveBadge />` (the shared
component), complete state renders `✓ Done` in emerald. Replaces the private
`StatusPill` in `PublicMatchCard` and the inline spans in `MatchCard` /
`TeamMatchCard`.

---

### `src/components/bracket/MatchCard.tsx`

**Changes:**
- Player name size: `text-[15px]` → `text-base` (17 px, matches `PublicMatchCard`)
- Winner/loser name and score classes now use `WINNER_NAME_CLS` / `LOSER_NAME_CLS` etc.
- Status badge now uses `<MatchStatusBadge>` instead of three separate inline spans
- Game chip classes now use `GAME_CHIP_WIN_CLS` / `GAME_CHIP_LOSS_CLS`

---

### `src/components/public/PublicMatchCard.tsx`

**Changes (most impactful):**
- `🏆` emoji → `<WinnerTrophy>` (Lucide component, consistent cross-platform rendering)
- Private `StatusPill` component → `<MatchStatusBadge>` shared component
- Winner sets-won color: was `text-orange-600` (conflict with live/active semantic) → now `WINNER_SCORE_CLS` (emerald)
- Completed match: was no opacity → now `opacity-40` (same as admin `MatchCard`)
- Live match: added `bg-orange-50/30 dark:bg-orange-950/10` background tint (matches `MatchCard`)
- Round label: was `MD ${match.round}` → now `Round ${match.round}` (standardized terminology)

---

### `src/components/team/TeamMatchCard.tsx`

**Changes:**
- Completed match opacity: `opacity-90` → `opacity-40` (standardized — was barely visible)
- Live match: added `bg-orange-50/30 dark:bg-orange-950/10` background tint
- Status indicator now uses `<MatchStatusBadge>` (replaces `<LiveBadge>`)
- Removed redundant inline `{isDone && <span>Done</span>}` — `MatchStatusBadge` handles this

---

### `src/app/admin/championships/[cid]/events/[eid]/page.tsx`

**Change:** Removed 77-line inline `FormatTypeBadge` function. Replaced with:
```tsx
import { FormatTypeBadge } from '@/components/shared/FormatTypeBadge'
```
Removed unused icon imports (`Layers`, `Swords`, `Users`).

---

### `src/app/admin/championships/[cid]/page.tsx`

**Change:** Removed 23-line inline `FormatTypeLabel` function (which used "Singles - League"
for `pure_round_robin` — inconsistent with all other pages). Replaced with:
```tsx
import { FormatTypeBadge } from '@/components/shared/FormatTypeBadge'
// ...
<FormatTypeBadge formatType={ev.format_type} size="sm" />
```
Removed unused icon imports (`Layers`, `Swords`, `Users`).

---

### `src/app/admin/tournaments/[id]/page.tsx`

**Change:** Removed inline `FormatTypeBadge` (used a color-map object, different approach
from the other three implementations, also missing `team_league_swaythling` and
`team_group_*` variants). Replaced with shared import.

---

### `src/app/championships/[cid]/page.tsx`

**Change:** Removed inline `FormatTypeBadge` (used `text-[9px]` — smaller than all other
implementations, and used abbreviated labels like "Corbillon" instead of full labels).
Replaced with shared import.  
Removed unused icon imports (`Layers`, `Swords`, `Users`).

---

### `src/app/admin/championships/[cid]/events/[eid]/match/[mid]/page.tsx`

**Problem:** The championship match scoring page rendered `<MatchScoringClient>` directly
with no app chrome — no header bar, no logo, no breadcrumb. An admin scoring a live match
was in a visually disconnected, navigation-free environment.

**Fix:** Wrapped `MatchScoringClient` in a full-page layout:
```tsx
<div className="min-h-screen flex flex-col">
  <Header isAdmin user={user} />
  <Breadcrumb
    variant="admin"
    items={[
      { label: 'My Championships',  href: '/admin/championships' },
      { label: champ.name,          href: `/admin/championships/${cid}` },
      { label: ev.name,             href: backHref },
      { label: roundLabel },        // e.g. "Semi-Final" or "Round 3"
    ]}
  />
  <main className="flex-1">
    <MatchScoringClient ... />
  </main>
</div>
```
Also updated the championships query to fetch `name` (needed for breadcrumb).

---

### `src/app/admin/tournaments/[id]/match/[matchId]/page.tsx`

**Problem:** Same issue as above — standalone tournament match scoring page had no app
chrome.

**Fix:** Same wrapper pattern with a 3-level breadcrumb:
```
Championships → {tournament.name} → {roundLabel}
```

---

### `src/app/tournaments/[id]/client.tsx`

**Problem:** The public standalone tournament page breadcrumb showed only the tournament
name with no parent link — a visitor couldn't navigate back to any listing.

**Fix:** Added `Championships` as a parent breadcrumb item:
```tsx
items={[
  { label: 'Championships', href: '/championships' },
  { label: tournament.name },
]}
```

---

### `src/components/shared/RubberScorer.tsx`

**Problem:** Contained a local `validateTTScore` function that reimplemented TT scoring
rules from scratch, duplicating `validateGameScore` in `lib/scoring/engine.ts`. The two
implementations had different deuce-error message wording and could silently diverge.

**Fix:**
1. Deleted `validateTTScore` and the `// Validation` section
2. Added imports:
   ```ts
   import { validateGameScore, formatValidationErrors } from '@/lib/scoring/engine'
   ```
3. Added a thin bridge function `validateScore(s1, s2): string | null` that adapts
   the engine's `ValidationResult` shape to the `string | null` the call sites expect
4. Updated both call sites from `validateTTScore(s1, s2)` → `validateScore(s1, s2)`

The actual validation logic now lives in exactly one place: `lib/scoring/engine.ts`.

---

### `src/components/admin/stages/TeamGroupKOStage.tsx`

**Change:** Removed `validateTTScore` from the import statement (it was imported but
never called — was a stale reference). Updated the comment on the `RubberScorer` section.

---

## Design Rules Established

These changes encode the following rules into shared components and tokens:

| Rule | Token / Component |
|------|-------------------|
| Orange = live/active state only | `LIVE_CARD` in `matchStatusClasses`, `LiveBadge` |
| Emerald = winner/complete state | `WINNER_NAME_CLS`, `WINNER_SCORE_CLS` |
| Orange game chip = won game | `GAME_CHIP_WIN_CLS` |
| Completed match = `opacity-40` | Applied in `MatchCard`, `PublicMatchCard`, `TeamMatchCard` |
| Live match = orange border + bg tint | Applied in all three match card types |
| Status badge = `<MatchStatusBadge>` | Single component, replaces 3 inline implementations |
| Trophy = `<WinnerTrophy>` | Never emoji |
| Format badge = `<FormatTypeBadge>` | Single component, 4 inline copies removed |
| Scoring pages have app chrome | `<Header>` + `<Breadcrumb>` on all admin scoring routes |
| Validation = `validateGameScore` | Single source in `lib/scoring/engine.ts` |

---

## What Was NOT Changed

- No schema changes
- No new npm dependencies  
- No changes to scoring logic (server actions, engine, RR standings)
- No changes to Realtime hook or API layer
- No changes to `globals.css` design tokens (they were already correct)
- `MatchScoringClient` component itself is unchanged — only its page wrappers gained
  `Header` + `Breadcrumb`
