'use client'

/**
 * SingleRRStage
 *
 * The Stage(s) tab content for format_type = 'single_round_robin'.
 *
 * State machine:
 *   NO_STAGE  → create stage (RRConfigPanel)
 *   HAS_STAGE, no members  → Assign Players
 *   HAS_STAGE, has members, no fixtures  → Generate Schedule
 *   HAS_STAGE, has fixtures  → Show standings + fixtures
 */

import { useTransition, useState } from 'react'
import {
  Users, Shuffle, RefreshCw, Lock, AlertTriangle,
  CheckCircle2, ChevronRight, Trophy,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'
import { groupProgress } from '@/lib/roundrobin/standings'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/index'
import { toast } from '@/components/ui/toaster'
import { RRConfigPanel, type RRConfigValues } from './RRConfigPanel'
import { GroupStandingsTable } from './GroupStandingsTable'
import { ResetStageDialog } from './ResetStageDialog'
import { FinalizeStage1Dialog } from './FinalizeStage1Dialog'
import { createRRStage, resetStage, closeStage1, forceCloseStage1, deleteStageOnly } from '@/lib/actions/stages'
import { generateGroups, generateFixtures } from '@/lib/actions/roundRobin'

interface Props {
  tournament:  Tournament
  players:     Player[]
  stage:       Stage | null
  standings:   GroupStandings[]
  rrMatches:   Match[]
  hasScores:   boolean
  allComplete: boolean
  matchBase:   string
  initialGroup?: number
}

type Phase = 'no_stage' | 'no_members' | 'no_fixtures' | 'in_progress' | 'complete' | 'closed'

function resolvePhase(
  tournament: Tournament,
  stage: Stage | null,
  standings: GroupStandings[],
  rrMatches: Match[],
  allComplete: boolean,
): Phase {
  if (tournament.stage1_complete) return 'closed'
  if (!stage) return 'no_stage'
  const hasMembers  = standings.some(gs => gs.standings.length > 0)
  if (!hasMembers) return 'no_members'
  const hasFixtures = rrMatches.some(m => m.match_kind === 'round_robin')
  if (!hasFixtures) return 'no_fixtures'
  if (allComplete) return 'complete'
  return 'in_progress'
}

export function SingleRRStage({
  tournament, players, stage, standings, rrMatches, hasScores, allComplete, matchBase, initialGroup = 0,
}: Props) {
  const [isPending, startTransition]  = useTransition()
  const [showReset,          setShowReset]          = useState(false)
  const [showForceFinalize,  setShowForceFinalize]  = useState(false)

  const cfg   = stage?.config as RRStageConfig | undefined
  const phase = resolvePhase(tournament, stage, standings, rrMatches, allComplete)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreate = (values: RRConfigValues) => {
    startTransition(async () => {
      const result = await createRRStage({
        tournamentId:   tournament.id,
        stageNumber:    1,
        ...values,
      })
      if (result.error) {
        toast({ title: 'Could not create stage', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Group stage created' })
      }
    })
  }

  const handleReconfigure = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await deleteStageOnly(stage.id, tournament.id)
      if (result.error) {
        toast({ title: 'Could not go back', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Back to configuration' })
      }
    })
  }

  const handleAssign = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await generateGroups(stage.id, tournament.id)
      if (result.error) {
        toast({ title: 'Assignment failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Players assigned to groups' })
      }
    })
  }

  const handleGenerateFixtures = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await generateFixtures(stage.id, tournament.id)
      if (result.error) {
        toast({ title: 'Schedule generation failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: '🗓 Schedule generated', description: `${result.matchCount} matches created` })
      }
    })
  }

  const handleReset = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await resetStage(stage.id, tournament.id)
      setShowReset(false)
      if (result.error) {
        toast({ title: 'Reset failed', description: result.error, variant: 'destructive' })
      } else {
        const log = result.log
        const parts = []
        if (log?.matchesDeleted) parts.push(`${log.matchesDeleted} match${log.matchesDeleted !== 1 ? 'es' : ''}`)
        if (log?.gamesDeleted)   parts.push(`${log.gamesDeleted} game result${log.gamesDeleted !== 1 ? 's' : ''}`)
        if (log?.groupsReset)    parts.push(`${log.groupsReset} group${log.groupsReset !== 1 ? 's' : ''} cleared`)
        toast({
          title: 'Group stage reset ✓',
          description: parts.length ? `Deleted: ${parts.join(', ')}.` : 'All data cleared. Ready to regenerate.',
        })
      }
    })
  }

  const handleForceClose = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await forceCloseStage1(stage.id, tournament.id)
      setShowForceFinalize(false)
      if (result.error) {
        toast({ title: 'Finalization failed', description: result.error, variant: 'destructive' })
      } else {
        const skipped = result.skippedMatches ?? 0
        toast({
          title: 'Group stage finalized',
          description: skipped > 0 ? `${skipped} incomplete match${skipped > 1 ? 'es' : ''} skipped.` : 'All matches complete.',
        })
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Phase stepper */}
      <PhaseHeader phase={phase} />

      {/* ── NO_STAGE: show config form ── */}
      {phase === 'no_stage' && (
        <RRConfigPanel
          players={players}
          onSubmit={handleCreate}
          isPending={isPending}
        />
      )}

      {/* ── NO_MEMBERS: show summary + assign button ── */}
      {phase === 'no_members' && cfg && (
        <Card>
          <CardHeader><CardTitle className="text-base">Group Configuration</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60">
              <Button onClick={handleAssign} disabled={isPending}>
                <Users className="h-4 w-4" />
                {isPending ? 'Assigning…' : 'Assign Players to Groups'}
              </Button>
              <Button
                variant="outline"
                onClick={handleReconfigure}
                disabled={isPending}
                className="text-muted-foreground"
              >
                ← Reconfigure
              </Button>
              <p className="text-xs text-muted-foreground sm:ml-auto">
                Snake-seeds players based on their seeding values.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── NO_FIXTURES: show groups (empty) + generate button ── */}
      {phase === 'no_fixtures' && cfg && (
        <Card>
          <CardHeader><CardTitle className="text-base">Group Configuration</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2 border-t border-border/60">
              <Button onClick={handleGenerateFixtures} disabled={isPending}>
                <Shuffle className="h-4 w-4" />
                {isPending ? 'Generating…' : 'Generate RR Schedule'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Creates all round-robin fixtures using the circle method.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAssign}
                disabled={isPending}
                className="text-muted-foreground hover:text-foreground sm:ml-auto"
              >
                <Users className="h-3.5 w-3.5" /> Re-assign Players
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── IN_PROGRESS / COMPLETE: show standings + fixtures ── */}
      {(phase === 'in_progress' || phase === 'complete') && cfg && (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Group Stage</span>
                {hasScores && (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-amber-600">
                    <Lock className="h-3 w-3" />
                    Structure locked while scores exist
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />

              {/* Progress bar */}
              <ProgressBar rrMatches={rrMatches} />

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60">
                {phase === 'complete' && (
                  <div className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      All matches complete!
                    </p>
                  </div>
                )}

                {/* Force-finalize: only visible when finalizationRule='manual' AND some matches are still pending */}
                {phase === 'in_progress' && cfg?.finalizationRule === 'manual' && (
                  <Button
                    size="sm"
                    onClick={() => setShowForceFinalize(true)}
                    disabled={isPending}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    Finalize Group Stage
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReset(true)}
                  disabled={isPending}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reset Stage
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Standings + fixtures */}
          {standings.length > 0 && (
            <GroupStandingsTable
              standings={standings}
              allMatches={rrMatches}
              matchBase={matchBase}
              isAdmin
              advanceCount={cfg.advanceCount}
              allowBestThird={cfg.allowBestThird}
              bestThirdCount={cfg.bestThirdCount}
              initialGroup={initialGroup}
            />
          )}
        </>
      )}

      {/* ── CLOSED ── */}
      {phase === 'closed' && (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-4">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="font-semibold text-green-800 dark:text-green-300 text-sm">Group stage complete</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">Final standings locked — read only.</p>
            </div>
          </div>
          {standings.length > 0 && cfg && (
            <GroupStandingsTable
              standings={standings}
              allMatches={rrMatches}
              matchBase={matchBase}
              isAdmin={false}
              advanceCount={cfg.advanceCount}
              allowBestThird={cfg.allowBestThird}
              bestThirdCount={cfg.bestThirdCount}
              initialGroup={initialGroup}
            />
          )}
        </>
      )}

      {/* Reset confirm dialog — rich version with stats */}
      <ResetStageDialog
        open={showReset}
        onOpenChange={setShowReset}
        stageLabel="Group Stage"
        stageId={stage?.id}
        requireTypedConfirm={hasScores}
        isPending={isPending}
        onConfirm={handleReset}
        confirmButtonLabel="Reset Group Stage"
      />

      {/* Force-finalize dialog */}
      {stage && (
        <FinalizeStage1Dialog
          open={showForceFinalize}
          onOpenChange={setShowForceFinalize}
          incompleteCount={groupProgress(rrMatches.filter(m => m.stage_id === stage.id)).total
            - groupProgress(rrMatches.filter(m => m.stage_id === stage.id)).completed}
          totalMatches={groupProgress(rrMatches.filter(m => m.stage_id === stage.id)).total}
          isPending={isPending}
          onConfirm={handleForceClose}
        />
      )}
    </div>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ rrMatches }: { rrMatches: Match[] }) {
  const real      = rrMatches.filter(m => m.status !== 'bye')
  const completed = real.filter(m => m.status === 'complete').length
  const total     = real.length
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Progress</span>
        <span className="font-semibold tabular-nums">{completed} / {total} matches</span>
      </div>
      <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-orange-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Phase stepper ──────────────────────────────────────────────────────────────

const STEPS: Array<{ id: Phase; label: string }> = [
  { id: 'no_stage',    label: 'Configure' },
  { id: 'no_members',  label: 'Assign Players' },
  { id: 'no_fixtures', label: 'Generate Schedule' },
  { id: 'in_progress', label: 'Play Matches' },
  { id: 'complete',    label: 'Done' },
  { id: 'closed',      label: 'Closed' },
]
const PHASE_ORDER: Phase[] = ['no_stage','no_members','no_fixtures','in_progress','complete','closed']

function PhaseHeader({ phase }: { phase: Phase }) {
  const current = PHASE_ORDER.indexOf(phase)
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
      {STEPS.map((step, idx) => {
        const isDone   = idx < current
        const isActive = idx === current
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
              isDone   && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
              isActive && 'bg-orange-500 text-white',
              !isDone && !isActive && 'bg-muted text-muted-foreground',
            )}>
              {isDone && <CheckCircle2 className="h-3 w-3" />}
              {step.label}
            </div>
            {idx < STEPS.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}
