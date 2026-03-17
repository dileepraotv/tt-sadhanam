'use client'

/**
 * PublicPureRRView — public view for pure_round_robin format.
 * Shows: progress bar + standings + round tabs (orange, matching admin BracketView style).
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy } from 'lucide-react'
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
  const router   = useRouter()
  const supabase = createClient()
  const [matches,      setMatches]      = useState<Match[]>(initialMatches)
  const [activeRound,  setActiveRound]  = useState<number | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { router.refresh() }, 400)
  }

  useEffect(() => {
    const ch = supabase.channel(`pub-prr-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, debouncedRefresh)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [tournament.id])

  const rrMatches = useMemo(
    () => matches.filter(m => m.match_kind === 'round_robin' || (!m.match_kind && !m.bracket_side)),
    [matches],
  )
  const allGames = useMemo(() => rrMatches.flatMap(m => m.games ?? []), [rrMatches])
  const standings: PlayerStanding[] = useMemo(
    () => computeLeagueStandingsLocal(players, rrMatches, allGames),
    [players, rrMatches, allGames],
  )

  const roundMap = useMemo(() => {
    const map = new Map<number, Match[]>()
    for (const m of rrMatches) {
      if (m.status === 'bye') continue
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [rrMatches])

  // Auto-pick: live round > first incomplete > last
  const defaultRound = useMemo(() => {
    const live = roundMap.find(([, ms]) => ms.some(m => m.status === 'live'))
    if (live) return live[0]
    const incomplete = roundMap.find(([, ms]) => ms.some(m => m.status !== 'complete'))
    if (incomplete) return incomplete[0]
    return roundMap[roundMap.length - 1]?.[0] ?? null
  }, [roundMap])

  const displayRound = activeRound ?? defaultRound

  const doneCount  = rrMatches.filter(m => m.status === 'complete').length
  const totalCount = rrMatches.filter(m => m.status !== 'bye').length
  const liveCount  = rrMatches.filter(m => m.status === 'live').length

  if (rrMatches.length === 0) return (
    <div className="page-content py-12 text-center text-muted-foreground">
      <div className="text-4xl mb-3">🏓</div>
      <p className="font-semibold text-foreground">League schedule not yet generated</p>
      <p className="text-sm mt-1">Check back once the organizer has set up the fixtures.</p>
    </div>
  )

  return (
    <div className="page-content flex flex-col gap-5">
      {/* Progress */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">League Progress</span>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} complete
            {liveCount > 0 && <span className="text-orange-500 ml-1">, {liveCount} LIVE</span>}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-orange-500 transition-all duration-500"
            style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }} />
        </div>
      </div>

      {/* Standings */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-base">League Standings</h2>
        </div>
        <LeagueStandingsTable standings={standings} />
      </div>

      {/* Fixtures — orange tab bar */}
      {roundMap.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Tab bar */}
          <div
            className="flex items-end gap-1 overflow-x-auto scrollbar-hide border-b-2 px-2 pt-2"
            style={{ borderColor: '#F06321' }}
          >
            {roundMap.map(([round, ms]) => {
              const isActive = displayRound === round
              const hasLive  = ms.some(m => m.status === 'live')
              const allDone  = ms.every(m => m.status === 'complete')
              return (
                <button
                  key={round}
                  onClick={() => setActiveRound(round)}
                  style={isActive
                    ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                    : undefined}
                  className={cn(
                    'shrink-0 px-4 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap flex items-center gap-1.5',
                    !isActive && 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  Matchday {round}
                  {hasLive && (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: isActive ? 'rgba(255,255,255,0.35)' : '#F06321', color: '#fff' }}>
                      ●
                    </span>
                  )}
                  {allDone && !hasLive && (
                    <span className={cn('text-[10px] font-bold', isActive ? 'text-white/80' : 'text-emerald-500')}>✓</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Active matchday matches */}
          {displayRound != null && (() => {
            const ms = roundMap.find(([r]) => r === displayRound)?.[1] ?? []
            return (
              <div className="p-4 flex flex-col gap-3">
                {ms.map(m => <PublicMatchCard key={m.id} match={m} />)}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── Local standings computation ───────────────────────────────────────────────

function computeLeagueStandingsLocal(players: Player[], matches: Match[], games: Game[]): PlayerStanding[] {
  const acc = new Map<string, {
    playerId: string; playerName: string; playerSeed: number | null; playerClub: string | null
    matchesPlayed: number; wins: number; losses: number
    gamesWon: number; gamesLost: number; pointsScored: number; pointsConceded: number
  }>()
  for (const p of players) {
    acc.set(p.id, { playerId: p.id, playerName: p.name, playerSeed: p.seed, playerClub: p.club,
      matchesPlayed: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, pointsScored: 0, pointsConceded: 0 })
  }
  const gamesByMatch = new Map<string, Game[]>()
  for (const g of games) {
    if (!gamesByMatch.has(g.match_id)) gamesByMatch.set(g.match_id, [])
    gamesByMatch.get(g.match_id)!.push(g)
  }
  for (const m of matches) {
    if (m.status !== 'complete' || !m.player1_id || !m.player2_id) continue
    const p1 = acc.get(m.player1_id), p2 = acc.get(m.player2_id)
    if (!p1 || !p2) continue
    p1.matchesPlayed++; p2.matchesPlayed++
    if (m.winner_id === m.player1_id) { p1.wins++; p2.losses++ }
    else if (m.winner_id === m.player2_id) { p2.wins++; p1.losses++ }
    p1.gamesWon += m.player1_games; p1.gamesLost += m.player2_games
    p2.gamesWon += m.player2_games; p2.gamesLost += m.player1_games
    for (const g of (gamesByMatch.get(m.id) ?? [])) {
      const s1 = g.score1 ?? 0, s2 = g.score2 ?? 0
      p1.pointsScored += s1; p1.pointsConceded += s2
      p2.pointsScored += s2; p2.pointsConceded += s1
    }
  }
  return [...acc.values()]
    .map(a => ({ ...a, gameDifference: a.gamesWon - a.gamesLost,
      pointsDifference: a.pointsScored - a.pointsConceded, rank: 0, advances: false }))
    .sort((a, b) => b.wins !== a.wins ? b.wins - a.wins :
      b.gameDifference !== a.gameDifference ? b.gameDifference - a.gameDifference :
      b.pointsDifference !== a.pointsDifference ? b.pointsDifference - a.pointsDifference :
      a.playerId < b.playerId ? -1 : 1)
    .map((s, i) => ({ ...s, rank: i + 1, advances: false }))
}
