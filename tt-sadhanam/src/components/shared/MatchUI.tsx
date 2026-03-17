'use client'

/**
 * MatchUI — shared primitives used across all event types (admin + public).
 *
 * Design tokens:
 *   WINNER_NAME_CLS / WINNER_SCORE_CLS  — bold dark foreground for winner
 *   LOSER_NAME_CLS  / LOSER_SCORE_CLS   — muted, used universally for loser
 *   WINNER_ROW_CLS                       — dark-navy pill border for winner row
 *   GAME_CHIP_WIN_CLS / GAME_CHIP_LOSS_CLS — orange game chips (won) / muted (lost)
 *
 * Rule: Orange = LIVE/ACTIVE only. Dark navy border pill = WINNER.
 *
 * WinnerTrophy   — always reserves the same fixed width so player names
 *                  never shift. Use everywhere, never use 🏆 emoji.
 *
 * matchStatusClasses — card wrapper classes per match status.
 *   ongoing/pending = white bg-card
 *   complete        = grey bg-slate-100/80
 *   live            = orange border + tint
 *
 * MatchStatusBadge — shared status pill (LIVE / ✓ Done / vs).
 */

import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiveBadge } from '@/components/shared/LiveBadge'

// ─────────────────────────────────────────────────────────────────────────────
// Canonical color tokens
// ─────────────────────────────────────────────────────────────────────────────

/** Winner NAME text — bold dark foreground. */
export const WINNER_NAME_CLS  = 'font-bold text-foreground'
/** Winner SETS WON count — bold dark mono. */
export const WINNER_SCORE_CLS = 'font-bold tabular-nums text-foreground'
/** Loser name — muted. */
export const LOSER_NAME_CLS   = 'font-normal text-muted-foreground'
/** Loser sets-won — muted. */
export const LOSER_SCORE_CLS  = 'tabular-nums text-muted-foreground/50'
/** Winner row pill — dark navy border + subtle tint. Apply to winner's row wrapper. */
export const WINNER_ROW_CLS   = 'rounded-md border border-blue-900/35 bg-blue-950/5 dark:bg-blue-900/10 dark:border-blue-700/40'
/** Game chip — won that game. Orange accent. */
export const GAME_CHIP_WIN_CLS =
  'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/40'
/** Game chip — lost that game. Muted. */
export const GAME_CHIP_LOSS_CLS = 'text-muted-foreground bg-muted/60 border-border/40'

// ─────────────────────────────────────────────────────────────────────────────
// WinnerTrophy
// ─────────────────────────────────────────────────────────────────────────────

export const TROPHY_W = 18

interface WinnerTrophyProps {
  show:     boolean
  size?:    'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP = { sm: 'h-3 w-3', md: 'h-3.5 w-3.5', lg: 'h-4 w-4' } as const

export function WinnerTrophy({ show, size = 'md', className }: WinnerTrophyProps) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: TROPHY_W, opacity: show ? 1 : 0 }}
      aria-hidden={!show}
    >
      <Trophy className={cn(SIZE_MAP[size], 'text-amber-500', className)} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// matchStatusClasses
// ─────────────────────────────────────────────────────────────────────────────

type MatchStatus = 'pending' | 'live' | 'complete' | 'bye' | string

export function matchStatusClasses(
  status: MatchStatus,
  variant: 'card' | 'subtle' = 'card',
): string {
  const isComplete = status === 'complete' || status === 'bye'
  const isLive     = status === 'live'

  if (variant === 'subtle') {
    if (isLive)     return 'bg-orange-50/60 dark:bg-orange-950/20'
    if (isComplete) return 'bg-muted/10'
    return ''
  }

  // 'card' variant
  if (isLive)     return 'border-orange-400/70 bg-orange-50/50 dark:bg-orange-950/15 shadow-sm shadow-orange-200/40 dark:shadow-orange-900/20'
  if (isComplete) return 'border-border/40 bg-zinc-200/70 dark:bg-zinc-700/45'
  return 'border-border bg-card'
}

// ─────────────────────────────────────────────────────────────────────────────
// MatchStatusBadge
// ─────────────────────────────────────────────────────────────────────────────

interface BadgeProps {
  status: MatchStatus
  className?: string
}

export function MatchStatusBadge({ status, className }: BadgeProps) {
  const isComplete = status === 'complete'
  const isLive     = status === 'live'
  const isBye      = status === 'bye'

  if (isLive) return <LiveBadge className={className} />

  return (
    <span className={cn(
      'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider',
      isComplete && 'text-slate-700 dark:text-slate-300 bg-slate-200/60 dark:bg-slate-700/50',
      isBye      && 'bg-muted text-muted-foreground/70',
      !isComplete && !isBye && 'bg-muted text-muted-foreground/60',
      className,
    )}>
      {isComplete ? '✓ Done' : isBye ? 'BYE' : 'vs'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared typography tokens
// ─────────────────────────────────────────────────────────────────────────────

export const T = {
  roundHeading: 'text-xs font-bold text-muted-foreground uppercase tracking-wider',
  matchName:    'text-sm font-semibold truncate',
  matchNameWin: 'text-sm font-semibold truncate text-foreground',
  matchNameLoss: 'text-sm truncate text-muted-foreground font-normal',
  score:        'font-mono font-bold tabular-nums text-base',
  scoreMuted:   'font-mono font-bold tabular-nums text-base text-muted-foreground/60',
  subLabel:     'text-xs font-semibold text-foreground/80',
  playerName:   'text-sm truncate',
  rubberScore:  'text-xs font-semibold font-mono tabular-nums',
  sectionTitle: 'text-xs font-bold text-muted-foreground uppercase tracking-wide',
} as const
