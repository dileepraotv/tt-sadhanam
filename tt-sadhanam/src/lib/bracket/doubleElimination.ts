/**
 * bracket/doubleElimination.ts
 *
 * Double-Elimination bracket engine.
 *
 * ── STRUCTURE ────────────────────────────────────────────────────────────────
 *
 * For N players (rounded up to next power of 2 = P):
 *
 *   Winners Bracket (WB):
 *     WB Round 1 .. WB Round log2(P): standard single-elimination structure.
 *     Losers from each WB match drop into the Losers Bracket.
 *
 *   Losers Bracket (LB):
 *     Two types of rounds alternate:
 *       MAJOR round: WB losers enter, face LB survivors
 *       MINOR round: LB survivors only (no new entrants from WB)
 *
 *     For P=8 (3 WB rounds):
 *       LB Round 1 (minor): 4 WB-R1-losers → 2 matches → 2 LB survivors
 *       LB Round 2 (major): 2 WB-R2-losers vs 2 LB-R1-winners → 2 matches
 *       LB Round 3 (minor): 2 LB-R2-winners → 1 match → LB finalist
 *       LB Round 4 (major): WB-Final-loser vs LB-R3-winner → 1 match = LB champion
 *
 *   Grand Final:
 *     WB Champion vs LB Champion.
 *     Optional bracket-reset match if the LB champion wins GF game 1
 *     (stored as a second grand_final match, initially pending).
 *
 * ── MATCH IDs ────────────────────────────────────────────────────────────────
 *
 * All match IDs are pre-generated as UUIDs so FK references
 * (next_match_id, loser_next_match_id) can be set in a single DB insert.
 *
 * ── SEEDING ──────────────────────────────────────────────────────────────────
 *
 * Same complement-interleave seeding as the single-KO bracket engine,
 * so seeds 1 and 2 cannot meet until the WB Final.
 *
 * ── BYES ─────────────────────────────────────────────────────────────────────
 *
 * Byes are awarded in WB Round 1 to the top seeds when N is not a power of 2.
 * Bye matches in the WB always produce a "free" winner — the bye player is
 * never assigned to the LB.
 */

import { nextPowerOf2 } from '@/lib/utils'
import type { Player }  from '@/lib/types'
import type { DEBracketResult, DEMatch, BracketSide } from '@/lib/types'

// Re-export so callers only need this module
export type { DEBracketResult, DEMatch }

// ── PRNG (same as bracket/engine.ts) ─────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let z = s
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 0xffffffff
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildSeedOrder(size: number): number[] {
  let order: number[] = [1]
  let cur = 1
  while (cur < size) {
    cur *= 2
    const next: number[] = []
    for (const x of order) {
      next.push(x, cur + 1 - x)
    }
    order = next
  }
  return order
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a complete double-elimination bracket.
 *
 * @param players     Array of Player objects (min 2, max 256).
 * @param rngSeed     Optional random seed for unseeded player shuffle.
 * @returns           DEBracketResult containing all matches across WB, LB, GF.
 */
export function generateDoubleEliminationBracket(
  players:  Player[],
  rngSeed?: number,
): DEBracketResult {
  if (players.length < 2)   throw new Error('Need at least 2 players')
  if (players.length > 256) throw new Error('Maximum 256 players for DE bracket')

  const rng = rngSeed !== undefined ? mulberry32(rngSeed) : Math.random.bind(Math)
  const N   = players.length
  const P   = nextPowerOf2(N)
  const byes = P - N

  // ── Rank players ─────────────────────────────────────────────────────────
  const seeded   = players.filter(p => p.seed != null).sort((a, b) => a.seed! - b.seed!)
  const unseeded = shuffle(players.filter(p => p.seed == null), rng)
  const ranked   = new Map<number, Player>()
  seeded.forEach((p, i)  => ranked.set(i + 1, p))
  let idx = 0
  for (let r = seeded.length + 1; r <= N; r++) ranked.set(r, unseeded[idx++])

  // ── Seed order → slot assignment ─────────────────────────────────────────
  const seedOrder = buildSeedOrder(P)
  // slot[i] = player or null (bye)
  const slots: Array<Player | null> = seedOrder.map(rank =>
    rank <= N ? (ranked.get(rank) ?? null) : null
  )

  // ── Pre-generate all match IDs ────────────────────────────────────────────
  // WB rounds: log2(P) rounds
  const wbRounds = Math.log2(P)  // always integer since P is power of 2
  // WB match counts per round: P/2, P/4, ..., 1
  const wbMatchCounts: number[] = []
  for (let r = 0; r < wbRounds; r++) wbMatchCounts.push(P >> (r + 1))

  // LB rounds: 2*(wbRounds-1) rounds
  // Minor rounds (no WB entrants): odd-indexed (0-based)
  // Major rounds (WB losers enter): even-indexed (0-based)
  // LB sizes:
  //   LB R0 (minor): byes=(P/4) matches, seeded from WB R1 losers (P/2 players → P/4 matches)
  //   LB R1 (major): P/4 matches (LB R0 winners vs WB R2 losers)
  //   LB R2 (minor): P/8 matches
  //   …
  const lbRounds = 2 * (wbRounds - 1)
  const lbMatchCounts: number[] = []
  for (let r = 0; r < lbRounds; r++) {
    // P/4 in first LB round, halves every 2 LB rounds
    const base = P >> 2  // P/4
    const halvings = Math.floor(r / 2)
    lbMatchCounts.push(Math.max(1, base >> halvings))
  }

  // Grand Final: 1 main match + 1 optional bracket-reset
  const GF_COUNT = 2  // we always pre-create both; reset is initially 'pending'

  // Pre-allocate all UUIDs
  const wbIds: string[][] = wbMatchCounts.map(c => Array.from({ length: c }, uuid))
  const lbIds: string[][] = lbMatchCounts.map(c => Array.from({ length: c }, uuid))
  const gfIds: string[]   = Array.from({ length: GF_COUNT }, uuid)

  // ── Build Winners Bracket ────────────────────────────────────────────────
  const wbMatches: DEMatch[] = []

  // WB Round 1 — seed players, assign bye matches
  for (let m = 0; m < wbMatchCounts[0]; m++) {
    const p1 = slots[m * 2]
    const p2 = slots[m * 2 + 1]
    const isBye = p1 === null || p2 === null

    // Winner goes to WB R2
    const nextMatchIdx = Math.floor(m / 2)
    const nextMatchId  = wbMatchCounts.length > 1 ? wbIds[1][nextMatchIdx] : gfIds[0]

    // Loser goes to LB — but only for non-bye matches
    // WB R1 losers go to LB Round 0 (minor) with P/4 matches.
    // Each LB R0 match takes 2 WB R1 losers.
    // LB position: pair up WB R1 losers: m=0,1 → LB[0][0]; m=2,3 → LB[0][1]; etc.
    const lbMatchIdx      = Math.floor(m / 2)
    const lbMatchId       = lbIds[0]?.[lbMatchIdx] ?? null
    const lbSlot: 1|2|null = isBye ? null : ((m % 2 === 0) ? 1 : 2)

    wbMatches.push({
      id:              wbIds[0][m],
      round:           1,
      matchNumber:     m + 1,
      roundName:       wbRounds === 1 ? 'Final' : `WB Round 1`,
      bracketSide:     'winners',
      player1Id:       p1?.id ?? null,
      player2Id:       p2?.id ?? null,
      isBye,
      nextMatchId,
      nextSlot:        (m % 2 === 0) ? 1 : 2,
      loserNextMatchId: isBye ? null : lbMatchId,
      loserNextSlot:   lbSlot,
    })
  }

  // WB Rounds 2..N
  for (let r = 1; r < wbRounds; r++) {
    const count = wbMatchCounts[r]
    // Map WB round r to the LB round that receives its losers
    // WB R2 losers → LB R1 (major), WB R3 losers → LB R3 (major), etc.
    const lbRoundForLosers = r * 2 - 1   // LB round index (0-based)

    for (let m = 0; m < count; m++) {
      const isWBFinal = r === wbRounds - 1
      const nextMatchId = isWBFinal
        ? gfIds[0]
        : wbIds[r + 1][Math.floor(m / 2)]

      const lbMatchId = lbIds[lbRoundForLosers]?.[m] ?? null

      wbMatches.push({
        id:          wbIds[r][m],
        round:       r + 1,
        matchNumber: m + 1,
        roundName:   isWBFinal ? 'WB Final' : `WB Round ${r + 1}`,
        bracketSide: 'winners',
        player1Id:   null,
        player2Id:   null,
        isBye:       false,
        nextMatchId,
        nextSlot:    (m % 2 === 0) ? 1 : 2,
        loserNextMatchId: lbMatchId,
        loserNextSlot:   (m % 2 === 0) ? 1 : 2,
      })
    }
  }

  // ── Build Losers Bracket ─────────────────────────────────────────────────
  const lbMatches: DEMatch[] = []

  for (let r = 0; r < lbRounds; r++) {
    const count = lbMatchCounts[r]
    const isLBFinal = r === lbRounds - 1

    for (let m = 0; m < count; m++) {
      // Where does winner go?
      let nextMatchId: string | null
      let nextSlot: 1 | 2 | null

      if (isLBFinal) {
        nextMatchId = gfIds[0]
        nextSlot    = 2   // LB champion always goes to slot 2 of GF
      } else {
        // Next LB round
        const nextCount = lbMatchCounts[r + 1]
        const nextIdx   = Math.floor(m / 2)
        nextMatchId = lbIds[r + 1][Math.min(nextIdx, nextCount - 1)]
        nextSlot    = nextCount === count ? ((m % 2 === 0) ? 1 : 2)
                                         : (m % 2 === 0 ? 1 : 2)
      }

      const roundLabel = isLBFinal ? 'LB Final'
        : r === 0             ? 'LB Round 1'
        :                       `LB Round ${r + 1}`

      lbMatches.push({
        id:              lbIds[r][m],
        round:           r + 1,
        matchNumber:     m + 1,
        roundName:       roundLabel,
        bracketSide:     'losers',
        player1Id:       null,
        player2Id:       null,
        isBye:           false,
        nextMatchId,
        nextSlot,
        loserNextMatchId: null,
        loserNextSlot:   null,
      })
    }
  }

  // Assign initial players to LB Round 0 from WB R1
  // (done above via loserNextMatchId / loserNextSlot on WB matches)

  // ── Grand Final ──────────────────────────────────────────────────────────
  const grandFinal: DEMatch[] = [
    {
      id:              gfIds[0],
      round:           1,
      matchNumber:     1,
      roundName:       'Grand Final',
      bracketSide:     'grand_final',
      player1Id:       null,  // WB champion fills in
      player2Id:       null,  // LB champion fills in
      isBye:           false,
      nextMatchId:     gfIds[1],  // winner of GF1 goes to GF2 (bracket reset)
      nextSlot:        1,
      loserNextMatchId: gfIds[1], // loser of GF1 also goes to GF2 (LB champion gets reset)
      loserNextSlot:   2,
    },
    {
      id:              gfIds[1],
      round:           2,
      matchNumber:     2,
      roundName:       'Grand Final (Reset)',
      bracketSide:     'grand_final',
      player1Id:       null,
      player2Id:       null,
      isBye:           false,
      nextMatchId:     null,
      nextSlot:        null,
      loserNextMatchId: null,
      loserNextSlot:   null,
    },
  ]

  // ── Seed WB R1 bye winners into WB R2 ────────────────────────────────────
  // (Same logic as single-KO: if WB R1 match is a bye, the surviving player
  //  is pre-placed in the next WB match. Done here as annotation on the result
  //  so the action layer can apply the pre-placement.)

  const totalMatches =
    wbMatches.length +
    lbMatches.length +
    grandFinal.length

  return { winnersBracket: wbMatches, losersBracket: lbMatches, grandFinal, totalMatches }
}
