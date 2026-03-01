/**
 * Bracket generation engine — ITTF / Olympic seeding standard.
 *
 * Core rules implemented:
 *
 * 1. Bracket size P = next power of 2 ≥ N (e.g. 17 players → P=32).
 * 2. Byes B = P − N. Byes are awarded to the TOP B seeds, so the
 *    highest-ranked players never have to play in Round 1.
 * 3. Seed placement order is built by the standard "complement interleave"
 *    recursion, guaranteeing:
 *      • Seeds 1 and 2 can only meet in the final.
 *      • Seeds 1/2 and 3/4 can only meet in the semi-finals.
 *      • etc.
 *
 * Seed order recursion (interleaved complements):
 *   Start:  order = [1]
 *   Each doubling step (size → 2×size):
 *     for each x in order: emit x, then emit (2×size + 1 − x)
 *   Result for P=4:  [1, 4, 2, 3] → pairs (1v4), (2v3)
 *   Result for P=8:  [1, 8, 4, 5, 2, 7, 3, 6] → pairs (1v8),(4v5),(2v7),(3v6)
 *   Result for P=32 with N=17: seeds 1–15 all draw BYEs (upper: 7, lower: 8)
 *                               seeds 16 & 17 play each other.
 *
 * Player ranking (effective seed):
 *   Rank 1 = player with explicit seed 1 (highest ranked)
 *   Rank 2 = player with explicit seed 2
 *   …
 *   Rank k = player with explicit seed k  (for all explicitly seeded players)
 *   Remaining ranks = unseeded players in random order
 */

import type { Player } from '@/lib/types'
import { nextPowerOf2, getRoundName, totalRoundsForSize } from '@/lib/utils'

// ── PRNG ──────────────────────────────────────────────────────────────────────
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

function makeRng(seed?: number): () => number {
  return seed !== undefined ? mulberry32(seed) : Math.random
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Seed placement order ──────────────────────────────────────────────────────
/**
 * Builds the seed-number-to-bracket-position mapping for a bracket of `size`.
 * Returns an array of length `size` where element at index i is the seed rank
 * that belongs in bracket slot i.
 *
 * Adjacent pairs (i, i+1) for even i are Round-1 opponents.
 *
 * The algorithm interleaves complements at each doubling step:
 *   [1] → [1, 2] → [1, 4, 2, 3] → [1, 8, 4, 5, 2, 7, 3, 6] → …
 */
function buildSeedOrder(size: number): number[] {
  let order: number[] = [1]
  let currentSize = 1
  while (currentSize < size) {
    currentSize *= 2
    const next: number[] = []
    for (const x of order) {
      next.push(x)
      next.push(currentSize + 1 - x)   // complement within current bracket size
    }
    order = next
  }
  return order
}

// ── Exported types ────────────────────────────────────────────────────────────
export interface SlotAssignment {
  slotNumber: number       // 1-based
  player:     Player | null
  isBye:      boolean
}

export interface MatchWiring {
  matchNumber:    number   // 1-based within round 1
  slot1:          SlotAssignment
  slot2:          SlotAssignment
  isBye:          boolean  // true → bye match, non-bye player auto-advances
  nextMatchIndex: number   // 0-based index in next round's match array
  nextSlot:       1 | 2
  roundName:      string
}

export interface BracketGenerationResult {
  bracketSize:       number
  byeCount:          number
  totalRounds:       number
  slots:             SlotAssignment[]
  firstRoundMatches: MatchWiring[]
}

// ── Main function ─────────────────────────────────────────────────────────────
export function generateBracket(
  players: Player[],
  randomSeed?: number,
): BracketGenerationResult {
  if (players.length < 2)   throw new Error('Need at least 2 players')
  if (players.length > 256) throw new Error('Maximum 256 players')

  const rng         = makeRng(randomSeed)
  const N           = players.length
  const bracketSize = nextPowerOf2(N)
  const byeCount    = bracketSize - N
  const numRounds   = totalRoundsForSize(bracketSize)

  // ── Rank all players 1..N ────────────────────────────────────────────────
  // Explicitly seeded players occupy ranks equal to their seed number.
  // Unseeded players fill remaining ranks in random order.
  const seeded = players
    .filter(p => p.seed != null && p.seed >= 1 && p.seed <= 64)
    .sort((a, b) => (a.seed as number) - (b.seed as number))

  const unseeded = shuffle(
    players.filter(p => !p.seed || p.seed < 1 || p.seed > 64),
    rng,
  )

  // Build rank → player map (1-indexed).
  // Rank 1 = best seed, rank N = last unseeded player.
  // Ranks not covered by explicit seeds are filled by unseeded players.
  const rankToPlayer = new Map<number, Player>()

  // Place explicitly seeded players at their seed rank
  for (const p of seeded) {
    rankToPlayer.set(p.seed as number, p)
  }

  // Fill remaining ranks with unseeded players in random order
  let unseededIdx = 0
  for (let rank = 1; rank <= N; rank++) {
    if (!rankToPlayer.has(rank) && unseededIdx < unseeded.length) {
      rankToPlayer.set(rank, unseeded[unseededIdx++])
    }
  }

  // ── Build bracket slots from seed order ──────────────────────────────────
  // seedOrder[i] = the seed rank that belongs in bracket slot i.
  // If seedOrder[i] > N → that slot is a BYE (the seed rank exceeds player count).
  const seedOrder = buildSeedOrder(bracketSize)

  const slots: SlotAssignment[] = seedOrder.map((rank, i) => {
    const player = rankToPlayer.get(rank) ?? null
    const isBye  = rank > N   // seed rank has no real player → BYE
    return {
      slotNumber: i + 1,
      player,
      isBye,
    }
  })

  // ── Build first-round match wiring ────────────────────────────────────────
  const firstRoundMatches: MatchWiring[] = []
  const rName = getRoundName(1, numRounds)

  for (let i = 0; i < bracketSize; i += 2) {
    const slot1 = slots[i]
    const slot2 = slots[i + 1]
    const idx   = i / 2   // 0-based match index within round 1

    firstRoundMatches.push({
      matchNumber:    idx + 1,
      slot1,
      slot2,
      isBye:          slot1.isBye || slot2.isBye,
      nextMatchIndex: Math.floor(idx / 2),
      nextSlot:       (idx % 2 === 0) ? 1 : 2,
      roundName:      rName,
    })
  }

  return {
    bracketSize,
    byeCount,
    totalRounds:       numRounds,
    slots,
    firstRoundMatches,
  }
}
