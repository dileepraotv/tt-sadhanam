import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { Header } from '@/components/shared/Header'
import { Card, CardContent, CardHeader, CardTitle, Label, Select, SelectContent,
         SelectItem, SelectTrigger, SelectValue } from '@/components/ui/index'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/index'
import { createTournament } from '@/lib/actions/tournaments'
import { Trophy } from 'lucide-react'

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
            <form action={createTournament} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Tournament Name *</Label>
                <Input id="name" name="name" placeholder="e.g. City Open 2025" required />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" name="date" type="date" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" name="location" placeholder="e.g. Sports Hall A" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="format">Match Format *</Label>
                <select
                  name="format"
                  defaultValue="bo5"
                  className="flex h-9 w-full rounded-md border border-input bg-muted/30 px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="bo3">Best of 3 games</option>
                  <option value="bo5">Best of 5 games</option>
                  <option value="bo7">Best of 7 games</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="cyan" className="flex-1">
                  Create Tournament →
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
              </div>
      </main>
    </div>
  )
}
