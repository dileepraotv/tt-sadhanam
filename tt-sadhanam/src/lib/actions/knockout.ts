'use server'

/**
 * actions/knockout.ts
 *
 * Generates the Stage 2 knockout bracket from Stage 1 qualifiers.
 *
 * ── SEEDING ALGORITHM ─────────────────────────────────────────────────────────
 *
 * Qualifiers arrive in snake-across-groups order (from qualifiers.ts):
 *   KO seed 1 = Group A winner
 *   KO seed 2 = Group B winner
 *   KO seed 3 = Group A runner-up  …
 *
 * The bracket engine (bracket/engine.ts) uses complement-interleave seeding
 * so that seeds 1 and 2 can only meet in the Final, 1/2 vs 3/4 in semis, etc.
 *
 * ── SAME-GROUP AVOIDANCE ──────────────────────────────────────────────────────
 *
 * After seeding, we check every Round-1 pairing. The complement-interleave
 * bracket for N players puts:
 *   Seed 1 vs Seed N,  Seed 2 vs Seed N-1, …  (in an 8-player bracket)
 *
 * If any R1 pair are from the same group, we try a greedy swap:
 *   Pick the lower-seeded player in the conflicting pair.
 *   Find the nearest other lower-seeded player (from a different group than
 *   the upper-seeded partner) who, when swapped, doesn't create a new conflict.
 *   Perform the swap (adjust koSeed values).
 *
 * If no valid swap exists, we log a warning and proceed — same-group R1 clashes
 * are uncommon and mostly unavoidable with ≥3 groups of odd sizes.
 *
 * ── INTEGRATION WITH BRACKET ENGINE ──────────────────────────────────────────
 *
 * generateBracket(players) reads player.seed to determine bracket positions.
 * We write the final koSeed values back to players.seed before calling it,
 * then restore original seeds after generating match rows.
 * The function creates a Stage 2 stages row and all match rows.
 */

import { createClient }   from '@/lib/supabase/server'
import { nextPowerOf2, getRoundName } from '@/lib/utils'
import { generateBracket }           from '@/lib/bracket/engine'
import type { Player, Qualifier, KOStageConfig, MatchFormat } from '@/lib/types'
import { buildQualifiers }           from './qualifiers'
import { revalidateTournamentPaths } from './stages'
import {
  computeAllGroupStandings,
} from '@/lib/roundrobin/standings'
import type { RRGroup } from '@/lib/roundrobin/types'

// ── Seed-order helper (mirrors bracket/engine.ts buildSeedOrder) ──────────────

function buildSeedOrder(size: number): number[] {
  let order: number[] = [1]
  let current = 1
  while (current < size) {
    current *= 2
    const next: number[] = []
    for (const x of order) {
      next.push(x)
      next.push(current + 1 - x)
    }
    order = next
  }
  return order
}

// ── Same-group avoidance ──────────────────────────────────────────────────────

interface R1Pair { seedA: number; seedB: number }

function getR1Pairs(N: number): R1Pair[] {
  const bracketSize = nextPowerOf2(N)
  const order       = buildSeedOrder(bracketSize)
  const pairs: R1Pair[] = []
  for (let i = 0; i < bracketSize; i += 2) {
    const a = order[i]
    const b = order[i + 1]
    // Only include pairs where at least one is a real player
    if (a <= N || b <= N) pairs.push({ seedA: a, seedB: b })
  }
  return pairs
}

/**
 * Apply same-group avoidance to the qualifier list.
 * Returns a (possibly reordered) copy of qualifiers with updated koSeed.
 * Emits console.warn for any unavoidable same-group R1 clash.
 */
export async function avoidSameGroupClashes(qualifiers: Qualifier[]): Promise<Qualifier[]> {
  const N = qualifiers.length
  if (N < 2) return qualifiers

  // Working copy: index i → qualifier with koSeed = i+1
  const q = qualifiers.map(x => ({ ...x }))
  // Sort by koSeed to start
  q.sort((a, b) => a.koSeed - b.koSeed)

  const pairs = getR1Pairs(N)

  // Identify conflicts
  function hasConflict(arr: Qualifier[]): boolean {
    return pairs.some(({ seedA, seedB }) => {
      if (seedA > N || seedB > N) return false
      return arr[seedA - 1].groupId === arr[seedB - 1].groupId
    })
  }

  // Greedy swap pass
  for (const { seedA, seedB } of pairs) {
    if (seedA > N || seedB > N) continue
    const qa = q[seedA - 1]
    const qb = q[seedB - 1]
    if (qa.groupId !== qb.groupId) continue

    // qa (higher seed) stays. Try to swap qb with another player in the lower half.
    let swapped = false
    for (let ci = Math.ceil(N / 2); ci < N; ci++) {
      if (ci === seedB - 1) continue
      const candidate = q[ci]

      // Candidate's current partner (if they're in R1)
      const candidatePair = pairs.find(p =>
        (p.seedA === ci + 1 && p.seedB <= N) || (p.seedB === ci + 1 && p.seedA <= N)
      )
      const candidatePartnerSeed = candidatePair
        ? (candidatePair.seedA === ci + 1 ? candidatePair.seedB : candidatePair.seedA)
        : null
      const candidatePartner = candidatePartnerSeed && candidatePartnerSeed <= N
        ? q[candidatePartnerSeed - 1]
        : null

      // Check: swap qb ↔ candidate doesn't create new same-group clashes
      const wouldCreate =
        candidate.groupId === qa.groupId ||          // new clash in (seedA, candidate)
        (candidatePartner && candidatePartner.groupId === qb.groupId)  // clash in candidate's old slot

      if (!wouldCreate) {
        // Perform swap
        q[seedB - 1] = candidate
        q[ci]        = qb
        swapped = true
        break
      }
    }

    if (!swapped) {
      console.warn(
        `[knockout] Could not avoid same-group R1 clash: ` +
        `"${qa.name}" (${qa.groupName}) vs "${qb.name}" (${qb.groupName})`
      )
    }
  }

  // Re-assign koSeeds 1..N in final order
  q.forEach((player, i) => { player.koSeed = i + 1 })

  return q
}

// ─────────────────────────────────────────────────────────────────────────────
// generateKnockoutStage
// Main entry point called by the UI "Advance to Knockout" button.
//
// Flow:
//  1. Load RR stage config + standings
//  2. Build qualifier list (buildQualifiers)
//  3. Apply same-group avoidance (avoidSameGroupClashes)
//  4. Update player.seed with koSeed values
//  5. Create Stage 2 (knockout) stages row
//  6. Call generateBracket with ordered qualifier players
//  7. Insert all match rows with stage_id = koStage.id
//  8. Auto-advance BYE matches
//  9. Update tournament flags
// ─────────────────────────────────────────────────────────────────────────────
export async function generateKnockoutStage(
  tournamentId: string,
  rrStageId:    string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Ownership check
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, format, created_by, stage1_complete, stage2_bracket_generated')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()

  if (!t) return { error: 'Tournament not found' }
  if (!t.stage1_complete) return { error: 'Close Stage 1 before generating the knockout bracket.' }
  if (t.stage2_bracket_generated) return { error: 'Knockout bracket already generated.' }

  // Load RR stage config
  const { data: rrStage } = await supabase
    .from('stages')
    .select('config')
    .eq('id', rrStageId)
    .single()
  if (!rrStage) return { error: 'Stage 1 not found' }

  const rrCfg = rrStage.config as import('@/lib/types').RRStageConfig

  // Load groups
  const { data: groupRows } = await supabase
    .from('rr_groups')
    .select('id, stage_id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', rrStageId)
    .order('group_number')

  if (!groupRows?.length) return { error: 'No groups found' }

  const groups: RRGroup[] = groupRows.map(g => ({
    id:          g.id,
    stageId:     g.stage_id,
    name:        g.name,
    groupNumber: g.group_number,
    playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  // Load players
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)

  // Load RR matches + games
  const { data: matches } = await supabase
    .from('matches')
    .select('*, games(id,game_number,score1,score2,winner_id,created_at,updated_at)')
    .eq('tournament_id', tournamentId)
    .eq('stage_id', rrStageId)

  const matchList = (matches ?? []) as unknown as import('@/lib/types').Match[]
  const allGames  = matchList.flatMap(m => m.games ?? [])

  const groupStandings = computeAllGroupStandings(
    groups,
    (players ?? []) as unknown as Player[],
    matchList,
    allGames,
    rrCfg.advanceCount,
  )

  // Build + reorder qualifiers
  let qualifiers = await buildQualifiers(groupStandings, rrCfg)
  if (qualifiers.length < 2) return { error: 'Not enough qualifiers for a knockout bracket.' }

  qualifiers = await avoidSameGroupClashes(qualifiers)

  // Update player seeds in DB with their final KO seed
  for (const q of qualifiers) {
    await supabase
      .from('players')
      .update({ seed: q.koSeed })
      .eq('id', q.playerId)
  }

  // Create Stage 2 row
  const koFormat: MatchFormat = t.format
  const koCfg: KOStageConfig = { seededFromRR: true, matchFormat: koFormat }

  const { data: koStage, error: koStageErr } = await supabase
    .from('stages')
    .insert({
      tournament_id: tournamentId,
      stage_number:  2,
      stage_type:    'knockout',
      config:        koCfg,
      status:        'active',
    })
    .select('id')
    .single()

  if (koStageErr || !koStage) return { error: koStageErr?.message ?? 'Failed to create KO stage' }

  // Build Player[] for the bracket engine (using koSeed as seed)
  const qualifyingPlayers: Player[] = qualifiers.map(q => {
    const full = (players ?? []).find(p => p.id === q.playerId)
    return {
      id:            q.playerId,
      tournament_id: tournamentId,
      name:          q.name,
      club:          q.club,
      country_code:  full?.country_code ?? null,
      seed:          q.koSeed,
      created_at:    full?.created_at ?? new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    }
  })

  // Generate bracket
  let bracketResult: ReturnType<typeof generateBracket>
  try {
    bracketResult = generateBracket(qualifyingPlayers)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const { totalRounds, firstRoundMatches } = bracketResult
  const { getRoundName: gRN } = await import('@/lib/utils')

  // Pre-generate match IDs so next_match_id FKs can be wired upfront
  const crypto = await import('crypto')
  let matchesPerRound = firstRoundMatches.length
  const matchIds: string[][] = []
  for (let r = 0; r < totalRounds; r++) {
    matchIds.push(Array.from({ length: matchesPerRound }, () => crypto.randomUUID()))
    matchesPerRound = Math.ceil(matchesPerRound / 2)
  }

  // Current max match_number across the tournament (avoid collision with RR matches)
  const { data: maxRow } = await supabase
    .from('matches')
    .select('match_number')
    .eq('tournament_id', tournamentId)
    .order('match_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const offset = maxRow?.match_number ?? 0

  const koMatchRows: Record<string, unknown>[] = []

  // Round 1
  firstRoundMatches.forEach((m, i) => {
    const nextMatchId  = totalRounds > 1 ? matchIds[1][m.nextMatchIndex] : null
    const slot1Player  = m.slot1.isBye ? null : m.slot1.player
    const slot2Player  = m.slot2.isBye ? null : m.slot2.player
    koMatchRows.push({
      id:            matchIds[0][i],
      tournament_id: tournamentId,
      stage_id:      koStage.id,
      match_kind:    'knockout',
      round:         1,
      match_number:  m.matchNumber + offset,
      player1_id:    slot1Player?.id ?? null,
      player2_id:    slot2Player?.id ?? null,
      player1_games: 0,
      player2_games: 0,
      winner_id:     m.isBye ? (slot1Player?.id ?? slot2Player?.id ?? null) : null,
      status:        m.isBye ? 'bye' : 'pending',
      next_match_id: nextMatchId,
      next_slot:     m.nextSlot,
      round_name:    m.roundName,
    })
  })

  // Rounds 2..N
  for (let r = 2; r <= totalRounds; r++) {
    const count = matchIds[r - 1].length
    for (let m = 0; m < count; m++) {
      koMatchRows.push({
        id:            matchIds[r - 1][m],
        tournament_id: tournamentId,
        stage_id:      koStage.id,
        match_kind:    'knockout',
        round:         r,
        match_number:  (m + 1) + offset,
        player1_id:    null,
        player2_id:    null,
        player1_games: 0,
        player2_games: 0,
        winner_id:     null,
        status:        'pending',
        next_match_id: r < totalRounds ? matchIds[r][Math.floor(m / 2)] : null,
        next_slot:     (m % 2 === 0) ? 1 : 2,
        round_name:    gRN(r, totalRounds),
      })
    }
  }

  const { error: insErr } = await supabase.from('matches').insert(koMatchRows)
  if (insErr) return { error: insErr.message }

  // Auto-advance BYE matches in R1
  for (const bm of koMatchRows.filter(m => m.status === 'bye')) {
    if (bm.next_match_id && bm.winner_id) {
      const col = bm.next_slot === 1 ? 'player1_id' : 'player2_id'
      await supabase.from('matches').update({ [col]: bm.winner_id }).eq('id', bm.next_match_id)
    }
  }

  // Update tournament
  await supabase.from('tournaments').update({
    stage2_bracket_generated: true,
    bracket_generated:        true,
    status:                   'active',
    published:                true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}
