'use client'

/**
 * PublicMatchCard
 *
 * Compact, clickable card for use anywhere outside the main bracket view.
 * Used by: BracketView clicks are handled differently; this card is for
 * the Live Now strip (compact=true) and future summary panels.
 *
 * Anatomy (full, compact=false):
 *   ┌──────────────────────────────────────┐
 *   │  LIVE           Group A · Matchday 1 │
 *   │  🏆 [2] Alice       ────────── 2  11  8 │
 *   │     [5] Bob         ────────── 1   8  11 │
 *   │  [11–8] [8–11]                        │
 *   └──────────────────────────────────────┘
 */

import { cn }         from '@/lib/utils'
import type { Match, Game } from '@/lib/types'

interface Props {
  match:         Match
  onMatchClick?: (match: Match) => void
  compact?:      boolean     // used inside Live Now strip — tighter, no top label
  groupName?:    string | null
}

export function PublicMatchCard({ match, onMatchClick, compact = false, groupName }: Props) {
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'complete'
  const isBye      = match.status === 'bye'
  const isClickable = (isLive || isComplete) && !!onMatchClick

  const p1    = match.player1
  const p2    = match.player2
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
        'bg-card',
        isLive     && 'border-orange-400/60 shadow-sm shadow-orange-200/40 dark:shadow-orange-900/20',
        isComplete && 'border-border/60 bg-muted/10 dark:bg-card/60',
        match.status === 'pending' && 'border-border/40',
        isBye      && 'border-border/20 opacity-40',
        isClickable && 'cursor-pointer hover:border-orange-400 hover:shadow-md hover:shadow-orange-100/40 active:scale-[0.99]',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      )}
    >
      {/* Top row */}
      {!compact && (
        <div className="flex items-center justify-between mb-2.5">
          <StatusPill status={match.status} />
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            {groupName
              ? `${groupName} · MD ${match.round}`
              : (match.round_name ?? `Round ${match.round}`)
            }
          </span>
        </div>
      )}

      {/* Players */}
      <div className="flex flex-col gap-0.5">
        <PlayerRow
          player={p1} gamesWon={match.player1_games}
          isWinner={p1Won} isLoser={p2Won}
          showScore={isLive || isComplete}
          games={games} slot={1} playerId={match.player1_id}
          compact={compact}
        />
        <div className="border-b border-border/30 my-0.5" />
        <PlayerRow
          player={p2} gamesWon={match.player2_games}
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
            const g1 = g.winner_id === match.player1_id
            return (
              <span
                key={g.id}
                className={cn(
                  'text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border tabular-nums',
                  g1
                    ? 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800/60 dark:text-orange-400'
                    : 'bg-muted/40 border-border/40 text-muted-foreground',
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

      {/* Live bar */}
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

// ── StatusPill ──────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    live:     { label: 'LIVE',     cls: 'bg-orange-500 text-white' },
    complete: { label: 'FINAL',    cls: 'bg-muted text-muted-foreground' },
    pending:  { label: 'UPCOMING', cls: 'bg-muted/40 text-muted-foreground/70' },
    bye:      { label: 'BYE',      cls: 'bg-muted/30 text-muted-foreground/50' },
  }
  const { label, cls } = cfg[status] ?? cfg.pending
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5',
      cls,
    )}>
      {status === 'live' && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
      )}
      {label}
    </span>
  )
}

// ── PlayerRow ───────────────────────────────────────────────────────────────────

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
        <span
          className="shrink-0 text-amber-500 text-sm leading-none"
          style={{ width: 16, textAlign: 'center', opacity: isWinner ? 1 : 0 }}
          aria-hidden={!isWinner}
        >
          🏆
        </span>
        {player?.seed != null && (
          <span className="seed-badge shrink-0 text-[10px]">{player.seed}</span>
        )}
        <span className={cn(
          'truncate',
          compact ? 'text-sm' : 'text-base',
          !player?.name && 'text-muted-foreground/60 italic',
          isWinner && 'font-bold text-foreground',
          isLoser  && 'text-muted-foreground',
          !isWinner && !isLoser && 'font-medium text-foreground',
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
            'font-bold tabular-nums',
            compact ? 'text-sm w-4 text-center' : 'text-base w-5 text-center',
            isWinner && 'text-orange-600 dark:text-orange-400',
            isLoser  && 'text-muted-foreground',
          )}>
            {gamesWon}
          </span>
        )}
      </div>
    </div>
  )
}
