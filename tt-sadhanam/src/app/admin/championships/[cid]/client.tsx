'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe, GlobeLock, Trash2, AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/index'
import type { Championship } from '@/lib/types'
import { toggleChampionshipPublish, deleteChampionship, deleteEvent } from '@/lib/actions/championships'
import { toast } from '@/components/ui/toaster'

// ── ChampionshipAdminClient ───────────────────────────────────────────────────
interface Props { championship: Championship }

export function ChampionshipAdminClient({ championship }: Props) {
  const [showDelete, setShowDelete] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handlePublish = (checked: boolean) => {
    startTransition(async () => {
      try {
        await toggleChampionshipPublish(championship.id, checked)
        toast({ title: checked ? 'Championship published!' : 'Championship unpublished' })
      } catch (e: unknown) {
        toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteChampionship(championship.id)
      } catch (e: unknown) {
        toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
        setShowDelete(false)
      }
    })
  }

  const publicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/championships/${championship.id}`
    : `/championships/${championship.id}`

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {/* Publish toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {championship.published ? (
          <>
            <Button variant="outline" size="sm" onClick={() => handlePublish(false)} disabled={isPending}
              className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20">
              <Globe className="h-3.5 w-3.5" /> Published
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/championships/${championship.id}`} target="_blank">
                <ExternalLink className="h-3.5 w-3.5" /> Public View
              </Link>
            </Button>
          </>
        ) : (
          <Button variant="default" size="sm" onClick={() => handlePublish(true)} disabled={isPending}
            className="flex items-center gap-1.5 w-full sm:w-auto">
            <GlobeLock className="h-3.5 w-3.5" /> Publish Championship
          </Button>
        )}
      </div>

      {championship.published && (
        <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg px-3 py-1.5 border border-orange-200 dark:border-orange-800/50 min-w-0">
          <Globe className="h-3 w-3 text-orange-500 shrink-0" />
          <span className="text-xs font-mono text-orange-600 dark:text-orange-400 truncate flex-1">{publicUrl}</span>
          <button
            onClick={() => {
              try {
                navigator.clipboard.writeText(publicUrl)
                toast({ title: 'Link copied!' })
              } catch {
                toast({ title: 'Could not copy', description: 'Copy the URL manually.', variant: 'destructive' })
              }
            }}
            className="text-xs text-orange-500 hover:text-orange-700 shrink-0 font-semibold transition-colors touch-manipulation px-1 py-1"
          >Copy</button>
        </div>
      )}

      {/* Delete */}
      <Button variant="ghost" size="sm" onClick={() => setShowDelete(true)} disabled={isPending}
        className="text-red-400 hover:text-red-600 hover:bg-red-50 text-xs sm:ml-auto">
        <Trash2 className="h-3 w-3 mr-1" /> Delete Championship
      </Button>

      {/* Delete confirm dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete &ldquo;{championship.name}&rdquo;?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will <strong className="text-foreground">permanently delete</strong> the championship
            and all its events, players, matches, and scores. Cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowDelete(false)} className="flex-1" disabled={isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending} className="flex-1">
              {isPending ? 'Deleting…' : 'Delete Everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── EventActions — per-card delete button + confirm dialog ────────────────────
interface EventActionsProps {
  cid:       string
  eventId:   string
  eventName: string
}

export function EventActions({ cid, eventId, eventName }: EventActionsProps) {
  const [showDelete, setShowDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()   // stop the parent <Link> from navigating
    e.stopPropagation()
    setShowDelete(true)
  }

  const confirmDelete = () => {
    startTransition(async () => {
      try {
        await deleteEvent(cid, eventId)
        toast({ title: `"${eventName}" deleted` })
        router.push(`/admin/championships/${cid}`)
        router.refresh()
      } catch (err: unknown) {
        toast({ title: 'Delete failed', description: (err as Error).message, variant: 'destructive' })
        setShowDelete(false)
      }
    })
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault()   // don't follow the parent Link
          e.stopPropagation()  // don't bubble up
          setShowDelete(true)
        }}
        disabled={isPending}
        title="Delete event"
        aria-label="Delete event"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all touch-manipulation"
      >
        <Trash2 className="h-4 w-4" />
      </button>

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
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending} className="flex-1">
              {isPending ? 'Deleting…' : 'Delete Event'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
