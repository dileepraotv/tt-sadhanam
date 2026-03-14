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
import { computeGroupLayout, snakeAssign } from '@/lib/roundrobin/groupLayout'
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
  teamId:        string
  matchWins:     number
  matchLosses:   number
  rubberWins:    number   // individual rubber (submatch) wins
  rubberLosses:  number
  gameWins:      number   // individual game wins across all rubbers
  gameLosses:    number
  pointsFor:     number   // total points scored (sum of all game scores for this team)
  pointsAgainst: number
}

// ITTF tiebreak order:
// 1. Match wins (ties won)
// 2. Rubber W/L ratio (rubbers won ÷ rubbers played)
// 3. Game W/L ratio   (games won ÷ games played)
// 4. Points W/L ratio (points scored ÷ points played)
// 5. Head-to-head (if still tied between 2 teams)
function computeGroupStandings(
  groupId:  string,
  teamIds:  string[],
  matches:  TeamMatchRow[],
): TeamStanding[] {
  const map = new Map<string, TeamStanding>(
    teamIds.map(id => [id, {
      teamId: id,
      matchWins: 0, matchLosses: 0,
      rubberWins: 0, rubberLosses: 0,
      gameWins: 0, gameLosses: 0,
      pointsFor: 0, pointsAgainst: 0,
    }])
  )

  // Head-to-head tracker: h2h[a][b] = matches team a won against team b
  const h2h = new Map<string, Map<string, number>>()
  for (const id of teamIds) h2h.set(id, new Map())

  for (const m of matches) {
    if (m.group_id !== groupId || m.status !== 'complete') continue
    const sA = map.get(m.team_a_id)
    const sB = map.get(m.team_b_id)

    if (m.winner_team_id === m.team_a_id) {
      sA && sA.matchWins++
      sB && sB.matchLosses++
      h2h.get(m.team_a_id)?.set(m.team_b_id, (h2h.get(m.team_a_id)?.get(m.team_b_id) ?? 0) + 1)
    } else if (m.winner_team_id === m.team_b_id) {
      sB && sB.matchWins++
      sA && sA.matchLosses++
      h2h.get(m.team_b_id)?.set(m.team_a_id, (h2h.get(m.team_b_id)?.get(m.team_a_id) ?? 0) + 1)
    }

    for (const sm of m.submatches ?? []) {
      const sc = sm.scoring
      if (!sc || sc.status !== 'complete') continue
      const aWonRubber = sc.player1_games > sc.player2_games
      if (sA) {
        sA.rubberWins   += aWonRubber ? 1 : 0
        sA.rubberLosses += aWonRubber ? 0 : 1
        sA.gameWins     += sc.player1_games
        sA.gameLosses   += sc.player2_games
      }
      if (sB) {
        sB.rubberWins   += aWonRubber ? 0 : 1
        sB.rubberLosses += aWonRubber ? 1 : 0
        sB.gameWins     += sc.player2_games
        sB.gameLosses   += sc.player1_games
      }
    }

    // Points: need game scores from submatches — we track via submatches only
    // (already covered above via gameWins/gameLosses which ARE individual game counts)
  }

  const ratio = (w: number, l: number) => (w + l === 0 ? 0 : w / (w + l))

  const sorted = [...map.values()].sort((a, b) => {
    // 1. Match wins
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins
    // 2. Rubber ratio
    const rr = ratio(b.rubberWins, b.rubberLosses) - ratio(a.rubberWins, a.rubberLosses)
    if (Math.abs(rr) > 1e-9) return rr
    // 3. Game ratio
    const gr = ratio(b.gameWins, b.gameLosses) - ratio(a.gameWins, a.gameLosses)
    if (Math.abs(gr) > 1e-9) return gr
    // 4. Head-to-head (only meaningful when exactly 2 tied teams)
    const aWonH2H = h2h.get(a.teamId)?.get(b.teamId) ?? 0
    const bWonH2H = h2h.get(b.teamId)?.get(a.teamId) ?? 0
    if (aWonH2H !== bWonH2H) return bWonH2H - aWonH2H
    return 0
  })

  return sorted
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
    supabase.from('teams').select('id, name, seed')
      .eq('tournament_id', tournamentId).order('created_at'),
  ])

  const groups = groupsRes.data ?? []
  const teams  = teamsRes.data ?? []

  if (!groups.length) return { error: 'No groups found. Create the stage first.' }
  if (teams.length < 2) return { error: 'Need at least 2 teams.' }

  const G        = groups.length
  const groupIds = groups.map(g => g.id)

  // Sort: seeded teams by seed ascending, then unseeded alphabetically
  const seeded   = teams.filter(t => t.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
  const unseeded = teams.filter(t => t.seed == null).sort((a, b) => (a as any).name?.localeCompare?.((b as any).name) ?? 0)
  const ordered  = [...seeded, ...unseeded].map(t => t.id)

  // Snake assign: seed 1→G0, 2→G1, …, G→G(G-1), G+1→G(G-1), …, 2G→G0, …
  const buckets  = snakeAssign(ordered, G)
  const assign   = new Map<string, string[]>(groupIds.map((id, i) => [id, buckets[i] ?? []]))

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

  // Load groups and teams in parallel — 2 queries.
  // We DO NOT read team_rr_group_members from DB here; instead we re-run the
  // snake assignment in-memory (same algorithm as generateTeamGroups). This is
  // the only reliable way to guarantee fixtures match assignments regardless of
  // PostgREST schema-cache state or replication lag.
  const [groupsRes, teamsRes] = await Promise.all([
    supabase.from('rr_groups').select('id, group_number')
      .eq('stage_id', stageId).order('group_number'),
    supabase.from('teams')
      .select('id, name, seed, team_players(id, name, position)')
      .eq('tournament_id', tournamentId).order('created_at'),
  ])

  const groups   = groupsRes.data ?? []
  const allTeams = teamsRes.data ?? []
  if (!groups.length) return { error: 'No groups found.' }
  if (allTeams.length < 2) return { error: 'Need at least 2 teams.' }

  // Re-compute the snake assignment in-memory (identical algorithm to generateTeamGroups)
  const seededT   = allTeams.filter(t => t.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
  const unseededT = allTeams.filter(t => t.seed == null).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  const orderedIds = [...seededT, ...unseededT].map(t => t.id)
  const buckets    = snakeAssign(orderedIds, groups.length)

  // groupId → teamIds[]  (built from in-memory snake, same as what generateTeamGroups persists)
  const membersByGroup = new Map<string, string[]>()
  groups.forEach((g, i) => membersByGroup.set(g.id, buckets[i] ?? []))

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
    const teamIds = membersByGroup.get(group.id) ?? []
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

        // Pre-populate player assignments from team rosters
        const aPlayers = (teamA?.team_players ?? []).sort((p: any, q: any) => p.position - q.position)
        const bPlayers = (teamB?.team_players ?? []).sort((p: any, q: any) => p.position - q.position)

        // Position mapping per rubber (1-indexed positions):
        // Corbillon: S1(1vs1), S2(2vs2), D(1+2 vs 1+2), S3(1vs2), S4(2vs1)
        // Swaythling: S1(1vs1), S2(2vs2), S3(3vs3), S4(1vs2), S5(2vs1)
        const isCorbillon = formatType === 'team_group_corbillon'
        const rubbermapping = isCorbillon
          ? [[1,1,false],[2,2,false],[1,2,true],[1,2,false],[2,1,false]]   // [aPos, bPos, isDoubles]
          : [[1,1,false],[2,2,false],[3,3,false],[1,2,false],[2,1,false]]

        for (let ri = 0; ri < submatchRows.length; ri++) {
          const [aPos, bPos, isDbl] = rubbermapping[ri] ?? [0,0,false]
          const aP1  = aPlayers.find((p: any) => p.position === aPos)
          const bP1  = bPlayers.find((p: any) => p.position === bPos)
          const aP2  = isDbl ? aPlayers.find((p: any) => p.position === 2) : null
          const bP2  = isDbl ? bPlayers.find((p: any) => p.position === 2) : null
          const aName = aP1?.name ? (aP2?.name ? `${aP1.name} & ${aP2.name}` : aP1.name) : null
          const bName = bP1?.name ? (bP2?.name ? `${bP1.name} & ${bP2.name}` : bP1.name) : null
          if (aP1 || bP1) {
            Object.assign(submatchRows[ri], {
              team_a_player_id:  aP1?.id ?? null,
              team_b_player_id:  bP1?.id ?? null,
              team_a_player2_id: aP2?.id ?? null,
              team_b_player2_id: bP2?.id ?? null,
              player_a_name:     aName,
              player_b_name:     bName,
            })
          }
        }

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

  // 3 explicit queries (avoids FK-embedded-select issues for team_rr_group_members)
  const [groupsRes, matchesRes] = await Promise.all([
    supabase.from('rr_groups').select('id, group_number')
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

  // Derive group membership from the team_matches themselves (group_id is set on each fixture).
  // This is the most reliable source — no separate DB read needed, no FK-cache issues.
  const finalMembersByGroup = new Map<string, Set<string>>()
  for (const m of matches) {
    if (!m.group_id) continue
    const s = finalMembersByGroup.get(m.group_id) ?? new Set()
    s.add(m.team_a_id); s.add(m.team_b_id)
    finalMembersByGroup.set(m.group_id, s)
  }

  // Validate: all group matches complete
  const incomplete = matches.filter(m => m.group_id && m.status !== 'complete')
  if (incomplete.length > 0)
    return { error: `${incomplete.length} group match${incomplete.length > 1 ? 'es' : ''} still incomplete.` }

  // Build qualifiers: top advanceCount from each group (in-memory)
  const qualifiers: Array<{ teamId: string; groupRank: number; groupNum: number }> = []
  for (const group of groups) {
    const teamIds   = [...(finalMembersByGroup.get(group.id) ?? [])]
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
      .select('id, config, rr_groups(id, group_number, name)')
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
  // Load members explicitly
  const pubGroupIds = groups.map((g: any) => g.id)
  const { data: pubMembers } = pubGroupIds.length > 0
    ? await supabase.from('team_rr_group_members').select('group_id, team_id').in('group_id', pubGroupIds)
    : { data: [] }
  const pubMembersByGroup = new Map<string, string[]>()
  for (const row of pubMembers ?? []) {
    const arr = pubMembersByGroup.get(row.group_id) ?? []
    arr.push(row.team_id)
    pubMembersByGroup.set(row.group_id, arr)
  }

  const standings = groups.map((group: any) => {
    const teamIds = pubMembersByGroup.get(group.id) ?? []
    const rows    = computeGroupStandings(group.id, teamIds, rrMatches)
    return { groupId: group.id, groupNumber: group.group_number, groupName: group.name, rows, teams }
  })

  return { groups, teams, rrMatches, koMatches, standings, stage }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTeamGroupMatchWinner
// Manually set the winner of a team group/KO match (admin override).
// Also triggers KO propagation for KO matches.
// ─────────────────────────────────────────────────────────────────────────────

export async function updateTeamGroupMatchWinner(
  teamMatchId:   string,
  tournamentId:  string,
  winnerTeamId:  string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: tm } = await supabase
    .from('team_matches')
    .select('id, team_a_id, team_b_id, team_a_score, team_b_score, round, group_id')
    .eq('id', teamMatchId)
    .eq('tournament_id', tournamentId)
    .single()
  if (!tm) return { error: 'Match not found' }

  await supabase.from('team_matches').update({
    winner_team_id: winnerTeamId,
    status:         'complete',
    completed_at:   new Date().toISOString(),
  }).eq('id', teamMatchId)

  // Propagate to next KO match if applicable
  if (tm.round >= 900) {
    const { updateTeamKOWinner } = await import('./teamLeague')
    await updateTeamKOWinner(tournamentId, teamMatchId, winnerTeamId)
  }

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}
