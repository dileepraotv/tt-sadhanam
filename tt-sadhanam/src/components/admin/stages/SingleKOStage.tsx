'use client'

/**
 * SingleKOStage
 *
 * Stage(s) tab content for format_type = 'single_knockout'.
 *
 * Safety model:
 *   "Generate Draw"    — first draw; no confirm needed.
 *   "Re-generate Draw" — calls resetSingleKOBracket() (with typed-confirm dialog
 *                        showing real match/game counts), then regenerates.
 */

import { useTransition, useState }     from 'react'
import { Shuffle, Info, CheckCircle2 } from 'lucide-react'
import type { Tournament, Player, Match } from '@/lib/types'
import { Button }                      from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { BracketView }                 from '@/components/bracket/BracketView'
import { generateBracketAction }       from '@/lib/actions/tournaments'
import { resetSingleKOBracket }        from '@/lib/actions/stages'
import { toast }                       from '@/components/ui/toaster'
import { ResetStageDialog }            from './ResetStageDialog'

interface Props {
  tournament:  Tournament
  players:     Player[]
  matches:     Match[]
  matchBase:   string
}

export function SingleKOStage({ tournament, players, matches, matchBase }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showReset, setShowReset]    = useState(false)

  const isGenerated  = tournament.bracket_generated
  const canGenerate  = players.length >= 2
  const hasResults   = matches.some(m => m.status === 'complete')
  const liveCount    = matches.filter(m => m.status === 'live').length
  const doneCount    = matches.filter(m => m.status === 'complete').length
  const realMatches  = matches.filter(m => m.status !== 'bye')

  // ── First-time generate ────────────────────────────────────────────────
  const handleFirstGenerate = () => {
    startTransition(async () => {
      try {
        await generateBracketAction(tournament.id)
        toast({
          title:       '🎯 Bracket generated!',
          description: `${players.length} players seeded into ${realMatches.length} match slots.`,
        })
      } catch (e: unknown) {
        toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  // ── Re-generate: explicit reset then generate ──────────────────────────
  const handleResetAndRegenerate = () => {
    setShowReset(false)
    startTransition(async () => {
      const resetResult = await resetSingleKOBracket(tournament.id)
      if (resetResult.error) {
        toast({ title: 'Reset failed', description: resetResult.error, variant: 'destructive' })
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
          title:       '🎯 Bracket re-generated!',
          description: deletedDesc ? `Cleared: ${deletedDesc}.` : `${players.length} players redrawn.`,
        })
      } catch (e: unknown) {
        toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Controls card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-orange-500" />
            Knockout Bracket
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

          {/* Warnings */}
          {!canGenerate && (
            <div className="info-banner text-sm">
              <Info className="h-4 w-4 shrink-0 text-amber-500" />
              Add at least 2 players in the Players tab before generating the bracket.
            </div>
          )}
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
              <Button onClick={handleFirstGenerate} disabled={!canGenerate || isPending}>
                <Shuffle className="h-4 w-4" />
                {isPending ? 'Drawing…' : 'Generate Draw'}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowReset(true)} disabled={isPending}>
                  <Shuffle className="h-4 w-4" />
                  {isPending ? 'Working…' : 'Re-generate Draw'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {hasResults
                    ? `⚠ ${doneCount} completed result${doneCount !== 1 ? 's' : ''} will be erased.`
                    : 'All match slots will be re-drawn from the current player list.'}
                </p>
              </>
            )}
          </div>

          {/* Seeding info */}
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
        <BracketView tournament={tournament} matches={matches} isAdmin matchBasePath={matchBase} />
      ) : (
        <EmptyBracket canGenerate={canGenerate} />
      )}

      {/* Re-generate confirm dialog */}
      <ResetStageDialog
        open={showReset}
        onOpenChange={setShowReset}
        stageLabel="Knockout Bracket"
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

// ── StatusTile ────────────────────────────────────────────────────────────────
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

// ── EmptyBracket ──────────────────────────────────────────────────────────────
function EmptyBracket({ canGenerate }: { canGenerate: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-border text-center gap-2">
      <div className="text-4xl">🏓</div>
      <p className="font-semibold text-foreground">No bracket yet</p>
      <p className="text-xs text-muted-foreground/70">
        {canGenerate ? 'Generate the draw above to see the bracket.' : 'Add players first, then generate the draw.'}
      </p>
    </div>
  )
}
