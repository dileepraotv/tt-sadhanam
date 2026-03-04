'use server'

/**
 * actions/qualifiers.ts
 *
 * Computes which players advance from Stage 1 (round robin) to Stage 2 (knockout).
 *
 * ── QUALIFICATION RULES ───────────────────────────────────────────────────────
 *
 * PRIMARY: Top N per group
 *   The top `advanceCount` players from each group qualify directly.
 *   Tiebreakers (applied within each group by standings.ts):
 *     1. Match wins
 *     2. Head-to-head (only when exactly 2 tied)
 *     3. Game difference
 *     4. Points difference
 *     5. Stable sort by player UUID
 *
 * OPTIONAL: Best third-placed (UEFA-style)
 *   When `allowBestThird = true`, the best `bestThirdCount` players ranked
 *   3rd across all groups also qualify.
 *   Cross-group comparison uses: wins → game_diff → points_diff → player_id.
 *   (No H2H across groups — they haven't played each other.)
 *
 * ── KO SEED ASSIGNMENT ────────────────────────────────────────────────────────
 *
 * Qualifiers are ordered for knockout seeding using snake-across-groups:
 *   KO Seed 1 = Group A winner
 *   KO Seed 2 = Group B winner
 *   KO Seed 3 = Group C winner  …
 *   KO Seed (G+1) = Group A runner-up
 *   KO Seed (G+2) = Group B runner-up  …
 *   Best-thirds appended at the end (lowest seeds).
 *
 * This maximises the chance that same-group players are on opposite halves
 * of the bracket (handled further by knockout.ts swap pass).
 */

import { createClient }   from '@/lib/supabase/server'
import type { Match, Game, Player, Qualifier, RRStageConfig } from '@/lib/types'
import {
  computeAllGroupStandings,
} from '@/lib/roundrobin/standings'
import type { RRGroup, PlayerStanding, GroupStandings } from '@/lib/roundrobin/types'

// ─────────────────────────────────────────────────────────────────────────────
// computeQualifiers
// Main entry point. Loads all data from DB and returns the ordered qualifier list.
// ─────────────────────────────────────────────────────────────────────────────
export async function computeQualifiers(
  tournamentId: string,
  rrStageId:    string,
): Promise<{ error?: string; qualifiers?: Qualifier[] }> {
  const supabase = createClient()

  // Load stage config
  const { data: stage } = await supabase
    .from('stages')
    .select('config')
    .eq('id', rrStageId)
    .single()

  if (!stage) return { error: 'Stage not found' }
  const cfg = stage.config as RRStageConfig

  // Load groups + members
  const { data: groupRows } = await supabase
    .from('rr_groups')
    .select('id, stage_id, name, group_number, rr_group_members(player_id)')
    .eq('stage_id', rrStageId)
    .order('group_number')

  if (!groupRows?.length) return { error: 'No groups found' }

  const groups: RRGroup[] = groupRows.map(g => ({
    id:          g.id,
    stageId:     g.stage_id,
    name:        g.name,
    groupNumber: g.group_number,
    playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
  }))

  // Load players
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)

  // Load RR matches + games
  const { data: matches } = await supabase
    .from('matches')
    .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed,club), games(id,game_number,score1,score2,winner_id,created_at,updated_at)')
    .eq('tournament_id', tournamentId)
    .eq('stage_id', rrStageId)

  const matchList = (matches ?? []) as unknown as Match[]
  const allGames  = matchList.flatMap(m => m.games ?? [])

  // Compute per-group standings
  const groupStandings = computeAllGroupStandings(
    groups,
    (players ?? []) as unknown as Player[],
    matchList,
    allGames,
    cfg.advanceCount,
  )

  // Build qualifier list
  const qualifiers = await buildQualifiers(groupStandings, cfg)

  return { qualifiers }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildQualifiers (pure — no DB)
// Exported for use in knockout.ts and unit tests.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildQualifiers(
  groupStandings: GroupStandings[],
  cfg:            RRStageConfig,
): Promise<Qualifier[]> {
  const { advanceCount, allowBestThird, bestThirdCount } = cfg
  const G = groupStandings.length

  // ── Step 1: Top N per group (snake order) ──────────────────────────────────
  // Order: rank 1 across all groups, then rank 2 across all groups, etc.
  // Within each rank tier, groups go in group-number order (A, B, C, …).
  const primary: Qualifier[] = []
  for (let rank = 1; rank <= advanceCount; rank++) {
    for (const { group, standings } of groupStandings) {
      const player = standings.find(s => s.rank === rank)
      if (!player) continue
      primary.push({
        playerId:    player.playerId,
        name:        player.playerName,
        seed:        player.playerSeed,
        club:        player.playerClub,
        rrRank:      rank,
        groupName:   group.name,
        groupId:     group.id,
        koSeed:      0,          // assigned below
        isBestThird: false,
      })
    }
  }

  // ── Step 2: Best third-placed (optional) ───────────────────────────────────
  const bestThirds: Qualifier[] = []
  if (allowBestThird && bestThirdCount > 0) {
    // Collect all third-placed players across groups
    const thirds: Array<{ player: PlayerStanding; group: RRGroup }> = []
    for (const { group, standings } of groupStandings) {
      const third = standings.find(s => s.rank === advanceCount + 1)
      if (third) thirds.push({ player: third, group })
    }

    // Sort thirds by cross-group comparison (no H2H — different groups)
    thirds.sort((a, b) => {
      if (b.player.wins            !== a.player.wins)           return b.player.wins - a.player.wins
      if (b.player.gameDifference  !== a.player.gameDifference) return b.player.gameDifference - a.player.gameDifference
      if (b.player.pointsDifference !== a.player.pointsDifference) return b.player.pointsDifference - a.player.pointsDifference
      return a.player.playerId < b.player.playerId ? -1 : 1
    })

    const nThirds = Math.min(bestThirdCount, thirds.length)
    for (let i = 0; i < nThirds; i++) {
      const { player, group } = thirds[i]
      bestThirds.push({
        playerId:    player.playerId,
        name:        player.playerName,
        seed:        player.playerSeed,
        club:        player.playerClub,
        rrRank:      advanceCount + 1,
        groupName:   group.name,
        groupId:     group.id,
        koSeed:      0,
        isBestThird: true,
      })
    }
  }

  // ── Step 3: Assign KO seeds ────────────────────────────────────────────────
  const all = [...primary, ...bestThirds]
  all.forEach((q, i) => { q.koSeed = i + 1 })

  return all
}

// ─────────────────────────────────────────────────────────────────────────────
// getQualifierPreview
// Returns current standings for preview before stage is closed.
// Used to show "if the group stage ended now, these would be the qualifiers."
// ─────────────────────────────────────────────────────────────────────────────
export async function getQualifierPreview(
  tournamentId: string,
  rrStageId:    string,
): Promise<{ qualifiers?: Qualifier[]; error?: string }> {
  return computeQualifiers(tournamentId, rrStageId)
}
