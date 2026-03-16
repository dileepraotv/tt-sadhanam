import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link               from 'next/link'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }         from '@/components/shared/Header'
import { Breadcrumb }     from '@/components/shared/Breadcrumb'
import { FormatTypeBadge } from '@/components/shared/FormatTypeBadge'
import { Badge, TabsContent } from '@/components/ui/index'
import { AdminTabs } from '@/components/admin/AdminTabs'
import { Button }         from '@/components/ui/button'
import { PlayerManager }  from '@/components/admin/PlayerManager'
import { LiveBadge }      from '@/components/shared/LiveBadge'
import { StagesTab }      from '@/components/admin/stages/StagesTab'
import { PublicLiveTab }  from '@/components/admin/stages/PublicLiveTab'
import { TournamentTypeSelector } from '@/components/admin/stages/TournamentTypeSelector'
import type { Tournament, Player, Match, Stage } from '@/lib/types'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import {
  Calendar, MapPin, ExternalLink,
} from 'lucide-react'
import { loadAdminEventData } from '@/lib/actions/adminEventData'

interface PageProps {
  params:      { id: string }
  searchParams: { tab?: string }
}

export const revalidate = 0

// ── SSR data loader ─────────────────────────────────────────────────────────
// Delegates to the shared loadAdminEventData utility (see src/lib/actions/adminEventData.ts)
// to avoid duplication with the championship event admin page.

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function AdminTournamentPage({ params, searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const rawData = await loadAdminEventData(params.id, user.id)
  if (!rawData) redirect('/')
  const data = rawData!

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
  const isTeamFormat = [
    'team_league', 'team_league_ko', 'team_league_swaythling',
    'team_group_corbillon', 'team_group_swaythling',
  ].includes(tournament.format_type ?? '')
  // Smart default: URL param wins; else pick the most useful tab automatically
  // Team formats skip 'players' — team management lives inside the stage component
  const autoTab: TabId =
    searchParams.tab && validTabs.includes(searchParams.tab as TabId)
      ? (searchParams.tab as TabId)
      : tournament.bracket_generated || tournament.stage1_complete || tournament.stage2_bracket_generated
      ? 'stages'
      : isTeamFormat
      ? 'stages'
      : players.length >= 2 && !tournament.bracket_generated
      ? 'stages'
      : players.length > 0
      ? 'players'
      : 'setup'
  const defaultTab: TabId = autoTab

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
                  {!isTeamFormat && (
                    <span className="font-medium text-foreground">
                      {formatFormatLabel(tournament.format)}
                    </span>
                  )}
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
          <Suspense fallback={
            <div className="flex gap-1 mb-6">
              {['Setup','Players','Groups','Live'].map(t => (
                <div key={t} className="px-4 py-2 rounded-lg bg-muted/50 text-sm font-semibold text-muted-foreground">{t}</div>
              ))}
            </div>
          }>
          <AdminTabs
            defaultTab={defaultTab}
            formatType={formatType}
            playerCount={players.length}
            stagesLive={stagesLive}
            liveCount={liveCount}
          >

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
          </AdminTabs>
          </Suspense>

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
  const ft         = tournament.format_type ?? 'single_knockout'
  const isKO       = ft === 'single_knockout'
  const isTeamFmt  = ['team_league', 'team_league_ko', 'team_league_swaythling',
                       'team_group_corbillon', 'team_group_swaythling'].includes(ft)

  return (
    <div className="flex flex-col gap-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {!isTeamFmt && <InfoTile label="Match Format" value={formatFormatLabel(tournament.format)} />}
        {isTeamFmt  && <InfoTile label="Format"       value={ft.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase())} />}
        <InfoTile label={isTeamFmt ? 'Teams' : 'Players'} value={isTeamFmt ? '—' : String(players.length)} />
        <InfoTile
          label="Status"
          value={tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
        />
        <InfoTile
          label="Groups"
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
          Add players in the <strong>Players</strong> tab, then visit <strong>Bracket</strong> to generate the draw.
        </HintBox>
      )}
      {!isKO && players.length < 2 && (
        <HintBox type="info">
          Add at least 2 players in <strong>Players</strong>, then configure the draw in <strong>Bracket / Groups</strong>.
        </HintBox>
      )}
      {isKO && players.length >= 2 && !tournament.bracket_generated && (
        <HintBox type="success">
          Ready to draw! Go to the <strong>Bracket</strong> tab and click &ldquo;Generate Bracket&rdquo;.
        </HintBox>
      )}
      {!isKO && players.length >= 4 && !tournament.stage1_complete && !tournament.bracket_generated && (
        <HintBox type="success">
          Ready to create the draw. Go to <strong>Groups / Stages</strong> and configure the format.
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
