'use server'
// cache-bust: 1773593664

/**
 * actions/doubleElimination.ts
 *
 * Server actions for the double_elimination format.
 *
 * Architecture:
 *   All WB, LB, and GF matches go into the existing matches table.
 *   bracket_side column distinguishes 'winners' | 'losers' | 'grand_final'.
 *   match_kind = 'knockout' for all DE matches (reuses existing scoring).
 *   loser_next_match_id routes losers to the correct LB slot.
 *
 * Winner/loser advancement:
 *   When saveGameScore() sets a match complete, the DE listener in
 *   advanceDEPlayers() propagates the winner and loser to their next slots.
 *   This is called separately from the scoring flow.
 *
 * Reset:
 *   resetDEBracket() — deletes all matches+games, unsets bracket_generated
 */

import { revalidatePath }   from 'next/cache'
import { createClient }     from '@/lib/supabase/server'
import type { Player }      from '@/lib/types'
import { generateDoubleEliminationBracket } from '@/lib/bracket/doubleElimination'
import { revalidateTournamentPaths } from '@/lib/actions/stages'

// ─────────────────────────────────────────────────────────────────────────────
// generateDEBracket
// Generates all WB + LB + GF match rows for a double_elimination tournament.
// Idempotent: clears existing matches first.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateDEBracket(
  tournamentId: string,
): Promise<{ error?: string; totalMatches?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: t } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load players (ordered by seed)
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
  if (pErr) return { error: pErr.message }
  if (!players || players.length < 2) {
    return { error: 'Need at least 2 players to generate a bracket.' }
  }

  // Clear existing matches + games
  const { data: existingMatches } = await supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const existingIds = (existingMatches ?? []).map(m => m.id)
  if (existingIds.length > 0) {
    await supabase.from('games').delete().in('match_id', existingIds)
    await supabase.from('matches').delete().eq('tournament_id', tournamentId)
  }

  // Generate bracket structure
  const result = generateDoubleEliminationBracket(players as unknown as Player[], Date.now())
  const { winnersBracket, losersBracket, grandFinal, totalMatches } = result

  const allMatches = [...winnersBracket, ...losersBracket, ...grandFinal]

  // Assign globally unique match_numbers to avoid the unique constraint on
  // (tournament_id, round, match_number). WB/LB/GF all use round=1,2,... internally
  // which collide. We encode bracket_side into match_number via offsets:
  //   WB: match_number as-is (1-based per round)
  //   LB: offset by 10000
  //   GF: offset by 20000
  // This preserves display ordering while guaranteeing uniqueness.
  const matchNumberOffset = (side: string) =>
    side === 'losers' ? 10000 : side === 'grand_final' ? 20000 : 0

  // Build match rows using the pre-assigned IDs from the generator
  const rows = allMatches.map(m => ({
    id:                    m.id,
    tournament_id:         tournamentId,
    round:                 m.round,
    match_number:          m.matchNumber + matchNumberOffset(m.bracketSide),
    round_name:            m.roundName,
    player1_id:            m.player1Id,
    player2_id:            m.player2Id,
    player1_games:         0,
    player2_games:         0,
    winner_id:             m.isBye ? (m.player1Id ?? m.player2Id) : null,
    status:                m.isBye ? 'bye' : 'pending',
    next_match_id:         m.nextMatchId,
    next_slot:             m.nextSlot,
    loser_next_match_id:   m.loserNextMatchId,
    loser_next_slot:       m.loserNextSlot,
    match_kind:            'knockout',
    bracket_side:          m.bracketSide,
  }))

  const { error: insertErr } = await supabase.from('matches').insert(rows)
  if (insertErr) return { error: insertErr.message }

  // Auto-advance WB R1 bye winners into next WB match
  const byeMatches = rows.filter(r => r.status === 'bye')
  for (const bm of byeMatches) {
    if (bm.next_match_id && bm.winner_id) {
      const col = bm.next_slot === 1 ? 'player1_id' : 'player2_id'
      await supabase.from('matches')
        .update({ [col]: bm.winner_id })
        .eq('id', bm.next_match_id)
    }
  }

  // Mark tournament as generated + active + published
  await supabase.from('tournaments').update({
    bracket_generated: true,
    status:            'active',
    published:         true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return { totalMatches }
}

// ─────────────────────────────────────────────────────────────────────────────
// advanceDEPlayers
// Called after a DE match completes (triggered from scoring UI).
// Routes the winner to next_match_id and loser to loser_next_match_id.
//
// The Grand Final (bracket reset) match is a special case:
//   - GF1: WB champ (p1) vs LB champ (p2)
//   - If WB champ wins → tournament over, GF2 not played
//   - If LB champ wins → GF2 (reset) played; update status to 'pending' active
// ─────────────────────────────────────────────────────────────────────────────
export async function advanceDEPlayers(
  matchId: string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single()
  if (!match || match.status !== 'complete') return {}

  const winnerId = match.winner_id
  const loserId  = match.player1_id === winnerId ? match.player2_id : match.player1_id

  // Advance winner
  if (match.next_match_id && winnerId) {
    const col = match.next_slot === 1 ? 'player1_id' : 'player2_id'
    await supabase.from('matches')
      .update({ [col]: winnerId })
      .eq('id', match.next_match_id)
  }

  // Route loser into LB (only for WB matches)
  if (match.bracket_side === 'winners' && match.loser_next_match_id && loserId) {
    const col = match.loser_next_slot === 1 ? 'player1_id' : 'player2_id'
    await supabase.from('matches')
      .update({ [col]: loserId })
      .eq('id', match.loser_next_match_id)
  }

  // Grand Final special case: if WB champion wins GF1, mark tournament complete
  // and skip GF2 (the bracket-reset match).
  if (match.bracket_side === 'grand_final' && match.round === 1) {
    const isWBChampWin = match.player1_id === winnerId  // p1 is always WB champion

    if (isWBChampWin) {
      // No reset needed — tournament done
      await supabase.from('tournaments')
        .update({ status: 'complete' })
        .eq('id', tournamentId)

      // Mark GF2 (reset) as 'bye' (will not be played)
      if (match.next_match_id) {
        await supabase.from('matches')
          .update({ status: 'bye', winner_id: winnerId })
          .eq('id', match.next_match_id)
      }
    } else {
      // LB champion won — seed both players into GF2 (reset)
      if (match.next_match_id) {
        await supabase.from('matches').update({
          player1_id: loserId,   // former WB champion = loser of GF1
          player2_id: winnerId,  // LB champion = winner of GF1
        }).eq('id', match.next_match_id)
      }
    }
  }

  // GF2 complete — tournament done
  if (match.bracket_side === 'grand_final' && match.round === 2) {
    await supabase.from('tournaments')
      .update({ status: 'complete' })
      .eq('id', tournamentId)
  }

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// resetDEBracket
// ─────────────────────────────────────────────────────────────────────────────
export async function resetDEBracket(
  tournamentId: string,
): Promise<{ error?: string; matchesDeleted?: number }> {
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

  const { data: matches } = await supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', tournamentId)
  const ids = (matches ?? []).map(m => m.id)
  if (ids.length > 0) {
    await supabase.from('games').delete().in('match_id', ids)
    await supabase.from('matches').delete().eq('tournament_id', tournamentId)
  }

  await supabase.from('tournaments').update({
    bracket_generated: false,
    status:            'setup',
    published:         false,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return { matchesDeleted: ids.length }
}
