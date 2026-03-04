'use client'

/**
 * PublicLiveTab
 *
 * The "Live / Public" tab in admin.  Shows:
 *   1. Publish toggle with public URL + copy button
 *   2. Live match count with direct links to scoring
 *   3. Danger zone: delete tournament
 */

import { useState, useTransition } from 'react'
import {
  Globe, GlobeLock, ExternalLink, Copy, CheckCircle2,
  AlertTriangle, Trash2, Radio, Wifi,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Tournament, Match } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardHeader, CardTitle,
  Label, Switch,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/index'
import { togglePublish, deleteTournament } from '@/lib/actions/tournaments'
import { toast } from '@/components/ui/toaster'

interface Props {
  tournament: Tournament
  matches:    Match[]
  matchBase:  string
}

export function PublicLiveTab({ tournament, matches, matchBase }: Props) {
  const [showDelete, setShowDelete]   = useState(false)
  const [copied, setCopied]           = useState(false)
  const [isPending, startTransition]  = useTransition()

  const isPublished  = tournament.published
  const hasActivity  = tournament.bracket_generated ||
                       tournament.stage1_complete   ||
                       tournament.stage2_bracket_generated

  const publicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/tournaments/${tournament.id}`
    : `/tournaments/${tournament.id}`

  const liveMatches    = matches.filter(m => m.status === 'live')
  const pendingMatches = matches.filter(m => m.status === 'pending' && m.player1_id && m.player2_id)

  const handlePublishToggle = (checked: boolean) => {
    startTransition(async () => {
      try {
        await togglePublish(tournament.id, checked)
        toast({
          title: checked ? 'Tournament published' : 'Tournament unpublished',
          description: checked ? 'Anyone with the link can view.' : 'Public view hidden.',
        })
      } catch (e: unknown) {
        toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
      }
    })
  }

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Link copied!' })
    } catch {
      toast({ title: 'Could not copy', description: 'Copy the URL manually.', variant: 'destructive' })
    }
  }

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteTournament(tournament.id)
      } catch (e: unknown) {
        toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
        setShowDelete(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Publish ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-orange-500" />
            Public View
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
                {isPublished
                  ? <Globe className="h-4 w-4 text-orange-500" />
                  : <GlobeLock className="h-4 w-4 text-muted-foreground" />}
                {isPublished ? 'Published — live view active' : 'Not published'}
              </Label>
              <p className="text-xs text-muted-foreground">
                {isPublished
                  ? 'Anyone with the link can watch scores in real-time.'
                  : hasActivity
                    ? 'Enable to share a live public bracket/standings view.'
                    : 'Generate the bracket or schedule first, then publish.'}
              </p>
            </div>
            <Switch
              checked={isPublished}
              onCheckedChange={handlePublishToggle}
              disabled={isPending || !hasActivity}
            />
          </div>

          {!hasActivity && (
            <div className="flex items-center gap-2 rounded-xl bg-muted/30 border border-border px-3 py-2.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              Generate the draw or schedule first before publishing.
            </div>
          )}

          {isPublished && (
            <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/60 rounded-xl px-3 py-2.5">
              <Globe className="h-3.5 w-3.5 text-orange-500 shrink-0" />
              <span className="text-xs font-mono text-orange-700 dark:text-orange-300 truncate flex-1 min-w-0">
                {publicUrl}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handleCopy}
                  className={cn(
                    'flex items-center gap-1 text-xs font-semibold transition-colors',
                    copied
                      ? 'text-green-600'
                      : 'text-orange-600 hover:text-orange-800 dark:text-orange-400',
                  )}
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <Link
                  href={publicUrl}
                  target="_blank"
                  className="text-orange-600 hover:text-orange-800 dark:text-orange-400 ml-1"
                  title="Open public view"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Live matches ── */}
      {hasActivity && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-orange-500" />
              Match Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatPill
                label="Live now"
                value={liveMatches.length}
                accent={liveMatches.length > 0}
              />
              <StatPill
                label="Upcoming"
                value={pendingMatches.length}
              />
              <StatPill
                label="Completed"
                value={matches.filter(m => m.status === 'complete').length}
              />
            </div>

            {liveMatches.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  Currently live
                </p>
                {liveMatches.map(m => (
                  <Link
                    key={m.id}
                    href={`${matchBase}/${m.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-orange-300/60 bg-orange-50/60 dark:bg-orange-950/20 dark:border-orange-800/60 hover:bg-orange-100/60 transition-colors group"
                  >
                    <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 truncate">
                      {m.player1?.name ?? 'TBD'} vs {m.player2?.name ?? 'TBD'}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">
                      {m.player1_games}–{m.player2_games}
                    </span>
                    <span className="text-xs text-orange-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      Score →
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {liveMatches.length === 0 && pendingMatches.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Wifi className="h-4 w-4 opacity-50" />
                No active matches right now.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Danger zone ── */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-base text-destructive/80">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Delete Tournament</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently removes all players, matches, stages, and scores. Cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDelete(true)}
              disabled={isPending}
              className="shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete "{tournament.name}"?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will <strong className="text-foreground">permanently delete</strong> the tournament,
            all players, all matches, all stages and all scores. This cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowDelete(false)} className="flex-1" disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending} className="flex-1">
              {isPending ? 'Deleting…' : 'Yes, delete everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatPill({ label, value, accent }: {
  label:  string
  value:  number
  accent?: boolean
}) {
  return (
    <div className={cn(
      'flex flex-col gap-0.5 rounded-xl border px-3 py-2.5',
      accent && value > 0
        ? 'border-orange-300/60 bg-orange-50/60 dark:bg-orange-950/20 dark:border-orange-800/60'
        : 'border-border/60 bg-muted/20',
    )}>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <span className={cn(
        'font-display font-bold text-xl tabular-nums',
        accent && value > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground',
      )}>
        {value}
      </span>
    </div>
  )
}
