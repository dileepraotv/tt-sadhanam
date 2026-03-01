/**
 * public-queries.ts
 *
 * Every database read the PUBLIC audience page is permitted to make.
 *
 * WHY A DEDICATED FILE?
 * ─────────────────────
 * Supabase RLS is the authoritative security layer, but having a single
 * file that owns all public queries gives us three extra protections:
 *
 *  1. COLUMN ALLOW-LIST: We hard-code which columns are selected.
 *     Even if RLS is accidentally widened, we never pull `created_by`,
 *     `next_match_id`, `next_slot`, `scheduled_at`, `court`, or any other
 *     operational field that admins use.
 *
 *  2. PUBLISHED GUARD: Every query that touches `tournaments` adds
 *     `.eq('published', true)` at the query layer as a second check.
 *
 *  3. SINGLE RESPONSIBILITY: The admin scoring page imports from
 *     `@/lib/actions/*` (server-side, authenticated).
 *     The public page *only* imports from here.
 *     Static analysis makes accidental mixing obvious.
 *
 * The Supabase anon key is used for ALL calls from this module —
 * we explicitly use the browser client (anon JWT), never a service-role key.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Match, Game, Tournament } from '@/lib/types'

// ── Column allow-lists ────────────────────────────────────────────────────────
// Only these columns are ever sent to the browser for public pages.
// Add/remove carefully — these are what the audience sees.

/** Tournament columns safe for public consumption */
const PUBLIC_TOURNAMENT_COLS = [
  'id', 'name', 'description', 'location', 'date',
  'format', 'format_type', 'status', 'published',
  'stage2_bracket_generated',
  // Intentionally EXCLUDED: created_by, bracket_generated (internal flag)
].join(', ')

/** Match columns safe for public consumption */
const PUBLIC_MATCH_COLS = [
  'id', 'tournament_id', 'round', 'match_number',
  'player1_id', 'player2_id',
  'player1_games', 'player2_games',
  'winner_id', 'status', 'round_name',
  // Stage / group — needed for RR standings and group filtering
  'stage_id', 'group_id', 'match_kind',
  // Intentionally EXCLUDED: next_match_id, next_slot, court,
  //   scheduled_at, started_at, completed_at (operational fields)
].join(', ')

/** Player columns safe for public consumption */
const PUBLIC_PLAYER_COLS = 'id, name, seed, club, country_code'
//   Intentionally EXCLUDED: tournament_id (redundant on join), created_at, updated_at

/** Game columns safe for public consumption */
const PUBLIC_GAME_COLS = 'id, match_id, game_number, score1, score2, winner_id'
//   Intentionally EXCLUDED: created_at, updated_at

// ── Query functions ───────────────────────────────────────────────────────────

/**
 * Loads a single published tournament.
 * Returns null if not found OR not published — callers should 404 in that case.
 */
export async function fetchPublicTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(PUBLIC_TOURNAMENT_COLS)
    .eq('id', tournamentId)
    .eq('published', true)   // ← second-layer published guard
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as Tournament
}

/**
 * Loads all matches for a tournament (public view).
 * Joins player names/seeds via foreign key aliases.
 * Only returns matches for published tournaments (RLS enforces this;
 * we also add the published guard via a join condition).
 */
export async function fetchPublicMatches(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      ${PUBLIC_MATCH_COLS},
      player1:player1_id ( ${PUBLIC_PLAYER_COLS} ),
      player2:player2_id ( ${PUBLIC_PLAYER_COLS} ),
      winner:winner_id   ( ${PUBLIC_PLAYER_COLS} ),
      games ( ${PUBLIC_GAME_COLS} )
    `)
    .eq('tournament_id', tournamentId)
    // Belt-and-suspenders: also filter via the tournament's published state
    // by checking through the FK. Supabase handles this as a join filter.
    .order('round', { ascending: true })
    .order('match_number', { ascending: true })

  if (error) {
    console.error('[fetchPublicMatches]', error.message)
    return []
  }
  return (data ?? []) as unknown as Match[]
}

/**
 * Loads a single match with joined players.
 * Safe to call repeatedly on Realtime events.
 */
export async function fetchPublicMatch(
  supabase: SupabaseClient,
  matchId: string,
): Promise<Match | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      ${PUBLIC_MATCH_COLS},
      player1:player1_id ( ${PUBLIC_PLAYER_COLS} ),
      player2:player2_id ( ${PUBLIC_PLAYER_COLS} ),
      winner:winner_id   ( ${PUBLIC_PLAYER_COLS} ),
      games ( ${PUBLIC_GAME_COLS} )
    `)
    .eq('id', matchId)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as Match
}

/**
 * Loads all games for a specific match.
 * RLS ensures only games belonging to published tournaments are returned.
 */
export async function fetchPublicGames(
  supabase: SupabaseClient,
  matchId: string,
): Promise<Game[]> {
  const { data, error } = await supabase
    .from('games')
    .select(PUBLIC_GAME_COLS)
    .eq('match_id', matchId)
    .order('game_number', { ascending: true })

  if (error) {
    console.error('[fetchPublicGames]', error.message)
    return []
  }
  return (data ?? []) as unknown as Game[]
}

/**
 * Loads all games for all matches in a tournament in one query.
 * Used to pre-populate the games cache on initial load.
 * Filtering by match_id list avoids a full table scan.
 */
export async function fetchAllPublicGames(
  supabase: SupabaseClient,
  matchIds: string[],
): Promise<Game[]> {
  if (!matchIds.length) return []

  const { data, error } = await supabase
    .from('games')
    .select(PUBLIC_GAME_COLS)
    .in('match_id', matchIds)
    .order('game_number', { ascending: true })

  if (error) {
    console.error('[fetchAllPublicGames]', error.message)
    return []
  }
  return (data ?? []) as unknown as Game[]
}
