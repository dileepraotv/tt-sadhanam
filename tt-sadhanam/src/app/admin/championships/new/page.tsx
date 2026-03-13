import { redirect } from 'next/navigation'
import { getUser }  from '@/lib/supabase/server'
import { Header }   from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { Trophy }   from 'lucide-react'
import { createChampionship } from '@/lib/actions/championships'
import { NewChampionshipForm } from './NewChampionshipForm'

export default async function NewChampionshipPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const today = new Date().toISOString().split('T')[0]
  const year  = new Date().getFullYear()

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

          <NewChampionshipForm createAction={createChampionship} year={year} today={today} />
        </div>
      </main>
    </div>
  )
}
