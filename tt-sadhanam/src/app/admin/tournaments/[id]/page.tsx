import { redirect }       from 'next/navigation'
import Link               from 'next/link'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }         from '@/components/shared/Header'
import { Breadcrumb }     from '@/components/shared/Breadcrumb'
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/index'
import { Button }         from '@/components/ui/button'
import { PlayerManager }  from '@/components/admin/PlayerManager'
import { LiveBadge }      from '@/components/shared/LiveBadge'
import { StagesTab }      from '@/components/admin/stages/StagesTab'
import { PublicLiveTab }  from '@/components/admin/stages/PublicLiveTab'
import { TournamentTypeSelector } from '@/components/admin/stages/TournamentTypeSelector'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'
import { computeAllGroupStandings, groupProgress } from '@/lib/roundrobin/standings'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import {
  Calendar, MapPin, ExternalLink,
  Settings2, Users, Layers, Radio,
} from 'lucide-react'

interface PageProps {
  params:      { id: string }
  searchParams: { tab?: string }
}

export const revalidate = 0

// ── SSR data loader ────────────────────────────────────────────────────────────

async function getData(tournamentId: string, userId: string) {
  const supabase = createClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .eq('created_by', userId)
    .single()

  if (!tournament) return null

  const t = tournament as unknown as Tournament

  // Load players + all matches
  const [{ data: players }, { data: matches }] = await Promise.all([
    supabase.from('players')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('seed', { ascending: true, nullsFirst: false }),
    supabase.from('matches')
      .select('*, player1:player1_id(id,name,seed,club), player2:player2_id(id,name,seed,club), winner:winner_id(id,name,seed), games(id,match_id,game_number,score1,score2,winner_id)')
      .eq('tournament_id', tournamentId)
      .order('round').order('match_number'),
  ])

  // ── Stage data for RR/multi-stage formats ─────────────────────────────────
  let rrStage:     Stage | null     = null
  let koStage:     Stage | null     = null
  let rrGroups:    RRGroup[]        = []
  let rrStandings: GroupStandings[] = []
  let hasScores    = false
  let allComplete  = false

  const hasRR = t.format_type === 'multi_rr_to_knockout' ||
                t.format_type === 'single_round_robin'

  if (hasRR) {
    const { data: stageRows } = await supabase
      .from('stages')
      .select('*')
      .eq('tournament_id', tournamentId)
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
    tournament:  t,
    players:     (players ?? []) as unknown as Player[],
    matches:     (matches ?? []) as unknown as Match[],
    rrStage, koStage, rrGroups, rrStandings, hasScores, allComplete,
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function AdminTournamentPage({ params, searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const data = await getData(params.id, user.id)
  if (!data) redirect('/')

  const {
    tournament, players, matches,
    rrStage, koStage, rrStandings, hasScores, allComplete,
  } = data

  const liveCount   = matches.filter(m => m.status === 'live').length
  const formatType  = tournament.format_type ?? 'single_knockout'
  const matchBase   = `/admin/tournaments/${tournament.id}/match`
  const publicHref  = `/tournaments/${tournament.id}`

  const hasPublicView =
    tournament.bracket_generated ||
    tournament.stage2_bracket_generated ||
    tournament.stage1_complete

  // Determine valid tabs and default
  const validTabs = ['setup', 'players', 'stages', 'live'] as const
  type TabId = typeof validTabs[number]
  const defaultTab: TabId = validTabs.includes(searchParams.tab as TabId)
    ? (searchParams.tab as TabId)
    : 'setup'

  // Stage(s) tab badge
  const stagesLive = liveCount > 0

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        isAdmin
        user={user}
        right={
          hasPublicView ? (
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
          { label: tournament.name },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
        <div className="surface-card p-6 sm:p-8">

          {/* ── Tournament Header ── */}
          <div className="mb-6 flex flex-col gap-3">
            {/* Name + badges */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-foreground truncate">
                    {tournament.name}
                  </h1>
                  <StatusBadge status={tournament.status} />
                  {tournament.published && (
                    <Badge variant="success" className="text-xs">Published</Badge>
                  )}
                  {liveCount > 0 && <LiveBadge label={`${liveCount} LIVE`} />}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                  {tournament.date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(tournament.date)}
                    </span>
                  )}
                  {tournament.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {tournament.location}
                    </span>
                  )}
                  <span className="font-medium text-foreground">
                    {formatFormatLabel(tournament.format)}
                  </span>
                  <FormatTypeBadge formatType={formatType} />
                </div>
              </div>
            </div>

            {/* Tournament Type selector — always visible at top, compact strip */}
            <div className="pt-3 border-t border-border/60">
              <TournamentTypeSelector tournament={tournament} />
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs defaultValue={defaultTab}>
            <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
              {/* Setup */}
              <TabsTrigger value="setup" className="flex-none gap-1.5">
                <Settings2 className="h-3.5 w-3.5 hidden sm:block" />
                Setup
              </TabsTrigger>

              {/* Players */}
              <TabsTrigger value="players" className="flex-none gap-1.5">
                <Users className="h-3.5 w-3.5 hidden sm:block" />
                Players
                {players.length > 0 && (
                  <span className="ml-0.5 text-xs opacity-60">({players.length})</span>
                )}
              </TabsTrigger>

              {/* Stage(s) */}
              <TabsTrigger value="stages" className="flex-none gap-1.5">
                <Layers className="h-3.5 w-3.5 hidden sm:block" />
                {formatType === 'multi_rr_to_knockout' ? 'Stages' : 'Stage'}
                {stagesLive && <span className="live-dot ml-1" />}
              </TabsTrigger>

              {/* Live / Public */}
              <TabsTrigger value="live" className="flex-none gap-1.5">
                <Radio className="h-3.5 w-3.5 hidden sm:block" />
                Live / Public
                {liveCount > 0 && <span className="live-dot ml-1" />}
              </TabsTrigger>
            </TabsList>

            {/* ── Setup tab ─────────────────────────────────────────────── */}
            <TabsContent value="setup">
              <SetupTab tournament={tournament} players={players} />
            </TabsContent>

            {/* ── Players tab ───────────────────────────────────────────── */}
            <TabsContent value="players">
              <PlayerManager tournament={tournament} players={players} />
            </TabsContent>

            {/* ── Stage(s) tab ──────────────────────────────────────────── */}
            <TabsContent value="stages">
              <StagesTab
                tournament={tournament}
                players={players}
                matches={matches}
                rrStage={rrStage}
                koStage={koStage}
                rrStandings={rrStandings}
                hasScores={hasScores}
                allComplete={allComplete}
                matchBase={matchBase}
              />
            </TabsContent>

            {/* ── Live / Public tab ─────────────────────────────────────── */}
            <TabsContent value="live">
              <PublicLiveTab
                tournament={tournament}
                matches={matches}
                matchBase={matchBase}
              />
            </TabsContent>
          </Tabs>

        </div>
      </main>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/**
 * Setup tab — match format info + players per group calculator.
 * The TournamentTypeSelector lives in the header (always visible).
 */
function SetupTab({ tournament, players }: { tournament: Tournament; players: Player[] }) {
  const ft   = tournament.format_type ?? 'single_knockout'
  const isKO = ft === 'single_knockout'

  return (
    <div className="flex flex-col gap-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoTile label="Match Format"  value={formatFormatLabel(tournament.format)} />
        <InfoTile label="Players"       value={String(players.length)} />
        <InfoTile
          label="Status"
          value={tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
        />
        <InfoTile
          label="Bracket"
          value={
            tournament.stage2_bracket_generated ? 'Stage 2 ready' :
            tournament.bracket_generated        ? 'Generated' :
            tournament.stage1_complete          ? 'Groups closed' :
            'Not drawn'
          }
        />
      </div>

      {/* Format-specific hints */}
      {isKO && players.length < 2 && (
        <HintBox type="info">
          Add players in the <strong>Players</strong> tab, then visit <strong>Stage</strong> to generate the bracket.
        </HintBox>
      )}
      {!isKO && players.length < 2 && (
        <HintBox type="info">
          Add at least 4 players in <strong>Players</strong>, then configure the group stage in <strong>Stage(s)</strong>.
        </HintBox>
      )}
      {isKO && players.length >= 2 && !tournament.bracket_generated && (
        <HintBox type="success">
          Ready to draw! Go to the <strong>Stage</strong> tab and click "Generate Draw".
        </HintBox>
      )}
      {!isKO && players.length >= 4 && !tournament.stage1_complete && !tournament.bracket_generated && (
        <HintBox type="success">
          Ready to create groups. Go to <strong>Stage(s)</strong> and configure the group stage.
        </HintBox>
      )}
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-muted/30 border border-border/60 px-4 py-3">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <span className="font-display font-semibold text-foreground">{value}</span>
    </div>
  )
}

function HintBox({ type, children }: { type: 'info' | 'success'; children: React.ReactNode }) {
  const cls = type === 'success'
    ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
    : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const v = status === 'active' ? 'live' : status === 'complete' ? 'success' : 'secondary'
  return <Badge variant={v as 'live' | 'success' | 'secondary'}>{status}</Badge>
}

function FormatTypeBadge({ formatType }: { formatType: string }) {
  const labels: Record<string, string> = {
    single_knockout:      'Knockout',
    single_round_robin:   'Round Robin',
    multi_rr_to_knockout: 'Groups → KO',
  }
  const label = labels[formatType] ?? formatType
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60">
      {label}
    </span>
  )
}
