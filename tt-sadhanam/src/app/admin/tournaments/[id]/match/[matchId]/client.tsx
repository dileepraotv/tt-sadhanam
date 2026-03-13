'use client'

/**
 * Match scoring UI — redesigned with:
 *  • Per-match format selector (bo3 / bo5 / bo7) — no longer set at event level
 *  • Bulk save: fill ALL game scores, one Save button
 *  • Declare winner visible directly (no expand needed)
 *  • No "Mark Live" button — status transitions automatically on first save
 *  • Consistent header with round context
 */

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trophy, Save, Trash2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Match, Game, Tournament } from '@/lib/types'
import type { MatchFormat } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { saveGameScore, deleteGameScore, declareMatchWinner, updateMatchFormat } from '@/lib/actions/matches'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import {
  validateGameScore,
  computeMatchState,
  inferGameNumbersToShow,
} from '@/lib/scoring/engine'
import { FORMAT_CONFIGS } from '@/lib/scoring/types'
import type { ComputedMatchState } from '@/lib/scoring/types'
import { useLoading } from '@/components/shared/GlobalLoader'

interface LocalScore { s1: string; s2: string }

interface MatchScoringClientProps {
  initialMatch:  Match
  initialGames:  Game[]
  tournament:    Tournament
  backHref?:     string
  groupName?:    string | null
  matchKind?:    'knockout' | 'round_robin'
}

export function MatchScoringClient({ initialMatch, initialGames, tournament, backHref, groupName, matchKind = 'knockout' }: MatchScoringClientProps) {
  const [match, setMatch]   = useState<Match>(initialMatch)
  const [games, setGames]   = useState<Game[]>(initialGames)
  const [scores, setScores] = useState<Record<number, LocalScore>>(
    () => initialGames.reduce<Record<number, LocalScore>>((acc, g) => {
      acc[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
      return acc
    }, {}),
  )
  const [isPending, startTransition] = useTransition()
  const { setLoading }               = useLoading()
  const router                       = useRouter()
  const supabase                     = createClient()

  // Effective format: per-match override or tournament default
  const tournamentFormat = tournament.format as MatchFormat
  const [activeFormat, setActiveFormat] = useState<MatchFormat>(
    (match as unknown as { match_format?: MatchFormat | null }).match_format ?? tournamentFormat,
  )

  // Sync games from server on re-render
  useEffect(() => {
    if (initialGames.length === 0) return
    setGames(prev => {
      let next = [...prev]
      for (const sg of initialGames) {
        const optIdx  = next.findIndex(g => g.game_number === sg.game_number && g.id.startsWith('optimistic-'))
        const realIdx = next.findIndex(g => g.id === sg.id)
        if (optIdx !== -1)       next[optIdx] = sg
        else if (realIdx === -1) next.push(sg)
        else                     next[realIdx] = sg
      }
      return next.sort((a, b) => a.game_number - b.game_number)
    })
  }, [initialGames])

  useEffect(() => {
    setMatch(prev => ({ ...prev, ...initialMatch }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMatch.status, initialMatch.player1_games, initialMatch.player2_games, initialMatch.winner_id])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`admin-match-${match.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${match.id}` },
        (p) => setMatch(prev => ({ ...prev, ...p.new as Partial<Match> })))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (p) => {
          const g = p.new as Game
          setGames(prev => {
            const filtered = prev.filter(x => x.game_number !== g.game_number || x.id === g.id)
            return filtered.find(x => x.id === g.id) ? filtered : [...filtered, g].sort((a, b) => a.game_number - b.game_number)
          })
          setScores(prev => ({ ...prev, [g.game_number]: { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') } }))
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (p) => {
          const g = p.new as Game
          setGames(prev => prev.map(x => x.id === g.id ? { ...x, ...g } : x))
          setScores(prev => ({ ...prev, [g.game_number]: { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') } }))
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (p) => {
          const del = p.old as { id: string; game_number: number }
          setGames(prev => prev.filter(x => x.id !== del.id))
          setScores(prev => { const n = { ...prev }; delete n[del.game_number]; return n })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id])

  // Format change
  const handleFormatChange = (fmt: MatchFormat) => {
    setActiveFormat(fmt)
    setLoading(true)
    startTransition(async () => {
      const res = await updateMatchFormat(match.id, fmt)
      setLoading(false)
      if (!res.success) {
        toast({ title: 'Could not update format', description: res.error, variant: 'destructive' })
        setActiveFormat((match as unknown as { match_format?: MatchFormat | null }).match_format ?? tournamentFormat)
      } else {
        toast({ title: `Format: ${FORMAT_CONFIGS[fmt].label}` })
      }
    })
  }

  const cfg        = FORMAT_CONFIGS[activeFormat]
  const isTeamSub  = (match as unknown as { match_kind?: string }).match_kind === 'team_submatch'
  const _ep1       = match.player1_id ?? (isTeamSub ? 'TEAM_A' : null)
  const _ep2       = match.player2_id ?? (isTeamSub ? 'TEAM_B' : null)
  const matchState = computeMatchState(games, activeFormat, _ep1, _ep2)
  const gameNumbers = inferGameNumbersToShow(games, activeFormat, _ep1, _ep2)
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const p1 = match.player1
  const p2 = match.player2

  const handleScoreChange = (gameNum: number, player: 1 | 2, value: string) => {
    setScores(prev => ({
      ...prev,
      [gameNum]: { ...(prev[gameNum] ?? { s1: '', s2: '' }), [player === 1 ? 's1' : 's2']: value },
    }))
  }

  // Bulk save all filled scores
  const handleSaveAll = useCallback(() => {
    const toSave: Array<{ gameNum: number; s1: number; s2: number }> = []
    for (const gameNum of gameNumbers) {
      const local = scores[gameNum]
      if (!local || (local.s1 === '' && local.s2 === '')) continue
      if (local.s1 === '' || local.s2 === '') {
        toast({ title: 'Incomplete score', description: `Game ${gameNum}: fill both scores.`, variant: 'destructive' })
        return
      }
      const s1 = parseInt(local.s1, 10)
      const s2 = parseInt(local.s2, 10)
      if (isNaN(s1) || isNaN(s2)) {
        toast({ title: 'Invalid number', description: `Game ${gameNum}: enter valid scores.`, variant: 'destructive' })
        return
      }
      const vr = validateGameScore({ score1: s1, score2: s2 })
      if (!vr.ok) {
        const msg = vr.errors[0]?.message ?? 'invalid score'
        toast({ title: `Game ${gameNum} invalid`, description: msg, variant: 'destructive' })
        return
      }
      toSave.push({ gameNum, s1, s2 })
    }
    if (toSave.length === 0) {
      toast({ title: 'No scores to save', description: 'Enter at least one game score.' })
      return
    }
    setLoading(true)
    startTransition(async () => {
      for (const { gameNum, s1, s2 } of toSave) {
        const res = await saveGameScore(match.id, gameNum, s1, s2)
        if (!res.success) {
          setLoading(false)
          toast({ title: `Game ${gameNum} failed`, description: res.error, variant: 'destructive' })
          return
        }
        setGames(prev => {
          const fake: Game = {
            id: `optimistic-${gameNum}`, match_id: match.id, game_number: gameNum,
            score1: s1, score2: s2,
            winner_id: s1 > s2 ? (match.player1_id ?? '') : (match.player2_id ?? ''),
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }
          const ex = prev.find(g => g.game_number === gameNum)
          return ex ? prev.map(g => g.game_number === gameNum ? { ...g, ...fake } : g) : [...prev, fake].sort((a, b) => a.game_number - b.game_number)
        })
      }
      setLoading(false)
      toast({ title: `${toSave.length} game${toSave.length > 1 ? 's' : ''} saved ✓` })
      router.refresh()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, gameNumbers, match.id])

  const handleDeleteGame = useCallback((gameNum: number) => {
    setLoading(true)
    startTransition(async () => {
      const res = await deleteGameScore(match.id, gameNum)
      setLoading(false)
      if (!res.success) {
        toast({ title: 'Delete failed', description: res.error, variant: 'destructive' })
      } else {
        setScores(prev => { const n = { ...prev }; delete n[gameNum]; return n })
        toast({ title: `Game ${gameNum} removed` })
        router.refresh()
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id])

  const [declareReason, setDeclareReason] = useState<'walkover' | 'injury' | 'declared'>('walkover')
  // 'p1' or 'p2' — using slot key, NOT the DB player ID (which can be null for team subs)
  const [selectedWinnerSlot, setSelectedWinnerSlot] = useState<'p1' | 'p2' | null>(null)
  
  const handleDeclareWinner = (winnerId: string) => {
    setLoading(true)
    startTransition(async () => {
      const res = await declareMatchWinner(match.id, winnerId, declareReason)
      setLoading(false)
      if (!res.success) toast({ title: 'Error', description: res.error, variant: 'destructive' })
      else { toast({ title: 'Winner declared ✓' }); router.refresh() }
    })
  }

  const hasDirty = gameNumbers.some(gn => {
    const local = scores[gn]
    if (!local || (local.s1 === '' && local.s2 === '')) return false
    const saved = games.find(g => g.game_number === gn)
    if (!saved) return true
    return String(saved.score1 ?? '') !== local.s1 || String(saved.score2 ?? '') !== local.s2
  })

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-orange-600/40" style={{ background: '#F06321' }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-3 sm:px-4">
          <Link
            href={backHref ?? `/admin/tournaments/${tournament.id}?tab=stages`}
            className="flex items-center gap-2 text-white bg-white/20 hover:bg-white/30 active:bg-white/40 border border-white/30 transition-colors rounded-xl px-4 py-2.5 font-bold text-sm shrink-0 touch-manipulation min-h-[44px] min-w-[80px]"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </Link>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={cn(
              'shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
              matchKind === 'round_robin'
                ? 'bg-blue-100/20 border-blue-200/40 text-blue-100'
                : 'bg-white/10 border-white/30 text-white/90',
            )}>
              {matchKind === 'round_robin' ? 'RR' : 'KO'}
            </span>
            <span className="font-display font-medium tracking-wide text-sm truncate text-white">
              {groupName
                ? `${groupName} · Match ${match.match_number}`
                : (match.round_name ?? `Round ${match.round}`)
              }
            </span>
          </div>
          <div className="shrink-0">
            {isLive && <LiveBadge />}
            {isComplete && (
              <Badge variant="success" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Done
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6">
        <div className="surface-card p-4 sm:p-6 flex flex-col gap-5">

          {/* Scoreboard */}
          <ScoreboardHeader match={match} matchState={matchState} activeFormat={activeFormat} isComplete={isComplete} isLive={isLive} />

          {/* Format selector */}
          {!isComplete && (
            <div className="flex items-center gap-3 px-1 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground shrink-0">Format:</span>
              <div className="flex gap-1.5 flex-wrap">
                {(['bo3', 'bo5', 'bo7'] as MatchFormat[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => activeFormat !== fmt && handleFormatChange(fmt)}
                    disabled={isPending || isComplete}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-bold border transition-colors',
                      activeFormat === fmt
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-card border-border text-muted-foreground hover:border-orange-400 hover:text-foreground',
                    )}
                  >
                    {FORMAT_CONFIGS[fmt].label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground/60 hidden sm:block">
                First to {cfg.gamesNeeded} games wins · up to {cfg.maxGames} games
              </span>
            </div>
          )}

          {/* No players yet */}
          {(!p1 && !p2 && !isTeamSub) && (
            <div className="info-banner">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              Waiting for both players to be determined before scores can be entered.
            </div>
          )}

          {/* Game score entry */}
          {(p1 || p2 || isTeamSub || games.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>Game Scores</span>
                  <span className="text-xs font-normal text-muted-foreground font-sans">
                    To 11 points · win by 2
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {/* Column header */}
                <div className="grid grid-cols-[28px_1fr_14px_1fr_44px] sm:grid-cols-[36px_1fr_16px_1fr_52px] gap-1.5 sm:gap-2 items-center pb-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-center">#</span>
                  <span className="text-xs font-medium text-foreground text-center truncate">{p1?.name ?? 'Player 1'}</span>
                  <span />
                  <span className="text-xs font-medium text-foreground text-center truncate">{p2?.name ?? 'Player 2'}</span>
                  <span />
                </div>

                {gameNumbers.map(gameNum => (
                  <GameRow
                    key={gameNum}
                    gameNum={gameNum}
                    savedGame={games.find(g => g.game_number === gameNum) ?? null}
                    localScore={scores[gameNum] ?? { s1: '', s2: '' }}
                    match={match}
                    matchState={matchState}
                    activeFormat={activeFormat}
                    isMatchComplete={isComplete}
                    isTeamSubmatch={isTeamSub}
                    isPending={isPending}
                    onScoreChange={handleScoreChange}
                    onDelete={handleDeleteGame}
                    onReset={(gn) => {
                      const saved = games.find(g => g.game_number === gn)
                      if (saved) setScores(prev => ({ ...prev, [gn]: { s1: String(saved.score1 ?? ''), s2: String(saved.score2 ?? '') } }))
                    }}
                  />
                ))}

                {/* Bulk save button — always available for editing */}
                <div className="pt-3 border-t border-border/40 mt-2 flex flex-col gap-2">
                  <Button
                    className="w-full gap-2 font-bold text-sm"
                    style={{ background: '#F06321', color: '#fff' }}
                    onClick={handleSaveAll}
                    disabled={isPending}
                  >
                    <Save className="h-4 w-4" />
                    {isComplete ? 'Update Scores' : 'Save All Scores'}
                  </Button>
                  {!hasDirty && games.length > 0 && (
                    <p className="text-[11px] text-center text-muted-foreground">All scores saved</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Declare winner — select player, then confirm */}
          {!isComplete && (p1 && p2) && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex flex-col gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Declare Match Winner</p>
                <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                  For walkover, injury, or forfeit — no game scores required.
                </p>
              </div>

              {/* Reason */}
              <div className="flex gap-2 flex-wrap">
                {(['walkover', 'injury', 'declared'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setDeclareReason(r)}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-semibold border transition-colors capitalize',
                      declareReason === r
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-card border-border text-muted-foreground hover:border-amber-400',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Step 1: tap a player to select them */}
              <div className="grid grid-cols-2 gap-2">
                {([
                  { slot: 'p1' as const, player: p1, dbId: match.player1_id },
                  { slot: 'p2' as const, player: p2, dbId: match.player2_id },
                ] as const).map(({ slot, player, dbId }) => {
                  const isSelected = selectedWinnerSlot === slot
                  return (
                    <button
                      key={slot}
                      onClick={() => setSelectedWinnerSlot(isSelected ? null : slot)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-colors',
                        isSelected
                          ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40'
                          : 'border-border bg-card hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20',
                      )}
                    >
                      <Trophy className={cn('h-4 w-4', isSelected ? 'text-amber-500' : 'text-muted-foreground/40')} />
                      <span className={cn('font-semibold text-sm truncate max-w-full', isSelected ? 'text-amber-800 dark:text-amber-300' : 'text-foreground')}>
                        {player?.name ?? 'TBD'}
                      </span>
                      <span className={cn('text-[10px]', isSelected ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-muted-foreground')}>
                        {isSelected ? '✓ selected' : 'tap to select'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Step 2: confirm — enabled only when a slot is selected */}
              <Button
                className="w-full gap-2 font-bold"
                style={selectedWinnerSlot ? { background: '#F06321', color: '#fff' } : undefined}
                variant={selectedWinnerSlot ? 'default' : 'outline'}
                onClick={() => {
                  if (!selectedWinnerSlot) return
                  const dbId = selectedWinnerSlot === 'p1' ? match.player1_id : match.player2_id
                  // For team submatches player IDs are null in DB — pass the slot key instead
                  handleDeclareWinner(dbId ?? selectedWinnerSlot)
                }}
                disabled={isPending || !selectedWinnerSlot}
              >
                <Trophy className="h-4 w-4" />
                {selectedWinnerSlot
                  ? `Declare Winner · ${declareReason}`
                  : 'Select a player first'
                }
              </Button>
            </div>
          )}

          {/* Winner celebration */}
          {isComplete && (match.winner || isTeamSub) && (
            <div className="rounded-2xl border border-orange-300 dark:border-orange-700/60 bg-orange-100 dark:bg-orange-900/30 p-6 text-center animate-fade-in">
              <Trophy className="h-8 w-8 text-amber-400 mx-auto mb-3" />
              <p className="font-display text-2xl font-bold tracking-wide">
                {isTeamSub
                  ? (matchState.outcome === 'player1_wins' ? (p1?.name ?? 'Player 1') : (p2?.name ?? 'Player 2'))
                  : match.winner?.name
                }
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {match.player1_games}–{match.player2_games} ·{' '}
                {matchKind === 'round_robin' ? 'match complete' : isTeamSub ? 'sub-match complete' : 'advances to next round'}
              </p>
              <Link
                href={backHref ?? `/admin/tournaments/${tournament.id}?tab=stages`}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-background font-semibold text-sm px-4 py-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {matchKind === 'round_robin' ? 'Back to Groups' : 'Back to Bracket'}
              </Link>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

// ── ScoreboardHeader ──────────────────────────────────────────────────────────

function ScoreboardHeader({ match, matchState, activeFormat, isComplete, isLive }: {
  match:        Match
  matchState:   ComputedMatchState
  activeFormat: MatchFormat
  isComplete:   boolean
  isLive:       boolean
}) {
  const isTeamSub  = (match as unknown as { match_kind?: string }).match_kind === 'team_submatch'
  const p1Win      = isComplete && (isTeamSub ? matchState.outcome === 'player1_wins' : match.winner_id === match.player1_id)
  const p2Win      = isComplete && (isTeamSub ? matchState.outcome === 'player2_wins' : match.winner_id === match.player2_id)

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 px-3 sm:px-5 py-4 sm:py-6">
        <PlayerCol player={match.player1} games={matchState.player1Games} isWinner={p1Win} side="left" />
        <div className="flex flex-col items-center gap-1.5">
          <div className="font-display text-3xl sm:text-5xl font-bold tracking-tight tabular-nums leading-none">
            <span className={cn(matchState.player1Games > matchState.player2Games ? 'text-orange-600 dark:text-orange-400' : '')}>
              {matchState.player1Games}
            </span>
            <span className="text-muted-foreground mx-2 text-3xl">–</span>
            <span className={cn(matchState.player2Games > matchState.player1Games ? 'text-orange-600 dark:text-orange-400' : '')}>
              {matchState.player2Games}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {FORMAT_CONFIGS[activeFormat].label}
          </span>
        </div>
        <PlayerCol player={match.player2} games={matchState.player2Games} isWinner={p2Win} side="right" />
      </div>
      {isLive     && <div className="h-1 bg-gradient-to-r from-cyan-500/30 via-cyan-400 to-cyan-500/30 animate-pulse-slow" />}
      {isComplete && <div className="h-1 bg-orange-500/70" />}
    </div>
  )
}

function PlayerCol({ player, games, isWinner, side }: {
  player?:  { name: string; seed?: number | null } | null
  games:    number
  isWinner: boolean
  side:     'left' | 'right'
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', side === 'right' ? 'items-end text-right' : 'items-start')}>
      {player?.seed && <span className="seed-badge">{player.seed}</span>}
      <span className={cn('font-display font-semibold tracking-wide text-sm sm:text-base leading-tight truncate max-w-full', isWinner && 'text-orange-600 dark:text-orange-400')}>
        {player?.name ?? 'TBD'}
      </span>
      {isWinner && <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600/80">Winner ✓</span>}
    </div>
  )
}

// ── GameRow ───────────────────────────────────────────────────────────────────

function GameRow({
  gameNum, savedGame, localScore, match, matchState, activeFormat,
  isMatchComplete, isTeamSubmatch, isPending,
  onScoreChange, onDelete, onReset,
}: {
  gameNum:         number
  savedGame:       Game | null
  localScore:      LocalScore
  match:           Match
  matchState:      ComputedMatchState
  activeFormat:    MatchFormat
  isMatchComplete: boolean
  isTeamSubmatch:  boolean
  isPending:       boolean
  onScoreChange:   (n: number, p: 1 | 2, v: string) => void
  onDelete:        (n: number) => void
  onReset:         (n: number) => void
}) {
  const s1 = parseInt(localScore.s1, 10)
  const s2 = parseInt(localScore.s2, 10)
  const bothFilled = localScore.s1 !== '' && localScore.s2 !== ''
  const hasNumbers = !isNaN(s1) && !isNaN(s2)
  const isDirty = savedGame
    ? String(savedGame.score1 ?? '') !== localScore.s1 || String(savedGame.score2 ?? '') !== localScore.s2
    : localScore.s1 !== '' || localScore.s2 !== ''

  const isAfterDeciding = matchState.decidingGame !== undefined && gameNum > matchState.decidingGame
  const isDeciding      = matchState.decidingGame === gameNum

  let scoreValid = true
  if (bothFilled && hasNumbers) {
    scoreValid = validateGameScore({ score1: s1, score2: s2 }).ok
  }

  const saved_p1Won = savedGame
    ? (isTeamSubmatch ? (savedGame.score1 ?? 0) > (savedGame.score2 ?? 0) : savedGame.winner_id === match.player1_id)
    : false
  const saved_p2Won = savedGame
    ? (isTeamSubmatch ? (savedGame.score2 ?? 0) > (savedGame.score1 ?? 0) : savedGame.winner_id === match.player2_id)
    : false

  if (isAfterDeciding && !savedGame) return null

  return (
    <div className={cn(
      'flex flex-col rounded-xl px-1 py-1 transition-colors',
      savedGame && 'bg-muted/20',
      isAfterDeciding && 'opacity-40 pointer-events-none',
      isDeciding && savedGame && 'ring-1 ring-orange-400/20',
    )}>
      <div className="grid grid-cols-[28px_1fr_12px_1fr_44px] sm:grid-cols-[36px_1fr_16px_1fr_52px] gap-1.5 sm:gap-2 items-center">
        <div className="flex justify-center">
          <span className={cn(
            'font-display text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shrink-0',
            savedGame ? 'bg-muted text-foreground' : 'border border-border text-muted-foreground',
            isDeciding && savedGame ? 'bg-orange-200/60 dark:bg-orange-900/40 border-orange-400 text-orange-600 dark:text-orange-400' : '',
          )}>
            {gameNum}
          </span>
        </div>
        <ScoreInput
          value={localScore.s1}
          onChange={v => onScoreChange(gameNum, 1, v)}
          isWinner={saved_p1Won}
          hasError={bothFilled && hasNumbers && !scoreValid}
          disabled={isAfterDeciding || (!match.player1_id && !isTeamSubmatch)}
        />
        <span className="text-muted-foreground text-center font-bold text-sm select-none">–</span>
        <ScoreInput
          value={localScore.s2}
          onChange={v => onScoreChange(gameNum, 2, v)}
          isWinner={saved_p2Won}
          hasError={bothFilled && hasNumbers && !scoreValid}
          disabled={isAfterDeciding || (!match.player2_id && !isTeamSubmatch)}
        />
        <div className="flex gap-1 justify-end">
          {savedGame && !isDirty && (
            <button
              onClick={() => onDelete(gameNum)}
              disabled={isPending}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete this game score"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {isDirty && savedGame && (
            <button
              onClick={() => onReset(gameNum)}
              title="Revert to saved"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors font-bold text-base"
            >
              ↺
            </button>
          )}
        </div>
      </div>
      {bothFilled && hasNumbers && !scoreValid && (
        <div className="mt-1.5 ml-10 flex items-start gap-1.5 rounded-lg bg-destructive/10 border border-destructive/40 px-2.5 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">Invalid — check scores (win by 2, min 11 points)</p>
        </div>
      )}
      {savedGame && (savedGame.score1 ?? 0) >= 10 && (savedGame.score2 ?? 0) >= 10 && (
        <div className="ml-10 mt-0.5">
          <span className="text-[10px] text-amber-400/70 font-medium uppercase tracking-widest">Deuce</span>
        </div>
      )}
    </div>
  )
}

// ── ScoreInput ────────────────────────────────────────────────────────────────

function ScoreInput({ value, onChange, isWinner, hasError, disabled }: {
  value:    string
  onChange: (v: string) => void
  isWinner: boolean
  hasError: boolean
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={99}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        'w-full h-11 sm:h-10 rounded-lg border text-center font-display font-bold text-xl tabular-nums',
        'bg-muted/30 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-ring touch-manipulation',
        isWinner && 'border-orange-500/50 text-orange-600 dark:text-orange-400 bg-orange-100/50 dark:bg-orange-900/30',
        hasError && !isWinner && 'border-destructive/60 bg-destructive/5 text-destructive',
        !isWinner && !hasError && 'border-border text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      placeholder="–"
    />
  )
}
