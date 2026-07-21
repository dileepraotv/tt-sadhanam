'use client'

/**
 * PublicEventsGrid — client component rendering the public championship
 * event cards, with sport filter tabs above them.
 *
 * Moved out of the server page because React Server Components cannot
 * pass function props (render-prop children, callbacks) across the
 * server → client boundary — only plain serializable data can cross.
 * This component receives the plain `events` array and owns both the
 * filter state and the card markup internally.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Trophy, ArrowRight, Users } from 'lucide-react'
import { FormatTypeBadge } from '@/components/shared/FormatTypeBadge'
import { SportBadge, sportAccentColor } from '@/components/shared/SportBadge'
import { SportFilterTabs, type SportFilter } from '@/components/shared/SportFilterTabs'
import { Badge } from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { formatFormatLabel } from '@/lib/utils'
import type { Tournament } from '@/lib/types'

type EventWithCounts = Tournament & { _live: number; _done: number; _total: number; _winner?: string }

interface Props {
  cid:    string
  events: EventWithCounts[]
}

export function PublicEventsGrid({ cid, events }: Props) {
  const [filter, setFilter] = useState<SportFilter>('all')

  const sportsPresent = useMemo(
    () => new Set(events.map((ev) => ev.sport_type ?? 'table_tennis')),
    [events],
  )

  const filtered = filter === 'all'
    ? events
    : events.filter((ev) => (ev.sport_type ?? 'table_tennis') === filter)

  return (
    <div className="space-y-4">
      {sportsPresent.size > 1 && (
        <SportFilterTabs filter={filter} onChange={setFilter} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(ev => {
          const progress = ev._total ? Math.round((ev._done / ev._total) * 100) : 0
          const accent = sportAccentColor(ev.sport_type)

          return (
            <Link key={ev.id}
              href={`/championships/${cid}/events/${ev.id}`}
              className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 hover:border-orange-400 hover:shadow-md transition-all duration-200 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                style={{ background: accent, opacity: ev.status === 'active' ? 1 : 0.3 }} />

              <div className="flex items-start justify-between gap-2 pt-1">
                <h3 className="font-display font-bold text-base text-foreground group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors leading-tight">
                  {ev.name}
                </h3>
                <div className="flex items-center gap-1 shrink-0">
                  {ev._live > 0 && <LiveBadge />}
                  {ev.status === 'complete' && <Badge variant="success">Done</Badge>}
                  {ev.status === 'setup' && <Badge variant="secondary">Setup</Badge>}
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <SportBadge sportType={ev.sport_type} size="sm" />
                <FormatTypeBadge formatType={ev.format_type ?? null} />
                <span className="text-muted-foreground/70">{formatFormatLabel(ev.format)}</span>
                {ev._total > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {ev._total} matches
                  </span>
                )}
              </div>

              {ev.status === 'complete' && ev._winner && (
                <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                  <span className="text-sm">🏆</span>
                  <span className="font-bold text-sm text-amber-800 truncate">{ev._winner}</span>
                  <span className="text-xs text-amber-600 ml-auto shrink-0">Winner</span>
                </div>
              )}

              {ev.bracket_generated && ev._total > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Progress</span>
                    <span>{ev._done}/{ev._total}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${progress}%`, background: '#F06321' }} />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 mt-auto">
                <span className="text-xs font-semibold text-orange-600">
                  {ev.bracket_generated ? 'View Bracket →' : 'View →'}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          )
        })}
      </div>
      {filtered.length === 0 && (
        <div className="surface-card p-12 text-center">
          <Trophy className="h-10 w-10 mx-auto mb-3" style={{ color: '#F06321', opacity: 0.25 }} />
          <p className="font-bold text-foreground">No events for this sport</p>
        </div>
      )}
    </div>
  )
}
