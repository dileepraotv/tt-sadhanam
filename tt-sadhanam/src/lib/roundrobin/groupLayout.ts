/**
 * groupLayout.ts
 *
 * Pure helpers for computing how many groups to create and how large each one
 * should be, given a player/team count and a target group size (PPG).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE: "Fill then spill — never shrink below the target size"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Given N members and a target size PPG:
 *
 *   numGroups  = max(1, floor(N / PPG))
 *
 * Players / teams are then distributed across exactly numGroups groups.
 * Every group receives either floor(N / numGroups) or ceil(N / numGroups)
 * members. Because numGroups = floor(N/PPG):
 *
 *   floor(N / numGroups) ≥ PPG  always
 *
 * so NO group ever has fewer than PPG members.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-bucket breakdown
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   small      = floor(N / numGroups)
 *   large      = ceil(N / numGroups)   = small + 1  (unless N % numGroups === 0)
 *   largeCount = N mod numGroups
 *   smallCount = numGroups - largeCount
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Examples
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   46 players, PPG 3  →  15 groups:  14 of 3 · 1 of 4            ✓
 *   45 players, PPG 3  →  15 groups:  15 of 3                     ✓
 *    7 players, PPG 3  →   2 groups:   1 of 3 · 1 of 4            ✓
 *    5 players, PPG 3  →   1 group:    1 of 5   (can't form 2×3)  ✓
 *    4 players, PPG 4  →   1 group:    1 of 4                     ✓
 *    8 players, PPG 4  →   2 groups:   2 of 4                     ✓
 *    9 players, PPG 4  →   2 groups:   1 of 4 · 1 of 5            ✓
 *   13 players, PPG 5  →   2 groups:   1 of 6 · 1 of 7            ✓
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Snake seeding (see snakeAssign)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Members are placed using a snake / zigzag so top seeds land in different groups:
 *
 *   Pass 1 →  G1  G2  G3  G4  G5       (seeds 1–5)
 *   Pass 2 ←  G5  G4  G3  G2  G1       (seeds 6–10)
 *   Pass 3 →  G1  G2  G3  G4  G5       (seeds 11–15)
 *   …
 *
 * The turning-point groups naturally accumulate the extra member when N is not
 * divisible by numGroups — no explicit overflow step needed.
 *
 * Future use: pass teams instead of players (same arithmetic + same snake).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupLayoutResult {
  /** Total number of groups */
  numGroups:    number
  /** Groups that receive exactly `smallSize` members */
  smallCount:   number
  /** Groups that receive `largeSize` members (= smallSize + 1) */
  largeCount:   number
  /** The smaller group size = floor(N / numGroups) ≥ PPG */
  smallSize:    number
  /** The larger group size = ceil(N / numGroups) */
  largeSize:    number
  // ── Legacy aliases so existing call-sites compile without changes ──────────
  /** @deprecated use smallCount */
  exactCount:   number
  /** @deprecated use largeCount */
  overflowCount: number
  /** @deprecated use smallSize */
  targetSize:   number
}

// ─────────────────────────────────────────────────────────────────────────────
// computeGroupLayout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the group layout for `totalMembers` players/teams with target group
 * size `ppg` (minimum 2).
 *
 * Safe to call on every render — purely functional, no side-effects.
 */
export function computeGroupLayout(
  totalMembers: number,
  ppg:          number,
): GroupLayoutResult {
  const targetPPG  = Math.max(2, ppg)
  const numGroups  = Math.max(1, Math.floor(totalMembers / targetPPG))

  // Use floor/ceil of actual distribution so the result is always valid,
  // even when totalMembers % targetPPG >= numGroups (edge cases with small N).
  const smallSize  = Math.floor(totalMembers / numGroups)
  const largeSize  = Math.ceil(totalMembers / numGroups)   // = smallSize when exact
  const largeCount = totalMembers % numGroups               // # of large groups
  const smallCount = numGroups - largeCount                 // # of small groups

  return {
    numGroups,
    smallCount,
    largeCount,
    smallSize,
    largeSize,
    // Legacy aliases
    exactCount:    smallCount,
    overflowCount: largeCount,
    targetSize:    smallSize,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// groupLayoutSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Human-readable summary, e.g.:
 *   "15 groups of 3"
 *   "14 groups of 3 · 1 group of 4"
 */
export function groupLayoutSummary(layout: GroupLayoutResult): string {
  const { numGroups, smallCount, largeCount, smallSize, largeSize } = layout

  if (largeCount === 0) {
    return `${numGroups} group${numGroups !== 1 ? 's' : ''} of ${smallSize}`
  }

  const parts: string[] = []
  if (smallCount > 0) {
    parts.push(`${smallCount} group${smallCount !== 1 ? 's' : ''} of ${smallSize}`)
  }
  if (largeCount > 0) {
    parts.push(`${largeCount} group${largeCount !== 1 ? 's' : ''} of ${largeSize}`)
  }
  return parts.join(' · ')
}

// ─────────────────────────────────────────────────────────────────────────────
// validateGroupLayout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate whether a configuration is submittable.
 * Returns null when valid, or a human-readable error string.
 */
export function validateGroupLayout(
  totalMembers: number,
  ppg:          number,
  advanceCount: number,
): string | null {
  if (totalMembers < 2)  return 'Add at least 2 players first.'
  if (ppg < 2)           return 'Group size must be at least 2.'
  if (advanceCount < 1)  return 'At least 1 player must advance per group.'
  const { smallSize } = computeGroupLayout(totalMembers, ppg)
  if (smallSize < 2)     return 'Group size must be at least 2.'
  if (advanceCount >= smallSize) {
    return `Advance count (${advanceCount}) must be less than the minimum group size (${smallSize}).`
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// snakeAssign
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribute `members` across `numGroups` groups using a snake / zigzag
 * pattern so that the strongest seeds end up in different groups.
 *
 * Algorithm:
 *   Pass 1 →  groups 0, 1, 2, …, G-1
 *   Pass 2 ←  groups G-1, …, 2, 1, 0
 *   Pass 3 →  groups 0, 1, 2, …, G-1
 *   … until all members are placed.
 *
 * Groups at the turning point of the final partial pass naturally receive one
 * extra member, satisfying the fill-then-spill rule with no separate step.
 *
 * @param members     Ordered list of member IDs.
 *                    Caller must sort: seeded members ascending, unseeded last.
 * @param numGroups   Number of groups (from computeGroupLayout).
 * @returns           Array of length numGroups; each element is the list of
 *                    member IDs for that group (0-indexed).
 *
 * @example
 *   snakeAssign(['1','2','3','4','5','6','7'], 3)
 *   //  →  pass1: 1→G0  2→G1  3→G2
 *   //  ←  pass2: 4→G2  5→G1  6→G0
 *   //  →  pass3: 7→G0
 *   //  Result: [['1','6','7'], ['2','5'], ['3','4']]
 *   //           G0 has 3, G1 has 2, G2 has 2
 */
export function snakeAssign<T>(members: T[], numGroups: number): T[][] {
  const buckets: T[][] = Array.from({ length: numGroups }, () => [])
  if (numGroups === 0 || members.length === 0) return buckets

  let i    = 0
  let pass = 0

  while (i < members.length) {
    if (pass % 2 === 0) {
      // Forward pass: left → right
      for (let g = 0; g < numGroups && i < members.length; g++) {
        buckets[g].push(members[i++])
      }
    } else {
      // Backward pass: right → left
      for (let g = numGroups - 1; g >= 0 && i < members.length; g--) {
        buckets[g].push(members[i++])
      }
    }
    pass++
  }

  return buckets
}
