'use client'

/**
 * BracketControls + GenerateDrawButton — Setup Tab
 * Consolidated into one file to reduce file count.
 */

import { useState, useTransition } from 'react'
import { Shuffle, AlertTriangle, Calendar, MapPin, Trophy } from 'lucide-react'
import type { Tournament, Player } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/index'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import { generateBracketAction } from '@/lib/actions/tournaments'
import { toast } from '@/components/ui/toaster'

interface Props {
  tournament: Tournament
  players:    Player[]
}

export function GenerateDrawButton({ tournament, players }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isPending, startTransition]  = useTransition()

  const canGenerate = players.length >= 2
  const isGenerated = tournament.bracket_generated

  const doGenerate = () => {
    setShowConfirm(false)
    startTransition(async () => {
      try {
        await generateBracketAction(tournament.id)
        toast({ title: '🎯 Draw generated!', description: `${players.length} players drawn. Public view enabled.` })
      } catch (e: unknown) {
        toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  return (
    <>
      <Button
        onClick={() => isGenerated ? setShowConfirm(true) : doGenerate()}
        disabled={!canGenerate || isPending}
        variant={isGenerated ? 'outline' : 'default'}
        size="sm"
        className="shrink-0"
        title={!canGenerate ? 'Add at least 2 players first' : undefined}
      >
        <Shuffle className="h-4 w-4" />
        {isPending ? 'Drawing…' : isGenerated ? 'Re-draw' : 'Generate Draw'}
      </Button>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Re-generate bracket?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will <strong className="text-foreground">delete all current match results and scores</strong> and
            create a new random draw. This cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowConfirm(false)} className="flex-1">Cancel</Button>
            <Button variant="destructive" onClick={doGenerate} disabled={isPending} className="flex-1">Re-generate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function BracketControls({ tournament, players }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-orange-500" />
            Tournament Details
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoTile label="Players"  value={`${players.length}`} />
            <InfoTile label="Format"   value={formatFormatLabel(tournament.format)} />
            <InfoTile
              label="Date"
              value={tournament.date ? formatDate(tournament.date) : '—'}
              icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <InfoTile
              label="Location"
              value={tournament.location ?? '—'}
              icon={<MapPin className="h-3.5 w-3.5 text-muted-foreground" />}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Tournament type was set at event creation and cannot be changed. To edit other details, go to the championship settings.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function InfoTile({
  label, value, icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-muted/30 border border-border/60 px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-semibold text-foreground text-sm truncate">{value}</span>
      </div>
    </div>
  )
}
