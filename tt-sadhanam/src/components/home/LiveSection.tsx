'use client'

/**
 * LiveSection — horizontal scroll strip of currently live matches.
 *
 * Design: editorial/scoreboard. Each card is a self-contained score unit —
 * orange animated stripe top, players side-by-side, pulsing LIVE badge.
 * Zero live matches → minimal empty state (no large empty boxes).
 */

import Link from 'next/link'
import { Radio, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiveBadge } from '@/components/shared/LiveBadge'
import type { LiveMatchRow } from './types'

interface Props {
  matches: LiveMatchRow[]
}

export function LiveSection({ matches }: Props) {
  if (matches.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/50 bg-card/30 px-5 py-4 text-muted-foreground">
        <Radio className="h-4 w-4 shrink-0 opacity-40" />
        <p className="text-sm">No live matches right now. Check back during tournament play.</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Right fade hint — signals more cards */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 z-10
        bg-gradient-to-l from-background to-transparent" />

      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {matches.map((m) => (
          <LiveMatchCard key={m.matchId} match={m} />
        ))}
      </div>
    </div>
  )
}

function LiveMatchCard({ match: m }: { match: LiveMatchRow }) {
  const href = m.champId
    ? `/championships/${m.champId}/events/${m.eventId}`
    : `/tournaments/${m.eventId}`

  return (
    <Link
      href={href}
      className={cn(
        'group relative shrink-0 w-64 sm:w-72 flex flex-col gap-3',
        'rounded-xl border border-orange-500/30 bg-card overflow-hidden',
        'hover:border-orange-500/70 hover:shadow-lg hover:shadow-orange-500/10',
        'transition-all duration-200 cursor-pointer',
      )}
    >
      {/* Animated orange stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          background: 'linear-gradient(90deg, #F06321 0%, #F5853F 50%, #F06321 100%)',
          backgroundSize: '200% 100%',
          animation: 'live-stripe 2s linear infinite',
        }}
      />

      <div className="pt-4 px-4 pb-4 flex flex-col gap-3">
        {/* Championship / Event context */}
        <div>
          {m.champName && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-500/70 dark:text-orange-400/60 truncate mb-0.5">
              {m.champName}
            </p>
          )}
          <p className="text-sm font-semibold text-foreground truncate leading-tight">
            {m.eventName}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {m.roundName}
            {m.matchNumber != null && (
              <span className="ml-1.5 font-mono opacity-50">#{m.matchNumber}</span>
            )}
          </p>
        </div>

        {/* Score row */}
        <div className="flex items-center gap-2 bg-muted/25 dark:bg-muted/15 rounded-lg px-3 py-2.5">
          {/* P1 */}
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-xs leading-tight truncate',
              m.p1Leading ? 'font-bold text-foreground' : 'text-muted-foreground',
            )}>
              {m.p1Name ?? 'TBD'}
            </p>
          </div>

          {/* Scores */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn(
              'text-xl font-bold tabular-nums leading-none',
              m.p1Leading ? 'text-orange-500' : 'text-muted-foreground',
            )}>
              {m.p1Games}
            </span>
            <span className="text-muted-foreground/30 text-sm">–</span>
            <span className={cn(
              'text-xl font-bold tabular-nums leading-none',
              m.p2Leading ? 'text-orange-500' : 'text-muted-foreground',
            )}>
              {m.p2Games}
            </span>
          </div>

          {/* P2 */}
          <div className="flex-1 min-w-0 text-right">
            <p className={cn(
              'text-xs leading-tight truncate',
              m.p2Leading ? 'font-bold text-foreground' : 'text-muted-foreground',
            )}>
              {m.p2Name ?? 'TBD'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <LiveBadge />
          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1 font-medium">
            <Zap className="h-3 w-3" />
            View draw
          </span>
        </div>
      </div>
    </Link>
  )
}
