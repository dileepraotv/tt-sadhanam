/**
 * scoring/engine.test.ts
 *
 * Runnable with:  npx vitest run src/lib/scoring/engine.test.ts
 * Or:             npx jest src/lib/scoring/engine.test.ts
 *
 * Covers every table-tennis rule the engine enforces:
 *   - validateGameScore  (30 cases)
 *   - computeMatchState  (10 cases)
 *   - canAddAnotherGame  (8 cases)
 */

import { describe, it, expect } from 'vitest'
import {
  validateGameScore,
  computeMatchState,
  canAddAnotherGame,
  inferGameNumbersToShow,
  formatValidationErrors,
  errorsForField,
} from './engine'
import type { Game } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const P1 = 'player-1-uuid'
const P2 = 'player-2-uuid'

/** Build a minimal Game row for testing. winner_id derived from scores. */
function makeGame(
  gameNumber: number,
  score1:     number,
  score2:     number,
): Game {
  return {
    id:         `game-${gameNumber}`,
    match_id:   'match-uuid',
    game_number: gameNumber,
    score1,
    score2,
    winner_id:  score1 > score2 ? P1 : P2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateGameScore
// ─────────────────────────────────────────────────────────────────────────────

describe('validateGameScore — valid scores', () => {
  it('11–0 (shutout) is valid', () => {
    expect(validateGameScore({ score1: 11, score2: 0 }).ok).toBe(true)
  })

  it('11–9 (normal win) is valid', () => {
    expect(validateGameScore({ score1: 11, score2: 9 }).ok).toBe(true)
  })

  it('12–10 (first deuce win) is valid', () => {
    expect(validateGameScore({ score1: 12, score2: 10 }).ok).toBe(true)
  })

  it('14–12 (extended deuce) is valid', () => {
    expect(validateGameScore({ score1: 14, score2: 12 }).ok).toBe(true)
  })

  it('25–23 (long deuce rally) is valid', () => {
    expect(validateGameScore({ score1: 25, score2: 23 }).ok).toBe(true)
  })

  it('0–11 (player 2 wins) is valid', () => {
    expect(validateGameScore({ score1: 0, score2: 11 }).ok).toBe(true)
  })

  it('10–12 (player 2 wins in deuce) is valid', () => {
    expect(validateGameScore({ score1: 10, score2: 12 }).ok).toBe(true)
  })
})

describe('validateGameScore — invalid: score basics', () => {
  it('rejects negative score1', () => {
    const r = validateGameScore({ score1: -1, score2: 11 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_NEGATIVE')
  })

  it('rejects negative score2', () => {
    const r = validateGameScore({ score1: 11, score2: -3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_NEGATIVE')
  })

  it('rejects non-integer score', () => {
    const r = validateGameScore({ score1: 11.5, score2: 9 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_NOT_INTEGER')
  })

  it('rejects NaN', () => {
    const r = validateGameScore({ score1: NaN, score2: 11 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_NOT_INTEGER')
  })

  it('rejects 0–0', () => {
    const r = validateGameScore({ score1: 0, score2: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_BOTH_ZERO')
  })
})

describe('validateGameScore — invalid: ties', () => {
  it('rejects 5–5 (tie below 10)', () => {
    const r = validateGameScore({ score1: 5, score2: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('SCORE_TIE_NOT_DEUCE')
  })

  it('rejects 10–10 (game still in progress at deuce)', () => {
    const r = validateGameScore({ score1: 10, score2: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('GAME_WINNER_UNCLEAR')
  })

  it('rejects 15–15 (ongoing deuce)', () => {
    const r = validateGameScore({ score1: 15, score2: 15 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('GAME_WINNER_UNCLEAR')
  })
})

describe('validateGameScore — invalid: win conditions', () => {
  it('rejects 9–7 (winner below 11)', () => {
    const r = validateGameScore({ score1: 9, score2: 7 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.errors.map(e => e.code)
      expect(codes).toContain('WINNER_BELOW_MINIMUM')
    }
  })

  it('rejects 11–10 (win by 1, no 2-point lead)', () => {
    const r = validateGameScore({ score1: 11, score2: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('LEAD_TOO_SMALL')
  })

  it('rejects 10–11 (win by 1 in reverse)', () => {
    const r = validateGameScore({ score1: 10, score2: 11 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe('LEAD_TOO_SMALL')
  })

  it('rejects 13–10 (deuce territory but margin of 3)', () => {
    const r = validateGameScore({ score1: 13, score2: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.errors.map(e => e.code)
      expect(codes).toContain('DEUCE_NOT_WIN_BY_TWO')
    }
  })

  it('rejects 15–11 (large deuce margin)', () => {
    const r = validateGameScore({ score1: 15, score2: 11 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.errors.map(e => e.code)
      expect(codes).toContain('DEUCE_NOT_WIN_BY_TWO')
    }
  })
})

describe('validateGameScore — field attribution', () => {
  it('attributes 9–7 error to the winner (score1)', () => {
    const r = validateGameScore({ score1: 9, score2: 7 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const winnerError = r.errors.find(e => e.code === 'WINNER_BELOW_MINIMUM')
      expect(winnerError?.field).toBe('score1')
    }
  })

  it('attributes 7–9 error to the winner (score2)', () => {
    const r = validateGameScore({ score1: 7, score2: 9 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const winnerError = r.errors.find(e => e.code === 'WINNER_BELOW_MINIMUM')
      expect(winnerError?.field).toBe('score2')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeMatchState
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMatchState — Bo5', () => {
  it('0 games → in_progress, 0–0', () => {
    const s = computeMatchState([], 'bo5', P1, P2)
    expect(s.outcome).toBe('in_progress')
    expect(s.player1Games).toBe(0)
    expect(s.player2Games).toBe(0)
    expect(s.gamesRemaining).toBe(5)
  })

  it('player1 wins 3–0 after 3 games', () => {
    const games = [
      makeGame(1, 11, 5),
      makeGame(2, 11, 7),
      makeGame(3, 11, 9),
    ]
    const s = computeMatchState(games, 'bo5', P1, P2)
    expect(s.outcome).toBe('player1_wins')
    expect(s.player1Games).toBe(3)
    expect(s.player2Games).toBe(0)
    expect(s.decidingGame).toBe(3)
    expect(s.gamesRemaining).toBe(0)
  })

  it('player2 wins 3–2 after 5 games', () => {
    const games = [
      makeGame(1, 11, 5),   // p1
      makeGame(2, 5, 11),   // p2
      makeGame(3, 11, 9),   // p1
      makeGame(4, 7, 11),   // p2
      makeGame(5, 9, 11),   // p2
    ]
    const s = computeMatchState(games, 'bo5', P1, P2)
    expect(s.outcome).toBe('player2_wins')
    expect(s.player1Games).toBe(2)
    expect(s.player2Games).toBe(3)
    expect(s.decidingGame).toBe(5)
  })

  it('1–1 after 2 games → in_progress with 3 remaining', () => {
    const games = [makeGame(1, 11, 5), makeGame(2, 5, 11)]
    const s = computeMatchState(games, 'bo5', P1, P2)
    expect(s.outcome).toBe('in_progress')
    expect(s.gamesRemaining).toBe(3)
  })

  it('games out of insertion order are still computed correctly', () => {
    const games = [
      makeGame(3, 11, 7),   // inserted out of order
      makeGame(1, 11, 5),
      makeGame(2, 11, 3),
    ]
    const s = computeMatchState(games, 'bo5', P1, P2)
    expect(s.outcome).toBe('player1_wins')
    expect(s.player1Games).toBe(3)
    expect(s.decidingGame).toBe(3)
  })
})

describe('computeMatchState — Bo3', () => {
  it('player wins 2–0 → complete after 2 games', () => {
    const games = [makeGame(1, 11, 4), makeGame(2, 11, 6)]
    const s = computeMatchState(games, 'bo3', P1, P2)
    expect(s.outcome).toBe('player1_wins')
    expect(s.decidingGame).toBe(2)
    expect(s.gamesRemaining).toBe(0)
  })
})

describe('computeMatchState — Bo7', () => {
  it('first to 4 wins', () => {
    const games = [
      makeGame(1, 11, 5), makeGame(2, 11, 5),
      makeGame(3, 11, 5), makeGame(4, 11, 5),
    ]
    const s = computeMatchState(games, 'bo7', P1, P2)
    expect(s.outcome).toBe('player1_wins')
    expect(s.player1Games).toBe(4)
    expect(s.decidingGame).toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// canAddAnotherGame
// ─────────────────────────────────────────────────────────────────────────────

describe('canAddAnotherGame', () => {
  it('allows game 1 when no games saved', () => {
    const r = canAddAnotherGame([], 'bo5', P1, P2, 1)
    expect(r.allowed).toBe(true)
    expect(r.nextGameNumber).toBe(1)
  })

  it('allows game 3 in a 2–0 match (not yet decided)', () => {
    const games = [makeGame(1, 11, 5), makeGame(2, 5, 11)]
    const r = canAddAnotherGame(games, 'bo5', P1, P2, 3)
    expect(r.allowed).toBe(true)
  })

  it('blocks game entry when match is complete', () => {
    const games = [
      makeGame(1, 11, 5), makeGame(2, 11, 5), makeGame(3, 11, 5),
    ]
    const r = canAddAnotherGame(games, 'bo5', P1, P2, 4)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/already complete/i)
  })

  it('blocks game 4 in Bo3 (max 3)', () => {
    const r = canAddAnotherGame([], 'bo3', P1, P2, 4)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/exceeds the maximum/i)
  })

  it('blocks when player slot is null', () => {
    const r = canAddAnotherGame([], 'bo5', P1, null, 1)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/player slots/i)
  })

  it('nextGameNumber is max(saved)+1', () => {
    const games = [makeGame(1, 11, 5), makeGame(2, 11, 5)]
    const r = canAddAnotherGame(games, 'bo5', P1, P2, 3)
    expect(r.nextGameNumber).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inferGameNumbersToShow
// ─────────────────────────────────────────────────────────────────────────────

describe('inferGameNumbersToShow', () => {
  it('Bo5, no games → shows [1, 2, 3, 4, 5]... wait, only next row', () => {
    const rows = inferGameNumbersToShow([], 'bo5', P1, P2)
    // 0 saved → shows game 1 only
    expect(rows).toEqual([1])
  })

  it('Bo5, game 1 saved → shows [1, 2]', () => {
    const rows = inferGameNumbersToShow([makeGame(1, 11, 5)], 'bo5', P1, P2)
    expect(rows).toEqual([1, 2])
  })

  it('complete match (3–0 in Bo5) → shows only [1, 2, 3]', () => {
    const games = [makeGame(1, 11, 5), makeGame(2, 11, 5), makeGame(3, 11, 5)]
    const rows = inferGameNumbersToShow(games, 'bo5', P1, P2)
    expect(rows).toEqual([1, 2, 3])
  })

  it('never exceeds maxGames', () => {
    const games = [
      makeGame(1, 11, 5), makeGame(2, 5, 11),
      makeGame(3, 11, 5), makeGame(4, 5, 11),
    ]
    const rows = inferGameNumbersToShow(games, 'bo5', P1, P2)
    expect(rows.every(n => n <= 5)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatValidationErrors / errorsForField
// ─────────────────────────────────────────────────────────────────────────────

describe('helper utilities', () => {
  it('formatValidationErrors returns empty string for ok result', () => {
    expect(formatValidationErrors({ ok: true })).toBe('')
  })

  it('formatValidationErrors joins messages', () => {
    const r = validateGameScore({ score1: 9, score2: 7 })
    const msg = formatValidationErrors(r)
    expect(msg.length).toBeGreaterThan(0)
  })

  it('errorsForField filters to specific field', () => {
    const r = validateGameScore({ score1: -1, score2: 11 })
    const errs = errorsForField(r, 'score1')
    expect(errs.length).toBeGreaterThan(0)
  })

  it('errorsForField returns empty array on valid input', () => {
    const r = validateGameScore({ score1: 11, score2: 9 })
    expect(errorsForField(r, 'score1')).toHaveLength(0)
  })
})
