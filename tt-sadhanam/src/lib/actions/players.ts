'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Revalidate all paths that could show this tournament's data
async function revalidateTournament(tournamentId: string) {
  const supabase = createClient()
  // Look up championship_id so we can revalidate both route trees
  const { data: t } = await supabase
    .from('tournaments')
    .select('championship_id')
    .eq('id', tournamentId)
    .single()

  revalidatePath(`/admin/tournaments/${tournamentId}`)
  if (t?.championship_id) {
    revalidatePath(`/admin/championships/${t.championship_id}/events/${tournamentId}`)
    revalidatePath(`/championships/${t.championship_id}/events/${tournamentId}`)
  }
}

// ── Add single player ─────────────────────────────────────────────────────────
export async function addPlayer(tournamentId: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = createClient()
  const name    = (formData.get('name') as string)?.trim()
  const club    = (formData.get('club') as string)?.trim() || null
  const seedRaw = formData.get('seed') as string
  const seed    = seedRaw ? parseInt(seedRaw, 10) : null

  // Validate name
  if (!name) return { error: 'Player name is required' }
  if (name.length < 2) return { error: 'Name must be at least 2 characters' }
  if (seed && (seed < 1 || seed > 64)) return { error: 'Seed must be between 1 and 64' }

  // Check seed uniqueness before insert (avoid DB crash)
  if (seed) {
    const { data: existing } = await supabase
      .from('players')
      .select('id, name')
      .eq('tournament_id', tournamentId)
      .eq('seed', seed)
      .maybeSingle()
    if (existing) return { error: `Seed ${seed} is already assigned to ${existing.name}` }
  }

  // Check duplicate name
  const { data: dupName } = await supabase
    .from('players')
    .select('id')
    .eq('tournament_id', tournamentId)
    .ilike('name', name)
    .maybeSingle()
  if (dupName) return { error: `A player named "${name}" already exists` }

  const { error } = await supabase.from('players').insert({
    tournament_id: tournamentId,
    name,
    club,
    seed: seed || null,
  })
  if (error) return { error: error.message }

  await revalidateTournament(tournamentId)
  return {}
}

// ── Bulk add players from multiline text ──────────────────────────────────────
export async function bulkAddPlayers(tournamentId: string, text: string): Promise<{ error?: string; count?: number }> {
  const supabase = createClient()

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { error: 'No player names provided' }

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  if ((count ?? 0) + lines.length > 256) return { error: 'Would exceed 256 player limit' }

  const rows = lines.map(line => {
    const parts   = line.split('|').map(p => p.trim())
    const name    = parts[0] ?? ''
    const club    = parts[1] || null
    const rawSeed = parts[2]
    const seed    = rawSeed ? parseInt(rawSeed, 10) : null
    const validSeed = seed && seed >= 1 && seed <= 64 ? seed : null
    return { tournament_id: tournamentId, name, club, seed: validSeed }
  }).filter(r => r.name.trim().length >= 1)

  if (!rows.length) return { error: 'No valid player names found' }

  // Validate names are not blank
  const blankNames = rows.filter(r => !r.name.trim())
  if (blankNames.length > 0) return { error: 'Some entries have empty names' }

  const { error } = await supabase.from('players').insert(rows)
  // Handle unique constraint violations gracefully
  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      return { error: 'Some seeds are already taken — remove duplicate seeds and try again' }
    }
    return { error: error.message }
  }

  await revalidateTournament(tournamentId)
  return { count: rows.length }
}

// ── Update player seed ────────────────────────────────────────────────────────
export async function updatePlayerSeed(
  tournamentId: string,
  playerId: string,
  seed: number | null,
): Promise<{ error?: string }> {
  const supabase = createClient()

  if (seed) {
    // Unset any existing player with this seed first
    await supabase
      .from('players')
      .update({ seed: null })
      .eq('tournament_id', tournamentId)
      .eq('seed', seed)
      .neq('id', playerId)
  }

  const { error } = await supabase
    .from('players')
    .update({ seed })
    .eq('id', playerId)
  if (error) return { error: error.message }

  await revalidateTournament(tournamentId)
  return {}
}

// ── Delete player ─────────────────────────────────────────────────────────────
export async function deletePlayer(tournamentId: string, playerId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { error } = await supabase.from('players').delete().eq('id', playerId)
  if (error) return { error: error.message }
  await revalidateTournament(tournamentId)
  return {}
}

// ── Update player name/club ───────────────────────────────────────────────────
export async function updatePlayer(
  tournamentId: string,
  playerId: string,
  updates: { name?: string; club?: string | null },
): Promise<{ error?: string }> {
  const supabase = createClient()

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim()
    if (!trimmed || trimmed.length < 2) return { error: 'Name must be at least 2 characters' }
    updates.name = trimmed
  }

  const { error } = await supabase.from('players').update(updates).eq('id', playerId)
  if (error) return { error: error.message }
  await revalidateTournament(tournamentId)
  return {}
}

// ── Bulk add players from Excel/CSV sheet data ────────────────────────────────
// Called after client-side parsing; receives already-normalised rows.
export async function bulkAddPlayersFromSheet(
  tournamentId: string,
  rows: Array<{
    name:           string
    club?:          string | null
    seed?:          number | null
    preferredGroup?: number | null   // 1=A, 2=B, …
  }>,
): Promise<{ error?: string; count?: number; rowErrors?: Record<number, string> }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  if (!rows.length) return { error: 'No rows provided' }

  // Load existing players to check for duplicates / seed collisions
  const { data: existing } = await supabase
    .from('players')
    .select('id, name, seed')
    .eq('tournament_id', tournamentId)

  const existingNames = new Set((existing ?? []).map(p => p.name.toLowerCase()))
  const existingSeeds = new Set((existing ?? []).filter(p => p.seed).map(p => p.seed))

  if ((existing?.length ?? 0) + rows.length > 256) {
    return { error: `Would exceed 256 player limit (currently ${existing?.length ?? 0}, adding ${rows.length})` }
  }

  // Per-row validation
  const rowErrors: Record<number, string> = {}
  const seenNames = new Set<string>()
  const seenSeeds = new Set<number>()

  const validRows: Array<{
    tournament_id:   string
    name:            string
    club:            string | null
    seed:            number | null
    preferred_group: number | null
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const name = r.name?.trim()
    if (!name || name.length < 1) { rowErrors[i] = 'Name is required'; continue }

    const nameLower = name.toLowerCase()
    if (existingNames.has(nameLower) || seenNames.has(nameLower)) {
      rowErrors[i] = `"${name}" already exists`; continue
    }

    let seed: number | null = r.seed ?? null
    if (seed !== null) {
      if (!Number.isInteger(seed) || seed < 1 || seed > 64) {
        rowErrors[i] = `Seed must be 1–64 (got ${seed})`; continue
      }
      if (existingSeeds.has(seed) || seenSeeds.has(seed)) {
        rowErrors[i] = `Seed ${seed} is already taken`; continue
      }
      seenSeeds.add(seed)
    }

    seenNames.add(nameLower)
    validRows.push({
      tournament_id:   tournamentId,
      name,
      club:            r.club?.trim() || null,
      seed:            seed,
      preferred_group: r.preferredGroup ?? null,
    })
  }

  if (!validRows.length) {
    return { error: 'No valid rows to insert', rowErrors }
  }

  const { error } = await supabase.from('players').insert(validRows)
  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      return { error: 'Duplicate seed conflict — check your seeding values', rowErrors }
    }
    return { error: error.message, rowErrors }
  }

  await revalidateTournament(tournamentId)
  return { count: validRows.length, rowErrors: Object.keys(rowErrors).length ? rowErrors : undefined }
}
