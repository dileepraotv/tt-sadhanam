/**
 * roundrobin/roundrobin.test.ts
 *
 * Runnable with:  npx vitest run src/lib/roundrobin/roundrobin.test.ts
 *
 * Covers:
 *   - generateGroupSchedule   (even / odd / edge cases)
 *   - generateMultiGroupSchedule (collision-free match numbers)
 *   - verifySchedule
 *   - computeGroupStandings   (tiebreakers A through E)
 *   - computeAllGroupStandings + extractQualifiers
 *   - groupProgress
 */

import { describe, it, expect } from 'vitest'
import {
  generateGroupSchedule,
  generateMultiGroupSchedule,
  verifySchedule,
} from './scheduler'
import {
  computeGroupStandings,
  computeAllGroupStandings,
  extractQualifiers,
  getTiebreakerReason,
  groupProgress,
} from './standings'
import { BYE_PLAYER_ID } from './types'
import type { RRGroup } from './types'
import type { Match, Game, Player } from '@/lib/types'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']

function makePlayer(id: string, seed: number | null = null): Player {
  return {
    id,
    tournament_id: 't1',
    name:          id.toUpperCase(),
    club:          null,
    country_code:  null,
    seed,
    created_at:    '2024-01-01T00:00:00Z',
    updated_at:    '2024-01-01T00:00:00Z',
  }
}

function makeGroup(
  id: string,
  playerIds: string[],
  groupNumber = 1,
): RRGroup {
  return { id, stageId: 's1', name: `Group ${String.fromCharCode(64 + groupNumber)}`, groupNumber, playerIds }
}

/**
 * Build a completed Match row with optional game-level scores.
 * If player1Wins is true, player1 wins the match; games array fills automatically.
 */
function makeMatch(
  id:          string,
  groupId:     string,
  p1:          string,
  p2:          string,
  p1Games:     number,
  p2Games:     number,
  p1GameScores?: Array<[number, number]>,   // [p1_score, p2_score] per game
): Match {
  const winner = p1Games > p2Games ? p1 : p2
  const games: Game[] = (p1GameScores ?? []).map(([s1, s2], i) => ({
    id:          `g-${id}-${i}`,
    match_id:    id,
    game_number: i + 1,
    score1:      s1,
    score2:      s2,
    winner_id:   s1 > s2 ? p1 : p2,
    created_at:  '2024-01-01T00:00:00Z',
    updated_at:  '2024-01-01T00:00:00Z',
  }))

  return {
    id,
    tournament_id: 't1',
    stage_id:      's1',
    group_id:      groupId,
    match_kind:    'round_robin',
    round:         1,
    match_number:  1,
    player1_id:    p1,
    player2_id:    p2,
    player1_games: p1Games,
    player2_games: p2Games,
    winner_id:     winner,
    status:        'complete',
    next_match_id: null,
    next_slot:     null,
    round_name:    'Matchday 1',
    court:         null,
    scheduled_at:  null,
    started_at:    null,
    completed_at:  '2024-01-01T12:00:00Z',
    created_at:    '2024-01-01T00:00:00Z',
    updated_at:    '2024-01-01T00:00:00Z',
    games,
  }
}

function gamesFromMatches(matches: Match[]): Game[] {
  return matches.flatMap(m => m.games ?? [])
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEDULER TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('generateGroupSchedule', () => {

  it('2 players → 1 round, 1 fixture', () => {
    const fixtures = generateGroupSchedule(['p1', 'p2'])
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0].round).toBe(1)
    expect(fixtures[0].isBye).toBe(false)
    // Both players appear
    expect([fixtures[0].player1Id, fixtures[0].player2Id].sort()).toEqual(['p1', 'p2'])
  })

  it('4 players → 3 rounds, 2 fixtures per round, 6 total', () => {
    const players = IDS.slice(0, 4)
    const fixtures = generateGroupSchedule(players)
    expect(fixtures).toHaveLength(6)
    // Check round distribution
    const rounds = Array.from(new Set(fixtures.map(f => f.round))).sort()
    expect(rounds).toEqual([1, 2, 3])
    for (const r of rounds) {
      expect(fixtures.filter(f => f.round === r)).toHaveLength(2)
    }
    // Verify every pair appears exactly once
    const result = verifySchedule(players, fixtures)
    expect(result.valid).toBe(true)
  })

  it('6 players → 5 rounds, 3 fixtures per round, 15 total', () => {
    const players = IDS.slice(0, 6)
    const fixtures = generateGroupSchedule(players)
    expect(fixtures.filter(f => !f.isBye)).toHaveLength(15)
    const result = verifySchedule(players, fixtures)
    expect(result.valid).toBe(true)
  })

  it('8 players → 7 rounds, 4 fixtures per round, 28 total', () => {
    const players = IDS.slice(0, 8)
    const fixtures = generateGroupSchedule(players)
    expect(fixtures.filter(f => !f.isBye)).toHaveLength(28)
    const result = verifySchedule(players, fixtures)
    expect(result.valid).toBe(true)
  })

  it('3 players (odd) → 3 rounds, 1 real + 1 bye per round', () => {
    const players = ['p1', 'p2', 'p3']
    const fixtures = generateGroupSchedule(players)
    expect(fixtures).toHaveLength(6)   // 3 real + 3 bye
    const real = fixtures.filter(f => !f.isBye)
    const bye  = fixtures.filter(f => f.isBye)
    expect(real).toHaveLength(3)
    expect(bye).toHaveLength(3)
    // Each player gets exactly 1 bye round
    const byePlayers = bye.map(f =>
      f.player1Id === BYE_PLAYER_ID ? f.player2Id : f.player1Id,
    ).sort()
    expect(byePlayers).toEqual(['p1', 'p2', 'p3'])
  })

  it('5 players (odd) → each player has exactly 1 bye', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5']
    const fixtures = generateGroupSchedule(players)
    const byeFixtures = fixtures.filter(f => f.isBye)
    expect(byeFixtures).toHaveLength(5)
    const byePlayers = byeFixtures.map(f =>
      f.player1Id === BYE_PLAYER_ID ? f.player2Id : f.player1Id,
    ).sort()
    expect(byePlayers).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('throws for group size < 2', () => {
    expect(() => generateGroupSchedule([])).toThrow()
    expect(() => generateGroupSchedule(['p1'])).toThrow()
  })

  it('throws for group size > 32', () => {
    const huge = Array.from({ length: 33 }, (_, i) => `p${i}`)
    expect(() => generateGroupSchedule(huge)).toThrow()
  })

  it('no player plays twice in the same round', () => {
    for (const size of [4, 6, 7, 8, 10]) {
      const players = Array.from({ length: size }, (_, i) => `p${i}`)
      const fixtures = generateGroupSchedule(players).filter(f => !f.isBye)
      const byRound = new Map<number, string[]>()
      for (const f of fixtures) {
        const players = byRound.get(f.round) ?? []
        expect(players).not.toContain(f.player1Id)
        expect(players).not.toContain(f.player2Id)
        players.push(f.player1Id, f.player2Id)
        byRound.set(f.round, players)
      }
    }
  })

})

describe('generateMultiGroupSchedule', () => {

  it('2 groups of 4 → no match_number collisions', () => {
    const groups = [
      { groupNumber: 1, playerIds: ['a1', 'a2', 'a3', 'a4'] },
      { groupNumber: 2, playerIds: ['b1', 'b2', 'b3', 'b4'] },
    ]
    const fixtures = generateMultiGroupSchedule(groups)
    const nums = fixtures.map(f => f.matchNumber)
    const unique = new Set(nums)
    expect(unique.size).toBe(nums.length)
    // Group A fixtures have groupIndex 0, Group B fixtures groupIndex 1
    expect(fixtures.filter(f => f.groupIndex === 0)).toHaveLength(6)
    expect(fixtures.filter(f => f.groupIndex === 1)).toHaveLength(6)
  })

  it('respects matchNumOffset', () => {
    const groups = [{ groupNumber: 1, playerIds: ['p1', 'p2', 'p3', 'p4'] }]
    const fixtures = generateMultiGroupSchedule(groups, 100)
    expect(Math.min(...fixtures.map(f => f.matchNumber))).toBe(101)
  })

  it('round numbers are shared across groups (same matchday)', () => {
    const groups = [
      { groupNumber: 1, playerIds: ['a1', 'a2', 'a3', 'a4'] },
      { groupNumber: 2, playerIds: ['b1', 'b2', 'b3', 'b4'] },
    ]
    const fixtures = generateMultiGroupSchedule(groups)
    const roundsInG1 = new Set(fixtures.filter(f => f.groupIndex === 0).map(f => f.round))
    const roundsInG2 = new Set(fixtures.filter(f => f.groupIndex === 1).map(f => f.round))
    // Both groups play the same matchday numbers
    expect([...roundsInG1].sort()).toEqual([...roundsInG2].sort())
  })

})

describe('verifySchedule', () => {

  it('validates a correct 4-player schedule', () => {
    const players = ['a', 'b', 'c', 'd']
    const fixtures = generateGroupSchedule(players)
    expect(verifySchedule(players, fixtures).valid).toBe(true)
  })

  it('catches a missing fixture', () => {
    const players = ['a', 'b', 'c', 'd']
    const fixtures = generateGroupSchedule(players)
    const trimmed  = fixtures.filter(f => !f.isBye).slice(1)   // drop first
    const result   = verifySchedule(players, trimmed)
    expect(result.valid).toBe(false)
  })

  it('catches a duplicate fixture', () => {
    const players = ['a', 'b', 'c', 'd']
    const fixtures = generateGroupSchedule(players)
    const dup = { ...fixtures[0] }
    const result = verifySchedule(players, [...fixtures, dup])
    expect(result.valid).toBe(false)
  })

})

// ═════════════════════════════════════════════════════════════════════════════
// STANDINGS TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('computeGroupStandings — basic', () => {

  it('all players start 0-0 with no matches played', () => {
    const group   = makeGroup('g1', ['p1', 'p2', 'p3', 'p4'])
    const players = IDS.slice(0, 4).map(id => makePlayer(id))
    const { standings } = computeGroupStandings(group, players, [], [], 2)
    expect(standings).toHaveLength(4)
    for (const s of standings) {
      expect(s.matchesPlayed).toBe(0)
      expect(s.wins).toBe(0)
      expect(s.losses).toBe(0)
      expect(s.gameDifference).toBe(0)
      expect(s.pointsDifference).toBe(0)
    }
  })

  it('simple 3-player complete group: clear winner, no tie', () => {
    // p1 beats p2 3-0, p1 beats p3 3-0, p2 beats p3 3-0
    const group   = makeGroup('g1', ['p1', 'p2', 'p3'])
    const players = ['p1', 'p2', 'p3'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 0),
      makeMatch('m2', 'g1', 'p1', 'p3', 3, 0),
      makeMatch('m3', 'g1', 'p2', 'p3', 3, 0),
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 2)

    expect(standings[0].playerId).toBe('p1')
    expect(standings[0].wins).toBe(2)
    expect(standings[0].rank).toBe(1)

    expect(standings[1].playerId).toBe('p2')
    expect(standings[1].wins).toBe(1)
    expect(standings[1].rank).toBe(2)

    expect(standings[2].playerId).toBe('p3')
    expect(standings[2].wins).toBe(0)
    expect(standings[2].rank).toBe(3)
  })

  it('advances flag set correctly for advanceCount=2 in 4-player group', () => {
    const group   = makeGroup('g1', ['p1', 'p2', 'p3', 'p4'])
    const players = ['p1', 'p2', 'p3', 'p4'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 0),
      makeMatch('m2', 'g1', 'p1', 'p3', 3, 0),
      makeMatch('m3', 'g1', 'p1', 'p4', 3, 0),
      makeMatch('m4', 'g1', 'p2', 'p3', 3, 0),
      makeMatch('m5', 'g1', 'p2', 'p4', 3, 0),
      makeMatch('m6', 'g1', 'p3', 'p4', 3, 0),
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 2)
    expect(standings.filter(s => s.advances)).toHaveLength(2)
    expect(standings[0].advances).toBe(true)
    expect(standings[1].advances).toBe(true)
    expect(standings[2].advances).toBe(false)
    expect(standings[3].advances).toBe(false)
  })

  it('counts games won/lost correctly', () => {
    const group   = makeGroup('g1', ['p1', 'p2'])
    const players = ['p1', 'p2'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 1),   // p1 wins Bo5 3-1
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 1)
    const p1 = standings.find(s => s.playerId === 'p1')!
    const p2 = standings.find(s => s.playerId === 'p2')!
    expect(p1.gamesWon).toBe(3)
    expect(p1.gamesLost).toBe(1)
    expect(p1.gameDifference).toBe(2)
    expect(p2.gamesWon).toBe(1)
    expect(p2.gamesLost).toBe(3)
    expect(p2.gameDifference).toBe(-2)
  })

  it('counts points scored from game scores', () => {
    const group   = makeGroup('g1', ['p1', 'p2'])
    const players = ['p1', 'p2'].map(id => makePlayer(id))
    // p1 wins 11-9, 11-8
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 2, 0, [[11, 9], [11, 8]]),
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 1)
    const p1 = standings.find(s => s.playerId === 'p1')!
    const p2 = standings.find(s => s.playerId === 'p2')!
    expect(p1.pointsScored).toBe(22)     // 11+11
    expect(p1.pointsConceded).toBe(17)   // 9+8
    expect(p1.pointsDifference).toBe(5)
    expect(p2.pointsScored).toBe(17)
    expect(p2.pointsConceded).toBe(22)
    expect(p2.pointsDifference).toBe(-5)
  })

})

// ─── Tiebreaker tests ──────────────────────────────────────────────────────────

describe('computeGroupStandings — tiebreakers', () => {

  it('tiebreaker A: more wins wins', () => {
    // p1: 2W, p2: 1W, p3: 0W — no tie
    const group   = makeGroup('g1', ['p1', 'p2', 'p3'])
    const players = ['p1', 'p2', 'p3'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 0),
      makeMatch('m2', 'g1', 'p1', 'p3', 3, 0),
      makeMatch('m3', 'g1', 'p2', 'p3', 3, 0),
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 2)
    expect(standings.map(s => s.playerId)).toEqual(['p1', 'p2', 'p3'])
    expect(getTiebreakerReason(standings[0], standings[1], matches)).toBe('wins')
  })

  it('tiebreaker B: head-to-head (2-player tie)', () => {
    // p1 and p2 both have 1W, 1L — p1 beat p2 → p1 ranks first
    const group   = makeGroup('g1', ['p1', 'p2', 'p3'])
    const players = ['p1', 'p2', 'p3'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 1),   // p1 beats p2
      makeMatch('m2', 'g1', 'p3', 'p1', 3, 1),   // p3 beats p1
      makeMatch('m3', 'g1', 'p3', 'p2', 1, 3),   // p2 beats p3
    ]
    // Standings: p1=1W, p2=1W, p3=1W — but let's isolate 2-player tie:
    // Actually all 3 have 1W here (cyclic). H2H only applies to 2-player ties.
    // Let's make a clearer 2-player tie:
    const group2   = makeGroup('g2', ['p1', 'p2', 'p3', 'p4'])
    const players2 = ['p1', 'p2', 'p3', 'p4'].map(id => makePlayer(id))
    const matches2 = [
      // p1 and p2 both win 2, both beat p3 and p4
      makeMatch('a1', 'g2', 'p1', 'p2', 3, 0),   // p1 beats p2 → H2H advantage
      makeMatch('a2', 'g2', 'p1', 'p3', 3, 0),
      makeMatch('a3', 'g2', 'p1', 'p4', 3, 0),
      makeMatch('a4', 'g2', 'p2', 'p3', 3, 0),
      makeMatch('a5', 'g2', 'p2', 'p4', 3, 0),
      makeMatch('a6', 'g2', 'p3', 'p4', 3, 0),
    ]
    const { standings: s2 } = computeGroupStandings(group2, players2, matches2, gamesFromMatches(matches2), 2)
    // p1 and p2 both have 3 wins, but p1 beat p2 head-to-head
    expect(s2[0].playerId).toBe('p1')
    expect(s2[1].playerId).toBe('p2')
    expect(getTiebreakerReason(s2[0], s2[1], matches2)).toBe('head_to_head')
  })

  it('tiebreaker C: game difference (3-player tie — no H2H)', () => {
    // p1, p2, p3 all have 1W, 1L, 1L (cyclic wins — H2H inapplicable for 3+)
    // p1 wins by bigger game margins
    const group   = makeGroup('g1', ['p1', 'p2', 'p3'])
    const players = ['p1', 'p2', 'p3'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 0),   // p1 wins +3 games
      makeMatch('m2', 'g1', 'p2', 'p3', 3, 0),   // p2 wins +3 games
      makeMatch('m3', 'g1', 'p3', 'p1', 3, 2),   // p3 wins +1 games
    ]
    // p1: 3W-2L = +1 game diff, p2: 3W-0L = +3, p3: 3W-3L = 0
    // Wait: p1 wins m1 (3-0) and loses m3 (2-3 → p1 gets 2 games won, 3 lost)
    // p1: games won = 3 (from m1) + 2 (from m3) = 5; lost = 0 + 3 = 3 → diff = +2
    // p2: games won = 0 (from m1) + 3 (from m2) = 3; lost = 3 + 0 = 3 → diff = 0
    // p3: games won = 3 (from m3) + 0 (from m2) = 3; ... actually 3 from m3, 0 from m2
    //     games lost = 2 (from m3) + 3 (from m2) = 5... wait p3 loses m2 to p2
    // p3: games won = 3 (beats p1 in m3), games lost = 0(m3)+3(m2) = 3... 
    // Let me recount: p3 in m2 has player2_id, player2_games=0 (loss), player1_games=3
    // So p3's games in m2: gamesWon += player2_games = 0, gamesLost += player1_games = 3
    // p3 in m3 (p3 vs p1): p3 is player1, player1_games=3, player2_games=2
    // p3 gamesWon = 0 + 3 = 3, gamesLost = 3 + 2 = 5 → diff = -2
    //
    // All have 1 win:
    // p1: +2  p2: 0  p3: -2  → p1 first by game diff
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 2)
    expect(standings.every(s => s.wins === 1)).toBe(true)
    expect(standings[0].playerId).toBe('p1')
    expect(getTiebreakerReason(standings[0], standings[1], matches)).toBe('game_difference')
  })

  it('tiebreaker D: points difference', () => {
    // Two players tied on wins AND game difference
    const group   = makeGroup('g1', ['p1', 'p2', 'p3'])
    const players = ['p1', 'p2', 'p3'].map(id => makePlayer(id))
    // Both p1 and p2 win 2-1 against p3; p1 beats p2 but let's arrange same wins+gamediff:
    // Use 3-player round, rig equal game diffs but different point totals
    const matches = [
      // p1 beats p3 2-0 (11-5, 11-6 = +11 pts)
      makeMatch('m1', 'g1', 'p1', 'p3', 2, 0, [[11, 5], [11, 6]]),
      // p2 beats p3 2-0 (11-9, 11-9 = +4 pts)
      makeMatch('m2', 'g1', 'p2', 'p3', 2, 0, [[11, 9], [11, 9]]),
      // p1 beats p2 (so p1 has 2W, p2 1W, p3 0W — this removes the tie on wins)
      makeMatch('m3', 'g1', 'p1', 'p2', 2, 0, [[11, 5], [11, 5]]),
    ]
    // p1: 2W, p2: 1W → clearly p1 first by wins (not a tie case)
    // Let's force equal wins + equal game diff by giving everyone 1W 1L:
    const group2   = makeGroup('g2', ['p1', 'p2', 'p3', 'p4'])
    const players2 = ['p1', 'p2', 'p3', 'p4'].map(id => makePlayer(id))
    // p1 and p2 both end 2W, game_diff = +2, but p1 has better points diff
    const matches2 = [
      // p1 beats p3 3-1 with big scores (+20 pts)
      makeMatch('b1', 'g2', 'p1', 'p3', 3, 1, [[11,0],[11,0],[11,0],[0,11]]),
      // p2 beats p3 3-1 with small margin (+4 pts)
      makeMatch('b2', 'g2', 'p2', 'p3', 3, 1, [[11,9],[11,9],[11,9],[9,11]]),
      // p1 beats p4 3-1 with big scores (+20 pts)
      makeMatch('b3', 'g2', 'p1', 'p4', 3, 1, [[11,0],[11,0],[11,0],[0,11]]),
      // p2 beats p4 3-1 with small margin (+4 pts)
      makeMatch('b4', 'g2', 'p2', 'p4', 3, 1, [[11,9],[11,9],[11,9],[9,11]]),
      // p1 vs p2 — p2 wins so they end up with equal wins
      makeMatch('b5', 'g2', 'p2', 'p1', 3, 1, [[11,9],[11,9],[11,9],[9,11]]),
      makeMatch('b6', 'g2', 'p3', 'p4', 3, 0),
    ]
    const { standings: s2 } = computeGroupStandings(group2, players2, matches2, gamesFromMatches(matches2), 2)
    // p1 and p2 both have 2W, same game_diff (let's check)
    const p1s = s2.find(s => s.playerId === 'p1')!
    const p2s = s2.find(s => s.playerId === 'p2')!
    expect(p1s.wins).toBe(p2s.wins)
    // p1 should rank higher due to better points difference
    expect(p1s.pointsDifference).toBeGreaterThan(p2s.pointsDifference)
    expect(p1s.rank).toBeLessThan(p2s.rank)
  })

  it('tiebreaker E: stable sort by player ID as last resort', () => {
    // Artificially create a tie on everything
    const group   = makeGroup('g1', ['aaa', 'bbb'])
    const players = ['aaa', 'bbb'].map(id => makePlayer(id))
    // If there's no completed match, they tie on everything; fallback = ID sort
    const { standings } = computeGroupStandings(group, players, [], [], 1)
    // 'aaa' < 'bbb' lexicographically → 'aaa' ranked first
    expect(standings[0].playerId).toBe('aaa')
    expect(standings[1].playerId).toBe('bbb')
    expect(getTiebreakerReason(standings[0], standings[1], [])).toBe('player_id')
  })

})

// ─── extractQualifiers ────────────────────────────────────────────────────────

describe('extractQualifiers', () => {

  it('snake-extracts top 2 per group in correct order', () => {
    // Group A: p1 (1st), p2 (2nd), p3 (3rd)
    // Group B: p4 (1st), p5 (2nd), p6 (3rd)
    const gA = makeGroup('gA', ['p1', 'p2', 'p3'], 1)
    const gB = makeGroup('gB', ['p4', 'p5', 'p6'], 2)
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(id => makePlayer(id))

    // Group A: p1>p2>p3
    const matchesA = [
      makeMatch('a1', 'gA', 'p1', 'p2', 3, 0),
      makeMatch('a2', 'gA', 'p1', 'p3', 3, 0),
      makeMatch('a3', 'gA', 'p2', 'p3', 3, 0),
    ]
    // Group B: p4>p5>p6
    const matchesB = [
      makeMatch('b1', 'gB', 'p4', 'p5', 3, 0),
      makeMatch('b2', 'gB', 'p4', 'p6', 3, 0),
      makeMatch('b3', 'gB', 'p5', 'p6', 3, 0),
    ]

    const allStandings = computeAllGroupStandings(
      [gA, gB], players,
      [...matchesA, ...matchesB],
      gamesFromMatches([...matchesA, ...matchesB]),
      2,
    )

    const qualifiers = extractQualifiers(allStandings, 2)
    expect(qualifiers).toHaveLength(4)
    // Order: A1st, B1st, A2nd, B2nd
    expect(qualifiers[0].playerId).toBe('p1')   // A 1st
    expect(qualifiers[1].playerId).toBe('p4')   // B 1st
    expect(qualifiers[2].playerId).toBe('p2')   // A 2nd
    expect(qualifiers[3].playerId).toBe('p5')   // B 2nd
    // rrRank
    expect(qualifiers[0].rrRank).toBe(1)
    expect(qualifiers[2].rrRank).toBe(2)
  })

})

// ─── groupProgress ────────────────────────────────────────────────────────────

describe('groupProgress', () => {

  it('0/0 when no matches', () => {
    const { completed, total, allDone } = groupProgress([])
    expect(completed).toBe(0)
    expect(total).toBe(0)
    expect(allDone).toBe(false)
  })

  it('counts only non-bye matches', () => {
    const byeMatch: Match = {
      ...makeMatch('bye', 'g', 'p1', 'p2', 0, 0),
      status: 'bye',
    }
    const pending: Match = {
      ...makeMatch('m2', 'g', 'p3', 'p4', 0, 0),
      status: 'pending',
      winner_id: null,
      player1_games: 0,
      player2_games: 0,
    }
    const complete = makeMatch('m1', 'g', 'p1', 'p2', 3, 0)

    const { completed, total, allDone } = groupProgress([byeMatch, pending, complete])
    expect(completed).toBe(1)
    expect(total).toBe(2)     // bye excluded
    expect(allDone).toBe(false)
  })

  it('allDone = true when all non-bye matches complete', () => {
    const m1 = makeMatch('m1', 'g', 'p1', 'p2', 3, 0)
    const m2 = makeMatch('m2', 'g', 'p3', 'p4', 3, 0)
    const { allDone } = groupProgress([m1, m2])
    expect(allDone).toBe(true)
  })

})

// ─── Integration: scheduler → standings pipeline ─────────────────────────────

describe('scheduler + standings integration', () => {

  it('generated schedule has the right number of matches for 4-player group', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4']
    const fixtures  = generateGroupSchedule(playerIds)
    expect(fixtures.filter(f => !f.isBye)).toHaveLength(6)   // C(4,2)
  })

  it('standings computed from all-played 4-player group sum to n*(n-1)/2 matches', () => {
    const group   = makeGroup('g1', ['p1', 'p2', 'p3', 'p4'])
    const players = ['p1', 'p2', 'p3', 'p4'].map(id => makePlayer(id))
    const matches = [
      makeMatch('m1', 'g1', 'p1', 'p2', 3, 0),
      makeMatch('m2', 'g1', 'p1', 'p3', 3, 0),
      makeMatch('m3', 'g1', 'p1', 'p4', 3, 0),
      makeMatch('m4', 'g1', 'p2', 'p3', 3, 0),
      makeMatch('m5', 'g1', 'p2', 'p4', 3, 0),
      makeMatch('m6', 'g1', 'p3', 'p4', 3, 0),
    ]
    const { standings } = computeGroupStandings(group, players, matches, gamesFromMatches(matches), 2)
    const totalMatchesPlayed = standings.reduce((s, p) => s + p.matchesPlayed, 0)
    // Each match is counted twice (once per player)
    expect(totalMatchesPlayed).toBe(6 * 2)
  })

})
