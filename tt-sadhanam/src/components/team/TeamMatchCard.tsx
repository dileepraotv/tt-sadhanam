'use client'

/**
 * TeamMatchCard — public-facing team match fixture card.
 *
 * Winner score = bold dark foreground. Loser score = muted.
 * Winner row gets dark-navy pill border.
 * Winner name = bold dark. Loser name = muted normal.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TeamMatch, TeamMatchSubmatch, Match } from '@/lib/types'
import { MatchStatusBadge, WINNER_ROW_CLS } from '@/components/shared/MatchUI'

interface Props {
  teamMatch:       TeamMatch
  subMatchScores?: Map<string, Match>
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
        isLive  ? 'border-orange-400 dark:border-orange-500 bg-orange-50/30 dark:bg-orange-950/10' :
        isDone  ? 'border-border/40 bg-slate-100/80 dark:bg-slate-800/40' :
                  'border-border bg-card',
      )}
    >
      {/* Header row — click to expand */}
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full px-4 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        {/* Team A row */}
        <div className={cn(
          'flex items-center gap-2 px-1 py-0.5 rounded',
          aWon && WINNER_ROW_CLS,
        )}>
          {teamA?.color && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-0.5" style={{ background: teamA.color }} />
          )}
          <span className={cn(
            'text-sm flex-1 min-w-0 truncate',
            aWon ? 'font-bold text-foreground' :
            bWon ? 'font-normal text-muted-foreground' :
                   'font-semibold text-foreground',
          )}>
            {teamA?.short_name ?? teamA?.name ?? '?'}
          </span>
          <span className={cn(
            'font-mono font-bold text-base tabular-nums shrink-0',
            aWon ? 'text-foreground' :
            bWon ? 'text-muted-foreground/50' :
                   'text-muted-foreground/70',
          )}>
            {aScore}
          </span>
        </div>

        {/* Divider + status */}
        <div className="flex items-center gap-2 my-1.5 ml-1">
          <div className="flex-1 border-t border-border/30" />
          <MatchStatusBadge status={teamMatch.status} />
          <div className="flex-1 border-t border-border/30" />
        </div>

        {/* Team B row */}
        <div className={cn(
          'flex items-center gap-2 px-1 py-0.5 rounded',
          bWon && WINNER_ROW_CLS,
        )}>
          {teamB?.color && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-0.5" style={{ background: teamB.color }} />
          )}
          <span className={cn(
            'text-sm flex-1 min-w-0 truncate',
            bWon ? 'font-bold text-foreground' :
            aWon ? 'font-normal text-muted-foreground' :
                   'font-semibold text-foreground',
          )}>
            {teamB?.short_name ?? teamB?.name ?? '?'}
          </span>
          <span className={cn(
            'font-mono font-bold text-base tabular-nums shrink-0',
            bWon ? 'text-foreground' :
            aWon ? 'text-muted-foreground/50' :
                   'text-muted-foreground/70',
          )}>
            {bScore}
          </span>
        </div>

        {/* Expand hint */}
        <div className="flex items-center justify-end mt-1.5">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Expanded submatch list */}
      {expanded && submatches.length > 0 && (
        <div className="border-t border-border/50 bg-muted/10">
          {submatches.map((sm, i) => {
            const scoringMatch = sm.match_id ? subMatchScores?.get(sm.match_id) : null
            const smDone  = scoringMatch?.status === 'complete'
            const smLive  = scoringMatch?.status === 'live'
            const smP1G   = scoringMatch?.player1_games ?? 0
            const smP2G   = scoringMatch?.player2_games ?? 0
            const smAWon  = smDone && smP1G > smP2G
            const smBWon  = smDone && smP2G > smP1G

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
                  smAWon ? 'font-bold text-foreground' :
                  smBWon ? 'font-normal text-muted-foreground' :
                           'text-foreground',
                )}>
                  {sm.player_a_name ?? '—'}
                </span>

                {/* Score */}
                {scoringMatch ? (
                  <div className="flex items-center gap-1 shrink-0">
                    {smLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
                    <span className={cn(
                      'font-mono text-xs tabular-nums font-bold',
                      smAWon ? 'text-foreground' : 'text-muted-foreground/50',
                    )}>
                      {smP1G}
                    </span>
                    <span className="text-muted-foreground text-xs">–</span>
                    <span className={cn(
                      'font-mono text-xs tabular-nums font-bold',
                      smBWon ? 'text-foreground' : 'text-muted-foreground/50',
                    )}>
                      {smP2G}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/40 font-mono shrink-0 w-8 text-center">–</span>
                )}

                {/* Player B */}
                <span className={cn(
                  'text-xs flex-1 min-w-0 truncate text-right',
                  smBWon ? 'font-bold text-foreground' :
                  smAWon ? 'font-normal text-muted-foreground' :
                           'text-foreground',
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
