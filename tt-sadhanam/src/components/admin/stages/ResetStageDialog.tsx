'use client'

import React from 'react'

/**
 * ResetStageDialog
 *
 * Reusable confirmation dialog for destructive stage resets.
 *
 * ── What it shows ─────────────────────────────────────────────────────────────
 *  • A summary of what will be deleted (match count, game count)
 *  • A "This cannot be undone" warning with specific numbers
 *  • When completedMatchCount > 0: extra amber warning about losing results
 *  • When requireTypedConfirm=true: admin must type "RESET" before button enables
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *  <ResetStageDialog
 *    open={showReset}
 *    onOpenChange={setShowReset}
 *    stageLabel="Group Stage"
 *    stageId={stage.id}
 *    isPending={isPending}
 *    onConfirm={handleReset}
 *  />
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2, Database, Trophy, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/index'
import { getStageResetStats, getKOResetStats } from '@/lib/actions/stages'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  matchCount:          number
  completedMatchCount: number
  liveMatchCount:      number
  gameCount:           number
}

interface Props {
  open:              boolean
  onOpenChange:      (open: boolean) => void
  /** Human label shown in title, e.g. "Group Stage", "Stage 1 RR", "KO Bracket" */
  stageLabel:        string
  /** If provided, stats are loaded from the server when dialog opens. */
  stageId?:          string
  /** Alternative to stageId: loads stats via tournament ID (for single-KO format). */
  tournamentId?:     string
  /** If true, admin must type "RESET" to enable the confirm button. */
  requireTypedConfirm?: boolean
  /** Override button label (default: "Reset <stageLabel>") */
  confirmButtonLabel?: string
  isPending:         boolean
  onConfirm:         () => void
  /** Extra warning paragraph (e.g. "Stage 2 will also be cleared.") */
  extraWarning?:     string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ResetStageDialog({
  open, onOpenChange,
  stageLabel, stageId, tournamentId,
  requireTypedConfirm = false,
  isPending,
  onConfirm,
  extraWarning,
  confirmButtonLabel,
}: Props) {
  const [stats,        setStats]        = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [typedValue,   setTypedValue]   = useState('')

  // Load stats when dialog opens (only if stageId provided)
  useEffect(() => {
    if (!open) {
      setStats(null)
      setTypedValue('')
      return
    }
    if (!stageId && !tournamentId) return

    setStatsLoading(true)
    const fetch = stageId
      ? getStageResetStats(stageId)
      : getKOResetStats(tournamentId!)
    fetch.then(s => {
      setStats(s)
      setStatsLoading(false)
    }).catch(() => setStatsLoading(false))
  }, [open, stageId, tournamentId])

  const hasResults = (stats?.completedMatchCount ?? 0) > 0 || (stats?.gameCount ?? 0) > 0
  const confirmReady = !requireTypedConfirm || typedValue.trim().toUpperCase() === 'RESET'

  const handleConfirm = () => {
    if (!confirmReady || isPending) return
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            Reset {stageLabel}?
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">

          {/* ── What will be deleted ── */}
          <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/40 bg-muted/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Will be permanently deleted
              </span>
            </div>

            {statsLoading ? (
              <div className="p-3 flex flex-col gap-2">
                {[0,1,2].map(i => (
                  <div key={i} className="h-4 rounded bg-muted/50 animate-pulse" style={{ width: `${60+i*15}%` }} />
                ))}
              </div>
            ) : (
              <div className="p-3 flex flex-col gap-2">
                <StatRow
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Matches"
                  value={stats ? `${stats.matchCount} match${stats.matchCount !== 1 ? 'es' : ''}` : 'All matches'}
                  danger={stats ? stats.matchCount > 0 : false}
                />
                <StatRow
                  icon={<Database className="h-3.5 w-3.5" />}
                  label="Game results"
                  value={stats ? `${stats.gameCount} game score${stats.gameCount !== 1 ? 's' : ''}` : 'All game scores'}
                  danger={stats ? stats.gameCount > 0 : false}
                />
                {stats && stats.completedMatchCount > 0 && (
                  <StatRow
                    icon={<Trophy className="h-3.5 w-3.5" />}
                    label="Completed results lost"
                    value={`${stats.completedMatchCount} completed match${stats.completedMatchCount !== 1 ? 'es' : ''}`}
                    danger
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Extra warning (e.g. cascading effects) ── */}
          {extraWarning && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2.5">
              <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">{extraWarning}</p>
            </div>
          )}

          {/* ── Main warning ── */}
          <p className="text-sm text-muted-foreground">
            {hasResults
              ? <><strong className="text-foreground">All {stats?.completedMatchCount ?? ''} match results and {stats?.gameCount ?? ''} game scores will be permanently lost.</strong> Group assignments will be cleared. The stage can be reconfigured and replayed from scratch.</>
              : <>All match fixtures and group assignments will be cleared. The stage can be regenerated from scratch. <span className="text-muted-foreground/70">No scored results will be lost.</span></>
            }
          </p>

          {/* ── Typed confirmation for high-risk resets ── */}
          {requireTypedConfirm && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Type <span className="font-mono text-destructive">RESET</span> to confirm
              </label>
              <input
                type="text"
                value={typedValue}
                onChange={e => setTypedValue(e.target.value)}
                placeholder="RESET"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'field-base font-mono text-sm',
                  typedValue && !confirmReady && 'border-destructive/60 ring-destructive/30',
                  confirmReady && 'border-primary/60',
                )}
              />
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending || !confirmReady}
              className="flex-1"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Resetting…
                </span>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {confirmButtonLabel ?? `Reset ${stageLabel}`}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── StatRow ───────────────────────────────────────────────────────────────────

function StatRow({
  icon, label, value, danger,
}: {
  icon:   React.ReactNode
  label:  string
  value:  string
  danger: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('shrink-0', danger ? 'text-destructive/70' : 'text-muted-foreground/50')}>
        {icon}
      </span>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={cn('text-xs font-semibold tabular-nums', danger ? 'text-destructive' : 'text-foreground')}>
        {value}
      </span>
    </div>
  )
}
