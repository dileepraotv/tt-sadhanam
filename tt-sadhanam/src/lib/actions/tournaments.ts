'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { MatchFormat } from '@/lib/types'

// ── Create Tournament ─────────────────────────────────────────────────────────
export async function createTournament(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const name     = formData.get('name') as string
  const location = formData.get('location') as string | null
  const date     = formData.get('date') as string | null
  const format   = formData.get('format') as MatchFormat

  if (!name?.trim()) throw new Error('Tournament name is required')

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      name:       name.trim(),
      location:   location?.trim() || null,
      date:       date || null,
      format,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  redirect(`/admin/tournaments/${data.id}`)
}

// ── Update Tournament ─────────────────────────────────────────────────────────
export async function updateTournament(
  tournamentId: string,
  updates: Partial<{ name: string; location: string | null; date: string | null; format: MatchFormat; description: string | null }>,
) {
  const supabase = createClient()
  const { error } = await supabase
    .from('tournaments')
    .update(updates)
    .eq('id', tournamentId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/tournaments/${tournamentId}`)
}

// ── Toggle Publish ────────────────────────────────────────────────────────────
export async function togglePublish(tournamentId: string, published: boolean) {
  const supabase = createClient()
  const { error } = await supabase
    .from('tournaments')
    .update({ published, status: published ? 'active' : 'setup' })
    .eq('id', tournamentId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath('/')
}

// ── Delete Tournament ─────────────────────────────────────────────────────────
export async function deleteTournament(tournamentId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Verify ownership before deleting
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, created_by')
    .eq('id', tournamentId)
    .eq('created_by', user.id)
    .single()

  if (!tournament) throw new Error('Tournament not found or you do not own it')

  const { error } = await supabase
    .from('tournaments')
    .delete()
    .eq('id', tournamentId)
    .eq('created_by', user.id)   // double-check ownership in the delete itself

  if (error) throw new Error(error.message)

  revalidatePath('/')
  redirect('/')
}

// ── Generate Bracket ──────────────────────────────────────────────────────────
export async function generateBracketAction(tournamentId: string) {
  const supabase    = createClient()
  const { generateBracket } = await import('@/lib/bracket/engine')
  const { getRoundName, totalRoundsForSize } = await import('@/lib/utils')

  // Load tournament + players
  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single()
  if (tErr || !tournament) throw new Error('Tournament not found')

  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
  if (pErr) throw new Error(pErr.message)
  if (!players || players.length < 2) throw new Error('Need at least 2 players')

  // Clear any existing bracket data
  await supabase.from('bracket_slots').delete().eq('tournament_id', tournamentId)
  await supabase.from('games').delete().in(
    'match_id',
    (await supabase.from('matches').select('id').eq('tournament_id', tournamentId)).data?.map(m => m.id) ?? [],
  )
  await supabase.from('matches').delete().eq('tournament_id', tournamentId)

  // Generate
  const result = generateBracket(players, Date.now())
  const { bracketSize, totalRounds, slots, firstRoundMatches } = result

  // Insert bracket slots
  const { error: slotErr } = await supabase.from('bracket_slots').insert(
    slots.map(s => ({
      tournament_id: tournamentId,
      slot_number:   s.slotNumber,
      player_id:     s.player?.id ?? null,
      is_bye:        s.isBye,
    })),
  )
  if (slotErr) throw new Error(slotErr.message)

  // We need to create ALL match rows across all rounds in one pass so
  // next_match_id foreign keys can be resolved.
  // Strategy: generate all match IDs upfront, then insert with wired FKs.

  const crypto = require('crypto')
  // Build match ID grid: matchIds[round-1][matchNumber-1]
  const matchIds: string[][] = []
  let matchesPerRound = firstRoundMatches.length
  for (let r = 0; r < totalRounds; r++) {
    matchIds.push(Array.from({ length: matchesPerRound }, () => crypto.randomUUID()))
    matchesPerRound = Math.ceil(matchesPerRound / 2)
  }

  const matchRows: Record<string, unknown>[] = []

  // Round 1
  firstRoundMatches.forEach((m, i) => {
    const nextMatchId = totalRounds > 1
      ? matchIds[1][m.nextMatchIndex]
      : null

    const slot1Player = m.slot1.isBye ? null : m.slot1.player
    const slot2Player = m.slot2.isBye ? null : m.slot2.player

    matchRows.push({
      id:            matchIds[0][i],
      tournament_id: tournamentId,
      round:         1,
      match_number:  m.matchNumber,
      player1_id:    slot1Player?.id ?? null,
      player2_id:    slot2Player?.id ?? null,
      player1_games: 0,
      player2_games: 0,
      winner_id:     m.isBye ? (slot1Player?.id ?? slot2Player?.id ?? null) : null,
      status:        m.isBye ? 'bye' : 'pending',
      next_match_id: nextMatchId,
      next_slot:     m.nextSlot,
      round_name:    m.roundName,
    })
  })

  // Rounds 2..N (empty shells; players fill in as winners advance)
  for (let r = 2; r <= totalRounds; r++) {
    const count = matchIds[r - 1].length
    for (let m = 0; m < count; m++) {
      const nextMatchId = r < totalRounds ? matchIds[r][Math.floor(m / 2)] : null
      const nextSlot: 1 | 2  = (m % 2 === 0) ? 1 : 2
      matchRows.push({
        id:            matchIds[r - 1][m],
        tournament_id: tournamentId,
        round:         r,
        match_number:  m + 1,
        player1_id:    null,
        player2_id:    null,
        player1_games: 0,
        player2_games: 0,
        winner_id:     null,
        status:        'pending',
        next_match_id: nextMatchId,
        next_slot:     nextSlot,
        round_name:    getRoundName(r, totalRounds),
      })
    }
  }

  const { error: matchErr } = await supabase.from('matches').insert(matchRows)
  if (matchErr) throw new Error(matchErr.message)

  // Auto-advance BYE matches
  const byeMatches = matchRows.filter(m => m.status === 'bye')
  for (const bm of byeMatches) {
    if (bm.next_match_id && bm.winner_id) {
      const col = bm.next_slot === 1 ? 'player1_id' : 'player2_id'
      await supabase.from('matches').update({ [col]: bm.winner_id }).eq('id', bm.next_match_id)
    }
  }

  // Mark tournament bracket as generated + auto-publish
  await supabase.from('tournaments').update({ bracket_generated: true, status: 'active', published: true }).eq('id', tournamentId)

  revalidatePath(`/admin/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath('/')
}
