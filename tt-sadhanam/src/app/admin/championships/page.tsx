import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trophy, Calendar, MapPin, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header } from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/index'
import type { Championship } from '@/lib/types'

export const revalidate = 0

export default async function AdminChampionshipsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = createClient()
  const { data } = await supabase
    .from('championships')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  const championships = (data ?? []) as Championship[]

  return (
    <div className="min-h-screen flex flex-col">
      <Header isAdmin user={user} />
      <Breadcrumb variant="admin" items={[{ label: 'My Championships' }]} />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
        <div className="surface-card p-6 sm:p-8">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">My Championships</h1>
              <p className="text-muted-foreground text-sm mt-1">{championships.length} championship{championships.length !== 1 ? 's' : ''}</p>
            </div>
            <Button asChild variant="default" className="w-full sm:w-auto shrink-0">
              <Link href="/admin/championships/new"><Plus className="h-4 w-4" /> New Championship</Link>
            </Button>
          </div>

          {championships.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {championships.map(c => {
                const dateStr = c.start_date
                  ? new Date(c.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  : c.year ? String(c.year) : null

                return (
                  <Link key={c.id}
                    href={`/admin/championships/${c.id}`}
                    className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 hover:border-orange-400 hover:shadow-md transition-all duration-200 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl"
                      style={{ background: c.published ? '#F06321' : '#DDD', opacity: 0.8 }} />

                    <div className="flex items-start justify-between gap-2 pt-1">
                      <h3 className="font-display font-bold text-base text-foreground group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors line-clamp-2">
                        {c.name}
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {c.published
                          ? <><Badge variant="live">Live</Badge><Eye className="h-3.5 w-3.5 text-orange-500" /></>
                          : <><Badge variant="secondary">Draft</Badge><EyeOff className="h-3.5 w-3.5 text-muted-foreground" /></>
                        }
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {dateStr && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{dateStr}</span>}
                      {c.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{c.location}</span>}
                    </div>

                    <div className="flex items-center justify-between pt-1 mt-auto">
                      <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Manage events →</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <Trophy className="h-12 w-12 mx-auto mb-4" style={{ color: '#F06321', opacity: 0.25 }} />
              <p className="text-xl font-bold text-foreground mb-2">No championships yet</p>
              <p className="text-muted-foreground text-sm mb-6">Create your first championship to get started.</p>
              <Button asChild variant="default">
                <Link href="/admin/championships/new"><Plus className="h-4 w-4" /> New Championship</Link>
              </Button>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
