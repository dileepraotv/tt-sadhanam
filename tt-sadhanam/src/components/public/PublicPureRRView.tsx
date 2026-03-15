'use client'

/**
 * PublicPureRRView
 *
 * Public view for format_type = 'pure_round_robin'.
 * Shows league standings + match rounds in an accordion.
 *
 * Uses the same computeLeagueStandings logic as the admin PureRRStage,
 * but in a public-facing read-only layout with live score updates.
 */

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tournament, Match, Player, Game } from '@/lib/types'
import type { PlayerStanding } from '@/lib/roundrobin/types'
import { createClient } from '@/lib/supabase/client'
import { LeagueStandingsTable } from '@/components/league/StandingsTable'
import { PublicMatchCard } from '@/components/public/PublicMatchCard'

interface Props {
  tournament: Tournament
  matches:    Match[]
  players:    Player[]
}

export function PublicPureRRView({ tournament, matches: initialMatches, players }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [openRounds, setOpenRounds] = useState<Set<number>>(new Set([1]))

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`public-prr-${tournament.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` },
        () => router.refresh(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        () => router.refresh(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournament.id])

  const rrMatches = useMemo(
    () => matches.filter(m => m.match_kind === 'round_robin' || (!m.match_kind && !m.bracket_side)),
    [matches],
  )

  const allGames = useMemo(
    () => rrMatches.flatMap(m => m.games ?? []),
    [rrMatches],
  )

  // Compute standings using same algorithm as admin PureRRStage
  const standings: PlayerStanding[] = useMemo(
    () => computeLeagueStandingsLocal(players, rrMatches, allGames),
    [players, rrMatches, allGames],
  )

  // Group matches by matchday
  const matchdays = useMemo(() => {
    const map = new Map<number, Match[]>()
    for (const m of rrMatches) {
      if (m.status === 'bye') continue
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([round, ms]) => ({ round, matches: ms }))
  }, [rrMatches])

  const doneCount  = rrMatches.filter(m => m.status === 'complete').length
  const totalCount = rrMatches.filter(m => m.status !== 'bye').length
  const liveCount  = rrMatches.filter(m => m.status === 'live').length

  const toggleRound = (round: number) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  if (rrMatches.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 text-center text-muted-foreground">
        <div className="text-4xl mb-3">🏓</div>
        <p className="font-semibold text-foreground">League schedule not yet generated</p>
        <p className="text-sm mt-1">Check back once the organizer has set up the fixtures.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Progress bar */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">League Progress</span>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} complete
            {liveCount > 0 && <span className="text-orange-500 ml-1">, {liveCount} LIVE</span>}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-orange-500 transition-all duration-500"
            style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Standings */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-base text-foreground">League Standings</h2>
        </div>
        <LeagueStandingsTable standings={standings} />
      </div>

      {/* Matchdays */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider px-1">Fixtures</h2>
        {(matchdays as {round: number; matches: Match[]}[]).map(({ round, matches: rMatches }) => {
          const isOpen  = openRounds.has(round)
          const live    = rMatches.filter(m => m.status === 'live').length
          const done    = rMatches.filter(m => m.status === 'complete').length
          const total   = rMatches.length
          const allDone = done === total && total > 0

          return (
            <div key={round} className={cn('bg-card rounded-xl border border-border overflow-hidden', allDone && 'opacity-80')}>
              <button
                onClick={() => toggleRound(round)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="font-semibold text-sm flex-1">Matchday {round}</span>
                {live > 0 && <span className="live-dot" />}
                {allDone && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Done</span>
                )}
                <span className="text-xs text-muted-foreground">{done}/{total}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2 border-t border-border/50">
                  {rMatches.map(m => (
                    <PublicMatchCard key={m.id} match={m} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Local standings computation (mirrors lib/roundrobin/standings.ts logic) ──

function computeLeagueStandingsLocal(
  players: Player[],
  matches: Match[],
  games:   Game[],
): PlayerStanding[] {
  const acc = new Map<string, {
    playerId: string; playerName: string; playerSeed: number | null; playerClub: string | null
    matchesPlayed: number; wins: number; losses: number
    gamesWon: number; gamesLost: number; pointsScored: number; pointsConceded: number
  }>()

  for (const p of players) {
    acc.set(p.id, {
      playerId: p.id, playerName: p.name, playerSeed: p.seed, playerClub: p.club,
      matchesPlayed: 0, wins: 0, losses: 0,
      gamesWon: 0, gamesLost: 0, pointsScored: 0, pointsConceded: 0,
    })
  }

  const gamesByMatch = new Map<string, Game[]>()
  for (const g of games) {
    if (!gamesByMatch.has(g.match_id)) gamesByMatch.set(g.match_id, [])
    gamesByMatch.get(g.match_id)!.push(g)
  }

  for (const m of matches) {
    if (m.status !== 'complete' || !m.player1_id || !m.player2_id) continue
    const p1 = acc.get(m.player1_id)
    const p2 = acc.get(m.player2_id)
    if (!p1 || !p2) continue
    p1.matchesPlayed++; p2.matchesPlayed++
    if (m.winner_id === m.player1_id) { p1.wins++; p2.losses++ }
    else if (m.winner_id === m.player2_id) { p2.wins++; p1.losses++ }
    p1.gamesWon += m.player1_games; p1.gamesLost += m.player2_games
    p2.gamesWon += m.player2_games; p2.gamesLost += m.player1_games
    for (const g of (gamesByMatch.get(m.id) ?? [])) {
      const s1 = g.score1 ?? 0; const s2 = g.score2 ?? 0
      p1.pointsScored += s1; p1.pointsConceded += s2
      p2.pointsScored += s2; p2.pointsConceded += s1
    }
  }

  return [...acc.values()]
    .map((a, _, arr) => {
      const gd = a.gamesWon - a.gamesLost
      const pd = a.pointsScored - a.pointsConceded
      return { ...a, gameDifference: gd, pointsDifference: pd, rank: 0, advances: false }
    })
    .sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins :
      b.gameDifference !== a.gameDifference ? b.gameDifference - a.gameDifference :
      b.pointsDifference !== a.pointsDifference ? b.pointsDifference - a.pointsDifference :
      a.playerId < b.playerId ? -1 : 1
    )
    .map((s, i) => ({ ...s, rank: i + 1, advances: false }))
}
