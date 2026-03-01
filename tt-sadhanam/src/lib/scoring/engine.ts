/**
 * scoring/engine.ts
 *
 * Pure TypeScript scoring logic — no database, no side effects.
 *
 * Table tennis scoring rules implemented here:
 *   • A game is played to 11 points minimum.
 *   • A player must win by 2 clear points (deuce rule).
 *   • In deuce (10–10), play continues until one player leads by 2.
 *     e.g. 12–10, 13–11, 25–23 are all valid game scores.
 *   • A match is best-of-K where K ∈ {3, 5, 7}.
 *   • Win condition: first to ceil(K/2) games.
 *     Bo3 → 2,  Bo5 → 3,  Bo7 → 4.
 *   • No more games may be played once the win condition is reached.
 *
 * All functions are deterministic and side-effect-free, making them
 * trivial to unit-test and safe to call from both client and server.
 */

import type {
  GameScoreInput,
  ComputedGame,
  ComputedMatchState,
  CanAddGameResult,
  ValidationResult,
  ValidationError,
  GameOutcome,
  MatchOutcome,
} from './types'
import { FORMAT_CONFIGS } from './types'
import type { MatchFormat, Game } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// 1. validateGameScore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single game score against table tennis rules.
 *
 * Validation order (each check builds on the previous):
 *  1. Type/range checks (integers, non-negative)
 *  2. Tie check — equal scores must be in deuce territory (both ≥ 10)
 *  3. Winner identification — one player must have more points
 *  4. Minimum score — winner must have ≥ 11 points
 *  5. Win-by-2 — margin must be exactly 2 (enforces deuce rule)
 *
 * Returns all errors found, not just the first, so the UI can highlight
 * every problem at once.
 *
 * @example
 * validateGameScore({ score1: 11, score2: 9 })  // { ok: true }
 * validateGameScore({ score1: 12, score2: 10 }) // { ok: true }  ← deuce
 * validateGameScore({ score1: 11, score2: 10 }) // { ok: false } ← no 2-point lead
 * validateGameScore({ score1: 10, score2: 10 }) // { ok: false } ← game not finished
 * validateGameScore({ score1: 9,  score2: 7  }) // { ok: false } ← below 11
 */
export function validateGameScore(input: GameScoreInput): ValidationResult {
  const errors: ValidationError[] = []
  const { score1, score2 } = input

  // ── 1. Type checks ──────────────────────────────────────────────────────────
  if (!Number.isInteger(score1) || !Number.isInteger(score2)) {
    errors.push({
      code:    'SCORE_NOT_INTEGER',
      message: 'Scores must be whole numbers.',
      field:   'both',
    })
    return { ok: false, errors }   // cannot proceed without integers
  }

  if (score1 < 0) {
    errors.push({ code: 'SCORE_NEGATIVE', message: 'Player 1 score cannot be negative.', field: 'score1' })
  }
  if (score2 < 0) {
    errors.push({ code: 'SCORE_NEGATIVE', message: 'Player 2 score cannot be negative.', field: 'score2' })
  }
  if (errors.length) return { ok: false, errors }

  // ── 2. Both zero ─────────────────────────────────────────────────────────────
  if (score1 === 0 && score2 === 0) {
    return {
      ok: false,
      errors: [{ code: 'SCORE_BOTH_ZERO', message: 'A 0–0 game is not a valid result.', field: 'both' }],
    }
  }

  // ── 3. Tie check ─────────────────────────────────────────────────────────────
  if (score1 === score2) {
    if (score1 < 10) {
      // Tied below 10 is impossible in TT — one player must win a point to advance
      return {
        ok: false,
        errors: [{
          code:    'SCORE_TIE_NOT_DEUCE',
          message: `A ${score1}–${score2} tie is impossible. Games can only tie at 10–10 or higher (deuce).`,
          field:   'both',
        }],
      }
    }
    // score1 === score2 ≥ 10 → deuce, game still in progress
    return {
      ok: false,
      errors: [{
        code:    'GAME_WINNER_UNCLEAR',
        message: `At ${score1}–${score2} the game is still in progress (deuce). Enter the final score when a player leads by 2.`,
        field:   'both',
      }],
    }
  }

  // ── 4. Identify winner and loser ─────────────────────────────────────────────
  const [winnerScore, loserScore] =
    score1 > score2 ? [score1, score2] : [score2, score1]
  const margin = winnerScore - loserScore

  // ── 5. Minimum winning score ─────────────────────────────────────────────────
  if (winnerScore < 11) {
    errors.push({
      code:    'WINNER_BELOW_MINIMUM',
      message: `The winning score must be at least 11. Got ${winnerScore}.`,
      field:   score1 > score2 ? 'score1' : 'score2',
    })
  }

  // ── 6. Win-by-2 rule ─────────────────────────────────────────────────────────
  // In normal play (no deuce) the margin is exactly winnerScore - loserScore.
  // In deuce (both ≥ 10) the margin must be exactly 2.
  // In ALL cases, the margin must be ≥ 2.
  if (margin < 2) {
    errors.push({
      code:    'LEAD_TOO_SMALL',
      message: `A game must be won by 2 clear points. The current margin is only ${margin}.`,
      field:   'both',
    })
  }

  // ── 7. Non-deuce: winner must be exactly 11 ──────────────────────────────────
  // If the loser has fewer than 10 points, deuce never happened.
  // The game ends the moment someone reaches 11, so the winner cannot exceed 11.
  // e.g. 18–5 is impossible — the game would have ended at 11–5.
  if (loserScore < 10 && winnerScore > 11) {
    errors.push({
      code:    'WINNER_EXCEEDS_NORMAL',
      message: `If the opponent has ${loserScore} points, the game ends at 11–${loserScore}. A score of ${winnerScore}–${loserScore} is impossible — did you mean 11–${loserScore}?`,
      field:   score1 > score2 ? 'score1' : 'score2',
    })
  }

  // ── 8. Deuce territory: margin must be exactly 2 ─────────────────────────────
  // In deuce (both ≥ 10), margin must be EXACTLY 2 — not 3, 4, etc.
  // (A margin of 3+ means someone failed to call game at the right point.)
  if (loserScore >= 10 && margin > 2) {
    errors.push({
      code:    'DEUCE_NOT_WIN_BY_TWO',
      message: `In deuce the margin must be exactly 2. Got ${winnerScore}–${loserScore} (margin ${margin}). Did you mean ${loserScore + 2}–${loserScore}?`,
      field:   'both',
    })
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeMatchState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the full match state from a list of saved game rows.
 *
 * The function is intentionally forgiving about out-of-order game numbers —
 * it sorts by game_number before processing, so database insertion order
 * doesn't affect the result.
 *
 * Games beyond the deciding game are counted but flagged; this lets the UI
 * show them as "surplus" and give the admin a chance to delete them.
 *
 * @param games       Raw game rows from the database (may be empty).
 * @param format      The tournament format ('bo3' | 'bo5' | 'bo7').
 * @param player1Id   UUID of player 1 (used to interpret winner_id).
 * @param player2Id   UUID of player 2.
 */
export function computeMatchState(
  games:     Game[],
  format:    MatchFormat,
  player1Id: string | null,
  player2Id: string | null,
): ComputedMatchState {
  const { gamesNeeded, maxGames } = FORMAT_CONFIGS[format]

  // Sort games by game_number ascending
  const sorted = [...games].sort((a, b) => a.game_number - b.game_number)

  let p1Games     = 0
  let p2Games     = 0
  let decidingGame: number | undefined
  const computed: ComputedGame[] = []

  for (const g of sorted) {
    // Once the match is decided, subsequent games are surplus
    if (decidingGame !== undefined) {
      // Still include them in computed so UI can display and offer deletion
      computed.push(buildComputedGame(g, player1Id, player2Id))
      continue
    }

    const cg = buildComputedGame(g, player1Id, player2Id)
    computed.push(cg)

    if (cg.outcome === 'player1_wins') p1Games++
    else if (cg.outcome === 'player2_wins') p2Games++

    if (p1Games >= gamesNeeded || p2Games >= gamesNeeded) {
      decidingGame = g.game_number
    }
  }

  let outcome: MatchOutcome = 'in_progress'
  if (p1Games >= gamesNeeded) outcome = 'player1_wins'
  else if (p2Games >= gamesNeeded) outcome = 'player2_wins'

  // Games remaining = how many more could be played before format limit
  const playedCount  = sorted.filter(g => g.game_number <= (decidingGame ?? Infinity)).length
  const gamesRemaining = outcome !== 'in_progress'
    ? 0
    : maxGames - playedCount

  return {
    player1Games: p1Games,
    player2Games: p2Games,
    outcome,
    games:        computed,
    decidingGame,
    gamesRemaining,
  }
}

/** Convert a raw DB game row into a ComputedGame. */
function buildComputedGame(
  g:         Game,
  player1Id: string | null,
  player2Id: string | null,
): ComputedGame {
  const s1 = g.score1 ?? 0
  const s2 = g.score2 ?? 0

  let outcome: GameOutcome
  if (s1 > s2) outcome = 'player1_wins'
  else outcome = 'player2_wins'   // tie → treated as p2 wins (shouldn't happen if validated)

  return {
    gameNumber: g.game_number,
    score1:     s1,
    score2:     s2,
    outcome,
    isDeuce:    s1 >= 10 && s2 >= 10,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. canAddAnotherGame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether a new game row can be saved to the database.
 *
 * Checks (in order):
 *  1. Both player slots must be filled (not TBD).
 *  2. The match must not already be complete.
 *  3. The game number must not exceed the format's maximum.
 *  4. The game number must not be beyond where the match was decided
 *     (e.g., cannot add game 4 if player already won 3–0 in Bo5).
 *
 * Always returns the next expected game_number so the UI can
 * pre-fill it without the caller doing any arithmetic.
 *
 * @param existingGames  Games already saved for this match.
 * @param format         Tournament format.
 * @param player1Id      UUID of player 1 (null → slot not yet filled).
 * @param player2Id      UUID of player 2 (null → slot not yet filled).
 * @param gameNumber     The game_number the admin is trying to save (1-based).
 */
export function canAddAnotherGame(
  existingGames: Game[],
  format:        MatchFormat,
  player1Id:     string | null,
  player2Id:     string | null,
  gameNumber:    number,
): CanAddGameResult {
  const { maxGames } = FORMAT_CONFIGS[format]
  const state        = computeMatchState(existingGames, format, player1Id, player2Id)
  const nextGameNum  = (existingGames.length > 0
    ? Math.max(...existingGames.map(g => g.game_number))
    : 0) + 1

  // 1. Players must both be assigned
  if (!player1Id || !player2Id) {
    return {
      allowed:        false,
      reason:         'Both player slots must be filled before scores can be entered.',
      nextGameNumber: nextGameNum,
    }
  }

  // 2. Match already complete
  if (state.outcome !== 'in_progress') {
    const winner = state.outcome === 'player1_wins' ? 'Player 1' : 'Player 2'
    return {
      allowed:        false,
      reason:         `The match is already complete — ${winner} won. Delete the deciding game first to make a correction.`,
      nextGameNumber: nextGameNum,
    }
  }

  // 3. Exceeds format maximum
  if (gameNumber > maxGames) {
    return {
      allowed:        false,
      reason:         `Game ${gameNumber} exceeds the maximum of ${maxGames} games for this format.`,
      nextGameNumber: nextGameNum,
    }
  }

  // 4. Beyond deciding game (shouldn't happen in normal flow, but guards corrections)
  if (state.decidingGame !== undefined && gameNumber > state.decidingGame) {
    return {
      allowed:        false,
      reason:         `The match was decided in game ${state.decidingGame}. Game ${gameNumber} should not exist.`,
      nextGameNumber: nextGameNum,
    }
  }

  return { allowed: true, nextGameNumber: nextGameNum }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. deriveGameWinnerId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a validated game score, return the winner's player ID.
 * Call this ONLY after validateGameScore returns { ok: true }.
 */
export function deriveGameWinnerId(
  score1:    number,
  score2:    number,
  player1Id: string,
  player2Id: string,
): string {
  return score1 > score2 ? player1Id : player2Id
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Convenience: formatValidationErrors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten all validation errors into a single user-facing string.
 * Useful when there is only one place to show errors (toast, alert, etc.)
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.ok) return ''
  return result.errors.map(e => e.message).join(' ')
}

/**
 * Get errors that apply to a specific field (or to 'both' fields).
 * Useful to show field-level error messages directly below each input.
 */
export function errorsForField(
  result: ValidationResult,
  field:  'score1' | 'score2',
): ValidationError[] {
  if (result.ok) return []
  return result.errors.filter(e => e.field === field || e.field === 'both')
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. inferGameNumbersToShow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the list of game numbers (1-based) that should be rendered in the
 * scoring UI. Always shows games up to max(saved, format max), but never
 * beyond the format ceiling.
 *
 * Examples:
 *   Bo5, 0 games saved  → [1, 2, 3, 4, 5]  (show all rows, all empty)
 *   Bo5, games 1–2 saved, p1 leads 2–0  → [1, 2, 3]  (deciding game + 1 buffer)
 *   Bo5, games 1–3 saved, match complete → [1, 2, 3]  (no more rows)
 */
export function inferGameNumbersToShow(
  existingGames: Game[],
  format:        MatchFormat,
  player1Id:     string | null,
  player2Id:     string | null,
): number[] {
  const { maxGames } = FORMAT_CONFIGS[format]
  const state = computeMatchState(existingGames, format, player1Id, player2Id)

  if (state.outcome !== 'in_progress') {
    // Show only through the deciding game
    const upTo = state.decidingGame ?? existingGames.length
    return Array.from({ length: upTo }, (_, i) => i + 1)
  }

  // Show all saved games + one empty row for next entry
  const highestSaved = existingGames.length > 0
    ? Math.max(...existingGames.map(g => g.game_number))
    : 0
  const showThrough = Math.min(highestSaved + 1, maxGames)
  return Array.from({ length: showThrough }, (_, i) => i + 1)
}
