'use client'

/**
 * RRConfigPanel
 *
 * The group-stage configuration form.  Used by both SingleRRStage and
 * MultiStagePanel (Stage 1 section).
 *
 * Renders two modes:
 *   'form'    — for when no stage exists yet (create)
 *   'summary' — for when a stage exists (locked or view-only)
 *
 * Parent is responsible for calling createRRStage / resetStage.
 */

import { useState } from 'react'
import { Settings2, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Player, RRStageConfig, MatchFormat } from '@/lib/types'
import {
  Card, CardContent, CardHeader, CardTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Switch, Label,
} from '@/components/ui/index'
import { Button } from '@/components/ui/button'

interface Props {
  players:      Player[]
  onSubmit:     (cfg: RRConfigValues) => void
  isPending:    boolean
  /** If provided, render in summary mode instead of form */
  existing?:    RRStageConfig
}

export interface RRConfigValues {
  numberOfGroups:   number
  advanceCount:     number
  matchFormat:      MatchFormat
  allowBestThird:   boolean
  bestThirdCount:   number
  finalizationRule: 'require_all' | 'manual'
}

export function RRConfigPanel({ players, onSubmit, isPending, existing }: Props) {
  const [perGroup,     setPerGroup]     = useState(String(existing ? Math.round(players.length / (existing.numberOfGroups || 1)) : 4))
  const [advanceCount, setAdvanceCount] = useState(String(existing?.advanceCount   ?? 2))
  const [matchFormat,  setMatchFormat]  = useState<MatchFormat>(existing?.matchFormat ?? 'bo3')
  const [allowThird,   setAllowThird]   = useState(existing?.allowBestThird ?? false)
  const [thirdCount,   setThirdCount]   = useState(String(existing?.bestThirdCount ?? 2))
  const [showHelp,       setShowHelp]       = useState(false)
  const [finalizeRule, setFinalizeRule] = useState<'require_all' | 'manual'>(
    existing?.finalizationRule ?? 'require_all'
  )

  const PPG = Math.max(2, Math.min(16, parseInt(perGroup) || 4))
  const G  = existing?.numberOfGroups ?? Math.max(1, Math.ceil(players.length / PPG))
  const A  = parseInt(advanceCount) || 2
  const T  = allowThird ? (parseInt(thirdCount) || 2) : 0
  const totalQ = G * A + T

  // Only block if groups would have < 2 players (backend hard limit).
  // Uneven groups (some smaller than PPG) are fine — handled by seeding/byes.
  const minGroupSize = G > 0 ? Math.floor(players.length / G) : 0
  const canSubmit    = players.length >= 2 && G >= 1 && A >= 1 && minGroupSize >= 2

  // Informational: how many groups are smaller than the target
  const largeGroupCount = players.length % G          // groups with ceil players
  const smallGroupCount = G - largeGroupCount         // groups with floor players
  const ceilPPG = Math.ceil(players.length / G)
  const floorPPG = Math.floor(players.length / G)
  const isUneven = players.length > 0 && largeGroupCount > 0 && largeGroupCount < G

  const handleSubmit = () => {
    onSubmit({ numberOfGroups: G, advanceCount: A, matchFormat, allowBestThird: allowThird, bestThirdCount: T, finalizationRule: finalizeRule })
  }

  // Summary mode for locked stage
  if (existing) {
    const totalQExisting = existing.numberOfGroups * existing.advanceCount +
      (existing.allowBestThird ? existing.bestThirdCount : 0)
    return (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryTile label="Groups"      value={String(existing.numberOfGroups)} />
        <SummaryTile label="Top N"       value={`Top ${existing.advanceCount} / group`} />
        <SummaryTile label="Format"      value={existing.matchFormat.replace('bo', 'Best of ')} />
        <SummaryTile label="Qualifiers"  value={`${totalQExisting} total`}
          sub={existing.allowBestThird ? `+${existing.bestThirdCount} best-third` : undefined}
        />
        <SummaryTile
          label="Finalize rule"
          value={existing.finalizationRule === 'manual' ? 'Manual override' : 'Require all'}
          highlight={existing.finalizationRule === 'manual'}
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-orange-500" />
          Configure Groups
          <button
            onClick={() => setShowHelp(h => !h)}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            title="Show help"
          >
            {showHelp
              ? <ChevronUp className="h-4 w-4" />
              : <HelpCircle className="h-4 w-4" />
            }
          </button>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Contextual help */}
        {showHelp && (
          <div className="rounded-xl bg-muted/30 border border-border px-4 py-3 text-sm text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1.5">How group stages work</p>
            <ul className="flex flex-col gap-1 text-xs">
              <li>• Players are <strong className="text-foreground">snake-seeded</strong> into groups — seeded players are spread evenly.</li>
              <li>• Each player plays every other player in their group exactly once.</li>
              <li>• <strong className="text-foreground">Top N qualify</strong> per group advance to the knockout stage.</li>
              <li>• <strong className="text-foreground">Best-third</strong> (optional): picks the best 3rd-placed finishers across all groups — useful when the total qualifiers must be a power of 2.</li>
            </ul>
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Players per group</Label>
            <input
              type="number"
              min={2}
              max={16}
              value={perGroup}
              onChange={e => setPerGroup(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. 4"
            />
            <p className="text-[10px] text-muted-foreground font-medium text-orange-700 dark:text-orange-400">
              → {G} group{G !== 1 ? 's' : ''} auto-calculated ({players.length > 0 ? `${players.length} ÷ ${PPG}` : 'add players first'})
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Qualify per group</Label>
            <Select value={advanceCount} onValueChange={setAdvanceCount}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,4].map(n => (
                  <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Match format (groups)</Label>
            <Select value={matchFormat} onValueChange={v => setMatchFormat(v as MatchFormat)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bo3">Best of 3</SelectItem>
                <SelectItem value="bo5">Best of 5</SelectItem>
                <SelectItem value="bo7">Best of 7</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Best-third toggle */}
        <div className="flex flex-col gap-3 pt-3 border-t border-border/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Best third-placed qualifiers</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                UEFA-style: pick the best-performing 3rd-place players across all groups.
                Useful to reach a power-of-2 bracket size.
              </p>
            </div>
            <Switch checked={allowThird} onCheckedChange={setAllowThird} />
          </div>

          {allowThird && (
            <div className="flex items-center gap-3 ml-1">
              <Label className="text-xs text-muted-foreground shrink-0">How many best-thirds:</Label>
              <Select value={thirdCount} onValueChange={setThirdCount}>
                <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Finalization rule */}
        <div className="flex flex-col gap-2 pt-3 border-t border-border/60">
          <div>
            <p className="text-sm font-medium text-foreground">Finalization rule</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Controls when Stage 1 can be closed and the knockout bracket generated.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFinalizeRule('require_all')}
              className={cn(
                'option-card px-3 py-2.5 text-left flex flex-col gap-0.5',
                finalizeRule === 'require_all' && 'selected',
              )}
            >
              <span className="text-sm font-semibold">Require all matches</span>
              <span className="text-xs text-muted-foreground">Stage can only close when every match is complete.</span>
            </button>
            <button
              type="button"
              onClick={() => setFinalizeRule('manual')}
              className={cn(
                'option-card px-3 py-2.5 text-left flex flex-col gap-0.5',
                finalizeRule === 'manual' && 'selected',
              )}
            >
              <span className="text-sm font-semibold">Manual override</span>
              <span className="text-xs text-muted-foreground">Admin can force-close at any time with an override dialog.</span>
            </button>
          </div>
        </div>

        {/* Preview pill */}
        <div className={cn(
          'rounded-xl px-4 py-3 text-sm border transition-colors',
          canSubmit
            ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
        )}>
          <p className={cn(
            'font-semibold text-sm',
            canSubmit ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300',
          )}>
            {canSubmit ? '✓ Valid configuration' : '✗ Too few players'}
          </p>
          <p className={cn(
            'text-xs mt-0.5',
            canSubmit ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400',
          )}>
            {G} group{G > 1 ? 's' : ''} · top {A} advance{allowThird ? ` + ${T} best-third` : ''} →{' '}
            <strong>{totalQ} total qualifiers</strong>.
            {!canSubmit && ` Need at least ${G * 2} players for ${G} groups (have ${players.length}).`}
          </p>
          {/* Uneven group note — informational only, not a blocker */}
          {canSubmit && isUneven && (
            <p className="text-xs mt-1 text-green-600 dark:text-green-500">
              ℹ {largeGroupCount} group{largeGroupCount > 1 ? 's' : ''} of {ceilPPG} · {smallGroupCount} group{smallGroupCount > 1 ? 's' : ''} of {floorPPG} — seeded players spread evenly.
            </p>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="self-start"
        >
          {isPending ? 'Creating…' : 'Create Group Stage'}
        </Button>
      </CardContent>
    </Card>
  )
}

function SummaryTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col gap-0.5 rounded-xl border px-3 py-2.5",
      highlight
        ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300/60 dark:border-amber-700/60"
        : "bg-muted/30 border-border/60",
    )}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <span className={cn("font-semibold text-sm", highlight ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}
