/**
 * roundrobin/types.ts
 *
 * All types for the round-robin subsystem.
 * Kept separate from src/lib/types.ts so the RR modules are independently
 * importable without pulling in the full app type graph.
 *
 * Integration contract:
 *   • RRFixture feeds into DB insert → becomes a Match row with match_kind='round_robin'
 *   • PlayerStanding is computed from Match[] + Game[] (same tables as knockout)
 *   • RRGroup mirrors the rr_groups DB table
 *   • RRGroupMember mirrors rr_group_members
 */

import type { MatchFormat } from '@/lib/types'

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * A single fixture produced by the scheduler.
 * round   = matchday number (1-based). All groups share the same matchday
 *           numbering so "matchday 1" means every group plays their first round.
 * player1Id / player2Id = actual player UUIDs (BYE_PLAYER_ID for byes).
 */
export interface RRFixture {
  round:      number
  player1Id:  string
  player2Id:  string
  isBye:      boolean   // true when one slot is BYE_PLAYER_ID
}

/**
 * Sentinel value used internally when a group has an odd number of players.
 * Any fixture containing this ID should be omitted or stored with status='bye'.
 */
export const BYE_PLAYER_ID = '__BYE__' as const

// ─── Groups ───────────────────────────────────────────────────────────────────

/** Mirrors the rr_groups DB table, enriched with member player IDs. */
export interface RRGroup {
  id:           string        // DB uuid
  stageId:      string
  name:         string        // "Group A", "Group B", …
  groupNumber:  number        // 1-based
  playerIds:    string[]      // ordered (seeded first, then unseeded)
}

/** Mirrors the rr_group_members DB table. */
export interface RRGroupMember {
  groupId:   string
  playerId:  string
}

// ─── Stage ────────────────────────────────────────────────────────────────────

/**
 * Config stored in stages.config JSONB for a round-robin stage.
 * Typed here so callers can read/write it safely.
 */
export interface RRStageConfig {
  numberOfGroups:  number
  advanceCount:    number          // top N per group advance to KO
  matchFormat:     MatchFormat     // format for all RR matches in this stage
}

/**
 * Config stored in stages.config JSONB for a knockout stage.
 * Minimal — format comes from the tournament row.
 */
export interface KOStageConfig {
  seededFromRR?: boolean           // true = players were advanced from RR stage
}

// ─── Standings ────────────────────────────────────────────────────────────────

/**
 * Complete standing row for one player in one group.
 * Computed entirely from Match + Game rows — never stored in DB.
 */
export interface PlayerStanding {
  playerId:         string
  playerName:       string
  playerSeed:       number | null
  playerClub:       string | null

  /** Matches that have reached status='complete' (excludes live, pending, bye) */
  matchesPlayed:    number
  wins:             number
  losses:           number

  /** Games won minus games lost across all completed matches in the group */
  gameDifference:   number
  gamesWon:         number
  gamesLost:        number

  /** Total points scored minus conceded from game scores (score1/score2) */
  pointsDifference: number
  pointsScored:     number
  pointsConceded:   number

  /** Final rank within the group (1 = top). Set after sorting + tiebreaking. */
  rank:             number

  /** True if this player qualifies for the next stage given advanceCount. */
  advances:         boolean
}

/**
 * A group's full standing result, ready for rendering.
 */
export interface GroupStandings {
  group:     RRGroup
  standings: PlayerStanding[]
}

// ─── Tiebreaker trace (for debugging / UI tooltip) ────────────────────────────

/**
 * Which tiebreaker rule was decisive in separating two players.
 * Surfaces in the UI as a small tooltip explaining the ranking.
 */
export type TiebreakerReason =
  | 'wins'
  | 'head_to_head'
  | 'game_difference'
  | 'points_difference'
  | 'player_id'       // last-resort stable sort — effectively a coin flip

// ─── DB action inputs ─────────────────────────────────────────────────────────

/** Input to createRoundRobinStage. */
export interface CreateRRStageInput {
  tournamentId:   string
  stageNumber:    number           // 1 for the first (and usually only) RR stage
  numberOfGroups: number           // 1–16
  advanceCount:   number           // top N per group advance
  matchFormat:    MatchFormat      // bo3 / bo5 / bo7 for all RR matches
}

/** Input to assignPlayersToGroups. */
export interface AssignPlayersInput {
  stageId:         string
  numberOfGroups:  number
  players: Array<{
    id:   string
    seed: number | null
    name: string
  }>
  rngSeed?: number    // optional deterministic seed for unseeded player shuffle
}
