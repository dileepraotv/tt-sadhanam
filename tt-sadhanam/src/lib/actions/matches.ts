'use server'
// cache-bust: 1773593664

/**
 * actions/matches.ts
 *
 * Server Actions for match scoring.
 *
 * DATABASE WRITE FLOW (saveGameScore):
 *
 *   1. Load match row   (player IDs, format, next_match_id, next_slot)
 *   2. Load existing games
 *   3. validateGameScore()         ← pure engine, no DB
 *   4. canAddAnotherGame()         ← pure engine, no DB
 *   5. UPSERT game row             ← write 1
 *   6. Re-fetch all games          ← read  (ground truth after upsert)
 *   7. computeMatchState()         ← pure engine, no DB
 *   8. UPDATE matches row          ← write 2  (scores, status, winner_id)
 *   9. If match complete:
 *       UPDATE next match slot     ← write 3  (bracket advance)
 *       If Final: UPDATE tournament ← write 4  (mark complete)
 *  10. INSERT audit_log            ← write 5
 *  11. revalidatePath()
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { MatchFormat, Game } from '@/lib/types'
import {
  validateGameScore,
  computeMatchState,
  canAddAnotherGame,
  deriveGameWinnerId,
  formatValidationErrors,
  filterGamesToSave,
} from '@/lib/scoring/engine'
import { FORMAT_CONFIGS } from '@/lib/scoring/types'

// ── Shared: load match with its tournament format ─────────────────────────────
async function loadMatchWithFormat(supabase: ReturnType<typeof createClient>, matchId: string) {
  // Include match_format in the primary select (added in migration v7).
  // If the column doesn't exist yet PostgREST returns PGRST204; we catch and
  // retry without it — one round-trip in either case.
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, tournament_id, round, match_number,
      player1_id, player2_id, winner_id, status,
      next_match_id, next_slot, started_at,
      match_kind, match_format,
      bracket_side, loser_next_match_id, loser_next_slot,
      tournament:tournaments ( id, format, status, championship_id )
    `)
    .eq('id', matchId)
    .single()

  if (!error && data) return data as typeof data & { match_format: MatchFormat | null }

  // migration v7 not run yet — retry without match_format
  if (error && (error.code === 'PGRST204' || error.message?.includes('match_format'))) {
    const { data: fb, error: err2 } = await supabase
      .from('matches')
      .select(`
        id, tournament_id, round, match_number,
        player1_id, player2_id, winner_id, status,
        next_match_id, next_slot, started_at,
        match_kind,
        bracket_side, loser_next_match_id, loser_next_slot,
        tournament:tournaments ( id, format, status, championship_id )
      `)
      .eq('id', matchId)
      .single()
    if (err2 || !fb) throw new Error('Match not found')
    return { ...fb, match_format: null as MatchFormat | null }
  }

  throw new Error('Match not found')
}

/** Revalidate all paths affected by a match score change (Fix: covers championship event pages) */
function revalidateMatchPaths(
  tournamentId: string,
  matchId: string,
  champId: string | null,
) {
  revalidatePath(`/admin/tournaments/${tournamentId}/match/${matchId}`)
  revalidatePath(`/admin/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}`)
  if (champId) {
    revalidatePath(`/admin/championships/${champId}/events/${tournamentId}`)
    revalidatePath(`/championships/${champId}/events/${tournamentId}`)
    revalidatePath(`/championships/${champId}`)
  }
}

// ── Shared: load all games for a match ────────────────────────────────────────
async function loadGames(supabase: ReturnType<typeof createClient>, matchId: string): Promise<Game[]> {
  const { data, error } = await supabase
    .from('games')
    .select('id, match_id, game_number, score1, score2, winner_id, created_at, updated_at')
    .eq('match_id', matchId)
    .order('game_number', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Game[]
}

// ─────────────────────────────────────────────────────────────────────────────
// saveGameScore — returns a result object instead of throwing, so the client
// can display field-level error messages without a try/catch.
// ─────────────────────────────────────────────────────────────────────────────
export async function saveGameScore(
  matchId:    string,
  gameNumber: number,
  score1:     number,
  score2:     number,
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = createClient()

  // ── 1+2. Load match AND existing games in parallel ──────────────────────────
  let match: Awaited<ReturnType<typeof loadMatchWithFormat>>
  let existingGames: Game[]
  try {
    ;[match, existingGames] = await Promise.all([
      loadMatchWithFormat(supabase, matchId),
      loadGames(supabase, matchId),
    ])
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  // Use per-match format override if set, otherwise fall back to tournament default
  const tournamentFormat = (match.tournament as unknown as { format: MatchFormat }).format
  const format: MatchFormat = (match as unknown as { match_format?: MatchFormat | null }).match_format ?? tournamentFormat
  const player1Id = match.player1_id
  const player2Id = match.player2_id
  const isTeamSubmatch = match.match_kind === 'team_submatch'

  // For team submatches player1_id/player2_id are null (players live in
  // team_match_submatches). Use sentinels for engine calls; never write to DB.
  const p1 = player1Id ?? (isTeamSubmatch ? 'TEAM_A' : null)
  const p2 = player2Id ?? (isTeamSubmatch ? 'TEAM_B' : null)

  // ── 3. Validate the score (table tennis rules) ──────────────────────────────
  const scoreValidation = validateGameScore({ score1, score2 })
  if (!scoreValidation.ok) {
    return { success: false, error: formatValidationErrors(scoreValidation) }
  }

  // ── 4. Check whether adding this game is allowed ────────────────────────────
  // Edits (same game_number already exists) bypass the "can add" check.
  const isEdit = existingGames.some(g => g.game_number === gameNumber)
  if (!isEdit) {
    const canAdd = canAddAnotherGame(existingGames, format, p1, p2, gameNumber)
    if (!canAdd.allowed) {
      return { success: false, error: canAdd.reason ?? 'Cannot add another game.' }
    }
  }

  // ── 5. Upsert game row ──────────────────────────────────────────────────────
  if (!p1 || !p2) {
    return { success: false, error: 'Both players must be assigned before entering scores.' }
  }

  // Team submatches have no real player FK; winner_id stays null in the DB.
  // Team scores are updated via updateSubmatchResult (step 9a below).
  const gameWinnerId = isTeamSubmatch ? null : deriveGameWinnerId(score1, score2, p1, p2)

  const { error: upsertErr } = await supabase
    .from('games')
    .upsert(
      { match_id: matchId, game_number: gameNumber, score1, score2, winner_id: gameWinnerId },
      { onConflict: 'match_id,game_number' },
    )
  if (upsertErr) return { success: false, error: upsertErr.message }

  // ── 6. Build allGames from in-memory state (avoids an extra round-trip) ─────
  // Merge: replace existing game_number entry if editing, otherwise append.
  const newGame = { game_number: gameNumber, score1, score2,
                    winner_id: gameWinnerId, match_id: matchId } as unknown as Game
  const allGames: Game[] = [
    ...existingGames.filter(g => g.game_number !== gameNumber),
    newGame,
  ].sort((a, b) => a.game_number - b.game_number)

  // ── 7. Compute match state ──────────────────────────────────────────────────
  const matchState = computeMatchState(allGames, format, p1, p2)

  // Team submatches: winner_id stays null in matches table.
  // Bracket/RR matches: set winner_id to the real player id.
  const matchWinnerId: string | null = isTeamSubmatch
    ? null
    : matchState.outcome === 'player1_wins' ? p1
    : matchState.outcome === 'player2_wins' ? p2
    : null

  const isMatchComplete = isTeamSubmatch
    ? matchState.outcome !== 'in_progress'
    : !!matchWinnerId

  const newStatus = isMatchComplete
    ? 'complete'
    : (allGames.length > 0 ? 'live' : 'pending')

  // ── 8. Update match row ─────────────────────────────────────────────────────
  const { error: matchUpdateErr } = await supabase
    .from('matches')
    .update({
      player1_games: matchState.player1Games,
      player2_games: matchState.player2Games,
      winner_id:     matchWinnerId,
      status:        newStatus,
      started_at:    match.started_at ?? new Date().toISOString(),
      completed_at:  isMatchComplete ? new Date().toISOString() : null,
    })
    .eq('id', matchId)

  if (matchUpdateErr) return { success: false, error: matchUpdateErr.message }

  // ── 9a. Team submatch: update parent team_match scores ─────────────────────
  if (isTeamSubmatch && isMatchComplete) {
    const { updateSubmatchResult } = await import('./teamLeague')
    await updateSubmatchResult(matchId, match.tournament_id)
  }

  // ── 9b. Propagate winner to next match (KO brackets only) ──────────────────
  if (matchWinnerId && match.next_match_id) {
    const col = match.next_slot === 1 ? 'player1_id' : 'player2_id'
    const { error: propErr } = await supabase
      .from('matches')
      .update({ [col]: matchWinnerId })
      .eq('id', match.next_match_id)
    if (propErr) return { success: false, error: `Match complete but bracket advance failed: ${propErr.message}. Please refresh and try again.` }
  }

  // ── 9b-DE. Route loser into Losers Bracket (double-elimination only) ───────
  const bracketSide = (match as unknown as { bracket_side?: string | null }).bracket_side
  const loserNextMatchId = (match as unknown as { loser_next_match_id?: string | null }).loser_next_match_id
  const loserNextSlot = (match as unknown as { loser_next_slot?: number | null }).loser_next_slot
  if (isMatchComplete && bracketSide === 'winners' && loserNextMatchId && matchWinnerId) {
    const loserId = match.player1_id === matchWinnerId ? match.player2_id : match.player1_id
    if (loserId) {
      const col = loserNextSlot === 1 ? 'player1_id' : 'player2_id'
      const { error: lbErr } = await supabase
        .from('matches')
        .update({ [col]: loserId })
        .eq('id', loserNextMatchId)
      if (lbErr) return { success: false, error: `Match complete but Losers Bracket routing failed: ${lbErr.message}. Please refresh and try again.` }
    }
  }

  // ── 9b-GF. Grand Final special handling ────────────────────────────────────
  if (isMatchComplete && bracketSide === 'grand_final' && matchWinnerId) {
    const { advanceDEPlayers } = await import('./doubleElimination')
    await advanceDEPlayers(matchId, match.tournament_id)
    // advanceDEPlayers handles tournament completion — skip step 9c for GF
  } else {
    // ── 9c. If this is the KO Final, mark tournament complete ────────────────
    // Round-robin and team_submatch matches never advance via next_match_id.
    if (matchWinnerId && !match.next_match_id && match.match_kind !== 'round_robin' && bracketSide !== 'grand_final') {
      await supabase
        .from('tournaments')
        .update({ status: 'complete' })
        .eq('id', match.tournament_id)
    }
  }

  // ── 10. Audit log — fire and forget (non-blocking) ─────────────────────────
  void supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
    const user = data.user
    if (user) {
      void supabase.from('audit_log').insert({
        actor_id:   user.id,
        action:     isEdit ? 'edit_game_score' : 'add_game_score',
        table_name: 'games',
        record_id:  matchId,
        new_data: { game_number: gameNumber, score1, score2, match_winner: matchWinnerId, match_status: newStatus },
      })
    }
  })

  // ── 11. Revalidate ──────────────────────────────────────────────────────────
  const champId = (match.tournament as unknown as { championship_id: string | null }).championship_id
  revalidateMatchPaths(match.tournament_id, matchId, champId)

  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteGameScore
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteGameScore(
  matchId:    string,
  gameNumber: number,
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = createClient()

  let match: Awaited<ReturnType<typeof loadMatchWithFormat>>
  try {
    match = await loadMatchWithFormat(supabase, matchId)
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const tournamentFmt      = (match.tournament as unknown as { format: MatchFormat }).format
  const format             = (match.match_format as MatchFormat | null) ?? tournamentFmt
  const player1Id          = match.player1_id
  const player2Id          = match.player2_id
  const previouslyComplete = match.status === 'complete'
  const previousWinnerId   = match.winner_id

  // Delete the specific game row
  const { error: delErr } = await supabase
    .from('games')
    .delete()
    .eq('match_id', matchId)
    .eq('game_number', gameNumber)
  if (delErr) return { success: false, error: delErr.message }

  // Recompute from remaining games
  const remainingGames = await loadGames(supabase, matchId)
  const matchState     = computeMatchState(remainingGames, format, player1Id, player2Id)

  const newWinnerId: string | null =
    matchState.outcome === 'player1_wins' ? player1Id :
    matchState.outcome === 'player2_wins' ? player2Id :
    null

  const newStatus = newWinnerId
    ? 'complete'
    : (remainingGames.length > 0 ? 'live' : 'pending')

  await supabase.from('matches').update({
    player1_games: matchState.player1Games,
    player2_games: matchState.player2Games,
    winner_id:     newWinnerId,
    status:        newStatus,
    completed_at:  newWinnerId ? new Date().toISOString() : null,
  }).eq('id', matchId)

  // Un-propagate winner from next match if winner changed and next not locked
  if (previouslyComplete && previousWinnerId && match.next_match_id) {
    if (newWinnerId !== previousWinnerId) {
      const { data: nextMatch } = await supabase
        .from('matches')
        .select('id, player1_id, player2_id, status, next_match_id, winner_id')
        .eq('id', match.next_match_id)
        .single()

      if (nextMatch && nextMatch.status !== 'complete') {
        const wasInSlot1 = nextMatch.player1_id === previousWinnerId
        const col        = wasInSlot1 ? 'player1_id' : 'player2_id'
        await supabase.from('matches')
          .update({ [col]: newWinnerId ?? null })
          .eq('id', match.next_match_id)
      } else if (nextMatch && nextMatch.status === 'complete') {
        // Downstream match is also complete — admin must be warned but we cannot
        // safely auto-cascade without corrupting more data. Return a descriptive error.
        return {
          success: false,
          error:   'This match result has already progressed to a completed downstream match. ' +
                   'Please correct the downstream match first before editing this score.',
        }
      }
    }
  }

  // Audit
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('audit_log').insert({
      actor_id: user.id, action: 'delete_game_score', table_name: 'games',
      record_id: matchId, new_data: { game_number: gameNumber, reverted_to: newStatus },
    })
  }

  const champId = (match.tournament as unknown as { championship_id: string | null }).championship_id
  revalidateMatchPaths(match.tournament_id, matchId, champId)

  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// setMatchLive
// ─────────────────────────────────────────────────────────────────────────────
export async function setMatchLive(matchId: string): Promise<void> {
  const supabase = createClient()

  // Include championship_id via join — avoids a second round-trip later
  const { data: match } = await supabase
    .from('matches')
    .select('tournament_id, status, player1_id, player2_id, tournament:tournaments(championship_id)')
    .eq('id', matchId)
    .single()

  if (!match) throw new Error('Match not found')
  if (match.status === 'complete') {
    throw new Error('Cannot re-open a completed match this way. Delete a game score to make corrections.')
  }
  if (!match.player1_id || !match.player2_id) {
    throw new Error('Both players must be assigned before starting a match.')
  }

  await supabase.from('matches').update({
    status:     'live',
    started_at: new Date().toISOString(),
  }).eq('id', matchId)

  const champId = (match.tournament as unknown as { championship_id: string | null } | null)?.championship_id ?? null
  revalidateMatchPaths(match.tournament_id, matchId, champId)
}

// ─────────────────────────────────────────────────────────────────────────────
// declareMatchWinner
// Assigns a winner directly without game scores — for walkover, injury, etc.
// ─────────────────────────────────────────────────────────────────────────────
export async function declareMatchWinner(
  matchId:  string,
  winnerId: string,
  reason:   string, // e.g. 'walkover', 'injury', 'declared'
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Include next_slot + championship_id in the initial select to avoid
  // two follow-up round-trips later in the function.
  const { data: match } = await supabase
    .from('matches')
    .select('tournament_id, player1_id, player2_id, status, next_match_id, next_slot, match_kind, bracket_side, loser_next_match_id, loser_next_slot, tournament:tournaments(championship_id)')
    .eq('id', matchId)
    .single()

  if (!match) return { success: false, error: 'Match not found' }
  if (match.status === 'complete') return { success: false, error: 'Match is already complete.' }
  // Allow declaring winner for team submatches (player1_id/player2_id are null in DB)
  const isTeamSub = match.match_kind === 'team_submatch'
  if (!isTeamSub && winnerId !== match.player1_id && winnerId !== match.player2_id)
    return { success: false, error: 'Winner must be one of the two players' }

  // For non-team matches: set 1/0 game score so RR standings tiebreakers work
  const p1Wins = !isTeamSub && winnerId === match.player1_id
  const p2Wins = !isTeamSub && winnerId === match.player2_id

  const { error } = await supabase.from('matches').update({
    status:        'complete',
    winner_id:     isTeamSub ? null : winnerId,
    completed_at:  new Date().toISOString(),
    // Inject 1 game win for tiebreakers (only when no real scores exist yet)
    ...(p1Wins ? { player1_games: 1, player2_games: 0 } : {}),
    ...(p2Wins ? { player1_games: 0, player2_games: 1 } : {}),
  }).eq('id', matchId)

  if (error) return { success: false, error: error.message }

  // ── Mirror the same post-completion logic as saveGameScore ─────────────────

  // 1. Team submatch: update parent team_match scores (and mark it complete if first to 3)
  if (isTeamSub) {
    const { updateSubmatchResult } = await import('./teamLeague')
    // updateSubmatchResult uses game scores to determine the winner side.
    // For declared winners with no games we must set player1_games/player2_games first
    // so the function can read who won. p1='TEAM_A' slot wins when winnerId is 'p1'.
    // The winnerId passed here is either match.player1_id (real) or 'p1'/'p2' (team sub slot).
    const teamAWon = winnerId === 'p1' || winnerId === match.player1_id
    // Inject a synthetic game so updateSubmatchResult resolves the correct side
    await supabase.from('matches').update({
      player1_games: teamAWon ? 1 : 0,
      player2_games: teamAWon ? 0 : 1,
    }).eq('id', matchId)
    await updateSubmatchResult(matchId, match.tournament_id)
  }

  // 2. KO bracket: propagate real winner to next match using next_slot
  // next_slot is now included in the initial select — no re-fetch needed.
  if (!isTeamSub && match.next_match_id) {
    const col = (match.next_slot ?? 2) === 1 ? 'player1_id' : 'player2_id'
    await supabase.from('matches').update({ [col]: winnerId }).eq('id', match.next_match_id)
  }

  // 2b. DE: Route loser to Losers Bracket
  const dMatchBracketSide = (match as unknown as { bracket_side?: string | null }).bracket_side
  const dLoserNextMatchId = (match as unknown as { loser_next_match_id?: string | null }).loser_next_match_id
  const dLoserNextSlot    = (match as unknown as { loser_next_slot?: number | null }).loser_next_slot
  if (!isTeamSub && dMatchBracketSide === 'winners' && dLoserNextMatchId) {
    const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id
    if (loserId) {
      const col = dLoserNextSlot === 1 ? 'player1_id' : 'player2_id'
      await supabase.from('matches').update({ [col]: loserId }).eq('id', dLoserNextMatchId)
    }
  }
  // 2c. DE Grand Final special handling
  if (!isTeamSub && dMatchBracketSide === 'grand_final') {
    const { advanceDEPlayers } = await import('./doubleElimination')
    await advanceDEPlayers(matchId, match.tournament_id)
  }

  // 3. KO Final: mark tournament complete when there's no next match
  if (!isTeamSub && !match.next_match_id && match.match_kind !== 'round_robin' && dMatchBracketSide !== 'grand_final') {
    await supabase.from('tournaments').update({ status: 'complete' }).eq('id', match.tournament_id)
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id, action: 'declare_winner', table_name: 'matches',
    record_id: matchId, new_data: { winner_id: winnerId, reason },
  }).then(() => {}) // ignore audit errors

  // championship_id already loaded in the initial select — no extra query needed
  const champId2 = (match.tournament as unknown as { championship_id: string | null } | null)?.championship_id ?? null
  revalidateMatchPaths(match.tournament_id, matchId, champId2)

  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateMatchFormat — sets per-match format override (bo3/bo5/bo7 or null to clear)
// ─────────────────────────────────────────────────────────────────────────────
export async function updateMatchFormat(
  matchId: string,
  format: MatchFormat | null,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: match } = await supabase
    .from('matches')
    .select('tournament_id, status')
    .eq('id', matchId)
    .single()
  if (!match) return { success: false, error: 'Match not found' }
  // Allow format changes even on completed matches — format is display metadata
  // The edit flow needs to change format BEFORE resetting scores

  const { error } = await supabase
    .from('matches')
    .update({ match_format: format })
    .eq('id', matchId)
  if (error) {
    // Column may not exist if migration v7 hasn't been run
    if (error.message?.includes('match_format') || error.code === 'PGRST204') {
      return { success: false, error: 'Run migration v7 in Supabase to enable per-match format. See schema-migration-v7-match-format.sql' }
    }
    return { success: false, error: error.message }
  }

  const { data: tRow } = await supabase
    .from('tournaments').select('championship_id').eq('id', match.tournament_id).single()
  revalidateMatchPaths(match.tournament_id, matchId, tRow?.championship_id ?? null)
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkSaveGameScores — saves all games for a match in a single optimised pass.
//
// Replaces the sequential loop of saveGameScore() calls in the client.
// One DB round-trip to load, one upsert per game (can be batched), one match
// update, one revalidate — instead of N × 5 round-trips.
// ─────────────────────────────────────────────────────────────────────────────
export async function bulkSaveGameScores(
  matchId: string,
  entries: Array<{ gameNumber: number; score1: number; score2: number }>,
  /** When true, clears all existing game rows before saving (edit of a completed match).
   *  The clear happens server-side AFTER validation so data is never lost on a bad save. */
  clearExistingFirst = false,
): Promise<
  | { success: true; skippedCount: number; decidingGameNumber: number | null }
  | { success: false; error: string }
> {
  if (!entries.length) return { success: true, skippedCount: 0, decidingGameNumber: null }

  const supabase = createClient()

  // ── 1. Load match + existing games in parallel ──────────────────────────
  let match: Awaited<ReturnType<typeof loadMatchWithFormat>>
  let existingGames: Game[]
  try {
    ;[match, existingGames] = await Promise.all([
      loadMatchWithFormat(supabase, matchId),
      loadGames(supabase, matchId),
    ])
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const tournamentFormat = (match.tournament as unknown as { format: MatchFormat }).format
  const format: MatchFormat = (match as unknown as { match_format?: MatchFormat | null }).match_format ?? tournamentFormat
  const player1Id = match.player1_id
  const player2Id = match.player2_id
  const isTeamSubmatch = match.match_kind === 'team_submatch'
  const p1 = player1Id ?? (isTeamSubmatch ? 'TEAM_A' : null)
  const p2 = player2Id ?? (isTeamSubmatch ? 'TEAM_B' : null)

  if (!p1 || !p2) {
    return { success: false, error: 'Both players must be assigned before entering scores.' }
  }

  // ── 2. Validate ALL scores FIRST — before any DB mutations ──────────────
  // This guarantees we never delete old data and then fail to write new data.
  for (const { gameNumber, score1, score2 } of entries) {
    const vr = validateGameScore({ score1, score2 })
    if (!vr.ok) {
      return { success: false, error: `Game ${gameNumber}: ${formatValidationErrors(vr)}` }
    }
  }

  // ── 3. Filter out games that come after match winner is decided ──────────
  // Transform entries to match filterGamesToSave input format
  const entriesToFilter = entries.map(e => ({ game_number: e.gameNumber, score1: e.score1, score2: e.score2 }))
  const filterResult = filterGamesToSave(entriesToFilter, existingGames, format, p1, p2)
  const validEntries = filterResult.validGames.map(g => ({ gameNumber: g.game_number, score1: g.score1, score2: g.score2 }))
  const skippedCount = filterResult.skippedCount

  // If all games were skipped, we're done
  if (!validEntries.length && filterResult.skippedCount > 0) {
    return { success: true, skippedCount, decidingGameNumber: filterResult.decidingGameNumber }
  }

  // ── 4. If editing a completed match: reset atomically on the server ──────
  // Only after validation passes do we clear old data.
  if (clearExistingFirst && existingGames.length > 0) {
    const { error: delErr } = await supabase
      .from('games')
      .delete()
      .eq('match_id', matchId)
    if (delErr) return { success: false, error: `Could not reset match: ${delErr.message}` }

    const { error: resetErr } = await supabase
      .from('matches')
      .update({ status: 'pending', winner_id: null, player1_games: 0, player2_games: 0, completed_at: null })
      .eq('id', matchId)
    if (resetErr) return { success: false, error: `Could not reset match status: ${resetErr.message}` }

    existingGames = [] // cleared
  }

  // Only proceed with upsert if we have valid games
  if (validEntries.length > 0) {
    // ── 5. Upsert all VALID game rows ──────────────────────────────────────────────
    const gameRows = validEntries.map(({ gameNumber, score1, score2 }) => {
      const gameWinnerId = isTeamSubmatch ? null : deriveGameWinnerId(score1, score2, p1, p2)
      return { match_id: matchId, game_number: gameNumber, score1, score2, winner_id: gameWinnerId }
    })

    const { error: upsertErr } = await supabase
      .from('games')
      .upsert(gameRows, { onConflict: 'match_id,game_number' })
    if (upsertErr) return { success: false, error: upsertErr.message }

    // ── 6. Build final game list in memory ───────────────────────────────────
    const upsertedByNum = new Map(gameRows.map(g => [g.game_number, g]))
    const allGames: Game[] = [
      ...existingGames.filter(g => !upsertedByNum.has(g.game_number)),
      ...gameRows.map(g => ({ ...g } as unknown as Game)),
    ].sort((a, b) => a.game_number - b.game_number)

    // ── 7. Compute final match state ─────────────────────────────────────────
    const matchState = computeMatchState(allGames, format, p1, p2)
    const matchWinnerId: string | null = isTeamSubmatch
      ? null
      : matchState.outcome === 'player1_wins' ? p1
      : matchState.outcome === 'player2_wins' ? p2
      : null
    const isMatchComplete = isTeamSubmatch
      ? matchState.outcome !== 'in_progress'
      : !!matchWinnerId
    const newStatus = isMatchComplete ? 'complete' : (allGames.length > 0 ? 'live' : 'pending')

    // ── 8. Update match row ──────────────────────────────────────────────────
    const { error: matchUpdateErr } = await supabase
      .from('matches')
      .update({
        player1_games: matchState.player1Games,
        player2_games: matchState.player2Games,
        winner_id:     matchWinnerId,
        status:        newStatus,
        started_at:    match.started_at ?? new Date().toISOString(),
        completed_at:  isMatchComplete ? new Date().toISOString() : null,
      })
      .eq('id', matchId)
    if (matchUpdateErr) return { success: false, error: matchUpdateErr.message }

    // ── 9. Team submatch: update parent team_match scores ──────────────────
    if (isTeamSubmatch && isMatchComplete) {
      const { updateSubmatchResult } = await import('./teamLeague')
      await updateSubmatchResult(matchId, match.tournament_id)
    }

    // ── 10. Propagate winner to next match (KO brackets only) ────────────────
    if (matchWinnerId && match.next_match_id) {
      const col = match.next_slot === 1 ? 'player1_id' : 'player2_id'
      const { error: propErr } = await supabase
        .from('matches').update({ [col]: matchWinnerId }).eq('id', match.next_match_id)
      if (propErr) return { success: false, error: `Match saved but bracket advance failed: ${propErr.message}` }
    }

    // ── 11. DE: route loser to Losers Bracket ────────────────────────────────
    const bracketSide = (match as unknown as { bracket_side?: string | null }).bracket_side
    const loserNextMatchId = (match as unknown as { loser_next_match_id?: string | null }).loser_next_match_id
    const loserNextSlot = (match as unknown as { loser_next_slot?: number | null }).loser_next_slot
    if (isMatchComplete && bracketSide === 'winners' && loserNextMatchId && matchWinnerId) {
      const loserId = match.player1_id === matchWinnerId ? match.player2_id : match.player1_id
      if (loserId) {
        const col = loserNextSlot === 1 ? 'player1_id' : 'player2_id'
        await supabase.from('matches').update({ [col]: loserId }).eq('id', loserNextMatchId)
      }
    }

    // ── 12. Grand Final / KO Final completion ─────────────────────────────────
    if (isMatchComplete && bracketSide === 'grand_final' && matchWinnerId) {
      const { advanceDEPlayers } = await import('./doubleElimination')
      await advanceDEPlayers(matchId, match.tournament_id)
    } else if (matchWinnerId && !match.next_match_id && match.match_kind !== 'round_robin' && bracketSide !== 'grand_final') {
      await supabase.from('tournaments').update({ status: 'complete' }).eq('id', match.tournament_id)
    }

    // ── 13. Audit log (fire and forget) ───────────────────────────────────────
    void supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
      const user = data.user
      if (user) {
        void supabase.from('audit_log').insert({
          actor_id:   user.id,
          action:     clearExistingFirst ? 'edit_bulk_game_scores' : 'bulk_save_game_scores',
          table_name: 'games',
          record_id:  matchId,
          new_data:   { games_saved: validEntries.length, games_skipped: skippedCount, match_status: newStatus, match_winner: matchWinnerId },
        })
      }
    })

    // ── 14. Revalidate ─────────────────────────────────────────────────────────
    const champId = (match.tournament as unknown as { championship_id: string | null }).championship_id
    revalidateMatchPaths(match.tournament_id, matchId, champId)
  }

  return { success: true, skippedCount, decidingGameNumber: filterResult.decidingGameNumber }
}
