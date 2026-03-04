'use client'

/**
 * MultiStagePanel
 *
 * The Stage(s) tab content for format_type = 'multi_rr_to_knockout'.
 *
 * Two visually distinct sections with a clear progression arrow:
 *
 *   ┌─────────────────────────────────────────┐
 *   │  STAGE 1: Round Robin Groups            │
 *   │  Configure → Assign → Fixtures → Play  │
 *   └─────────────────────────────────────────┘
 *                      ↓  qualifiers advance
 *   ┌─────────────────────────────────────────┐
 *   │  STAGE 2: Knockout Bracket              │
 *   │  (locked until Stage 1 closed)          │
 *   └─────────────────────────────────────────┘
 *
 * Stage 2 section shows a locked state with qualifier preview until
 * stage1_complete=true, then the "Generate Knockout" button, then
 * the bracket view once generated.
 */

import { useTransition, useState } from 'react'
import {
  Users, Shuffle, RefreshCw, Lock, AlertTriangle,
  CheckCircle2, ChevronRight, Trophy, Layers,
  ChevronDown, ArrowDown, RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tournament, Player, Match, Stage, RRStageConfig } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'
import { groupProgress } from '@/lib/roundrobin/standings'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardHeader, CardTitle,
  Badge,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/index'
import { BracketView } from '@/components/bracket/BracketView'
import { toast } from '@/components/ui/toaster'
import { RRConfigPanel, type RRConfigValues } from './RRConfigPanel'
import { GroupStandingsTable } from './GroupStandingsTable'
import { ResetStageDialog } from './ResetStageDialog'
import { FinalizeStage1Dialog } from './FinalizeStage1Dialog'
import { createRRStage, resetStage, closeStage1, forceCloseStage1, resetKOStage, deleteStageOnly } from '@/lib/actions/stages'
import { generateGroups, generateFixtures } from '@/lib/actions/roundRobin'
import { generateKnockoutStage } from '@/lib/actions/knockout'

interface Props {
  tournament:  Tournament
  players:     Player[]
  rrStage:     Stage | null
  koStage:     Stage | null
  rrStandings: GroupStandings[]
  rrMatches:   Match[]
  koMatches:   Match[]
  hasScores:    boolean
  allComplete:  boolean
  matchBase:    string
  initialGroup?: number
}

type RRPhase = 'no_stage' | 'no_members' | 'no_fixtures' | 'in_progress' | 'all_complete' | 'closed'

function resolveRRPhase(
  tournament: Tournament, stage: Stage | null,
  standings: GroupStandings[], rrMatches: Match[], allComplete: boolean,
): RRPhase {
  if (tournament.stage1_complete) return 'closed'
  if (!stage) return 'no_stage'
  const hasMembers  = standings.some(gs => gs.standings.length > 0)
  if (!hasMembers) return 'no_members'
  const hasFixtures = rrMatches.some(m => m.match_kind === 'round_robin')
  if (!hasFixtures) return 'no_fixtures'
  if (allComplete) return 'all_complete'
  return 'in_progress'
}

// ─────────────────────────────────────────────────────────────────────────────

export function MultiStagePanel({
  tournament, players, rrStage, koStage,
  rrStandings, rrMatches, koMatches,
  hasScores, allComplete, matchBase, initialGroup = 0,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [showReset,          setShowReset]          = useState(false)
  const [showAdvance,        setShowAdvance]        = useState(false)
  const [showForceFinalize,  setShowForceFinalize]  = useState(false)
  const [showKOReset,        setShowKOReset]        = useState(false)

  const cfg     = rrStage?.config as RRStageConfig | undefined
  const rrPhase = resolveRRPhase(tournament, rrStage, rrStandings, rrMatches, allComplete)

  const stage1Complete   = tournament.stage1_complete ?? false
  const stage2Generated  = tournament.stage2_bracket_generated ?? false

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreate = (values: RRConfigValues) => {
    startTransition(async () => {
      const result = await createRRStage({ tournamentId: tournament.id, stageNumber: 1, ...values })
      if (result.error) toast({ title: 'Could not create stage', description: result.error, variant: 'destructive' })
      else toast({ title: 'Stage 1 created' })
    })
  }

  const handleReconfigure = () => {
    if (!rrStage) return
    startTransition(async () => {
      const result = await deleteStageOnly(rrStage.id, tournament.id)
      if (result.error) toast({ title: 'Could not go back', description: result.error, variant: 'destructive' })
      else toast({ title: 'Back to configuration' })
    })
  }

  const handleAssign = () => {
    if (!rrStage) return
    startTransition(async () => {
      const result = await generateGroups(rrStage.id, tournament.id)
      if (result.error) toast({ title: 'Assignment failed', description: result.error, variant: 'destructive' })
      else toast({ title: 'Players assigned to groups' })
    })
  }

  const handleGenerateFixtures = () => {
    if (!rrStage) return
    startTransition(async () => {
      const result = await generateFixtures(rrStage.id, tournament.id)
      if (result.error) toast({ title: 'Schedule failed', description: result.error, variant: 'destructive' })
      else toast({ title: '🗓 Schedule generated', description: `${result.matchCount} matches created` })
    })
  }

  const handleReset = () => {
    if (!rrStage) return
    startTransition(async () => {
      const result = await resetStage(rrStage.id, tournament.id)
      setShowReset(false)
      if (result.error) {
        toast({ title: 'Reset failed', description: result.error, variant: 'destructive' })
      } else {
        const log = result.log
        const parts: string[] = []
        if (log?.matchesDeleted) parts.push(`${log.matchesDeleted} match${log.matchesDeleted !== 1 ? 'es' : ''}`)
        if (log?.gamesDeleted)   parts.push(`${log.gamesDeleted} game result${log.gamesDeleted !== 1 ? 's' : ''}`)
        if (log?.groupsReset)    parts.push(`${log.groupsReset} group${log.groupsReset !== 1 ? 's' : ''} cleared`)
        toast({
          title: 'Stage 1 reset ✓',
          description: parts.length ? `Deleted: ${parts.join(', ')}.` : 'All Stage 1 data cleared. Ready to regenerate.',
        })
      }
    })
  }

  const handleAdvance = () => {
    if (!rrStage) return
    startTransition(async () => {
      const closeResult = await closeStage1(rrStage.id, tournament.id)
      if (closeResult.error) {
        setShowAdvance(false)
        toast({ title: 'Cannot close Stage 1', description: closeResult.error, variant: 'destructive' })
        return
      }
      const koResult = await generateKnockoutStage(tournament.id, rrStage.id)
      setShowAdvance(false)
      if (koResult.error) toast({ title: 'Knockout generation failed', description: koResult.error, variant: 'destructive' })
      else toast({ title: '🎯 Stage 2 bracket generated!' })
    })
  }

  const handleForceClose = () => {
    if (!rrStage) return
    startTransition(async () => {
      const closeResult = await forceCloseStage1(rrStage.id, tournament.id)
      if (closeResult.error) {
        setShowForceFinalize(false)
        toast({ title: 'Finalization failed', description: closeResult.error, variant: 'destructive' })
        return
      }
      const koResult = await generateKnockoutStage(tournament.id, rrStage.id)
      setShowForceFinalize(false)
      if (koResult.error) {
        toast({ title: 'Knockout generation failed', description: koResult.error, variant: 'destructive' })
      } else {
        const skipped = closeResult.skippedMatches ?? 0
        toast({
          title: '🎯 Stage 2 bracket generated!',
          description: skipped > 0 ? `${skipped} match${skipped > 1 ? 'es' : ''} were still incomplete.` : undefined,
        })
      }
    })
  }

  const handleKOReset = () => {
    if (!koStage) return
    startTransition(async () => {
      const result = await resetKOStage(koStage.id, tournament.id)
      setShowKOReset(false)
      if (result.error) {
        toast({ title: 'KO reset failed', description: result.error, variant: 'destructive' })
      } else {
        const log = result.log
        const koParts: string[] = []
        if (log?.matchesDeleted) koParts.push(`${log.matchesDeleted} KO match${log.matchesDeleted !== 1 ? 'es' : ''}`)
        if (log?.gamesDeleted)   koParts.push(`${log.gamesDeleted} game result${log.gamesDeleted !== 1 ? 's' : ''}`)
        toast({
          title: 'KO bracket cleared ✓',
          description: koParts.length
            ? `Deleted: ${koParts.join(', ')}. Stage 1 standings preserved.`
            : 'Stage 1 standings preserved.',
        })
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">

      {/* ── STAGE 1 SECTION ──────────────────────────────────────────────── */}
      <SectionHeader
        number={1}
        title="Round Robin Groups"
        status={stage1Complete ? 'complete' : rrPhase === 'no_stage' ? 'pending' : 'active'}
        badge={stage1Complete ? 'Complete' : undefined}
      />

      <div className="border border-border/60 rounded-2xl overflow-hidden">
        <div className="p-5 flex flex-col gap-5">

          {/* Phase stepper */}
          <PhaseHeader phase={rrPhase} />

          {/* no_stage: config form */}
          {rrPhase === 'no_stage' && (
            <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} />
          )}

          {/* no_members: show summary + assign */}
          {rrPhase === 'no_members' && cfg && (
            <div className="flex flex-col gap-4">
              <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />
              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/60">
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
                <p className="text-xs text-muted-foreground sm:ml-auto">Snake-seeds players across groups based on ranking.</p>
              </div>
            </div>
          )}

          {/* no_fixtures: summary + generate */}
          {rrPhase === 'no_fixtures' && cfg && (
            <div className="flex flex-col gap-4">
              <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />
              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/60">
                <Button onClick={handleGenerateFixtures} disabled={isPending}>
                  <Shuffle className="h-4 w-4" />
                  {isPending ? 'Generating…' : 'Generate RR Schedule'}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleAssign} disabled={isPending}
                  className="text-muted-foreground hover:text-foreground">
                  <Users className="h-3.5 w-3.5" /> Re-assign Players
                </Button>
              </div>
            </div>
          )}

          {/* in_progress / all_complete / closed: show standings */}
          {(rrPhase === 'in_progress' || rrPhase === 'all_complete') && cfg && (
            <div className="flex flex-col gap-4">
              <RRConfigPanel players={players} onSubmit={handleCreate} isPending={isPending} existing={cfg} />

              <MatchProgress rrMatches={rrMatches} />

              {hasScores && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/60 rounded-lg px-3 py-2">
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  Group structure is locked while scores exist. Reset the stage to modify groups.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {rrPhase === 'all_complete' && (
                  <Button
                    onClick={() => setShowAdvance(true)}
                    disabled={isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Trophy className="h-4 w-4" />
                    Close Stage 1 &amp; Advance to Knockout
                  </Button>
                )}

                {/* Force-finalize: shown when finalizationRule='manual' and NOT yet all complete */}
                {rrPhase === 'in_progress' && cfg?.finalizationRule === 'manual' && (
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
                  variant="ghost" size="sm"
                  onClick={() => setShowReset(true)}
                  disabled={isPending}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reset Stage 1
                </Button>
              </div>
            </div>
          )}

          {rrPhase === 'closed' && (
            <div className="flex items-center gap-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300 text-sm">Stage 1 complete</p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                  Knockout bracket generated from final standings.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Standings + fixtures (shown once there are members) */}
        {(rrPhase === 'in_progress' || rrPhase === 'all_complete' || rrPhase === 'closed') &&
          rrStandings.length > 0 && cfg && (
          <div className="border-t border-border/60 p-5">
            <GroupStandingsTable
              standings={rrStandings}
              allMatches={rrMatches}
              matchBase={matchBase}
              isAdmin
              advanceCount={cfg.advanceCount}
              allowBestThird={cfg.allowBestThird}
              bestThirdCount={cfg.bestThirdCount}
              initialGroup={initialGroup}
            />
          </div>
        )}
      </div>

      {/* Progression arrow */}
      <div className="flex items-center justify-center py-1">
        <div className={cn(
          'flex flex-col items-center gap-0.5 transition-opacity',
          stage1Complete ? 'opacity-100' : 'opacity-20',
        )}>
          <div className="h-6 w-px bg-orange-400" />
          <ArrowDown className="h-4 w-4 text-orange-500" />
          <span className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
            stage1Complete
              ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300'
              : 'bg-muted text-muted-foreground',
          )}>
            {cfg?.advanceCount ?? 2} per group advance
          </span>
          <div className="h-6 w-px bg-orange-400" />
        </div>
      </div>

      {/* ── STAGE 2 SECTION ──────────────────────────────────────────────── */}
      <SectionHeader
        number={2}
        title="Knockout Bracket"
        status={stage2Generated ? 'complete' : stage1Complete ? 'active' : 'pending'}
        badge={stage2Generated ? 'Generated' : undefined}
        locked={!stage1Complete}
      />

      <div className={cn(
        'border rounded-2xl overflow-hidden transition-opacity',
        !stage1Complete ? 'border-border/30 opacity-60' : 'border-border/60',
      )}>
        <div className="p-5 flex flex-col gap-4">
          {!stage1Complete ? (
            /* Locked state */
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted/40 border border-border flex items-center justify-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-muted-foreground text-sm">Stage 2 locked</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Complete all Stage 1 matches and click "Close Stage 1 & Advance to Knockout".
                </p>
              </div>
            </div>
          ) : !stage2Generated ? (
            /* Ready to generate */
            <div className="flex flex-col gap-4">
              <QualifierSummary standings={rrStandings} cfg={cfg} />
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => setShowAdvance(true)}
                  disabled={isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <Trophy className="h-4 w-4" />
                  {isPending ? 'Generating…' : 'Generate Knockout from Qualifiers'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {stage2Generated && (
          <div className="p-5 pt-0 flex flex-col gap-4">
            {/* Stage 2 reset controls */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {koMatches.filter(m => m.status === 'complete').length} /{' '}
                {koMatches.filter(m => m.status !== 'bye').length} matches complete
              </span>
              <Button
                variant="ghost" size="sm"
                onClick={() => setShowKOReset(true)}
                disabled={isPending}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset KO Bracket
              </Button>
            </div>

            <BracketView
              tournament={tournament}
              matches={koMatches}
              isAdmin
              matchBasePath={matchBase}
            />
          </div>
        )}
      </div>

      {/* Stage 1 reset — rich dialog with stats and typed confirm */}
      <ResetStageDialog
        open={showReset}
        onOpenChange={setShowReset}
        stageLabel="Stage 1 (Group Stage)"
        stageId={rrStage?.id}
        requireTypedConfirm={hasScores}
        isPending={isPending}
        onConfirm={handleReset}
        confirmButtonLabel="Reset Stage 1"
        extraWarning={stage2Generated ? 'The knockout bracket (Stage 2) will also be cleared.' : undefined}
      />

      {/* KO bracket reset */}
      <ResetStageDialog
        open={showKOReset}
        onOpenChange={setShowKOReset}
        stageLabel="Knockout Bracket"
        stageId={koStage?.id}
        requireTypedConfirm={koMatches.some(m => m.status === 'complete')}
        isPending={isPending}
        onConfirm={handleKOReset}
        extraWarning="Stage 1 results are preserved. You can regenerate the bracket from the same standings."
      />

      {/* Force-finalize dialog */}
      {rrStage && (() => {
        const prog = groupProgress(rrMatches.filter(m => m.stage_id === rrStage.id))
        return (
          <FinalizeStage1Dialog
            open={showForceFinalize}
            onOpenChange={setShowForceFinalize}
            incompleteCount={prog.total - prog.completed}
            totalMatches={prog.total}
            isPending={isPending}
            onConfirm={handleForceClose}
          />
        )
      })()}

      {/* Advance confirm */}
      <Dialog open={showAdvance} onOpenChange={setShowAdvance}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" /> Advance to Knockout?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Stage 1 will be <strong className="text-foreground">permanently locked</strong> and the
            knockout bracket will be generated from current standings.
            You will not be able to enter more Stage 1 results after this.
          </p>
          <QualifierSummary standings={rrStandings} cfg={cfg} compact />
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAdvance(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAdvance} disabled={isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white">
              {isPending ? 'Generating…' : 'Generate Knockout'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({
  number, title, status, badge, locked,
}: {
  number: number
  title:  string
  status: 'pending' | 'active' | 'complete'
  badge?: string
  locked?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        'flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold shrink-0 transition-colors',
        status === 'complete' && 'bg-green-500 text-white',
        status === 'active'   && 'bg-orange-500 text-white',
        status === 'pending'  && 'bg-muted text-muted-foreground',
      )}>
        {status === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : number}
      </div>
      <div className="flex items-center gap-2 flex-1">
        <span className="font-display font-semibold text-foreground">Stage {number}: {title}</span>
        {badge && (
          <Badge variant={status === 'complete' ? 'success' : 'live'} className="text-[10px] px-2">
            {badge}
          </Badge>
        )}
        {locked && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground ml-auto">
            <Lock className="h-3 w-3" /> Complete Stage 1 first
          </span>
        )}
      </div>
    </div>
  )
}

function MatchProgress({ rrMatches }: { rrMatches: Match[] }) {
  const real      = rrMatches.filter(m => m.status !== 'bye')
  const completed = real.filter(m => m.status === 'complete').length
  const live      = real.filter(m => m.status === 'live').length
  const total     = real.length
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Match progress</span>
        <span className="font-semibold tabular-nums text-foreground">
          {completed}/{total} complete
          {live > 0 && <span className="text-orange-500 ml-2">{live} live</span>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{pct}% complete</p>
    </div>
  )
}

function QualifierSummary({
  standings, cfg, compact,
}: {
  standings: GroupStandings[]
  cfg?:      RRStageConfig
  compact?:  boolean
}) {
  if (!cfg || !standings.length) return null
  const totalQ = standings.length * cfg.advanceCount +
    (cfg.allowBestThird ? cfg.bestThirdCount : 0)

  if (compact) {
    return (
      <div className="rounded-lg bg-muted/30 border border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{totalQ} players</span> will qualify for the knockout bracket
        ({standings.length} groups × top {cfg.advanceCount}
        {cfg.allowBestThird ? ` + ${cfg.bestThirdCount} best-third` : ''}).
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-muted/20 border border-border/60 p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-foreground">Qualifiers ready</p>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Groups"   value={String(standings.length)} />
        <Tile label="Per group" value={`Top ${cfg.advanceCount}`} />
        <Tile label="Total KO" value={`${totalQ} players`} />
      </div>
      {cfg.allowBestThird && (
        <p className="text-xs text-muted-foreground">
          + {cfg.bestThirdCount} best third-placed player{cfg.bestThirdCount > 1 ? 's' : ''} across all groups.
        </p>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-card border border-border/60 px-3 py-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-semibold text-sm text-foreground">{value}</span>
    </div>
  )
}

// ── Phase header stepper ───────────────────────────────────────────────────────

const RR_STEPS: Array<{ id: RRPhase; label: string }> = [
  { id: 'no_stage',    label: 'Configure' },
  { id: 'no_members',  label: 'Assign' },
  { id: 'no_fixtures', label: 'Schedule' },
  { id: 'in_progress', label: 'Play' },
  { id: 'all_complete', label: 'Advance' },
  { id: 'closed',      label: 'Done' },
]
const RR_ORDER: RRPhase[] = ['no_stage','no_members','no_fixtures','in_progress','all_complete','closed']

function PhaseHeader({ phase }: { phase: RRPhase }) {
  const current = RR_ORDER.indexOf(phase)
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
      {RR_STEPS.map((step, idx) => {
        const isDone   = idx < current
        const isActive = idx === current
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors',
              isDone   && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
              isActive && 'bg-orange-500 text-white',
              !isDone && !isActive && 'bg-muted/60 text-muted-foreground',
            )}>
              {isDone && <CheckCircle2 className="h-3 w-3" />}
              {step.label}
            </div>
            {idx < RR_STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}
