'use client'

/**
 * ChampionshipRefresher
 *
 * Watches the `tournaments` table for INSERT/UPDATE/DELETE and calls
 * router.refresh() so the server-rendered championship page picks up
 * new events without requiring a manual browser refresh.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  championshipId: string
  pollIntervalMs?: number
}

export function ChampionshipRefresher({ championshipId, pollIntervalMs = 30_000 }: Props) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`champ-events-${championshipId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'tournaments',
          filter: `championship_id=eq.${championshipId}`,
        },
        () => router.refresh(),
      )
      .subscribe()

    // Polling fallback
    const interval = setInterval(() => router.refresh(), pollIntervalMs)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [router, championshipId, pollIntervalMs])

  return null
}
