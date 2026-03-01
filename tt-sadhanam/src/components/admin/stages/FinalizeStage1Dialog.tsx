'use client'

import React from 'react'

/**
 * FinalizeStage1Dialog
 *
 * Shown when admin wants to close Stage 1 early (before all matches are done).
 * Only available when finalizationRule = 'manual'.
 *
 * Shows:
 *  • How many matches are still incomplete
 *  • Which players won't have full results (standings computed from partial data)
 *  • Warning that standings used for KO seeding will be from partial results
 *  • Requires typing "FINALIZE" to proceed
 */

import { useState } from 'react'
import { ShieldAlert, Trophy, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/index'

interface Props {
  open:             boolean
  onOpenChange:     (open: boolean) => void
  /** Number of non-bye RR matches that haven't been completed */
  incompleteCount:  number
  /** Total non-bye RR matches in the stage */
  totalMatches:     number
  isPending:        boolean
  onConfirm:        () => void
}

export function FinalizeStage1Dialog({
  open, onOpenChange,
  incompleteCount, totalMatches,
  isPending, onConfirm,
}: Props) {
  const [typed, setTyped] = useState('')

  const completedCount  = totalMatches - incompleteCount
  const completionPct   = totalMatches > 0 ? Math.round((completedCount / totalMatches) * 100) : 0
  const confirmReady    = typed.trim().toUpperCase() === 'FINALIZE'

  const handleOpenChange = (v: boolean) => {
    if (!isPending) { setTyped(''); onOpenChange(v) }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="h-8 w-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            Finalize Group Stage Early?
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">

          {/* ── Completion status ── */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 flex flex-col gap-3">
            {/* Progress bar */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Match completion</span>
                <span className="font-semibold tabular-nums">
                  {completedCount} / {totalMatches}
                  <span className="text-muted-foreground ml-1">({completionPct}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>

            {/* Status items */}
            <div className="flex flex-col gap-1.5">
              <StatusItem
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                text={`${completedCount} match${completedCount !== 1 ? 'es' : ''} completed`}
              />
              <StatusItem
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                text={`${incompleteCount} match${incompleteCount !== 1 ? 'es' : ''} still pending — results will be treated as not played`}
                muted
              />
            </div>
          </div>

          {/* ── Consequence warning ── */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-3">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                Standings will be based on partial results
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                Players who haven't played all their matches will have lower win counts.
                This may produce unexpected seedings in the knockout bracket.
                This action cannot be undone.
              </p>
            </div>
          </div>

          {/* ── What happens next ── */}
          <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
            <Trophy className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Current standings will be frozen and used to seed the knockout bracket.
              Incomplete matches will be locked and cannot be scored after finalization.
            </p>
          </div>

          {/* ── Typed confirmation ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Type <span className="font-mono text-amber-600 dark:text-amber-400">FINALIZE</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="FINALIZE"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'field-base font-mono text-sm',
                typed && !confirmReady && 'border-amber-500/50',
                confirmReady && 'border-green-500/60',
              )}
            />
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isPending || !confirmReady}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Finalizing…
                </span>
              ) : (
                <>
                  <Trophy className="h-4 w-4" />
                  Finalize &amp; Advance
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusItem({ icon, text, muted }: { icon: React.ReactNode; text: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span className={cn('text-xs', muted ? 'text-muted-foreground' : 'text-foreground')}>{text}</span>
    </div>
  )
}
