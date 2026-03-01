import { redirect } from 'next/navigation'
import { getUser, createClient } from '@/lib/supabase/server'
import { MatchScoringClient } from './client'
import type { Match, Game, Tournament } from '@/lib/types'

interface PageProps { params: { id: string; matchId: string } }

export const revalidate = 0

export default async function MatchScoringPage({ params }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = createClient()

  // Load tournament (verify ownership)
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('created_by', user.id)
    .single()
  if (!tournament) redirect('/')

  // Load match with players + stage/group context
  const { data: match } = await supabase
    .from('matches')
    .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed)')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()
  if (!match) redirect(`/admin/tournaments/${params.id}`)

  // Load games
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('match_id', params.matchId)
    .order('game_number')

  // Resolve group name if this is a round-robin match
  let groupName: string | null = null
  if (match.group_id) {
    const { data: grp } = await supabase
      .from('rr_groups')
      .select('name')
      .eq('id', match.group_id)
      .single()
    groupName = grp?.name ?? null
  }

  const matchKind = (match.match_kind as 'knockout' | 'round_robin') ?? 'knockout'
  const backTab   = matchKind === 'round_robin' ? 'stage1' : 'stages'
  // Build back href — always returns to the correct tab
  const backHref = `/admin/tournaments/${params.id}?tab=${backTab}`

  return (
    <MatchScoringClient
      initialMatch={match as unknown as Match}
      initialGames={(games ?? []) as unknown as Game[]}
      tournament={tournament as unknown as Tournament}
      backHref={backHref}
      groupName={groupName}
      matchKind={matchKind}
    />
  )
}
