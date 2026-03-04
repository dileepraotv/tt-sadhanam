import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Trophy, Calendar, MapPin, ArrowRight, Users, Swords, Layers } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header }   from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Badge }    from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import type { Championship, Tournament } from '@/lib/types'
import { formatFormatLabel } from '@/lib/utils'

interface PageProps { params: { cid: string } }

export async function generateMetadata({ params }: PageProps) {
  const supabase = createClient()
  const { data } = await supabase.from('championships').select('name').eq('id', params.cid).single()
  return { title: data ? `${data.name} — SADHANAM` : 'Championship' }
}

type EventWithCounts = Tournament & { _live: number; _done: number; _total: number; _winner?: string }

async function getData(cid: string): Promise<{ championship: Championship; allEvents: EventWithCounts[] } | null> {
  const supabase = createClient()

  const { data: champ } = await supabase
    .from('championships')
    .select('*')
    .eq('id', cid)
    .eq('published', true)
    .single()
  if (!champ) return null

  const { data: events } = await supabase
    .from('tournaments')
    .select('*')
    .eq('championship_id', cid)
    .order('name')

  const evIds = (events ?? []).map((e: { id: string }) => e.id)
  let matchRows: { tournament_id: string; status: string }[] = []
  if (evIds.length > 0) {
    const { data: m } = await supabase
      .from('matches')
      .select('tournament_id, status')
      .in('tournament_id', evIds)
    matchRows = (m ?? []) as { tournament_id: string; status: string }[]
  }

  // Fetch Final match winners for completed events
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

  const allEvents: EventWithCounts[] = (events ?? []).map((ev: Tournament) => ({
    ...ev,
    _live:  matchRows.filter(m => m.tournament_id === ev.id && m.status === 'live').length,
    _done:  matchRows.filter(m => m.tournament_id === ev.id && m.status === 'complete').length,
    _total: matchRows.filter(m => m.tournament_id === ev.id).length,
    _winner: finalWinners[ev.id],
  }))

  return { championship: champ as Championship, allEvents }
}

export default async function PublicChampionshipPage({ params }: PageProps) {
  const data = await getData(params.cid)
  if (!data) notFound()

  const { championship, allEvents } = data
  const totalLive = allEvents.reduce((n, e) => n + e._live, 0)

  const dateStr = championship.start_date
    ? new Date(championship.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : championship.year ? String(championship.year) : null

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        right={totalLive > 0 ? <LiveBadge label={`${totalLive} LIVE`} /> : undefined}
      />
      <Breadcrumb
        variant="public"
        items={[
          { label: 'Championships', href: '/championships' },
          { label: championship.name },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">

        {/* Championship hero */}
        <div className="surface-card p-6 sm:p-8 mb-8 overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-1.5"
            style={{ background: 'linear-gradient(90deg,#F06321,#F5853F,#F99D27)' }} />

          {totalLive > 0 && (
            <div className="mb-3"><LiveBadge label={`${totalLive} Match${totalLive > 1 ? 'es' : ''} Live`} /></div>
          )}

          <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground tracking-wide mb-2 pt-1">
            {championship.name}
          </h1>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground mb-3">
            {dateStr && <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" />{dateStr}</span>}
            {championship.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{championship.location}</span>}
            <span className="flex items-center gap-1.5"><Trophy className="h-4 w-4" />{allEvents.length} Event{allEvents.length !== 1 ? 's' : ''}</span>
          </div>

          {championship.description && (
            <p className="text-muted-foreground max-w-2xl">{championship.description}</p>
          )}
        </div>

        {/* Events grid */}
        <h2 className="font-display text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-100" /> Events / Categories
        </h2>

        {allEvents.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allEvents.map(ev => {
              const progress = ev._total ? Math.round((ev._done / ev._total) * 100) : 0

              return (
                <Link key={ev.id}
                  href={`/championships/${params.cid}/events/${ev.id}`}
                  className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 hover:border-orange-400 hover:shadow-md transition-all duration-200 overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                    style={{ background: '#F06321', opacity: ev.status === 'active' ? 1 : 0.3 }} />

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
                    <FormatTypeBadge formatType={(ev as unknown as { format_type?: string }).format_type ?? null} />
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
        ) : (
          <div className="surface-card p-12 text-center">
            <Trophy className="h-10 w-10 mx-auto mb-3" style={{ color: '#F06321', opacity: 0.25 }} />
            <p className="font-bold text-foreground">No events yet</p>
            <p className="text-sm text-muted-foreground mt-1">Events will appear here once the organiser sets them up.</p>
          </div>
        )}

      </main>
    </div>
  )
}

function FormatTypeBadge({ formatType }: { formatType: string | null }) {
  if (formatType === 'multi_rr_to_knockout') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/50">
        <Layers className="h-2.5 w-2.5" /> Groups→KO
      </span>
    )
  }
  if (formatType === 'single_round_robin') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/50">
        <Users className="h-2.5 w-2.5" /> Round Robin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">
      <Swords className="h-2.5 w-2.5" /> Knockout
    </span>
  )
}
