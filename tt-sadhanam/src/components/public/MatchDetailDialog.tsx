'use client'

/**
 * MatchDetailDialog
 *
 * Read-only match detail modal for the public audience view.
 * Opens when a spectator clicks any live or completed match card.
 *
 * Shows:
 *   • Orange gradient header with player names + set score
 *   • Live / Final status chip
 *   • Per-game breakdown rows with winner highlight + deuce badge
 *   • Loading skeleton while games load on demand
 *
 * Used by both the KO bracket and the RR fixture rows.
 */

import { X, Trophy } from 'lucide-react'
import { cn }         from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import { LiveBadge }  from '@/components/shared/LiveBadge'
import {
  Dialog, DialogContent,
} from '@/components/ui/index'

interface Props {
  match:     Match | null
  games:     Game[]
  isLoading: boolean
  onClose:   () => void
}

export function MatchDetailDialog({ match, games, isLoading, onClose }: Props) {
  return (
    <Dialog open={!!match} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md w-full p-0 overflow-hidden rounded-2xl gap-0">
        {match && <Inner match={match} games={games} isLoading={isLoading} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function Inner({ match, games, isLoading, onClose }: {
  match: Match; games: Game[]; isLoading: boolean; onClose: () => void
}) {
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'complete'
  const p1Won      = isComplete && match.winner_id === match.player1_id
  const p2Won      = isComplete && match.winner_id === match.player2_id
  const sortedGames = [...games].sort((a, b) => a.game_number - b.game_number)
  const roundLabel  = match.round_name ?? `Round ${match.round}`

  return (
    <>
      {/* ── Orange gradient header ── */}
      <div
        className="relative px-5 pt-5 pb-5"
        style={{ background: 'linear-gradient(135deg, #F06321 0%, #d94e12 100%)' }}
      >
        {/* Top row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">
              {roundLabel}
            </span>
            {match.match_kind === 'round_robin' && (
              <span className="self-start text-[10px] font-bold uppercase tracking-wider bg-white/20 text-white rounded-full px-2 py-0.5">
                Group Stage
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isLive && <LiveBadge />}
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition-colors rounded-full p-0.5"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Player names + set score */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <PlayerNameBlock
            player={match.player1}
            isWinner={p1Won}
            isLoser={p2Won}
            align="left"
          />

          {/* Centre score */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 font-display tabular-nums">
              <span className={cn(
                'text-4xl font-black text-white leading-none',
                !p1Won && isComplete && 'opacity-40',
              )}>
                {match.player1_games}
              </span>
              <span className="text-white/30 text-2xl font-light">–</span>
              <span className={cn(
                'text-4xl font-black text-white leading-none',
                !p2Won && isComplete && 'opacity-40',
              )}>
                {match.player2_games}
              </span>
            </div>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/80 bg-white/15 rounded-full px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Live
              </span>
            )}
            {isComplete && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Final
              </span>
            )}
          </div>

          <PlayerNameBlock
            player={match.player2}
            isWinner={p2Won}
            isLoser={p1Won}
            align="right"
          />
        </div>

        {/* Live pulse bar */}
        {isLive && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* ── Game-by-game scores ── */}
      <div className="px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Game Scores
        </p>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : sortedGames.length === 0 ? (
          <div className="rounded-xl bg-muted/20 border border-border/40 px-4 py-6 text-center text-sm text-muted-foreground">
            {isLive
              ? 'First game in progress — scores will appear here.'
              : 'No game scores recorded yet.'}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sortedGames.map(g => {
              const s1       = g.score1 ?? 0
              const s2       = g.score2 ?? 0
              const g1Won    = g.winner_id === match.player1_id
              const g2Won    = g.winner_id === match.player2_id
              const isDeuce  = s1 >= 10 && s2 >= 10

              return (
                <div
                  key={g.id}
                  className={cn(
                    'flex items-center rounded-xl px-4 py-2.5 transition-colors',
                    g1Won && 'bg-orange-50 dark:bg-orange-950/20 border border-orange-200/60 dark:border-orange-800/40',
                    g2Won && 'bg-muted/30 border border-border/40',
                    !g1Won && !g2Won && 'bg-muted/10 border border-border/20',
                  )}
                >
                  {/* Game number */}
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-6 shrink-0">
                    G{g.game_number}
                  </span>

                  {/* Scores */}
                  <div className="flex-1 flex items-center justify-center gap-3">
                    <span className={cn(
                      'font-display font-black text-xl tabular-nums w-8 text-center',
                      g1Won ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
                    )}>
                      {s1}
                    </span>
                    <span className="text-muted-foreground/30 text-sm">–</span>
                    <span className={cn(
                      'font-display font-black text-xl tabular-nums w-8 text-center',
                      g2Won ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
                    )}>
                      {s2}
                    </span>
                  </div>

                  {/* Labels */}
                  <div className="flex items-center gap-1.5 shrink-0 min-w-[60px] justify-end">
                    {isDeuce && (
                      <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/30 border border-amber-300/60 dark:border-amber-700 text-amber-600 dark:text-amber-400 rounded-full px-1.5 py-0.5">
                        Deuce
                      </span>
                    )}
                    {g1Won && (
                      <span className="text-[10px] font-semibold text-orange-500 truncate max-w-[60px]">
                        {match.player1?.name?.split(' ')[0]}
                      </span>
                    )}
                    {g2Won && (
                      <span className="text-[10px] font-semibold text-orange-500 truncate max-w-[60px]">
                        {match.player2?.name?.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ── PlayerNameBlock ────────────────────────────────────────────────────────────

function PlayerNameBlock({ player, isWinner, isLoser, align }: {
  player:   Match['player1'] | null
  isWinner: boolean
  isLoser:  boolean
  align:    'left' | 'right'
}) {
  return (
    <div className={cn(
      'flex flex-col gap-0.5',
      align === 'right' && 'items-end text-right',
    )}>
      {isWinner && (
        <Trophy className={cn(
          'h-4 w-4 text-amber-300',
          align === 'right' ? 'ml-auto' : '',
        )} />
      )}
      {player?.seed != null && (
        <span className="text-[10px] text-white/50 font-mono">#{player.seed}</span>
      )}
      <span className={cn(
        'font-display font-bold text-white text-base leading-tight',
        isLoser && 'opacity-50',
      )}>
        {player?.name ?? 'TBD'}
      </span>
      {player?.club && (
        <span className="text-[10px] text-white/40 truncate max-w-[100px]">{player.club}</span>
      )}
    </div>
  )
}
