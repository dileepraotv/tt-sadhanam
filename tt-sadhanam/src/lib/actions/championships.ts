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

  // Verify ownership
  const { data: champ } = await supabase
    .from('championships')
    .select('id')
    .eq('id', cid)
    .eq('created_by', user.id)
    .single()
  if (!champ) throw new Error('Championship not found or not authorized')

  // Load all events in this championship
  const { data: events } = await supabase
    .from('tournaments')
    .select('id')
    .eq('championship_id', cid)

  // Explicitly clean up each event's data (in case DB cascades are incomplete)
  for (const ev of events ?? []) {
    await supabase.from('matches').delete().eq('tournament_id', ev.id)
    await supabase.from('players').delete().eq('tournament_id', ev.id)
    await supabase.from('team_matches').delete().eq('tournament_id', ev.id)
    await supabase.from('teams').delete().eq('tournament_id', ev.id)
    await supabase.from('stages').delete().eq('tournament_id', ev.id)
  }

  // Delete all events (tournaments) in the championship
  await supabase.from('tournaments').delete().eq('championship_id', cid)

  // Delete the championship itself
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

  // Verify ownership before deleting
  const { data: ev } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', eventId)
    .eq('championship_id', cid)
    .eq('created_by', user.id)
    .single()
  if (!ev) throw new Error('Event not found or not authorized')

  // Explicitly clean up data that may not cascade automatically
  // (DB cascades handle most of this, but being explicit is safer)
  await supabase.from('matches').delete().eq('tournament_id', eventId)
  await supabase.from('players').delete().eq('tournament_id', eventId)
  await supabase.from('team_matches').delete().eq('tournament_id', eventId)
  await supabase.from('teams').delete().eq('tournament_id', eventId)
  await supabase.from('stages').delete().eq('tournament_id', eventId)

  // Finally delete the tournament itself
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
