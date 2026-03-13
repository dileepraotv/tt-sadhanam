'use server'

/**
 * actions/teamGroupKO.ts
 *
 * Server actions for the two new multi-stage team formats:
 *   team_group_corbillon  — Groups RR then Corbillon KO (4 singles + 1 doubles)
 *   team_group_swaythling — Groups RR then Swaythling KO (5 singles, no doubles)
 *
 * Data flow:
 *   1. Admin creates stage (createTeamRRStage) → rr_groups rows
 *   2. Admin assigns teams to groups (generateTeamGroups)
 *        → team_rr_group_members rows  [fill-then-spill algorithm]
 *   3. Admin generates group fixtures (generateTeamGroupFixtures)
 *        → team_matches (group_id set) + team_match_submatches + matches
 *   4. Admin finalises groups (finalizeTeamGroups)
 *        → reads group standings in-memory, generates KO team_matches
 *          (group_id = NULL, round ≥ 900)
 *
 * Chattiness principles:
 *   • All bulk inserts are done in 3 round-trips max (matches → team_matches → submatches).
 *   • updateSubmatchResult is tightened: 1 JOIN query replaces 2 separate selects.
 *   • Group standings are computed 100% in-memory from the already-loaded team_matches.
 *   • generateTeamGroups uses a single bulk insert for all memberships.
 *   • finalizeTeamGroups uses 2 parallel reads then 3 bulk inserts.
 */

import { createClient }               from '@/lib/supabase/server'
import { revalidateTournamentPaths }  from '@/lib/actions/stages'
import { computeGroupLayout }    from '@/lib/roundrobin/groupLayout'
import { nextPowerOf2 }          from '@/lib/utils'
import type { MatchFormat }      from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SubmatchDef = { order: number; label: string }

const CORBILLON_DEFS: SubmatchDef[] = [
  { order: 1, label: 'Singles 1 (A vs X)' },
  { order: 2, label: 'Singles 2 (B vs Y)' },
  { order: 3, label: 'Doubles (A/B vs X/Y)' },
  { order: 4, label: 'Singles 3 (A vs Y)' },
  { order: 5, label: 'Singles 4 (B vs X)' },
]

const SWAYTHLING_DEFS: SubmatchDef[] = [
  { order: 1, label: 'Singles 1 (A vs X)' },
  { order: 2, label: 'Singles 2 (B vs Y)' },
  { order: 3, label: 'Singles 3 (C vs Z)' },
  { order: 4, label: 'Singles 4 (A vs Y)' },
  { order: 5, label: 'Singles 5 (B vs X)' },
]

function submatchDefs(formatType: string): SubmatchDef[] {
  return formatType === 'team_group_corbillon' ? CORBILLON_DEFS : SWAYTHLING_DEFS
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper: build submatches rows for a team_match
// Returns [submatchRows, scoringMatchRows] to be bulk-inserted by the caller.
// ─────────────────────────────────────────────────────────────────────────────

function buildSubmatchRows(
  tmId:       string,
  roundN:     number,
  roundLabel: string,
  tmIndex:    number,         // 0-based position within round (for unique match_number)
  tournamentId: string,
  defs:       SubmatchDef[],
): { submatchRows: Record<string, unknown>[]; scoringRows: Record<string, unknown>[] } {
  const submatchRows: Record<string, unknown>[] = []
  const scoringRows:  Record<string, unknown>[] = []

  for (const sm of defs) {
    const smId    = globalThis.crypto.randomUUID()
    const matchId = globalThis.crypto.randomUUID()
    submatchRows.push({
      id:               smId,
      team_match_id:    tmId,
      match_order:      sm.order,
      label:            sm.label,
      player_a_name:    null,
      player_b_name:    null,
      team_a_player_id: null,
      team_b_player_id: null,
      match_id:         matchId,
    })
    scoringRows.push({
      id:            matchId,
      tournament_id: tournamentId,
      round:         roundN,
      match_number:  roundN * 1000 + tmIndex * 10 + sm.order,
      round_name:    `${roundLabel} — ${sm.label}`,
      player1_id:    null,
      player2_id:    null,
      player1_games: 0,
      player2_games: 0,
      winner_id:     null,
      status:        'pending',
      next_match_id: null,
      next_slot:     null,
      match_kind:    'team_submatch',
    })
  }

  return { submatchRows, scoringRows }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory group standings
// Operates on already-loaded team_matches data — zero extra DB queries.
// ─────────────────────────────────────────────────────────────────────────────

type TeamMatchRow = {
  id:             string
  team_a_id:      string
  team_b_id:      string
  team_a_score:   number
  team_b_score:   number
  winner_team_id: string | null
  status:         string
  group_id:       string | null
  submatches?:    Array<{
    match_id: string | null
    scoring:  { player1_games: number; player2_games: number; status: string } | null
  }>
}

interface TeamStanding {
  teamId:       string
  matchWins:    number
  matchLosses:  number
  submatchWins: number
  gameDiff:     number
}

function computeGroupStandings(
  groupId:  string,
  teamIds:  string[],
  matches:  TeamMatchRow[],
): TeamStanding[] {
  const map = new Map<string, TeamStanding>(
    teamIds.map(id => [id, { teamId: id, matchWins: 0, matchLosses: 0, submatchWins: 0, gameDiff: 0 }])
  )

  for (const m of matches) {
    if (m.group_id !== groupId || m.status !== 'complete') continue
    const sA = map.get(m.team_a_id)
    const sB = map.get(m.team_b_id)

    if (m.winner_team_id === m.team_a_id) {
      if (sA) { sA.matchWins++; }
      if (sB) { sB.matchLosses++; }
    } else if (m.winner_team_id === m.team_b_id) {
      if (sB) { sB.matchWins++; }
      if (sA) { sA.matchLosses++; }
    }

    for (const sm of m.submatches ?? []) {
      const sc = sm.scoring
      if (!sc || sc.status !== 'complete') continue
      if (sA) {
        sA.submatchWins += sc.player1_games > sc.player2_games ? 1 : 0
        sA.gameDiff     += sc.player1_games - sc.player2_games
      }
      if (sB) {
        sB.submatchWins += sc.player2_games > sc.player1_games ? 1 : 0
        sB.gameDiff     += sc.player2_games - sc.player1_games
      }
    }
  }

  return [...map.values()].sort((a, b) =>
    b.matchWins - a.matchWins ||
    b.submatchWins - a.submatchWins ||
    b.gameDiff - a.gameDiff
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// createTeamRRStage
// Creates a stages row + rr_groups rows for a team Group+KO event.
// Reuses the same stages + rr_groups tables as the singles multi-stage.
// ─────────────────────────────────────────────────────────────────────────────

export async function createTeamRRStage(input: {
  tournamentId:  string
  numberOfGroups: number
  advanceCount:  number        // top N teams per group advance
  matchFormat:   MatchFormat
}): Promise<{ error?: string; stageId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: _t } = await supabase.from('tournaments').select('id')
    .eq('id', input.tournamentId).eq('created_by', user.id).single()
  if (!_t) return { error: 'Tournament not found' }

  if (input.numberOfGroups < 1) return { error: 'Need at least 1 group' }
  if (input.advanceCount < 1)   return { error: 'At least 1 team must advance per group' }

  // Guard: no existing stage
  const { data: existing } = await supabase
    .from('stages').select('id')
    .eq('tournament_id', input.tournamentId)
    .eq('stage_number', 1)
    .maybeSingle()
  if (existing) return { error: 'A stage already exists. Reset it first.' }

  // Insert stage
  const { data: stage, error: stageErr } = await supabase
    .from('stages')
    .insert({
      tournament_id: input.tournamentId,
      stage_number:  1,
      stage_type:    'round_robin',
      config: {
        numberOfGroups: input.numberOfGroups,
        advanceCount:   input.advanceCount,
        matchFormat:    input.matchFormat,
        allowBestThird:  false,
        bestThirdCount:  0,
        finalizationRule: 'require_all',
      },
      status: 'pending',
    })
    .select('id').single()
  if (stageErr || !stage) return { error: stageErr?.message ?? 'Failed to create stage' }

  // Insert rr_groups
  const groupRows = Array.from({ length: input.numberOfGroups }, (_, i) => ({
    stage_id:     stage.id,
    name:         `Group ${i + 1}`,
    group_number: i + 1,
  }))
  const { error: grpErr } = await supabase.from('rr_groups').insert(groupRows)
  if (grpErr) {
    await supabase.from('stages').delete().eq('id', stage.id)
    return { error: grpErr.message }
  }

  // Record on tournament
  await supabase.from('tournaments').update({
    rr_groups:        input.numberOfGroups,
    rr_advance_count: input.advanceCount,
  }).eq('id', input.tournamentId)

  await revalidateTournamentPaths(supabase, input.tournamentId)
  return { stageId: stage.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamGroups
// Distributes teams into rr_groups using the fill-then-spill algorithm.
// Seeded teams snake across groups; unseeded teams are round-robined.
// Idempotent: clears existing team_rr_group_members before inserting.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateTeamGroups(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load groups and teams in parallel — 2 queries
  const [groupsRes, teamsRes] = await Promise.all([
    supabase.from('rr_groups').select('id, group_number')
      .eq('stage_id', stageId).order('group_number'),
    supabase.from('teams').select('id, seed')
      .eq('tournament_id', tournamentId).order('created_at'),
  ])

  const groups = groupsRes.data ?? []
  const teams  = teamsRes.data ?? []

  if (!groups.length) return { error: 'No groups found. Create the stage first.' }
  if (teams.length < 2) return { error: 'Need at least 2 teams.' }

  const G        = groups.length
  const groupIds = groups.map(g => g.id)
  const assign   = new Map<string, string[]>(groupIds.map(id => [id, []]))

  // Fill-then-spill: same algorithm as player groups
  const ceil = Math.ceil(teams.length / G)
  let rrTie  = 0

  function pick(teamId: string) {
    const eligible = groupIds.filter(id => assign.get(id)!.length < ceil)
    const pool     = eligible.length ? eligible : groupIds
    const minSize  = Math.min(...pool.map(id => assign.get(id)!.length))
    const smallest = pool.filter(id => assign.get(id)!.length === minSize)
    assign.get(smallest[rrTie % smallest.length])!.push(teamId)
    rrTie++
  }

  // Seeded first (snake), then unseeded
  const seeded   = teams.filter(t => t.seed != null).sort((a, b) => a.seed! - b.seed!)
  const unseeded = teams.filter(t => t.seed == null)
  for (const t of seeded)   pick(t.id)
  for (const t of unseeded) pick(t.id)

  // Validate: every group ≥ 2
  for (const [gid, tids] of assign) {
    if (tids.length < 2) {
      const g = groups.find(g => g.id === gid)
      return { error: `Group ${g?.group_number} has only ${tids.length} team(s). Add more teams or reduce the group count.` }
    }
  }

  // Clear old memberships + bulk insert new ones — 2 queries
  await supabase.from('team_rr_group_members').delete()
    .in('group_id', groupIds)

  const rows: { group_id: string; team_id: string }[] = []
  for (const [gid, tids] of assign)
    for (const tid of tids)
      rows.push({ group_id: gid, team_id: tid })

  const { error: insErr } = await supabase.from('team_rr_group_members').insert(rows)
  if (insErr) return { error: insErr.message }

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamGroupFixtures
// Reads team_rr_group_members → generates round-robin team fixtures per group.
// 3 bulk inserts: scoring matches → team_matches → submatches.
// Idempotent: clears existing group fixtures (round < 900) before inserting.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateTeamGroupFixtures(
  stageId:      string,
  tournamentId: string,
  formatType:   string,
): Promise<{ error?: string; fixtureCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load groups + members + team players in parallel — 2 queries
  const [membersRes, teamsRes] = await Promise.all([
    supabase.from('rr_groups').select('id, group_number, team_rr_group_members(team_id)')
      .eq('stage_id', stageId).order('group_number'),
    supabase.from('teams')
      .select('id, name, team_players(id, name, position)')
      .eq('tournament_id', tournamentId),
  ])

  const groups  = membersRes.data ?? []
  const allTeams = teamsRes.data ?? []
  if (!groups.length) return { error: 'No groups found.' }

  const teamById = new Map(allTeams.map(t => [t.id, t]))
  const defs     = submatchDefs(formatType)

  // Clear existing group fixtures and their scoring rows — 3 queries
  const { data: oldTMs } = await supabase.from('team_matches').select('id')
    .eq('tournament_id', tournamentId).lt('round', 900).not('group_id', 'is', null)

  const oldIds = (oldTMs ?? []).map(m => m.id)
  if (oldIds.length > 0) {
    const { data: oldSMs } = await supabase.from('team_match_submatches')
      .select('match_id').in('team_match_id', oldIds)
    const oldMatchIds = (oldSMs ?? []).map(s => s.match_id).filter(Boolean) as string[]
    if (oldMatchIds.length > 0) {
      await supabase.from('games').delete().in('match_id', oldMatchIds)
      await supabase.from('matches').delete().in('id', oldMatchIds)
    }
    await supabase.from('team_match_submatches').delete().in('team_match_id', oldIds)
    await supabase.from('team_matches').delete().in('id', oldIds)
  }

  const allScoringRows:  Record<string, unknown>[] = []
  const allTeamMatches:  Record<string, unknown>[] = []
  const allSubmatchRows: Record<string, unknown>[] = []

  let globalRound = 1    // unique round number across all groups

  for (const group of groups) {
    const members = (group as unknown as { team_rr_group_members: { team_id: string }[] })
      .team_rr_group_members ?? []
    const teamIds = members.map(m => m.team_id)
    if (teamIds.length < 2) continue

    // Round-robin: every pair meets once
    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        const tmId   = globalThis.crypto.randomUUID()
        const teamA  = teamById.get(teamIds[i])
        const teamB  = teamById.get(teamIds[j])
        const label  = `Group ${group.group_number} R${globalRound}`
        const tmIdx  = allTeamMatches.length   // unique within whole insert batch

        allTeamMatches.push({
          id:            tmId,
          tournament_id: tournamentId,
          team_a_id:     teamIds[i],
          team_b_id:     teamIds[j],
          round:         globalRound,
          round_name:    label,
          group_id:      group.id,
          status:        'pending',
          team_a_score:  0,
          team_b_score:  0,
        })

        const { submatchRows, scoringRows } = buildSubmatchRows(
          tmId, globalRound, label, tmIdx, tournamentId, defs,
        )
        allSubmatchRows.push(...submatchRows)
        allScoringRows.push(...scoringRows)
        globalRound++
      }
    }
  }

  if (allTeamMatches.length === 0) return { error: 'No fixtures could be generated. Assign teams to groups first.' }

  // 3 bulk inserts
  if (allScoringRows.length > 0) {
    const { error } = await supabase.from('matches').insert(allScoringRows)
    if (error) return { error: error.message }
  }
  const { error: tmErr } = await supabase.from('team_matches').insert(allTeamMatches)
  if (tmErr) return { error: tmErr.message }
  if (allSubmatchRows.length > 0) {
    const { error } = await supabase.from('team_match_submatches').insert(allSubmatchRows)
    if (error) return { error: error.message }
  }

  await supabase.from('tournaments').update({ status: 'active', published: true })
    .eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return { fixtureCount: allTeamMatches.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// finalizeTeamGroups
// Reads group standings in-memory (from 2 parallel DB queries), then
// generates KO team_matches in 3 bulk inserts.
// ─────────────────────────────────────────────────────────────────────────────

export async function finalizeTeamGroups(
  stageId:      string,
  tournamentId: string,
  formatType:   string,
  advanceCount: number,    // top N teams per group advance to KO
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // 2 parallel loads
  const [groupsRes, matchesRes] = await Promise.all([
    supabase.from('rr_groups')
      .select('id, group_number, team_rr_group_members(team_id)')
      .eq('stage_id', stageId).order('group_number'),
    supabase.from('team_matches')
      .select(`id, team_a_id, team_b_id, team_a_score, team_b_score,
               winner_team_id, status, group_id,
               submatches:team_match_submatches(
                 match_id,
                 scoring:match_id(player1_games, player2_games, status)
               )`)
      .eq('tournament_id', tournamentId)
      .lt('round', 900),
  ])

  const groups  = groupsRes.data ?? []
  const matches = (matchesRes.data ?? []) as unknown as TeamMatchRow[]

  if (!groups.length) return { error: 'No groups found.' }

  // Validate: all group matches complete
  const incomplete = matches.filter(m => m.group_id && m.status !== 'complete')
  if (incomplete.length > 0)
    return { error: `${incomplete.length} group match${incomplete.length > 1 ? 'es' : ''} still incomplete.` }

  // Build qualifiers: top advanceCount from each group (in-memory)
  const qualifiers: Array<{ teamId: string; groupRank: number; groupNum: number }> = []
  for (const group of groups) {
    const members = (group as unknown as { team_rr_group_members: { team_id: string }[] })
      .team_rr_group_members ?? []
    const teamIds   = members.map(m => m.team_id)
    const standings = computeGroupStandings(group.id, teamIds, matches)
    standings.slice(0, advanceCount).forEach((s, idx) => {
      qualifiers.push({ teamId: s.teamId, groupRank: idx + 1, groupNum: group.group_number })
    })
  }

  if (qualifiers.length < 2) return { error: 'Not enough qualifiers for a knockout bracket.' }

  // Seed KO bracket: snake across groups (G1-1st, G2-1st, …, G1-2nd, G2-2nd, …)
  // This ensures group winners don't meet until the later rounds.
  const koSeeded: string[] = []
  for (let rank = 1; rank <= advanceCount; rank++) {
    const slice = qualifiers.filter(q => q.groupRank === rank)
    // Reverse every other rank (snake) so 1st-place teams spread across the bracket
    if (rank % 2 === 0) slice.reverse()
    koSeeded.push(...slice.map(q => q.teamId))
  }

  // Build KO bracket (same complement-interleave as existing KO generators)
  const N           = koSeeded.length
  const bracketSize = nextPowerOf2(N)
  const defs        = submatchDefs(formatType)

  function buildSeedOrder(size: number): number[] {
    let order: number[] = [1]
    let cur = 1
    while (cur < size) {
      cur *= 2
      const next: number[] = []
      for (const x of order) { next.push(x); next.push(cur + 1 - x) }
      order = next
    }
    return order
  }

  const seedOrder = buildSeedOrder(bracketSize)
  const numRounds = Math.log2(bracketSize)

  function roundName(r: number): string {
    const rem = numRounds - r + 1
    if (rem === 1) return 'Final'
    if (rem === 2) return 'Semi-Final'
    if (rem === 3) return 'Quarter-Final'
    return `Round of ${bracketSize / Math.pow(2, r - 1)}`
  }

  const slotTeam = (slot: number): string | null => {
    const rank = seedOrder[slot]
    return rank <= N ? koSeeded[rank - 1] : null
  }

  // Delete any existing KO team_matches — 3 queries
  const { data: existingKO } = await supabase.from('team_matches').select('id')
    .eq('tournament_id', tournamentId).gte('round', 900)
  if (existingKO && existingKO.length > 0) {
    const ids = existingKO.map(m => m.id)
    const { data: sms } = await supabase.from('team_match_submatches')
      .select('match_id').in('team_match_id', ids)
    const mids = (sms ?? []).map(s => s.match_id).filter(Boolean) as string[]
    if (mids.length > 0) {
      await supabase.from('games').delete().in('match_id', mids)
      await supabase.from('matches').delete().in('id', mids)
    }
    await supabase.from('team_match_submatches').delete().in('team_match_id', ids)
    await supabase.from('team_matches').delete().in('id', ids)
  }

  const allScoringRows:  Record<string, unknown>[] = []
  const allTeamMatches:  Record<string, unknown>[] = []
  const allSubmatchRows: Record<string, unknown>[] = []

  let curSlots: (string | null)[] = Array.from({ length: bracketSize }, (_, i) => slotTeam(i))

  for (let r = 1; r <= numRounds; r++) {
    const nextSlots: (string | null)[] = []
    let tmIndex = 0

    for (let i = 0; i < curSlots.length; i += 2) {
      const tA = curSlots[i]
      const tB = curSlots[i + 1]
      const isBye      = r === 1 && (tA === null) !== (tB === null)
      const byeWinner  = isBye ? (tA ?? tB) : null
      nextSlots.push(byeWinner ?? null)

      if (isBye) { tmIndex++; continue }

      const tmId    = globalThis.crypto.randomUUID()
      const roundN  = 900 + r - 1
      const rLabel  = roundName(r)

      allTeamMatches.push({
        id:            tmId,
        tournament_id: tournamentId,
        team_a_id:     tA ?? null,
        team_b_id:     tB ?? null,
        round:         roundN,
        round_name:    rLabel,
        group_id:      null,    // KO match — not in any group
        status:        'pending',
        team_a_score:  0,
        team_b_score:  0,
      })

      const { submatchRows, scoringRows } = buildSubmatchRows(
        tmId, roundN, rLabel, tmIndex, tournamentId, defs,
      )
      allSubmatchRows.push(...submatchRows)
      allScoringRows.push(...scoringRows)
      tmIndex++
    }

    curSlots = nextSlots
    if (curSlots.length <= 1) break
  }

  // 3 bulk inserts
  if (allScoringRows.length > 0) {
    const { error } = await supabase.from('matches').insert(allScoringRows)
    if (error) return { error: error.message }
  }
  if (allTeamMatches.length > 0) {
    const { error } = await supabase.from('team_matches').insert(allTeamMatches)
    if (error) return { error: error.message }
  }
  if (allSubmatchRows.length > 0) {
    const { error } = await supabase.from('team_match_submatches').insert(allSubmatchRows)
    if (error) return { error: error.message }
  }

  // Mark stage 2 generated
  await supabase.from('tournaments').update({ stage2_bracket_generated: true })
    .eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// resetTeamGroupStage
// Deletes all group fixtures, KO fixtures, stage + groups, and clears
// team_rr_group_members. Teams themselves are preserved.
// ─────────────────────────────────────────────────────────────────────────────

export async function resetTeamGroupStage(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: _t } = await supabase.from('tournaments').select('id')
    .eq('id', tournamentId).eq('created_by', user.id).single()
  if (!_t) return { error: 'Tournament not found' }

  // Delete all team_matches (group + KO) with their submatches + scoring
  const { data: tms } = await supabase.from('team_matches').select('id')
    .eq('tournament_id', tournamentId)
  const tmIds = (tms ?? []).map(m => m.id)

  if (tmIds.length > 0) {
    const { data: sms } = await supabase.from('team_match_submatches')
      .select('match_id').in('team_match_id', tmIds)
    const mids = (sms ?? []).map(s => s.match_id).filter(Boolean) as string[]
    if (mids.length > 0) {
      await supabase.from('games').delete().in('match_id', mids)
      await supabase.from('matches').delete().in('id', mids)
    }
    await supabase.from('team_match_submatches').delete().in('team_match_id', tmIds)
    await supabase.from('team_matches').delete().eq('tournament_id', tournamentId)
  }

  // Clear group memberships (cascade deletes when groups are deleted, but be explicit)
  const { data: groups } = await supabase.from('rr_groups').select('id')
    .eq('stage_id', stageId)
  const gIds = (groups ?? []).map(g => g.id)
  if (gIds.length > 0)
    await supabase.from('team_rr_group_members').delete().in('group_id', gIds)

  // Delete stage (cascades to rr_groups)
  await supabase.from('stages').delete().eq('id', stageId)

  // Reset tournament state
  await supabase.from('tournaments').update({
    bracket_generated:        false,
    stage2_bracket_generated: false,
    status:                   'setup',
    rr_groups:                null,
    rr_advance_count:         null,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// getTeamGroupStageData
// Single server-side data loader for the public view.
// Returns groups + members + standings (in-memory) + KO matches.
// 3 fully-parallel queries — rr_groups is embedded in the stages select so no
// serial 4th round-trip is needed after the stage id is known.
// ─────────────────────────────────────────────────────────────────────────────

export async function getTeamGroupStageData(tournamentId: string) {
  const supabase = createClient()

  const [stageRes, teamsRes, matchesRes] = await Promise.all([
    // Embed rr_groups + members directly — avoids a serial query after stage id resolves
    supabase.from('stages')
      .select('id, config, rr_groups(id, group_number, name, team_rr_group_members(team_id))')
      .eq('tournament_id', tournamentId).eq('stage_number', 1).maybeSingle(),
    supabase.from('teams').select('id, name, short_name, color, seed, team_players(id, name, position)')
      .eq('tournament_id', tournamentId).order('created_at'),
    supabase.from('team_matches')
      .select(`id, team_a_id, team_b_id, team_a_score, team_b_score,
               winner_team_id, status, round, round_name, group_id,
               submatches:team_match_submatches(
                 id, match_order, label,
                 player_a_name, player_b_name,
                 match_id,
                 scoring:match_id(id, player1_games, player2_games, status)
               )`)
      .eq('tournament_id', tournamentId)
      .order('round'),
  ])

  const stage   = stageRes.data
  const teams   = teamsRes.data ?? []
  const matches = (matchesRes.data ?? []) as unknown as TeamMatchRow[]

  if (!stage) return { groups: [], teams, rrMatches: [], koMatches: [], standings: [] }

  // rr_groups already loaded via join — no extra round-trip needed
  const groups    = (stage as unknown as { rr_groups: typeof stageRes.data extends null ? never[] : any[] }).rr_groups ?? []
  const rrMatches = matches.filter(m => m.group_id != null)
  const koMatches = matches.filter(m => m.group_id == null && (m as any).round >= 900)

  // Compute standings in-memory
  const standings = groups.map((group: any) => {
    const members = (group.team_rr_group_members ?? []) as { team_id: string }[]
    const teamIds = members.map(m => m.team_id)
    const rows    = computeGroupStandings(group.id, teamIds, rrMatches)
    return { groupId: group.id, groupNumber: group.group_number, groupName: group.name, rows, teams }
  })

  return { groups, teams, rrMatches, koMatches, standings, stage }
}
