'use client'

/**
 * PublicMultiStageClient.tsx
 *
 * Audience-facing view for multi-stage (RR → KO) tournaments.
 *
 * Architecture:
 *   • Shares the same useRealtimeTournament hook as PublicTournamentClient —
 *     the hook's filter is `tournament_id=eq.${id}` which already covers
 *     both RR and KO matches (they're all in the matches table).
 *   • When a match Realtime event arrives, we re-compute RR standings
 *     from the updated match list (pure client-side, no extra DB call).
 *   • KO bracket uses the existing BracketView component unchanged.
 *
 * Tabs:
 *   "Groups"   — RR standings tables + fixture lists per group, live-updating
 *   "Knockout" — BracketView, live-updating (visible only after Stage 2 exists)
 */

import { useMemo, useState } from 'react'
import { Trophy, Users, ChevronRight, Swords } from 'lucide-react'
import { cn }                     from '@/lib/utils'
import type { Tournament, Match, Player, Stage, RRStageConfig } from '@/lib/types'
import type { RRGroup, GroupStandings } from '@/lib/roundrobin/types'
import { computeAllGroupStandings } from '@/lib/roundrobin/standings'
import { BracketView }             from '@/components/bracket/BracketView'
import { useRealtimeTournament }   from '@/lib/realtime/useRealtimeTournament'

interface Props {
  tournament:     Tournament
  initialMatches: Match[]
  players:        Player[]
  rrStage:        Stage | null
  rrGroups:       RRGroup[]
  advanceCount:   number
  allowBestThird?: boolean
  bestThirdCount?: number
}

export function PublicMultiStageClient({
  tournament,
  initialMatches,
  players,
  rrStage,
  rrGroups,
  advanceCount,
  allowBestThird = false,
  bestThirdCount = 0,
}: Props) {
  const { matches } = useRealtimeTournament(tournament, initialMatches)

  const [activeTab, setActiveTab] = useState<'groups' | 'knockout'>('groups')

  const rrMatches = useMemo(
    () => matches.filter(m => m.match_kind === 'round_robin'),
    [matches],
  )
  const koMatches = useMemo(
    () => matches.filter(m => m.match_kind === 'knockout' || !m.match_kind),
    [matches],
  )

  // Recompute standings live on every match update — pure, fast
  const standings: GroupStandings[] = useMemo(() => {
    if (!rrGroups.length) return []
    const allGames = rrMatches.flatMap(m => m.games ?? [])
    return computeAllGroupStandings(rrGroups, players, rrMatches, allGames, advanceCount)
  }, [rrGroups, players, rrMatches, advanceCount])

  const hasKO          = tournament.stage2_bracket_generated
  const stage1Complete = tournament.stage1_complete

  const rrLive = rrMatches.some(m => m.status === 'live')
  const koLive = koMatches.some(m => m.status === 'live')

  return (
    <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
      {/* Stage status banner */}
      {stage1Complete && !hasKO && (
        <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
          <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800 font-medium">
            Group stage complete — knockout bracket coming soon.
          </p>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('groups')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
            activeTab === 'groups'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card text-foreground border-border hover:border-orange-400',
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Groups
          {rrLive && <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />}
        </button>

        <button
          onClick={() => hasKO && setActiveTab('knockout')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
            !hasKO && 'opacity-40 cursor-not-allowed',
            activeTab === 'knockout' && hasKO
              ? 'bg-orange-500 text-white border-orange-500'
              : hasKO
                ? 'bg-card text-foreground border-border hover:border-orange-400'
                : 'bg-card text-muted-foreground border-border',
          )}
          title={hasKO ? undefined : 'Knockout bracket not yet generated'}
        >
          <Trophy className="h-3.5 w-3.5" />
          Knockout
          {koLive && <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />}
        </button>
      </div>

      {activeTab === 'groups' && (
        <PublicGroupsView
          standings={standings}
          allMatches={rrMatches}
          advanceCount={advanceCount}
          allowBestThird={allowBestThird}
          bestThirdCount={bestThirdCount}
          stage1Complete={stage1Complete ?? false}
        />
      )}

      {activeTab === 'knockout' && hasKO && (
        <div className="surface-card p-4 sm:p-6">
          <BracketView
            tournament={tournament}
            matches={koMatches}
            isAdmin={false}
          />
        </div>
      )}
    </main>
  )
}

// ── Groups view ────────────────────────────────────────────────────────────────

function PublicGroupsView({
  standings,
  allMatches,
  advanceCount,
  allowBestThird,
  bestThirdCount,
  stage1Complete,
}: {
  standings:      GroupStandings[]
  allMatches:     Match[]
  advanceCount:   number
  allowBestThird: boolean
  bestThirdCount: number
  stage1Complete: boolean
}) {
  const [activeGroup, setActiveGroup] = useState(0)

  if (!standings.length) {
    return (
      <div className="surface-card p-8 text-center">
        <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-muted-foreground text-sm">Groups not yet drawn.</p>
      </div>
    )
  }

  const { group, standings: groupRows } = standings[activeGroup]
  const groupMatches = allMatches.filter(m => m.group_id === group.id && m.status !== 'bye')
  const matchdays    = Array.from(new Set(groupMatches.map(m => m.round))).sort((a, b) => a - b)

  // Identify best-third players across ALL groups (for the amber highlight)
  const allThirds = standings
    .map(gs => gs.standings.find(s => s.rank === advanceCount + 1))
    .filter(Boolean)
    .sort((a, b) => {
      if (b!.wins !== a!.wins) return b!.wins - a!.wins
      if (b!.gameDifference !== a!.gameDifference) return b!.gameDifference - a!.gameDifference
      return b!.pointsDifference - a!.pointsDifference
    })
  const bestThirdIds = new Set(
    allowBestThird ? allThirds.slice(0, bestThirdCount).map(s => s!.playerId) : [],
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Group selector */}
      <div className="flex flex-wrap gap-2">
        {standings.map((gs, idx) => {
          const allDone = gs.standings.every(s => s.matchesPlayed > 0)
          return (
            <button
              key={gs.group.id}
              onClick={() => setActiveGroup(idx)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors',
                activeGroup === idx
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:border-orange-400',
              )}
            >
              {gs.group.name}
              {allDone && <span className="ml-1.5 text-[10px] opacity-60">✓</span>}
            </button>
          )
        })}
      </div>

      <div className="surface-card overflow-hidden">
        {/* Standings */}
        <div className="p-4 sm:p-6">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Standings — {group.name}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['#','Player','MP','W','L','GD','PD'].map(h => (
                    <th key={h} className={cn(
                      'py-2 text-xs text-muted-foreground font-medium',
                      h === 'Player' ? 'text-left pr-3' : 'text-center px-2',
                      h === 'PD' && 'hidden sm:table-cell',
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupRows.map(s => {
                  const qualifies   = s.rank <= advanceCount
                  const isBestThird = !qualifies && bestThirdIds.has(s.playerId)

                  return (
                    <tr
                      key={s.playerId}
                      className={cn(
                        'border-b border-border/40 last:border-0 transition-colors',
                        qualifies   && 'bg-green-50/60 dark:bg-green-950/20',
                        isBestThird && 'bg-amber-50/60 dark:bg-amber-950/20',
                      )}
                    >
                      <td className="py-2.5 pr-3 text-center">
                        <span className={cn(
                          'inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold',
                          qualifies   && 'bg-green-500 text-white',
                          isBestThird && 'bg-amber-400 text-white',
                          !qualifies && !isBestThird && 'bg-muted text-muted-foreground',
                        )}>
                          {s.rank}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          {s.playerSeed && (
                            <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1 rounded">
                              [{s.playerSeed}]
                            </span>
                          )}
                          <span className="font-medium text-foreground">{s.playerName}</span>
                          {s.playerClub && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {s.playerClub}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-center tabular-nums text-muted-foreground text-xs">{s.matchesPlayed}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums font-semibold text-green-700 dark:text-green-400">{s.wins}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums text-red-600 dark:text-red-400">{s.losses}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums">
                        <span className={cn(
                          'font-medium text-sm',
                          s.gameDifference > 0 ? 'text-green-700 dark:text-green-400' :
                          s.gameDifference < 0 ? 'text-red-600 dark:text-red-400' :
                          'text-muted-foreground',
                        )}>
                          {s.gameDifference > 0 ? '+' : ''}{s.gameDifference}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center tabular-nums hidden sm:table-cell">
                        <span className={cn(
                          'text-xs',
                          s.pointsDifference > 0 ? 'text-green-700 dark:text-green-400' :
                          s.pointsDifference < 0 ? 'text-red-600 dark:text-red-400' :
                          'text-muted-foreground',
                        )}>
                          {s.pointsDifference > 0 ? '+' : ''}{s.pointsDifference}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-border/40">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-green-500 opacity-70" />
              <span className="text-xs text-muted-foreground">Qualifies (top {advanceCount})</span>
            </div>
            {allowBestThird && bestThirdCount > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-amber-400 opacity-70" />
                <span className="text-xs text-muted-foreground">
                  Best-third ({bestThirdCount} across all groups)
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-muted-foreground">
                MP = matches played · GD = game diff · PD = point diff
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/40" />

        {/* Fixtures */}
        <div className="p-4 sm:p-6">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Fixtures — {group.name}
          </h3>
          {matchdays.length === 0 ? (
            <p className="text-sm text-muted-foreground">Fixtures not yet generated.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {matchdays.map(day => (
                <div key={day}>
                  <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 mb-2">Round {day}</p>
                  <div className="flex flex-col gap-1.5">
                    {groupMatches
                      .filter(m => m.round === day)
                      .map(m => <PublicFixtureRow key={m.id} match={m} />)
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fixture row (public, no links) ─────────────────────────────────────────────

function PublicFixtureRow({ match: m }: { match: Match }) {
  const isComplete = m.status === 'complete'
  const isLive     = m.status === 'live'
  const p1Won      = isComplete && m.winner_id === m.player1_id
  const p2Won      = isComplete && m.winner_id === m.player2_id
  const p1         = m.player1?.name ?? 'TBD'
  const p2         = m.player2?.name ?? 'TBD'

  const games = m.games
    ? [...m.games].sort((a, b) => a.game_number - b.game_number)
    : []

  return (
    <div className={cn(
      'flex flex-col rounded-lg border text-sm',
      isComplete && 'bg-muted/30 border-border/40',
      isLive     && 'border-orange-400 bg-orange-50 dark:bg-orange-950/20',
      !isComplete && !isLive && 'bg-card border-border',
    )}>
      {/* Main match row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
          isComplete && 'bg-muted text-muted-foreground',
          isLive     && 'bg-orange-500 text-white',
          !isComplete && !isLive && 'bg-muted text-muted-foreground',
        )}>
          {isLive ? 'LIVE' : isComplete ? 'Done' : 'vs'}
        </span>

        {/* Player 1 — trophy BEFORE name (matches admin RRGroupView) */}
        <div className={cn(
          'flex items-center gap-1 flex-1 min-w-0 truncate font-medium',
          p1Won && 'font-bold text-foreground',
          p2Won && 'text-muted-foreground',
        )}>
          {p1Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
          <span className="truncate">{p1}</span>
        </div>

        {/* Score */}
        {(isComplete || isLive) ? (
          <span className="shrink-0 font-mono text-sm text-center w-10 font-semibold tabular-nums">
            {m.player1_games}–{m.player2_games}
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground text-xs mx-1 w-6 text-center">vs</span>
        )}

        {/* Player 2 — trophy AFTER name (matches admin RRGroupView) */}
        <div className={cn(
          'flex items-center gap-1 flex-1 min-w-0 truncate font-medium justify-end',
          p2Won && 'font-bold text-foreground',
          p1Won && 'text-muted-foreground',
        )}>
          <span className="truncate">{p2}</span>
          {p2Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
        </div>
      </div>

      {/* Set scores — shown below for completed/live matches */}
      {games.length > 0 && (isComplete || isLive) && (
        <div className="flex gap-1 mt-1.5 pl-11 flex-wrap">
          {games.map((g, i) => {
            const p1WonGame = g.winner_id === m.player1_id
            return (
              <span
                key={g.id ?? i}
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
