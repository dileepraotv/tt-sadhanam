import { redirect, notFound } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }             from '@/components/shared/Header'
import { Breadcrumb }         from '@/components/shared/Breadcrumb'
import { FormatTypeBadge }    from '@/components/shared/FormatTypeBadge'
import { Badge, TabsContent } from '@/components/ui/index'
import { AdminChampTabs } from '@/components/admin/AdminChampTabs'
import { Button }             from '@/components/ui/button'
import { BracketView }        from '@/components/bracket/BracketView'
import { PlayerManager }      from '@/components/admin/PlayerManager'
import { GenerateDrawButton } from '@/components/admin/BracketControls'
import { MultiStageSetup }    from '@/components/admin/MultiStageSetup'
import { SingleRRStage }      from '@/components/admin/stages/SingleRRStage'
import { SingleKOStage }      from '@/components/admin/stages/SingleKOStage'
import { PureRRStage }        from '@/components/admin/stages/PureRRStage'
import { DoubleEliminationStage } from '@/components/admin/stages/DoubleEliminationStage'
import { TeamLeagueStage }    from '@/components/admin/stages/TeamLeagueStage'
import { TeamGroupKOStage }   from '@/components/admin/stages/TeamGroupKOStage'
import { LiveBadge }          from '@/components/shared/LiveBadge'
import { EventHeaderActions } from './EventHeaderActions'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import { Calendar, MapPin, ExternalLink, Layers } from 'lucide-react'
import { loadAdminEventData } from '@/lib/actions/adminEventData'

interface PageProps {
  params:       { cid: string; eid: string }
  searchParams: { tab?: string; group?: string }
}

export const revalidate = 0

async function getData(cid: string, eid: string, userId: string) {
  // Verify championship ownership separately, then delegate event data loading
  // to the shared utility (avoids duplicating 80+ lines with tournaments/[id]/page.tsx)
  const supabase = createClient()
  const champRes = await supabase.from('championships')
    .select('id, name, published').eq('id', cid).eq('created_by', userId).single()
  if (!champRes.data) return null

  // Verify tournament belongs to this championship
  const evCheck = await supabase.from('tournaments')
    .select('id').eq('id', eid).eq('championship_id', cid).single()
  if (!evCheck.data) return null

  const eventData = await loadAdminEventData(eid, userId, 'none')
  if (!eventData) return null

  return {
    champ:       champRes.data as { id: string; name: string; published: boolean },
    ...eventData,
  }
}

export default async function AdminEventPage({ params, searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const rawData = await getData(params.cid, params.eid, user.id)
  if (!rawData) notFound()
  const data = rawData!

  const { champ, tournament, players, matches, rrStage, rrStandings, hasScores, allComplete } = data

  const isMultiStage   = tournament.format_type === 'multi_rr_to_knockout'
  const isSingleRR     = tournament.format_type === 'single_round_robin'
  const isPureRR       = tournament.format_type === 'pure_round_robin'
  const isDE           = tournament.format_type === 'double_elimination'
  const isTeamLeague   = tournament.format_type === 'team_league'
  const isTeamLeagueKO = tournament.format_type === 'team_league_ko'
  const isTeamSwaythling = tournament.format_type === 'team_league_swaythling'
  const isTeamGroupCorbillon  = tournament.format_type === 'team_group_corbillon'
  const isTeamGroupSwaythling = tournament.format_type === 'team_group_swaythling'
  const isTeamGroupKO  = isTeamGroupCorbillon || isTeamGroupSwaythling
  const isAnyTeamLeague = isTeamLeague || isTeamLeagueKO || isTeamSwaythling
  const liveCount      = matches.filter(m => m.status === 'live').length
  const rrMatches      = matches.filter(m => m.match_kind === 'round_robin')
  const koMatches      = matches.filter(m => m.match_kind === 'knockout' || !m.match_kind)
  const matchBase      = `/admin/championships/${params.cid}/events/${params.eid}/match`
  const publicHref     = `/championships/${params.cid}/events/${params.eid}`
  const showPublicLink = tournament.bracket_generated || tournament.stage2_bracket_generated

  // Tab routing
  const validTabs =
    isMultiStage   ? ['players','stage1','stage2'] :
    isSingleRR     ? (tournament.stage1_complete ? ['players','groups','knockout'] : ['players','groups']) :
    isTeamLeague   ? ['teams','schedule','knockout'] :
    (isTeamLeagueKO || isTeamSwaythling) ? ['teams','knockout'] :
    isTeamGroupKO  ? ['teams','groups','knockout'] :
    ['players','stages']
  // When active/bracket generated, default to the action tab; for setup, show players/teams
  const defaultTabKey = (() => {
    if (isTeamLeagueKO || isTeamSwaythling) {
      return tournament.bracket_generated ? 'knockout' : 'teams'
    }
    if (isTeamLeague) {
      return tournament.bracket_generated ? 'schedule' : 'teams'
    }
    if (isTeamGroupKO) {
      return tournament.bracket_generated ? 'knockout' : 'teams'
    }
    if (isMultiStage) {
      return tournament.stage2_bracket_generated ? 'stage2' : (tournament.status === 'active' ? 'stage1' : 'players')
    }
    if (isSingleRR) {
      return tournament.status === 'active' ? 'groups' : 'players'
    }
    if (tournament.bracket_generated || tournament.status === 'active') return 'stages'
    return 'players'
  })()
  const defaultTab   = validTabs.includes(searchParams.tab ?? '') ? searchParams.tab! : defaultTabKey
  const initialGroup = Math.max(0, parseInt(searchParams.group ?? '0', 10) || 0)

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

      <main className="page-shell page-content">
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
                {!isAnyTeamLeague && !isTeamGroupKO && (
                  <span className="font-medium text-foreground">{formatFormatLabel(tournament.format)}</span>
                )}
                {!isAnyTeamLeague && !isTeamGroupKO && (
                  <span className="text-muted-foreground">{players.length} players</span>
                )}
              </div>
            </div>
            {/* Actions row — always visible on mobile */}
            <div className="flex items-center gap-2 flex-wrap">
            {!isMultiStage && !isSingleRR && !isPureRR && !isDE && !isAnyTeamLeague && !isTeamGroupKO && (
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
          <Suspense fallback={
            <div className="flex gap-1 mb-6">
              {['Players','Stage 1','Stage 2'].map(t => (
                <div key={t} className="px-4 py-2 rounded-lg bg-muted/50 text-sm font-semibold text-muted-foreground">{t}</div>
              ))}
            </div>
          }>
          <AdminChampTabs
            defaultTab={defaultTab}
            formatType={tournament.format_type}
            playerCount={players.length}
            rrLive={rrMatches.some(m => m.status === 'live')}
            koLive={koMatches.some(m => m.status === 'live')}
            stage2Generated={tournament.stage2_bracket_generated ?? false}
            stage1Complete={tournament.stage1_complete ?? false}
            teamScheduleGenerated={tournament.bracket_generated ?? false}
          >
            {isMultiStage ? (
              <>
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
                        Complete all Stage 1 matches, then use &quot;Close Stage 1 &amp; Advance to Knockout&quot; in the Stage 1 tab.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </>
            ) : isSingleRR ? (
              <>
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
                {tournament.stage1_complete && (
                  <TabsContent value="knockout">
                    {tournament.stage2_bracket_generated ? (
                      <BracketView
                        tournament={tournament}
                        matches={koMatches}
                        isAdmin
                        matchBasePath={matchBase}
                      />
                    ) : (
                      <SingleKOStage
                        tournament={tournament}
                        players={players}
                        matches={koMatches}
                        matchBase={matchBase}
                      />
                    )}
                  </TabsContent>
                )}
              </>
            ) : isPureRR ? (
              <>
                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>
                <TabsContent value="stages">
                  <PureRRStage
                    tournament={tournament}
                    players={players}
                    matches={matches}
                    games={matches.flatMap(m => m.games ?? [])}
                    matchBase={matchBase}
                  />
                </TabsContent>
              </>
            ) : isDE ? (
              <>
                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>
                <TabsContent value="stages">
                  <DoubleEliminationStage
                    tournament={tournament}
                    players={players}
                    matches={matches}
                    matchBase={matchBase}
                  />
                </TabsContent>
              </>
            ) : isTeamLeague ? (
              <>
                <TabsContent value="teams">
                  <TeamLeagueStage
                    tournament={tournament}
                    matchBase={matchBase}
                    view="teams"
                  />
                </TabsContent>
                <TabsContent value="schedule">
                  <TeamLeagueStage
                    tournament={tournament}
                    matchBase={matchBase}
                    view="schedule"
                  />
                </TabsContent>
                <TabsContent value="knockout">
                  <TeamLeagueStage
                    tournament={tournament}
                    matchBase={matchBase}
                    view="knockout"
                  />
                </TabsContent>
              </>
            ) : (isTeamLeagueKO || isTeamSwaythling || isTeamGroupKO) ? (
              /* TeamGroupKOStage manages its own Teams/Groups/Knockout tabs internally */
              /* Render without outer TabsContent so it's always visible regardless of URL tab */
              <div className="mt-0">
                <TeamGroupKOStage tournament={tournament} matchBase={matchBase} />
              </div>
            ) : (
              /* Default: single_knockout */
              <>
                <TabsContent value="players">
                  <PlayerManager tournament={tournament} players={players} />
                </TabsContent>
                <TabsContent value="stages">
                  <BracketView tournament={tournament} matches={matches} isAdmin matchBasePath={matchBase} />
                </TabsContent>
              </>
            )}
          </AdminChampTabs>
          </Suspense>

        </div>
      </main>
    </div>
  )
}
