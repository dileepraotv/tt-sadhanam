'use client'

/**
 * GroupStandingsTable
 *
 * Full group view: tab picker → standings table → matchday fixtures.
 * Used by both SingleRRStage and MultiStagePanel (Stage 1).
 * Read-only display; scoring links are passed via matchBase.
 */

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Match } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'

interface Props {
  standings:      GroupStandings[]
  allMatches:     Match[]
  matchBase:      string
  isAdmin?:       boolean
  advanceCount:   number
  allowBestThird?: boolean
  bestThirdCount?: number
  initialGroup?:  number
}

export function GroupStandingsTable({
  standings,
  allMatches,
  matchBase,
  isAdmin = false,
  advanceCount,
  allowBestThird = false,
  bestThirdCount = 0,
  initialGroup = 0,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(Math.min(initialGroup, Math.max(0, standings.length - 1)))

  if (!standings.length) return null

  const { group, standings: rows } = standings[activeIdx]
  const groupMatches = allMatches.filter(m => m.group_id === group.id)
  const matchdays    = Array.from(new Set(groupMatches.map(m => m.round))).sort((a, b) => a - b)

  // Cross-group best-thirds for amber highlight
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
    <div className="flex flex-col gap-5">
      {/* Group tab strip */}
      <div className="flex flex-wrap gap-2">
        {standings.map((gs, idx) => {
          const played = gs.standings.some(s => s.matchesPlayed > 0)
          const done   = gs.standings.length > 0 && gs.standings.every(s =>
            s.matchesPlayed === gs.standings.length - 1,
          )
          return (
            <button
              key={gs.group.id}
              onClick={() => setActiveIdx(idx)}
              className={cn(
                'relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-all',
                activeIdx === idx
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card text-foreground border-border hover:border-orange-400',
              )}
            >
              {gs.group.name}
              {done && <span className="text-[10px] opacity-70">✓</span>}
              {!done && played && <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />}
            </button>
          )
        })}
      </div>

      {/* Standings table */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Standings — {group.name}
        </p>
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                {[
                  { h: '#',   cls: 'w-8 text-center' },
                  { h: 'Player', cls: 'text-left pl-3' },
                  { h: 'MP', cls: 'text-center' },
                  { h: 'W',  cls: 'text-center' },
                  { h: 'L',  cls: 'text-center' },
                  { h: 'GD', cls: 'text-center' },
                  { h: 'PD', cls: 'text-center hidden sm:table-cell' },
                ].map(({ h, cls }) => (
                  <th key={h} className={cn('py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground', cls)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const qualifies   = s.rank <= advanceCount
                const isBestThird = !qualifies && bestThirdIds.has(s.playerId)
                return (
                  <tr
                    key={s.playerId}
                    className={cn(
                      'border-b border-border/40 last:border-0',
                      qualifies   && 'bg-green-50/70 dark:bg-green-950/20',
                      isBestThird && 'bg-amber-50/70 dark:bg-amber-950/20',
                    )}
                  >
                    <td className="py-2.5 px-2 text-center">
                      <span className={cn(
                        'inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold',
                        qualifies   && 'bg-green-500 text-white',
                        isBestThird && 'bg-amber-400 text-white',
                        !qualifies && !isBestThird && 'bg-muted/60 text-muted-foreground',
                      )}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 pr-2">
                      <div className="flex items-center gap-2">
                        {s.playerSeed && (
                          <span className="text-[10px] tabular-nums text-muted-foreground font-mono bg-muted/60 px-1 rounded">
                            [{s.playerSeed}]
                          </span>
                        )}
                        <span className="font-medium text-foreground">{s.playerName}</span>
                        {s.playerClub && (
                          <span className="hidden sm:inline text-xs text-muted-foreground">{s.playerClub}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-xs text-muted-foreground">
                      {s.matchesPlayed}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums font-semibold text-green-700 dark:text-green-400">
                      {s.wins}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-red-600 dark:text-red-400">
                      {s.losses}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums">
                      <span className={cn(
                        'font-semibold text-sm',
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
        <div className="flex flex-wrap gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-green-500/70" />
            <span className="text-[10px] text-muted-foreground">Qualifies (top {advanceCount})</span>
          </div>
          {allowBestThird && bestThirdCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-amber-400/70" />
              <span className="text-[10px] text-muted-foreground">Best-third ({bestThirdCount})</span>
            </div>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            MP · W · L · GD = game diff · PD = point diff
          </span>
        </div>
      </div>

      {/* Fixtures */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Fixtures — {group.name}
        </p>
        {matchdays.length === 0 ? (
          <EmptyFixtures />
        ) : (
          <div className="flex flex-col gap-3">
            {matchdays.map(day => {
              const dayMatches = groupMatches.filter(m => m.round === day)
              const allDone    = dayMatches.every(m => m.status === 'complete' || m.status === 'bye')
              return (
                <div key={day}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-orange-600">Round {day}</span>
                    {allDone && <span className="text-[10px] text-muted-foreground">✓ complete</span>}
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayMatches.map(m => (
                      <FixtureRow key={m.id} match={m} matchBase={matchBase} isAdmin={isAdmin} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty states ───────────────────────────────────────────────────────────────

function EmptyFixtures() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-dashed border-border">
      <p className="text-muted-foreground text-sm">No fixtures yet</p>
      <p className="text-xs text-muted-foreground/70 mt-0.5">
        Assign players to groups, then generate the schedule.
      </p>
    </div>
  )
}

// ── Fixture row ────────────────────────────────────────────────────────────────

function FixtureRow({ match: m, matchBase, isAdmin }: {
  match:     Match
  matchBase: string
  isAdmin:   boolean
}) {
  const isComplete = m.status === 'complete'
  const isLive     = m.status === 'live'
  const isBye      = m.status === 'bye'
  const isPending  = m.status === 'pending'
  const p1 = m.player1?.name ?? 'TBD'
  const p2 = m.player2?.name ?? (isBye ? 'BYE' : 'TBD')
  const p1Won = isComplete && m.winner_id === m.player1_id
  const p2Won = isComplete && m.winner_id === m.player2_id

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5 text-sm transition-colors',
      isComplete && 'bg-muted/30 border-border/40',
      isLive     && 'border-orange-400/60 bg-orange-50/80 dark:bg-orange-950/20',
      isPending  && 'bg-card border-border',
      isBye      && 'bg-muted/10 border-border/30 opacity-60',
    )}>
      {/* Top row: status chip + match# + score link */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide min-w-[30px] text-center',
          isComplete && 'bg-muted text-muted-foreground',
          isLive     && 'bg-orange-500 text-white animate-pulse',
          isPending  && 'bg-muted text-muted-foreground',
          isBye      && 'bg-muted text-muted-foreground',
        )}>
          {isLive ? 'Live' : isComplete ? 'Done' : isBye ? 'BYE' : 'vs'}
        </span>
        <span className="text-[10px] text-muted-foreground/60 font-mono">#{m.match_number}</span>
        <span className="flex-1" />
        {isAdmin && !isBye && (
          <Link
            href={`${matchBase}/${m.id}`}
            className="shrink-0 text-xs font-semibold text-orange-600 hover:text-orange-700 dark:hover:text-orange-400 transition-colors"
          >
            {isComplete ? 'Edit' : 'Score →'}
          </Link>
        )}
      </div>

      {/* Players + score — two-line layout, works on any width */}
      <div className="flex flex-col gap-0.5">
        {/* Player 1 row */}
        <div className="flex items-center gap-2">
          <span className={cn(
            'flex-1 font-medium leading-snug',
            p1Won && 'font-bold text-foreground',
            isComplete && !p1Won && 'text-muted-foreground',
          )}>
            {p1Won && <span className="mr-1 text-amber-500">🏆</span>}
            {p1}
          </span>
          {(isComplete || isLive) && (
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums w-5 text-right">
              {m.player1_games}
            </span>
          )}
        </div>

        {/* Player 2 row */}
        <div className="flex items-center gap-2">
          <span className={cn(
            'flex-1 font-medium leading-snug',
            p2Won && 'font-bold text-foreground',
            isComplete && !p2Won && 'text-muted-foreground',
          )}>
            {p2Won && <span className="mr-1 text-amber-500">🏆</span>}
            {p2}
          </span>
          {(isComplete || isLive) && (
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums w-5 text-right">
              {m.player2_games}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
