'use client'

/**
 * SingleKOStage
 *
 * Stage(s) tab content for format_type = 'single_knockout'.
 */

import { useTransition, useState }     from 'react'
import { Shuffle, Info, CheckCircle2, ArrowRight } from 'lucide-react'
import type { Tournament, Player, Match } from '@/lib/types'
import { Button }                      from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { BracketView }                 from '@/components/bracket/BracketView'
import { generateBracketAction }       from '@/lib/actions/tournaments'
import { resetSingleKOBracket }        from '@/lib/actions/stages'
import { toast }                       from '@/components/ui/toaster'
import { ResetStageDialog }            from './ResetStageDialog'
import { NextStepBanner } from './NextStepBanner'
import { useLoading }                  from '@/components/shared/GlobalLoader'

interface Props {
  tournament:  Tournament
  players:     Player[]
  matches:     Match[]
  matchBase:   string
}

export function SingleKOStage({ tournament, players, matches, matchBase }: Props) {
  const [isPending, startTransition] = useTransition()
  const { setLoading }               = useLoading()
  const [showReset, setShowReset]    = useState(false)

  const isGenerated  = tournament.bracket_generated
  const canGenerate  = players.length >= 2
  const hasResults   = matches.some(m => m.status === 'complete')
  const liveCount    = matches.filter(m => m.status === 'live').length
  const doneCount    = matches.filter(m => m.status === 'complete').length
  const realMatches  = matches.filter(m => m.status !== 'bye')

  const handleFirstGenerate = () => {
    setLoading(true)
    startTransition(async () => {
      try {
        await generateBracketAction(tournament.id)
        toast({
          title:       '✅ Bracket generated!',
          description: `${players.length} players seeded into ${realMatches.length} match slots.`,
        })
      } catch (e: unknown) {
        toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    })
  }

  const handleResetAndRegenerate = () => {
    setShowReset(false)
    setLoading(true)
    startTransition(async () => {
      const resetResult = await resetSingleKOBracket(tournament.id)
      if (resetResult.error) {
        toast({ title: 'Reset failed', description: resetResult.error, variant: 'destructive' })
        setLoading(false)
        return
      }
      const log = resetResult.log!
      const deletedDesc = [
        log.matchesDeleted > 0 && `${log.matchesDeleted} match${log.matchesDeleted !== 1 ? 'es' : ''}`,
        log.gamesDeleted   > 0 && `${log.gamesDeleted} game result${log.gamesDeleted !== 1 ? 's' : ''}`,
      ].filter(Boolean).join(', ')
      try {
        await generateBracketAction(tournament.id)
        toast({
          title:       '✅ Bracket re-generated!',
          description: deletedDesc ? `Cleared: ${deletedDesc}.` : `${players.length} players redrawn.`,
        })
      } catch (e: unknown) {
        toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Next-step guidance banner ── */}
      {!canGenerate && (
        <div className="rounded-2xl border-2 border-dashed border-orange-300 dark:border-orange-700/50 bg-orange-50 dark:bg-orange-950/20 px-5 py-4 flex gap-4 items-start">
          <span className="text-2xl mt-0.5">👥</span>
          <div className="flex flex-col gap-1">
            <p className="font-bold text-orange-700 dark:text-orange-400 text-sm">Step 1 of 2 — Add players first</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Go to the <strong className="text-foreground">Players</strong> tab and add at least 2 players.
              Once done, come back here to generate the bracket.
            </p>
          </div>
        </div>
      )}

      {canGenerate && !isGenerated && (
        <div className="rounded-2xl border-2 border-orange-400 dark:border-orange-500/70 bg-orange-50 dark:bg-orange-950/25 px-5 py-4 flex gap-4 items-center">
          <span className="text-2xl">🎯</span>
          <div className="flex-1">
            <p className="font-bold text-orange-700 dark:text-orange-400 text-sm">
              Step 2 of 2 — {players.length} players ready · Generate the draw!
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click "Generate Bracket" below to seed players and set up the bracket.
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-orange-500 shrink-0 animate-bounce-x" />
        </div>
      )}

      {/* Controls card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-orange-500" />
            Bracket
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

          {/* Status tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatusTile label="Players"   value={players.length} />
            <StatusTile label="Matches"   value={realMatches.length} />
            <StatusTile label="Completed" value={doneCount}  highlight={doneCount > 0} />
            <StatusTile label="Live"      value={liveCount}  live={liveCount > 0} />
          </div>

          {isGenerated && liveCount > 0 && (
            <div className="info-banner text-sm">
              <Info className="h-4 w-4 shrink-0 text-orange-500" />
              <strong className="text-foreground">{liveCount} match{liveCount !== 1 ? 'es' : ''} currently live.</strong>{' '}
              Re-generating will discard those in-progress results.
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {!isGenerated ? (
              <Button
                onClick={handleFirstGenerate}
                disabled={!canGenerate || isPending}
                size="lg"
                style={canGenerate ? { background: '#F06321', color: '#fff' } : undefined}
              >
                {isPending
                  ? <span className="tt-spinner tt-spinner-sm" />
                  : <Shuffle className="h-4 w-4" />}
                {isPending ? 'Generating bracket…' : 'Generate Bracket'}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowReset(true)} disabled={isPending}>
                  {isPending
                    ? <span className="tt-spinner tt-spinner-sm" />
                    : <Shuffle className="h-4 w-4" />}
                  {isPending ? 'Working…' : 'Re-generate Bracket'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {hasResults
                    ? `⚠ ${doneCount} completed result${doneCount !== 1 ? 's' : ''} will be erased.`
                    : 'All match slots will be re-drawn from the current player list.'}
                </p>
              </>
            )}
          </div>

          {isGenerated && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border/50 pt-3">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500" />
              Seeds assigned by player ranking · BYEs fill odd-sized brackets · Top seeds on opposite halves
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bracket view */}
      {isGenerated ? (
        <BracketView tournament={tournament} matches={matches} isAdmin isPending={isPending} matchBasePath={matchBase} />
      ) : (
        <EmptyBracket canGenerate={canGenerate} onGenerate={canGenerate ? handleFirstGenerate : undefined} isPending={isPending} />
      )}

      <ResetStageDialog
        open={showReset}
        onOpenChange={setShowReset}
        stageLabel="Bracket"
        tournamentId={tournament.id}
        requireTypedConfirm={hasResults}
        isPending={isPending}
        onConfirm={handleResetAndRegenerate}
        confirmButtonLabel="Reset & Re-generate"
        extraWarning={
          liveCount > 0
            ? `${liveCount} match${liveCount !== 1 ? 'es are' : ' is'} currently live. Resetting discards those scores.`
            : undefined
        }
      />
    </div>
  )
}

function StatusTile({ label, value, highlight, live }: {
  label: string; value: string | number; highlight?: boolean; live?: boolean
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
      live      ? 'border-orange-400/60 bg-orange-50/50 dark:bg-orange-500/10' :
      highlight ? 'border-border/60 bg-muted/30' : 'border-border/60 bg-muted/20'
    }`}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <span className={`font-semibold text-sm flex items-center gap-1.5 ${live ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
        {live && Number(value) > 0 && <span className="live-dot" />}
        {value}
      </span>
    </div>
  )
}

function EmptyBracket({ canGenerate, onGenerate, isPending }: {
  canGenerate: boolean
  onGenerate?: () => void
  isPending?: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-border text-center gap-4">
      <div className="text-4xl">🏓</div>
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-foreground">No bracket yet</p>
        <p className="text-xs text-muted-foreground/70">
          {canGenerate ? 'Your players are loaded — generate the bracket to see the bracket.' : 'Add players first, then generate the bracket.'}
        </p>
      </div>
      {canGenerate && onGenerate && (
        <Button onClick={onGenerate} disabled={isPending} style={{ background: '#F06321', color: '#fff' }}>
          {isPending ? <span className="tt-spinner tt-spinner-sm" /> : <Shuffle className="h-4 w-4" />}
          {isPending ? 'Generating…' : 'Generate Bracket'}
        </Button>
      )}
    </div>
  )
}
