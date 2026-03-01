'use server'

/**
 * actions/roundRobin.ts
 *
 * Round-robin specific operations.
 *
 * Relationship to existing roundrobin.ts:
 *   The old `src/lib/actions/roundrobin.ts` contains createRoundRobinStage,
 *   assignPlayersToGroups, etc. — retained for backward compat.
 *   THIS file is the new clean API called by the multi-stage UI:
 *     • generateGroups     — snake-seeds players into rr_groups
 *     • generateFixtures   — circle-method schedule → match rows
 *     • getStageData       — SSR: loads stage + groups + matches + standings
 *
 * Data flow:
 *   Admin configures → createRRStage (stages.ts)
 *   Players added   → generateGroups (this file) → rr_group_members rows
 *   Fixtures gen'd  → generateFixtures (this file) → matches rows
 *   Scores entered  → existing saveGameScore (matches.ts) — unchanged
 *   Standings view  → getStageData (this file) → computeAllGroupStandings (standings.ts)
 */

import { revalidatePath }  from 'next/cache'
import { createClient }    from '@/lib/supabase/server'
import type { MatchFormat, Stage, RRStageConfig } from '@/lib/types'
import { generateMultiGroupSchedule } from '@/lib/roundrobin/scheduler'
import {
  computeAllGroupStandings,
  groupProgress,
} from '@/lib/roundrobin/standings'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'
import { BYE_PLAYER_ID } from '@/lib/roundrobin/types'
import { revalidateTournamentPaths } from './stages'

// ─────────────────────────────────────────────────────────────────────────────
// generateGroups
// Distributes players into rr_groups using a three-pass algorithm:
//
//  Pass 1 — Preferred groups (from Excel upload)
//    Players with preferred_group set are placed into their designated group
//    first (1=A, 2=B, …). If a preferred_group is out of range it is ignored.
//
//  Pass 2 — Snake-seed remaining seeded players into groups with most room
//    To give highest seeds maximum qualifying chance, seeded players are
//    snake-distributed across groups ordered by remaining capacity (largest
//    first). This ensures top seeds are spread across the biggest groups so
//    they never meet each other in the group stage.
//    Snake rule (even passes →, odd passes ←) prevents two strong seeds
//    landing in the same group.
//
//  Pass 3 — Remaining unseeded players round-robin into remaining slots
//    Shuffled randomly, then assigned cyclically so no group is starved.
//
// Idempotent: clears existing member rows before inserting.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateGroups(
  stageId:      string,
  tournamentId: string,
  rngSeed?:     number,   // optional deterministic shuffle seed (for tests)
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load groups for this stage
  const { data: groups, error: grpErr } = await supabase
    .from('rr_groups')
    .select('id, group_number')
    .eq('stage_id', stageId)
    .order('group_number')

  if (grpErr || !groups?.length) return { error: 'No groups found for this stage' }

  // Load all players WITH preferred_group
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, name, seed, preferred_group')
    .eq('tournament_id', tournamentId)

  if (pErr) return { error: pErr.message }
  if (!players?.length) return { error: 'No players found. Add players first.' }

  const G        = groups.length
  const groupIds = groups.map(g => g.id)

  // Build assignment map: groupId → [playerId, …]
  const groupAssign: Map<string, string[]> = new Map(groups.map(g => [g.id, []]))

  // ── PASS 1: Honour preferred_group from Excel ─────────────────────────────
  const unassigned: typeof players = []
  for (const p of players) {
    const pg = p.preferred_group
    if (pg != null && pg >= 1 && pg <= G) {
      // Convert 1-based preferred_group → group index
      const targetId = groupIds[pg - 1]
      groupAssign.get(targetId)!.push(p.id)
    } else {
      unassigned.push(p)
    }
  }

  // ── PASS 2: Snake-seed remaining seeded players ────────────────────────────
  // Sort by seed ascending (unseeded at the end)
  const remainingSeeded   = unassigned.filter(p => p.seed != null).sort((a, b) => a.seed! - b.seed!)
  const remainingUnseeded = unassigned.filter(p => p.seed == null)
  shuffleArray(remainingUnseeded, rngSeed)

  // Snake across groups ordered by current size (largest available room first)
  // so top seeds go into the groups that currently have the most room, keeping
  // groups balanced and putting strong players where competition is richest.
  function snakeDistribute(playerList: typeof players) {
    for (let i = 0; i < playerList.length; i++) {
      // Build a sorted-by-size list for this pass (descending remaining room)
      // Keep stable index for snake direction
      const pass      = Math.floor(i / G)
      const posInPass = i % G
      // Order groups by ascending current size so we fill the emptiest group
      const sortedIds = [...groupIds].sort(
        (a, b) => groupAssign.get(a)!.length - groupAssign.get(b)!.length
      )
      // Snake: even passes left→right, odd passes right→left
      const ordered   = pass % 2 === 0 ? sortedIds : [...sortedIds].reverse()
      const targetId  = ordered[posInPass % ordered.length]
      groupAssign.get(targetId)!.push(playerList[i].id)
    }
  }

  snakeDistribute(remainingSeeded)

  // ── PASS 3: Round-robin unseeded players into remaining slots ─────────────
  // Fill groups from emptiest to fullest cyclically
  for (let i = 0; i < remainingUnseeded.length; i++) {
    const sortedIds = [...groupIds].sort(
      (a, b) => groupAssign.get(a)!.length - groupAssign.get(b)!.length
    )
    groupAssign.get(sortedIds[0])!.push(remainingUnseeded[i].id)
  }

  // ── Validate minimum group size ───────────────────────────────────────────
  for (const [gid, pids] of groupAssign) {
    if (pids.length < 2) {
      const grp = groups.find(g => g.id === gid)
      return { error: `Group ${grp?.group_number ?? '?'} would have only ${pids.length} player(s). Add more players or reduce the number of groups.` }
    }
  }

  // ── Write to DB ───────────────────────────────────────────────────────────
  await supabase.from('rr_group_members').delete().in('group_id', groupIds)

  const memberRows: { group_id: string; player_id: string }[] = []
  for (const [groupId, pids] of groupAssign) {
    for (const pid of pids) memberRows.push({ group_id: groupId, player_id: pid })
  }

  const { error: insErr } = await supabase.from('rr_group_members').insert(memberRows)
  if (insErr) return { error: insErr.message }

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateFixtures
// Reads group membership from DB, runs the circle-method scheduler,
// and inserts all fixtures as match rows (match_kind='round_robin').
// Idempotent: deletes existing RR matches for this stage first.
//
// Uniqueness guarantee:
//   (tournament_id, round, match_number) is unique.
//   We start match_number from max(existing)+1 to avoid collisions with
//   any KO matches that may already exist.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateFixtures(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string; matchCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load stage config for match format
  const { data: stage } = await supabase
    .from('stages')
    .select('id, config')
    .eq('id', stageId)
    .single()
  if (!stage) return { error: 'Stage not found' }

  const cfg = stage.config as RRStageConfig
  const matchFormat: MatchFormat = cfg.matchFormat ?? 'bo3'

  // Load groups with members
  const { data: groups, error: grpErr } = await supabase
    .from('rr_groups')
    .select('id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', stageId)
    .order('group_number')

  if (grpErr || !groups?.length) return { error: 'No groups found. Generate groups first.' }

  // Validate all groups have ≥2 members
  for (const g of groups) {
    const members = (g.rr_group_members as { player_id: string }[])
    if (members.length < 2) {
      return { error: `Group ${g.group_number} has ${members.length} player(s). Each group needs at least 2.` }
    }
  }

  // Find current max match_number to avoid collision
  const { data: maxRow } = await supabase
    .from('matches')
    .select('match_number')
    .eq('tournament_id', tournamentId)
    .order('match_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const matchNumOffset = maxRow?.match_number ?? 0

  // Build schedule
  const groupsInput = groups.map(g => ({
    groupNumber: g.group_number,
    playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  let fixtures: ReturnType<typeof generateMultiGroupSchedule>
  try {
    fixtures = generateMultiGroupSchedule(groupsInput, matchNumOffset)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const groupIdByNumber: Map<number, string> = new Map(groups.map(g => [g.group_number, g.id]))

  // Build match rows
  const matchRows = fixtures.map(f => {
    const groupId = groupIdByNumber.get(f.groupIndex + 1) ?? null
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
      status:         f.isBye ? 'bye' : 'pending',
      match_kind:     'round_robin',
      round_name:     `Match ${f.matchNumber}`,
    }
  })

  // Idempotent: delete existing RR matches for this stage
  await supabase.from('matches')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('stage_id', stageId)
    .eq('match_kind', 'round_robin')

  const { error: insErr } = await supabase.from('matches').insert(matchRows)
  if (insErr) return { error: insErr.message }

  // Activate stage + tournament
  await supabase.from('stages').update({ status: 'active' }).eq('id', stageId)
  await supabase.from('tournaments')
    .update({ status: 'active', published: true })
    .eq('id', tournamentId)
    .eq('status', 'setup')

  await revalidateTournamentPaths(supabase, tournamentId)
  return { matchCount: matchRows.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// getStageData
// SSR loader: returns everything needed to render the Stage 1 Groups tab.
// Called from the server component, not from client actions.
// ─────────────────────────────────────────────────────────────────────────────
export async function getStageData(
  tournamentId: string,
  stageId:      string,
): Promise<{
  stage:       Stage | null
  groups:      Array<RRGroup & { playerIds: string[] }>
  standings:   GroupStandings[]
  progress:    { completed: number; total: number; allDone: boolean }
  hasScores:   boolean
} | null> {
  const supabase = createClient()

  const { data: stage } = await supabase
    .from('stages')
    .select('*')
    .eq('id', stageId)
    .maybeSingle()

  if (!stage) return null

  const cfg = stage.config as RRStageConfig

  // Load groups + members
  const { data: groupRows } = await supabase
    .from('rr_groups')
    .select('id, stage_id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', stageId)
    .order('group_number')

  const groups: Array<RRGroup & { playerIds: string[] }> = (groupRows ?? []).map(g => ({
    id:          g.id,
    stageId:     g.stage_id,
    name:        g.name,
    groupNumber: g.group_number,
    playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  if (!groups.length) {
    return {
      stage:     stage as unknown as Stage,
      groups:    [],
      standings: [],
      progress:  { completed: 0, total: 0, allDone: false },
      hasScores: false,
    }
  }

  // Load RR matches + games
  const { data: matches } = await supabase
    .from('matches')
    .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed,club), games(id,game_number,score1,score2,winner_id,created_at,updated_at)')
    .eq('tournament_id', tournamentId)
    .eq('stage_id', stageId)
    .order('round')
    .order('match_number')

  const matchList = (matches ?? []) as unknown as import('@/lib/types').Match[]

  // Load players
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)

  const allGames = matchList.flatMap(m => m.games ?? [])
  const hasScores = allGames.some(g => g.score1 != null || g.score2 != null)

  // Compute standings using pure engine
  const standings = computeAllGroupStandings(
    groups,
    (players ?? []) as unknown as import('@/lib/types').Player[],
    matchList,
    allGames,
    cfg.advanceCount ?? 2,
  )

  const progress = groupProgress(matchList)

  return {
    stage:     stage as unknown as Stage,
    groups,
    standings,
    progress,
    hasScores,
  }
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
