import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Trophy, Calendar, MapPin
} from 'lucide-react'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }    from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Button }    from '@/components/ui/button'
import { Badge }     from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { AdminEventsGrid } from '@/components/admin/AdminEventsGrid'
import { ChampionshipAdminClient } from './client'
import type { Championship, Tournament } from '@/lib/types'

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
    .order('created_at', { ascending: false })

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
      _total: evMatches.filter(m => m.status !== 'bye').length,
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

  const rawData = await getData(params.cid, user.id)
  if (!rawData) notFound()

  const { championship, events } = rawData!

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
            <AdminEventsGrid cid={params.cid} events={events} />
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
