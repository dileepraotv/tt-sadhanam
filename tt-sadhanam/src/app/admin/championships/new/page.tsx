import { redirect } from 'next/navigation'
import { getUser }  from '@/lib/supabase/server'
import { Header }   from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Button }   from '@/components/ui/button'
import { Trophy }   from 'lucide-react'
import { createChampionship } from '@/lib/actions/championships'

export default async function NewChampionshipPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <div className="min-h-screen flex flex-col">
      <Header isAdmin tournamentName="New Championship" user={user} />
      <Breadcrumb
        variant="admin"
        items={[
          { label: 'My Championships', href: '/admin/championships' },
          { label: 'New Championship' },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-xl px-4 sm:px-6 py-10">
        <div className="surface-card p-6 sm:p-8">

          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700/60 p-3">
              <Trophy className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold tracking-wide">New Championship</h1>
              <p className="text-muted-foreground text-sm">Top-level event container. Add categories/events inside.</p>
            </div>
          </div>

          <form action={createChampionship} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-semibold text-foreground">Championship Name *</label>
              <input
                id="name" name="name" required
                placeholder="e.g. National Championships 2026"
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="description" className="text-sm font-semibold text-foreground">Description</label>
              <textarea
                id="description" name="description" rows={2}
                placeholder="Brief description (optional)"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="location" className="text-sm font-semibold text-foreground">Location</label>
                <input
                  id="location" name="location"
                  placeholder="e.g. Bengaluru"
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="year" className="text-sm font-semibold text-foreground">Year</label>
                <input
                  id="year" name="year" type="number"
                  placeholder={String(new Date().getFullYear())}
                  defaultValue={new Date().getFullYear()}
                  min="2000" max="2099"
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="start_date" className="text-sm font-semibold text-foreground">Start Date</label>
                <input
                  id="start_date" name="start_date" type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="end_date" className="text-sm font-semibold text-foreground">End Date</label>
                <input
                  id="end_date" name="end_date" type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" variant="default" className="flex-1">
                Create Championship →
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
