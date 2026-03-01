'use client'

/**
 * MultiStageSetup.tsx
 *
 * The admin UI for configuring and running a multi-stage tournament.
 * Renders inside the "Stage 1: Groups" tab on the event admin page.
 *
 * ── STATE MACHINE ─────────────────────────────────────────────────────────────
 *
 *  NOT_CONFIGURED
 *    ↓  admin fills form + clicks "Create Stage 1"
 *  CONFIGURED (stage exists, no groups assigned)
 *    ↓  admin clicks "Assign Players to Groups"
 *  GROUPS_ASSIGNED (rr_group_members exist, no matches)
 *    ↓  admin clicks "Generate Fixtures"
 *  FIXTURES_GENERATED (matches exist, no scores)  ← can Reset without confirm
 *    ↓  scores entered via existing match-scoring page
 *  SCORES_EXIST (some games recorded)             ← Reset requires confirmation
 *    ↓  all matches complete
 *  ALL_COMPLETE
 *    ↓  admin clicks "Close Stage 1 & Advance"
 *  CLOSED  →  Stage 2 knockout tab becomes active
 *
 * ── LOCK BEHAVIOUR ────────────────────────────────────────────────────────────
 *
 * Structure (groups, config) is locked once hasScores=true.
 * "Reset Stage" button always visible; requires a confirmation dialog when
 * hasScores=true to avoid accidental data loss.
 */

import { useState, useTransition } from 'react'
import {
  Settings2, Users, Shuffle, Lock, Unlock, ChevronRight,
  AlertTriangle, Trophy, CheckCircle2, RefreshCw,
} from 'lucide-react'
import { cn }          from '@/lib/utils'
import type { Tournament, Player, Stage, RRStageConfig } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'
import type { Match }         from '@/lib/types'
import { Button }             from '@/components/ui/button'
import {
  Card, CardContent, CardHeader, CardTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Switch, Label,
} from '@/components/ui/index'
import { toast }   from '@/components/ui/toaster'
import { GroupStandingsTable } from './stages/GroupStandingsTable'
import { createRRStage, resetStage, closeStage1, deleteStageOnly } from '@/lib/actions/stages'
import { generateGroups, generateFixtures } from '@/lib/actions/roundRobin'
import { generateKnockoutStage } from '@/lib/actions/knockout'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  tournament:    Tournament
  players:       Player[]
  stage:         Stage | null
  standings:     GroupStandings[]
  rrMatches:     Match[]
  hasScores:     boolean
  allComplete:   boolean
  matchBase:     string   // URL prefix for scoring links
  onKOGenerated?: () => void
  initialGroup?: number
}

type Phase =
  | 'not_configured'
  | 'configured'       // stage exists, groups not yet assigned
  | 'groups_assigned'  // group_members exist, no fixtures
  | 'fixtures'         // fixtures exist (may or may not have scores)
  | 'all_complete'     // all matches finished
  | 'closed'           // stage1_complete=true

// ─────────────────────────────────────────────────────────────────────────────

export function MultiStageSetup({
  tournament,
  players,
  stage,
  standings,
  rrMatches,
  hasScores,
  allComplete,
  matchBase,
  initialGroup = 0,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [showReset, setShowReset]    = useState(false)
  const [showAdvance, setShowAdvance] = useState(false)

  // Config form state (only shown in not_configured phase)
  const [perGroup,      setPerGroup]      = useState('4')   // players per group → groups auto-calculated
  const [advanceCount,  setAdvanceCount]  = useState('2')
  const [matchFormat,   setMatchFormat]   = useState<'bo3' | 'bo5' | 'bo7'>('bo3')
  const [allowThird,    setAllowThird]    = useState(false)
  const [thirdCount,    setThirdCount]    = useState('2')

  // Determine phase
  const phase: Phase = resolvePhase(tournament, stage, standings, rrMatches, hasScores, allComplete)

  const cfg = stage?.config as RRStageConfig | undefined

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateStage = () => {
    const ppg     = Math.max(2, Math.min(16, parseInt(perGroup) || 4))
    const nGroups = Math.max(1, Math.ceil(players.length / ppg))
    const advance = parseInt(advanceCount)
    const nThird  = parseInt(thirdCount)

    // Only block if smallest group would have < 2 players (matches UI validation)
    const minGroupSize = nGroups > 0 ? Math.floor(players.length / nGroups) : 0
    if (players.length < 2 || minGroupSize < 2) {
      toast({
        title: 'Not enough players',
        description: `${nGroups} groups need at least ${nGroups * 2} players. You have ${players.length}.`,
        variant: 'destructive',
      })
      return
    }

    startTransition(async () => {
      const result = await createRRStage({
        tournamentId:   tournament.id,
        stageNumber:    1,
        numberOfGroups: nGroups,
        advanceCount:   advance,
        matchFormat,
        allowBestThird: allowThird,
        bestThirdCount: allowThird ? nThird : 0,
      })
      if (result.error) {
        toast({ title: 'Could not create stage', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Stage 1 created', description: `${nGroups} groups · top ${advance} advance` })
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

  const handleAssignPlayers = () => {
    if (!stage) return
    startTransition(async () => {
      const result = await generateGroups(stage.id, tournament.id)
      if (result.error) {
        toast({ title: 'Group assignment failed', description: result.error, variant: 'destructive' })
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
        toast({ title: 'Fixture generation failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: '🗓 Fixtures generated', description: `${result.matchCount} matches created` })
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
        toast({ title: 'Stage 1 reset', description: 'All matches and scores cleared.' })
      }
    })
  }

  const handleCloseAndAdvance = () => {
    if (!stage) return
    startTransition(async () => {
      // First close Stage 1
      const closeResult = await closeStage1(stage.id, tournament.id)
      if (closeResult.error) {
        setShowAdvance(false)
        toast({ title: 'Cannot close Stage 1', description: closeResult.error, variant: 'destructive' })
        return
      }
      // Then generate knockout
      const koResult = await generateKnockoutStage(tournament.id, stage.id)
      setShowAdvance(false)
      if (koResult.error) {
        toast({ title: 'Knockout generation failed', description: koResult.error, variant: 'destructive' })
      } else {
        toast({ title: '🎯 Stage 2 bracket generated!', description: 'Knockout bracket is ready.' })
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Phase header */}
      <PhaseHeader phase={phase} cfg={cfg} players={players} />

      {/* Phase-specific content */}
      {phase === 'not_configured' && (
        <ConfigForm
          perGroup={perGroup}       setPerGroup={setPerGroup}
          advanceCount={advanceCount} setAdvanceCount={setAdvanceCount}
          matchFormat={matchFormat}  setMatchFormat={setMatchFormat}
          allowThird={allowThird}    setAllowThird={setAllowThird}
          thirdCount={thirdCount}    setThirdCount={setThirdCount}
          players={players}
          onSubmit={handleCreateStage}
          isPending={isPending}
        />
      )}

      {phase === 'configured' && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground mb-4">
              Stage is configured. Assign players to their groups to continue.
            </p>
            <ConfigSummary cfg={cfg!} players={players} />
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={handleAssignPlayers} disabled={isPending} className="flex-1 sm:flex-none">
                <Users className="h-4 w-4" />
                {isPending ? 'Assigning…' : 'Assign Players to Groups'}
              </Button>
              <Button
                variant="outline"
                onClick={handleReconfigure}
                disabled={isPending}
                className="flex-1 sm:flex-none text-muted-foreground"
              >
                ← Reconfigure
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(phase === 'groups_assigned' || phase === 'fixtures' || phase === 'all_complete') && (
        <>
          {/* Group composition + fixtures/standings */}
          {standings.length > 0 && (
            <GroupStandingsTable
              standings={standings}
              allMatches={rrMatches}
              matchBase={matchBase}
              isAdmin
              advanceCount={cfg?.advanceCount ?? 2}
              allowBestThird={cfg?.allowBestThird}
              bestThirdCount={cfg?.bestThirdCount}
              initialGroup={initialGroup}
            />
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {phase === 'groups_assigned' && (
              <Button onClick={handleGenerateFixtures} disabled={isPending}>
                <Shuffle className="h-4 w-4" />
                {isPending ? 'Generating…' : 'Generate Fixtures'}
              </Button>
            )}

            {phase === 'all_complete' && (
              <Button
                onClick={() => setShowAdvance(true)}
                disabled={isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Trophy className="h-4 w-4" />
                Close Stage 1 &amp; Advance to Knockout
              </Button>
            )}

            {/* Reset button — always visible after stage created */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => hasScores ? setShowReset(true) : handleReset()}
              disabled={isPending}
              className="text-destructive border-destructive/40 hover:bg-destructive/10 ml-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset Stage
            </Button>
          </div>
        </>
      )}

      {phase === 'closed' && (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="font-semibold text-green-800 dark:text-green-300 text-sm">Stage 1 complete — read only</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                Knockout bracket generated. Switch to Stage 2: Knockout tab.
              </p>
            </div>
          </div>
          {/* Keep standings visible — tabs navigable, scoring links hidden */}
          {standings.length > 0 && (
            <GroupStandingsTable
              standings={standings}
              allMatches={rrMatches}
              matchBase={matchBase}
              isAdmin={false}
              advanceCount={cfg?.advanceCount ?? 2}
              allowBestThird={cfg?.allowBestThird}
              bestThirdCount={cfg?.bestThirdCount}
              initialGroup={initialGroup}
            />
          )}
        </>
      )}

      {/* Lock indicator when scores exist but not yet all complete */}
      {hasScores && phase === 'fixtures' && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Group structure is locked while scores exist. Reset the stage to make changes.
        </div>
      )}

      {/* Reset confirm dialog */}
      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Reset Stage 1?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will <strong className="text-foreground">permanently delete all match results and game scores</strong> for Stage 1.
            Group assignments and fixtures will also be cleared. This cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowReset(false)} className="flex-1">Cancel</Button>
            <Button variant="destructive" onClick={handleReset} disabled={isPending} className="flex-1">
              {isPending ? 'Resetting…' : 'Reset everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Advance confirm dialog */}
      <Dialog open={showAdvance} onOpenChange={setShowAdvance}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Advance to Knockout?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Stage 1 will be locked and the knockout bracket will be generated from the current standings.
            You will not be able to enter more Stage 1 results after this.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAdvance(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={handleCloseAndAdvance}
              disabled={isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {isPending ? 'Generating…' : 'Generate Knockout'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Phase resolution ──────────────────────────────────────────────────────────

function resolvePhase(
  tournament: Tournament,
  stage:      Stage | null,
  standings:  GroupStandings[],
  rrMatches:  Match[],
  hasScores:  boolean,
  allComplete: boolean,
): Phase {
  if (tournament.stage1_complete) return 'closed'
  if (!stage) return 'not_configured'
  if (!standings.length || standings.every(gs => gs.standings.length === 0)) return 'configured'
  const hasFixtures = rrMatches.some(m => m.match_kind === 'round_robin')
  if (!hasFixtures) return 'groups_assigned'
  if (allComplete) return 'all_complete'
  return 'fixtures'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseHeader({ phase, cfg, players }: {
  phase:   Phase
  cfg?:    RRStageConfig
  players: Player[]
}) {
  const steps: Array<{ id: Phase; label: string }> = [
    { id: 'not_configured',  label: 'Configure' },
    { id: 'configured',      label: 'Assign Players' },
    { id: 'groups_assigned', label: 'Generate Fixtures' },
    { id: 'fixtures',        label: 'Play Matches' },
    { id: 'all_complete',    label: 'Advance' },
    { id: 'closed',          label: 'Done' },
  ]

  const phaseOrder: Phase[] = ['not_configured','configured','groups_assigned','fixtures','all_complete','closed']
  const currentStep = phaseOrder.indexOf(phase)

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((step, idx) => {
        const isDone    = idx < currentStep
        const isActive  = idx === currentStep
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors',
              isDone   && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
              isActive && 'bg-orange-500 text-white',
              !isDone && !isActive && 'bg-muted text-muted-foreground',
            )}>
              {isDone && <CheckCircle2 className="h-3 w-3" />}
              {step.label}
            </div>
            {idx < steps.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConfigSummary({ cfg, players }: { cfg: RRStageConfig; players: Player[] }) {
  const totalQualify = cfg.numberOfGroups * cfg.advanceCount +
    (cfg.allowBestThird ? cfg.bestThirdCount : 0)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Groups',   value: String(cfg.numberOfGroups) },
        { label: 'Players',  value: String(players.length) },
        { label: 'Top N',    value: `${cfg.advanceCount} per group` },
        { label: 'Qualifiers', value: `${totalQualify} total` },
      ].map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-0.5 bg-muted/30 rounded-lg p-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
          <span className="font-semibold text-foreground text-sm">{value}</span>
        </div>
      ))}
    </div>
  )
}

// ── ConfigForm ────────────────────────────────────────────────────────────────

interface ConfigFormProps {
  perGroup:      string;   setPerGroup:     (v: string) => void
  advanceCount:  string;   setAdvanceCount: (v: string) => void
  matchFormat:   'bo3'|'bo5'|'bo7'; setMatchFormat: (v: 'bo3'|'bo5'|'bo7') => void
  allowThird:    boolean;  setAllowThird:   (v: boolean) => void
  thirdCount:    string;   setThirdCount:   (v: string) => void
  players:       Player[]
  onSubmit:      () => void
  isPending:     boolean
}

function ConfigForm({
  perGroup, setPerGroup,
  advanceCount, setAdvanceCount,
  matchFormat, setMatchFormat,
  allowThird, setAllowThird,
  thirdCount, setThirdCount,
  players, onSubmit, isPending,
}: ConfigFormProps) {
  const ppg      = Math.max(2, Math.min(16, parseInt(perGroup) || 4))
  const nG       = Math.max(1, Math.ceil(players.length / ppg))
  const nA       = parseInt(advanceCount) || 2
  const nT       = allowThird ? (parseInt(thirdCount) || 2) : 0
  const totalQ   = nG * nA + nT

  // Only block if smallest group would have < 2 players (backend hard limit).
  // Uneven groups are fine — players are snake-seeded across groups.
  const minGroupSize  = nG > 0 ? Math.floor(players.length / nG) : 0
  const canSubmit     = players.length >= 2 && nG >= 1 && nA >= 1 && minGroupSize >= 2

  // Info about uneven distribution
  const largeGroups = players.length % nG
  const smallGroups = nG - largeGroups
  const ceilPPG     = Math.ceil(players.length / nG)
  const floorPPG    = Math.floor(players.length / nG)
  const isUneven    = players.length > 0 && largeGroups > 0 && largeGroups < nG

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-orange-500" />
          Configure Stage 1 — Round Robin Groups
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Row 1: three controls — single column on mobile, 3-col on sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Players per group</Label>
            <input
              type="number"
              min={2}
              max={16}
              value={perGroup}
              onChange={e => setPerGroup(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. 4"
            />
            <p className="text-[10px] text-orange-700 dark:text-orange-400 font-medium">
              → {nG} group{nG !== 1 ? 's' : ''} auto-calculated
              {players.length > 0 ? ` (${players.length} ÷ ${ppg})` : ' — add players first'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Top N qualify per group</Label>
            <Select value={advanceCount} onValueChange={setAdvanceCount}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4].map(n => (
                  <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Match format (groups)</Label>
            <Select value={matchFormat} onValueChange={v => setMatchFormat(v as 'bo3'|'bo5'|'bo7')}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bo3">Best of 3</SelectItem>
                <SelectItem value="bo5">Best of 5</SelectItem>
                <SelectItem value="bo7">Best of 7</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Best-third toggle */}
        <div className="flex flex-col gap-3 pt-2 border-t border-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-medium text-foreground cursor-pointer">
                Allow best-placed third-place qualifiers
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                UEFA-style: the best third-placed player(s) across all groups also advance.
              </p>
            </div>
            <Switch checked={allowThird} onCheckedChange={setAllowThird} className="mt-0.5 shrink-0" />
          </div>

          {allowThird && (
            <div className="flex items-center gap-3 pl-1">
              <Label className="text-xs text-muted-foreground shrink-0">Number of best-thirds:</Label>
              <Select value={thirdCount} onValueChange={setThirdCount}>
                <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className={cn(
          'rounded-lg px-4 py-3 text-sm',
          canSubmit ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800' :
                      'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800',
        )}>
          <p className={cn('font-medium', canSubmit ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300')}>
            {canSubmit ? '✓ Configuration valid' : '✗ Too few players'}
          </p>
          <p className={cn('text-xs mt-0.5', canSubmit ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
            {nG} group{nG > 1 ? 's' : ''} · top {nA} qualify per group{allowThird ? ` + ${nT} best-third` : ''} →
            {' '}<strong>{totalQ} total qualifiers</strong>.
            {!canSubmit && ` Need at least ${nG * 2} players for ${nG} groups (have ${players.length}).`}
          </p>
          {canSubmit && isUneven && (
            <p className="text-xs mt-1 text-green-600 dark:text-green-500">
              ℹ {largeGroups} group{largeGroups > 1 ? 's' : ''} of {ceilPPG} · {smallGroups} group{smallGroups > 1 ? 's' : ''} of {floorPPG} — players snake-seeded across groups.
            </p>
          )}
        </div>

        <Button onClick={onSubmit} disabled={!canSubmit || isPending} className="w-full sm:w-auto self-start">
          {isPending ? 'Creating…' : 'Create Stage 1'}
        </Button>
      </CardContent>
    </Card>
  )
}
