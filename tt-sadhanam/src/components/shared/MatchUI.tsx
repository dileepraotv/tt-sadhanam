'use client'

/**
 * MatchUI — shared primitives used across all event types (admin + public).
 *
 * WinnerTrophy   — always reserves the same fixed width so player names
 *                  never shift when a winner is or isn't shown. Use it
 *                  everywhere a trophy needs to appear next to a player name.
 *
 * matchStatusClasses — returns consistent Tailwind classes for the outer
 *                  wrapper of any match/fixture card depending on status.
 *
 * MatchStatusBadge — small pill badge (LIVE / Done / vs) standardised.
 */

import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// WinnerTrophy
// Always occupies TROPHY_W px whether visible or not, so sibling names align.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed pixel width reserved for the trophy icon in every player row */
export const TROPHY_W = 18

interface WinnerTrophyProps {
  show:     boolean
  /** 'sm' = 12px (compact), 'md' = 14px (standard, default), 'lg' = 16px */
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
// Consistent card background / border for pending | live | complete matches.
// ─────────────────────────────────────────────────────────────────────────────

type MatchStatus = 'pending' | 'live' | 'complete' | 'bye' | string

/**
 * Returns className strings for the card wrapper div.
 *
 * `variant` controls which palette is used:
 *  - 'card'   : cards with borders (default) — most schedule/fixture rows
 *  - 'subtle' : very lightly tinted, no hard border change — used in table rows
 */
export function matchStatusClasses(
  status: MatchStatus,
  variant: 'card' | 'subtle' = 'card',
): string {
  const isComplete = status === 'complete' || status === 'bye'
  const isLive     = status === 'live'

  if (variant === 'subtle') {
    if (isLive)     return 'bg-orange-50/60 dark:bg-orange-950/20'
    if (isComplete) return 'bg-muted/20 opacity-80'
    return ''
  }

  // 'card' variant
  if (isLive)     return 'border-orange-400/70 bg-orange-50/50 dark:bg-orange-950/15 shadow-sm shadow-orange-200/40 dark:shadow-orange-900/20'
  if (isComplete) return 'border-border/40 bg-muted/20 opacity-80'
  return 'border-border bg-card'
}

// ─────────────────────────────────────────────────────────────────────────────
// MatchStatusBadge
// Small pill used in fixture rows and match headers.
// ─────────────────────────────────────────────────────────────────────────────

interface BadgeProps {
  status: MatchStatus
  className?: string
}

export function MatchStatusBadge({ status, className }: BadgeProps) {
  const isComplete = status === 'complete'
  const isLive     = status === 'live'

  return (
    <span className={cn(
      'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
      isLive     && 'bg-orange-500 text-white',
      isComplete && 'bg-muted text-muted-foreground',
      !isLive && !isComplete && 'bg-muted text-muted-foreground/60',
      className,
    )}>
      {isLive ? 'LIVE' : isComplete ? 'Done' : 'vs'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared typography + layout tokens
// Use these across all event types for consistent sizing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consistent class sets for recurring UI elements.
 * Import and use in any stage/bracket/public component.
 */
export const T = {
  /** Group/Round heading — e.g. "Group 1", "Round of 16", "Semi-Final" */
  roundHeading: 'text-xs font-bold text-muted-foreground uppercase tracking-wider',
  /** Match heading — team name or player name in a fixture card header */
  matchName:    'text-sm font-semibold truncate',
  /** Match name — winning side */
  matchNameWin: 'text-sm font-semibold truncate text-emerald-600 dark:text-emerald-400',
  /** Match name — losing side */
  matchNameLoss: 'text-sm font-semibold truncate text-muted-foreground',
  /** Score display — large centered score */
  score:        'font-mono font-bold tabular-nums text-base',
  /** Score display — muted (not yet played) */
  scoreMuted:   'font-mono font-bold tabular-nums text-base text-muted-foreground/60',
  /** Sub-match label — "Singles 1 (A vs X)" etc. */
  subLabel:     'text-xs font-semibold text-foreground/80',
  /** Player name in sub-match row */
  playerName:   'text-sm truncate',
  /** Rubber/game score inline — "3-1" */
  rubberScore:  'text-xs font-semibold font-mono tabular-nums',
  /** Section title inside expanded fixture */
  sectionTitle: 'text-xs font-bold text-muted-foreground uppercase tracking-wide',
} as const
