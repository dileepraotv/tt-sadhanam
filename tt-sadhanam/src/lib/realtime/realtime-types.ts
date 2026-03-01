/**
 * realtime-types.ts
 *
 * Typed wrappers around raw Supabase Realtime payloads.
 *
 * Supabase sends `postgres_changes` events with:
 *   eventType: 'INSERT' | 'UPDATE' | 'DELETE'
 *   new: Partial<Row>   (present on INSERT / UPDATE)
 *   old: { id: string } (present on UPDATE / DELETE — only PK guaranteed)
 *
 * The raw `new` payload contains ONLY the columns in the table's
 * REPLICA IDENTITY. For most tables that means all columns.
 * BUT joined/computed columns (like player1.name) are NOT present —
 * those need a follow-up fetch.
 */

import type { Match, Game } from '@/lib/types'

// ── Raw Realtime payloads (what Supabase actually sends) ─────────────────────

/** Raw match row from Realtime (no joins, only scalar columns) */
export interface RawMatchPayload {
  id:             string
  tournament_id:  string
  round:          number
  match_number:   number
  player1_id:     string | null
  player2_id:     string | null
  player1_games:  number
  player2_games:  number
  winner_id:      string | null
  status:         string
  round_name:     string | null
  // v3 stage fields — present on all new matches; undefined on legacy
  stage_id?:      string | null
  group_id?:      string | null
  match_kind?:    'knockout' | 'round_robin'
  // We never surface next_match_id / next_slot to the public
}

/** Raw game row from Realtime */
export interface RawGamePayload {
  id:          string
  match_id:    string
  game_number: number
  score1:      number | null
  score2:      number | null
  winner_id:   string | null
}

// ── Connection state ──────────────────────────────────────────────────────────

export type RealtimeStatus =
  | 'connecting'   // initial / reconnecting
  | 'connected'    // SUBSCRIBED received
  | 'error'        // CHANNEL_ERROR or TIMED_OUT
  | 'closed'       // component unmounted / channel removed

// ── Reconciler types ──────────────────────────────────────────────────────────

/**
 * Optimistic match state layered on top of the server state.
 * The optimistic layer holds only the fields that can change via
 * Realtime events; everything else is taken from the server snapshot.
 *
 * We never create optimistic match records from scratch on the public page —
 * every update is a mutation of an existing server record. This keeps the
 * "what if Realtime drops a message" case safe: the server state is always
 * coherent and the optimistic layer is purely additive.
 */
export type OptimisticMatchPatch = Pick<Match,
  'player1_games' | 'player2_games' | 'winner_id' | 'status' |
  'player1_id' | 'player2_id'
>

/**
 * Apply a Realtime match payload on top of an existing Match record,
 * preserving all joined fields (player1, player2, winner objects) that
 * the raw payload doesn't include.
 *
 * The `freshFetch` flag should be set to true after a confirmed re-fetch:
 * in that case the returned object IS the server truth (joins included)
 * and the optimistic patch should be cleared.
 */
export function reconcileMatch(
  existing:    Match,
  rawPayload:  RawMatchPayload,
  playerCache: Map<string, Match['player1']>,
): Match {
  // If player IDs changed (winner propagation / bracket advance), look up
  // cached player objects from the full player list we hold in state.
  const player1 = rawPayload.player1_id
    ? (playerCache.get(rawPayload.player1_id) ?? existing.player1)
    : null

  const player2 = rawPayload.player2_id
    ? (playerCache.get(rawPayload.player2_id) ?? existing.player2)
    : null

  const winner = rawPayload.winner_id
    ? (playerCache.get(rawPayload.winner_id) ?? existing.winner)
    : null

  return {
    ...existing,
    // Scalar fields from raw payload
    player1_id:    rawPayload.player1_id,
    player2_id:    rawPayload.player2_id,
    player1_games: rawPayload.player1_games,
    player2_games: rawPayload.player2_games,
    winner_id:     rawPayload.winner_id,
    status:        rawPayload.status as Match['status'],
    round_name:    rawPayload.round_name ?? existing.round_name,
    // v3 stage fields — carry through if present in the payload
    stage_id:      rawPayload.stage_id   ?? existing.stage_id,
    group_id:      rawPayload.group_id   ?? existing.group_id,
    match_kind:    rawPayload.match_kind ?? existing.match_kind,
    // Joined objects (resolved from cache or preserved from existing)
    player1,
    player2,
    winner,
  }
}

/**
 * Apply a game INSERT or UPDATE to a game list.
 * Returns a new array (immutable update).
 */
export function reconcileGame(
  existing: Game[],
  payload:  RawGamePayload,
  event:    'INSERT' | 'UPDATE' | 'DELETE',
): Game[] {
  if (event === 'DELETE') {
    return existing.filter(g => g.id !== payload.id)
  }

  const incoming = payload as unknown as Game
  const idx      = existing.findIndex(g => g.id === incoming.id)

  if (idx === -1) {
    // INSERT — append and sort
    return [...existing, incoming].sort((a, b) => a.game_number - b.game_number)
  }

  // UPDATE — replace in place
  const updated = [...existing]
  updated[idx]  = { ...existing[idx], ...incoming }
  return updated
}

/**
 * Build a player-ID → Player lookup map from a match list.
 * Used to resolve player objects when a Realtime payload changes player IDs
 * (e.g., winner propagation sets player1_id/player2_id on a future match).
 */
export function buildPlayerCache(
  matches: Match[],
): Map<string, Match['player1']> {
  const map = new Map<string, Match['player1']>()
  matches.forEach(m => {
    if (m.player1_id && m.player1) map.set(m.player1_id, m.player1)
    if (m.player2_id && m.player2) map.set(m.player2_id, m.player2)
    if (m.winner_id  && m.winner)  map.set(m.winner_id,  m.winner)
  })
  return map
}
