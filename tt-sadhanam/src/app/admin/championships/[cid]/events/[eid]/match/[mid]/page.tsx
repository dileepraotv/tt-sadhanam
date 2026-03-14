import { redirect, notFound } from 'next/navigation'
import { getUser, createClient } from '@/lib/supabase/server'
import { MatchScoringClient } from '@/app/admin/tournaments/[id]/match/[matchId]/client'
import type { Match, Game, Tournament } from '@/lib/types'

interface PageProps { params: { cid: string; eid: string; mid: string }; searchParams: { round?: string; fix?: string } }

export const revalidate = 0

export default async function EventMatchPage({ params, searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = createClient()

  // Verify championship ownership
  const { data: champ } = await supabase
    .from('championships')
    .select('id')
    .eq('id', params.cid)
    .eq('created_by', user.id)
    .single()
  if (!champ) redirect('/')

  // Load tournament/event
  const { data: ev } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.eid)
    .eq('championship_id', params.cid)
    .single()
  if (!ev) notFound()

  // Load match
  const { data: match } = await supabase
    .from('matches')
    .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed)')
    .eq('id', params.mid)
    .eq('tournament_id', params.eid)
    .single()
  if (!match) notFound()

  // Load games
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('match_id', params.mid)
    .order('game_number')

  // ── Team submatch: inject player names from team_match_submatches ─────────
  // player1_id / player2_id are null for team submatches; names live in the
  // submatch row. We also fall back to resolving from player IDs if names
  // haven't been explicitly saved yet (auto-assign path).
  if ((match as unknown as { match_kind?: string }).match_kind === 'team_submatch') {
    const { data: sm } = await supabase
      .from('team_match_submatches')
      .select('player_a_name, player_b_name, team_a_player_id, team_b_player_id, team_a_player2_id, team_b_player2_id')
      .eq('match_id', params.mid)
      .single()
    if (sm) {
      // Resolve names: prefer saved name, fall back to player-id lookup
      let p1Name: string | null = sm.player_a_name ?? null
      let p2Name: string | null = sm.player_b_name ?? null

      if ((!p1Name || !p2Name) && (sm.team_a_player_id || sm.team_b_player_id)) {
        const ids = [sm.team_a_player_id, sm.team_b_player_id, sm.team_a_player2_id, sm.team_b_player2_id].filter(Boolean) as string[]
        if (ids.length > 0) {
          const { data: playerRows } = await supabase
            .from('team_players').select('id, name').in('id', ids)
          const byId: Record<string, string> = {}
          for (const p of playerRows ?? []) byId[p.id] = p.name
          if (!p1Name && sm.team_a_player_id) {
            const n1 = byId[sm.team_a_player_id] ?? null
            const n2 = sm.team_a_player2_id ? (byId[sm.team_a_player2_id] ?? null) : null
            p1Name = n1 && n2 ? `${n1} & ${n2}` : n1
          }
          if (!p2Name && sm.team_b_player_id) {
            const n1 = byId[sm.team_b_player_id] ?? null
            const n2 = sm.team_b_player2_id ? (byId[sm.team_b_player2_id] ?? null) : null
            p2Name = n1 && n2 ? `${n1} & ${n2}` : n1
          }
        }
      }

      ;(match as unknown as Record<string, unknown>).player1 = p1Name
        ? { id: 'team-a', name: p1Name, seed: null, club: null }
        : null
      ;(match as unknown as Record<string, unknown>).player2 = p2Name
        ? { id: 'team-b', name: p2Name, seed: null, club: null }
        : null
    }
  }

  // ── Determine correct back tab based on format_type + match_kind ───────────
  const formatType   = ev.format_type ?? 'single_knockout'
  const isMultiStage = formatType === 'multi_rr_to_knockout'
  const isSingleRR   = formatType === 'single_round_robin'
  const matchKind    = (match as unknown as { match_kind?: string }).match_kind ?? 'knockout'
  const isRRMatch    = matchKind === 'round_robin'

  // Fix: map each format + match kind to the correct tab name
  const isTeamGroupKO = formatType === 'team_group_corbillon' || formatType === 'team_group_swaythling'

  let backTab: string
  if (isTeamGroupKO) {
    // team_group formats: always go back to 'teams' tab (which hosts the full stage UI)
    backTab = 'teams'
  } else if (isRRMatch) {
    backTab = isSingleRR ? 'groups' : 'stage1'
  } else if (isMultiStage) {
    backTab = 'stage2'
  } else if (formatType === 'team_league') {
    backTab = 'schedule'
  } else if (formatType === 'team_league_ko' || formatType === 'team_league_swaythling') {
    backTab = 'bracket'
  } else {
    backTab = 'stages'
  }

  // ── Load group info + resolve group index for "return to correct group" ────
  let groupName:  string | null = null
  let groupIndex: number        = 0

  if (isRRMatch) {
    const rawMatch = match as unknown as { group_id?: string }
    if (rawMatch.group_id) {
      const { data: grp } = await supabase
        .from('rr_groups')
        .select('id, name, stage_id, group_number')
        .eq('id', rawMatch.group_id)
        .single()

      groupName = grp?.name ?? null

      if (grp?.stage_id && grp?.group_number != null) {
        // Count groups with lower group_number in the same stage → gives 0-based index
        const { count } = await supabase
          .from('rr_groups')
          .select('id', { count: 'exact', head: true })
          .eq('stage_id', grp.stage_id)
          .lt('group_number', grp.group_number)
        groupIndex = count ?? Math.max(0, grp.group_number - 1)
      }
    }
  }

  const isTeamFormat = formatType === 'team_league' || formatType === 'team_league_ko' || formatType === 'team_league_swaythling' || isTeamGroupKO
  const backHref = isRRMatch
    ? `/admin/championships/${params.cid}/events/${params.eid}?tab=${backTab}&group=${groupIndex}`
    : isTeamFormat && searchParams.round
    ? `/admin/championships/${params.cid}/events/${params.eid}?tab=${backTab}&round=${searchParams.round}&fix=${searchParams.fix ?? ''}`
    : `/admin/championships/${params.cid}/events/${params.eid}?tab=${backTab}`

  return (
    <MatchScoringClient
      initialMatch={match as unknown as Match}
      initialGames={(games ?? []) as unknown as Game[]}
      tournament={ev as unknown as Tournament}
      backHref={backHref}
      groupName={groupName}
      matchKind={isRRMatch ? 'round_robin' : 'knockout'}
    />
  )
}
