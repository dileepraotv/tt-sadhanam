/**
 * useRealtimeTournament.ts
 *
 * Production-grade Supabase Realtime hook for the PUBLIC audience page.
 *
 * ── DESIGN GOALS ─────────────────────────────────────────────────────────────
 *
 * 1. SINGLE CHANNEL, THREE LISTENERS
 *    One WebSocket multiplexes listeners for `matches`, `games`, and
 *    `tournaments`. Supabase reuses one underlying WS connection per channel.
 *
 * 2. OPTIMISTIC-FIRST, SERVER-TRUTH ON CONFLICT
 *    Match events are applied immediately via reconcileMatch() using the raw
 *    payload + player cache. A background re-fetch then corrects joined fields
 *    the raw payload doesn't carry (player names, seed, club).
 *    Game events carry all public fields, so no follow-up fetch is needed.
 *
 * 3. STALE-REF SAFETY
 *    Every Realtime callback reads state via a ref, not via a closure.
 *    This prevents the React closure bug where a callback registered at
 *    mount-time sees a stale snapshot of useState values.
 *
 * 4. PLAYER CACHE FOR WINNER PROPAGATION
 *    When a match completes, the next-round match gets player1_id/player2_id
 *    filled in. The raw payload has only the UUID; we resolve it to a full
 *    player object using a Map built from all currently-known matches.
 *
 * 5. RECONNECT HYGIENE
 *    Supabase fires CHANNEL_ERROR / TIMED_OUT on network problems. We catch
 *    these, update connection status, and re-subscribe after exponential back-off
 *    capped at 30 s. The back-off ref is cleared on clean close (component unmount).
 *
 * 6. ADMIN DATA NEVER LEAKS
 *    All fetches go through public-queries.ts which hard-codes a column
 *    allow-list and always appends .eq('published', true).
 *    The anon key is used for all requests — never the service-role key.
 *    Operational columns (next_match_id, next_slot, court, scheduled_at,
 *    created_by, started_at, completed_at) are never fetched or exposed.
 *
 * 7. GAMES CACHE PER MATCH
 *    We maintain a Map<matchId, Game[]> so clicking different matches in the
 *    UI doesn't reload games from scratch if they were already received via
 *    Realtime. The cache is always reconciled with incoming events.
 */

'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Match, Game, Tournament } from '@/lib/types'
import {
  reconcileMatch,
  reconcileGame,
  buildPlayerCache,
  type RawMatchPayload,
  type RawGamePayload,
  type RealtimeStatus,
} from './realtime-types'
import {
  fetchPublicMatches,
  fetchPublicMatch,
  fetchPublicGames,
} from './public-queries'

// ─────────────────────────────────────────────────────────────────────────────
// Hook return shape
// ─────────────────────────────────────────────────────────────────────────────

export interface RealtimeTournamentState {
  /** All matches for the tournament, kept in sync with the database. */
  matches:       Match[]

  /**
   * Games indexed by match ID.
   * Only populated for matches the user has opened (lazy-loaded + cached).
   */
  gamesCache:    Map<string, Game[]>

  /**
   * Current WebSocket connection status.
   * Use this to show a reconnecting indicator if needed.
   */
  connectionStatus: RealtimeStatus

  /**
   * True if the initial data load is still in flight.
   * Show a skeleton while this is true.
   */
  isLoading:     boolean

  /**
   * Any fatal error during initial load (e.g. tournament unpublished mid-session).
   * Null during normal operation.
   */
  loadError:     string | null

  /**
   * Call this to load (or reload) games for a specific match.
   * Returns instantly from cache if already loaded and no newer events arrived.
   */
  loadGamesForMatch: (matchId: string) => Promise<Game[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS  = 30_000
const BACKOFF_FACTOR  = 2

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useRealtimeTournament(
  tournament:     Tournament,
  initialMatches: Match[],
): RealtimeTournamentState {
  // Stable client reference — createBrowserClient creates a new instance
  // on every call, so we must memoize it to avoid breaking the channel
  // subscription that captures this reference in the useEffect closure.
  const supabase = useMemo(() => createClient(), [])

  // ── Core state ────────────────────────────────────────────────────────────
  const [matches,          setMatches]          = useState<Match[]>(initialMatches)
  const [gamesCache,       setGamesCache]       = useState<Map<string, Game[]>>(new Map())
  const [connectionStatus, setConnectionStatus] = useState<RealtimeStatus>('connecting')
  const [isLoading,        setIsLoading]        = useState(false)
  const [loadError,        setLoadError]        = useState<string | null>(null)

  // ── Stale-ref mirrors (callbacks read these, never useState) ─────────────
  const matchesRef    = useRef<Match[]>(initialMatches)
  const gamesCacheRef = useRef<Map<string, Game[]>>(new Map())

  useEffect(() => { matchesRef.current    = matches    }, [matches])
  useEffect(() => { gamesCacheRef.current = gamesCache }, [gamesCache])

  // ── Back-off state (persists across re-subscribes) ───────────────────────
  const backoffMs  = useRef(BACKOFF_BASE_MS)
  const backoffRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Derived: player cache built from current matches ─────────────────────
  // Rebuilt on every match state change; memoised via ref to avoid re-renders.
  const playerCacheRef = useRef<Map<string, Match['player1']>>(new Map())
  useEffect(() => {
    playerCacheRef.current = buildPlayerCache(matches)
  }, [matches])

  // ──────────────────────────────────────────────────────────────────────────
  // loadGamesForMatch — public API, lazy + cached
  // ──────────────────────────────────────────────────────────────────────────
  const loadGamesForMatch = useCallback(async (matchId: string): Promise<Game[]> => {
    // Return from cache if we have it (Realtime keeps it fresh)
    const cached = gamesCacheRef.current.get(matchId)
    if (cached) return cached

    // Otherwise fetch from Supabase (anon key, public-queries column allow-list)
    const games = await fetchPublicGames(supabase, matchId)

    setGamesCache(prev => {
      const next = new Map(prev)
      next.set(matchId, games)
      return next
    })

    return games
  }, [])

  // ──────────────────────────────────────────────────────────────────────────
  // Reconcile helpers (all read from refs, never from closures over state)
  // ──────────────────────────────────────────────────────────────────────────

  /** Apply a raw match payload to the matches list optimistically. */
  const applyMatchUpdate = useCallback((raw: RawMatchPayload) => {
    setMatches(prev => {
      const idx = prev.findIndex(m => m.id === raw.id)
      if (idx === -1) {
        // INSERT — shouldn't happen on public page (matches are pre-generated),
        // but handle gracefully. We'll back-fill via re-fetch.
        return prev
      }
      const updated = [...prev]
      updated[idx] = reconcileMatch(updated[idx], raw, playerCacheRef.current)
      return updated
    })
  }, [])

  /**
   * After an optimistic match update, re-fetch the single match to get
   * accurate joined player data. This corrects cases where the player cache
   * didn't yet contain the newly propagated player (e.g., winner of a just-
   * completed match entering a TBD slot in the next round).
   */
  const refetchMatch = useCallback(async (matchId: string) => {
    const fresh = await fetchPublicMatch(supabase, matchId)
    if (!fresh) return

    setMatches(prev => {
      const idx = prev.findIndex(m => m.id === matchId)
      if (idx === -1) return prev
      const existing = prev[idx]
      const updated = [...prev]
      // Preserve games from realtime cache if fresh fetch has none
      // (Supabase may return empty games array briefly after an update)
      updated[idx] = {
        ...fresh,
        games: (fresh.games && fresh.games.length > 0)
          ? fresh.games
          : (existing.games ?? []),
      }
      return updated
    })
  }, [])

  /** Apply a raw game payload to the games cache. */
  const applyGameChange = useCallback((
    raw:   RawGamePayload,
    event: 'INSERT' | 'UPDATE' | 'DELETE',
  ) => {
    // 1. Update the gamesCache (used by the detail dialog)
    setGamesCache(prev => {
      const existing = prev.get(raw.match_id)
      if (!existing) {
        // Not yet loaded; seed the cache from the current match.games if available.
        const matchGames = matchesRef.current.find(m => m.id === raw.match_id)?.games
        if (!matchGames) return prev
        const next = new Map(prev)
        next.set(raw.match_id, reconcileGame(matchGames, raw, event))
        return next
      }
      const next = new Map(prev)
      next.set(raw.match_id, reconcileGame(existing, raw, event))
      return next
    })

    // 2. Also patch matches[i].games so per-game chips on match cards update live.
    setMatches(prev => {
      const idx = prev.findIndex(m => m.id === raw.match_id)
      if (idx === -1) return prev
      const match   = prev[idx]
      const updated = [...prev]
      updated[idx]  = {
        ...match,
        games: reconcileGame(match.games ?? [], raw, event),
      }
      return updated
    })
  }, [])

  // ──────────────────────────────────────────────────────────────────────────
  // Reload helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Soft reload: refresh match list but KEEP the games cache.
   * Used by the 30-second polling interval — we never want to wipe gamesCache
   * mid-session because that would clear an open match detail dialog.
   */
  const softReloadMatches = useCallback(async () => {
    const fresh = await fetchPublicMatches(supabase, tournament.id)
    if (fresh.length) {
      setMatches(fresh)
      // Seed cache entries for any match that returned games but wasn't cached yet
      setGamesCache(prev => {
        let changed = false
        const next = new Map(prev)
        for (const m of fresh) {
          if (m.games && m.games.length > 0 && !prev.has(m.id)) {
            next.set(m.id, m.games)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [tournament.id])

  /**
   * Hard reload: refresh match list AND clear games cache.
   * Only used on reconnect after a disconnect — stale game data may have
   * been missed, so we force a re-load on next dialog open.
   */
  const hardReloadMatches = useCallback(async () => {
    const fresh = await fetchPublicMatches(supabase, tournament.id)
    if (fresh.length) {
      setMatches(fresh)
      setGamesCache(new Map())
    }
  }, [tournament.id])

  // Alias used by socket error/delete handlers that need a hard reset
  const reloadAllMatches = hardReloadMatches

  // ──────────────────────────────────────────────────────────────────────────
  // Polling fallback — soft-reload every 5 s regardless of Realtime.
  // Belt-and-suspenders: if WebSocket events are dropped the UI catches up
  // quickly without disrupting the gamesCache or open dialogs.
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      softReloadMatches().catch(console.error)
    }, 5_000)
    return () => clearInterval(interval)
  }, [softReloadMatches])

  // ── Tab visibility: reload immediately when the tab regains focus ─────────
  // Catches updates that arrived while the user was on another tab or app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        softReloadMatches().catch(console.error)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [softReloadMatches])

  // ──────────────────────────────────────────────────────────────────────────
  // Subscribe / unsubscribe
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    // One shared channel for all three table listeners
    const channel = supabase.channel(`public-tournament-${tournament.id}`, {
      config: { broadcast: { ack: false } },
    })

    // ── LISTENER 1: matches ────────────────────────────────────────────────
    // Fires on INSERT, UPDATE, DELETE.
    // We care most about UPDATE (score changes, status changes, player slot fills).
    channel.on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'matches',
        // Server-side filter: only rows for this tournament.
        // Supabase evaluates this in Postgres, so rows for OTHER tournaments
        // never travel over the wire to this client.
        filter: `tournament_id=eq.${tournament.id}`,
      },
      (payload) => {
        if (!mounted) return

        const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'

        if (eventType === 'DELETE') {
          // Should only happen if admin re-generates bracket (wipes matches).
          // Safest response is a full reload.
          reloadAllMatches()
          return
        }

        const raw = payload.new as RawMatchPayload

        // Step 1: Apply optimistically from raw payload (instant UI update)
        applyMatchUpdate(raw)

        // Step 2: Background re-fetch for accurate joins
        // We don't await this — let the optimistic update show immediately.
        refetchMatch(raw.id).catch(console.error)
      },
    )

    // ── LISTENER 2: games ──────────────────────────────────────────────────
    // Fires on INSERT, UPDATE, DELETE.
    // The raw game payload carries all public columns (score1, score2,
    // winner_id, game_number) — no join needed. Apply directly.
    //
    // NOTE: We cannot filter games by tournament_id in a single clause because
    // the `games` table only has match_id, not tournament_id. The Supabase
    // filter `match_id=in.(...)` requires listing all match IDs which is
    // impractical. Instead we apply a client-side guard: only process events
    // for match IDs we currently know about.
    channel.on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'games',
      },
      (payload) => {
        if (!mounted) return

        const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'

        // ── ADMIN DATA LEAK GUARD ────────────────────────────────────────
        // Verify the match_id belongs to the current tournament by checking
        // the matches we already hold. If it's not in our list, discard it.
        // This prevents a hypothetical case where a privileged Realtime
        // subscription somehow delivers a row from another tournament.
        const raw       = (eventType === 'DELETE' ? payload.old : payload.new) as RawGamePayload
        const matchIds  = new Set(matchesRef.current.map(m => m.id))

        if (!matchIds.has(raw.match_id)) {
          // Not our tournament — discard silently.
          return
        }

        applyGameChange(raw, eventType)
      },
    )

    // ── LISTENER 3: tournament row ─────────────────────────────────────────
    // We only care about the `status` changing (setup → active → complete)
    // and `published` being toggled. We do NOT surface other columns.
    channel.on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'tournaments',
        filter: `id=eq.${tournament.id}`,
      },
      (payload) => {
        if (!mounted) return

        const updated = payload.new as Partial<Tournament>

        // If the tournament was unpublished, trigger a reload which will
        // return an empty result (RLS blocks it), letting the page 404.
        if (updated.published === false) {
          // Parent component should handle the empty state.
          reloadAllMatches()
          return
        }

        // Status change (e.g., tournament complete): we don't need to reload
        // all matches, but parent needs to know. We propagate via a dummy
        // matches reload that updates the tournament-level state in the page.
        // (The page component re-derives tournament status from the initial
        //  SSR prop; a future enhancement would expose a setTournament setter.)
      },
    )

    // ── Connection lifecycle ───────────────────────────────────────────────
    channel.subscribe((status, err) => {
      if (!mounted) return

      switch (status) {
        case 'SUBSCRIBED':
          setConnectionStatus('connected')
          backoffMs.current = BACKOFF_BASE_MS   // reset back-off on success
          break

        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
          setConnectionStatus('error')
          console.warn(`[Realtime] ${status}:`, err?.message)

          // Exponential back-off reconnect
          if (backoffRef.current) clearTimeout(backoffRef.current)
          backoffRef.current = setTimeout(async () => {
            if (!mounted) return
            // Re-fetch all matches to fill any gaps from missed events
            await reloadAllMatches()
            setConnectionStatus('connecting')
            // Supabase will auto-retry the WebSocket; we just needed to reload data
          }, backoffMs.current)

          backoffMs.current = Math.min(backoffMs.current * BACKOFF_FACTOR, BACKOFF_MAX_MS)
          break

        case 'CLOSED':
          if (mounted) setConnectionStatus('closed')
          break
      }
    })

    // ── Cleanup on unmount ─────────────────────────────────────────────────
    return () => {
      mounted = false
      if (backoffRef.current) {
        clearTimeout(backoffRef.current)
        backoffRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [tournament.id])   // Re-subscribe only if tournament ID changes

  return {
    matches,
    gamesCache,
    connectionStatus,
    isLoading,
    loadError,
    loadGamesForMatch,
  }
}
