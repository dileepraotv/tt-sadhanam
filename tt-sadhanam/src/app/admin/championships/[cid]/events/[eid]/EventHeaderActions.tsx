'use client'

import { useLoading } from '@/components/shared/GlobalLoader'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/index'
import { deleteEvent } from '@/lib/actions/championships'
import { toast } from '@/components/ui/toaster'

interface Props {
  cid:       string
  eventId:   string
  eventName: string
}

export function EventHeaderActions({ cid, eventId, eventName }: Props) {
  const [showDelete, setShowDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { setLoading } = useLoading()
  const router = useRouter()

  const handleDelete = () => {
    setLoading(true)
    startTransition(async () => {
      try {
        await deleteEvent(cid, eventId)
        setLoading(false)
        toast({ title: `"${eventName}" deleted` })
        router.push(`/admin/championships/${cid}`)
      } catch (err: unknown) {
        setLoading(false)
        toast({ title: 'Delete failed', description: (err as Error).message, variant: 'destructive' })
        setShowDelete(false)
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDelete(true)}
        className="flex items-center gap-1.5 text-red-500 border-red-200 hover:bg-red-50 hover:border-red-400 dark:border-red-900 dark:hover:bg-red-950/30"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete Event
      </Button>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete &ldquo;{eventName}&rdquo;?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will <strong className="text-foreground">permanently delete</strong> this event
            along with all its players, matches, and scores. Cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowDelete(false)} className="flex-1" disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending} className="flex-1">
              {isPending ? 'Deleting…' : 'Delete Event'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
