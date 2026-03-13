import Link from 'next/link'
import { Trophy, Calendar, MapPin, Search, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Badge } from '@/components/ui/index'
import type { Championship } from '@/lib/types'

export const revalidate = 60

const PAGE_SIZE = 12

interface PageProps {
  searchParams: { q?: string; year?: string; location?: string; page?: string }
}

async function getChampionships(params: PageProps['searchParams']) {
  const supabase = createClient()
  const page     = Math.max(1, parseInt(params.page ?? '1', 10))
  const from     = (page - 1) * PAGE_SIZE
  const to       = from + PAGE_SIZE - 1

  let query = supabase
    .from('championships')
    .select('*', { count: 'exact' })
    .eq('published', true)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (params.q)        query = query.ilike('name', `%${params.q}%`)
  if (params.year)     query = query.eq('year', parseInt(params.year, 10))
  if (params.location) query = query.ilike('location', `%${params.location}%`)

  const { data, count } = await query
  return { championships: (data ?? []) as Championship[], total: count ?? 0, page, pages: Math.ceil((count ?? 0) / PAGE_SIZE) }
}

async function getFilterOptions() {
  const supabase = createClient()
  const { data: years }     = await supabase.from('championships').select('year').eq('published', true).not('year', 'is', null)
  const { data: locations } = await supabase.from('championships').select('location').eq('published', true).not('location', 'is', null)
  const uniqueYears     = Array.from(new Set((years ?? []).map(r => r.year))).sort((a, b) => (b ?? 0) - (a ?? 0))
  const uniqueLocations = Array.from(new Set((locations ?? []).map(r => r.location))).filter(Boolean).sort()
  return { years: uniqueYears, locations: uniqueLocations }
}

export default async function ChampionshipsPage({ searchParams }: PageProps) {
  const [{ championships, total, page, pages }, { years, locations }] = await Promise.all([
    getChampionships(searchParams),
    getFilterOptions(),
  ])

  const hasFilters = !!(searchParams.q || searchParams.year || searchParams.location)

  function buildUrl(overrides: Partial<typeof searchParams>) {
    const p = { ...searchParams, ...overrides }
    const qs = new URLSearchParams()
    if (p.q)        qs.set('q', p.q)
    if (p.year)     qs.set('year', p.year)
    if (p.location) qs.set('location', p.location)
    if (p.page && p.page !== '1') qs.set('page', p.page)
    const str = qs.toString()
    return `/championships${str ? `?${str}` : ''}`
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <Breadcrumb items={[{ label: 'Championships' }]} variant="public" />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-wide mb-1 flex items-center gap-3">
            <Trophy className="h-8 w-8 text-orange-100" />
            Championships
          </h1>
          <p className="text-orange-100/80 text-sm">
            {total} championship{total !== 1 ? 's' : ''} found
          </p>
        </div>

        {/* Search + filters */}
        <div className="surface-card p-4 mb-6 flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Search</label>
            <form method="GET" className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <input
                name="q"
                defaultValue={searchParams.q}
                placeholder="Championship name…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {/* Hidden fields to preserve other filters */}
              {searchParams.year     && <input type="hidden" name="year"     value={searchParams.year} />}
              {searchParams.location && <input type="hidden" name="location" value={searchParams.location} />}
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-2 py-1 rounded transition-colors">
                Go
              </button>
            </form>
          </div>

          {/* Year filter */}
          {years.length > 0 && (
            <div className="min-w-[130px]">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Year</label>
              <div className="flex flex-wrap gap-1.5">
                <Link href={buildUrl({ year: undefined, page: '1' })}
                  className={`text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${!searchParams.year ? 'bg-orange-500 text-white border-orange-500' : 'bg-card text-muted-foreground border-border hover:border-orange-400'}`}>
                  All
                </Link>
                {years.slice(0, 5).map(y => (
                  <Link key={y} href={buildUrl({ year: String(y), page: '1' })}
                    className={`text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${searchParams.year === String(y) ? 'bg-orange-500 text-white border-orange-500' : 'bg-card text-muted-foreground border-border hover:border-orange-400'}`}>
                    {y}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Location filter */}
          {locations.length > 0 && (
            <div className="min-w-[150px]">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Location</label>
              <div className="flex flex-wrap gap-1.5">
                <Link href={buildUrl({ location: undefined, page: '1' })}
                  className={`text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${!searchParams.location ? 'bg-orange-500 text-white border-orange-500' : 'bg-card text-muted-foreground border-border hover:border-orange-400'}`}>
                  All
                </Link>
                {locations.slice(0, 6).map(l => (
                  <Link key={l} href={buildUrl({ location: l!, page: '1' })}
                    className={`text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${searchParams.location === l ? 'bg-orange-500 text-white border-orange-500' : 'bg-card text-muted-foreground border-border hover:border-orange-400'}`}>
                    {l}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {hasFilters && (
            <Link href="/championships"
              className="text-sm text-orange-600 hover:text-orange-700 font-semibold self-end pb-2 whitespace-nowrap transition-colors">
              ✕ Clear filters
            </Link>
          )}
        </div>

        {/* Grid */}
        {championships.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {championships.map(c => (
              <PublicChampionshipCard key={c.id} championship={c} />
            ))}
          </div>
        ) : (
          <div className="surface-card p-16 text-center">
            <Trophy className="h-12 w-12 mx-auto mb-4" style={{ color: '#F06321', opacity: 0.25 }} />
            <p className="text-xl font-bold text-foreground mb-2">No championships found</p>
            <p className="text-muted-foreground text-sm">Try adjusting your search or filters.</p>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            {page > 1 && (
              <Link href={buildUrl({ page: String(page - 1) })}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-card border border-border text-sm font-semibold text-foreground hover:border-orange-400 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Prev
              </Link>
            )}

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                const p = i + 1
                return (
                  <Link key={p} href={buildUrl({ page: String(p) })}
                    className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-bold transition-colors ${p === page ? 'text-white' : 'bg-card border border-border text-foreground hover:border-orange-400'}`}
                    style={p === page ? { background: '#F06321' } : {}}
                  >
                    {p}
                  </Link>
                )
              })}
            </div>

            {page < pages && (
              <Link href={buildUrl({ page: String(page + 1) })}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-card border border-border text-sm font-semibold text-foreground hover:border-orange-400 transition-colors">
                Next <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}

      </main>
    </div>
  )
}

function PublicChampionshipCard({ championship: c }: { championship: Championship }) {
  const dateStr = c.start_date
    ? new Date(c.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : c.year ? String(c.year) : null

  return (
    <Link href={`/championships/${c.id}`}
      className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 hover:border-orange-400 hover:shadow-lg transition-all duration-200 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{ background: 'linear-gradient(90deg,#F06321,#F5853F)' }} />

      <h3 className="font-display font-bold text-lg text-foreground leading-tight group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors line-clamp-2 pt-1">
        {c.name}
      </h3>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {dateStr && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{dateStr}</span>}
        {c.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{c.location}</span>}
      </div>

      {c.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
      )}

      <div className="flex items-center justify-between pt-1 mt-auto">
        <span className="text-xs font-semibold text-orange-600">View Events →</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
      </div>
    </Link>
  )
}
