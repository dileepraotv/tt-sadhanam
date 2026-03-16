'use client'

/**
 * PublicMatchCard
 *
 * Design rules:
 *   - Complete: grey bg, winner row has dark-navy pill border
 *   - Live:     orange border + tint + LiveBadge
 *   - Pending:  white bg-card, visible border
 *   - Scores:   games shown at BOTTOM only (not inline per-player)
 *   - Declared: "Admin-declared result" note when no game chips
 */

import { cn }         from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import {
  WinnerTrophy,
  MatchStatusBadge,
  WINNER_NAME_CLS,
  WINNER_SCORE_CLS,
  LOSER_NAME_CLS,
  LOSER_SCORE_CLS,
  WINNER_ROW_CLS,
  GAME_CHIP_WIN_CLS,
  GAME_CHIP_LOSS_CLS,
} from '@/components/shared/MatchUI'

interface Props {
  match:         Match
  onMatchClick?: (match: Match) => void
  compact?:      boolean
  groupName?:    string | null
}

export function PublicMatchCard({ match, onMatchClick, compact = false, groupName }: Props) {
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'complete'
  const isBye      = match.status === 'bye'
  const isClickable = isLive && !!onMatchClick  // only live opens detail

  const p1Won = isComplete && match.winner_id === match.player1_id
  const p2Won = isComplete && match.winner_id === match.player2_id

  const games: Game[] = match.games
    ? [...match.games].sort((a, b) => a.game_number - b.game_number).filter(g => g.score1 != null)
    : []

  const showChips  = games.length > 0 && (isLive || isComplete)
  const isDeclared = isComplete && games.length === 0

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={() => isClickable && onMatchClick?.(match)}
      onKeyDown={e => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) onMatchClick?.(match)
      }}
      className={cn(
        'relative rounded-xl border transition-all duration-150 overflow-hidden select-none',
        isLive     && 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm shadow-orange-200/40',
        isComplete && 'border-border/40 bg-slate-100/80 dark:bg-slate-800/40',
        match.status === 'pending' && 'border-border bg-card',
        isBye      && 'border-border/20 bg-muted/10',
        isClickable && 'cursor-pointer hover:border-orange-400 hover:shadow-md active:scale-[0.99]',
      )}
    >
      {/* Top row: status badge + round/group label */}
      {!compact && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
          <MatchStatusBadge status={match.status} />
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            {groupName
              ? `${groupName} · Round ${match.round}`
              : (match.round_name ?? `Round ${match.round}`)
            }
          </span>
        </div>
      )}

      {/* Players */}
      <div className={cn('flex flex-col gap-0', compact ? 'px-3 py-2' : 'px-4 pb-3')}>
        <PlayerRow
          player={match.player1} gamesWon={match.player1_games}
          isWinner={p1Won} isLoser={p2Won}
          showScore={isLive || isComplete}
          compact={compact}
        />
        <div className="border-b border-border/30 mx-1" />
        <PlayerRow
          player={match.player2} gamesWon={match.player2_games}
          isWinner={p2Won} isLoser={p1Won}
          showScore={isLive || isComplete}
          compact={compact}
        />
      </div>

      {/* Game chips — bottom of card only */}
      {showChips && !compact && (
        <div className="px-4 pb-3 pt-1 flex flex-wrap gap-1 border-t border-border/20">
          {games.map(g => {
            const p1Wins = g.winner_id === match.player1_id
            return (
              <span
                key={g.id}
                className={cn(
                  'text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border tabular-nums',
                  p1Wins ? GAME_CHIP_WIN_CLS : GAME_CHIP_LOSS_CLS,
                )}
              >
                {g.score1}–{g.score2}
              </span>
            )
          })}
          {isClickable && (
            <span className="ml-auto text-[10px] text-muted-foreground/50 self-end">
              tap for live score →
            </span>
          )}
        </div>
      )}

      {/* Declared win note */}
      {isDeclared && !compact && (
        <div className="px-4 pb-2.5 pt-1 border-t border-border/20">
          <span className="text-[10px] text-muted-foreground/60 italic">Admin-declared result</span>
        </div>
      )}

      {/* Live pulse bar */}
      {isLive && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, #F06321 50%, transparent 100%)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      )}
    </div>
  )
}

// ── PlayerRow ──────────────────────────────────────────────────────────────────

function PlayerRow({
  player, gamesWon, isWinner, isLoser, showScore, compact,
}: {
  player:    Match['player1'] | null
  gamesWon:  number
  isWinner:  boolean
  isLoser:   boolean
  showScore: boolean
  compact:   boolean
}) {
  return (
    <div className={cn(
      'flex items-center justify-between gap-2 px-1',
      compact ? 'py-1' : 'py-1.5',
      isWinner && WINNER_ROW_CLS,
    )}>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <WinnerTrophy show={isWinner} size="md" />
        {player?.seed != null && (
          <span className="seed-badge shrink-0 text-[10px]">{player.seed}</span>
        )}
        <span className={cn(
          'truncate',
          compact ? 'text-sm' : 'text-base',
          !player?.name && 'text-muted-foreground/60 italic',
          isWinner ? WINNER_NAME_CLS : '',
          isLoser  ? LOSER_NAME_CLS  : '',
          !isWinner && !isLoser && player?.name ? 'font-medium text-foreground' : '',
        )}>
          {player?.name ?? 'TBD'}
        </span>
      </div>

      {showScore && (
        <span className={cn(
          'tabular-nums shrink-0',
          compact ? 'text-sm w-4 text-center' : 'text-base w-5 text-center',
          isWinner ? WINNER_SCORE_CLS :
          isLoser  ? LOSER_SCORE_CLS  :
                     'font-semibold text-muted-foreground/60',
        )}>
          {gamesWon}
        </span>
      )}
    </div>
  )
}
