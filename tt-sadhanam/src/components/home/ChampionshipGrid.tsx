/**
 * ChampionshipGrid — 2–3 column grid of championship cards.
 *
 * Each card: name, date range, location, event count,
 * progress bar (matches done), and live indicator.
 * Server component — no hooks needed.
 */

import Link from 'next/link'
import { Trophy, Calendar, MapPin, Layers, ArrowRight } from 'lucide-react'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { Badge } from '@/components/ui/index'
import { cn } from '@/lib/utils'
import type { OngoingChampRow } from './types'

interface Props {
  championships: OngoingChampRow[]
}

export function ChampionshipGrid({ championships }: Props) {
  if (championships.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-10 text-center">
        <Trophy className="h-7 w-7 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No active championships yet.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {championships.map((c) => (
        <ChampCard key={c.id} champ={c} />
      ))}
    </div>
  )
}

function ChampCard({ champ: c }: { champ: OngoingChampRow }) {
  const progress = c.totalMatches > 0
    ? Math.round((c.doneMatches / c.totalMatches) * 100)
    : 0

  const allDone = c.eventCount > 0 && c.doneCount >= c.eventCount
  const hasLive = c.liveCount > 0

  const startLabel = c.startDate
    ? new Date(c.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const endLabel = c.endDate
    ? new Date(c.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null
  const dateRange = startLabel && endLabel
    ? `${startLabel} – ${endLabel}`
    : startLabel

  return (
    <Link
      href={`/championships/${c.id}`}
      className={cn(
        'group relative flex flex-col rounded-xl border bg-card overflow-hidden',
        'hover:shadow-lg transition-all duration-200',
        hasLive
          ? 'border-orange-500/40 hover:border-orange-500/70 hover:shadow-orange-500/8'
          : 'border-border hover:border-orange-400/50 hover:shadow-black/8',
      )}
    >
      {/* Accent bar */}
      <div
        className="h-[3px] w-full shrink-0"
        style={{
          background: hasLive
            ? 'linear-gradient(90deg, #F06321 0%, #F5853F 60%, #F99D27 100%)'
            : allDone
              ? '#22c55e'
              : 'hsl(var(--border))',
        }}
      />

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Title + badges */}
        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 font-display font-bold text-sm text-foreground leading-snug
            group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors line-clamp-2">
            {c.name}
          </h3>
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {hasLive && <LiveBadge className="text-[9px]" />}
            {allDone && !hasLive && (
              <Badge variant="success" className="text-[9px] px-1.5 py-0">Done</Badge>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {dateRange && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3 shrink-0" />
              {dateRange}
            </span>
          )}
          {c.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 shrink-0" />
              {c.location}
            </span>
          )}
        </div>

        {/* Event count row */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="h-3 w-3 shrink-0" />
            {c.eventCount} event{c.eventCount !== 1 ? 's' : ''}
          </span>
          {c.doneCount > 0 && (
            <span className="text-muted-foreground/60">
              {c.doneCount}/{c.eventCount} done
            </span>
          )}
          {hasLive && (
            <span className="font-semibold text-orange-500">
              {c.liveCount} live
            </span>
          )}
        </div>

        {/* Progress bar */}
        {c.totalMatches > 0 && (
          <div className="mt-auto space-y-1">
            <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: progress >= 100
                    ? '#22c55e'
                    : 'linear-gradient(90deg, #F06321, #F5853F)',
                }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground/50 tabular-nums">
              {c.doneMatches}/{c.totalMatches} matches complete
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center justify-between pt-1 border-t border-border/40 mt-auto">
          <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400">
            View draws
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40
            group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  )
}
