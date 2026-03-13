'use client'

/**
 * LeagueStandingsTable
 *
 * Shared standings table used by:
 *   - PublicPureRRView (public championship/tournament pages)
 *   - PureRRStage admin panel (already has its own inline version — this
 *     is the extracted reusable version for public pages)
 *
 * Columns: Rank | Player | MP | W | L | GW | GL | GD | PD
 *
 * Renders the #1 player in a subtle amber highlight.
 * Supports dark mode via Tailwind dark: variants.
 */

import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlayerStanding } from '@/lib/roundrobin/types'

interface Props {
  standings: PlayerStanding[]
  /** Number of rows highlighted as qualifiers (advances=true). Default: 0. */
  advanceCount?: number
  /** Label for the "advances" visual. Default: "Qualifies". */
  advanceLabel?: string
  /** Show the PD column (points difference). Default: true. */
  showPD?: boolean
  /** Show the GD column (game difference). Default: true. */
  showGD?: boolean
  /** Compact mode: tighter padding, smaller fonts. Default: false. */
  compact?: boolean
}

export function LeagueStandingsTable({
  standings,
  advanceCount = 0,
  advanceLabel = 'Qualifies',
  showPD  = true,
  showGD  = true,
  compact = false,
}: Props) {
  if (standings.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No standings yet — matches have not started.
      </div>
    )
  }

  const px = compact ? 'px-2' : 'px-3'
  const py = compact ? 'py-1.5' : 'py-2'

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className={cn(px, 'py-2 text-left text-xs font-bold text-muted-foreground w-8')}>#</th>
            <th className={cn(px, 'py-2 text-left text-xs font-bold text-muted-foreground')}>Player</th>
            <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-8')}>MP</th>
            <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-8')}>W</th>
            <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-8')}>L</th>
            <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-8')}>GW</th>
            <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-8')}>GL</th>
            {showGD && (
              <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-10')}>GD</th>
            )}
            {showPD && (
              <th className={cn(px, 'py-2 text-center text-xs font-bold text-muted-foreground w-10')}>PD</th>
            )}
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const isChampion = i === 0
            const advances   = advanceCount > 0 && i < advanceCount
            const isLastAdvancer = advanceCount > 0 && i === advanceCount - 1

            return (
              <tr
                key={s.playerId}
                className={cn(
                  'border-b border-border/50 transition-colors',
                  isChampion && 'bg-amber-50/40 dark:bg-amber-900/10',
                  advances && !isChampion && 'bg-emerald-50/20 dark:bg-emerald-900/5',
                  isLastAdvancer && 'border-b-2 border-b-emerald-300 dark:border-b-emerald-700/60',
                )}
              >
                {/* Rank */}
                <td className={cn(px, py, 'text-xs text-muted-foreground font-mono')}>
                  {i + 1}
                </td>

                {/* Player name */}
                <td className={cn(px, py)}>
                  <div className="flex items-center gap-2">
                    {isChampion && (
                      <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className={cn(
                      'font-medium',
                      compact ? 'text-xs' : 'text-sm',
                      isChampion && 'text-amber-700 dark:text-amber-400',
                    )}>
                      {s.playerName}
                    </span>
                    {s.playerSeed != null && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        [{s.playerSeed}]
                      </span>
                    )}
                    {advances && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide ml-auto">
                        {advanceLabel}
                      </span>
                    )}
                  </div>
                </td>

                {/* Stats */}
                <td className={cn(px, py, 'text-center text-xs text-muted-foreground')}>
                  {s.matchesPlayed}
                </td>
                <td className={cn(px, py, 'text-center text-xs font-bold text-emerald-600 dark:text-emerald-400')}>
                  {s.wins}
                </td>
                <td className={cn(px, py, 'text-center text-xs text-muted-foreground')}>
                  {s.losses}
                </td>
                <td className={cn(px, py, 'text-center text-xs text-muted-foreground')}>
                  {s.gamesWon}
                </td>
                <td className={cn(px, py, 'text-center text-xs text-muted-foreground')}>
                  {s.gamesLost}
                </td>

                {showGD && (
                  <td className={cn(px, py, 'text-center text-xs font-semibold',
                    s.gameDifference > 0 ? 'text-emerald-600 dark:text-emerald-400'
                    : s.gameDifference < 0 ? 'text-red-500'
                    : 'text-muted-foreground',
                  )}>
                    {s.gameDifference > 0 ? `+${s.gameDifference}` : s.gameDifference}
                  </td>
                )}

                {showPD && (
                  <td className={cn(px, py, 'text-center text-xs font-semibold',
                    s.pointsDifference > 0 ? 'text-emerald-600 dark:text-emerald-400'
                    : s.pointsDifference < 0 ? 'text-red-500'
                    : 'text-muted-foreground',
                  )}>
                    {s.pointsDifference > 0 ? `+${s.pointsDifference}` : s.pointsDifference}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
