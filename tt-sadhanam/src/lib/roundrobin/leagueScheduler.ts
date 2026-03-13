/**
 * roundrobin/leagueScheduler.ts
 *
 * Pure Round Robin league schedule generator.
 *
 * Differences from the existing roundrobin/scheduler.ts (which targets
 * GROUP-stage round robins with multiple groups):
 *
 *   • All players go into a SINGLE pool — no group split.
 *   • Output matches are tagged match_kind = 'round_robin' (reuses existing
 *     scoring infrastructure unchanged).
 *   • Returns flat match list with globalMatchNumber for direct DB insert.
 *
 * For N players:
 *   matches = N*(N-1)/2   (e.g. 16 players → 120 matches)
 *   rounds  = N-1 if N even, N if N odd
 *
 * Odd N: one BYE per round (virtual player). BYE fixtures are included
 * with isBye=true so the admin can see the schedule clearly.
 *
 * This module ONLY generates the fixture list. DB insertion is done in
 * lib/actions/pureRoundRobin.ts.
 */

import { generateGroupSchedule } from './scheduler'
import type { RRFixture } from './types'

export interface LeagueFixture extends RRFixture {
  matchNumber: number   // 1-based global match number for DB UNIQUE constraint
}

/**
 * Generate a complete single-pool round-robin schedule.
 *
 * @param playerIds  Array of player UUIDs. Length 2–256.
 *                   All players play each other exactly once.
 *                   Odd arrays receive a bye each round.
 *
 * @returns          Flat array of LeagueFixture, sorted by round then
 *                   match_number. BYE fixtures included (isBye=true).
 *
 * @example
 *   // 4 players → 6 matches, 3 rounds
 *   const fixtures = generateLeagueSchedule(['p1','p2','p3','p4'])
 *   // Round 1: p1 vs p4, p2 vs p3
 *   // Round 2: p1 vs p3, p4 vs p2
 *   // Round 3: p1 vs p2, p3 vs p4
 */
export function generateLeagueSchedule(playerIds: string[]): LeagueFixture[] {
  if (playerIds.length < 2) {
    throw new Error(`Pure round robin requires at least 2 players. Got ${playerIds.length}.`)
  }
  if (playerIds.length > 256) {
    throw new Error(`Pure round robin supports up to 256 players. Got ${playerIds.length}.`)
  }

  const fixtures = generateGroupSchedule(playerIds)

  // Assign sequential match numbers across the whole league
  // (sorted by round ascending so match_number is predictable)
  return fixtures
    .sort((a, b) => a.round - b.round)
    .map((f, i) => ({ ...f, matchNumber: i + 1 }))
}

/**
 * Count total real (non-BYE) matches for N players.
 * Useful for UI preview before generating.
 */
export function leagueMatchCount(playerCount: number): number {
  return (playerCount * (playerCount - 1)) / 2
}

/**
 * Count rounds for N players.
 */
export function leagueRoundCount(playerCount: number): number {
  return playerCount % 2 === 0 ? playerCount - 1 : playerCount
}
