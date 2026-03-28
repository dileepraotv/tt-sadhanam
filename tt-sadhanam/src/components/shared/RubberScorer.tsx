'use client'

/**
 * RubberScorer — shared inline game-score entry for a single team submatch.
 *
 * Used by both:
 *   - TeamGroupKOStage  (Groups + KO formats)
 *   - TeamLeagueStage   (League / single-stage formats)
 *
 * This eliminates duplicated score-entry logic and gives every team event
 * the same consistent inline scoring experience.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Trophy, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { createClient } from '@/lib/supabase/client'
import { saveGameScore, declareMatchWinner, updateMatchFormat } from '@/lib/actions/matches'
import type { MatchFormat } from '@/lib/types'
import { validateGameScore, formatValidationErrors } from '@/lib/scoring/engine'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RubberSubmatch {
  id:               string
  match_order:      number
  label:            string
  player_a_name:    string | null
  player_b_name:    string | null
  match_id:         string | null
  scoring?: {
    id:            string
    player1_games: number
    player2_games: number
    status:        string
  } | null
}

type GameLocal = { s1: string; s2: string }

// ─────────────────────────────────────────────────────────────────────────────
// Validation bridge
// Wraps the canonical scoring engine so call sites keep the same (s1,s2)→string|null
// signature they had before, while the actual rules live in one place.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a TT game score using the canonical scoring engine.
 * Returns a human-readable error string, or null if valid.
 *
 * Previously this was a local duplicate (validateTTScore). Now it delegates
 * to validateGameScore from lib/scoring/engine.ts so there is a single source
 * of truth for table tennis scoring rules across inline team scoring and the
 * full-page individual scoring UI.
 */
function validateScore(s1: number, s2: number): string | null {
  const result = validateGameScore({ score1: s1, score2: s2 })
  if (result.ok) return null
  return formatValidationErrors(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// RubberScorer
// ─────────────────────────────────────────────────────────────────────────────

interface RubberScorerProps {
  submatch:    RubberSubmatch
  /** Display name for side A (team name or player name) */
  nameA:       string
  /** Display name for side B */
  nameB:       string
  tournamentId: string
  matchFormat:  MatchFormat
  onSaved:      () => void
}

export function RubberScorer({
  submatch, nameA, nameB, tournamentId, matchFormat: propFormat, onSaved,
}: RubberScorerProps) {
  const sbRef    = useRef(createClient())
  const supabase = sbRef.current

  const [games,        setGames]       = useState<Array<{id:string;game_number:number;score1:number;score2:number}>>([])
  const [localScores,  setLocal]       = useState<Record<number, GameLocal>>({})
  const [saving,       setSaving]      = useState(false)
  const [loadingG,     setLoadingG]    = useState(true)
  const [editMode,     setEditMode]    = useState(false)
  const [scoreErrors,  setScoreErrors] = useState<Record<number, string>>({})
  const [activeFormat, setActiveFormat] = useState<MatchFormat>(propFormat)

  const loadGames = useCallback(async () => {
    if (!submatch.match_id) { setLoadingG(false); return }
    setLoadingG(true)
    // Also fetch the match's saved format from the matches table
    const [gamesRes, matchRes] = await Promise.all([
      supabase.from('games').select('*').eq('match_id', submatch.match_id).order('game_number'),
      supabase.from('matches').select('match_format').eq('id', submatch.match_id).single(),
    ])
    const { data } = gamesRes
    const gs = data ?? []
    setGames(gs)
    const init: Record<number, GameLocal> = {}
    for (const g of gs) init[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
    setLocal(init)
    setScoreErrors({})
    // Restore the saved match format if available
    if (matchRes?.data?.match_format) {
      setActiveFormat(matchRes.data.match_format as MatchFormat)
    }
    setLoadingG(false)
  }, [submatch.match_id])

  useEffect(() => { loadGames() }, [loadGames])

  const handleEdit = async () => { await loadGames(); setEditMode(true) }
  const handleCancel = async () => { await loadGames(); setEditMode(false) }

  const handleFormatChange = async (fmt: MatchFormat) => {
    setActiveFormat(fmt)
    if (submatch.match_id) await updateMatchFormat(submatch.match_id, fmt)
  }

  const maxGames = activeFormat === 'bo3' ? 3 : activeFormat === 'bo7' ? 7 : 5

  const handleScore = (gn: number, field: 'a' | 'b', val: string) => {
    setLocal(prev => {
      const updated = { ...prev, [gn]: { ...prev[gn] ?? { s1:'', s2:'' }, [field === 'a' ? 's1' : 's2']: val } }
      const row = updated[gn]
      if (row.s1 !== '' && row.s2 !== '') {
        const s1 = parseInt(row.s1, 10), s2 = parseInt(row.s2, 10)
        if (!isNaN(s1) && !isNaN(s2)) {
          const err = validateScore(s1, s2)
          setScoreErrors(prev => ({ ...prev, [gn]: err ?? '' }))
        }
      } else {
        setScoreErrors(prev => { const n = { ...prev }; delete n[gn]; return n })
      }
      return updated
    })
  }

  const handleSave = async () => {
    if (!submatch.match_id) return
    const entries = Array.from({ length: maxGames }, (_, i) => i + 1)
      .map(gn => ({ gn, sc: localScores[gn] }))
      .filter(({ sc }) => sc && !(sc.s1 === '' && sc.s2 === ''))
    if (entries.length === 0) { toast({ title: 'Enter at least one game score', variant: 'warning' }); return }
    for (const { gn, sc } of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) continue
      const err = validateScore(s1, s2)
      if (err) { toast({ title: `Game ${gn}: ${err}`, variant: 'destructive' }); return }
    }
    setSaving(true)
    if (editMode && submatch.scoring?.status === 'complete') {
      const { deleteGameScore } = await import('@/lib/actions/matches')
      for (const g of games) await deleteGameScore(submatch.match_id!, g.game_number)
      await supabase.from('matches').update({
        status: 'pending', winner_id: null, player1_games: 0, player2_games: 0, completed_at: null,
      }).eq('id', submatch.match_id)
    }
    const skippedGames: number[] = []
    for (const { gn, sc } of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) continue
      const res = await saveGameScore(submatch.match_id, gn, s1, s2)
      if (!res.success) {
        if (res.error?.includes('Cannot add') || res.error?.includes('already complete')) {
          skippedGames.push(gn)
          continue
        }
        toast({ title: `Game ${gn}: ${res.error}`, variant: 'destructive' })
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditMode(false)
    
    // Show notification if any games were skipped due to match already being decided
    if (skippedGames.length > 0) {
      const gameText = skippedGames.length === 1 ? 'Game' : 'Games'
      const gameNums = skippedGames.join(', ')
      toast({
        title: `${gameText} ${gameNums} not saved`,
        description: 'Match winner was already decided',
        variant: 'warning',
      })
    }
    
    toast({ title: 'Scores saved', variant: 'success' })
    onSaved()
  }

  const handleDeclareWinner = async (side: 'p1' | 'p2') => {
    if (!submatch.match_id) return
    setSaving(true)
    const res = await declareMatchWinner(submatch.match_id, side, 'declared')
    setSaving(false)
    if (!res.success) { toast({ title: res.error ?? 'Failed', variant: 'destructive' }); return }
    setEditMode(false)
    toast({ title: 'Result saved', variant: 'success' })
    onSaved()
  }

  if (loadingG) return <div className="text-xs text-muted-foreground py-2 px-3">Loading…</div>

  const scoring  = submatch.scoring
  const isDone   = scoring?.status === 'complete'
  const showEntry = !isDone || editMode
  const p1Wins   = scoring?.player1_games ?? 0
  const p2Wins   = scoring?.player2_games ?? 0
  const winnerName = p1Wins > p2Wins ? nameA : nameB

  return (
    <div className="mt-2 rounded-xl border border-border bg-card shadow-sm flex flex-col gap-0 overflow-hidden">

      {/* Format + status header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          {(['bo3','bo5','bo7'] as MatchFormat[]).map(fmt => (
            <button
              key={fmt}
              onClick={() => showEntry && handleFormatChange(fmt)}
              disabled={!showEntry}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',
                activeFormat === fmt
                  ? 'bg-orange-500 text-white'
                  : 'text-muted-foreground hover:text-foreground',
                !showEntry && 'pointer-events-none',
              )}
            >
              {fmt === 'bo3' ? 'Best of 3' : fmt === 'bo5' ? 'Best of 5' : 'Best of 7'}
            </button>
          ))}
        </div>
        {isDone && !editMode && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> {winnerName} wins {p1Wins}–{p2Wins}
            <span className="text-muted-foreground font-normal">·</span>
            <span className="text-muted-foreground font-normal">
              {activeFormat === 'bo3' ? 'Best of 3' : activeFormat === 'bo7' ? 'Best of 7' : 'Best of 5'}
            </span>
          </span>
        )}
        {isDone && !editMode && (
          <button
            onClick={handleEdit}
            disabled={saving}
            className="text-[11px] text-muted-foreground hover:text-orange-500 underline ml-2"
          >
            Edit
          </button>
        )}
      </div>

      {/* Score grid */}
      <div className="p-3 overflow-x-auto">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `minmax(60px,1fr) repeat(${maxGames}, 40px)`, minWidth: 'fit-content' }}
        >
          {/* Header row */}
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide py-1">Player</div>
          {Array.from({ length: maxGames }, (_, i) => (
            <div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-1 font-bold">
              G{i+1}
            </div>
          ))}

          {/* Side A */}
          <div className={cn(
            'text-xs font-semibold py-1 truncate self-center',
            isDone && p1Wins > p2Wins ? 'text-emerald-600 dark:text-emerald-400' : '',
            isDone && p1Wins < p2Wins ? 'text-muted-foreground' : '',
          )}>
            {p1Wins > p2Wins && isDone && <span className="mr-1">🏆</span>}
            {nameA}
          </div>
          {Array.from({ length: maxGames }, (_, i) => {
            const gn = i + 1
            const stored = games.find(g => g.game_number === gn)
            const aWon = stored ? stored.score1 > stored.score2 : false
            return (
              <input key={gn} type="number" min={0} max={99}
                value={showEntry ? (localScores[gn]?.s1 ?? '') : (stored ? String(stored.score1) : '')}
                onChange={e => handleScore(gn, 'a', e.target.value)}
                disabled={!showEntry || saving}
                className={cn(
                  'w-full text-center text-sm font-bold py-1.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                  !showEntry && aWon ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : '',
                  !showEntry && !aWon && stored ? 'border-transparent bg-muted/30 text-muted-foreground' : '',
                  showEntry ? 'border-border bg-background' : '',
                  saving && 'opacity-40',
                )}
              />
            )
          })}

          {/* Side B */}
          <div className={cn(
            'text-xs font-semibold py-1 truncate self-center',
            isDone && p2Wins > p1Wins ? 'text-emerald-600 dark:text-emerald-400' : '',
            isDone && p2Wins < p1Wins ? 'text-muted-foreground' : '',
          )}>
            {p2Wins > p1Wins && isDone && <span className="mr-1">🏆</span>}
            {nameB}
          </div>
          {Array.from({ length: maxGames }, (_, i) => {
            const gn = i + 1
            const stored = games.find(g => g.game_number === gn)
            const bWon = stored ? stored.score2 > stored.score1 : false
            return (
              <input key={gn} type="number" min={0} max={99}
                value={showEntry ? (localScores[gn]?.s2 ?? '') : (stored ? String(stored.score2) : '')}
                onChange={e => handleScore(gn, 'b', e.target.value)}
                disabled={!showEntry || saving}
                className={cn(
                  'w-full text-center text-sm font-bold py-1.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                  !showEntry && bWon ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : '',
                  !showEntry && !bWon && stored ? 'border-transparent bg-muted/30 text-muted-foreground' : '',
                  showEntry ? 'border-border bg-background' : '',
                  saving && 'opacity-40',
                )}
              />
            )
          })}
        </div>

        {/* Validation errors */}
        {Object.entries(scoreErrors).filter(([, e]) => e).map(([gn, err]) => (
          <p key={gn} className="text-xs text-destructive flex items-center gap-1 mt-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Game {gn}: {err}
          </p>
        ))}
      </div>

      {/* Actions */}
      {showEntry && (
        <div className="flex items-center gap-2 flex-wrap px-3 pb-3">
          <Button size="sm" onClick={handleSave} disabled={saving}
            className="gap-1.5 h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white">
            {saving ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3 w-3" />}
            {editMode ? 'Update Scores' : 'Save Scores'}
          </Button>
          {editMode && (
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={saving} className="h-8 text-xs">
              Cancel
            </Button>
          )}
          <span className="text-xs text-muted-foreground">or declare:</span>
          <Button size="sm" variant="outline" onClick={() => handleDeclareWinner('p1')} disabled={saving}
            className="h-8 text-xs gap-1">
            <Trophy className="h-3 w-3 text-amber-500" /> {nameA} wins
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleDeclareWinner('p2')} disabled={saving}
            className="h-8 text-xs gap-1">
            <Trophy className="h-3 w-3 text-amber-500" /> {nameB} wins
          </Button>
        </div>
      )}
    </div>
  )
}
