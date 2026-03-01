'use server'

/**
 * actions/roundrobin.ts
 *
 * Server Actions for round-robin setup and administration.
 *
 * ── WRITE FLOWS ──────────────────────────────────────────────────────────────
 *
 * createRoundRobinStage
 *   INSERT stages row  →  INSERT rr_groups rows  →  returns stage + group IDs
 *
 * assignPlayersToGroups
 *   Snake-seed distribution  →  INSERT rr_group_members rows
 *   UPDATE tournaments.rr_groups / rr_advance_count (for display)
 *
 * createRoundRobinMatchesForGroups
 *   Load group members  →  generateMultiGroupSchedule()  →  INSERT matches rows
 *   (match_kind='round_robin', stage_id set, group_id set)
 *
 * advanceToKnockout
 *   computeAllGroupStandings()  →  extractQualifiers()
 *   →  reassign seeds on players  →  generateKnockoutBracket() (existing engine)
 *   →  INSERT matches (knockout stage)
 *   →  UPDATE tournaments (stage1_complete, stage2_bracket_generated)
 *
 * ── INTEGRATION WITH EXISTING CODE ──────────────────────────────────────────
 *
 * saveGameScore (actions/matches.ts)
 *   Works unchanged for RR matches. The only difference is step 9b
 *   ("mark tournament complete if Final and no next_match_id"):
 *   that step must check match_kind !== 'round_robin' before marking complete.
 *   See the patch note at the bottom of this file.
 *
 * generateDraw (actions/tournaments.ts)
 *   Continues to work for single_knockout tournaments — unmodified.
 *   For multi_rr_to_knockout, use advanceToKnockout() in this file.
 *
 * fetchPublicMatches (realtime/public-queries.ts)
 *   Adds stage_id + group_id to PUBLIC_MATCH_COLS so the public page
 *   can filter RR vs KO matches. See patch note below.
 *
 * Realtime (useRealtimeTournament.ts)
 *   The existing subscription `filter: tournament_id=eq.${id}` already
 *   covers RR matches — no changes needed. RR matches use the same matches +
 *   games tables and fire the same Realtime events. The public page computes
 *   updated standings client-side from the incoming match payload.
 */

import { revalidatePath } from 'next/cache'
import { createClient }   from '@/lib/supabase/server'
import type { MatchFormat, Player } from '@/lib/types'
import {
  generateMultiGroupSchedule,
} from '@/lib/roundrobin/scheduler'
import {
  computeAllGroupStandings,
  extractQualifiers,
} from '@/lib/roundrobin/standings'
import type {
  CreateRRStageInput,
  AssignPlayersInput,
  RRGroup,
} from '@/lib/roundrobin/types'
import { BYE_PLAYER_ID } from '@/lib/roundrobin/types'
// The existing knockout bracket engine — reused for Stage 2
import { generateBracket } from '@/lib/bracket/engine'

// ── Shared: revalidate all paths for a tournament ─────────────────────────────
async function revalidateTournament(
  supabase: ReturnType<typeof createClient>,
  tournamentId: string,
) {
  const { data: t } = await supabase
    .from('tournaments')
    .select('championship_id')
    .eq('id', tournamentId)
    .single()

  revalidatePath(`/admin/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}`)
  if (t?.championship_id) {
    revalidatePath(`/admin/championships/${t.championship_id}/events/${tournamentId}`)
    revalidatePath(`/championships/${t.championship_id}/events/${tournamentId}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. createRoundRobinStage
//    Creates a stages row and the specified number of rr_groups rows.
//    Does NOT assign players or generate fixtures — those are separate steps
//    so the admin can review group composition before committing matches.
// ─────────────────────────────────────────────────────────────────────────────
export async function createRoundRobinStage(
  input: CreateRRStageInput,
): Promise<{ error?: string; stageId?: string; groupIds?: string[] }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify ownership
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, created_by')
    .eq('id', input.tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found or not owned by you' }

  // Validate
  if (input.numberOfGroups < 1 || input.numberOfGroups > 16) {
    return { error: 'Number of groups must be 1–16' }
  }
  if (input.advanceCount < 1) {
    return { error: 'Advance count must be at least 1' }
  }

  const config = {
    numberOfGroups: input.numberOfGroups,
    advanceCount:   input.advanceCount,
    matchFormat:    input.matchFormat,
  }

  // Insert stage
  const { data: stage, error: stageErr } = await supabase
    .from('stages')
    .insert({
      tournament_id: input.tournamentId,
      stage_number:  input.stageNumber,
      stage_type:    'round_robin',
      config,
      status:        'pending',
    })
    .select('id')
    .single()

  if (stageErr || !stage) return { error: stageErr?.message ?? 'Failed to create stage' }

  // Insert rr_groups (Group A, Group B, …)
  const groupLabels = 'ABCDEFGHIJKLMNOP'
  const groupRows = Array.from({ length: input.numberOfGroups }, (_, i) => ({
    stage_id:     stage.id,
    name:         `Group ${groupLabels[i] ?? i + 1}`,
    group_number: i + 1,
  }))

  const { data: groups, error: groupErr } = await supabase
    .from('rr_groups')
    .insert(groupRows)
    .select('id')

  if (groupErr || !groups) return { error: groupErr?.message ?? 'Failed to create groups' }

  // Update tournament to reflect RR config
  await supabase
    .from('tournaments')
    .update({
      rr_groups:        input.numberOfGroups,
      rr_advance_count: input.advanceCount,
    })
    .eq('id', input.tournamentId)

  await revalidateTournament(supabase, input.tournamentId)

  return {
    stageId:  stage.id,
    groupIds: groups.map(g => g.id),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. assignPlayersToGroups
//    Distributes players into groups using snake seeding.
//
//    Snake distribution example (4 groups, seeds 1–8):
//      Pass 1 (→): S1→G1, S2→G2, S3→G3, S4→G4
//      Pass 2 (←): S5→G4, S6→G3, S7→G2, S8→G1
//      Remaining (unseeded, randomised): → G1, G2, G3, G4, G1, G2, …
//
//    This maximises balance and ensures top seeds are in different groups.
// ─────────────────────────────────────────────────────────────────────────────
export async function assignPlayersToGroups(
  input: AssignPlayersInput,
): Promise<{ error?: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load group IDs for this stage
  const { data: groups, error: grpErr } = await supabase
    .from('rr_groups')
    .select('id, group_number')
    .eq('stage_id', input.stageId)
    .order('group_number')

  if (grpErr || !groups?.length) return { error: 'No groups found for this stage' }

  const n = input.numberOfGroups
  if (groups.length !== n) {
    return { error: `Expected ${n} groups, found ${groups.length}` }
  }

  // Separate seeded and unseeded players
  const seeded   = input.players.filter(p => p.seed != null).sort((a, b) => a.seed! - b.seed!)
  const unseeded = [...input.players.filter(p => p.seed == null)]

  // Shuffle unseeded players with optional deterministic PRNG
  shuffleArray(unseeded, input.rngSeed)

  // Snake-distribute seeded players into groups
  const groupAssignments: Map<string, string[]> = new Map(
    groups.map(g => [g.id, []]),
  )
  const groupIds = groups.map(g => g.id)   // indexed 0..n-1

  for (let i = 0; i < seeded.length; i++) {
    // Which pass are we on?
    const pass         = Math.floor(i / n)
    const posInPass    = i % n
    const groupIndex   = pass % 2 === 0 ? posInPass : n - 1 - posInPass
    const gid          = groupIds[groupIndex]
    groupAssignments.get(gid)!.push(seeded[i].id)
  }

  // Round-robin distribute remaining unseeded players
  for (let i = 0; i < unseeded.length; i++) {
    const gid = groupIds[i % n]
    groupAssignments.get(gid)!.push(unseeded[i].id)
  }

  // Insert rr_group_members rows
  const memberRows: { group_id: string; player_id: string }[] = []
  for (const [groupId, playerIds] of groupAssignments) {
    for (const pid of playerIds) {
      memberRows.push({ group_id: groupId, player_id: pid })
    }
  }

  // Delete any existing assignments for this stage first (idempotent re-run)
  await supabase
    .from('rr_group_members')
    .delete()
    .in('group_id', groupIds)

  const { error: insertErr } = await supabase
    .from('rr_group_members')
    .insert(memberRows)

  if (insertErr) return { error: insertErr.message }

  // Look up tournament_id from stage to revalidate
  const { data: stage } = await supabase
    .from('stages')
    .select('tournament_id')
    .eq('id', input.stageId)
    .single()

  if (stage) await revalidateTournament(supabase, stage.tournament_id)

  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. createRoundRobinMatchesForGroups
//    Reads group membership from the DB, runs the scheduler, and inserts
//    all fixtures as match rows.
//
//    Uniqueness: (tournament_id, round, match_number) must be unique.
//    We use a global match_number counter starting from max(existing)+1.
//    round = matchday (same number across all groups for a given matchday).
//
//    BYE fixtures: stored with status='bye' and player2_id=null so the
//    existing BYE rendering logic in BracketView/MatchCard works unchanged.
// ─────────────────────────────────────────────────────────────────────────────
export async function createRoundRobinMatchesForGroups(
  tournamentId: string,
  stageId:      string,
): Promise<{ error?: string; matchCount?: number }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify ownership
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, format, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load stage config (for match format override)
  const { data: stage } = await supabase
    .from('stages')
    .select('id, config')
    .eq('id', stageId)
    .single()
  if (!stage) return { error: 'Stage not found' }

  const stageConfig  = stage.config as { matchFormat?: MatchFormat }
  const matchFormat: MatchFormat = stageConfig.matchFormat ?? t.format

  // Load groups + members
  const { data: groups, error: grpErr } = await supabase
    .from('rr_groups')
    .select('id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', stageId)
    .order('group_number')

  if (grpErr || !groups) return { error: grpErr?.message ?? 'Failed to load groups' }

  // Find the current max match_number in this tournament (to avoid collisions
  // with any knockout matches that may already exist).
  const { data: maxRow } = await supabase
    .from('matches')
    .select('match_number')
    .eq('tournament_id', tournamentId)
    .order('match_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const matchNumOffset = maxRow?.match_number ?? 0

  // Build the multi-group schedule
  const groupsInput = groups.map(g => ({
    groupNumber: g.group_number,
    playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  // Validate: at least 2 players per group
  for (const g of groupsInput) {
    if (g.playerIds.length < 2) {
      return { error: `Group ${g.groupNumber} has fewer than 2 players. Assign players first.` }
    }
  }

  let fixtures: ReturnType<typeof generateMultiGroupSchedule>
  try {
    fixtures = generateMultiGroupSchedule(groupsInput, matchNumOffset)
  } catch (e) {
    return { error: (e as Error).message }
  }

  // Build match rows for insertion
  const groupIdByGroupNumber = new Map(groups.map(g => [g.group_number, g.id]))

  const matchRows = fixtures.map(f => {
    const groupId = groupIdByGroupNumber.get(f.groupIndex + 1) ?? null
    const isBye   = f.isBye

    return {
      tournament_id:  tournamentId,
      stage_id:       stageId,
      group_id:       groupId,
      round:          f.round,
      match_number:   f.matchNumber,
      player1_id:     f.player1Id === BYE_PLAYER_ID ? null : f.player1Id,
      player2_id:     f.player2Id === BYE_PLAYER_ID ? null : f.player2Id,
      player1_games:  0,
      player2_games:  0,
      winner_id:      null,
      status:         isBye ? 'bye' : 'pending',
      match_kind:     'round_robin' as const,
      round_name:     `Matchday ${f.round}`,
    }
  })

  // Delete any previously generated RR matches for this stage (safe re-run)
  await supabase
    .from('matches')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('stage_id', stageId)
    .eq('match_kind', 'round_robin')

  const { error: insertErr } = await supabase
    .from('matches')
    .insert(matchRows)

  if (insertErr) return { error: insertErr.message }

  // Activate the stage
  await supabase
    .from('stages')
    .update({ status: 'active' })
    .eq('id', stageId)

  // Activate the tournament (if it was still in setup)
  await supabase
    .from('tournaments')
    .update({ status: 'active' })
    .eq('id', tournamentId)
    .eq('status', 'setup')

  await revalidateTournament(supabase, tournamentId)

  return { matchCount: matchRows.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. closeRoundRobinStage
//    Verifies all RR matches are complete, locks the stage, and sets
//    stage1_complete on the tournament.
//    Must be called before advanceToKnockout.
// ─────────────────────────────────────────────────────────────────────────────
export async function closeRoundRobinStage(
  tournamentId: string,
  stageId:      string,
): Promise<{ error?: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Count incomplete (non-bye) RR matches
  const { count: pendingCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('stage_id', stageId)
    .eq('match_kind', 'round_robin')
    .neq('status', 'complete')
    .neq('status', 'bye')

  if (pendingCount && pendingCount > 0) {
    return {
      error: `${pendingCount} round-robin match${pendingCount > 1 ? 'es' : ''} still need results before closing Stage 1.`,
    }
  }

  await supabase.from('stages').update({ status: 'complete' }).eq('id', stageId)
  await supabase.from('tournaments').update({ stage1_complete: true }).eq('id', tournamentId)

  await revalidateTournament(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. advanceToKnockout
//    Reads the final RR standings, takes the top N per group, re-seeds them
//    for the knockout bracket, then calls the existing bracket engine to
//    generate all KO match rows.
//
//    Seeding convention (ITTF-style cross-group draw):
//      KO Seed 1 = Group A winner
//      KO Seed 2 = Group B winner
//      KO Seed 3 = Group A runner-up  (so A1 and A2 cannot meet in SF)
//      KO Seed 4 = Group B runner-up
//      etc.
// ─────────────────────────────────────────────────────────────────────────────
export async function advanceToKnockout(
  tournamentId: string,
  rrStageId:    string,
): Promise<{ error?: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify stage1 is closed
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, format, status, stage1_complete, stage2_bracket_generated, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()

  if (!t) return { error: 'Tournament not found' }
  if (!t.stage1_complete) return { error: 'Close Stage 1 before generating the knockout bracket' }
  if (t.stage2_bracket_generated) return { error: 'Knockout bracket already generated' }

  // Load groups + members + all RR matches + games
  const { data: groups } = await supabase
    .from('rr_groups')
    .select('id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', rrStageId)
    .order('group_number')

  if (!groups?.length) return { error: 'No groups found' }

  const { data: rrMatches } = await supabase
    .from('matches')
    .select('id, player1_id, player2_id, player1_games, player2_games, winner_id, status, group_id, match_kind')
    .eq('tournament_id', tournamentId)
    .eq('stage_id', rrStageId)

  const { data: stage } = await supabase
    .from('stages')
    .select('config')
    .eq('id', rrStageId)
    .single()

  const rrConfig = (stage?.config ?? {}) as { numberOfGroups?: number; advanceCount?: number }
  const advanceCount = rrConfig.advanceCount ?? 2

  // Load all games for RR matches
  const rrMatchIds = (rrMatches ?? []).map(m => m.id)
  const { data: games } = await supabase
    .from('games')
    .select('id, match_id, game_number, score1, score2, winner_id, created_at, updated_at')
    .in('match_id', rrMatchIds.length ? rrMatchIds : ['00000000-0000-0000-0000-000000000000'])

  // Load player objects
  const playerIds = groups.flatMap(g =>
    (g.rr_group_members as { player_id: string }[]).map(m => m.player_id)
  )
  const { data: players } = await supabase
    .from('players')
    .select('id, name, seed, club, country_code, tournament_id, created_at, updated_at')
    .in('id', playerIds)

  // Build RRGroup objects for the standings engine
  const rrGroups: RRGroup[] = groups.map(g => ({
    id:           g.id,
    stageId:      rrStageId,
    name:         g.name,
    groupNumber:  g.group_number,
    playerIds:    (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  // Compute standings
  const allStandings = computeAllGroupStandings(
    rrGroups,
    (players ?? []) as unknown as Player[],
    (rrMatches ?? []) as unknown as import('@/lib/types').Match[],
    (games ?? []) as unknown as import('@/lib/types').Game[],
    advanceCount,
  )

  // Extract qualifiers in seeding order
  const qualifiers = extractQualifiers(allStandings, advanceCount)

  if (!qualifiers.length) return { error: 'No qualifying players found' }

  // Update player seeds for the KO bracket:
  // KO Seed 1 = index 0, KO Seed 2 = index 1, etc.
  for (let i = 0; i < qualifiers.length; i++) {
    await supabase
      .from('players')
      .update({ seed: i + 1 })
      .eq('id', qualifiers[i].playerId)
  }

  // Create Stage 2 (knockout) row
  const { data: koStage, error: koStageErr } = await supabase
    .from('stages')
    .insert({
      tournament_id: tournamentId,
      stage_number:  2,
      stage_type:    'knockout',
      config:        { seededFromRR: true },
      status:        'active',
    })
    .select('id')
    .single()

  if (koStageErr || !koStage) return { error: koStageErr?.message ?? 'Failed to create KO stage' }

  // Use the existing bracket engine to generate KO fixtures.
  // The engine takes Player[] with seeds set (we updated them above).
  const { getRoundName, totalRoundsForSize } = await import('@/lib/utils')

  const qualifyingPlayers = (players ?? [])
    .filter(p => qualifiers.some(q => q.playerId === p.id)) as unknown as Player[]

  if (qualifyingPlayers.length < 2) {
    return { error: 'Need at least 2 qualifying players for knockout stage' }
  }

  let bracketResult: ReturnType<typeof generateBracket>
  try {
    bracketResult = generateBracket(qualifyingPlayers)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const { totalRounds, firstRoundMatches } = bracketResult

  // Determine current max match_number across the tournament (avoid collisions)
  const { data: maxRow } = await supabase
    .from('matches')
    .select('match_number')
    .eq('tournament_id', tournamentId)
    .order('match_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const matchNumOffset = maxRow?.match_number ?? 0

  // Pre-generate all match IDs so next_match_id FK can be wired up front
  const crypto = await import('crypto')
  let matchesPerRound = firstRoundMatches.length
  const matchIds: string[][] = []
  for (let r = 0; r < totalRounds; r++) {
    matchIds.push(Array.from({ length: matchesPerRound }, () => crypto.randomUUID()))
    matchesPerRound = Math.ceil(matchesPerRound / 2)
  }

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
      match_number:  m.matchNumber + matchNumOffset,
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

  // Rounds 2..N (empty shells; players fill in as winners advance)
  for (let r = 2; r <= totalRounds; r++) {
    const count = matchIds[r - 1].length
    for (let m = 0; m < count; m++) {
      const nextMatchId = r < totalRounds ? matchIds[r][Math.floor(m / 2)] : null
      koMatchRows.push({
        id:            matchIds[r - 1][m],
        tournament_id: tournamentId,
        stage_id:      koStage.id,
        match_kind:    'knockout',
        round:         r,
        match_number:  (m + 1) + matchNumOffset,
        player1_id:    null,
        player2_id:    null,
        player1_games: 0,
        player2_games: 0,
        winner_id:     null,
        status:        'pending',
        next_match_id: nextMatchId,
        next_slot:     (m % 2 === 0) ? 1 : 2,
        round_name:    getRoundName(r, totalRounds),
      })
    }
  }

  const { error: koInsertErr } = await supabase
    .from('matches')
    .insert(koMatchRows)

  if (koInsertErr) return { error: koInsertErr.message }

  // Auto-advance first-round BYE matches
  const byeRows = koMatchRows.filter(m => m.status === 'bye')
  for (const bm of byeRows) {
    if (bm.next_match_id && bm.winner_id) {
      const col = bm.next_slot === 1 ? 'player1_id' : 'player2_id'
      await supabase.from('matches')
        .update({ [col]: bm.winner_id })
        .eq('id', bm.next_match_id)
    }
  }

  // Mark tournament as having a KO bracket
  await supabase
    .from('tournaments')
    .update({
      stage2_bracket_generated: true,
      bracket_generated:        true,   // keep legacy flag for UI compatibility
    })
    .eq('id', tournamentId)

  await revalidateTournament(supabase, tournamentId)
  return {}
}

// ── Utility: deterministic Fisher-Yates shuffle ───────────────────────────────

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

function shuffleArray<T>(arr: T[], seed?: number): void {
  const rng = seed !== undefined ? mulberry32(seed) : Math.random
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// =============================================================================
// PATCH NOTES — changes required in existing files
// =============================================================================
//
// ── CRITICAL: actions/matches.ts ─────────────────────────────────────────────
//
// loadMatchWithFormat() must also select `match_kind` so step 9b can
// distinguish RR matches (which should NOT mark the tournament complete
// when they finish — that only happens for the KO Final).
//
// Change 1: Add match_kind to the select in loadMatchWithFormat:
//
//   const { data, error } = await supabase
//     .from('matches')
//     .select(`
//       id, tournament_id, round, match_number,
//       player1_id, player2_id, winner_id, status,
//       next_match_id, next_slot, started_at,
//       match_kind,            ← ADD THIS
//       tournament:tournaments ( id, format, status )
//     `)
//
// Change 2: Update step 9b to skip the tournament-complete check for RR:
//
//   // ── 9b. If this is the KO Final, mark tournament complete ────────────────
//   if (matchWinnerId && !match.next_match_id && match.match_kind !== 'round_robin') {
//     await supabase
//       .from('tournaments')
//       .update({ status: 'complete' })
//       .eq('id', match.tournament_id)
//   }
//
// Without this patch, every RR match completion would mark the tournament
// as 'complete' (since RR matches have null next_match_id, same as the KO Final).
//
// ── PUBLIC QUERIES: realtime/public-queries.ts ───────────────────────────────
//
// Add `stage_id` and `group_id` to PUBLIC_MATCH_COLS so the public page
// can partition matches into RR groups vs KO rounds:
//
//   const PUBLIC_MATCH_COLS = [
//     'id', 'tournament_id', 'round', 'match_number',
//     'player1_id', 'player2_id',
//     'player1_games', 'player2_games',
//     'winner_id', 'status', 'round_name',
//     'stage_id', 'group_id', 'match_kind',   ← ADD THESE
//   ].join(', ')
//
// ── TYPES: src/lib/types.ts ──────────────────────────────────────────────────
//
// Add to the Match interface:
//
//   stage_id?:    string | null
//   group_id?:    string | null
//   match_kind?:  'knockout' | 'round_robin'
//
// And to Tournament:
//
//   format_type?:             'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout'
//   rr_groups?:               number
//   rr_advance_count?:        number
//   stage1_complete?:         boolean
//   stage2_bracket_generated?: boolean
//
