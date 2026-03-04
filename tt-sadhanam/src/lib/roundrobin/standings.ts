/**
 * roundrobin/standings.ts
 *
 * Pure standings computation from existing Match + Game rows.
 * No database access — takes the data already fetched and returns
 * a sorted, ranked PlayerStanding[] for each group.
 *
 * ── DATA CONTRACT ────────────────────────────────────────────────────────────
 *
 * Input matches:   All matches for the group with status='complete' (or 'live'
 *                  for provisional display). Joined with player1/player2 objects
 *                  exactly as fetchPublicMatches returns them.
 * Input games:     All games for those matches (score1, score2, winner_id).
 * Input playerIds: The group's canonical player list (from rr_group_members),
 *                  used to include players who haven't played yet (0–0–0).
 *
 * ── RANKING ALGORITHM ────────────────────────────────────────────────────────
 *
 * Primary:  match wins (descending)
 * Tiebreak 1 (2-player tie only): head-to-head result
 * Tiebreak 2: game difference  (games won − games lost, descending)
 * Tiebreak 3: points difference (total pts scored − conceded, descending)
 * Tiebreak 4: stable fallback by player UUID (ascending) — deterministic
 *
 * The 2-player-only head-to-head rule follows ITTF team competition practice.
 * For 3+ tied players, head-to-head mini-tables become circular and ambiguous,
 * so we fall directly to game difference.
 *
 * ── INTEGRATION WITH EXISTING SCORING ────────────────────────────────────────
 *
 * • Uses the same Game and Match types as the knockout scoring engine.
 * • Does NOT call computeMatchState() — standings only need win/loss counts
 *   and aggregate scores, not per-match state machines.
 * • The existing saveGameScore() already writes to games + matches correctly;
 *   standings are derived by re-reading those rows.
 */

import type { Match, Game, Player } from '@/lib/types'
import type { PlayerStanding, GroupStandings, RRGroup, TiebreakerReason } from './types'

// ── Internal accumulator ──────────────────────────────────────────────────────

interface PlayerAccumulator {
  playerId:         string
  playerName:       string
  playerSeed:       number | null
  playerClub:       string | null
  matchesPlayed:    number
  wins:             number
  losses:           number
  gamesWon:         number
  gamesLost:        number
  pointsScored:     number
  pointsConceded:   number
}

function emptyAccumulator(player: {
  id: string; name: string; seed: number | null; club: string | null
}): PlayerAccumulator {
  return {
    playerId:        player.id,
    playerName:      player.name,
    playerSeed:      player.seed,
    playerClub:      player.club,
    matchesPlayed:   0,
    wins:            0,
    losses:          0,
    gamesWon:        0,
    gamesLost:       0,
    pointsScored:    0,
    pointsConceded:  0,
  }
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute standings for a single group.
 *
 * @param group       The group descriptor (id, name, playerIds, etc.)
 * @param players     All Player objects for the tournament (we look up by ID).
 * @param matches     All matches in this group (filter by group_id before calling).
 *                    Expects { player1_id, player2_id, winner_id, player1_games,
 *                    player2_games, status } — same shape as the existing Match type.
 * @param games       All game rows for the above matches.
 * @param advanceCount How many players qualify for the next stage.
 */
export function computeGroupStandings(
  group:        RRGroup,
  players:      Player[],
  matches:      Match[],
  games:        Game[],
  advanceCount: number,
): GroupStandings {
  // Build player map for fast lookup
  const playerMap = new Map<string, Player>()
  for (const p of players) {
    if (group.playerIds.includes(p.id)) {
      playerMap.set(p.id, p)
    }
  }

  // Initialise an accumulator for every player in the group (including
  // those who have not yet played any matches — they show 0/0/0).
  const acc = new Map<string, PlayerAccumulator>()
  for (const pid of group.playerIds) {
    const p = playerMap.get(pid)
    if (!p) continue
    acc.set(pid, emptyAccumulator({ id: p.id, name: p.name, seed: p.seed, club: p.club }))
  }

  // Build games-by-match lookup
  const gamesByMatch = new Map<string, Game[]>()
  for (const g of games) {
    if (!gamesByMatch.has(g.match_id)) gamesByMatch.set(g.match_id, [])
    gamesByMatch.get(g.match_id)!.push(g)
  }

  // Walk completed matches and accumulate stats
  const completedMatches = matches.filter(
    m => m.status === 'complete' && m.player1_id && m.player2_id,
  )

  for (const m of completedMatches) {
    const p1 = acc.get(m.player1_id!)
    const p2 = acc.get(m.player2_id!)
    if (!p1 || !p2) continue   // player not in this group — skip

    p1.matchesPlayed++
    p2.matchesPlayed++

    // Match winner
    if (m.winner_id === m.player1_id) {
      p1.wins++
      p2.losses++
    } else if (m.winner_id === m.player2_id) {
      p2.wins++
      p1.losses++
    }
    // No winner (shouldn't happen for 'complete', but guards against bad data)

    // Game counts (stored directly on the match row, same as knockout)
    p1.gamesWon   += m.player1_games
    p1.gamesLost  += m.player2_games
    p2.gamesWon   += m.player2_games
    p2.gamesLost  += m.player1_games

    // Point counts — derived from actual game scores
    const matchGames = gamesByMatch.get(m.id) ?? []
    for (const g of matchGames) {
      const s1 = g.score1 ?? 0
      const s2 = g.score2 ?? 0
      p1.pointsScored    += s1
      p1.pointsConceded  += s2
      p2.pointsScored    += s2
      p2.pointsConceded  += s1
    }
  }

  // Convert accumulators to standings, then sort + rank
  const unsorted: PlayerStanding[] = [...acc.values()].map(a => ({
    ...a,
    gameDifference:    a.gamesWon  - a.gamesLost,
    pointsDifference:  a.pointsScored - a.pointsConceded,
    rank:              0,      // set after sort
    advances:          false,  // set after sort
  }))

  const sorted = sortStandings(unsorted, completedMatches)

  // Assign rank and advances flag
  const standings: PlayerStanding[] = sorted.map((s, i) => ({
    ...s,
    rank:     i + 1,
    advances: i < advanceCount,
  }))

  return { group, standings }
}

/**
 * Compute standings for multiple groups at once.
 * Convenience wrapper that calls computeGroupStandings per group.
 */
export function computeAllGroupStandings(
  groups:       RRGroup[],
  players:      Player[],
  matches:      Match[],
  games:        Game[],
  advanceCount: number,
): GroupStandings[] {
  return groups.map(group => {
    const groupMatches = matches.filter(m => m.group_id === group.id)
    const groupMatchIds = new Set(groupMatches.map(m => m.id))
    const groupGames   = games.filter(g => groupMatchIds.has(g.match_id))
    return computeGroupStandings(group, players, groupMatches, groupGames, advanceCount)
  })
}

// ── Sorting + tiebreaking ─────────────────────────────────────────────────────

/**
 * Sort a flat list of PlayerStanding by the ITTF-style tiebreaker chain.
 * Returns a new array (does not mutate input).
 *
 * Algorithm:
 *   1. Sort all players by wins DESC
 *   2. Within each tied group:
 *      a. If exactly 2 tied → apply head-to-head
 *      b. All tied groups → apply game difference
 *      c. Still tied → apply points difference
 *      d. Still tied → stable sort by player ID (deterministic)
 */
function sortStandings(
  standings:         PlayerStanding[],
  completedMatches:  Match[],
): PlayerStanding[] {
  // Step 1 — primary sort by wins
  const sorted = [...standings].sort((a, b) => b.wins - a.wins)

  // Step 2 — identify groups of players with equal wins and apply tiebreakers
  // We rebuild the array segment by segment.
  const result: PlayerStanding[] = []
  let i = 0

  while (i < sorted.length) {
    // Find end of this tied group
    let j = i + 1
    while (j < sorted.length && sorted[j].wins === sorted[i].wins) j++

    const tiedGroup = sorted.slice(i, j)

    if (tiedGroup.length === 1) {
      // No tie — append as-is
      result.push(tiedGroup[0])
    } else {
      // Break the tie within this group
      const resolved = resolveTiedGroup(tiedGroup, completedMatches)
      result.push(...resolved)
    }

    i = j
  }

  return result
}

/**
 * Apply tiebreakers to a group of players with equal win counts.
 * Returns a fully ordered sub-array.
 *
 * Standard table tennis tiebreaker order (per ITTF individual rules):
 *   1. Head-to-head result (2-player ties only)
 *   2. Games won (most wins first), then games lost (fewest losses first)
 *   3. Points scored (most first), then points conceded (fewest first)
 *   4. Stable fallback by player UUID (deterministic)
 */
function resolveTiedGroup(
  group:            PlayerStanding[],
  completedMatches: Match[],
): PlayerStanding[] {
  if (group.length === 2) {
    // Apply head-to-head only for exactly 2 tied players
    const h2h = headToHeadWinner(group[0].playerId, group[1].playerId, completedMatches)
    if (h2h === group[0].playerId) return [group[0], group[1]]
    if (h2h === group[1].playerId) return [group[1], group[0]]
    // H2H inconclusive → fall through
  }

  return [...group].sort((a, b) => {
    // TT rule 1: games won descending
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon

    // TT rule 2: games lost ascending (fewer lost = better)
    if (a.gamesLost !== b.gamesLost) return a.gamesLost - b.gamesLost

    // TT rule 3: points scored descending
    if (b.pointsScored !== a.pointsScored) return b.pointsScored - a.pointsScored

    // TT rule 4: points conceded ascending (fewer conceded = better)
    if (a.pointsConceded !== b.pointsConceded) return a.pointsConceded - b.pointsConceded

    // Stable fallback: lexicographic by player UUID (deterministic)
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
  })
}

/**
 * Determine the head-to-head winner between two players.
 * Returns the winner's playerId, or null if no completed H2H match exists
 * (e.g. the match hasn't been played yet, or ended in an unexpected state).
 */
function headToHeadWinner(
  playerAId:        string,
  playerBId:        string,
  completedMatches: Match[],
): string | null {
  const h2h = completedMatches.find(
    m =>
      m.status === 'complete' &&
      ((m.player1_id === playerAId && m.player2_id === playerBId) ||
       (m.player1_id === playerBId && m.player2_id === playerAId)),
  )

  return h2h?.winner_id ?? null
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/**
 * From a list of group standings, extract the players who advance to the
 * knockout stage, ordered by seeding for the KO bracket generator.
 *
 * Seeding order follows the "snaking across groups" convention:
 *   Group A 1st, Group B 1st, Group C 1st, … (all group winners first)
 *   Group A 2nd, Group B 2nd, … (all runners-up next)
 *   etc.
 *
 * This ensures group winners and runners-up cannot meet until the
 * appropriate knockout round.
 */
export function extractQualifiers(
  groupStandings: GroupStandings[],
  advanceCount:   number,
): Array<{ playerId: string; name: string; seed: number | null; club: string | null; rrRank: number; groupName: string }> {
  const qualifiers: Array<{
    playerId: string; name: string; seed: number | null; club: string | null;
    rrRank: number; groupName: string
  }> = []

  for (let rank = 1; rank <= advanceCount; rank++) {
    for (const { group, standings } of groupStandings) {
      const player = standings.find(s => s.rank === rank)
      if (!player) continue
      qualifiers.push({
        playerId:  player.playerId,
        name:      player.playerName,
        seed:      player.playerSeed,
        club:      player.playerClub,
        rrRank:    rank,
        groupName: group.name,
      })
    }
  }

  return qualifiers
}

/**
 * Return a human-readable explanation of why two players are ordered as they
 * are in the standings (useful for UI tooltips).
 */
export function getTiebreakerReason(
  higher:           PlayerStanding,
  lower:            PlayerStanding,
  completedMatches: Match[],
): TiebreakerReason {
  if (higher.wins !== lower.wins) return 'wins'

  // Check H2H (only meaningful to report if wins are tied)
  const h2h = headToHeadWinner(higher.playerId, lower.playerId, completedMatches)
  if (h2h === higher.playerId) return 'head_to_head'

  if (higher.gamesWon !== lower.gamesWon) return 'game_difference'
  if (higher.gamesLost !== lower.gamesLost) return 'game_difference'
  if (higher.pointsScored !== lower.pointsScored) return 'points_difference'
  if (higher.pointsConceded !== lower.pointsConceded) return 'points_difference'
  return 'player_id'
}

/**
 * Progress summary for a group: how many matches are done vs total.
 * Useful for the "Group A — 3/6 matches complete" label.
 */
export function groupProgress(matches: Match[]): { completed: number; total: number; allDone: boolean } {
  const realMatches = matches.filter(m => m.status !== 'bye')
  const completed   = realMatches.filter(m => m.status === 'complete').length
  return {
    completed,
    total:   realMatches.length,
    allDone: completed > 0 && completed === realMatches.length,
  }
}
