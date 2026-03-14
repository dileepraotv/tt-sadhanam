'use server'

/**
 * actions/teamLeague.ts
 *
 * Server actions for the team_league format.
 *
 * Data model:
 *   teams               — Team rows (name, color, short_name)
 *   team_players        — Players belonging to a team (position 1..N)
 *   team_matches        — Team fixture (Team A vs Team B in round R)
 *   team_match_submatches — Individual singles/doubles matches within a team fixture
 *   matches             — Scoring rows for each submatch (match_kind='team_submatch')
 *
 * Team match scoring:
 *   First team to win ceil(submatches/2) individual matches wins the team match.
 *   team_matches.team_a_score / team_b_score tracks wins.
 *   advanceDEPlayers is NOT involved — team logic is self-contained here.
 */

import { revalidatePath } from 'next/cache'
import { createClient }   from '@/lib/supabase/server'
import type { MatchFormat } from '@/lib/types'
import { revalidateTournamentPaths } from '@/lib/actions/stages'
import { nextPowerOf2 }   from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// createTeam
// ─────────────────────────────────────────────────────────────────────────────
export async function createTeam(input: {
  tournamentId:  string
  name:          string
  shortName?:    string
  color?:        string
  seed?:         number | null
  doublesP1Pos?: number | null
  doublesP2Pos?: number | null
}): Promise<{ error?: string; teamId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', input.tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  const { data, error } = await supabase
    .from('teams')
    .insert({
      tournament_id:  input.tournamentId,
      name:           input.name.trim(),
      short_name:     input.shortName?.trim() || null,
      color:          input.color || null,
      seed:           input.seed ?? null,
      doubles_p1_pos: input.doublesP1Pos ?? null,
      doubles_p2_pos: input.doublesP2Pos ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, input.tournamentId)
  return { teamId: data.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteTeam
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// updateTeam
// ─────────────────────────────────────────────────────────────────────────────
export async function updateTeam(input: {
  teamId:        string
  tournamentId:  string
  name?:         string
  shortName?:    string
  color?:        string
  seed?:         number | null
  doublesP1Pos?: number | null
  doublesP2Pos?: number | null
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const payload: Record<string, unknown> = {}
  if (input.name        !== undefined) payload.name          = input.name?.trim()
  if (input.shortName   !== undefined) payload.short_name    = input.shortName?.trim() || null
  if (input.color       !== undefined) payload.color         = input.color
  if (input.seed        !== undefined) payload.seed          = input.seed ?? null
  if (input.doublesP1Pos !== undefined) payload.doubles_p1_pos = input.doublesP1Pos ?? null
  if (input.doublesP2Pos !== undefined) payload.doubles_p2_pos = input.doublesP2Pos ?? null

  const { error } = await supabase.from('teams').update(payload).eq('id', input.teamId)
  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, input.tournamentId)
  return {}
}

export async function deleteTeam(
  teamId: string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Guard: check no team matches exist yet
  const { count } = await supabase
    .from('team_matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  if ((count ?? 0) > 0) return { error: 'Cannot delete a team after the schedule has been generated.' }

  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertTeamPlayers
// Replaces all players for a team in one call.
// ─────────────────────────────────────────────────────────────────────────────
export async function upsertTeamPlayers(input: {
  teamId:      string
  tournamentId: string
  players:     Array<{ name: string; position: number }>
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete existing
  await supabase.from('team_players').delete().eq('team_id', input.teamId)

  if (input.players.length === 0) {
    await revalidateTournamentPaths(supabase, input.tournamentId)
    return {}
  }

  const { error } = await supabase.from('team_players').insert(
    input.players.map(p => ({
      team_id:  input.teamId,
      name:     p.name.trim(),
      position: p.position,
    }))
  )

  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, input.tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamSchedule
// Round-robin schedule for teams: each team plays each other team once.
// For each team fixture, creates the ITTF-style 5-submatch structure:
//   Match 1: A1 vs B1
//   Match 2: A2 vs B2
//   Match 3: Doubles (A1+A2 vs B1+B2)
//   Match 4: A1 vs B2
//   Match 5: A2 vs B1
// First team to win 3 of 5 wins the team match.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateTeamSchedule(
  tournamentId: string,
  matchFormat: MatchFormat = 'bo5',
): Promise<{ error?: string; teamMatchCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load teams with players
  const { data: teams, error: tErr } = await supabase
    .from('teams')
    .select('id, name, team_players(id, name, position)')
    .eq('tournament_id', tournamentId)
    .order('created_at')
  if (tErr) return { error: tErr.message }
  if (!teams || teams.length < 2) return { error: 'Need at least 2 teams.' }

  // Clear any existing schedule
  const { data: existingTMs } = await supabase
    .from('team_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const existingTMIds = (existingTMs ?? []).map(m => m.id)
  if (existingTMIds.length > 0) {
    await supabase.from('team_match_submatches').delete().in('team_match_id', existingTMIds)
    await supabase.from('team_matches').delete().eq('tournament_id', tournamentId)
  }

  // Round-robin team fixture generation (circle method for team pairs)
  // For N teams: each pair meets exactly once, N*(N-1)/2 team fixtures
  const teamMatchRows: Record<string, unknown>[] = []
  const submatchRows: Record<string, unknown>[]  = []
  const scoringMatchRows: Record<string, unknown>[] = []

  const crypto = require('crypto')

  let round = 1
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const tmId    = crypto.randomUUID() as string
      const teamA   = teams[i] as typeof teams[0] & { team_players: { id: string; name: string; position: number }[] }
      const teamB   = teams[j] as typeof teams[0] & { team_players: { id: string; name: string; position: number }[] }

      const playersA = [...(teamA.team_players ?? [])].sort((a, b) => a.position - b.position)
      const playersB = [...(teamB.team_players ?? [])].sort((a, b) => a.position - b.position)

      const a1 = playersA[0] ?? null
      const a2 = playersA[1] ?? null
      const b1 = playersB[0] ?? null
      const b2 = playersB[1] ?? null

      teamMatchRows.push({
        id:            tmId,
        tournament_id: tournamentId,
        team_a_id:     teamA.id,
        team_b_id:     teamB.id,
        round,
        round_name:    `Round ${round}`,
        status:        'pending',
        team_a_score:  0,
        team_b_score:  0,
      })

      // ITTF-style 5 submatches
      const submatchDefs = [
        { order: 1, label: 'Singles 1',  pa: a1, pb: b1 },
        { order: 2, label: 'Singles 2',  pa: a2, pb: b2 },
        { order: 3, label: 'Doubles',    pa: null, pb: null },  // no individual player FK for doubles
        { order: 4, label: 'Singles 3',  pa: a1, pb: b2 },
        { order: 5, label: 'Singles 4',  pa: a2, pb: b1 },
      ]

      for (const sm of submatchDefs) {
        const smId      = crypto.randomUUID() as string
        const matchId   = crypto.randomUUID() as string

        submatchRows.push({
          id:               smId,
          team_match_id:    tmId,
          match_order:      sm.order,
          label:            sm.label,
          player_a_name:    sm.pa?.name ?? null,
          player_b_name:    sm.pb?.name ?? null,
          team_a_player_id: sm.pa?.id   ?? null,
          team_b_player_id: sm.pb?.id   ?? null,
          match_id:         matchId,
        })

        scoringMatchRows.push({
          id:            matchId,
          tournament_id: tournamentId,
          round,
          match_number:  (round - 1) * 5 + sm.order,
          round_name:    `R${round} — ${teamA.name} vs ${teamB.name} — ${sm.label}`,
          player1_id:    null,   // team_players are NOT in the players table
          player2_id:    null,   // names are stored in team_match_submatches instead
          player1_games: 0,
          player2_games: 0,
          winner_id:     null,
          status:        'pending',
          next_match_id: null,
          next_slot:     null,
          match_kind:    'team_submatch',
        })
      }

      round++
    }
  }

  // Insert all in order
  if (scoringMatchRows.length > 0) {
    const { error: mErr } = await supabase.from('matches').insert(scoringMatchRows)
    if (mErr) return { error: mErr.message }
  }

  const { error: tmErr } = await supabase.from('team_matches').insert(teamMatchRows)
  if (tmErr) return { error: tmErr.message }

  if (submatchRows.length > 0) {
    const { error: smErr } = await supabase.from('team_match_submatches').insert(submatchRows)
    if (smErr) return { error: smErr.message }
  }

  // Mark tournament active + published
  await supabase.from('tournaments').update({
    bracket_generated: true,
    status:            'active',
    published:         true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return { teamMatchCount: teamMatchRows.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateSubmatchResult
// Called when a submatch scoring match completes.
// Updates team_a_score / team_b_score on the parent team_match.
// Marks team_match complete when first team reaches 3 wins.
// ─────────────────────────────────────────────────────────────────────────────
export async function updateSubmatchResult(
  scoringMatchId: string,
  tournamentId:   string,
): Promise<{ error?: string }> {
  const supabase = createClient()

  // Step 1: find the submatch row to get its parent team_match_id
  const { data: submatch } = await supabase
    .from('team_match_submatches')
    .select('id, team_match_id')
    .eq('match_id', scoringMatchId)
    .single()
  if (!submatch) return {}  // not a team submatch

  // Step 2: load the parent team_match (flat, no FK joins)
  // Also fetch round + group_id so we know whether this is a group or KO match
  const { data: teamMatch } = await supabase
    .from('team_matches')
    .select('id, team_a_id, team_b_id, status, round, group_id')
    .eq('id', submatch.team_match_id)
    .single()
  if (!teamMatch) return {}
  // NOTE: Do NOT return early if status === 'complete'.
  // Edits to individual rubbers must always trigger a full recount so the
  // team score and winner reflect the current state of all rubbers.

  // Step 3: recount ALL completed submatches for this team match from scratch.
  // This is idempotent — no matter how many times called, result is always correct.
  const { data: allSMs } = await supabase
    .from('team_match_submatches')
    .select('match_id')
    .eq('team_match_id', submatch.team_match_id)
  const smMatchIds = (allSMs ?? []).map(s => s.match_id).filter(Boolean) as string[]

  let scoreA = 0, scoreB = 0
  if (smMatchIds.length > 0) {
    const { data: allScoring } = await supabase
      .from('matches')
      .select('id, player1_games, player2_games, status')
      .in('id', smMatchIds)
    for (const s of allScoring ?? []) {
      if (s.status !== 'complete') continue
      if ((s.player1_games ?? 0) > (s.player2_games ?? 0)) scoreA++
      else if ((s.player2_games ?? 0) > (s.player1_games ?? 0)) scoreB++
    }
  }

  const winsNeeded = 3  // best of 5 — first to 3
  const isComplete = scoreA >= winsNeeded || scoreB >= winsNeeded
  const winnerId   = isComplete
    ? (scoreA >= winsNeeded ? teamMatch.team_a_id : teamMatch.team_b_id)
    : null

  await supabase.from('team_matches').update({
    team_a_score:   scoreA,
    team_b_score:   scoreB,
    status:         isComplete ? 'complete' : 'live',
    winner_team_id: winnerId,
    completed_at:   isComplete ? new Date().toISOString() : null,
  }).eq('id', submatch.team_match_id)

  // ONLY propagate to next KO round for actual knockout matches (round >= 900).
  // Group stage matches (group_id != null, round < 900) MUST NOT propagate —
  // they would corrupt other group fixtures by overwriting team_a_id/team_b_id.
  const isKOMatch = !teamMatch.group_id && teamMatch.round >= 900
  if (isComplete && winnerId && isKOMatch) {
    await updateTeamKOWinner(tournamentId, submatch.team_match_id, winnerId)
  }

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// updateSubmatchPlayers
// Sets the player assignments for a single submatch row.
// Looks up names from team_players so the UI only needs to pass IDs.
// ─────────────────────────────────────────────────────────────────────────────
export async function updateSubmatchPlayers(input: {
  submatchId:      string
  tournamentId:    string
  teamAPlayerId:   string | null   // null = clear; first player (or only for singles)
  teamBPlayerId:   string | null
  teamAPlayer2Id?: string | null   // second player for doubles (Team A)
  teamBPlayer2Id?: string | null   // second player for doubles (Team B)
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve names from team_players table for all supplied IDs
  let aName: string | null = null
  let bName: string | null = null

  const allIds = [
    input.teamAPlayerId, input.teamBPlayerId,
    input.teamAPlayer2Id, input.teamBPlayer2Id,
  ].filter(Boolean) as string[]

  if (allIds.length > 0) {
    const { data: rows } = await supabase
      .from('team_players')
      .select('id, name')
      .in('id', allIds)
    const byId = Object.fromEntries((rows ?? []).map(r => [r.id, r.name]))

    // For doubles, combine both player names: "P1 & P2"
    const a1 = input.teamAPlayerId  ? (byId[input.teamAPlayerId]  ?? null) : null
    const a2 = input.teamAPlayer2Id ? (byId[input.teamAPlayer2Id] ?? null) : null
    const b1 = input.teamBPlayerId  ? (byId[input.teamBPlayerId]  ?? null) : null
    const b2 = input.teamBPlayer2Id ? (byId[input.teamBPlayer2Id] ?? null) : null

    aName = a1 && a2 ? `${a1} & ${a2}` : (a1 ?? null)
    bName = b1 && b2 ? `${b1} & ${b2}` : (b1 ?? null)
  }

  const updatePayload: Record<string, unknown> = {
    team_a_player_id:  input.teamAPlayerId,
    team_b_player_id:  input.teamBPlayerId,
    player_a_name:     aName,
    player_b_name:     bName,
  }
  // Only write the doubles columns if the DB has them (graceful fallback)
  if (input.teamAPlayer2Id !== undefined) updatePayload.team_a_player2_id = input.teamAPlayer2Id ?? null
  if (input.teamBPlayer2Id !== undefined) updatePayload.team_b_player2_id = input.teamBPlayer2Id ?? null

  const { error } = await supabase
    .from('team_match_submatches')
    .update(updatePayload)
    .eq('id', input.submatchId)

  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, input.tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// resetTeamLeague
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// batchUpdateSubmatchPlayers
// Saves player assignments for ALL submatches in one team match at once.
// One auth check, one player-name lookup, one update per row, one revalidate.
// ─────────────────────────────────────────────────────────────────────────────
export async function batchUpdateSubmatchPlayers(input: {
  tournamentId: string
  submatches: Array<{
    submatchId:      string
    teamAPlayerId:   string | null
    teamBPlayerId:   string | null
    teamAPlayer2Id?: string | null
    teamBPlayer2Id?: string | null
  }>
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve all player names in a single query
  const allIds = Array.from(new Set(
    input.submatches.flatMap(s => [
      s.teamAPlayerId, s.teamBPlayerId, s.teamAPlayer2Id, s.teamBPlayer2Id,
    ]).filter(Boolean) as string[]
  ))

  const byId: Record<string, string> = {}
  if (allIds.length > 0) {
    const { data: rows } = await supabase
      .from('team_players')
      .select('id, name')
      .in('id', allIds)
    for (const r of rows ?? []) byId[r.id] = r.name
  }

  // Update each submatch row
  for (const s of input.submatches) {
    const a1 = s.teamAPlayerId  ? (byId[s.teamAPlayerId]  ?? null) : null
    const a2 = s.teamAPlayer2Id ? (byId[s.teamAPlayer2Id] ?? null) : null
    const b1 = s.teamBPlayerId  ? (byId[s.teamBPlayerId]  ?? null) : null
    const b2 = s.teamBPlayer2Id ? (byId[s.teamBPlayer2Id] ?? null) : null

    const aName = a1 && a2 ? `${a1} & ${a2}` : (a1 ?? null)
    const bName = b1 && b2 ? `${b1} & ${b2}` : (b1 ?? null)

    const payload: Record<string, unknown> = {
      team_a_player_id: s.teamAPlayerId,
      team_b_player_id: s.teamBPlayerId,
      player_a_name:    aName,
      player_b_name:    bName,
    }
    if (s.teamAPlayer2Id !== undefined) payload.team_a_player2_id = s.teamAPlayer2Id ?? null
    if (s.teamBPlayer2Id !== undefined) payload.team_b_player2_id = s.teamBPlayer2Id ?? null

    const { error } = await supabase
      .from('team_match_submatches')
      .update(payload)
      .eq('id', s.submatchId)
    if (error) return { error: error.message }
  }

  await revalidateTournamentPaths(supabase, input.tournamentId)
  return {}
}

export async function resetTeamLeague(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Delete scoring matches first (FK dependency)
  const { data: matches } = await supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const matchIds = (matches ?? []).map(m => m.id)
  if (matchIds.length > 0) {
    await supabase.from('games').delete().in('match_id', matchIds)
    await supabase.from('matches').delete().eq('tournament_id', tournamentId)
  }

  // Delete team match data
  const { data: tms } = await supabase
    .from('team_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const tmIds = (tms ?? []).map(m => m.id)
  if (tmIds.length > 0) {
    await supabase.from('team_match_submatches').delete().in('team_match_id', tmIds)
    await supabase.from('team_matches').delete().eq('tournament_id', tournamentId)
  }

  await supabase.from('tournaments').update({
    bracket_generated: false,
    status:            'setup',
    published:         false,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamRRKnockout
// After all Round Robin matches are complete, take the top N teams by
// standings and create Knockout phase matches (SF + Final).
// KO team_matches use round numbers 900 (SF) and 901 (Final).
// round_name is prefixed with "KO:" to distinguish from RR rounds.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateTeamRRKnockout(
  tournamentId: string,
  topN: number = 4,
  matchFormat: MatchFormat = 'bo5',
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load RR matches and teams in parallel — both only need tournamentId
  const [rrRes, teamsRes2] = await Promise.all([
    supabase.from('team_matches')
      .select(`
        id, team_a_id, team_b_id, team_a_score, team_b_score,
        winner_team_id, status, round,
        team_match_submatches(id, match_id,
          scoring:match_id(player1_games, player2_games, status))
      `)
      .eq('tournament_id', tournamentId)
      .lt('round', 900),   // only RR rounds
    supabase.from('teams')
      .select('id, name, short_name, color, team_players(id, name, position)')
      .eq('tournament_id', tournamentId)
      .order('created_at'),
  ])

  const rrMatches = rrRes.data
  const teams     = teamsRes2.data

  if (!rrMatches) return { error: 'Could not load RR matches' }
  if (!teams || teams.length < 2) return { error: 'No teams found' }

  // Compute standings
  type StandingRow = {
    teamId:       string
    wins:         number
    submatchWins: number
    gameDiff:     number
  }
  const standingMap = new Map<string, StandingRow>(
    teams.map(tm => [tm.id, { teamId: tm.id, wins: 0, submatchWins: 0, gameDiff: 0 }])
  )

  for (const m of rrMatches) {
    if (m.status !== 'complete') continue
    const sA = standingMap.get(m.team_a_id)
    const sB = standingMap.get(m.team_b_id)
    if (m.winner_team_id === m.team_a_id) { if (sA) sA.wins++ }
    else if (m.winner_team_id === m.team_b_id) { if (sB) sB.wins++ }

    for (const sm of (m.team_match_submatches ?? []) as unknown as
      { match_id: string | null; scoring: { player1_games: number; player2_games: number; status: string } | null }[]) {
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

  const sorted = [...standingMap.values()].sort((a, b) =>
    b.wins - a.wins || b.submatchWins - a.submatchWins || b.gameDiff - a.gameDiff
  )
  const topTeamIds = sorted.slice(0, topN).map(s => s.teamId)
  if (topTeamIds.length < 2) return { error: 'Not enough teams for knockout' }

  // Delete any existing KO matches for this tournament (including orphaned scoring rows)
  const { data: existingKO } = await supabase
    .from('team_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
    .gte('round', 900)
  if (existingKO && existingKO.length > 0) {
    const ids = existingKO.map(m => m.id)
    const { data: sms } = await supabase
      .from('team_match_submatches')
      .select('match_id')
      .in('team_match_id', ids)
    const matchIds = (sms ?? []).map(s => s.match_id).filter(Boolean) as string[]
    if (matchIds.length > 0) {
      await supabase.from('games').delete().in('match_id', matchIds)
      await supabase.from('matches').delete().in('id', matchIds)
    }
    await supabase.from('team_match_submatches').delete().in('team_match_id', ids)
    await supabase.from('team_matches').delete().in('id', ids)
  }
  // Also delete any orphaned KO team_submatch scoring rows (round >= 900, from failed prior runs)
  {
    const { data: orphanedMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('match_kind', 'team_submatch')
      .gte('round', 900)
    const orphanIds = (orphanedMatches ?? []).map(m => m.id)
    if (orphanIds.length > 0) {
      await supabase.from('games').delete().in('match_id', orphanIds)
      await supabase.from('matches').delete().in('id', orphanIds)
    }
  }

  const crypto = require('crypto')
  const teamMatchRows: Record<string, unknown>[] = []
  const submatchRows: Record<string, unknown>[] = []
  const scoringMatchRows: Record<string, unknown>[] = []

  // Standard seeded KO: seed 1 vs seed 4 in SF1, seed 2 vs seed 3 in SF2
  // (complement-interleave: #1 meets #4 and #2 meets #3, so 1&2 can only meet in Final)
  const sfPairs: [number, number][] = topN === 4
    ? [[0, 3], [1, 2]]   // seeds 1v4, 2v3
    : topN === 2
    ? []                 // skip directly to final
    : [[0, topN - 1], [1, topN - 2]]  // generic

  // Corbillon Cup submatch template: 4 singles + 1 doubles
  // tmIndex = position within the round, ensures unique (round, match_number) per submatch
  const buildSubmatches = (tmId: string, round: number, label: string, tmIndex: number) => {
    const submatchDefs = [
      { order: 1, label: 'Singles 1 (A vs X)' },
      { order: 2, label: 'Singles 2 (B vs Y)' },
      { order: 3, label: 'Doubles (A/B vs X/Y)' },
      { order: 4, label: 'Singles 3 (A vs Y)' },
      { order: 5, label: 'Singles 4 (B vs X)' },
    ]
    for (const sm of submatchDefs) {
      const smId    = crypto.randomUUID() as string
      const matchId = crypto.randomUUID() as string
      submatchRows.push({
        id: smId, team_match_id: tmId,
        match_order: sm.order, label: sm.label,
        player_a_name: null, player_b_name: null,
        team_a_player_id: null, team_b_player_id: null,
        match_id: matchId,
      })
      scoringMatchRows.push({
        id: matchId, tournament_id: tournamentId,
        round, match_number: (round - 900) * 100 + tmIndex * 10 + sm.order,
        round_name: `KO ${label} — ${sm.label}`,
        player1_id: null, player2_id: null,
        player1_games: 0, player2_games: 0,
        winner_id: null, status: 'pending',
        next_match_id: null, next_slot: null,
        match_kind: 'team_submatch',
      })
    }
  }

  // Semi-finals (round 900)
  const sfIds: string[] = []
  for (let i = 0; i < sfPairs.length; i++) {
    const [aIdx, bIdx] = sfPairs[i]
    const teamAId = topTeamIds[aIdx]
    const teamBId = topTeamIds[bIdx]
    const tmId = crypto.randomUUID() as string
    sfIds.push(tmId)
    teamMatchRows.push({
      id: tmId, tournament_id: tournamentId,
      team_a_id: teamAId, team_b_id: teamBId,
      round: 900, round_name: `KO:Semi-Final ${i + 1}`,
      status: 'pending', team_a_score: 0, team_b_score: 0,
      slot_index: i,
    })
    buildSubmatches(tmId, 900, `Semi-Final ${i + 1}`, i)
  }

  // Final (round 901) — TBD teams initially (use first two from topTeamIds as placeholder)
  const finalTeamA = sfPairs.length > 0 ? topTeamIds[0] : topTeamIds[0]
  const finalTeamB = sfPairs.length > 0 ? topTeamIds[1] : topTeamIds[1]
  const finalId = crypto.randomUUID() as string
  teamMatchRows.push({
    id: finalId, tournament_id: tournamentId,
    team_a_id: finalTeamA, team_b_id: finalTeamB,
    round: 901, round_name: 'KO:Final',
    status: 'pending', team_a_score: 0, team_b_score: 0,
    slot_index: 0,
  })
  buildSubmatches(finalId, 901, 'Final', 0)

  // Insert scoring matches first
  if (scoringMatchRows.length > 0) {
    const { error: mErr } = await supabase.from('matches').insert(scoringMatchRows)
    if (mErr) return { error: mErr.message }
  }
  const { error: tmErr } = await supabase.from('team_matches').insert(teamMatchRows)
  if (tmErr) return { error: tmErr.message }
  if (submatchRows.length > 0) {
    const { error: smErr } = await supabase.from('team_match_submatches').insert(submatchRows)
    if (smErr) return { error: smErr.message }
  }

  // Mark stage2 generated
  await supabase.from('tournaments').update({
    stage2_bracket_generated: true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamKOBracket
// For team_league_ko format: create a seeded knockout bracket directly.
// Teams are stored in the `teams` table with a `seed` column (if available).
// KO rounds start at round 1.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateTeamKOBracket(
  tournamentId: string,
  matchFormat: MatchFormat = 'bo5',
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load teams ordered by seed, then by name (unseeded last)
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, short_name, color, seed, team_players(id, name, position)')
    .eq('tournament_id', tournamentId)
  if (!teams || teams.length < 2) return { error: 'Need at least 2 teams to generate bracket' }

  // Sort: seeded teams first (by seed asc), then unseeded alphabetically
  const seeded   = teams.filter(t => t.seed != null && t.seed >= 1).sort((a, b) => a.seed - b.seed)
  const unseeded = teams.filter(t => !t.seed || t.seed < 1).sort((a, b) => a.name.localeCompare(b.name))
  const ordered  = [...seeded, ...unseeded]

  const N           = ordered.length
  const bracketSize = nextPowerOf2(N)
  const byeCount    = bracketSize - N

  // Clear any existing bracket matches (including orphaned matches from failed prior runs)
  const { data: existingTMs } = await supabase
    .from('team_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const existingIds = (existingTMs ?? []).map(m => m.id)
  if (existingIds.length > 0) {
    await supabase.from('team_match_submatches').delete().in('team_match_id', existingIds)
    await supabase.from('team_matches').delete().eq('tournament_id', tournamentId)
  }
  // Also delete any orphaned team_submatch scoring rows (e.g. from a previously failed generation)
  {
    const { data: orphanedMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('match_kind', 'team_submatch')
    const orphanIds = (orphanedMatches ?? []).map(m => m.id)
    if (orphanIds.length > 0) {
      await supabase.from('games').delete().in('match_id', orphanIds)
      await supabase.from('matches').delete().in('id', orphanIds)
    }
  }

  // Build complement-interleave seed order (mirrors bracket engine)
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

  function totalRounds(size: number) { return Math.log2(size) }

  const seedOrder = buildSeedOrder(bracketSize)
  // Build round names
  const numRounds = Math.log2(bracketSize)
  function roundName(round: number): string {
    const remaining = numRounds - round + 1
    if (remaining === 1) return 'Final'
    if (remaining === 2) return 'Semi-Final'
    if (remaining === 3) return 'Quarter-Final'
    return `Round of ${bracketSize / Math.pow(2, round - 1)}`
  }

  // Assign teams to slots; slots with rank > N are BYEs
  const slotTeam = (slot: number): typeof ordered[0] | null => {
    const rank = seedOrder[slot]
    return rank <= N ? ordered[rank - 1] : null
  }

  const crypto = require('crypto')
  const teamMatchRows: Record<string, unknown>[] = []
  const submatchRows: Record<string, unknown>[] = []
  const scoringMatchRows: Record<string, unknown>[] = []

  // We need to build ALL rounds as team_matches and wire next_match_id on scoring matches
  // For simplicity: generate round-by-round; BYEs auto-advance

  // Represent the bracket as a slot-indexed array
  // slots[i] = team in that bracket slot (null = BYE)
  const slots = Array.from({ length: bracketSize }, (_, i) => slotTeam(i))

  // Build all rounds (allRounds loop below)

  type RoundMatch = {
    tmId:    string
    slotA:   typeof ordered[0] | null   // null = TBD (winner from prev)
    slotB:   typeof ordered[0] | null
    roundN:  number
    rName:   string
    isBye:   boolean
    byeWinner: typeof ordered[0] | null  // non-null = the auto-advance team
  }

  const allRounds: RoundMatch[][] = []

  let curRoundSlots: (typeof ordered[0] | null)[] = slots

  for (let r = 1; r <= numRounds; r++) {
    const roundMatches: RoundMatch[] = []
    const nextSlots: (typeof ordered[0] | null)[] = []

    for (let i = 0; i < curRoundSlots.length; i += 2) {
      const tA = curRoundSlots[i]
      const tB = curRoundSlots[i + 1]
      // A bye only occurs in round 1 when EXACTLY ONE slot is a seeding BYE
      // (the bracket has more slots than real teams). In rounds > 1 a null slot
      // means "winner TBD" — that is still a real match that must be created.
      const isBye = r === 1 && (tA === null) !== (tB === null)
      const byeWinner = isBye ? (tA ?? tB) : null

      roundMatches.push({
        tmId: crypto.randomUUID() as string,
        slotA: tA,
        slotB: tB,
        roundN: 900 + r - 1,
        rName: roundName(r),
        isBye,
        byeWinner,
      })
      nextSlots.push(byeWinner ?? null)  // TBD if real match, real team if bye
    }

    allRounds.push(roundMatches)
    curRoundSlots = nextSlots
    if (curRoundSlots.length <= 1) break
  }

  // Now build team_matches and submatches (skip BYE matches — auto-advance)
  // Corbillon Cup: 4 singles + 1 doubles
  // tmIndex = position within the round, ensures unique (round, match_number) per submatch
  const buildSubmatches = (tmId: string, roundN: number, rName: string, tmIndex: number) => {
    const submatchDefs = [
      { order: 1, label: 'Singles 1 (A vs X)' },
      { order: 2, label: 'Singles 2 (B vs Y)' },
      { order: 3, label: 'Doubles (A/B vs X/Y)' },
      { order: 4, label: 'Singles 3 (A vs Y)' },
      { order: 5, label: 'Singles 4 (B vs X)' },
    ]
    for (const sm of submatchDefs) {
      const smId    = crypto.randomUUID() as string
      const matchId = crypto.randomUUID() as string
      submatchRows.push({
        id: smId, team_match_id: tmId,
        match_order: sm.order, label: sm.label,
        player_a_name: null, player_b_name: null,
        team_a_player_id: null, team_b_player_id: null,
        match_id: matchId,
      })
      scoringMatchRows.push({
        id: matchId, tournament_id: tournamentId,
        round: roundN,
        match_number: (roundN - 899) * 100 + tmIndex * 10 + sm.order,
        round_name: `${rName} — ${sm.label}`,
        player1_id: null, player2_id: null,
        player1_games: 0, player2_games: 0,
        winner_id: null, status: 'pending',
        next_match_id: null, next_slot: null,
        match_kind: 'team_submatch',
      })
    }
  }

  for (const round of allRounds) {
    let tmIndex = 0
    for (const m of round) {
      if (m.isBye) continue  // skip BYE matches
      teamMatchRows.push({
        id: m.tmId, tournament_id: tournamentId,
        slot_index: tmIndex,  // deterministic bracket ordering
        team_a_id: m.slotA?.id ?? null,
        team_b_id: m.slotB?.id ?? null,
        round: m.roundN,
        round_name: m.rName,
        status: 'pending',
        team_a_score: 0, team_b_score: 0,
      })
      buildSubmatches(m.tmId, m.roundN, m.rName, tmIndex)
      tmIndex++
    }
  }

  if (scoringMatchRows.length > 0) {
    const { error: mErr } = await supabase.from('matches').insert(scoringMatchRows)
    if (mErr) return { error: mErr.message }
  }
  if (teamMatchRows.length > 0) {
    const { error: tmErr } = await supabase.from('team_matches').insert(teamMatchRows)
    if (tmErr) return { error: tmErr.message }
  }
  if (submatchRows.length > 0) {
    const { error: smErr } = await supabase.from('team_match_submatches').insert(submatchRows)
    if (smErr) return { error: smErr.message }
  }

  await supabase.from('tournaments').update({
    bracket_generated: true,
    stage2_bracket_generated: true,
    status: 'active',
    published: true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTeamKOWinner
// Called when a KO team_match completes. Updates the next KO match's team IDs.
// Works for both RR+KO (rounds 900/901) and pure KO (rounds 1/2/3…).
// ─────────────────────────────────────────────────────────────────────────────
export async function updateTeamKOWinner(
  tournamentId: string,
  teamMatchId:  string,
  winnerTeamId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()

  const { data: teamMatch } = await supabase
    .from('team_matches')
    .select('round, group_id')
    .eq('id', teamMatchId)
    .single()
  if (!teamMatch) return {}

  // Defence-in-depth: never propagate from group stage matches
  if (teamMatch.group_id != null || teamMatch.round < 900) return {}

  const currentRound = teamMatch.round
  const nextRound    = currentRound + 1

  // Check if there are any KO matches in the next round
  // Order by slot_index (stored during bracket generation) for deterministic ordering.
  // Fall back to id ordering if slot_index is missing (older data).
  const { data: nextRoundMatches } = await supabase
    .from('team_matches')
    .select('id, team_a_id, team_b_id, slot_index')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .is('group_id', null)
    .order('slot_index', { nullsFirst: true })
    .order('id')

  if (!nextRoundMatches || nextRoundMatches.length === 0) {
    // No next round → this was the final, nothing to propagate
    await revalidateTournamentPaths(supabase, tournamentId)
    return {}
  }

  // Find the position of this match within its round (0-based) using slot_index
  const { data: currentRoundMatches } = await supabase
    .from('team_matches')
    .select('id, slot_index')
    .eq('tournament_id', tournamentId)
    .eq('round', currentRound)
    .is('group_id', null)
    .order('slot_index', { nullsFirst: true })
    .order('id')

  const position = (currentRoundMatches ?? []).findIndex(m => m.id === teamMatchId)
  if (position === -1) {
    await revalidateTournamentPaths(supabase, tournamentId)
    return {}
  }

  // The winner feeds into match at floor(position / 2) in next round,
  // into team_a slot if position is even, team_b slot if odd.
  const nextMatchIdx = Math.floor(position / 2)
  const nextMatch    = nextRoundMatches[nextMatchIdx]
  if (!nextMatch) {
    await revalidateTournamentPaths(supabase, tournamentId)
    return {}
  }

  const slot = position % 2 === 0 ? 'team_a_id' : 'team_b_id'
  await supabase.from('team_matches')
    .update({ [slot]: winnerTeamId })
    .eq('id', nextMatch.id)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// generateTeamSwaythlingBracket
// Swaythling Cup: 5-singles knockout bracket (no doubles).
// Submatches: A vs X, B vs Y, C vs Z, A vs Y, B vs X
// Each team needs 3 players (positions 1, 2, 3).
// ─────────────────────────────────────────────────────────────────────────────
export async function generateTeamSwaythlingBracket(
  tournamentId: string,
  matchFormat: MatchFormat = 'bo5',
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('id, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, short_name, color, seed, team_players(id, name, position)')
    .eq('tournament_id', tournamentId)
  if (!teams || teams.length < 2) return { error: 'Need at least 2 teams to generate bracket' }

  const seeded   = teams.filter(t => t.seed != null && t.seed >= 1).sort((a, b) => a.seed - b.seed)
  const unseeded = teams.filter(t => !t.seed || t.seed < 1).sort((a, b) => a.name.localeCompare(b.name))
  const ordered  = [...seeded, ...unseeded]

  const N           = ordered.length
  const bracketSize = nextPowerOf2(N)

  // Clear existing (including orphaned matches from failed prior runs)
  const { data: existingTMs } = await supabase
    .from('team_matches').select('id').eq('tournament_id', tournamentId)
  const existingIds = (existingTMs ?? []).map(m => m.id)
  if (existingIds.length > 0) {
    await supabase.from('team_match_submatches').delete().in('team_match_id', existingIds)
    await supabase.from('team_matches').delete().eq('tournament_id', tournamentId)
  }
  // Also delete any orphaned team_submatch scoring rows (e.g. from a previously failed generation)
  {
    const { data: orphanedMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('match_kind', 'team_submatch')
    const orphanIds = (orphanedMatches ?? []).map(m => m.id)
    if (orphanIds.length > 0) {
      await supabase.from('games').delete().in('match_id', orphanIds)
      await supabase.from('matches').delete().in('id', orphanIds)
    }
  }

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
  function roundName(round: number): string {
    const remaining = numRounds - round + 1
    if (remaining === 1) return 'Final'
    if (remaining === 2) return 'Semi-Final'
    if (remaining === 3) return 'Quarter-Final'
    return `Round of ${bracketSize / Math.pow(2, round - 1)}`
  }

  const slotTeam = (slot: number): typeof ordered[0] | null => {
    const rank = seedOrder[slot]
    return rank <= N ? ordered[rank - 1] : null
  }

  const crypto = require('crypto')
  const teamMatchRows: Record<string, unknown>[] = []
  const submatchRows: Record<string, unknown>[] = []
  const scoringMatchRows: Record<string, unknown>[] = []

  const slots = Array.from({ length: bracketSize }, (_, i) => slotTeam(i))

  // Swaythling Cup submatches: 5 singles, no doubles
  const swathlingSubmatchDefs = [
    { order: 1, label: 'Singles 1 (A vs X)' },
    { order: 2, label: 'Singles 2 (B vs Y)' },
    { order: 3, label: 'Singles 3 (C vs Z)' },
    { order: 4, label: 'Singles 4 (A vs Y)' },
    { order: 5, label: 'Singles 5 (B vs X)' },
  ]

  // Build submatches for one team match (tmIndex = position in round for unique match_number)
  const buildSubmatches = (tmId: string, roundN: number, rName: string, tmIndex: number) => {
    for (const sm of swathlingSubmatchDefs) {
      const smId    = crypto.randomUUID() as string
      const matchId = crypto.randomUUID() as string
      submatchRows.push({
        id: smId, team_match_id: tmId,
        match_order: sm.order, label: sm.label,
        player_a_name: null, player_b_name: null,
        team_a_player_id: null, team_b_player_id: null,
        match_id: matchId,
      })
      scoringMatchRows.push({
        id: matchId, tournament_id: tournamentId,
        round: roundN,
        match_number: (roundN - 899) * 100 + tmIndex * 10 + sm.order,
        round_name: `${rName} — ${sm.label}`,
        player1_id: null, player2_id: null,
        player1_games: 0, player2_games: 0,
        winner_id: null, status: 'pending',
        next_match_id: null, next_slot: null,
        match_kind: 'team_submatch',
      })
    }
  }

  // Build all rounds up front (same pattern as Corbillon KO bracket).
  // Rounds > 1 have null team slots meaning "winner TBD" — still real matches.
  type RoundMatch = {
    tmId:      string
    slotA:     typeof ordered[0] | null
    slotB:     typeof ordered[0] | null
    roundN:    number
    rName:     string
    isBye:     boolean
    byeWinner: typeof ordered[0] | null
  }

  const allRounds: RoundMatch[][] = []
  let curRoundSlots: (typeof ordered[0] | null)[] = slots

  for (let r = 1; r <= numRounds; r++) {
    const roundMatches: RoundMatch[] = []
    const nextSlots: (typeof ordered[0] | null)[] = []

    for (let i = 0; i < curRoundSlots.length; i += 2) {
      const tA = curRoundSlots[i]
      const tB = curRoundSlots[i + 1]
      // A BYE only occurs in round 1 when exactly one slot has no real team
      const isBye = r === 1 && (tA === null) !== (tB === null)
      const byeWinner = isBye ? (tA ?? tB) : null

      roundMatches.push({
        tmId: crypto.randomUUID() as string,
        slotA: tA,
        slotB: tB,
        roundN: 900 + r - 1,
        rName: roundName(r),
        isBye,
        byeWinner,
      })
      nextSlots.push(byeWinner ?? null)
    }

    allRounds.push(roundMatches)
    curRoundSlots = nextSlots
    if (curRoundSlots.length <= 1) break
  }

  // Insert all rounds, skipping BYE matches (auto-advance)
  for (const round of allRounds) {
    let tmIndex = 0
    for (const m of round) {
      if (m.isBye) continue
      teamMatchRows.push({
        id: m.tmId, tournament_id: tournamentId,
        slot_index: tmIndex,  // deterministic bracket ordering
        team_a_id: m.slotA?.id ?? null,
        team_b_id: m.slotB?.id ?? null,
        round: m.roundN,
        round_name: m.rName,
        status: 'pending',
        team_a_score: 0, team_b_score: 0,
      })
      buildSubmatches(m.tmId, m.roundN, m.rName, tmIndex)
      tmIndex++
    }
  }

  if (scoringMatchRows.length > 0) {
    const { error: mErr } = await supabase.from('matches').insert(scoringMatchRows)
    if (mErr) return { error: mErr.message }
  }
  if (teamMatchRows.length > 0) {
    const { error: tmErr } = await supabase.from('team_matches').insert(teamMatchRows)
    if (tmErr) return { error: tmErr.message }
  }
  if (submatchRows.length > 0) {
    const { error: smErr } = await supabase.from('team_match_submatches').insert(submatchRows)
    if (smErr) return { error: smErr.message }
  }

  await supabase.from('tournaments').update({
    bracket_generated: true, status: 'active', published: true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}
