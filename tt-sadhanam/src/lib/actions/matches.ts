'use server'

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
} from '@/lib/scoring/engine'
import { FORMAT_CONFIGS } from '@/lib/scoring/types'

// ── Shared: load match with its tournament format ─────────────────────────────
async function loadMatchWithFormat(supabase: ReturnType<typeof createClient>, matchId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, tournament_id, round, match_number,
      player1_id, player2_id, winner_id, status,
      next_match_id, next_slot, started_at,
      match_kind,
      tournament:tournaments ( id, format, status, championship_id )
    `)
    .eq('id', matchId)
    .single()
  if (error || !data) throw new Error('Match not found')
  return data
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

  // ── 1. Load match ───────────────────────────────────────────────────────────
  let match: Awaited<ReturnType<typeof loadMatchWithFormat>>
  try {
    match = await loadMatchWithFormat(supabase, matchId)
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const format    = (match.tournament as unknown as { format: MatchFormat }).format
  const player1Id = match.player1_id
  const player2Id = match.player2_id

  // ── 2. Load existing games ──────────────────────────────────────────────────
  const existingGames = await loadGames(supabase, matchId)

  // ── 3. Validate the score (table tennis rules) ──────────────────────────────
  const scoreValidation = validateGameScore({ score1, score2 })
  if (!scoreValidation.ok) {
    return { success: false, error: formatValidationErrors(scoreValidation) }
  }

  // ── 4. Check whether adding this game is allowed ────────────────────────────
  // Edits (same game_number already exists) bypass the "can add" check.
  const isEdit = existingGames.some(g => g.game_number === gameNumber)
  if (!isEdit) {
    const canAdd = canAddAnotherGame(existingGames, format, player1Id, player2Id, gameNumber)
    if (!canAdd.allowed) {
      return { success: false, error: canAdd.reason ?? 'Cannot add another game.' }
    }
  }

  // ── 5. Upsert game row ──────────────────────────────────────────────────────
  if (!player1Id || !player2Id) {
    return { success: false, error: 'Both players must be assigned before entering scores.' }
  }

  const gameWinnerId = deriveGameWinnerId(score1, score2, player1Id, player2Id)

  const { error: upsertErr } = await supabase
    .from('games')
    .upsert(
      { match_id: matchId, game_number: gameNumber, score1, score2, winner_id: gameWinnerId },
      { onConflict: 'match_id,game_number' },
    )
  if (upsertErr) return { success: false, error: upsertErr.message }

  // ── 6. Re-fetch all games as ground truth ───────────────────────────────────
  const allGames = await loadGames(supabase, matchId)

  // ── 7. Compute match state ──────────────────────────────────────────────────
  const matchState   = computeMatchState(allGames, format, player1Id, player2Id)

  const matchWinnerId: string | null =
    matchState.outcome === 'player1_wins' ? player1Id :
    matchState.outcome === 'player2_wins' ? player2Id :
    null

  const newStatus = matchWinnerId
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
      completed_at:  matchWinnerId ? new Date().toISOString() : null,
    })
    .eq('id', matchId)

  if (matchUpdateErr) return { success: false, error: matchUpdateErr.message }

  // ── 9a. Propagate winner to next match ──────────────────────────────────────
  if (matchWinnerId && match.next_match_id) {
    const col = match.next_slot === 1 ? 'player1_id' : 'player2_id'
    const { error: propErr } = await supabase
      .from('matches')
      .update({ [col]: matchWinnerId })
      .eq('id', match.next_match_id)
    if (propErr) console.error('[saveGameScore] propagation failed:', propErr.message)
  }

  // ── 9b. If this is the KO Final, mark tournament complete ──────────────────
  // Round-robin matches never advance via next_match_id, so we must guard
  // against incorrectly marking the tournament complete when an RR match ends.
  if (matchWinnerId && !match.next_match_id && match.match_kind !== 'round_robin') {
    await supabase
      .from('tournaments')
      .update({ status: 'complete' })
      .eq('id', match.tournament_id)
  }

  // ── 10. Audit log ───────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('audit_log').insert({
      actor_id:   user.id,
      action:     isEdit ? 'edit_game_score' : 'add_game_score',
      table_name: 'games',
      record_id:  matchId,
      new_data: { game_number: gameNumber, score1, score2, match_winner: matchWinnerId, match_status: newStatus },
    })
  }

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

  const format             = (match.tournament as unknown as { format: MatchFormat }).format
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
        .select('player1_id, player2_id, status')
        .eq('id', match.next_match_id)
        .single()

      if (nextMatch && nextMatch.status !== 'complete') {
        const wasInSlot1 = nextMatch.player1_id === previousWinnerId
        const col        = wasInSlot1 ? 'player1_id' : 'player2_id'
        await supabase.from('matches')
          .update({ [col]: newWinnerId ?? null })
          .eq('id', match.next_match_id)
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

  const { data: match } = await supabase
    .from('matches')
    .select('tournament_id, status, player1_id, player2_id')
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

  // Get championship_id for full revalidation
  const { data: tRow } = await supabase
    .from('tournaments').select('championship_id').eq('id', match.tournament_id).single()
  const champId = tRow?.championship_id ?? null
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

  const { data: match } = await supabase
    .from('matches')
    .select('tournament_id, player1_id, player2_id, status, next_match_id, match_kind')
    .eq('id', matchId)
    .single()

  if (!match) return { success: false, error: 'Match not found' }
  if (winnerId !== match.player1_id && winnerId !== match.player2_id)
    return { success: false, error: 'Winner must be one of the two players' }

  const { error } = await supabase.from('matches').update({
    status:       'complete',
    winner_id:    winnerId,
    completed_at: new Date().toISOString(),
  }).eq('id', matchId)

  if (error) return { success: false, error: error.message }

  // Advance winner in KO bracket
  if (match.next_match_id && match.match_kind !== 'round_robin') {
    const { data: nextMatch } = await supabase
      .from('matches')
      .select('player1_id, player2_id')
      .eq('id', match.next_match_id)
      .single()
    if (nextMatch) {
      const col = nextMatch.player1_id ? 'player2_id' : 'player1_id'
      await supabase.from('matches').update({ [col]: winnerId }).eq('id', match.next_match_id)
    }
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id, action: 'declare_winner', table_name: 'matches',
    record_id: matchId, new_data: { winner_id: winnerId, reason },
  }).then(() => {}) // ignore audit errors

  // Get championship_id for full revalidation
  const { data: tRow2 } = await supabase
    .from('tournaments').select('championship_id').eq('id', match.tournament_id).single()
  const champId2 = tRow2?.championship_id ?? null
  revalidateMatchPaths(match.tournament_id, matchId, champId2)

  return { success: true }
}
