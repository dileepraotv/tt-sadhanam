'use client'

/**
 * RRGroupView.tsx
 *
 * Renders the Stage 1 (round robin) view: group tabs, standings table,
 * and fixture list per group. Read-only — scoring links handled via href.
 *
 * Props:
 *   groups     — groups with computed standings
 *   allMatches — all RR matches for the tournament (filtered per group inside)
 *   matchBase  — URL prefix for match scoring (e.g. /admin/.../match)
 *   isAdmin    — show scoring links
 *   advanceCount — how many top players are shown as "qualifying"
 */

import { useState }   from 'react'
import Link           from 'next/link'
import { Trophy }     from 'lucide-react'
import { cn }         from '@/lib/utils'
import type { Match } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'

interface Props {
  groups:       GroupStandings[]
  allMatches:   Match[]
  matchBase:    string
  isAdmin:      boolean
  advanceCount: number
  allowBestThird?: boolean
  bestThirdCount?: number
  initialGroup?: number
}

export function RRGroupView({
  groups,
  allMatches,
  matchBase,
  isAdmin,
  advanceCount,
  allowBestThird = false,
  bestThirdCount = 0,
  initialGroup = 0,
}: Props) {
  const [activeGroup, setActiveGroup] = useState(initialGroup)

  if (!groups.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Groups have not been generated yet.
      </p>
    )
  }

  const { group, standings } = groups[activeGroup]
  const groupMatches = allMatches.filter(m => m.group_id === group.id)

  // Per-matchday grouping of fixtures
  const matchdays = Array.from(new Set(groupMatches.map(m => m.round))).sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-6">
      {/* Group picker tabs */}
      <div className="flex flex-wrap gap-2">
        {groups.map((gs, idx) => {
          const done = gs.standings.every(s => s.matchesPlayed > 0)
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
              {done && <span className="ml-1.5 text-[10px] opacity-70">✓</span>}
            </button>
          )
        })}
      </div>

      {/* Standings table */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Standings — {group.name}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium w-6">#</th>
                <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Player</th>
                <th className="text-center py-2 px-2 text-xs text-muted-foreground font-medium">MP</th>
                <th className="text-center py-2 px-2 text-xs text-muted-foreground font-medium">W</th>
                <th className="text-center py-2 px-2 text-xs text-muted-foreground font-medium">L</th>
                <th className="text-center py-2 px-2 text-xs text-muted-foreground font-medium">GD</th>
                <th className="text-center py-2 px-2 text-xs text-muted-foreground font-medium hidden sm:table-cell">PD</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => {
                const isQualifier   = s.rank <= advanceCount
                const isBorderline  = allowBestThird && s.rank === advanceCount + 1

                return (
                  <tr
                    key={s.playerId}
                    className={cn(
                      'border-b border-border/40 transition-colors',
                      isQualifier  && 'bg-green-50 dark:bg-green-950/30',
                      isBorderline && 'bg-amber-50 dark:bg-amber-950/20',
                    )}
                  >
                    <td className="py-2.5 pr-3">
                      <span className={cn(
                        'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                        isQualifier  ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground',
                        isBorderline && 'bg-amber-400 text-white',
                      )}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        {s.playerSeed && (
                          <span className="text-[10px] font-bold text-orange-600 bg-orange-100 dark:bg-orange-900/40 px-1 py-0.5 rounded shrink-0">
                            [{s.playerSeed}]
                          </span>
                        )}
                        <span className="font-medium text-foreground truncate">{s.playerName}</span>
                        {s.playerClub && (
                          <span className="text-xs text-muted-foreground truncate hidden sm:inline">{s.playerClub}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-muted-foreground">{s.matchesPlayed}</td>
                    <td className="py-2.5 px-2 text-center tabular-nums font-semibold text-green-700 dark:text-green-400">{s.wins}</td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-red-600 dark:text-red-400">{s.losses}</td>
                    <td className="py-2.5 px-2 text-center tabular-nums">
                      <span className={cn(
                        'font-medium',
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
        <div className="flex flex-wrap gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-green-500 opacity-70" />
            <span className="text-xs text-muted-foreground">Qualifies (top {advanceCount})</span>
          </div>
          {allowBestThird && (
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-amber-400 opacity-70" />
              <span className="text-xs text-muted-foreground">
                Potential best-third ({bestThirdCount} of these advance)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Fixture list */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Fixtures — {group.name}
        </h3>
        {matchdays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fixtures generated yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {matchdays.map(day => (
              <div key={day}>
                <p className="text-xs font-semibold text-orange-600 mb-2">Round {day}</p>
                <div className="flex flex-col gap-1">
                  {groupMatches
                    .filter(m => m.round === day)
                    .map(m => <FixtureRow key={m.id} match={m} matchBase={matchBase} isAdmin={isAdmin} />)
                  }
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── FixtureRow ─────────────────────────────────────────────────────────────────

function FixtureRow({
  match,
  matchBase,
  isAdmin,
}: { match: Match; matchBase: string; isAdmin: boolean }) {
  const isBye      = match.status === 'bye'
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const isPending  = match.status === 'pending'

  const p1 = match.player1?.name ?? 'TBD'
  const p2 = match.player2?.name ?? (isBye ? 'BYE' : 'TBD')
  const p1Won = isComplete && match.winner_id === match.player1_id
  const p2Won = isComplete && match.winner_id === match.player2_id

  // Individual game scores (set scores)
  const games = (match.games ?? []).filter(g => g.score1 != null || g.score2 != null)
    .sort((a, b) => a.game_number - b.game_number)

  return (
    <div className={cn(
      'flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border text-sm transition-colors',
      isComplete && 'bg-muted/40 border-border/40',
      isLive     && 'border-orange-400 bg-orange-50 dark:bg-orange-950/20',
      isPending  && 'bg-card border-border',
      isBye      && 'bg-muted/20 border-border/30 opacity-60',
    )}>
      <div className="flex items-center gap-2">
        {/* Status chip */}
        <span className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
          isComplete && 'bg-muted text-muted-foreground',
          isLive     && 'bg-orange-500 text-white animate-pulse',
          isPending  && 'bg-muted text-muted-foreground',
          isBye      && 'bg-muted text-muted-foreground',
        )}>
          {isLive ? 'LIVE' : isComplete ? 'Done' : isBye ? 'BYE' : 'vs'}
        </span>

        {/* Match number */}
        <span className="shrink-0 text-[10px] text-muted-foreground/60 font-mono w-8">#{match.match_number}</span>

        {/* Player 1 */}
        <span className={cn(
          'flex items-center gap-1 flex-1 truncate font-medium',
          p1Won && 'text-foreground font-bold',
          isComplete && !p1Won && 'text-muted-foreground',
        )}>
          {p1Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
          <span className="truncate">{p1}</span>
        </span>

        {/* Games score */}
        {(isComplete || isLive) ? (
          <span className="shrink-0 font-mono text-xs font-bold text-center w-10 tabular-nums">
            {match.player1_games}–{match.player2_games}
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground text-xs mx-1">vs</span>
        )}

        {/* Player 2 */}
        <span className={cn(
          'flex items-center gap-1 flex-1 truncate font-medium justify-end',
          p2Won && 'text-foreground font-bold',
          isComplete && !p2Won && 'text-muted-foreground',
        )}>
          <span className="truncate">{p2}</span>
          {p2Won && <Trophy className="h-3 w-3 text-amber-500 shrink-0" />}
        </span>

        {/* Score link for admin */}
        {isAdmin && !isBye && (
          <Link
            href={`${matchBase}/${match.id}`}
            className="shrink-0 text-xs text-orange-600 hover:text-orange-800 font-medium transition-colors ml-1"
          >
            {isComplete ? 'Edit' : 'Score'}
          </Link>
        )}
      </div>

      {/* Individual set scores */}
      {isComplete && games.length > 0 && (
        <div className="flex items-center gap-1.5 pl-[calc(theme(spacing.8)+theme(spacing.8))] flex-wrap">
          {games.map((g, i) => (
            <span key={g.game_number} className="text-[10px] font-mono text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
              G{i + 1}: {g.score1}–{g.score2}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
