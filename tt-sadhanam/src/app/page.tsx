/**
 * app/page.tsx — TT-SADHANAM Public Homepage (Refactored)
 *
 * Sports-platform layout:
 *  1. Compact hero header — title, subtitle, stats pills
 *  2. Live Now — horizontal-scroll live match cards
 *  3. Active Events — dense grid (mobile-first, before championships)
 *  4. Ongoing Championships — 2–3 col grid
 *  5. Recently Completed Events — compact list with winners
 */

import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Trophy, Radio, Layers, Activity } from 'lucide-react'
import { createClient, getUser } from '@/lib/supabase/server'
import { Header }              from '@/components/shared/Header'
import { LiveSection }         from '@/components/home/LiveSection'
import { ChampionshipGrid }    from '@/components/home/ChampionshipGrid'
import { EventGrid }           from '@/components/home/EventGrid'
import { RecentResults }       from '@/components/home/RecentResults'
import { RealtimeRefresher }   from '@/components/shared/RealtimeRefresher'
import type {
  LiveMatchRow,
  OngoingChampRow,
  ActiveEventRow,
  RecentResultRow,
} from '@/components/home/types'

export const revalidate = 15

// ─────────────────────────────────────────────────────────────────────────────
// Server-side data fetching
// ─────────────────────────────────────────────────────────────────────────────

async function getHomeData(userId: string | null) {
  const supabase = createClient()

  // ── 1. Live matches ──────────────────────────────────────────────────────────
  const { data: rawLive } = await supabase
    .from('matches')
    .select(`
      id, round, round_name, match_number,
      player1_games, player2_games,
      player1_id, player2_id,
      player1:player1_id ( name ),
      player2:player2_id ( name ),
      tournament:tournament_id (
        id, name, championship_id,
        championships ( id, name )
      )
    `)
    .eq('status', 'live')
    .order('updated_at', { ascending: false })
    .limit(10)

  const liveRows: LiveMatchRow[] = (rawLive ?? []).map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t  = (m as any).tournament as { id: string; name: string; championship_id: string | null; championships: { id: string; name: string } | null } | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p1 = (m as any).player1 as { name: string } | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p2 = (m as any).player2 as { name: string } | null
    const g1 = m.player1_games ?? 0
    const g2 = m.player2_games ?? 0
    return {
      matchId:     m.id,
      eventId:     t?.id ?? '',
      eventName:   t?.name ?? 'Event',
      champId:     t?.championships?.id ?? null,
      champName:   t?.championships?.name ?? null,
      roundName:   m.round_name ?? `Round ${m.round}`,
      matchNumber: m.match_number ?? null,
      p1Name:      p1?.name ?? null,
      p2Name:      p2?.name ?? null,
      p1Games:     g1,
      p2Games:     g2,
      p1Leading:   g1 > g2,
      p2Leading:   g2 > g1,
    }
  })

  // ── 2. Championships ─────────────────────────────────────────────────────────
  let champQ = supabase
    .from('championships')
    .select('id, name, location, start_date, end_date, published, created_at')
    .order('created_at', { ascending: false })
    .limit(12)
  champQ = userId
    ? champQ.or(`published.eq.true,created_by.eq.${userId}`)
    : champQ.eq('published', true)
  const { data: rawChamps } = await champQ

  const champIds = (rawChamps ?? []).map((c) => c.id)
  const champEventCounts: Record<string, { total: number; live: number; done: number }> = {}
  const champMatchCounts: Record<string, { total: number; done: number }> = {}

  if (champIds.length > 0) {
    // Events per championship
    const { data: evRows } = await supabase
      .from('tournaments')
      .select('id, championship_id, status')
      .in('championship_id', champIds)

    const allEvIds = (evRows ?? []).map((e) => e.id)
    const evByChamp: Record<string, typeof evRows> = {}
    for (const ev of evRows ?? []) {
      if (ev.championship_id) {
        if (!evByChamp[ev.championship_id]) evByChamp[ev.championship_id] = []
        evByChamp[ev.championship_id]!.push(ev)
      }
    }

    // Matches per event
    const matchByEv: Record<string, { total: number; done: number; live: number }> = {}
    if (allEvIds.length > 0) {
      const { data: matchRows } = await supabase
        .from('matches')
        .select('tournament_id, status')
        .in('tournament_id', allEvIds)
      for (const mr of matchRows ?? []) {
        if (!matchByEv[mr.tournament_id]) matchByEv[mr.tournament_id] = { total: 0, done: 0, live: 0 }
        matchByEv[mr.tournament_id].total++
        if (mr.status === 'complete') matchByEv[mr.tournament_id].done++
        if (mr.status === 'live')     matchByEv[mr.tournament_id].live++
      }
    }

    for (const cid of champIds) {
      const evs = evByChamp[cid] ?? []
      let totalM = 0, doneM = 0, liveEvs = 0, doneEvs = 0
      for (const ev of evs) {
        const mc = matchByEv[ev.id] ?? { total: 0, done: 0, live: 0 }
        totalM += mc.total
        doneM  += mc.done
        if (mc.live > 0)           liveEvs++
        if (ev.status === 'complete') doneEvs++
      }
      champEventCounts[cid] = { total: evs.length, live: liveEvs, done: doneEvs }
      champMatchCounts[cid] = { total: totalM, done: doneM }
    }
  }

  const ongoingChamps: OngoingChampRow[] = (rawChamps ?? []).map((c) => ({
    id:           c.id,
    name:         c.name,
    location:     c.location,
    startDate:    c.start_date,
    endDate:      c.end_date,
    published:    c.published,
    eventCount:   champEventCounts[c.id]?.total  ?? 0,
    liveCount:    champEventCounts[c.id]?.live   ?? 0,
    doneCount:    champEventCounts[c.id]?.done   ?? 0,
    totalMatches: champMatchCounts[c.id]?.total  ?? 0,
    doneMatches:  champMatchCounts[c.id]?.done   ?? 0,
  }))

  // ── 3. Active events ──────────────────────────────────────────────────────────
  const { data: rawActive } = await supabase
    .from('tournaments')
    .select(`
      id, name, status, format_type, championship_id,
      bracket_generated, stage1_complete, stage2_bracket_generated, updated_at,
      championships ( id, name )
    `)
    .not('championship_id', 'is', null)
    .in('status', ['setup', 'active'])
    .order('updated_at', { ascending: false })
    .limit(18)

  const activeEvIds = (rawActive ?? []).map((e) => e.id)
  const evMatchMap: Record<string, { total: number; done: number; live: number }> = {}
  if (activeEvIds.length > 0) {
    const { data: evMR } = await supabase
      .from('matches')
      .select('tournament_id, status')
      .in('tournament_id', activeEvIds)
    for (const mr of evMR ?? []) {
      if (!evMatchMap[mr.tournament_id]) evMatchMap[mr.tournament_id] = { total: 0, done: 0, live: 0 }
      evMatchMap[mr.tournament_id].total++
      if (mr.status === 'complete') evMatchMap[mr.tournament_id].done++
      if (mr.status === 'live')     evMatchMap[mr.tournament_id].live++
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function deriveStageLabel(ev: any): string {
    if (ev.format_type === 'multi_rr_to_knockout') {
      if (ev.stage2_bracket_generated) return 'Knockout stage'
      if (ev.stage1_complete)          return 'Advancing to KO'
      return 'Group stage'
    }
    if (ev.format_type === 'single_round_robin') {
      return ev.bracket_generated ? 'In play' : 'Setting up'
    }
    return ev.bracket_generated ? 'Bracket live' : 'Setting up'
  }

  const activeEvents: ActiveEventRow[] = (rawActive ?? []).map((ev) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const champ = (ev as any).championships as { id: string; name: string } | null
    const mc    = evMatchMap[ev.id] ?? { total: 0, done: 0, live: 0 }
    const progress = mc.total > 0 ? Math.round((mc.done / mc.total) * 100) : 0
    return {
      id:           ev.id,
      name:         ev.name,
      champId:      ev.championship_id ?? null,
      champName:    champ?.name ?? null,
      formatType:   ev.format_type ?? null,
      status:       ev.status,
      stageLabel:   deriveStageLabel(ev),
      progress,
      totalMatches: mc.total,
      doneMatches:  mc.done,
      liveCount:    mc.live,
    }
  })

  // ── 4. Recent completed events ────────────────────────────────────────────────
  const { data: rawRecent } = await supabase
    .from('tournaments')
    .select(`
      id, name, status, format_type, championship_id, updated_at,
      championships ( id, name )
    `)
    .not('championship_id', 'is', null)
    .eq('status', 'complete')
    .order('updated_at', { ascending: false })
    .limit(10)

  const recentEvIds = (rawRecent ?? []).map((e) => e.id)
  const winnerMap: Record<string, { winner: string; runnerUp: string | null }> = {}
  if (recentEvIds.length > 0) {
    const { data: finals } = await supabase
      .from('matches')
      .select('tournament_id, winner_id, player1_id, player2_id, player1:player1_id(name), player2:player2_id(name)')
      .in('tournament_id', recentEvIds)
      .eq('round_name', 'Final')
      .eq('status', 'complete')
    for (const f of finals ?? []) {
      const p1 = (f.player1 as unknown as { name: string } | null)
      const p2 = (f.player2 as unknown as { name: string } | null)
      if (f.winner_id && p1 && p2) {
        winnerMap[f.tournament_id] = {
          winner:  f.winner_id === f.player1_id ? p1.name : p2.name,
          runnerUp: f.winner_id === f.player1_id ? p2.name : p1.name,
        }
      }
    }
  }

  const recentResults: RecentResultRow[] = (rawRecent ?? []).map((ev) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const champ = (ev as any).championships as { id: string; name: string } | null
    const w = winnerMap[ev.id]
    return {
      id:         ev.id,
      name:       ev.name,
      champId:    ev.championship_id ?? null,
      champName:  champ?.name ?? null,
      winner:     w?.winner ?? null,
      runnerUp:   w?.runnerUp ?? null,
      updatedAt:  (ev as unknown as { updated_at: string }).updated_at,
      formatType: ev.format_type ?? null,
    }
  })

  return {
    liveRows,
    ongoingChamps,
    activeEvents,
    recentResults,
    stats: {
      liveCount:  liveRows.length,
      champCount: ongoingChamps.filter((c) => c.published).length,
      eventCount: activeEvents.length,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const user = await getUser()

  // ── Admin shortcut: logged-in users always go to their dashboard ───────────
  if (user) {
    redirect('/admin/championships')
  }

  const { liveRows, ongoingChamps, activeEvents, recentResults, stats } =
    await getHomeData(null)

  const isEmpty =
    ongoingChamps.length === 0 &&
    activeEvents.length === 0 &&
    recentResults.length === 0

  return (
    <div className="min-h-screen flex flex-col">
      {/* Realtime: auto-refresh page when match data changes */}
      <RealtimeRefresher hasLive={stats.liveCount > 0} pollIntervalMs={20_000} />

      <Header user={null} />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 space-y-10">

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 1. COMPACT HERO                                                    */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section>
          <div className="surface-card px-5 sm:px-7 py-5
            flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">

            {/* Wordmark + subtitle */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="h-5 w-5 text-orange-500 shrink-0" />
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  TT-SADHANAM
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Real-time table tennis tournament tracking
                <span className="hidden sm:inline"> · Live brackets · Scores</span>
              </p>
            </div>

            {/* Stats pills + sign-in CTA for admins */}
            <div className="flex flex-wrap items-center gap-2">
              <StatPill
                icon={<span className="live-dot shrink-0" />}
                label={`${stats.liveCount} live`}
                active={stats.liveCount > 0}
              />
              <StatPill
                icon={<Trophy className="h-3 w-3" />}
                label={`${stats.champCount} champ${stats.champCount !== 1 ? 's' : ''}`}
              />
              <StatPill
                icon={<Layers className="h-3 w-3" />}
                label={`${stats.eventCount} event${stats.eventCount !== 1 ? 's' : ''}`}
              />
            </div>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 2. LIVE NOW                                                        */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionHeader
            icon={<Radio className="h-4 w-4 text-orange-500" />}
            title="Live Now"
            pulse={stats.liveCount > 0}
            suffix={
              stats.liveCount > 0
                ? <span className="text-xs font-bold text-orange-500 tabular-nums">
                    {stats.liveCount} match{stats.liveCount !== 1 ? 'es' : ''}
                  </span>
                : undefined
            }
          />
          <LiveSection matches={liveRows} />
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 3. ACTIVE EVENTS (mobile-first — before championships)             */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeEvents.length > 0 && (
          <section className="space-y-3">
            <SectionHeader
              icon={<Activity className="h-4 w-4 text-orange-500" />}
              title="Active Events"
              count={activeEvents.length}
            />
            <EventGrid events={activeEvents} />
          </section>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 4. CHAMPIONSHIPS                                                   */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {ongoingChamps.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <SectionHeader
                icon={<Trophy className="h-4 w-4 text-orange-500" />}
                title="Championships"
                count={ongoingChamps.length}
                noRule
              />
              <Link
                href="/championships"
                className="text-xs font-semibold text-orange-600 dark:text-orange-400
                  hover:text-orange-700 dark:hover:text-orange-300 transition-colors shrink-0"
              >
                View all →
              </Link>
            </div>
            <ChampionshipGrid championships={ongoingChamps} />
          </section>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 5. RECENT RESULTS                                                  */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {recentResults.length > 0 && (
          <section className="space-y-3">
            <SectionHeader
              icon={<Trophy className="h-4 w-4 text-muted-foreground/50" />}
              title="Recent Results"
              count={recentResults.length}
              muted
            />
            <RecentResults results={recentResults} />
          </section>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* EMPTY STATE                                                        */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {isEmpty && (
          <div className="surface-card p-12 text-center space-y-4">
            <Trophy className="h-12 w-12 mx-auto text-orange-500/25" />
            <div>
              <p className="font-display font-bold text-xl text-foreground">Welcome to TT-SADHANAM</p>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto mt-1">
                Championships and events will appear here once created and published.
              </p>
            </div>
            <p className="text-xs text-muted-foreground/50">Admin login required to manage tournaments.</p>
          </div>
        )}

      </main>

      <footer className="py-5 text-center text-xs text-muted-foreground/40 border-t border-border/30 mt-4">
        TT-SADHANAM · Table Tennis Tournament Manager
      </footer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline helper components (page-only, not exported)
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  suffix,
  count,
  pulse = false,
  muted = false,
  noRule = false,
}: {
  icon:     React.ReactNode
  title:    string
  suffix?:  React.ReactNode
  count?:   number
  pulse?:   boolean
  muted?:   boolean
  noRule?:  boolean
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className={pulse ? 'animate-pulse' : ''}>{icon}</span>
      <h2 className={[
        'font-display font-bold text-sm sm:text-base tracking-wide whitespace-nowrap',
        muted ? 'text-muted-foreground' : 'text-foreground',
      ].join(' ')}>
        {title}
      </h2>
      {suffix}
      {count !== undefined && (
        <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
          ({count})
        </span>
      )}
      {!noRule && (
        <div className="flex-1 h-px bg-border/50 ml-1 min-w-4" />
      )}
    </div>
  )
}

function StatPill({
  icon,
  label,
  active = false,
}: {
  icon:    React.ReactNode
  label:   string
  active?: boolean
}) {
  return (
    <span className={[
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
      active
        ? 'border-orange-400/60 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
        : 'border-border bg-muted/20 dark:bg-muted/15 text-muted-foreground',
    ].join(' ')}>
      {icon}
      {label}
    </span>
  )
}
