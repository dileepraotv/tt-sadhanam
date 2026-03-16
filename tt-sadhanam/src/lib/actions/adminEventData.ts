/**
 * adminEventData.ts
 *
 * Shared data loader for admin event pages.
 * Used by both:
 *   - /admin/tournaments/[id]/page.tsx  (standalone tournament)
 *   - /admin/championships/[cid]/events/[eid]/page.tsx  (championship event)
 *
 * Eliminates the duplicated getData() function that existed in both pages.
 * Both flows load the same core data: tournament, players, matches, stages.
 */

import { createClient } from '@/lib/supabase/server'
import { computeAllGroupStandings, groupProgress } from '@/lib/roundrobin/standings'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'

export interface AdminEventData {
  tournament:  Tournament
  players:     Player[]
  matches:     Match[]
  rrStage:     Stage | null
  koStage:     Stage | null
  rrGroups:    RRGroup[]
  rrStandings: GroupStandings[]
  hasScores:   boolean
  allComplete: boolean
}

/**
 * Load all data for an admin event page.
 *
 * @param tournamentId  The tournament/event ID
 * @param userId        The authenticated admin user ID (ownership check)
 * @param ownerField    'created_by' for standalone tournaments, implicit for championship events
 */
export async function loadAdminEventData(
  tournamentId: string,
  userId: string,
  ownerField: 'created_by' | 'none' = 'created_by',
): Promise<AdminEventData | null> {
  const supabase = createClient()

  // All reads are independent — run in parallel
  const tournamentQuery = ownerField === 'created_by'
    ? supabase.from('tournaments').select('*').eq('id', tournamentId).eq('created_by', userId).single()
    : supabase.from('tournaments').select('*').eq('id', tournamentId).single()

  const [tournamentRes, playersRes, matchesRes, stagesRes] = await Promise.all([
    tournamentQuery,
    supabase.from('players').select('*').eq('tournament_id', tournamentId)
      .order('seed', { ascending: true, nullsFirst: false }),
    supabase.from('matches')
      .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed), games(id,match_id,game_number,score1,score2,winner_id)')
      .eq('tournament_id', tournamentId).order('round').order('match_number'),
    supabase.from('stages')
      .select('*, rr_groups(id, stage_id, name, group_number, rr_group_members(player_id))')
      .eq('tournament_id', tournamentId).order('stage_number'),
  ])

  if (!tournamentRes.data) return null

  const tournament = tournamentRes.data as unknown as Tournament
  const players    = playersRes.data
  const matches    = matchesRes.data

  // Stage data — only computed for RR-based formats
  let rrStage:     Stage | null     = null
  let koStage:     Stage | null     = null
  let rrGroups:    RRGroup[]        = []
  let rrStandings: GroupStandings[] = []
  let hasScores    = false
  let allComplete  = false

  const hasRR = tournament.format_type === 'multi_rr_to_knockout' ||
                tournament.format_type === 'single_round_robin'

  if (hasRR) {
    for (const s of stagesRes.data ?? []) {
      if (s.stage_type === 'round_robin') rrStage = s as unknown as Stage
      if (s.stage_type === 'knockout')    koStage = s as unknown as Stage
    }

    if (rrStage) {
      type RawGroup = { id: string; stage_id: string; name: string; group_number: number; rr_group_members: { player_id: string }[] }
      const embedded = ((rrStage as unknown as { rr_groups?: RawGroup[] }).rr_groups) ?? []

      rrGroups = embedded.map(g => ({
        id:          g.id,
        stageId:     g.stage_id,
        name:        g.name,
        groupNumber: g.group_number,
        playerIds:   (g.rr_group_members ?? []).map(m => m.player_id),
      }))

      const allMatchList = (matches ?? []) as unknown as Match[]
      const rrMatchList  = allMatchList.filter(m => m.stage_id === rrStage!.id)
      const allGames     = rrMatchList.flatMap(m => m.games ?? [])

      hasScores   = allGames.some(g => g.score1 != null || g.score2 != null)
      allComplete = groupProgress(rrMatchList).allDone && rrMatchList.length > 0

      if (rrGroups.length > 0) {
        const cfg = rrStage.config as RRStageConfig
        rrStandings = computeAllGroupStandings(
          rrGroups,
          (players ?? []) as unknown as Player[],
          rrMatchList,
          allGames,
          cfg.advanceCount ?? 2,
        )
      }
    }
  }

  return {
    tournament,
    players:     (players ?? []) as unknown as Player[],
    matches:     (matches ?? []) as unknown as Match[],
    rrStage, koStage, rrGroups, rrStandings, hasScores, allComplete,
  }
}
