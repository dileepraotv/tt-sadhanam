'use client'

import { useState, useTransition } from 'react'
import { Shuffle, AlertTriangle } from 'lucide-react'
import type { Tournament, Player } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/index'
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
