'use client'

/**
 * Match scoring UI — complete game-by-game entry screen.
 *
 * VALIDATION STRATEGY
 * ───────────────────
 * Validation happens in two places:
 *
 * 1. REAL-TIME in the UI (client-side, no network):
 *    Every time a score field changes, validateGameScore() runs instantly.
 *    Errors appear inline below the inputs with no save button disabled
 *    state — the admin can see what's wrong while still typing.
 *
 * 2. ON SAVE (server-side, authoritative):
 *    saveGameScore() re-runs all validation on the server before writing.
 *    This catches any race conditions or client-side bypass attempts.
 *    Error messages from the server are displayed in the same inline UI.
 *
 * STATE FLOW
 * ──────────
 *  scores{} ← local editable state (strings, so "11" not 11)
 *  games[]  ← saved game rows from DB (updated via Realtime or refresh)
 *  match    ← current match row (updated via Realtime)
 *
 * The UI derives everything else: isDirty, isWinner, validationResult, etc.
 */

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trophy, Save, Trash2, RotateCcw, AlertCircle,
         CheckCircle2, Info, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Match, Game, Tournament } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/index'
import { LiveBadge } from '@/components/shared/LiveBadge'
import { saveGameScore, deleteGameScore, setMatchLive, declareMatchWinner } from '@/lib/actions/matches'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import {
  validateGameScore,
  computeMatchState,
  canAddAnotherGame,
  inferGameNumbersToShow,
  errorsForField,
  formatValidationErrors,
} from '@/lib/scoring/engine'
import { FORMAT_CONFIGS } from '@/lib/scoring/types'
import type { ValidationResult, ComputedMatchState } from '@/lib/scoring/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalScore { s1: string; s2: string }

interface MatchScoringClientProps {
  initialMatch:  Match
  initialGames:  Game[]
  tournament:    Tournament
  backHref?:     string              // override "Back" link
  groupName?:    string | null       // group name for RR matches (e.g. "Group A")
  matchKind?:    'knockout' | 'round_robin'
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function MatchScoringClient({ initialMatch, initialGames, tournament, backHref, groupName, matchKind = 'knockout' }: MatchScoringClientProps) {
  const [match, setMatch]                 = useState<Match>(initialMatch)
  const [games, setGames]                 = useState<Game[]>(initialGames)
  const [scores, setScores]               = useState<Record<number, LocalScore>>(
    () => initialGames.reduce<Record<number, LocalScore>>((acc, g) => {
      acc[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
      return acc
    }, {}),
  )
  // Per-game server error (shown after a failed save attempt)
  const [serverErrors, setServerErrors]   = useState<Record<number, string>>({})
  const [isPending, startTransition]      = useTransition()
  const router                            = useRouter()
  const supabase                          = createClient()

  // Keep a ref to games so Realtime callbacks see current state
  const gamesRef = useRef(games)
  useEffect(() => { gamesRef.current = games }, [games])

  const format     = tournament.format
  const cfg        = FORMAT_CONFIGS[format]
  const player1Id  = match.player1_id
  const player2Id  = match.player2_id

  // ── Derived state from engine ─────────────────────────────────────────────
  const matchState: ComputedMatchState = computeMatchState(
    games, format, player1Id, player2Id,
  )
  const gameNumbers = inferGameNumbersToShow(games, format, player1Id, player2Id)

  // ── Realtime: keep match + games in sync with DB ──────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`admin-match-${match.id}`)
      // Match row update (status, scores, winner)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${match.id}` },
        (payload) => {
          setMatch(prev => ({ ...prev, ...payload.new as unknown as Partial<Match> }))
        },
      )
      // Game added or updated — merge into games list
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (payload) => {
          const g = payload.new as unknown as Game
          setGames(prev => {
            const exists = prev.find(x => x.id === g.id)
            if (exists) return prev
            return [...prev, g].sort((a, b) => a.game_number - b.game_number)
          })
          // Sync local score state
          setScores(prev => ({
            ...prev,
            [g.game_number]: { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') },
          }))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (payload) => {
          const g = payload.new as unknown as Game
          setGames(prev => prev.map(x => x.id === g.id ? { ...x, ...g } : x))
          setScores(prev => ({
            ...prev,
            [g.game_number]: { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') },
          }))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'games', filter: `match_id=eq.${match.id}` },
        (payload) => {
          const deleted = payload.old as unknown as { id: string; game_number: number }
          setGames(prev => prev.filter(x => x.id !== deleted.id))
          setScores(prev => {
            const next = { ...prev }
            delete next[deleted.game_number]
            return next
          })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [match.id])

  // ── Score input handler ───────────────────────────────────────────────────
  const handleScoreChange = (gameNum: number, player: 1 | 2, value: string) => {
    // Clear server error for this game when admin starts editing
    setServerErrors(prev => { const n = { ...prev }; delete n[gameNum]; return n })
    setScores(prev => ({
      ...prev,
      [gameNum]: { ...(prev[gameNum] ?? { s1: '', s2: '' }), [player === 1 ? 's1' : 's2']: value },
    }))
  }

  // ── Save a game ───────────────────────────────────────────────────────────
  const handleSaveGame = useCallback((gameNum: number) => {
    const local = scores[gameNum]
    if (!local) return

    const score1 = parseInt(local.s1, 10)
    const score2 = parseInt(local.s2, 10)

    // Client-side validation before hitting the server
    const validation = validateGameScore({ score1, score2 })
    if (!validation.ok) {
      setServerErrors(prev => ({ ...prev, [gameNum]: formatValidationErrors(validation) }))
      return
    }

    startTransition(async () => {
      const result = await saveGameScore(match.id, gameNum, score1, score2)
      if (!result.success) {
        setServerErrors(prev => ({ ...prev, [gameNum]: result.error }))
        toast({ title: 'Score rejected', description: result.error, variant: 'destructive' })
      } else {
        setServerErrors(prev => { const n = { ...prev }; delete n[gameNum]; return n })
        toast({ title: `Game ${gameNum} saved`, description: `${score1}–${score2}` })
        // Invalidate router cache so the event page shows fresh standings (PD, GD etc.)
        // when the admin navigates back.
        router.refresh()
      }
    })
  }, [scores, match.id])

  // ── Delete a game ─────────────────────────────────────────────────────────
  const handleDeleteGame = useCallback((gameNum: number) => {
    startTransition(async () => {
      const result = await deleteGameScore(match.id, gameNum)
      if (!result.success) {
        toast({ title: 'Delete failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `Game ${gameNum} removed` })
      }
    })
  }, [match.id])

  // ── Declare winner (walkover / injury) ────────────────────────────────────
  const [showDeclare, setShowDeclare]   = useState(false)
  const [declareReason, setDeclareReason] = useState<'walkover' | 'injury' | 'declared'>('walkover')

  const handleDeclareWinner = (winnerId: string) => {
    startTransition(async () => {
      const result = await declareMatchWinner(match.id, winnerId, declareReason)
      if (!result.success) {
        toast({ title: 'Could not declare winner', description: result.error, variant: 'destructive' })
      } else {
        setShowDeclare(false)
        toast({ title: 'Winner declared', description: `${declareReason} — match marked complete.` })
      }
    })
  }

  // ── Mark live ─────────────────────────────────────────────────────────────
  const handleMarkLive = () => {
    startTransition(async () => {
      try {
        await setMatchLive(match.id)
        toast({ title: 'Match is now live' })
      } catch (e: unknown) {
        toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  // ── Derived display ───────────────────────────────────────────────────────
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const isMatchPending = match.status === 'pending'
  const p1 = match.player1
  const p2 = match.player2

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-orange-600/40" style={{ background: '#F06321' }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-3 sm:px-4 sm:gap-3">
          {/* Back link */}
          <Link
            href={backHref ?? `/admin/tournaments/${tournament.id}?tab=stages`}
            className="flex items-center gap-1 text-white hover:text-orange-100 transition-colors text-sm shrink-0 touch-manipulation"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-white/60 shrink-0 hidden sm:block" />

          {/* Breadcrumb context */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Match kind chip */}
            <span className={cn(
              'shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
              matchKind === 'round_robin'
                ? 'bg-blue-100/20 border-blue-200/40 text-blue-100'
                : 'bg-white/10 border-white/30 text-white/90',
            )}>
              {matchKind === 'round_robin' ? 'RR' : 'KO'}
            </span>

            {/* Group or round label */}
            <span className="font-display font-medium tracking-wide text-sm truncate text-white">
              {groupName
                ? `${groupName} · #${match.match_number}`
                : (match.round_name ?? `Round ${match.round}`)
              }
            </span>
          </div>

          {/* Status + nav */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isLive && <LiveBadge />}
            {isComplete && (
              <Badge variant="success" className="hidden sm:flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" /> Done
              </Badge>
            )}
            <Link
              href={backHref ?? `/admin/tournaments/${tournament.id}?tab=stages`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white border border-white/40 hover:border-white/70 rounded-full px-2.5 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 transition-colors touch-manipulation"
            >
              <Trophy className="h-3 w-3" /> <span className="hidden xs:inline">{matchKind === 'round_robin' ? 'Groups' : 'Bracket'}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6">
        <div className="surface-card p-4 sm:p-6 flex flex-col gap-5">

        {/* ── Big scoreboard ── */}
        <ScoreboardHeader
          match={match}
          matchState={matchState}
          format={format}
          isComplete={isComplete}
          isLive={isLive}
        />

        {/* ── Context rules banner ── */}
        <RulesBanner format={format} gamesNeeded={cfg.gamesNeeded} maxGames={cfg.maxGames} />

        {/* ── Mark live prompt ── */}
        {isMatchPending && p1 && p2 && (
          <div className="info-banner justify-between">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Info className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
              Match not started. Mark as live to begin score entry.
            </div>
            <Button size="sm" variant="outline" onClick={handleMarkLive} disabled={isPending} className="shrink-0">
              Start Match
            </Button>
          </div>
        )}

        {/* ── No players yet ── */}
        {(!p1 || !p2) && (
          <div className="info-banner">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            Waiting for both players to be determined before scores can be entered.
          </div>
        )}

        {/* ── Declare Winner (walkover / injury) ── */}
        {!isComplete && p1 && p2 && (
          <div className="flex flex-col gap-3">
            {!showDeclare ? (
              <button
                onClick={() => setShowDeclare(true)}
                className="text-xs text-muted-foreground hover:text-orange-600 underline underline-offset-2 text-left w-fit transition-colors"
              >
                Declare winner without scores (walkover / injury / forfeit)
              </button>
            ) : (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/20 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Declare Match Winner</p>
                  <button onClick={() => setShowDeclare(false)} className="text-xs text-muted-foreground hover:text-foreground">✕ cancel</button>
                </div>
                {/* Reason selector */}
                <div className="flex gap-2 flex-wrap">
                  {(['walkover', 'injury', 'declared'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setDeclareReason(r)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold border transition-colors capitalize',
                        declareReason === r
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-card border-border text-muted-foreground hover:border-amber-400'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400">Select the winner:</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => p1?.id && handleDeclareWinner(match.player1_id!)}
                    disabled={isPending}
                    className="flex flex-col items-center gap-1 rounded-xl border-2 border-border bg-card hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 p-3 transition-colors disabled:opacity-50"
                  >
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <span className="font-semibold text-sm text-foreground truncate max-w-full">{p1?.name}</span>
                    <span className="text-[10px] text-muted-foreground">wins by {declareReason}</span>
                  </button>
                  <button
                    onClick={() => p2?.id && handleDeclareWinner(match.player2_id!)}
                    disabled={isPending}
                    className="flex flex-col items-center gap-1 rounded-xl border-2 border-border bg-card hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 p-3 transition-colors disabled:opacity-50"
                  >
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <span className="font-semibold text-sm text-foreground truncate max-w-full">{p2?.name}</span>
                    <span className="text-[10px] text-muted-foreground">wins by {declareReason}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Game score entry grid ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Game-by-Game Scores</span>
              <span className="text-xs font-normal text-muted-foreground font-sans">
                First to <strong className="text-foreground">{cfg.gamesNeeded}</strong> games wins · games to 11, win by 2
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">

            {/* Column header row */}
            <div className="grid grid-cols-[28px_1fr_14px_1fr_60px] sm:grid-cols-[36px_1fr_16px_1fr_76px] gap-1.5 sm:gap-2 items-center pb-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-center">#</span>
              <span className="text-xs font-medium text-foreground text-center truncate">{p1?.name ?? 'Player 1'}</span>
              <span />
              <span className="text-xs font-medium text-foreground text-center truncate">{p2?.name ?? 'Player 2'}</span>
              <span />
            </div>

            {gameNumbers.map(gameNum =>
              <GameRow
                key={gameNum}
                gameNum={gameNum}
                savedGame={games.find(g => g.game_number === gameNum) ?? null}
                localScore={scores[gameNum] ?? { s1: '', s2: '' }}
                serverError={serverErrors[gameNum]}
                match={match}
                matchState={matchState}
                format={format}
                isPending={isPending}
                isMatchComplete={isComplete}
                onScoreChange={handleScoreChange}
                onSave={handleSaveGame}
                onDelete={handleDeleteGame}
                onReset={(gn) => {
                  const saved = games.find(g => g.game_number === gn)
                  if (saved) {
                    setScores(prev => ({ ...prev, [gn]: { s1: String(saved.score1 ?? ''), s2: String(saved.score2 ?? '') } }))
                    setServerErrors(prev => { const n = { ...prev }; delete n[gn]; return n })
                  }
                }}
              />
            )}

          </CardContent>
        </Card>

        {/* ── Winner celebration ── */}
        {isComplete && match.winner && (
          <div className="rounded-2xl border border-orange-300 dark:border-orange-700/60 bg-orange-100 dark:bg-orange-900/30 p-6 text-center animate-fade-in">
            <Trophy className="h-8 w-8 text-amber-400 mx-auto mb-3" />
            <p className="font-display text-2xl font-bold tracking-wide">{match.winner.name}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Wins {match.player1_games}–{match.player2_games} · {matchKind === 'round_robin' ? 'match complete' : 'advances to the next round'}
            </p>
            <Link
              href={backHref ?? `/admin/tournaments/${tournament.id}?tab=bracket`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-background font-semibold text-sm px-4 py-2 transition-colors"
            >
              <Trophy className="h-4 w-4" /> {matchKind === 'round_robin' ? 'Back to Groups' : 'Go to Bracket'}
            </Link>
          </div>
        )}

              </div>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoreboardHeader
// ─────────────────────────────────────────────────────────────────────────────

function ScoreboardHeader({ match, matchState, format, isComplete, isLive }: {
  match:      Match
  matchState: ComputedMatchState
  format:     string
  isComplete: boolean
  isLive:     boolean
}) {
  const p1         = match.player1
  const p2         = match.player2
  const p1IsWinner = isComplete && match.winner_id === match.player1_id
  const p2IsWinner = isComplete && match.winner_id === match.player2_id

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 px-3 sm:px-5 py-4 sm:py-6">
        <PlayerColumn player={p1} games={matchState.player1Games} isWinner={p1IsWinner} side="left" />
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
            {format.replace('bo', 'Best of ')}
          </span>
        </div>
        <PlayerColumn player={p2} games={matchState.player2Games} isWinner={p2IsWinner} side="right" />
      </div>
      {isLive     && <div className="h-1 bg-gradient-to-r from-cyan-500/30 via-cyan-400 to-cyan-500/30 animate-pulse-slow" />}
      {isComplete && <div className="h-1 bg-orange-500/70" />}
    </div>
  )
}

function PlayerColumn({ player, games, isWinner, side }: {
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

// ─────────────────────────────────────────────────────────────────────────────
// RulesBanner
// ─────────────────────────────────────────────────────────────────────────────

function RulesBanner({ format, gamesNeeded, maxGames }: {
  format:      string
  gamesNeeded: number
  maxGames:    number
}) {
  return (
    <div className="info-banner text-xs">
      <Info className="h-3.5 w-3.5 text-orange-600/70 shrink-0 mt-0.5" />
      <span>
        <strong className="text-foreground">{format.replace('bo', 'Best of ')}:</strong>{' '}
        First to <strong className="text-foreground">{gamesNeeded} games</strong> wins (max {maxGames}).
        {' '}Each game to 11 points, <strong className="text-foreground">win by 2</strong>.
        {' '}At 10–10 play continues until one player leads by 2 (e.g. 12–10, 14–12).
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GameRow — one row per game_number
// ─────────────────────────────────────────────────────────────────────────────

interface GameRowProps {
  gameNum:        number
  savedGame:      Game | null
  localScore:     LocalScore
  serverError:    string | undefined
  match:          Match
  matchState:     ComputedMatchState
  format:         string
  isPending:      boolean
  isMatchComplete: boolean
  onScoreChange:  (gameNum: number, player: 1 | 2, value: string) => void
  onSave:         (gameNum: number) => void
  onDelete:       (gameNum: number) => void
  onReset:        (gameNum: number) => void
}

function GameRow({
  gameNum, savedGame, localScore, serverError,
  match, matchState, format, isPending, isMatchComplete,
  onScoreChange, onSave, onDelete, onReset,
}: GameRowProps) {
  const cfg = FORMAT_CONFIGS[format as keyof typeof FORMAT_CONFIGS]

  // ── Dirty check ──────────────────────────────────────────────────────────
  const isDirty = savedGame
    ? (String(savedGame.score1 ?? '') !== localScore.s1 || String(savedGame.score2 ?? '') !== localScore.s2)
    : (localScore.s1 !== '' || localScore.s2 !== '')

  // ── Live validation (runs every render when values change) ───────────────
  const s1 = parseInt(localScore.s1, 10)
  const s2 = parseInt(localScore.s2, 10)
  const bothFilled = localScore.s1 !== '' && localScore.s2 !== ''
  const hasNumbers = !isNaN(s1) && !isNaN(s2)

  let liveValidation: ValidationResult = { ok: true }
  if (bothFilled && hasNumbers) {
    liveValidation = validateGameScore({ score1: s1, score2: s2 })
  }

  // Per-field errors for inline display
  const f1Errors = errorsForField(liveValidation, 'score1')
  const f2Errors = errorsForField(liveValidation, 'score2')
  const globalErrors = liveValidation.ok ? [] : liveValidation.errors.filter(e => e.field === 'both' || e.field === 'match')

  // ── canAdd check for unsaved games ───────────────────────────────────────
  const canAddResult = !savedGame
    ? canAddAnotherGame(
        matchState.games.map(g => ({
          id: '', match_id: match.id, game_number: g.gameNumber,
          score1: g.score1, score2: g.score2,
          winner_id: g.outcome === 'player1_wins' ? match.player1_id : match.player2_id,
          created_at: '', updated_at: '',
        })),
        format as 'bo3' | 'bo5' | 'bo7',
        match.player1_id,
        match.player2_id,
        gameNum,
      )
    : { allowed: true, nextGameNumber: gameNum }

  // ── Is this game "decided" (match ended before this game number) ──────────
  const isAfterDecidingGame =
    matchState.decidingGame !== undefined && gameNum > matchState.decidingGame

  // ── Is this game row the one that decided the match ──────────────────────
  const isDecidingGame = matchState.decidingGame === gameNum

  // ── Winner highlights ─────────────────────────────────────────────────────
  const saved_p1Won = savedGame?.winner_id === match.player1_id
  const saved_p2Won = savedGame?.winner_id === match.player2_id

  // Can the save button appear?
  const canShowSave = bothFilled && hasNumbers && liveValidation.ok && (isDirty || !savedGame) && canAddResult.allowed

  if (isAfterDecidingGame && !savedGame) return null

  return (
    <div className={cn(
      'flex flex-col rounded-xl px-1 py-1 transition-colors',
      savedGame ? 'bg-muted/20' : '',
      isAfterDecidingGame ? 'opacity-40 pointer-events-none' : '',
      isDecidingGame && savedGame ? 'ring-1 ring-orange-400/20' : '',
    )}>
      {/* Score input row */}
      <div className="grid grid-cols-[28px_1fr_12px_1fr_60px] sm:grid-cols-[36px_1fr_16px_1fr_76px] gap-1.5 sm:gap-2 items-center">
        {/* Game number badge */}
        <div className="flex justify-center">
          <span className={cn(
            'font-display text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shrink-0',
            savedGame ? 'bg-muted text-foreground' : 'border border-border text-muted-foreground',
            isDecidingGame && savedGame ? 'bg-orange-200/60 dark:bg-orange-900/40 border-orange-400 text-orange-600 dark:text-orange-400' : '',
          )}>
            {gameNum}
          </span>
        </div>

        {/* Score 1 */}
        <div className="flex flex-col gap-0.5">
          <ScoreInput
            value={localScore.s1}
            onChange={v => onScoreChange(gameNum, 1, v)}
            isWinner={saved_p1Won}
            hasError={f1Errors.length > 0}
            disabled={(isMatchComplete && !isDirty) || isAfterDecidingGame || !match.player1_id}
          />
        </div>

        {/* Dash */}
        <span className="text-muted-foreground text-center font-bold text-sm select-none">–</span>

        {/* Score 2 */}
        <div className="flex flex-col gap-0.5">
          <ScoreInput
            value={localScore.s2}
            onChange={v => onScoreChange(gameNum, 2, v)}
            isWinner={saved_p2Won}
            hasError={f2Errors.length > 0}
            disabled={(isMatchComplete && !isDirty) || isAfterDecidingGame || !match.player2_id}
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 justify-end">
          {/* Show save button when valid, or a disabled version with reason when invalid but dirty */}
          {canShowSave && (
            <Button
              size="sm"
              variant="cyan"
              className="h-8 px-2.5 text-xs gap-1"
              onClick={() => onSave(gameNum)}
              disabled={isPending}
              title="Save this game score"
            >
              <Save className="h-3 w-3" />
              <span className="hidden sm:inline">Save</span>
            </Button>
          )}
          {/* Disabled save shown when scores are filled but invalid */}
          {!canShowSave && bothFilled && hasNumbers && !liveValidation.ok && isDirty && canAddResult.allowed && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs gap-1 opacity-50 cursor-not-allowed border-destructive/40 text-destructive"
              disabled
            >
              <Save className="h-3 w-3" />
              <span className="hidden sm:inline">Invalid</span>
            </Button>
          )}
          {savedGame && !isDirty && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(gameNum)}
              disabled={isPending}
              title="Delete this game score (allows correction)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {isDirty && savedGame && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onReset(gameNum)}
              title="Revert to saved score"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Inline error messages — large, prominent, impossible to miss */}
      {(globalErrors.length > 0 || serverError) && (
        <div className="mt-2 ml-10 flex items-start gap-2 rounded-lg bg-destructive/10 border-2 border-destructive/50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-bold text-destructive uppercase tracking-wide">Invalid score</p>
            <p className="text-xs text-destructive leading-snug">
              {serverError ?? globalErrors[0]?.message}
            </p>
          </div>
        </div>
      )}

      {/* Field-specific hints (shown only when a field has errors but game isn't fully invalid) */}
      {!globalErrors.length && (f1Errors.length > 0 || f2Errors.length > 0) && !serverError && (
        <div className="mt-2 ml-10 flex items-start gap-2 rounded-lg bg-amber-400/10 border-2 border-amber-400/30 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">Check score</p>
            <p className="text-xs text-amber-400/90 leading-snug">
              {[...f1Errors, ...f2Errors][0]?.message}
            </p>
          </div>
        </div>
      )}

      {/* canAdd block message (only for new games, not edits) */}
      {!savedGame && !canAddResult.allowed && bothFilled && (
        <div className="mt-1.5 ml-10 flex items-start gap-1.5 rounded-lg border border-border/50 bg-muted/30 dark:bg-muted/20 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-snug">{canAddResult.reason}</p>
        </div>
      )}

      {/* Deuce label */}
      {savedGame && (savedGame.score1 ?? 0) >= 10 && (savedGame.score2 ?? 0) >= 10 && (
        <div className="ml-10 mt-0.5">
          <span className="text-[10px] text-amber-400/70 font-medium uppercase tracking-widest">Deuce</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoreInput
// ─────────────────────────────────────────────────────────────────────────────

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
        'bg-muted/30 transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-ring',
        'touch-manipulation',  // prevent double-tap zoom on mobile
        isWinner && 'border-orange-500/50 text-orange-600 dark:text-orange-400 bg-orange-100/50 dark:bg-orange-900/30',
        hasError && !isWinner && 'border-destructive/60 bg-destructive/5 text-destructive',
        !isWinner && !hasError && 'border-border text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      placeholder="–"
    />
  )
}
