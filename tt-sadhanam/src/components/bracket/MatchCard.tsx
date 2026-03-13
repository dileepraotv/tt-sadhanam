'use client'

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
  const canScore = isAdmin && !isBye && !isComplete

  return (
    <Wrapper
      href={href}
      onClick={onClick}
      className={cn(
        'match-card w-full text-left block',
        (isComplete || isBye) && 'complete',
        isLive && 'live',
        (onClick || href) && 'cursor-pointer',
      )}
    >
      {/* Match header — round name + match# + status badge */}
      {!compact && (
        <div className="flex items-center justify-between px-3 pt-2 pb-1 gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest truncate min-w-0">
            {match.round_name ?? `Round ${match.round}`}
            {match.match_number && (
              <span className="ml-1.5 text-[9px] text-muted-foreground/50 font-mono">M{match.match_number}</span>
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {isLive && <LiveBadge />}
            {isBye && <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">BYE</span>}
            {isComplete && <span className="text-xs text-muted-foreground uppercase tracking-widest">Done</span>}
          </div>
        </div>
      )}

      {/* Player rows */}
      <div className={cn('px-3', compact ? 'py-1' : 'pb-2')}>
        <PlayerRow
          player={player1}
          games={player1_games}
          isWinner={p1IsWinner}
          isLoser={p2IsWinner}
          showScore={isLive || isComplete}
          compact={compact}
          sortedGames={sortedGames}
          playerSlot={1}
          playerId={match.player1_id}
        />
        <div className="border-b border-border/50 my-0.5" />
        <PlayerRow
          player={player2}
          games={player2_games}
          isWinner={p2IsWinner}
          isLoser={p1IsWinner}
          showScore={isLive || isComplete}
          compact={compact}
          sortedGames={sortedGames}
          playerSlot={2}
          playerId={match.player2_id}
        />
      </div>

      {/* Game score strip — always below both rows to avoid overlap */}
      {sortedGames.length > 0 && (isLive || isComplete) && !compact && (
        <div className="px-3 pb-2 flex items-center gap-1 flex-wrap">
          {sortedGames.map((g, i) => {
            const p1Won = g.winner_id === match.player1_id
            return (
              <span key={g.id ?? i} className={cn(
                'game-score-chip text-xs',
                p1Won
                  ? 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700/60'
                  : 'text-muted-foreground bg-muted dark:bg-muted/60 border border-border/50',
              )}>
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}

      {/* Live progress bar */}
      {isLive && (
        <div className="h-1 rounded-b-lg"
          style={{ background: 'linear-gradient(90deg, #F06321 0%, #F5853F 50%, #F06321 100%)',
                   animation: 'animate-pulse-slow 2s ease-in-out infinite' }} />
      )}

      {/* Admin score-entry strip — only for pending/live matches */}
      {canScore && (href || onClick) && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/40 bg-muted/30">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            {isLive ? 'Update score' : 'Enter score'}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: '#F06321' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Tap
          </span>
        </div>
      )}
    </Wrapper>
  )
}

// ── PlayerRow ──────────────────────────────────────────────────────────────────
// Mobile-first layout:
//   [🏆] [Seed] Name (truncate)  |  Score
// Score never overlaps name — it's absolutely fixed-width on the right.
function PlayerRow({
  player, games, isWinner, isLoser, showScore, compact,
  sortedGames, playerSlot, playerId,
}: {
  player?:     Match['player1'] | null
  games:       number
  isWinner:    boolean
  isLoser:     boolean
  showScore:   boolean
  compact:     boolean
  sortedGames: Game[]
  playerSlot:  1 | 2
  playerId:    string | null
}) {
  const name    = player?.name ?? (compact ? 'TBD' : 'TBD')
  const isEmpty = !player?.name

  return (
    <div className={cn(
      'flex items-center gap-2',
      compact ? 'py-1' : 'py-1.5',
    )}>
      {/* Left: trophy (fixed) + seed (fixed) + name (flex-1, truncates) */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">

        {/* Trophy — always occupies fixed width so names align between rows */}
        <WinnerTrophy show={isWinner} size="md" />

        {/* Seed badge */}
        {player?.seed && (
          <span className="seed-badge shrink-0">{player.seed}</span>
        )}

        {/* Name — truncates before touching score */}
        <span className={cn(
          'truncate leading-tight',
          compact ? 'text-sm' : 'text-[15px]',
          isEmpty      ? 'text-muted-foreground/60 italic text-sm' : '',
          isWinner     ? 'font-bold text-foreground' : '',
          isLoser      ? 'text-muted-foreground' : 'text-foreground',
        )}>
          {name}
        </span>
      </div>

      {/* Right: per-game points (compact only) + set count — fixed width, never wraps */}
      <div className="flex items-center gap-1 shrink-0">
        {compact && sortedGames.length > 0 && sortedGames.map((g, i) => {
          const score = playerSlot === 1 ? g.score1 : g.score2
          const won   = g.winner_id === playerId
          if (score === null) return null
          return (
            <span key={g.id ?? i} className={cn(
              'text-xs font-mono tabular-nums px-1 rounded',
              won ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
            )}>
              {score}
            </span>
          )
        })}

        {showScore && (
          <span className={cn(
            'font-bold tabular-nums min-w-[1.25rem] text-right',
            compact ? 'text-sm' : 'text-base',
            isWinner ? 'text-orange-600 dark:text-orange-400' : isLoser ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}>
            {games}
          </span>
        )}
      </div>
    </div>
  )
}
