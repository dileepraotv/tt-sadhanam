'use client'

/**
 * PublicTournamentClient
 *
 * Top-level client component for the public tournament view.
 * Handles all three format types with a single realtime subscription.
 *
 * Data flow:
 *   SSR page.tsx → initial props → useRealtimeTournament (WebSocket)
 *
 * Live update chain:
 *   Supabase Realtime → applyGameChange → setMatches (match.games patched)
 *                     → computeAllGroupStandings recomputed each render
 *
 * Security: never imports lib/actions/* (admin-only). All reads go through
 * public-queries.ts column allow-list + RLS.
 */

import { useState, useCallback, useTransition, useMemo } from 'react'
import {
  Trophy, Calendar, MapPin, Wifi, WifiOff, RefreshCw,
  Clock, Layers, Users, Swords, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import type { Match, Tournament, Game, Player, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'
import { BracketView }        from '@/components/bracket/BracketView'
import { LiveBadge }          from '@/components/shared/LiveBadge'
import { Badge }              from '@/components/ui/index'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/index'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import { cn }                 from '@/lib/utils'
import { useRealtimeTournament } from '@/lib/realtime/useRealtimeTournament'
import type { RealtimeStatus } from '@/lib/realtime/realtime-types'
import { computeAllGroupStandings } from '@/lib/roundrobin/standings'
import { LiveNowStrip }       from '@/components/public/LiveNowStrip'
import { PublicRRView }       from '@/components/public/PublicRRView'
import { MatchDetailDialog }  from '@/components/public/MatchDetailDialog'
import { Header }             from '@/components/shared/Header'
import { Breadcrumb }         from '@/components/shared/Breadcrumb'

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  tournament:      Tournament
  initialMatches:  Match[]
  players:         Player[]          // needed for RR standings computation
  rrStage:         Stage | null      // null for single-KO
  initialRRGroups: RRGroup[]         // empty for single-KO
  embedded?:       boolean           // true = skip full-page wrapper + hero (used inside championship event page)
  isAdmin?:        boolean           // true = show admin link in hero
  user?:           { email?: string } | null  // Supabase user (for header auth display)
  adminHref?:      string            // href for admin view link
  adminRedirectPath?: string         // redirect target after login (for unauthenticated users on this page)
}

// ─────────────────────────────────────────────────────────────────────────────

export function PublicTournamentClient({
  tournament, initialMatches, players, rrStage, initialRRGroups, embedded = false,
  isAdmin = false, user, adminHref, adminRedirectPath,
}: Props) {

  const {
    matches,
    gamesCache,
    connectionStatus,
    loadGamesForMatch,
  } = useRealtimeTournament(tournament, initialMatches)

  // ── Selected match dialog ────────────────────────────────────────────────
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [isPending, startTransition]          = useTransition()

  const selectedMatch = selectedMatchId
    ? matches.find(m => m.id === selectedMatchId) ?? null
    : null

  // Prefer gamesCache (kept live by realtime), fall back to match.games from SSR
  const selectedGames: Game[] = useMemo(() => {
    if (!selectedMatchId) return []
    const cached = gamesCache.get(selectedMatchId)
    if (cached) return cached
    return selectedMatch?.games ?? []
  }, [selectedMatchId, selectedMatch, gamesCache])

  const handleMatchClick = useCallback((match: Match) => {
    if (match.status === 'bye') return
    const newId = match.id === selectedMatchId ? null : match.id
    setSelectedMatchId(newId)
    if (newId) {
      startTransition(async () => { await loadGamesForMatch(newId) })
    }
  }, [selectedMatchId, loadGamesForMatch])

  const handleCloseDialog = () => setSelectedMatchId(null)

  // ── Live stats ───────────────────────────────────────────────────────────
  const liveMatches  = useMemo(() => matches.filter(m => m.status === 'live'),  [matches])
  const finalKOMatch = useMemo(() => matches.find(m => m.round_name === 'Final' && m.match_kind !== 'round_robin'), [matches])
  const champion     = finalKOMatch?.status === 'complete' ? finalKOMatch.winner : null

  // ── RR standings — recomputed each render from live matches ──────────────
  const rrGroups: RRGroup[] = initialRRGroups  // static (groups don't change via realtime)

  const rrStandings: GroupStandings[] = useMemo(() => {
    if (!rrStage || rrGroups.length === 0) return []
    const cfg        = rrStage.config as RRStageConfig
    const rrMatches  = matches.filter(m => m.stage_id === rrStage.id)
    const allGames   = rrMatches.flatMap(m => m.games ?? [])
    return computeAllGroupStandings(
      rrGroups, players, rrMatches, allGames, cfg.advanceCount ?? 2,
    )
  }, [rrStage, rrGroups, matches, players])

  // ── Format routing ───────────────────────────────────────────────────────
  const ft = tournament.format_type ?? 'single_knockout'

  // For multi-stage, partition matches
  const rrMatches = useMemo(() => matches.filter(m => m.match_kind === 'round_robin'), [matches])
  const koMatches = useMemo(
    () => matches.filter(m => m.match_kind === 'knockout' || !m.match_kind),
    [matches]
  )

  const mainContent = (
    <main className={embedded ? "flex flex-col gap-5" : "flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 flex flex-col gap-5"}>

      {/* ── Live Now — pinned, shows matches from any stage ── */}
      {liveMatches.length > 0 && (
        <LiveNowStrip
          matches={liveMatches}
          rrGroups={rrGroups}
          onMatchClick={handleMatchClick}
        />
      )}

      {/* ── Main content — routed by format_type ── */}
      <div className="surface-card overflow-hidden">

        {/* Single Knockout */}
        {ft === 'single_knockout' && (
          <div className="p-4 sm:p-6">
            <BracketView
              tournament={tournament}
              matches={koMatches.length > 0 ? koMatches : matches}
              isAdmin={false}
              onMatchClick={handleMatchClick}
            />
          </div>
        )}

        {/* Single Round Robin */}
        {ft === 'single_round_robin' && (
          <PublicRRView
            tournament={tournament}
            groups={rrGroups}
            standings={rrStandings}
            rrMatches={rrMatches.length > 0 ? rrMatches : matches}
            rrStage={rrStage}
            onMatchClick={handleMatchClick}
          />
        )}

        {/* Multi-stage: Groups → Knockout */}
        {ft === 'multi_rr_to_knockout' && (
          <MultiStageView
            tournament={tournament}
            groups={rrGroups}
            standings={rrStandings}
            rrMatches={rrMatches}
            koMatches={koMatches}
            rrStage={rrStage}
            onMatchClick={handleMatchClick}
          />
        )}
      </div>

      {/* ── Connection footer ── */}
      <RealtimeFooter status={connectionStatus} />
    </main>
  )

  if (embedded) {
    return (
      <>
        {mainContent}
        <MatchDetailDialog
          match={selectedMatch}
          games={selectedGames}
          isLoading={isPending}
          onClose={handleCloseDialog}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        user={user as never ?? null}
        adminRedirectPath={adminRedirectPath}
        right={liveMatches.length > 0 ? <LiveBadge label={`${liveMatches.length} LIVE`} /> : undefined}
      />
      <Breadcrumb
        variant="public"
        items={[{ label: tournament.name }]}
      />

      {/* ── Hero ── */}
      <TournamentHero
        tournament={tournament}
        liveCount={liveMatches.length}
        champion={champion}
        connectionStatus={connectionStatus}
        isAdmin={isAdmin}
        adminHref={adminHref}
      />

      {mainContent}

      {/* ── Match detail dialog ── */}
      <MatchDetailDialog
        match={selectedMatch}
        games={selectedGames}
        isLoading={isPending}
        onClose={handleCloseDialog}
      />
    </div>
  )
}

// ── MultiStageView ─────────────────────────────────────────────────────────────

function MultiStageView({
  tournament, groups, standings, rrMatches, koMatches, rrStage, onMatchClick,
}: {
  tournament:   Tournament
  groups:       RRGroup[]
  standings:    GroupStandings[]
  rrMatches:    Match[]
  koMatches:    Match[]
  rrStage:      Stage | null
  onMatchClick: (m: Match) => void
}) {
  const stage2Ready = tournament.stage2_bracket_generated

  const rrLive = rrMatches.some(m => m.status === 'live')
  const koLive = koMatches.some(m => m.status === 'live')

  // Default to stage2 if it exists and has live/active matches, else stage1
  const defaultTab = (stage2Ready && koLive) ? 'stage2' : 'stage1'

  return (
    <Tabs defaultValue={defaultTab}>
      <div className="border-b border-border/60 px-4 sm:px-6 pt-4">
        <TabsList className="w-auto mb-0">
          <TabsTrigger value="stage1" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Stage 1 · Groups
            {rrLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
          <TabsTrigger value="stage2" className="gap-1.5" disabled={!stage2Ready}>
            <Swords className="h-3.5 w-3.5" />
            Stage 2 · Knockout
            {koLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="stage1" className="mt-0">
        <PublicRRView
          tournament={tournament}
          groups={groups}
          standings={standings}
          rrMatches={rrMatches}
          rrStage={rrStage}
          onMatchClick={onMatchClick}
        />
      </TabsContent>

      <TabsContent value="stage2" className="mt-0 p-4 sm:p-6">
        {stage2Ready ? (
          <BracketView
            tournament={tournament}
            matches={koMatches}
            isAdmin={false}
            onMatchClick={onMatchClick}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Swords className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-muted-foreground">Stage 2 not started yet</p>
            <p className="text-sm text-muted-foreground/70">
              The knockout bracket will appear here once all group-stage matches are completed.
            </p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

// ── TournamentHero ─────────────────────────────────────────────────────────────

function TournamentHero({ tournament, liveCount, champion, connectionStatus, isAdmin, adminHref }: {
  tournament:       Tournament
  liveCount:        number
  champion:         Match['winner'] | null | undefined
  connectionStatus: RealtimeStatus
  isAdmin?:         boolean
  adminHref?:       string
}) {
  const ft = tournament.format_type ?? 'single_knockout'
  const formatTypeLabel: Record<string, string> = {
    single_knockout:      'Knockout',
    single_round_robin:   'Round Robin',
    multi_rr_to_knockout: 'Groups → Knockout',
  }

  return (
    <div className="relative overflow-hidden border-b border-border/60">
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10 relative">
        {/* Live badge row */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {liveCount > 0 && (
            <LiveBadge label={`${liveCount} MATCH${liveCount > 1 ? 'ES' : ''} LIVE`} />
          )}
          <ConnectionDot status={connectionStatus} />
        </div>

        {/* Champion banner */}
        {champion && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-400/10 border border-amber-400/30 px-4 py-2 animate-fade-in">
            <span className="text-base">🏆</span>
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {champion.name} — Champion!
            </span>
          </div>
        )}

        {/* Name */}
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-wide text-foreground mb-3">
          {tournament.name}
        </h1>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {tournament.date && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(tournament.date)}
            </span>
          )}
          {tournament.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {tournament.location}
            </span>
          )}
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Trophy className="h-3.5 w-3.5" />
            {formatFormatLabel(tournament.format)}
          </span>
          {/* Format type pill */}
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/50">
            <Layers className="h-3 w-3" />
            {formatTypeLabel[ft] ?? ft}
          </span>
          <Badge
            variant={
              tournament.status === 'active'   ? 'live' :
              tournament.status === 'complete' ? 'success' : 'secondary'
            }
          >
            {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
          </Badge>
          {isAdmin && adminHref && (
            <Link
              href={adminHref}
              className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors ml-auto"
            >
              <ExternalLink className="h-3 w-3" />
              Manage event
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ConnectionDot ──────────────────────────────────────────────────────────────

function ConnectionDot({ status }: { status: RealtimeStatus }) {
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-orange-600/60 dark:text-orange-400/60">
        <span className="live-dot h-1.5 w-1.5 shrink-0" />
        Live
      </span>
    )
  }

  const cfg: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    connecting: {
      icon:  <RefreshCw className="h-3 w-3 animate-spin" />,
      label: 'Connecting…',
      cls:   'text-amber-500/70',
    },
    error: {
      icon:  <WifiOff className="h-3 w-3" />,
      label: 'Reconnecting…',
      cls:   'text-destructive/70',
    },
    closed: {
      icon:  <WifiOff className="h-3 w-3" />,
      label: 'Offline',
      cls:   'text-muted-foreground/60',
    },
  }

  const c = cfg[status]
  if (!c) return null

  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', c.cls)}>
      {c.icon} {c.label}
    </span>
  )
}

// ── RealtimeFooter ─────────────────────────────────────────────────────────────

function RealtimeFooter({ status }: { status: RealtimeStatus }) {
  const connected = status === 'connected'
  return (
    <div className={cn(
      'flex items-center justify-center gap-1.5',
      'text-[10px] font-medium uppercase tracking-widest',
      connected ? 'text-orange-600/40 dark:text-orange-400/40' : 'text-muted-foreground/40',
    )}>
      {connected ? (
        <>
          <span className="live-dot h-1.5 w-1.5 shrink-0" />
          Scores update automatically
        </>
      ) : (
        <>
          <Wifi className="h-3 w-3" />
          Waiting for live connection
        </>
      )}
    </div>
  )
}
