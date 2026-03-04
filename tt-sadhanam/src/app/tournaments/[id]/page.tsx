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

  // ── Tournament row ──────────────────────────────────────────────────────
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('published', true)
    .single()

  if (!tournament) notFound()

  const t = tournament as unknown as Tournament

  // ── Matches + joined players + games ────────────────────────────────────
  // Games fetched inline so SSR HTML has per-game scores for completed matches.
  // The realtime hook updates them live once the client hydrates.
  const { data: matchRows } = await supabase
    .from('matches')
    .select(`
      id, tournament_id, round, match_number,
      player1_id, player2_id, player1_games, player2_games,
      winner_id, status, round_name, stage_id, group_id, match_kind,
      player1:player1_id(id,name,seed,club,country_code),
      player2:player2_id(id,name,seed,club,country_code),
      winner:winner_id(id,name,seed,club,country_code),
      games(id,match_id,game_number,score1,score2,winner_id)
    `)
    .eq('tournament_id', params.id)
    .order('round').order('match_number')

  const matches = (matchRows ?? []) as unknown as Match[]

  // ── Stage / group data for RR formats ──────────────────────────────────
  let rrStage:  Stage | null = null
  let rrGroups: RRGroup[]    = []
  let players:  Player[]     = []

  const hasRR =
    t.format_type === 'single_round_robin' ||
    t.format_type === 'multi_rr_to_knockout'

  if (hasRR) {
    const { data: stageRows } = await supabase
      .from('stages')
      .select('*')
      .eq('tournament_id', params.id)
      .order('stage_number')

    for (const s of stageRows ?? []) {
      if (s.stage_type === 'round_robin') rrStage = s as unknown as Stage
    }

    const { data: playerRows } = await supabase
      .from('players')
      .select('id,name,seed,club,country_code,tournament_id,created_at,updated_at')
      .eq('tournament_id', params.id)
      .order('seed', { ascending: true, nullsFirst: false })

    players = (playerRows ?? []) as unknown as Player[]

    if (rrStage) {
      const { data: groupRows } = await supabase
        .from('rr_groups')
        .select('id, stage_id, name, group_number, rr_group_members(player_id)')
        .eq('stage_id', rrStage.id)
        .order('group_number')

      rrGroups = (groupRows ?? []).map(g => ({
        id:          g.id,
        stageId:     g.stage_id,
        name:        g.name,
        groupNumber: g.group_number,
        playerIds:   (g.rr_group_members as { player_id: string }[]).map(m => m.player_id),
      }))
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
