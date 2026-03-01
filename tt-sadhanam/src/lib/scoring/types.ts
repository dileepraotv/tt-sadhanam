/**
 * scoring/types.ts
 *
 * All types consumed by the scoring engine, server action, and UI.
 * Kept in a single file so the type contract is easy to audit in one read.
 */

import type { MatchFormat } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// GAME SCORE INPUT
// ─────────────────────────────────────────────────────────────────────────────

/** Raw integers coming from the admin's score entry form. */
export interface GameScoreInput {
  score1:     number   // points for player 1
  score2:     number   // points for player 2
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every validation failure has:
 *  - a machine-readable `code` for programmatic branching
 *  - a human-readable `message` rendered directly in the UI
 *  - an optional `field` so the UI knows which input to highlight
 */
export type ValidationErrorCode =
  // Score value errors
  | 'SCORE_NEGATIVE'           // either score < 0
  | 'SCORE_NOT_INTEGER'        // fractional or NaN
  | 'SCORE_BOTH_ZERO'          // 0–0 is not a playable result
  | 'SCORE_TIE_NOT_DEUCE'      // equal scores where neither is ≥10 (impossible in TT)
  | 'GAME_WINNER_UNCLEAR'      // scores are equal (tie after deuce still in progress)
  // Win-condition errors
  | 'WINNER_BELOW_MINIMUM'     // winner scored < 11 points
  | 'WINNER_EXCEEDS_NORMAL'    // loser < 10 but winner > 11 (game should have ended at 11)
  | 'LEAD_TOO_SMALL'           // winner's margin < 2 (no win-by-2)
  | 'LOSER_ABOVE_WINNER'       // loser scored more than winner (data entry swap)
  | 'DEUCE_NOT_WIN_BY_TWO'     // both ≥10 but margin ≠ 2
  // Match state errors
  | 'MATCH_ALREADY_COMPLETE'   // trying to add game to a finished match
  | 'GAME_NUMBER_OUT_OF_RANGE' // game_number < 1 or > maxGames
  | 'GAME_ALREADY_DECIDED'     // game_number is beyond the point where match ended
  | 'MISSING_PLAYER'           // one or both player slots are still TBD

export interface ValidationError {
  code:     ValidationErrorCode
  message:  string
  field?:   'score1' | 'score2' | 'both' | 'match'
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] }

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE (outcome of a single game)
// ─────────────────────────────────────────────────────────────────────────────

export type GameOutcome = 'player1_wins' | 'player2_wins'

export interface ComputedGame {
  gameNumber: number
  score1:     number
  score2:     number
  outcome:    GameOutcome
  isDeuce:    boolean   // both players reached 10+ and margin = 2
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCH STATE (computed from the full list of games)
// ─────────────────────────────────────────────────────────────────────────────

export type MatchOutcome =
  | 'in_progress'    // match still going
  | 'player1_wins'   // player 1 reached gamesNeeded first
  | 'player2_wins'   // player 2 reached gamesNeeded first

export interface ComputedMatchState {
  /** Games won by player 1 so far. */
  player1Games:  number
  /** Games won by player 2 so far. */
  player2Games:  number
  /** Overall match outcome. */
  outcome:       MatchOutcome
  /** Validated + enriched list of all scored games. */
  games:         ComputedGame[]
  /**
   * The game number at which the match was decided.
   * Undefined if the match is still in progress.
   */
  decidingGame?: number
  /**
   * Remaining games that COULD be played.
   * 0 when the match is complete.
   */
  gamesRemaining: number
}

// ─────────────────────────────────────────────────────────────────────────────
// canAddAnotherGame RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface CanAddGameResult {
  allowed:    boolean
  reason?:    string   // human-readable explanation when not allowed
  nextGameNumber: number   // always set; use this as the new game_number
}

// ─────────────────────────────────────────────────────────────────────────────
// Format config helper (extended from types.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface FormatConfig {
  format:       MatchFormat
  gamesNeeded:  number   // ceil(K/2) — first to win this many games wins the match
  maxGames:     number   // K (3, 5, or 7)
  label:        string
}

export const FORMAT_CONFIGS: Record<MatchFormat, FormatConfig> = {
  bo3: { format: 'bo3', gamesNeeded: 2, maxGames: 3, label: 'Best of 3' },
  bo5: { format: 'bo5', gamesNeeded: 3, maxGames: 5, label: 'Best of 5' },
  bo7: { format: 'bo7', gamesNeeded: 4, maxGames: 7, label: 'Best of 7' },
}
