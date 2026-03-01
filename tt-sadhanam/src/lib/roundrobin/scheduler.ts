/**
 * roundrobin/scheduler.ts
 *
 * Pure round-robin fixture generator using the "circle method" algorithm.
 * No database access, no side effects — safe to call from server or client.
 *
 * ── CIRCLE METHOD ────────────────────────────────────────────────────────────
 *
 * For n players (n must be even — odd groups get a virtual BYE appended):
 *
 *   1. Arrange players in a single array: [p0, p1, p2, … p(n-1)]
 *   2. Fix p0 at position 0. Rotate positions 1…(n-1) counter-clockwise
 *      each round (the last element slides into position 1).
 *   3. Each round, match seats[i] vs seats[n-1-i] for i = 0 … n/2 - 1.
 *   4. Repeat for n-1 rounds.
 *
 * This guarantees:
 *   • Every player faces every other player exactly once.
 *   • Home/away assignment alternates across rounds.
 *   • For n = 2k players: n-1 rounds, k matches per round.
 *   • For n = 2k+1 players: n rounds, k matches per round (1 BYE per round).
 *
 * ── ODD GROUPS ───────────────────────────────────────────────────────────────
 *
 * If the group has an odd number of real players, we append a virtual
 * BYE_PLAYER_ID as the last element before running the algorithm.
 * Any fixture involving BYE_PLAYER_ID is returned with isBye=true.
 * Callers decide whether to:
 *   • Skip BYE fixtures entirely, OR
 *   • Store them in the DB with status='bye' (gives the real player a walkover)
 *
 * ── EXAMPLE (4 players: A, B, C, D) ─────────────────────────────────────────
 *
 *   Initial: [A, B, C, D]
 *   Round 1: A×D, B×C    seats: [A, B, C, D]
 *   Round 2: A×C, D×B    seats: [A, D, B, C]   (D rotated to pos 1)
 *   Round 3: A×B, C×D    seats: [A, C, D, B]
 *
 *   Total: 3 rounds × 2 matches = 6 matches (= 4×3/2 ✓)
 *
 * ── EXAMPLE (3 players: A, B, C) → BYE appended ─────────────────────────────
 *
 *   Effective: [A, B, C, BYE]
 *   Round 1: A×BYE (bye), B×C
 *   Round 2: A×C,          BYE×B (bye)
 *   Round 3: A×B,          C×BYE (bye)
 *
 *   Real matches: 3 (= 3×2/2 ✓)
 */

import type { RRFixture } from './types'
import { BYE_PLAYER_ID } from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Rotate the tail of the seats array one step counter-clockwise:
 *   [fixed, a, b, c, d]  →  [fixed, d, a, b, c]
 *
 * The fixed element at index 0 never moves.
 */
function rotateTail(seats: string[]): string[] {
  if (seats.length <= 2) return seats
  const last = seats[seats.length - 1]
  return [seats[0], last, ...seats.slice(1, seats.length - 1)]
}

/**
 * Given a seats array for this round, produce all match pairs for that round.
 * seats.length MUST be even.
 *
 * pair[0] = seats[0] vs seats[n-1]
 * pair[1] = seats[1] vs seats[n-2]
 * …
 * pair[n/2-1] = seats[n/2-1] vs seats[n/2]
 */
function matchPairsForRound(seats: string[]): Array<[string, string]> {
  const n = seats.length
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < n / 2; i++) {
    pairs.push([seats[i], seats[n - 1 - i]])
  }
  return pairs
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a complete round-robin schedule for a group.
 *
 * @param playerIds  Array of player UUIDs in the group. Length 2–16.
 *                   Order matters for home/away assignment but not for
 *                   which matchups are generated (all pairs appear once).
 * @returns          Array of RRFixture objects. BYE fixtures (isBye=true)
 *                   are included when the group has an odd number of players.
 *
 * @throws           If playerIds.length < 2 or > 32.
 */
export function generateGroupSchedule(playerIds: string[]): RRFixture[] {
  const n = playerIds.length

  if (n < 2) {
    throw new Error(
      `Round robin requires at least 2 players per group. Got ${n}.`,
    )
  }
  if (n > 32) {
    throw new Error(
      `Round robin group size capped at 32. Got ${n}. Split into more groups.`,
    )
  }

  // Work on a copy — never mutate the caller's array
  let seats = [...playerIds]
  const hasOdd = seats.length % 2 !== 0

  // Pad with BYE if odd number of players so the circle method always has
  // an even-length array to work with.
  if (hasOdd) {
    seats.push(BYE_PLAYER_ID)
  }

  const numEffectivePlayers = seats.length          // always even
  const numRounds           = numEffectivePlayers - 1

  const fixtures: RRFixture[] = []

  for (let round = 1; round <= numRounds; round++) {
    const pairs = matchPairsForRound(seats)

    for (const [p1, p2] of pairs) {
      const isBye = p1 === BYE_PLAYER_ID || p2 === BYE_PLAYER_ID
      fixtures.push({
        round,
        player1Id: p1,
        player2Id: p2,
        isBye,
      })
    }

    // Rotate for the next round (keep seats[0] fixed)
    seats = rotateTail(seats)
  }

  return fixtures
}

/**
 * Generate schedules for multiple groups and merge them into a single list,
 * with match_number assigned globally across all groups within a round
 * (so that (tournament_id, round, match_number) remains unique in the DB).
 *
 * The round numbers are the same for all groups (round = matchday).
 * match_number is 1-based and sequential within each round across all groups.
 *
 * @param groups          Array of { groupNumber, playerIds }
 * @param matchNumOffset  The highest existing match_number in the tournament,
 *                        so new numbers don't collide with knockout matches.
 *
 * @returns               Flat list of fixtures, each enriched with:
 *                        matchNumber, groupIndex (0-based)
 */
export function generateMultiGroupSchedule(
  groups: Array<{ groupNumber: number; playerIds: string[] }>,
  matchNumOffset = 0,
): Array<RRFixture & { matchNumber: number; groupIndex: number }> {
  // First pass: generate all fixtures per group
  const groupFixtures = groups.map(g => ({
    groupIndex: g.groupNumber - 1,
    fixtures:   generateGroupSchedule(g.playerIds),
  }))

  // Find all unique round numbers across all groups
  const allRounds = new Set<number>()
  for (const { fixtures } of groupFixtures) {
    for (const f of fixtures) allRounds.add(f.round)
  }

  const result: Array<RRFixture & { matchNumber: number; groupIndex: number }> = []
  let matchNum = matchNumOffset

  // Assign match numbers round-by-round so that within each round,
  // all groups' fixtures share a contiguous match_number block.
  for (const round of [...allRounds].sort((a, b) => a - b)) {
    for (const { groupIndex, fixtures } of groupFixtures) {
      for (const f of fixtures) {
        if (f.round !== round) continue
        matchNum++
        result.push({ ...f, matchNumber: matchNum, groupIndex })
      }
    }
  }

  return result
}

// ── Verification helper (useful in tests) ────────────────────────────────────

/**
 * Verify that a generated schedule is valid:
 *   • Every real player appears in exactly (n-1) fixtures.
 *   • No player faces the same opponent twice.
 *   • Every possible pair appears exactly once.
 *
 * Returns { valid: true } or { valid: false, reason }.
 * BYE_PLAYER_ID fixtures are excluded from verification.
 */
export function verifySchedule(
  playerIds: string[],
  fixtures:  RRFixture[],
): { valid: true } | { valid: false; reason: string } {
  const realFixtures = fixtures.filter(f => !f.isBye)
  const n            = playerIds.length
  const expectedPairs = (n * (n - 1)) / 2

  if (realFixtures.length !== expectedPairs) {
    return {
      valid: false,
      reason: `Expected ${expectedPairs} fixtures for ${n} players, got ${realFixtures.length}.`,
    }
  }

  // Build set of pairs (ordered by ID to avoid A×B ≠ B×A ambiguity)
  const seen = new Set<string>()
  for (const f of realFixtures) {
    const key = [f.player1Id, f.player2Id].sort().join('|')
    if (seen.has(key)) {
      return {
        valid: false,
        reason: `Duplicate fixture: ${f.player1Id} vs ${f.player2Id}.`,
      }
    }
    seen.add(key)
  }

  // Check every expected pair appears
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const key = [playerIds[i], playerIds[j]].sort().join('|')
      if (!seen.has(key)) {
        return {
          valid: false,
          reason: `Missing fixture: ${playerIds[i]} vs ${playerIds[j]}.`,
        }
      }
    }
  }

  return { valid: true }
}
