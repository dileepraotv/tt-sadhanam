'use client'

/**
 * PublicMatchCard
 *
 * Compact, clickable card for public audience pages.
 * Used by the public RR/KO/multi-stage bracket views.
 *
 * Design rules (from MatchUI canonical tokens):
 *   - Winner: WINNER_NAME_CLS / WINNER_SCORE_CLS (emerald — same as admin card)
 *   - Loser:  LOSER_NAME_CLS  / LOSER_SCORE_CLS  (muted)
 *   - Complete: opacity-40 (same as admin MatchCard — standardized dimming)
 *   - Live:  orange border + bg tint + LiveBadge (matches admin card)
 *   - Trophy: <WinnerTrophy /> component (never emoji — cross-platform issue)
 *   - Status pill: <MatchStatusBadge /> shared component
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
  const isClickable = (isLive || isComplete) && !!onMatchClick

  const p1Won = isComplete && match.winner_id === match.player1_id
  const p2Won = isComplete && match.winner_id === match.player2_id

  const games: Game[] = match.games
    ? [...match.games].sort((a, b) => a.game_number - b.game_number)
    : []

  const showChips = games.length > 0 && (isLive || isComplete)

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
        // Live: orange border + bg tint (matches admin MatchCard)
        isLive     && 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm shadow-orange-200/40 dark:shadow-orange-900/20',
        // Complete: opacity-40 (standardized — was "no opacity" in public card)
        isComplete && 'border-border/40 bg-card opacity-40',
        // Pending
        match.status === 'pending' && 'border-border/40 bg-card',
        // Bye
        isBye      && 'border-border/20 opacity-50',
        isClickable && 'cursor-pointer hover:border-orange-400 hover:shadow-md hover:shadow-orange-100/40 active:scale-[0.99]',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      )}
    >
      {/* Top row: status badge + round/group label */}
      {!compact && (
        <div className="flex items-center justify-between mb-2.5">
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
      <div className="flex flex-col gap-0.5">
        <PlayerRow
          player={match.player1} gamesWon={match.player1_games}
          isWinner={p1Won} isLoser={p2Won}
          showScore={isLive || isComplete}
          games={games} slot={1} playerId={match.player1_id}
          compact={compact}
        />
        <div className="border-b border-border/30 my-0.5" />
        <PlayerRow
          player={match.player2} gamesWon={match.player2_games}
          isWinner={p2Won} isLoser={p1Won}
          showScore={isLive || isComplete}
          games={games} slot={2} playerId={match.player2_id}
          compact={compact}
        />
      </div>

      {/* Per-game chips */}
      {showChips && !compact && (
        <div className="mt-2.5 flex flex-wrap gap-1">
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
              tap for details →
            </span>
          )}
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
  player, gamesWon, isWinner, isLoser, showScore, games, slot, playerId, compact,
}: {
  player:    Match['player1'] | null
  gamesWon:  number
  isWinner:  boolean
  isLoser:   boolean
  showScore: boolean
  games:     Game[]
  slot:      1 | 2
  playerId:  string | null
  compact:   boolean
}) {
  return (
    <div className={cn(
      'flex items-center justify-between gap-2',
      compact ? 'py-1' : 'py-1.5',
    )}>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {/* WinnerTrophy replaces 🏆 emoji — consistent Lucide icon, fixed width */}
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

      <div className="flex items-center gap-1.5 shrink-0">
        {compact && games.map(g => {
          const score = slot === 1 ? g.score1 : g.score2
          const won   = g.winner_id === playerId
          if (score === null) return null
          return (
            <span
              key={g.id}
              className={cn(
                'text-xs font-mono tabular-nums w-5 text-center',
                won ? 'font-bold text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
              )}
            >
              {score}
            </span>
          )
        })}
        {showScore && (
          <span className={cn(
            'tabular-nums',
            compact ? 'text-sm w-4 text-center' : 'text-base w-5 text-center',
            isWinner ? WINNER_SCORE_CLS :
            isLoser  ? LOSER_SCORE_CLS  :
                       'font-semibold text-muted-foreground/60',
          )}>
            {gamesWon}
          </span>
        )}
      </div>
    </div>
  )
}
