'use server'

/**
 * actions/stages.ts
 *
 * Stage lifecycle management for multi-stage tournaments.
 *
 * ── LIFECYCLE ─────────────────────────────────────────────────────────────────
 *
 *  pending  →  active  →  complete
 *    ↑                       │
 *    └── resetStage ──────────┘  (admin confirms, wipes matches+games)
 *
 * LOCK RULE:
 *   Stage structure (groups, config) is locked once any RR match has a
 *   completed game. Structural edits — adding/removing groups, changing
 *   advance count — require resetStage() which deletes all match+game data
 *   for that stage and returns it to 'pending'.
 *
 * OWNER CHECK:
 *   Every write verifies the calling user owns the tournament via created_by.
 *   This is belt-and-suspenders: Supabase RLS also enforces this.
 */

import { revalidatePath } from 'next/cache'
import { createClient }   from '@/lib/supabase/server'
import type { MatchFormat, RRStageConfig, KOStageConfig, StageStatus, StageResetLog } from '@/lib/types'

// ── Shared ────────────────────────────────────────────────────────────────────

export async function revalidateTournamentPaths(
  supabase: ReturnType<typeof createClient>,
  tournamentId: string,
) {
  const { data: t } = await supabase
    .from('tournaments')
    .select('championship_id')
    .eq('id', tournamentId)
    .single()

  revalidatePath(`/admin/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}`)
  if (t?.championship_id) {
    revalidatePath(`/admin/championships/${t.championship_id}/events/${tournamentId}`)
    revalidatePath(`/championships/${t.championship_id}/events/${tournamentId}`)
  }
}

async function ownsTournament(
  supabase: ReturnType<typeof createClient>,
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('created_by', userId)
    .maybeSingle()
  return !!data
}

// ─────────────────────────────────────────────────────────────────────────────
// createRRStage
// Creates a stages row + rr_groups rows + sets format_type on the tournament.
// Can only be called when no stage exists yet for this stage_number.
// ─────────────────────────────────────────────────────────────────────────────
export async function createRRStage(input: {
  tournamentId:    string
  stageNumber:     number        // almost always 1
  numberOfGroups:  number        // 1–16
  advanceCount:    number        // 1–4
  matchFormat:     MatchFormat
  allowBestThird:   boolean
  bestThirdCount:   number        // 1–4, ignored if allowBestThird=false
  finalizationRule?: 'require_all' | 'manual'
}): Promise<{ error?: string; stageId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, input.tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Validate
  if (input.numberOfGroups < 1 || input.numberOfGroups > 16) {
    return { error: 'Number of groups must be between 1 and 16' }
  }
  if (input.advanceCount < 1 || input.advanceCount > 4) {
    return { error: 'Advance count must be between 1 and 4' }
  }
  if (input.allowBestThird && (input.bestThirdCount < 1 || input.bestThirdCount > 4)) {
    return { error: 'Best-third count must be between 1 and 4' }
  }

  // Guard: no existing stage at this stage_number
  const { data: existing } = await supabase
    .from('stages')
    .select('id')
    .eq('tournament_id', input.tournamentId)
    .eq('stage_number', input.stageNumber)
    .maybeSingle()
  if (existing) return { error: 'A stage already exists at this position. Reset it first.' }

  const config: RRStageConfig = {
    numberOfGroups:   input.numberOfGroups,
    advanceCount:     input.advanceCount,
    matchFormat:      input.matchFormat,
    allowBestThird:   input.allowBestThird,
    bestThirdCount:   input.allowBestThird ? input.bestThirdCount : 0,
    finalizationRule: input.finalizationRule ?? 'require_all',
  }

  // Insert stage
  const { data: stage, error: stageErr } = await supabase
    .from('stages')
    .insert({
      tournament_id: input.tournamentId,
      stage_number:  input.stageNumber,
      stage_type:    'round_robin',
      config,
      status:        'pending',
    })
    .select('id')
    .single()

  if (stageErr || !stage) return { error: stageErr?.message ?? 'Failed to create stage' }

  // Insert rr_groups (Group A, Group B, …)
  const labels    = 'ABCDEFGHIJKLMNOP'
  const groupRows = Array.from({ length: input.numberOfGroups }, (_, i) => ({
    stage_id:     stage.id,
    name:         `Group ${labels[i] ?? String(i + 1)}`,
    group_number: i + 1,
  }))

  const { error: grpErr } = await supabase.from('rr_groups').insert(groupRows)
  if (grpErr) {
    // rollback stage
    await supabase.from('stages').delete().eq('id', stage.id)
    return { error: grpErr.message }
  }

  // Update tournament RR config columns.
  // NOTE: format_type is intentionally NOT touched here — it was already set
  // correctly by setFormatType() when the user chose their tournament format.
  // Overwriting it here would clobber single_round_robin → multi_rr_to_knockout.
  await supabase.from('tournaments').update({
    rr_groups:        input.numberOfGroups,
    rr_advance_count: input.advanceCount,
  }).eq('id', input.tournamentId)

  await revalidateTournamentPaths(supabase, input.tournamentId)
  return { stageId: stage.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateStageConfig
// Updates config on a stage. Only allowed when no scores have been entered
// (checked by counting completed games for this stage's matches).
// ─────────────────────────────────────────────────────────────────────────────
export async function updateStageConfig(input: {
  stageId:      string
  tournamentId: string
  config:       RRStageConfig | KOStageConfig
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, input.tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  const hasScores = await stageHasScores(supabase, input.stageId)
  if (hasScores) {
    return { error: 'Scores exist for this stage. Reset the stage first.' }
  }

  const { error } = await supabase
    .from('stages')
    .update({ config: input.config })
    .eq('id', input.stageId)

  if (error) return { error: error.message }

  await revalidateTournamentPaths(supabase, input.tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// resetStage
// DESTRUCTIVE: Deletes all matches + games for a stage, removes group members,
// removes groups, and resets stage status to 'pending'.
// Also resets tournament flags (stage1_complete, stage2_bracket_generated).
// Caller should show a confirmation dialog before invoking.
// ─────────────────────────────────────────────────────────────────────────────
export async function resetStage(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string; log?: StageResetLog }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // 1. Delete games for all matches in this stage
  const { data: matchIds } = await supabase
    .from('matches')
    .select('id')
    .eq('stage_id', stageId)

  let gamesDeleted = 0
  if (matchIds && matchIds.length > 0) {
    const { count: gc } = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds.map((m: { id: string }) => m.id))
    gamesDeleted = gc ?? 0

    await supabase
      .from('games')
      .delete()
      .in('match_id', matchIds.map((m: { id: string }) => m.id))
  }

  // 2. Delete matches for this stage
  await supabase.from('matches').delete().eq('stage_id', stageId)

  // 3. Delete group members (FK cascade from rr_groups would handle this
  //    but we do it explicitly for clarity)
  const { data: groups } = await supabase
    .from('rr_groups')
    .select('id')
    .eq('stage_id', stageId)

  if (groups && groups.length > 0) {
    await supabase
      .from('rr_group_members')
      .delete()
      .in('group_id', groups.map(g => g.id))
  }

  // 4. Reset stage status to pending
  await supabase
    .from('stages')
    .update({ status: 'pending' })
    .eq('id', stageId)

  // 5. Reset tournament flags
  await supabase.from('tournaments').update({
    stage1_complete:          false,
    stage2_bracket_generated: false,
    bracket_generated:        false,
    status:                   'setup',
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)

  const log: StageResetLog = {
    stageLabel:     'Group Stage',
    matchesDeleted: matchIds?.length ?? 0,
    gamesDeleted:   gamesDeleted,
    groupsReset:    groups?.length ?? 0,
    timestamp:      new Date().toISOString(),
  }

  return { log }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteStageOnly
// Removes a stage row + its groups (cascades to group_members + matches).
// Unlike deleteStage(), this does NOT reset format_type — used when admin
// wants to reconfigure (go back from "Assign Players" → "Configure").
// Only safe to call when no scores exist (no need to confirm).
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteStageOnly(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Safety: refuse if any scores exist
  const hasScores = await stageHasScores(supabase, stageId)
  if (hasScores) {
    return { error: 'Scores exist — use Reset Stage instead.' }
  }

  // Delete matches (and games via cascade) for this stage
  await supabase.from('matches').delete().eq('stage_id', stageId)

  // Delete group members + groups
  const { data: groups } = await supabase
    .from('rr_groups').select('id').eq('stage_id', stageId)
  if (groups?.length) {
    await supabase.from('rr_group_members')
      .delete().in('group_id', groups.map(g => g.id))
    await supabase.from('rr_groups').delete().eq('stage_id', stageId)
  }

  // Delete stage row
  await supabase.from('stages').delete().eq('id', stageId)

  // Reset tournament flags but keep format_type
  await supabase.from('tournaments').update({
    rr_groups:        1,
    rr_advance_count: 2,
    status:           'setup',
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteStage
// Fully removes a stage + its groups/members/matches. Used when admin wants
// to switch from multi-stage back to single-stage.
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteStage(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const reset = await resetStage(stageId, tournamentId)
  if (reset.error) return reset

  await createClient().from('stages').delete().eq('id', stageId)

  // Reset tournament format type
  await createClient().from('tournaments').update({
    format_type: 'single_knockout',
    rr_groups:   1,
  }).eq('id', tournamentId)

  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// closeStage1
// Marks Stage 1 complete. Validates all RR matches are done first.
// ─────────────────────────────────────────────────────────────────────────────
export async function closeStage1(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Count incomplete (non-bye) RR matches
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId)
    .eq('match_kind', 'round_robin')
    .not('status', 'in', '(complete,bye)')

  if (count && count > 0) {
    return {
      error: `${count} round-robin match${count > 1 ? 'es' : ''} still need results before closing Stage 1.`,
    }
  }

  await supabase.from('stages').update({ status: 'complete' }).eq('id', stageId)
  await supabase.from('tournaments').update({ stage1_complete: true }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// stageHasScores
// Returns true if any game has been entered for any match in this stage.
// Used as the lock-check before allowing structural edits.
// ─────────────────────────────────────────────────────────────────────────────
export async function stageHasScores(
  supabase: ReturnType<typeof createClient>,
  stageId:  string,
): Promise<boolean> {
  // Get match IDs for this stage
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id')
    .eq('stage_id', stageId)

  if (!matchRows || matchRows.length === 0) return false

  const { count } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .in('match_id', matchRows.map(m => m.id))

  return (count ?? 0) > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// getStageHasScores (server action wrapper for client components)
// ─────────────────────────────────────────────────────────────────────────────
export async function getStageHasScores(stageId: string): Promise<boolean> {
  return stageHasScores(createClient(), stageId)
}

// ─────────────────────────────────────────────────────────────────────────────
// getStageResetStats
// Returns a count of matches and games that would be deleted on reset.
// Called by the client BEFORE opening the confirm dialog so the dialog can
// show "this will delete X matches and Y game results".
// Safe to call without auth (read-only, no PII).
// ─────────────────────────────────────────────────────────────────────────────
export async function getStageResetStats(stageId: string): Promise<{
  matchCount:          number
  completedMatchCount: number
  liveMatchCount:      number
  gameCount:           number
}> {
  const supabase = createClient()

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, status')
    .eq('stage_id', stageId)

  const matchIds             = (matchRows ?? []).map((m: { id: string }) => m.id)
  const completedMatchCount  = (matchRows ?? []).filter((m: { status: string }) => m.status === 'complete').length
  const liveMatchCount       = (matchRows ?? []).filter((m: { status: string }) => m.status === 'live').length

  let gameCount = 0
  if (matchIds.length > 0) {
    const { count } = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
    gameCount = count ?? 0
  }

  return {
    matchCount:          matchRows?.length ?? 0,
    completedMatchCount,
    liveMatchCount,
    gameCount,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resetKOStage
// Soft-reset: deletes ONLY the knockout bracket (Stage 2) matches + games,
// WITHOUT touching Stage 1 data (RR groups, members, standings, stage1_complete).
// Allows regenerating the KO bracket while preserving all RR results.
// ─────────────────────────────────────────────────────────────────────────────
export async function resetKOStage(
  koStageId:    string,
  tournamentId: string,
): Promise<{ error?: string; log?: StageResetLog }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Collect stats first for the audit log
  const stats = await getStageResetStats(koStageId)

  // 1. Delete games for KO matches
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id')
    .eq('stage_id', koStageId)

  if (matchRows && matchRows.length > 0) {
    await supabase.from('games').delete().in('match_id', matchRows.map((m: { id: string }) => m.id))
  }

  // 2. Delete KO matches
  await supabase.from('matches').delete().eq('stage_id', koStageId)

  // 3. Delete the KO stage row itself (it will be re-created by generateKnockoutStage)
  await supabase.from('stages').delete().eq('id', koStageId)

  // 4. Reset tournament flag — stage1_complete stays true (RR is still valid)
  await supabase.from('tournaments').update({
    stage2_bracket_generated: false,
    // Do NOT change stage1_complete or bracket_generated for the RR portion
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)

  const log: StageResetLog = {
    stageLabel:     'Knockout Bracket',
    matchesDeleted: stats.matchCount,
    gamesDeleted:   stats.gameCount,
    groupsReset:    0,
    timestamp:      new Date().toISOString(),
  }

  return { log }
}

// ─────────────────────────────────────────────────────────────────────────────
// forceCloseStage1
// Like closeStage1 but bypasses the "all matches complete" requirement.
// Used when finalizationRule = 'manual' and admin explicitly confirms override.
// Returns skippedMatches count so the UI can display what was left incomplete.
// ─────────────────────────────────────────────────────────────────────────────
export async function forceCloseStage1(
  stageId:      string,
  tournamentId: string,
): Promise<{ error?: string; skippedMatches?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Count incomplete (non-bye) RR matches — for the audit log / return value
  const { count: skipped } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId)
    .eq('match_kind', 'round_robin')
    .not('status', 'in', '(complete,bye)')

  await supabase.from('stages').update({ status: 'complete' }).eq('id', stageId)
  await supabase.from('tournaments').update({ stage1_complete: true }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)
  return { skippedMatches: skipped ?? 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// setFormatType
// Switches a tournament between single_knockout and multi_rr_to_knockout.
// Only allowed before any bracket or stage activity has started.
// Called by BracketControls multi-stage toggle.
// ─────────────────────────────────────────────────────────────────────────────
export async function setFormatType(
  tournamentId: string,
  formatType:   'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout',
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Guard: can only change before any bracket activity
  const { data: t } = await supabase
    .from('tournaments')
    .select('bracket_generated, stage1_complete, stage2_bracket_generated')
    .eq('id', tournamentId)
    .single()

  if (t?.bracket_generated || t?.stage1_complete || t?.stage2_bracket_generated) {
    return { error: 'Format cannot be changed after bracket generation has started.' }
  }

  const { error } = await supabase
    .from('tournaments')
    .update({ format_type: formatType })
    .eq('id', tournamentId)

  if (error) return { error: error.message }
  await revalidateTournamentPaths(supabase, tournamentId)
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// resetSingleKOBracket
// For format_type='single_knockout' — deletes all matches+games for the
// tournament WITHOUT touching a stage row (single KO doesn't use the stages
// table). Equivalent to clearing before re-generating the draw.
// Returns stats for the audit toast.
// ─────────────────────────────────────────────────────────────────────────────
export async function resetSingleKOBracket(
  tournamentId: string,
): Promise<{ error?: string; log?: StageResetLog }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!await ownsTournament(supabase, tournamentId, user.id)) {
    return { error: 'Tournament not found' }
  }

  // Collect stats first for the audit log
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, status')
    .eq('tournament_id', tournamentId)

  const matchIds             = (matchRows ?? []).map((m: { id: string }) => m.id)
  const completedMatchCount  = (matchRows ?? []).filter((m: { status: string }) => m.status === 'complete').length

  let gameCount = 0
  if (matchIds.length > 0) {
    const { count } = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
    gameCount = count ?? 0

    await supabase.from('games').delete().in('match_id', matchIds)
  }

  await supabase.from('matches').delete().eq('tournament_id', tournamentId)
  await supabase.from('bracket_slots').delete().eq('tournament_id', tournamentId)

  await supabase.from('tournaments').update({
    bracket_generated: false,
    status:            'setup',
  }).eq('id', tournamentId)

  await revalidateTournamentPaths(supabase, tournamentId)

  const log: StageResetLog = {
    stageLabel:     'Knockout Bracket',
    matchesDeleted: matchRows?.length ?? 0,
    gamesDeleted:   gameCount,
    groupsReset:    0,
    timestamp:      new Date().toISOString(),
  }

  return { log }
}

// ─────────────────────────────────────────────────────────────────────────────
// getKOResetStats
// Returns counts for the admin confirm dialog before clearing a single-KO draw.
// ─────────────────────────────────────────────────────────────────────────────
export async function getKOResetStats(tournamentId: string): Promise<{
  matchCount:          number
  completedMatchCount: number
  liveMatchCount:      number
  gameCount:           number
}> {
  const supabase = createClient()

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, status')
    .eq('tournament_id', tournamentId)

  const matchIds             = (matchRows ?? []).map((m: { id: string }) => m.id)
  const completedMatchCount  = (matchRows ?? []).filter((m: { status: string }) => m.status === 'complete').length
  const liveMatchCount       = (matchRows ?? []).filter((m: { status: string }) => m.status === 'live').length

  let gameCount = 0
  if (matchIds.length > 0) {
    const { count } = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
    gameCount = count ?? 0
  }

  return { matchCount: matchRows?.length ?? 0, completedMatchCount, liveMatchCount, gameCount }
}
