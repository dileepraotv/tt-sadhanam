/**
 * RecentResults — compact list of recently completed events.
 *
 * Scoreboard-row aesthetic: divider rows with index #, event name,
 * championship, format icon, winner with trophy + runner-up.
 * No large whitespace — information-dense.
 */

import Link from 'next/link'
import { Swords, Users, Layers, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RecentResultRow } from './types'

interface Props {
  results: RecentResultRow[]
}

export function RecentResults({ results }: Props) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">No completed events yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border/50 overflow-hidden">
      {results.map((r, i) => (
        <ResultRow key={r.id} result={r} index={i} />
      ))}
    </div>
  )
}

function FormatIcon({ formatType }: { formatType: string | null }) {
  const cls = 'h-3 w-3 shrink-0 text-muted-foreground/50'
  if (formatType === 'multi_rr_to_knockout') return <Layers className={cls} />
  if (formatType === 'single_round_robin') return <Users className={cls} />
  return <Swords className={cls} />
}

function ResultRow({ result: r, index }: { result: RecentResultRow; index: number }) {
  const href = r.champId
    ? `/championships/${r.champId}/events/${r.id}`
    : `/tournaments/${r.id}`

  const dateLabel = r.updatedAt
    ? new Date(r.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null

  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 px-4 py-3',
        'hover:bg-muted/20 dark:hover:bg-muted/10 transition-colors',
      )}
    >
      {/* Index */}
      <span className="shrink-0 w-5 text-right text-xs font-mono text-muted-foreground/30 tabular-nums">
        {index + 1}
      </span>

      {/* Event info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <FormatIcon formatType={r.formatType} />
          <p className="text-sm font-semibold text-foreground truncate
            group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
            {r.name}
          </p>
        </div>
        {r.champName && (
          <p className="text-[10px] text-muted-foreground/60 truncate">{r.champName}</p>
        )}
      </div>

      {/* Winner block */}
      {r.winner ? (
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1">
            <span className="text-xs">🏆</span>
            <span className="text-xs font-bold text-foreground truncate max-w-[96px]">
              {r.winner}
            </span>
          </div>
          {r.runnerUp && (
            <span className="text-[10px] text-muted-foreground/50 truncate max-w-[96px]">
              vs {r.runnerUp}
            </span>
          )}
        </div>
      ) : (
        <span className="shrink-0 text-[10px] text-muted-foreground/40 italic">—</span>
      )}

      {/* Date */}
      {dateLabel && (
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/40 shrink-0">
          <Clock className="h-3 w-3" />
          {dateLabel}
        </div>
      )}
    </Link>
  )
}
