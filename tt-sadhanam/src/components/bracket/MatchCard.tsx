'use client'

/**
 * MatchCard — unified match display for ALL event types.
 *
 * Layout (two-line, always):
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ Round name                          LIVE / Done │
 *   │ [🏆] [Seed] Player 1 name ·····    3  11 11  9 │  ← sets won + per-game scores
 *   │ ─────────────────────────────────────────────── │
 *   │      [Seed] Player 2 name ·····    1   9  8 11 │
 *   │ 11–9  8–11  11–8  ← game chips (complete only) │
 *   └─────────────────────────────────────────────────┘
 *
 * Completed matches: greyed (opacity-60), game scores always visible.
 * Live matches: orange accent border + live pulse bar.
 * Pending: normal card, "Enter score" CTA if admin.
 */

import { cn } from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { WinnerTrophy, matchStatusClasses } from '@/components/shared/MatchUI'

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
    ? [...games].sort((a, b) => a.game_number - b.game_number)
    : []

  const Wrapper = href ? 'a' : onClick ? 'button' : 'div'

  return (
    <Wrapper
      href={href}
      onClick={onClick}
      className={cn(
        'match-card w-full text-left block rounded-xl border overflow-hidden transition-all',
        isLive     ? 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm' :
        isComplete ? 'border-border/40 bg-muted/5 opacity-40' :
        isBye      ? 'border-border/20 bg-muted/5 opacity-50' :
                     'border-border bg-card',
        (onClick || href) && 'cursor-pointer hover:border-orange-400/50 hover:shadow-sm',
      )}
    >
      {/* Header row: round label + status */}
      {!compact && (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1 gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate min-w-0">
            {match.round_name ?? `Round ${match.round}`}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {isLive     && <LiveBadge />}
            {isBye      && <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-semibold uppercase">BYE</span>}
            {isComplete && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">✓ Done</span>}
          </div>
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
          sortedGames={sortedGames}
          playerSlot={1}
          playerId={match.player1_id}
        />

        {/* Divider */}
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
          sortedGames={sortedGames}
          playerSlot={2}
          playerId={match.player2_id}
        />
      </div>

      {/* Game score chips — always shown for complete/live, no need to edit to see */}
      {sortedGames.length > 0 && (isLive || isComplete) && !compact && (
        <div className="px-3 pb-2.5 flex items-center gap-1 flex-wrap">
          {sortedGames.map((g, i) => {
            const p1Won = g.winner_id === match.player1_id
            return (
              <span key={g.id ?? i} className={cn(
                'text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border',
                p1Won
                  ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/40'
                  : 'text-muted-foreground bg-muted/60 border-border/40',
              )}>
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}

      {/* Live pulse bar */}
      {isLive && (
        <div className="h-0.5 bg-gradient-to-r from-orange-400/0 via-orange-500 to-orange-400/0 animate-pulse" />
      )}

      {/* Admin: score CTA for pending/live when using href/click nav */}
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

// ── PlayerRow ─────────────────────────────────────────────────────────────────
// Two-column layout:
//   LEFT:  [🏆] [seed] Name (truncates)
//   RIGHT: per-game individual scores + sets won (fixed width)

function PlayerRow({
  player, gamesWon, isWinner, isLoser, showScore, compact,
  sortedGames, playerSlot, playerId,
}: {
  player?:     Match['player1'] | null
  gamesWon:    number
  isWinner:    boolean
  isLoser:     boolean
  showScore:   boolean
  compact:     boolean
  sortedGames: Game[]
  playerSlot:  1 | 2
  playerId:    string | null
}) {
  const name    = player?.name ?? 'TBD'
  const isEmpty = !player?.name

  return (
    <div className={cn('flex items-center gap-2', compact ? 'py-1' : 'py-1.5')}>
      {/* Left: trophy + seed + name */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        <WinnerTrophy show={isWinner} size="md" />
        {player?.seed && <span className="seed-badge shrink-0">{player.seed}</span>}
        <span className={cn(
          'truncate leading-tight',
          compact ? 'text-sm' : 'text-[15px]',
          isEmpty  ? 'text-muted-foreground/50 italic text-sm' : '',
          isWinner ? 'font-bold text-foreground' : '',
          isLoser  ? 'font-normal text-muted-foreground' : (!isWinner ? 'font-semibold text-foreground' : ''),
        )}>
          {name}
        </span>
      </div>

      {/* Right: per-game scores (shown for complete/live) + sets won */}
      <div className="flex items-center gap-1 shrink-0">
        {showScore && sortedGames.length > 0 && sortedGames.map((g, i) => {
          const score = playerSlot === 1 ? g.score1 : g.score2
          const won   = g.winner_id === playerId
          if (score === null || score === undefined) return null
          return (
            <span key={g.id ?? i} className={cn(
              'text-xs font-mono tabular-nums w-6 text-center rounded',
              won
                ? 'font-bold text-orange-600 dark:text-orange-400'
                : 'text-muted-foreground/60',
            )}>
              {score}
            </span>
          )
        })}
        {showScore && (
          <span className={cn(
            'font-bold tabular-nums w-5 text-right',
            compact ? 'text-sm' : 'text-base',
            isWinner ? 'text-emerald-600 dark:text-emerald-400' :
            isLoser  ? 'text-muted-foreground/50' :
                       'text-muted-foreground/60',
          )}>
            {gamesWon}
          </span>
        )}
      </div>
    </div>
  )
}
