import { notFound }       from 'next/navigation'
import { createClient }   from '@/lib/supabase/server'
import { PublicTournamentClient } from './client'
import type { Tournament, Match, Player, Stage } from '@/lib/types'
import type { RRGroup } from '@/lib/roundrobin/types'

interface PageProps { params: { id: string } }

export const revalidate = 0

export async function generateMetadata({ params }: PageProps) {
  const supabase    = createClient()
  const { data: t } = await supabase
    .from('tournaments').select('name').eq('id', params.id).single()
  return { title: t ? `${t.name} — Live` : 'Tournament' }
}

export default async function PublicTournamentPage({ params }: PageProps) {
  const supabase = createClient()

  // Auth check for admin link (no redirect)
  const { data: { user } } = await supabase.auth.getUser()

  // ── All reads in parallel — tournament, matches, stages, players ──────────
  // rr_groups embedded in the stages select so no serial 4th query is needed.
  const [tournamentRes, matchRes, stageRes, playerRes] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', params.id).eq('published', true).single(),
    supabase.from('matches').select(`
      id, tournament_id, round, match_number,
      player1_id, player2_id, player1_games, player2_games,
      winner_id, status, round_name, stage_id, group_id, match_kind,
      player1:player1_id(id,name,seed,club,country_code),
      player2:player2_id(id,name,seed,club,country_code),
      winner:winner_id(id,name,seed,club,country_code),
      games(id,match_id,game_number,score1,score2,winner_id)
    `).eq('tournament_id', params.id).order('round').order('match_number'),
    supabase.from('stages')
      .select('*, rr_groups(id, stage_id, name, group_number, rr_group_members(player_id))')
      .eq('tournament_id', params.id).order('stage_number'),
    supabase.from('players')
      .select('id,name,seed,club,country_code,tournament_id,created_at,updated_at')
      .eq('tournament_id', params.id)
      .order('seed', { ascending: true, nullsFirst: false }),
  ])

  if (!tournamentRes.data) notFound()

  const t       = tournamentRes.data as unknown as Tournament
  const matches = (matchRes.data ?? []) as unknown as Match[]
  const players = (playerRes.data ?? []) as unknown as Player[]

  // ── Stage / group data for RR formats ──────────────────────────────────
  let rrStage:  Stage | null = null
  let rrGroups: RRGroup[]    = []

  const hasRR =
    t.format_type === 'single_round_robin' ||
    t.format_type === 'multi_rr_to_knockout'

  if (hasRR) {
    for (const s of stageRes.data ?? []) {
      if (s.stage_type === 'round_robin') {
        rrStage = s as unknown as Stage
        // rr_groups already embedded in the select — no serial follow-up query
        const embedded = (s as unknown as { rr_groups: typeof s[] }).rr_groups ?? []
        rrGroups = (embedded as unknown as Array<{
          id: string; stage_id: string; name: string; group_number: number
          rr_group_members: { player_id: string }[]
        }>).map(g => ({
          id:          g.id,
          stageId:     g.stage_id,
          name:        g.name,
          groupNumber: g.group_number,
          playerIds:   (g.rr_group_members ?? []).map(m => m.player_id),
        }))
      }
    }
  }

  return (
    <PublicTournamentClient
      tournament={t}
      initialMatches={matches}
      players={players}
      rrStage={rrStage}
      initialRRGroups={rrGroups}
      isAdmin={!!user}
      user={user}
      adminHref={user ? `/admin/tournaments/${params.id}` : undefined}
      adminRedirectPath={`/admin/tournaments/${params.id}`}
    />
  )
}
