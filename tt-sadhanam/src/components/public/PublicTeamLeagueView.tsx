'use client'

/**
 * PublicTeamLeagueView
 *
 * Public view for format_type = 'team_league'.
 * Shows team standings + expandable team match cards.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, ChevronDown, ChevronRight } from 'lucide-react'
import { WinnerTrophy, matchStatusClasses } from '@/components/shared/MatchUI'
import { InlineLoader } from '@/components/shared/GlobalLoader'
import { cn } from '@/lib/utils'
import type { Tournament, Team, TeamMatch, Match } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { TeamMatchCard } from '@/components/team/TeamMatchCard'

interface Props {
  tournament: Tournament
}

export function PublicTeamLeagueView({ tournament }: Props) {
  const router   = useRouter()
  const supabase = createClient()

  const [teams, setTeams]           = useState<Team[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatch[]>([])
  const [scoringMatches, setScoringMatches] = useState<Match[]>([])
  const [loading, setLoading]       = useState(true)
  const [openRounds, setOpenRounds] = useState<Set<number>>(new Set([1]))

  const loadData = async () => {
    // Embed scoring match data directly in the submatches join — eliminates the
    // serial 3rd query that collected match IDs then fired a second .in() request.
    const [teamsRes, tmRes] = await Promise.all([
      supabase
        .from('teams')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('created_at'),
      supabase
        .from('team_matches')
        .select(`
          *,
          team_a:team_a_id(id,name,short_name,color),
          team_b:team_b_id(id,name,short_name,color),
          team_match_submatches(
            id, match_order, label, player_a_name, player_b_name, match_id,
            scoring:match_id(
              id, player1_id, player2_id, winner_id,
              player1_games, player2_games, status,
              games(id, match_id, game_number, score1, score2, winner_id)
            )
          )
        `)
        .eq('tournament_id', tournament.id)
        .order('round'),
    ])

    const tms = (tmRes.data ?? []) as unknown as TeamMatch[]
    setTeams((teamsRes.data ?? []) as Team[])
    setTeamMatches(tms)

    // Flatten embedded scoring matches for the subMatchScores map
    const embedded = tms.flatMap(tm =>
      ((tm.submatches ?? []) as unknown as Array<{ scoring?: Match | null }>)
        .map(sm => sm.scoring).filter(Boolean) as Match[]
    )
    if (embedded.length > 0) setScoringMatches(embedded)

    setLoading(false)
  }

  // Debounce ref: multiple Realtime events firing together (e.g. submatch update
  // + parent team_match update) collapse into a single reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduledReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => { loadData().catch(console.error) }, 300)
  }

  useEffect(() => { loadData() }, [tournament.id])

  useEffect(() => {
    const channel = supabase
      .channel(`public-team-${tournament.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_matches', filter: `tournament_id=eq.${tournament.id}` },
        scheduledReload,
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` },
        scheduledReload,
      )
      .subscribe()
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [tournament.id])

  const subMatchScores = useMemo(() => {
    const map = new Map<string, Match>()
    for (const m of scoringMatches) map.set(m.id, m)
    return map
  }, [scoringMatches])

  const standings = useMemo(() => teams.map(team => {
    const matches = teamMatches.filter(m =>
      (m.team_a_id === team.id || m.team_b_id === team.id) && m.status === 'complete')
    const wins   = matches.filter(m => m.winner_team_id === team.id).length
    const losses = matches.length - wins

    // Tiebreaker 1: individual submatch wins; Tiebreaker 2: net game difference
    let submatchWins = 0
    let gameDiff = 0

    for (const m of teamMatches.filter(tm =>
      tm.team_a_id === team.id || tm.team_b_id === team.id
    )) {
      const isTeamA = m.team_a_id === team.id
      for (const sm of (m.submatches ?? [])) {
        if (!sm.match_id) continue
        const sc = subMatchScores.get(sm.match_id)
        if (!sc || sc.status !== 'complete') continue
        const ourGames   = isTeamA ? sc.player1_games : sc.player2_games
        const theirGames = isTeamA ? sc.player2_games : sc.player1_games
        if (ourGames > theirGames) submatchWins++
        gameDiff += (ourGames - theirGames)
      }
    }

    return { team, played: matches.length, wins, losses, submatchWins, gameDiff }
  }).sort((a, b) =>
    b.wins - a.wins ||
    b.submatchWins - a.submatchWins ||
    b.gameDiff - a.gameDiff ||
    a.team.name.localeCompare(b.team.name)
  ), [teams, teamMatches, subMatchScores])

  const fixturesByRound = useMemo(() => {
    const map = new Map<number, TeamMatch[]>()
    for (const m of teamMatches) {
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [teamMatches])

  const toggleRound = (round: number) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  if (loading) {
    return <InlineLoader label="Loading…" />
  }

  if (teamMatches.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 text-center text-muted-foreground">
        <div className="text-4xl mb-3">🏓</div>
        <p className="font-semibold text-foreground">Team schedule not yet generated</p>
        <p className="text-sm mt-1">Check back once the organizer has set up the fixtures.</p>
      </div>
    )
  }

  const doneCount  = teamMatches.filter(m => m.status === 'complete').length
  const totalCount = teamMatches.length
  const liveCount  = teamMatches.filter(m => m.status === 'live').length

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* Progress */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">League Progress</span>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} ties complete
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

      {/* Team standings */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-base text-foreground">Team Standings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground w-8">#</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">Team</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Ties played">P</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Tie wins">W</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Tie losses">L</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Individual match wins">SW</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Net game difference">GD</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.team.id} className={cn('border-b border-border/50', i === 0 && row.wins > 0 && 'bg-amber-50/40 dark:bg-amber-900/10')}>
                  <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {i === 0 && row.wins > 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: row.team.color ?? '#F06321' }} />
                      <span className="font-medium text-sm">{row.team.name}</span>
                      {row.team.short_name && <span className="text-xs text-muted-foreground">({row.team.short_name})</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.played}</td>
                  <td className="px-3 py-2 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">{row.wins}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.losses}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.submatchWins}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground font-mono">
                    {row.gameDiff > 0 ? `+${row.gameDiff}` : row.gameDiff}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fixtures */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider px-1">Fixtures</h2>
        {fixturesByRound.map(([round, fixtures]) => {
          const isOpen = openRounds.has(round)
          const done   = fixtures.filter(f => f.status === 'complete').length
          const live   = fixtures.filter(f => f.status === 'live').length

          return (
            <div key={round} className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => toggleRound(round)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="font-semibold text-sm flex-1">Round {round}</span>
                {live > 0 && <span className="live-dot" />}
                {done === fixtures.length && done > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Done</span>
                )}
                <span className="text-xs text-muted-foreground">{done}/{fixtures.length}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2 border-t border-border/50 pt-3">
                  {fixtures.map(tm => (
                    <TeamMatchCard
                      key={tm.id}
                      teamMatch={tm}
                      subMatchScores={subMatchScores}
                    />
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
