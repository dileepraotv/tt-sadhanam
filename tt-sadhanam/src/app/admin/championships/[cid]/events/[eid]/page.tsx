import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }             from '@/components/shared/Header'
import { Breadcrumb }         from '@/components/shared/Breadcrumb'
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/index'
import { Button }             from '@/components/ui/button'
import { BracketView }        from '@/components/bracket/BracketView'
import { PlayerManager }      from '@/components/admin/PlayerManager'
import { GenerateDrawButton } from '@/components/admin/GenerateDrawButton'
import { MultiStageSetup }    from '@/components/admin/MultiStageSetup'
import { SingleRRStage }      from '@/components/admin/stages/SingleRRStage'
import { LiveBadge }          from '@/components/shared/LiveBadge'
import { EventHeaderActions } from './EventHeaderActions'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import { computeAllGroupStandings, groupProgress } from '@/lib/roundrobin/standings'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'
import { Calendar, MapPin, ExternalLink, Layers, Swords, Users } from 'lucide-react'

// ── Format type badge label + icon ────────────────────────────────────────────
function FormatTypeBadge({ formatType }: { formatType: string | undefined }) {
  if (!formatType || formatType === 'single_knockout') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60">
        <Swords className="h-3 w-3" /> Single Knockout
      </span>
    )
  }
  if (formatType === 'single_round_robin') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
        <Users className="h-3 w-3" /> Round Robin
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60">
      <Layers className="h-3 w-3" /> Groups → Knockout
    </span>
  )
}

interface PageProps {
  params:       { cid: string; eid: string }
  searchParams: { tab?: string; group?: string }
}

export const revalidate = 0

async function getData(cid: string, eid: string, userId: string) {
  const supabase = createClient()

  const { data: champ } = await supabase
    .from('championships')
    .select('id, name, published')
    .eq('id', cid)
    .eq('created_by', userId)
    .single()
  if (!champ) return null

  const { data: ev } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', eid)
    .eq('championship_id', cid)
    .single()
  if (!ev) return null

  const tournament = ev as unknown as Tournament

  const [{ data: players }, { data: matches }] = await Promise.all([
    supabase.from('players')
      .select('*')
      .eq('tournament_id', eid)
      .order('seed', { ascending: true, nullsFirst: false }),
    supabase.from('matches')
      .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed), games(id,match_id,game_number,score1,score2,winner_id)')
      .eq('tournament_id', eid)
      .order('round').order('match_number'),
  ])

  // Multi-stage: load stage data when needed
  let rrStage:     Stage | null     = null
  let koStage:     Stage | null     = null
  let rrGroups:    RRGroup[]        = []
  let rrStandings: GroupStandings[] = []
  let hasScores    = false
  let allComplete  = false

  const hasRR = tournament.format_type === 'multi_rr_to_knockout' ||
                tournament.format_type === 'single_round_robin'

  if (hasRR) {
    const { data: stageRows } = await supabase
      .from('stages')
      .select('*')
      .eq('tournament_id', eid)
      .order('stage_number')

    for (const s of stageRows ?? []) {
      if (s.stage_type === 'round_robin') rrStage = s as unknown as Stage
      if (s.stage_type === 'knockout')    koStage = s as unknown as Stage
    }

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

      const allMatchList  = (matches ?? []) as unknown as Match[]
      const rrMatchList   = allMatchList.filter(m => m.stage_id === rrStage!.id)
      const allGames      = rrMatchList.flatMap(m => m.games ?? [])
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
    champ:       champ as { id: string; name: string; published: boolean },
    tournament,
    players:     (players ?? []) as unknown as Player[],
    matches:     (matches ?? []) as unknown as Match[],
    rrStage, koStage, rrGroups, rrStandings, hasScores, allComplete,
  }
}

export default async function AdminEventPage({ params, searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const data = await getData(params.cid, params.eid, user.id)
  if (!data) notFound()

  const { champ, tournament, players, matches, rrStage, rrStandings, hasScores, allComplete } = data

  const isMultiStage   = tournament.format_type === 'multi_rr_to_knockout'
  const isSingleRR     = tournament.format_type === 'single_round_robin'
  const liveCount      = matches.filter(m => m.status === 'live').length
  const rrMatches      = matches.filter(m => m.match_kind === 'round_robin')
  const koMatches      = matches.filter(m => m.match_kind === 'knockout' || !m.match_kind)
  const matchBase      = `/admin/championships/${params.cid}/events/${params.eid}/match`
  const publicHref     = `/championships/${params.cid}/events/${params.eid}`
  const showPublicLink = tournament.bracket_generated || tournament.stage2_bracket_generated

  const validTabs  = isMultiStage ? ['players','stage1','stage2']
                   : isSingleRR   ? ['players','groups']
                   :                ['players','bracket']
  const defaultTab    = validTabs.includes(searchParams.tab ?? '') ? searchParams.tab! : 'players'
  const initialGroup  = Math.max(0, parseInt(searchParams.group ?? '0', 10) || 0)

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        isAdmin
        user={user}
        right={
          showPublicLink ? (
            <Button asChild variant="outline" size="sm">
              <Link href={publicHref} target="_blank">
                <ExternalLink className="h-3.5 w-3.5" /> Public View
              </Link>
            </Button>
          ) : null
        }
      />
      <Breadcrumb
        variant="admin"
        items={[
          { label: 'My Championships', href: '/admin/championships' },
          { label: champ.name, href: `/admin/championships/${params.cid}` },
          { label: tournament.name },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6">
        <div className="surface-card p-4 sm:p-6 lg:p-8">

          {/* Event header */}
          <div className="mb-6 flex flex-col gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-foreground">
                  {tournament.name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <Badge variant={
                    tournament.status === 'active'   ? 'live' :
                    tournament.status === 'complete'  ? 'success' : 'secondary'
                  }>
                    {tournament.status}
                  </Badge>
                  {liveCount > 0 && <LiveBadge label={`${liveCount} LIVE`} />}
                  <FormatTypeBadge formatType={tournament.format_type} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                {tournament.date && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(tournament.date)}</span>}
                {tournament.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{tournament.location}</span>}
                <span className="font-medium text-foreground">{formatFormatLabel(tournament.format)}</span>
                <span className="text-muted-foreground">{players.length} players</span>
              </div>
            </div>
            {/* Actions row — always visible on mobile */}
            <div className="flex items-center gap-2 flex-wrap">
              {!isMultiStage && !isSingleRR && (
                <GenerateDrawButton tournament={tournament} players={players} />
              )}
              <EventHeaderActions
                cid={params.cid}
                eventId={params.eid}
                eventName={tournament.name}
              />
              {showPublicLink && (
                <Button asChild variant="outline" size="sm" className="sm:hidden">
                  <Link href={publicHref} target="_blank">
                    <ExternalLink className="h-3.5 w-3.5" /> Public View
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue={defaultTab}>
            {isMultiStage ? (
              <>
                <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto">
                  <TabsTrigger value="players" className="flex-none">
                    Players {players.length > 0 && <span className="ml-1 text-xs opacity-70">({players.length})</span>}
                  </TabsTrigger>
                  <TabsTrigger value="stage1" className="flex-none">
                    Stage 1: Groups
                    {rrMatches.some(m => m.status === 'live') && <span className="live-dot ml-1.5" />}
                  </TabsTrigger>
                  <TabsTrigger
                    value="stage2"
                    className="flex-none"
                    disabled={!tournament.stage2_bracket_generated}
                  >
                    Stage 2: Knockout
                    {koMatches.some(m => m.status === 'live') && <span className="live-dot ml-1.5" />}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>

                <TabsContent value="stage1">
                  <MultiStageSetup
                    tournament={tournament}
                    players={players}
                    stage={rrStage}
                    standings={rrStandings}
                    rrMatches={rrMatches}
                    hasScores={hasScores}
                    allComplete={allComplete}
                    matchBase={matchBase}
                    initialGroup={initialGroup}
                  />
                </TabsContent>

                <TabsContent value="stage2">
                  {tournament.stage2_bracket_generated ? (
                    <BracketView
                      tournament={tournament}
                      matches={koMatches}
                      isAdmin
                      matchBasePath={matchBase}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                      <Layers className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-muted-foreground text-sm font-medium">Knockout bracket not yet generated.</p>
                      <p className="text-muted-foreground text-xs">
                        Complete all Stage 1 matches, then use "Close Stage 1 &amp; Advance to Knockout" in the Stage 1 tab.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </>
            ) : isSingleRR ? (
              <>
                <TabsList className="w-full sm:w-auto mb-6">
                  <TabsTrigger value="players" className="flex-1 sm:flex-none">
                    Players {players.length > 0 && <span className="ml-1 text-xs opacity-70">({players.length})</span>}
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="flex-1 sm:flex-none">
                    Groups
                    {rrMatches.some(m => m.status === 'live') && <span className="live-dot ml-1.5" />}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>
                <TabsContent value="groups">
                  <SingleRRStage
                    tournament={tournament}
                    players={players}
                    stage={rrStage}
                    standings={rrStandings}
                    rrMatches={rrMatches}
                    hasScores={hasScores}
                    allComplete={allComplete}
                    matchBase={matchBase}
                    initialGroup={initialGroup}
                  />
                </TabsContent>
              </>
            ) : (
              <>
                <TabsList className="w-full sm:w-auto mb-6">
                  <TabsTrigger value="players" className="flex-1 sm:flex-none">
                    Players {players.length > 0 && <span className="ml-1 text-xs opacity-70">({players.length})</span>}
                  </TabsTrigger>
                  <TabsTrigger value="bracket" className="flex-1 sm:flex-none">
                    Bracket
                    {liveCount > 0 && <span className="live-dot ml-1.5" />}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>

                <TabsContent value="bracket">
                  <BracketView tournament={tournament} matches={matches} isAdmin matchBasePath={matchBase} />
                </TabsContent>
              </>
            )}
          </Tabs>

        </div>
      </main>
    </div>
  )
}
