import { redirect } from 'next/navigation'
import { getUser, createClient } from '@/lib/supabase/server'
import { MatchScoringClient } from './client'
import type { Match, Game, Tournament } from '@/lib/types'

interface PageProps { params: { id: string; matchId: string }; searchParams: { round?: string; fix?: string } }

export const revalidate = 0

export default async function MatchScoringPage({ params, searchParams }: PageProps) {
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

  // ── Team submatch: inject player names from team_match_submatches ─────────
  // player1_id / player2_id are null for team submatches; names live in the
  // submatch row. Inject synthetic player objects so the scoring UI works.
  if ((match as unknown as { match_kind?: string }).match_kind === 'team_submatch') {
    const { data: sm } = await supabase
      .from('team_match_submatches')
      .select('player_a_name, player_b_name')
      .eq('match_id', params.matchId)
      .single()
    if (sm) {
      ;(match as unknown as Record<string, unknown>).player1 = sm.player_a_name
        ? { id: 'team-a', name: sm.player_a_name, seed: null, club: null }
        : null
      ;(match as unknown as Record<string, unknown>).player2 = sm.player_b_name
        ? { id: 'team-b', name: sm.player_b_name, seed: null, club: null }
        : null
    }
  }

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
  const isTeamSubmatch = match.match_kind === 'team_submatch'
  // For team submatches return to schedule tab preserving round+fix so the correct fixture reopens
  const backTab   = isTeamSubmatch ? 'schedule' : 'stages'
  const backHref  = isTeamSubmatch && searchParams.round
    ? `/admin/tournaments/${params.id}?tab=${backTab}&round=${searchParams.round}&fix=${searchParams.fix ?? ''}`
    : `/admin/tournaments/${params.id}?tab=${backTab}`

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
