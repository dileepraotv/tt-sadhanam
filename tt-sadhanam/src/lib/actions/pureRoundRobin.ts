'use server'

/**
 * actions/pureRoundRobin.ts
 *
 * Server actions for the pure_round_robin format.
 *
 * Pure round robin: every player plays every other player exactly once.
 * No groups, no stages table — matches go directly into the matches table
 * with match_kind = 'round_robin'.
 *
 * Lifecycle:
 *   Players added  →  generateLeagueFixtures()  →  matches inserted
 *   Scores entered →  existing saveGameScore() — unchanged
 *   Standings      →  computeLeagueStandings() (server query) — derived live
 *
 * Reset:
 *   resetLeague() — deletes all matches+games, unsets bracket_generated
 */

import { revalidatePath } from 'next/cache'
import { createClient }   from '@/lib/supabase/server'
import type { Player, MatchFormat } from '@/lib/types'
import { generateLeagueSchedule } from '@/lib/roundrobin/leagueScheduler'
import { BYE_PLAYER_ID } from '@/lib/roundrobin/types'
import { revalidateTournamentPaths } from '@/lib/actions/stages'

// ─────────────────────────────────────────────────────────────────────────────
// generateLeagueFixtures
// Generates all round-robin match rows for a pure_round_robin tournament.
// Idempotent: clears existing matches first.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateLeagueFixtures(
  tournamentId: string,
): Promise<{ error?: string; matchCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify ownership
  const { data: t } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()
  if (!t) return { error: 'Tournament not found' }

  // Load players
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, name, seed')
    .eq('tournament_id', tournamentId)
    .order('seed', { ascending: true, nullsFirst: false })
  if (pErr) return { error: pErr.message }
  if (!players || players.length < 2) {
    return { error: 'Need at least 2 players to generate a schedule.' }
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

  // Generate fixtures
  const playerIds = players.map(p => p.id)
  const fixtures  = generateLeagueSchedule(playerIds)

  const matchFormat = (t.format as MatchFormat) ?? 'bo5'

  // Build match rows
  const rows = fixtures.map(f => ({
    tournament_id: tournamentId,
    round:         f.round,
    match_number:  f.matchNumber,
    round_name:    `Matchday ${f.round}`,
    player1_id:    f.isBye ? (f.player1Id === BYE_PLAYER_ID ? null : f.player1Id) : f.player1Id,
    player2_id:    f.isBye ? (f.player2Id === BYE_PLAYER_ID ? null : f.player2Id) : f.player2Id,
    player1_games: 0,
    player2_games: 0,
    winner_id:     null,
    status:        f.isBye ? 'bye' : 'pending',
    next_match_id: null,
    next_slot:     null,
    match_kind:    'round_robin',
    match_format:  matchFormat,
  }))

  const { error: insertErr } = await supabase.from('matches').insert(rows)
  if (insertErr) return { error: insertErr.message }

  // Mark tournament as generated + active + published
  await supabase.from('tournaments').update({
    bracket_generated: true,
    status:            'active',
    published:         true,
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)

  const realMatches = fixtures.filter(f => !f.isBye).length
  return { matchCount: realMatches }
}

// ─────────────────────────────────────────────────────────────────────────────
// resetLeague
// Deletes all matches+games and unsets bracket_generated flag.
// ─────────────────────────────────────────────────────────────────────────────
export async function resetLeague(
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
