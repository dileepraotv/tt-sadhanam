'use server'

import { revalidatePath } from 'next/cache'
import { redirect }       from 'next/navigation'
import { createClient }   from '@/lib/supabase/server'

// ── Create Championship ───────────────────────────────────────────────────────
export async function createChampionship(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const name       = (formData.get('name') as string)?.trim()
  const description= (formData.get('description') as string)?.trim() || null
  const location   = (formData.get('location') as string)?.trim()  || null
  const year       = formData.get('year') ? parseInt(formData.get('year') as string, 10) : null
  const start_date = (formData.get('start_date') as string) || null
  const end_date   = (formData.get('end_date') as string)   || null

  if (!name) throw new Error('Championship name is required')

  const { data, error } = await supabase
    .from('championships')
    .insert({ name, description, location, year, start_date, end_date, created_by: user.id, published: true })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/')
  redirect(`/admin/championships/${data.id}`)
}

// ── Update Championship ───────────────────────────────────────────────────────
export async function updateChampionship(
  cid: string,
  updates: Partial<{ name: string; description: string | null; location: string | null; year: number | null; start_date: string | null; end_date: string | null }>,
) {
  const supabase = createClient()
  const { error } = await supabase.from('championships').update(updates).eq('id', cid)
  if (error) throw new Error(error.message)
  revalidatePath(`/admin/championships/${cid}`)
  revalidatePath(`/championships/${cid}`)
}

// ── Toggle Championship Publish ───────────────────────────────────────────────
export async function toggleChampionshipPublish(cid: string, published: boolean) {
  const supabase = createClient()
  const { error } = await supabase.from('championships').update({ published }).eq('id', cid)
  if (error) throw new Error(error.message)
  revalidatePath(`/admin/championships/${cid}`)
  revalidatePath(`/championships/${cid}`)
  revalidatePath('/')
}

// ── Delete Championship ───────────────────────────────────────────────────────
export async function deleteChampionship(cid: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('championships').delete()
    .eq('id', cid).eq('created_by', user.id)
  if (error) throw new Error(error.message)

  revalidatePath('/')
  redirect('/admin/championships')
}

// ── Create Event inside Championship ─────────────────────────────────────────
export async function createEvent(cid: string, formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const name        = (formData.get('name') as string)?.trim()
  const format      = (formData.get('format') as string) || 'bo5'
  const date        = (formData.get('date') as string) || null
  const format_type = (formData.get('format_type') as string) || 'single_knockout'

  if (!name) throw new Error('Event name is required')

  // Inherit location from championship
  const { data: champ } = await supabase.from('championships').select('location').eq('id', cid).single()

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      name,
      format,
      date,
      format_type,
      championship_id: cid,
      location: champ?.location ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/championships/${cid}`)
  redirect(`/admin/championships/${cid}/events/${data.id}`)
}

// ── Delete Event inside Championship ──────────────────────────────────────────
export async function deleteEvent(cid: string, eventId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('tournaments')
    .delete()
    .eq('id', eventId)
    .eq('championship_id', cid)
    .eq('created_by', user.id)

  if (error) throw new Error(error.message)

  revalidatePath(`/admin/championships/${cid}`)
  revalidatePath(`/championships/${cid}`)
  // Do NOT call redirect() here — it throws inside client try/catch
  // Navigation is handled by the client component
}
