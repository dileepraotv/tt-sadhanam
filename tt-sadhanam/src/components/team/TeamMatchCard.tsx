'use client'

/**
 * TeamMatchCard
 *
 * Public-facing card for a team match fixture.
 *
 * Shows:
 *   - Team A vs Team B names with colour chips
 *   - Aggregate score (team_a_score – team_b_score)
 *   - Status indicator (live dot / Done badge)
 *   - Expandable submatch list (5 individual matches)
 *   - Per-submatch game scores if available
 *
 * Used by the public championship event page and standalone tournament page
 * for format_type = 'team_league'.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TeamMatch, TeamMatchSubmatch, Match } from '@/lib/types'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { MatchStatusBadge } from '@/components/shared/MatchUI'

interface Props {
  teamMatch:    TeamMatch
  /** If supplied, each submatch shows its game scores inline. */
  subMatchScores?: Map<string, Match>  // match_id → scoring Match row
}

export function TeamMatchCard({ teamMatch, subMatchScores }: Props) {
  const [expanded, setExpanded] = useState(teamMatch.status === 'live')

  const teamA  = teamMatch.team_a
  const teamB  = teamMatch.team_b
  const aScore = teamMatch.team_a_score
  const bScore = teamMatch.team_b_score
  const isLive = teamMatch.status === 'live'
  const isDone = teamMatch.status === 'complete'
  const aWon   = isDone && teamMatch.winner_team_id === teamMatch.team_a_id
  const bWon   = isDone && teamMatch.winner_team_id === teamMatch.team_b_id

  const submatches: TeamMatchSubmatch[] = (teamMatch.submatches ?? [])
    .slice()
    .sort((a, b) => a.match_order - b.match_order)

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-colors',
        isLive ? 'border-orange-400 dark:border-orange-500 bg-orange-50/30 dark:bg-orange-950/10' : 'border-border',
        // Standardized: opacity-40 for done (was opacity-90 — too subtle)
        isDone && 'opacity-40',
      )}
    >
      {/* Header row — click to expand */}
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        {/* Expand chevron */}
        <span className="shrink-0 text-muted-foreground">
          {expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />
          }
        </span>

        {/* Team A */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {teamA?.color && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamA.color }} />
          )}
          <span className={cn(
            'font-semibold text-sm truncate',
            aWon ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-foreground',
            bWon && 'font-normal text-muted-foreground',
          )}>
            {teamA?.short_name ?? teamA?.name ?? '?'}
          </span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-2 shrink-0">
          <MatchStatusBadge status={teamMatch.status} />
          <span className={cn(
            'font-mono font-bold text-lg tabular-nums',
            aWon ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
          )}>
            {aScore}
          </span>
          <span className="text-muted-foreground text-sm">–</span>
          <span className={cn(
            'font-mono font-bold text-lg tabular-nums',
            bWon ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
          )}>
            {bScore}
          </span>
        </div>

        {/* Team B */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className={cn(
            'font-semibold text-sm truncate text-right',
            bWon ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-foreground',
            aWon && 'font-normal text-muted-foreground',
          )}>
            {teamB?.short_name ?? teamB?.name ?? '?'}
          </span>
          {teamB?.color && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamB.color }} />
          )}
        </div>
      </button>

      {/* Expanded submatch list */}
      {expanded && submatches.length > 0 && (
        <div className="border-t border-border/50 bg-muted/10">
          {submatches.map((sm, i) => {
            const scoringMatch = sm.match_id ? subMatchScores?.get(sm.match_id) : null
            const smDone  = scoringMatch?.status === 'complete'
            const smLive  = scoringMatch?.status === 'live'
            // winner_id is null for team_submatches — use game counts instead
            const smP1Games = scoringMatch?.player1_games ?? 0
            const smP2Games = scoringMatch?.player2_games ?? 0
            const smAWon  = smDone && smP1Games > smP2Games
            const smBWon  = smDone && smP2Games > smP1Games

            return (
              <div
                key={sm.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-2.5',
                  i < submatches.length - 1 && 'border-b border-border/30',
                )}
              >
                {/* Label */}
                <span className="text-xs text-muted-foreground w-16 shrink-0 font-medium">
                  {sm.label}
                </span>

                {/* Player A */}
                <span className={cn(
                  'text-xs flex-1 min-w-0 truncate',
                  smAWon ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-foreground',
                  smBWon && 'font-normal text-muted-foreground',
                )}>
                  {sm.player_a_name ?? '—'}
                </span>

                {/* Game score */}
                {scoringMatch ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {smLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
                    <span className={cn(
                      'font-mono text-xs tabular-nums font-semibold',
                      smAWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
                    )}>
                      {scoringMatch.player1_games}
                    </span>
                    <span className="text-muted-foreground text-xs">–</span>
                    <span className={cn(
                      'font-mono text-xs tabular-nums font-semibold',
                      smBWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
                    )}>
                      {scoringMatch.player2_games}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/40 font-mono shrink-0">–</span>
                )}

                {/* Player B */}
                <span className={cn(
                  'text-xs flex-1 min-w-0 truncate text-right',
                  smBWon ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-foreground',
                  smAWon && 'font-normal text-muted-foreground',
                )}>
                  {sm.player_b_name ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
