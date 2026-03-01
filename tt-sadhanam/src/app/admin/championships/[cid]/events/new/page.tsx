import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { getUser, createClient } from '@/lib/supabase/server'
import { Header }     from '@/components/shared/Header'
import { Breadcrumb } from '@/components/shared/Breadcrumb'
import { createEvent } from '@/lib/actions/championships'
import { NewEventForm } from './NewEventForm'

interface PageProps { params: { cid: string } }

export default async function NewEventPage({ params }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = createClient()
  const { data: champ } = await supabase
    .from('championships')
    .select('id, name')
    .eq('id', params.cid)
    .eq('created_by', user.id)
    .single()
  if (!champ) notFound()

  async function handleCreate(formData: FormData) {
    'use server'
    await createEvent(params.cid, formData)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header isAdmin user={user} />
      <Breadcrumb
        variant="admin"
        items={[
          { label: 'My Championships', href: '/admin/championships' },
          { label: champ.name, href: `/admin/championships/${params.cid}` },
          { label: 'New Event' },
        ]}
      />

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 sm:px-6 py-10">
        <div className="surface-card p-6 sm:p-8">

          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700/60 p-3">
              <Trophy className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-wide">Add Event</h1>
              <p className="text-muted-foreground text-sm">e.g. Under 13 Boys, Men&apos;s Singles</p>
            </div>
          </div>

          <NewEventForm cid={params.cid} createAction={handleCreate} />

        </div>
      </main>
    </div>
  )
}
