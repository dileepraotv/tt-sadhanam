'use client'

/**
 * RealtimeRefresher
 *
 * Subscribes to Supabase Realtime on the `matches` table and calls
 * router.refresh() whenever any match status changes. This triggers
 * Next.js to re-fetch server component data (live section, scores, etc.)
 * without a full page reload.
 *
 * Drop this anywhere on a page that needs live updates.
 * When `pollIntervalMs` is also provided, falls back to polling as a safety net.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  /** Refresh even if no realtime event — polling safety net. Default 20s. */
  pollIntervalMs?: number
  /** Only subscribe when there are live matches (avoids unnecessary connections). */
  hasLive?: boolean
}

export function RealtimeRefresher({ pollIntervalMs = 20_000, hasLive = true }: Props) {
  const router = useRouter()

  useEffect(() => {
    // ── Supabase Realtime subscription ────────────────────────────────────────
    const supabase = createClient()

    const channel = supabase
      .channel('live-matches-home')
      .on(
        'postgres_changes',
        {
          event:  '*',          // INSERT, UPDATE, DELETE
          schema: 'public',
          table:  'matches',
        },
        () => {
          // Any match change → re-run server data fetch
          router.refresh()
        },
      )
      .subscribe()

    // ── Polling fallback (runs regardless of WS support) ──────────────────────
    const interval = setInterval(() => {
      router.refresh()
    }, pollIntervalMs)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [router, pollIntervalMs])

  // Render nothing — purely a side-effect component
  return null
}
