import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Trophy, Calendar, MapPin, ArrowRight, Users, Swords, Layers
} from 'lucide-react'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }    from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Button }    from '@/components/ui/button'
import { Badge }     from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { ChampionshipAdminClient, EventActions } from './client'
import type { Championship, Tournament } from '@/lib/types'
import { formatFormatLabel } from '@/lib/utils'

function FormatTypeLabel({ t }: { t: string | undefined }) {
  if (!t || t === 'single_knockout')
    return <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400"><Swords className="h-3 w-3" /> KO</span>
  if (t === 'single_round_robin')
    return <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400"><Users className="h-3 w-3" /> Round Robin</span>
  return <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 dark:text-orange-400"><Layers className="h-3 w-3" /> Groups→KO</span>
}

interface PageProps { params: { cid: string } }

export const revalidate = 0

async function getData(cid: string, userId: string) {
  const supabase = createClient()

  const { data: champ } = await supabase
    .from('championships')
    .select('*')
    .eq('id', cid)
    .eq('created_by', userId)
    .single()
  if (!champ) return null

  const { data: events } = await supabase
    .from('tournaments')
    .select('*')
    .eq('championship_id', cid)
    .order('name')

  const evIds = (events ?? []).map(e => e.id)
  // Fetch match status counts separately to avoid FK relationship dependency
  let matchRows: { tournament_id: string; status: string }[] = []
  if (evIds.length > 0) {
    const { data: m } = await supabase
      .from('matches')
      .select('tournament_id, status')
      .in('tournament_id', evIds)
    matchRows = (m ?? []) as { tournament_id: string; status: string }[]
  }

  // Fetch Final match winners
  const finalWinners: Record<string, string> = {}
  if (evIds.length > 0) {
    const { data: finals } = await supabase
      .from('matches')
      .select('tournament_id, winner_id, player1_id, player2_id, player1:player1_id(name), player2:player2_id(name)')
      .in('tournament_id', evIds)
      .eq('round_name', 'Final')
      .eq('status', 'complete')
    if (finals) {
      for (const f of finals) {
        const p1 = (f.player1 as unknown as { name: string } | null)
        const p2 = (f.player2 as unknown as { name: string } | null)
        if (f.winner_id && p1?.name && p2?.name) {
          finalWinners[f.tournament_id] = f.winner_id === f.player1_id ? p1.name : p2.name
        }
      }
    }
  }

  const eventsWithCounts = (events ?? []).map(ev => {
    const evMatches = matchRows.filter(m => m.tournament_id === ev.id)
    return {
      ...ev,
      _live:  evMatches.filter(m => m.status === 'live').length,
      _done:  evMatches.filter(m => m.status === 'complete').length,
      _total: evMatches.length,
      _winner: finalWinners[ev.id],
    }
  })

  return {
    championship: champ as Championship,
    events: eventsWithCounts as (Tournament & { _live: number; _done: number; _total: number; _winner?: string })[],
  }
}

export default async function AdminChampionshipPage({ params }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const data = await getData(params.cid, user.id)
  if (!data) notFound()

  const { championship, events } = data

  const totalLive = events.reduce((n, e) => n + e._live, 0)

  const dateStr = championship.start_date
    ? new Date(championship.start_date).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : championship.year ? String(championship.year) : null

  return (
    <div className="min-h-screen flex flex-col">
      <Header isAdmin user={user} />
      <Breadcrumb
        variant="admin"
        items={[
          { label: 'My Championships', href: '/admin/championships' },
          { label: championship.name },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
        <div className="surface-card p-6 sm:p-8">

          {/* ── Championship header ── */}
          <div className="mb-6 flex flex-col gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-foreground">{championship.name}</h1>
                {championship.published
                  ? <Badge variant="live">Published</Badge>
                  : <Badge variant="secondary">Draft</Badge>}
                {totalLive > 0 && <LiveBadge label={`${totalLive} LIVE`} />}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {dateStr && <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{dateStr}</span>}
                {championship.location && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{championship.location}</span>}
                <span className="flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />{events.length} event{events.length !== 1 ? 's' : ''}</span>
              </div>
              {championship.description && (
                <p className="mt-2 text-sm text-muted-foreground">{championship.description}</p>
              )}
            </div>

            {/* Publish toggle + delete — client component, full width on mobile */}
            <ChampionshipAdminClient championship={championship} />
          </div>

          {/* ── Events grid ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="font-display text-xl font-bold text-foreground flex items-center gap-2">
              <Trophy className="h-5 w-5 text-orange-500" /> Events / Categories
            </h2>
            <Button asChild variant="default" size="sm" className="w-full sm:w-auto">
              <Link href={`/admin/championships/${params.cid}/events/new`}>
                <Plus className="h-4 w-4" /> Add Event
              </Link>
            </Button>
          </div>

          {events.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {events.map(ev => {
                const liveCount  = ev._live
                const doneCount  = ev._done
                const totalCount = ev._total
                const progress   = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

                return (
                  /* Link IS the card — most reliable on mobile iOS/Android */
                  <Link
                    key={ev.id}
                    href={`/admin/championships/${params.cid}/events/${ev.id}`}
                    className="group relative flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 hover:border-orange-400 hover:shadow-md active:scale-[0.99] transition-all duration-200 overflow-hidden"
                  >
                    {/* Accent bar */}
                    <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                      style={{ background: '#F06321', opacity: ev.status === 'active' ? 1 : 0.25 }} />

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
                      <EventActions cid={params.cid} eventId={ev.id} eventName={ev.name} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <FormatTypeLabel t={ev.format_type} />
                      <span>{formatFormatLabel(ev.format)}</span>
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
          ) : (
            <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
              <Trophy className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-bold text-foreground mb-1">No events yet</p>
              <p className="text-sm text-muted-foreground mb-4">Add the first event/category to this championship.</p>
              <Button asChild variant="default" size="sm">
                <Link href={`/admin/championships/${params.cid}/events/new`}>
                  <Plus className="h-4 w-4" /> Add First Event
                </Link>
              </Button>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
