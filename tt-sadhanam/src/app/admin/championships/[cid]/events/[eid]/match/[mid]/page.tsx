import { redirect, notFound } from 'next/navigation'
import { getUser, createClient } from '@/lib/supabase/server'
import { MatchScoringClient } from '@/app/admin/tournaments/[id]/match/[matchId]/client'
import type { Match, Game, Tournament } from '@/lib/types'

interface PageProps { params: { cid: string; eid: string; mid: string } }

export const revalidate = 0

export default async function EventMatchPage({ params }: PageProps) {
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

  // ── Determine correct back tab based on format_type + match_kind ───────────
  const formatType   = ev.format_type ?? 'single_knockout'
  const isMultiStage = formatType === 'multi_rr_to_knockout'
  const isSingleRR   = formatType === 'single_round_robin'
  const matchKind    = (match as unknown as { match_kind?: string }).match_kind ?? 'knockout'
  const isRRMatch    = matchKind === 'round_robin'

  // Fix: map each format + match kind to the correct tab name
  let backTab: string
  if (isRRMatch) {
    backTab = isSingleRR ? 'groups' : 'stage1'
  } else {
    backTab = isMultiStage ? 'stage2' : 'bracket'
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

  const backHref = isRRMatch
    ? `/admin/championships/${params.cid}/events/${params.eid}?tab=${backTab}&group=${groupIndex}`
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
