'use client'
// cache-bust: 1773800313

/**
 * GroupStandingsTable
 *
 * Full group view: tab picker → standings table → matchday fixtures.
 * Used by both SingleRRStage and MultiStagePanel (Stage 1).
 * Read-only display; scoring links are passed via matchBase.
 */

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { MatchCard } from '@/components/bracket/MatchCard'
import { cn } from '@/lib/utils'
import type { Match } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'

// Inline winner trophy (avoids importing full WinnerTrophy to keep bundle lean)
function WinnerTrophyInline({ show }: { show: boolean }) {
  return (
    <span className="inline-flex items-center justify-center shrink-0 w-4" style={{ opacity: show ? 1 : 0 }}>
      <svg className="h-3 w-3 text-amber-500 fill-current" viewBox="0 0 24 24"><path d="M12 2C9.79 2 8 3.79 8 6v2H6c-1.1 0-2 .9-2 2v2c0 2.97 2.13 5.44 5 5.9V20H7v2h10v-2h-2v-2.1c2.87-.46 5-2.93 5-5.9V10c0-1.1-.9-2-2-2h-2V6c0-2.21-1.79-4-4-4zm0 2c1.1 0 2 .9 2 2v2h-4V6c0-1.1.9-2 2-2zm6 6v2c0 2.21-1.79 4-4 4h-4c-2.21 0-4-1.79-4-4v-2h12z"/></svg>
    </span>
  )
}

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
      {/* Group selector cards — show group name + player dots */}
      <div className="flex flex-wrap gap-2">
        {standings.map((gs, idx) => {
          const played = gs.standings.some(s => s.matchesPlayed > 0)
          const done   = gs.standings.length > 0 && gs.standings.every(s =>
            s.matchesPlayed === gs.standings.length - 1,
          )
          const isActive = activeIdx === idx
          return (
            <button
              key={gs.group.id}
              onClick={() => setActiveIdx(idx)}
              className={cn(
                'flex flex-col gap-2 px-4 py-3 rounded-xl border text-left transition-all min-w-[140px]',
                isActive
                  ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-200/40 dark:shadow-orange-900/20'
                  : 'bg-card text-foreground border-border hover:border-orange-400 hover:shadow-sm',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{gs.group.name}</span>
                {done && <span className={cn('text-[10px] font-bold', isActive ? 'text-white/80' : 'text-emerald-500')}>✓ Done</span>}
                {!done && played && <span className={cn('h-2 w-2 rounded-full shrink-0', isActive ? 'bg-white/60' : 'bg-orange-400 animate-pulse')} />}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {gs.standings.slice(0, 6).map((s, si) => (
                  <span key={s.playerId} title={s.playerName}
                    className={cn(
                      'text-[10px] font-medium truncate max-w-[70px]',
                      isActive ? 'text-white/90' : 'text-muted-foreground',
                    )}>
                    <span className={cn('font-mono opacity-60 mr-0.5', isActive ? 'text-white/60' : '')}>{si + 1}.</span>{s.playerName.split(' ')[0]}
                  </span>
                ))}
                {gs.standings.length > 6 && (
                  <span className={cn('text-[10px]', isActive ? 'text-white/60' : 'text-muted-foreground/50')}>
                    +{gs.standings.length - 6}
                  </span>
                )}
              </div>
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
                  { h: 'PD', cls: 'text-center' },
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
                    <td className="py-2.5 px-2 text-center tabular-nums">
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
              // Sort: live first, then pending, then complete (greyed at bottom)
              const sortedDay = [...dayMatches].sort((a, b) => {
                const order = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
                return order(a.status) - order(b.status)
              })
              const allDone = dayMatches.every(m => m.status === 'complete' || m.status === 'bye')
              const liveCount = dayMatches.filter(m => m.status === 'live').length
              return (
                <div key={day}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-orange-600">Round {day}</span>
                    {liveCount > 0 && <span className="text-[10px] font-bold text-orange-500 animate-pulse">● LIVE</span>}
                    {allDone && <span className="text-[10px] text-muted-foreground">✓ complete</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {sortedDay
                      .filter(m => m.status !== 'pending' || m.player1_id || m.player2_id)
                      .map(m => (
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
// Score/Edit button navigates to the full match scoring page (same as all other
// event types — KO bracket, team events, etc.). This gives Singles RR the
// identical validated scoring UI used everywhere else in the app.

function FixtureRow({ match: m, matchBase, isAdmin }: {
  match:     Match
  matchBase: string
  isAdmin:   boolean
}) {
  const isBye      = m.status === 'bye'
  const isComplete = m.status === 'complete'
  const isLive     = m.status === 'live'
  const p1         = m.player1
  const p2         = m.player2
  const p1Won      = isComplete && m.winner_id === m.player1_id
  const p2Won      = isComplete && m.winner_id === m.player2_id
  const games      = m.games ? [...m.games].sort((a, b) => a.game_number - b.game_number) : []
  const isDeclared = isComplete && games.length === 0

  // Determine the group index for the back-link so the full match page returns
  // to the correct group tab (matchBase already encodes cid/eid).
  const scoreHref = m.id ? `${matchBase}/${m.id}` : undefined

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-all',
      isLive     ? 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm' :
      isComplete ? 'border-border/40 bg-[#BEBEBE]/60 dark:bg-[#5a5a5a]/40' :
      isBye      ? 'border-border/20 bg-muted/5' :
                   'border-border bg-card',
    )}>
      {/* Two-line player rows */}
      <div className="px-3 py-2">
        {/* Player 1 row */}
        <div className={cn(
          'flex items-center gap-2 py-1 px-1 rounded',
          p1Won && 'border border-blue-900/35 bg-blue-950/5 dark:bg-blue-900/10 dark:border-blue-700/40',
        )}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <WinnerTrophyInline show={p1Won} />
            <span className={cn(
              'truncate text-xs',
              p1Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p1?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p1Won ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )} style={{fontSize:'12px'}}>
              {m.player1_games}
            </span>
          )}
          {/* Score/Edit → navigates to the full match page, same as KO/team events */}
          {isAdmin && !isBye && scoreHref && (
            <Link
              href={scoreHref}
              className={cn(
                'text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap ml-1',
                isComplete
                  ? 'text-slate-600 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30',
              )}
            >
              {isComplete ? 'Edit' : 'Score'}
            </Link>
          )}
        </div>

        {/* Divider */}
        <div className="border-b border-border/30 mx-1 my-0.5" />

        {/* Player 2 row */}
        <div className={cn(
          'flex items-center gap-2 py-1 px-1 rounded',
          p2Won && 'border border-blue-900/35 bg-blue-950/5 dark:bg-blue-900/10 dark:border-blue-700/40',
        )}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <WinnerTrophyInline show={p2Won} />
            <span className={cn(
              'truncate text-xs',
              p2Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p2?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p2Won ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )} style={{fontSize:'12px'}}>
              {m.player2_games}
            </span>
          )}
          {isAdmin && !isBye && <span className="w-[42px] ml-1 shrink-0" />}
        </div>
      </div>

      {/* Game chips */}
      {(isComplete || isLive) && games.length > 0 && (
        <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1 border-t border-border/20">
          {games.map((g, i) => {
            const p1WonGame = g.winner_id === m.player1_id
            return (
              <span key={i} className={cn(
                'text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border',
                p1WonGame
                  ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/40'
                  : 'text-muted-foreground bg-muted/60 border-border/40',
              )}>
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}

      {/* Declared win note */}
      {isDeclared && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20">
          <span className="text-[10px] text-muted-foreground/60 italic">Admin-declared result</span>
        </div>
      )}

      {/* Live pulse bar */}
      {isLive && <div className="h-0.5 bg-gradient-to-r from-orange-400/0 via-orange-500 to-orange-400/0 animate-pulse" />}
    </div>
  )
}

