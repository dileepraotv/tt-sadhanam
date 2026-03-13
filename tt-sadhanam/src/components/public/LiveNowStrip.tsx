'use client'

/**
 * LiveNowStrip
 *
 * Pinned banner that appears at the top of the public view whenever at
 * least one match is currently live. Shows compact cards for every live
 * match, sorted by: RR group name then match_number.
 *
 * Works across all three tournament formats — filters only live matches
 * and resolves group name from rrGroups (if it's a round-robin match).
 *
 * Clicking a card opens the match detail dialog (via onMatchClick).
 */

import { cn }       from '@/lib/utils'
import type { Match } from '@/lib/types'
import type { RRGroup } from '@/lib/roundrobin/types'

interface Props {
  matches:      Match[]
  rrGroups:     RRGroup[]
  onMatchClick: (match: Match) => void
}

export function LiveNowStrip({ matches, rrGroups, onMatchClick }: Props) {
  if (!matches.length) return null

  // Build a group-id → name lookup
  const groupName = (groupId: string | null | undefined): string | null => {
    if (!groupId) return null
    return rrGroups.find(g => g.id === groupId)?.name ?? null
  }

  return (
    <div className="rounded-2xl border border-orange-300/60 dark:border-orange-800/50 bg-orange-50/80 dark:bg-orange-950/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-orange-200/60 dark:border-orange-800/40">
        <span className="live-dot h-2.5 w-2.5 shrink-0" />
        <span className="font-semibold text-sm text-orange-700 dark:text-orange-300 uppercase tracking-widest">
          On Court Now
        </span>
        <span className="ml-auto text-xs font-bold text-orange-500 dark:text-orange-400 tabular-nums">
          {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {/* Match cards — horizontal scroll on mobile */}
      <div className="p-3 flex gap-3 overflow-x-auto scrollbar-hide">
        {matches.map(m => (
          <LiveNowCard
            key={m.id}
            match={m}
            groupLabel={groupName(m.group_id)}
            onClick={() => onMatchClick(m)}
          />
        ))}
      </div>
    </div>
  )
}

// ── LiveNowCard ────────────────────────────────────────────────────────────────

function LiveNowCard({ match, groupLabel, onClick }: {
  match:       Match
  groupLabel:  string | null
  onClick:     () => void
}) {
  const p1    = match.player1
  const p2    = match.player2
  const p1won = match.player1_games > match.player2_games
  const p2won = match.player2_games > match.player1_games

  const games = match.games
    ? [...match.games].sort((a, b) => a.game_number - b.game_number)
    : []

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-none w-56 rounded-xl bg-card border border-orange-300/50 dark:border-orange-800/40',
        'p-3 text-left transition-all duration-150',
        'hover:border-orange-400 hover:shadow-md hover:shadow-orange-100/60 dark:hover:shadow-orange-900/20',
        'active:scale-[0.98] cursor-pointer',
      )}
    >
      {/* Context label */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500 dark:text-orange-400">
          {groupLabel ?? (match.round_name ?? `Round ${match.round}`)}
        </span>
        {/* Live pulse dot */}
        <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
      </div>

      {/* Players + set score */}
      <div className="flex flex-col gap-0.5 mb-2">
        <LivePlayerRow
          name={p1?.name ?? 'TBD'}
          seed={p1?.seed}
          score={match.player1_games}
          isLeading={p1won}
        />
        <LivePlayerRow
          name={p2?.name ?? 'TBD'}
          seed={p2?.seed}
          score={match.player2_games}
          isLeading={p2won}
        />
      </div>

      {/* Per-game chips */}
      {games.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {games.map(g => {
            const g1 = g.winner_id === match.player1_id
            return (
              <span
                key={g.id}
                className={cn(
                  'text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border tabular-nums',
                  g1
                    ? 'bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-400'
                    : 'bg-muted/50 border-border/40 text-muted-foreground',
                )}
              >
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}
    </button>
  )
}

function LivePlayerRow({
  name, seed, score, isLeading,
}: {
  name:      string
  seed:      number | null | undefined
  score:     number
  isLeading: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {seed != null && (
          <span className="seed-badge shrink-0 text-[9px]">{seed}</span>
        )}
        <span className={cn(
          'truncate text-sm',
          isLeading ? 'font-bold text-foreground' : 'text-muted-foreground',
        )}>
          {name}
        </span>
      </div>
      <span className={cn(
        'font-display font-bold text-sm tabular-nums shrink-0 w-4 text-center',
        isLeading ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
      )}>
        {score}
      </span>
    </div>
  )
}
