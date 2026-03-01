import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { PublicTournamentClient }    from '@/app/tournaments/[id]/client'
import { PublicMultiStageClient }    from '@/components/bracket/PublicMultiStageClient'
import type { Tournament, Match, Player, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup } from '@/lib/roundrobin/types'
import { LiveBadge }   from '@/components/shared/LiveBadge'
import { Badge }       from '@/components/ui/index'
import { Calendar, MapPin, Trophy, Layers, Users, Swords, ExternalLink } from 'lucide-react'
import { formatDate, formatFormatLabel } from '@/lib/utils'

interface PageProps { params: { cid: string; eid: string } }

export async function generateMetadata({ params }: PageProps) {
  const supabase = createClient()
  const { data: ev }    = await supabase.from('tournaments').select('name').eq('id', params.eid).single()
  const { data: champ } = await supabase.from('championships').select('name').eq('id', params.cid).single()
  return { title: ev ? `${ev.name} — ${champ?.name ?? 'Championship'}` : 'Event' }
}

export const revalidate = 0

export default async function PublicEventPage({ params }: PageProps) {
  const supabase = createClient()

  // Check auth (no redirect — just used to show admin link)
  const { data: { user } } = await supabase.auth.getUser()

  const { data: champ } = await supabase
    .from('championships')
    .select('id, name, published')
    .eq('id', params.cid)
    .eq('published', true)
    .single()
  if (!champ) notFound()

  const { data: ev } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.eid)
    .eq('championship_id', params.cid)
    .single()
  if (!ev) notFound()

  const tournament = ev as unknown as Tournament

  // Load all matches with match_id in games for PD computation
  const { data: matches } = await supabase
    .from('matches')
    .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed), games(id,match_id,game_number,score1,score2,winner_id)')
    .eq('tournament_id', params.eid)
    .order('round').order('match_number')

  const allMatches = (matches ?? []) as unknown as Match[]
  const liveCount  = allMatches.filter(m => m.status === 'live').length
  const champion   = allMatches.find(m => m.round_name === 'Final' && m.match_kind !== 'round_robin' && m.status === 'complete')?.winner ?? null

  const isMultiStage  = tournament.format_type === 'multi_rr_to_knockout'
  const isSingleRR    = tournament.format_type === 'single_round_robin'
  const needsRRData   = isMultiStage || isSingleRR

  let rrStage:       Stage | null = null
  let rrGroups:      RRGroup[]    = []
  let players:       Player[]     = []
  let advanceCount                = 2
  let allowBestThird              = false
  let bestThirdCount              = 0

  if (needsRRData) {
    const [{ data: stageRows }, { data: playerRows }] = await Promise.all([
      supabase.from('stages').select('*').eq('tournament_id', params.eid).order('stage_number'),
      supabase.from('players').select('*').eq('tournament_id', params.eid),
    ])

    for (const s of stageRows ?? []) {
      if (s.stage_type === 'round_robin') rrStage = s as unknown as Stage
    }
    players = (playerRows ?? []) as unknown as Player[]

    if (rrStage) {
      const { data: groupRows } = await supabase
        .from('rr_groups')
        .select('id, stage_id, name, group_number, rr_group_members(player_id)')
        .eq('stage_id', rrStage.id)
        .order('group_number')

      rrGroups = (groupRows ?? []).map((g: Record<string, unknown> & { rr_group_members: { player_id: string }[] }) => ({
        id:          g.id as string,
        stageId:     g.stage_id as string,
        name:        g.name as string,
        groupNumber: g.group_number as number,
        playerIds:   g.rr_group_members.map((m: { player_id: string }) => m.player_id),
      }))

      const cfg      = rrStage.config as RRStageConfig
      advanceCount   = cfg.advanceCount   ?? 2
      allowBestThird = cfg.allowBestThird ?? false
      bestThirdCount = cfg.bestThirdCount ?? 0
    }
  }

  const ft = tournament.format_type ?? 'single_knockout'
  const ftMeta: Record<string, { label: string; color: string }> = {
    single_knockout:      { label: 'Knockout',          color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
    single_round_robin:   { label: 'Round Robin',       color: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
    multi_rr_to_knockout: { label: 'Groups → Knockout', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' },
  }
  const ftStyle = ftMeta[ft] ?? ftMeta.single_knockout

  const adminHref = `/admin/championships/${params.cid}/events/${params.eid}`

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header — admin sees ADMIN pill; public sees Viewer + sign-in */}
      <Header
        user={user}
        adminRedirectPath={adminHref}
        right={liveCount > 0 ? <LiveBadge label={`${liveCount} LIVE`} /> : undefined}
      />

      {/* Breadcrumb */}
      <Breadcrumb
        variant="public"
        items={[
          { label: 'Championships', href: '/championships' },
          { label: champ.name, href: `/championships/${params.cid}` },
          { label: ev.name },
        ]}
      />

      {/* Event hero — consistent with admin page hero */}
      <div className="relative border-b border-border/60 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 relative">

          {/* Champion banner */}
          {champion && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-400/10 border border-amber-400/30 px-4 py-1.5 animate-fade-in">
              <span className="text-base">🏆</span>
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                {champion.name} — Champion!
              </span>
            </div>
          )}

          {/* Live indicator */}
          {liveCount > 0 && (
            <div className="mb-3">
              <LiveBadge label={`${liveCount} MATCH${liveCount > 1 ? 'ES' : ''} LIVE`} />
            </div>
          )}

          <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
            {ev.name}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {ev.date && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(ev.date)}
              </span>
            )}
            {ev.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {ev.location}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-foreground font-medium">
              <Trophy className="h-3.5 w-3.5 text-orange-500" />
              {formatFormatLabel(ev.format)}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ftStyle.color}`}>
              {ft === 'multi_rr_to_knockout' ? <Layers className="h-3 w-3" /> :
               ft === 'single_round_robin'   ? <Users className="h-3 w-3" /> :
               <Swords className="h-3 w-3" />}
              {ftStyle.label}
            </span>
            <Badge
              variant={
                tournament.status === 'active'   ? 'live' :
                tournament.status === 'complete' ? 'success' : 'secondary'
              }
            >
              {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
            </Badge>
            {user && (
              <Link
                href={adminHref}
                className="ml-auto flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Manage event
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Content — embedded=true skips inner hero in PublicTournamentClient */}
      {isMultiStage ? (
        <PublicMultiStageClient
          tournament={tournament}
          initialMatches={allMatches}
          players={players}
          rrStage={rrStage}
          rrGroups={rrGroups}
          advanceCount={advanceCount}
          allowBestThird={allowBestThird}
          bestThirdCount={bestThirdCount}
        />
      ) : (
        <PublicTournamentClient
          tournament={tournament}
          initialMatches={allMatches}
          players={players}
          rrStage={rrStage}
          initialRRGroups={rrGroups}
          embedded={true}
        />
      )}
    </div>
  )
}
