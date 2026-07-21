import { notFound } from 'next/navigation'
import { Trophy, Calendar, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header }   from '@/components/shared/Header'
import { ChampionshipRefresher } from '@/components/shared/ChampionshipRefresher'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { PublicEventsGrid } from '@/components/public/PublicEventsGrid'
import type { Championship, Tournament } from '@/lib/types'

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
    .eq('published', true)   // only show published events to public
    .order('created_at', { ascending: false })

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
  const rawData = await getData(params.cid)
  if (!rawData) notFound()
  const { championship, allEvents } = rawData!
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
        <ChampionshipRefresher championshipId={params.cid} />

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
        <h2 className="font-display text-xl font-bold text-foreground mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-500" /> Events / Categories
        </h2>

        {allEvents.length > 0 ? (
          <PublicEventsGrid cid={params.cid} events={allEvents} />
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
