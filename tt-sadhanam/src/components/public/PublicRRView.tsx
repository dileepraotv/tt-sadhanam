'use client'

/**
 * PublicRRView
 *
 * Public round-robin view. Used for both:
 *   • single_round_robin tournaments (full page content)
 *   • multi_rr_to_knockout Stage 1 tab
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  [Group A] [Group B] [Group C] …   ← tab strip         │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  Standings table                                        │
 *   │   #  Name           MP  W  L  GD  PD                   │
 *   │  ── qualifies line ──                                   │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  ▼  Matchday 1   [DONE]    3 matches                   │  ← accordion
 *   │  ▼  Matchday 2   [LIVE]                                 │
 *   │  ▼  Matchday 3   [UPCOMING]                             │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Standings recompute on every render from the live `matches` prop.
 * Clicking a match row (live or complete) opens the detail dialog.
 */

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Trophy, Info } from 'lucide-react'
import { cn }             from '@/lib/utils'
import type { Match, Tournament, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup, GroupStandings, PlayerStanding } from '@/lib/roundrobin/types'

interface Props {
  tournament:   Tournament
  groups:       RRGroup[]
  standings:    GroupStandings[]    // recomputed live by client.tsx
  rrMatches:    Match[]
  rrStage:      Stage | null
  onMatchClick: (match: Match) => void
}

export function PublicRRView({
  tournament, groups, standings, rrMatches, rrStage, onMatchClick,
}: Props) {
  const [activeGroup, setActiveGroup] = useState(0)

  const cfg = rrStage?.config as RRStageConfig | undefined

  // No groups configured yet — empty state
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center p-6">
        <Info className="h-8 w-8 text-muted-foreground/40" />
        <p className="font-semibold text-muted-foreground">Groups not set up yet</p>
        <p className="text-sm text-muted-foreground">
          The group draw will appear here once the administrator has assigned players.
        </p>
      </div>
    )
  }

  const currentGroup    = groups[activeGroup]
  const currentStandings = standings.find(s => s.group.id === currentGroup?.id)
  const groupMatches    = rrMatches.filter(m => m.group_id === currentGroup?.id)

  // Group matches by matchday (round)
  const matchdays = useMemo(() => {
    const map = new Map<number, Match[]>()
    for (const m of groupMatches) {
      const r = m.round
      if (!map.has(r)) map.set(r, [])
      map.get(r)!.push(m)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, matches]) => ({ round, matches }))
  }, [groupMatches])

  // Advance count for the dashed separator line
  const advanceCount = cfg?.advanceCount ?? 2

  return (
    <div className="flex flex-col">
      {/* ── Group tab strip ── */}
      <div className="flex gap-1 overflow-x-auto p-3 sm:p-4 border-b border-border/60 scrollbar-hide">
        {groups.map((g, i) => {
          const gs = standings.find(s => s.group.id === g.id)
          const hasLive = rrMatches.some(m => m.group_id === g.id && m.status === 'live')
          const allDone = gs
            ? gs.standings.length > 0 &&
              rrMatches.filter(m => m.group_id === g.id).every(
                m => m.status === 'complete' || m.status === 'bye',
              )
            : false

          return (
            <button
              key={g.id}
              onClick={() => setActiveGroup(i)}
              className={cn(
                'flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150',
                'border whitespace-nowrap',
                i === activeGroup
                  ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                  : 'border-border/60 text-muted-foreground hover:border-orange-400 hover:text-foreground hover:bg-muted/40',
              )}
            >
              {g.name}
              {hasLive && <span className="live-dot ml-1.5" />}
              {allDone && !hasLive && (
                <span className="ml-1.5 text-[10px] text-green-600 dark:text-green-400">✓</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="p-4 sm:p-6 flex flex-col gap-6">
        {/* ── Standings table ── */}
        {currentStandings ? (
          <StandingsTable
            standings={currentStandings.standings}
            advanceCount={advanceCount}
          />
        ) : (
          <div className="rounded-xl bg-muted/20 border border-border/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Standings will appear once matches begin.
          </div>
        )}

        {/* ── Matchday accordion ── */}
        {matchdays.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Fixtures
            </p>
            {matchdays.map(({ round, matches }) => (
              <MatchdayAccordion
                key={round}
                round={round}
                matches={matches}
                onMatchClick={onMatchClick}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-border/40 px-4 py-10 text-center flex flex-col gap-2 items-center">
            <p className="font-semibold text-muted-foreground text-sm">No fixtures yet</p>
            <p className="text-xs text-muted-foreground">
              The match schedule will appear here once the administrator generates fixtures.
            </p>
          </div>
        )}

        {/* Legend */}
        {cfg && (
          <QualificationLegend advanceCount={cfg.advanceCount} groupCount={groups.length} />
        )}
      </div>
    </div>
  )
}

// ── StandingsTable ─────────────────────────────────────────────────────────────

function StandingsTable({ standings, advanceCount }: {
  standings:    PlayerStanding[]
  advanceCount: number
}) {
  if (!standings.length) {
    return (
      <div className="rounded-xl bg-muted/20 border border-border/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Standings will appear once matches begin.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[auto_1fr_repeat(5,auto)] gap-x-3 px-4 py-2 bg-muted/30 border-b border-border/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="w-5 text-center">#</span>
        <span>Player</span>
        <span className="w-7 text-center">MP</span>
        <span className="w-7 text-center">W</span>
        <span className="w-7 text-center">L</span>
        <span className="w-7 text-center">GD</span>
        <span className="w-8 text-center hidden sm:block">PD</span>
      </div>

      {/* Rows */}
      {standings.map((p, idx) => {
        const isQualifier      = idx < advanceCount
        const isLastQualifier  = idx === advanceCount - 1
        const showDivider      = isLastQualifier && idx < standings.length - 1

        return (
          <div key={p.playerId}>
            <div className={cn(
              'grid grid-cols-[auto_1fr_repeat(5,auto)] gap-x-3 px-4 py-2.5 text-sm',
              'transition-colors',
              idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/10',
              isQualifier && 'bg-green-50/50 dark:bg-green-950/10',
            )}>
              {/* Rank badge */}
              <span className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0',
                idx === 0 && 'bg-amber-400/20 text-amber-700 dark:text-amber-400',
                idx === 1 && 'bg-muted/60 text-muted-foreground',
                idx === 2 && 'bg-orange-100/60 text-orange-700 dark:text-orange-500',
                idx > 2   && 'text-muted-foreground',
              )}>
                {p.rank}
              </span>

              {/* Name + seed */}
              <div className="flex items-center gap-1.5 min-w-0">
                {p.playerSeed != null && (
                  <span className="seed-badge shrink-0 text-[9px]">{p.playerSeed}</span>
                )}
                <span className={cn(
                  'truncate font-medium',
                  isQualifier ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {p.playerName}
                </span>
                {isQualifier && (
                  <Trophy className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0 ml-0.5" />
                )}
              </div>

              {/* Stats */}
              <span className="w-7 text-center text-muted-foreground tabular-nums">{p.matchesPlayed}</span>
              <span className={cn(
                'w-7 text-center font-semibold tabular-nums',
                isQualifier ? 'text-green-700 dark:text-green-400' : 'text-foreground',
              )}>{p.wins}</span>
              <span className="w-7 text-center text-muted-foreground tabular-nums">{p.losses}</span>
              <span className={cn(
                'w-7 text-center tabular-nums font-medium',
                p.gameDifference > 0 ? 'text-green-700 dark:text-green-400' :
                p.gameDifference < 0 ? 'text-destructive/70' : 'text-muted-foreground',
              )}>
                {p.gameDifference > 0 ? '+' : ''}{p.gameDifference}
              </span>
              <span className={cn(
                'w-8 text-center tabular-nums text-muted-foreground hidden sm:block',
                p.pointsDifference > 0 ? 'text-green-700/60 dark:text-green-400/60' :
                p.pointsDifference < 0 ? 'text-destructive/50' : '',
              )}>
                {p.pointsDifference > 0 ? '+' : ''}{p.pointsDifference}
              </span>
            </div>

            {/* Qualification divider */}
            {showDivider && (
              <div className="relative h-0 mx-4">
                <div className="absolute inset-0 border-t-2 border-dashed border-green-400/50 dark:border-green-600/40" />
                <span className="absolute right-0 -top-2.5 text-[9px] font-bold uppercase tracking-widest text-green-600/70 dark:text-green-400/60 bg-card px-1">
                  qualifies
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── MatchdayAccordion ──────────────────────────────────────────────────────────

function MatchdayAccordion({ round, matches, onMatchClick }: {
  round:        number
  matches:      Match[]
  onMatchClick: (m: Match) => void
}) {
  const hasLive    = matches.some(m => m.status === 'live')
  const allDone    = matches.every(m => m.status === 'complete' || m.status === 'bye')
  const hasPending = matches.some(m => m.status === 'pending')

  // Auto-expand: live > done last > upcoming first
  const [open, setOpen] = useState(() => hasLive || !allDone)

  // Keep open when a match goes live
  if (hasLive && !open) setOpen(true)

  const statusLabel = hasLive  ? 'LIVE'
    : allDone    ? 'DONE'
    : hasPending ? 'UPCOMING'
    : ''

  const statusCls = hasLive  ? 'text-orange-500 bg-orange-100 dark:bg-orange-950/40 border-orange-300 dark:border-orange-800'
    : allDone    ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800/50'
    : 'text-muted-foreground bg-muted/40 border-border/40'

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-left hover:bg-muted/20 transition-colors"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        }
        <span className="flex-1">Round {round}</span>
        {statusLabel && (
          <span className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
            statusCls,
          )}>
            {hasLive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500 mr-1 animate-pulse" />}
            {statusLabel}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-2 shrink-0">
          {matches.filter(m => m.status !== 'bye').length} matches
        </span>
      </button>

      {/* Expanded match list */}
      {open && (
        <div className="flex flex-col divide-y divide-border/40 border-t border-border/40">
          {matches
            .filter(m => m.status !== 'bye')
            .map(m => (
              <FixtureRow key={m.id} match={m} onMatchClick={onMatchClick} />
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── FixtureRow ─────────────────────────────────────────────────────────────────

function FixtureRow({ match, onMatchClick }: {
  match:        Match
  onMatchClick: (m: Match) => void
}) {
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'complete'
  const isPending  = match.status === 'pending'
  const isClickable = isLive || isComplete

  const p1 = match.player1
  const p2 = match.player2
  const p1Won = isComplete && match.winner_id === match.player1_id
  const p2Won = isComplete && match.winner_id === match.player2_id

  const games = match.games
    ? [...match.games].sort((a, b) => a.game_number - b.game_number)
    : []

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={() => isClickable && onMatchClick(match)}
      onKeyDown={e => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) onMatchClick(match) }}
      className={cn(
        'flex flex-col px-3 py-2.5 rounded-lg border text-sm transition-colors',
        isLive && 'border-orange-400/60 bg-orange-50/80 dark:bg-orange-950/20',
        isComplete && 'bg-muted/40 border-border/40',
        !isComplete && !isLive && 'bg-card border-border',
        isClickable && 'cursor-pointer hover:bg-muted/20',
      )}
    >
      {/* Main row — matches admin FixtureRow layout */}
      <div className="flex items-center gap-2">
        {/* Status chip */}
        <span className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide min-w-[30px] text-center',
          isComplete && 'bg-muted text-muted-foreground',
          isLive     && 'bg-orange-500 text-white animate-pulse',
          isPending  && 'bg-muted text-muted-foreground/60',
        )}>
          {isLive ? 'Live' : isComplete ? 'Done' : 'vs'}
        </span>

        {/* Player 1 — trophy BEFORE name, matching admin RRGroupView layout */}
        <div className={cn(
          'flex items-center gap-1 flex-1 min-w-0 truncate font-medium',
          p1Won && 'font-bold text-foreground',
          p2Won && 'text-muted-foreground',
        )}>
          {p1Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
          {p1?.seed != null && <span className="seed-badge text-[9px] shrink-0">{p1.seed}</span>}
          <span className="truncate">{p1?.name ?? 'TBD'}</span>
        </div>

        {/* Score / VS */}
        {(isComplete || isLive) ? (
          <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-center w-10">
            {match.player1_games}–{match.player2_games}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60 font-normal w-6 text-center">vs</span>
        )}

        {/* Player 2 — trophy AFTER name, matching admin RRGroupView layout */}
        <div className={cn(
          'flex items-center gap-1 flex-1 min-w-0 truncate font-medium justify-end',
          p2Won && 'font-bold text-foreground',
          p1Won && 'text-muted-foreground',
        )}>
          {p2?.seed != null && <span className="seed-badge text-[9px] shrink-0">{p2.seed}</span>}
          <span className="truncate">{p2?.name ?? 'TBD'}</span>
          {p2Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
        </div>

        {/* Click hint */}
        {isClickable && (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        )}
      </div>

      {/* Set scores — shown below for completed and live matches */}
      {games.length > 0 && (isComplete || isLive) && (
        <div className="flex gap-1.5 mt-1.5 pl-12 flex-wrap">
          {games.map(g => {
            const p1WonGame = g.winner_id === match.player1_id
            return (
              <span
                key={g.id}
                className={cn(
                  'text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border tabular-nums',
                  p1WonGame
                    ? 'bg-orange-100 border-orange-200/80 text-orange-700 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-400'
                    : 'bg-muted/40 border-border/30 text-muted-foreground',
                )}
              >
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── QualificationLegend ────────────────────────────────────────────────────────

function QualificationLegend({ advanceCount, groupCount }: {
  advanceCount: number
  groupCount:   number
}) {
  const total = advanceCount * groupCount
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Trophy className="h-3.5 w-3.5 text-green-500 shrink-0" />
      <span>
        Top <strong className="text-foreground">{advanceCount}</strong> players from each group qualify.
        {' '}<strong className="text-foreground">{total}</strong> total qualifiers.
      </span>
    </div>
  )
}
