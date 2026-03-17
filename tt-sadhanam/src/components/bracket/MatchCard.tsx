'use client'

/**
 * MatchCard — unified match display for ALL event types (admin bracket + RR panels).
 *
 * Design rules:
 *   Completed  → grey bg, winner row gets dark-navy pill border
 *   Live       → orange border + bg tint, live pulse bar
 *   Pending    → white bg-card, visible border
 *   Game chips → shown ONLY at bottom of card, never inline with player names
 *   Declared   → "Admin-declared result" note shown instead of game chips
 */

import { cn } from '@/lib/utils'
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

interface MatchCardProps {
  match:    Match
  compact?: boolean
  onClick?: () => void
  isAdmin?: boolean
  href?:    string
}

export function MatchCard({ match, compact = false, onClick, isAdmin, href }: MatchCardProps) {
  const { player1, player2, player1_games, player2_games, status, winner_id, games } = match

  const isLive     = status === 'live'
  const isComplete = status === 'complete'
  const isBye      = status === 'bye'

  const p1IsWinner = isComplete && winner_id === match.player1_id
  const p2IsWinner = isComplete && winner_id === match.player2_id

  const sortedGames: Game[] = games
    ? [...games].sort((a, b) => a.game_number - b.game_number).filter(g => g.score1 != null)
    : []

  // Declared win = complete but no real game scores recorded
  const isDeclared = isComplete && sortedGames.length === 0

  const Wrapper = href ? 'a' : onClick ? 'button' : 'div'

  return (
    <Wrapper
      href={href}
      onClick={onClick}
      className={cn(
        'match-card w-full text-left block rounded-xl border overflow-hidden transition-all',
        isLive     ? 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm' :
        isComplete ? 'border-border/40 bg-slate-100/80 dark:bg-slate-800/40' :
        isBye      ? 'border-border/20 bg-muted/10' :
                     'border-border bg-card',
        (onClick || href) && 'cursor-pointer hover:border-orange-400/50 hover:shadow-sm',
      )}
    >
      {/* Header row: round label + status badge */}
      {!compact && (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1 gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate min-w-0">
            {match.round_name ?? `Round ${match.round}`}
          </span>
          <MatchStatusBadge status={status} />
        </div>
      )}

      {/* Two-line player rows */}
      <div className={cn('px-3', compact ? 'pt-1.5 pb-1' : 'pb-2.5')}>
        <PlayerRow
          player={player1}
          gamesWon={player1_games}
          isWinner={p1IsWinner}
          isLoser={p2IsWinner}
          showScore={isLive || isComplete}
          compact={compact}
        />

        <div className={cn(
          'border-b my-0.5',
          isComplete ? 'border-border/20' : 'border-border/40',
        )} />

        <PlayerRow
          player={player2}
          gamesWon={player2_games}
          isWinner={p2IsWinner}
          isLoser={p1IsWinner}
          showScore={isLive || isComplete}
          compact={compact}
        />
      </div>

      {/* Game score chips — bottom of card only, not inline */}
      {sortedGames.length > 0 && (isLive || isComplete) && !compact && (
        <div className="px-3 pb-2.5 flex items-center gap-1 flex-wrap border-t border-border/20 pt-2">
          {sortedGames.map((g, i) => {
            const p1Won = g.winner_id === match.player1_id
            return (
              <span key={g.id ?? i} className={cn(
                'text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border',
                p1Won ? GAME_CHIP_WIN_CLS : GAME_CHIP_LOSS_CLS,
              )}>
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}

      {/* Declared win note — shown when no game chips */}
      {isDeclared && !compact && (
        <div className="px-3 pb-2.5 pt-1 border-t border-border/20">
          <span className="text-[10px] text-muted-foreground/60 italic">Admin-declared result</span>
        </div>
      )}

      {/* Live pulse bar */}
      {isLive && (
        <div className="h-0.5 bg-gradient-to-r from-orange-400/0 via-orange-500 to-orange-400/0 animate-pulse" />
      )}

      {/* Admin: score CTA for pending/live */}
      {isAdmin && !isBye && !isComplete && (href || onClick) && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/30 bg-muted/20">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {isLive ? 'Update score' : 'Enter score'}
          </span>
          <span className="text-[11px] font-bold text-orange-500">→</span>
        </div>
      )}
    </Wrapper>
  )
}

// ── PlayerRow ──────────────────────────────────────────────────────────────────

function PlayerRow({
  player, gamesWon, isWinner, isLoser, showScore, compact,
}: {
  player?:   Match['player1'] | null
  gamesWon:  number
  isWinner:  boolean
  isLoser:   boolean
  showScore: boolean
  compact:   boolean
}) {
  const name    = player?.name ?? 'TBD'
  const isEmpty = !player?.name

  return (
    <div className={cn(
      'flex items-center gap-2 px-1',
      compact ? 'py-1' : 'py-1.5',
      isWinner && WINNER_ROW_CLS,
    )}>
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        <WinnerTrophy show={isWinner} size="md" />
        {player?.seed && <span className="seed-badge shrink-0">{player.seed}</span>}
        <span className={cn(
          'truncate leading-tight',
          compact ? 'text-xs' : 'text-sm',
          isEmpty   ? 'text-muted-foreground/50 italic text-sm' : '',
          isWinner  ? WINNER_NAME_CLS : '',
          isLoser   ? LOSER_NAME_CLS  : '',
          !isWinner && !isLoser && !isEmpty ? 'font-semibold text-foreground' : '',
        )}>
          {name}
        </span>
      </div>

      {showScore && (
        <span className={cn(
          'tabular-nums shrink-0',
          compact ? 'text-xs w-5 text-right' : 'text-sm w-5 text-right',
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
