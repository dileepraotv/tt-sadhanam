'use client'

/**
 * AdminEventsGrid — client component rendering the admin championship
 * event cards, with sport filter tabs above them.
 *
 * Moved out of the server page because React Server Components cannot
 * pass function props (render-prop children, callbacks) across the
 * server → client boundary — only plain serializable data can cross.
 * This component receives the plain `events` array and owns both the
 * filter state and the card markup internally.
 */

import Link from 'next/link'
import { Trophy, ArrowRight, Users } from 'lucide-react'
import { FormatTypeBadge } from '@/components/shared/FormatTypeBadge'
import { SportBadge, sportAccentColor } from '@/components/shared/SportBadge'
import { SportFilterTabs, type SportFilter } from '@/components/shared/SportFilterTabs'
import { Badge } from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { EventActions } from '@/app/admin/championships/[cid]/client'
import { formatFormatLabel } from '@/lib/utils'
import { useMemo, useState } from 'react'
import type { Tournament } from '@/lib/types'

type EventWithCounts = Tournament & { _live: number; _done: number; _total: number; _winner?: string }

interface Props {
  cid:    string
  events: EventWithCounts[]
}

export function AdminEventsGrid({ cid, events }: Props) {
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(ev => {
          const liveCount  = ev._live
          const doneCount  = ev._done
          const totalCount = ev._total
          const progress   = totalCount ? Math.round((doneCount / totalCount) * 100) : 0
          const accent     = sportAccentColor(ev.sport_type)

          return (
            /* Link IS the card — delete button uses stopPropagation + preventDefault */
            <Link
              key={ev.id}
              href={`/admin/championships/${cid}/events/${ev.id}`}
              className="group relative flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 hover:border-orange-400 hover:shadow-md active:scale-[0.99] transition-all duration-200 overflow-hidden"
            >
              {/* Accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                style={{ background: accent, opacity: ev.status === 'active' ? 1 : 0.25 }} />

              {/* Header row: name + badges + delete button */}
              <div className="flex items-start justify-between gap-2 pt-0.5 pr-6">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <h3 className="font-bold text-sm text-foreground group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors leading-tight">
                    {ev.name}
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {liveCount > 0 && <LiveBadge />}
                    {ev.status === 'complete' && <Badge variant="success">Done</Badge>}
                    {ev.status === 'setup' && <Badge variant="secondary">Setup</Badge>}
                  </div>
                </div>
              </div>

              {/* Delete button — absolute, stopPropagation prevents card navigation */}
              <div className="absolute top-2 right-2">
                <EventActions cid={cid} eventId={ev.id} eventName={ev.name} />
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <SportBadge sportType={ev.sport_type} size="sm" />
                <FormatTypeBadge formatType={ev.format_type} size="sm" />
                {!['team_league','team_league_ko','team_league_swaythling',
                    'team_group_corbillon','team_group_swaythling'].includes(ev.format_type ?? '') && (
                  <span>{formatFormatLabel(ev.format)}</span>
                )}
                {totalCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {totalCount} matches
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

              {ev.bracket_generated && totalCount > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${progress}%`, background: '#F06321' }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{doneCount}/{totalCount} matches complete</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-0.5 mt-auto">
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Manage →</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          )
        })}
      </div>
      {filtered.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <Trophy className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-bold text-foreground mb-1">No events for this sport</p>
        </div>
      )}
    </div>
  )
}
