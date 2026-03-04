import { cn } from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import { LiveBadge } from '@/components/shared/LiveBadge'

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
        'match-card w-full text-left block',
        (isComplete || isBye) && 'complete',
        isLive && 'live',
        (onClick || href) && 'cursor-pointer',
      )}
    >
      {/* Match header */}
      {!compact && (
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest truncate">
              {match.round_name ?? `Round ${match.round}`}
            </span>
            {match.match_number && (
              <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">M#{match.match_number}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
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

      {/* Full game score strip */}
      {sortedGames.length > 0 && (isLive || isComplete) && !compact && (
        <div className="px-3 pb-2.5 flex items-center gap-1.5 flex-wrap">
          {sortedGames.map((g, i) => {
            const p1Won = g.winner_id === match.player1_id
            return (
              <span key={g.id ?? i} className={cn(
                'game-score-chip',
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

      {/* Live bar */}
      {isLive && (
        <div className="h-1 rounded-b-lg"
          style={{ background: 'linear-gradient(90deg, #F06321 0%, #F5853F 50%, #F06321 100%)',
                   animation: 'animate-pulse-slow 2s ease-in-out infinite' }} />
      )}
    </Wrapper>
  )
}

// ── PlayerRow ──────────────────────────────────────────────────────────────────
// Layout matches the reference screenshot:
//   [🏆] [Seed] Name ................. [score]
// Trophy is always in a fixed slot — absent = just invisible space.
// This keeps the name column perfectly aligned between the two rows.
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
  const isEmpty = !player

  return (
    <div className={cn(
      'flex items-center justify-between gap-2',
      compact ? 'py-1' : 'py-1.5',
    )}>
      {/* Left: trophy slot (always present) + seed + name */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">

        {/* Trophy — fixed 16px slot, present for both rows to keep name col aligned */}
        <span
          className="shrink-0 text-amber-500 text-sm leading-none"
          style={{ width: 16, textAlign: 'center', opacity: isWinner ? 1 : 0 }}
          aria-hidden={!isWinner}
        >
          🏆
        </span>

        {/* Seed badge */}
        {player?.seed && (
          <span className="seed-badge shrink-0">{player.seed}</span>
        )}

        {/* Name */}
        <span className={cn(
          'truncate',
          compact ? 'text-sm' : 'text-base',
          (!player?.name) ? 'text-muted-foreground/60 italic' : '',
          isWinner   ? 'font-bold' : '',
          isLoser    ? 'text-muted-foreground' : '',
        )}>
          {player?.name ?? 'TBD'}
        </span>
      </div>

      {/* Right: per-game scores (compact) + set score */}
      <div className="flex items-center gap-1.5 shrink-0">
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
            'font-bold tabular-nums',
            compact ? 'text-sm' : 'text-base',
            isWinner ? 'text-orange-600 dark:text-orange-400' : isLoser ? 'text-muted-foreground' : '',
          )}>
            {games}
          </span>
        )}
      </div>
    </div>
  )
}
