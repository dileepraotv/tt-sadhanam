import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { Header } from '@/components/shared/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { createTournament } from '@/lib/actions/tournaments'
import { Trophy } from 'lucide-react'
import { NewTournamentForm } from './NewTournamentForm'

export default async function NewTournamentPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <div className="min-h-screen flex flex-col">
      <Header isAdmin tournamentName="New Tournament" user={user} />

      <main className="flex-1 mx-auto w-full max-w-xl px-4 sm:px-6 py-10">
        <div className="surface-card p-6 sm:p-8">

          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700/60 p-3">
              <Trophy className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold tracking-wide">New Tournament</h1>
              <p className="text-muted-foreground text-sm">Set up the basics — you can add players next.</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tournament Details</CardTitle>
            </CardHeader>
            <CardContent>
              <NewTournamentForm createAction={createTournament} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
