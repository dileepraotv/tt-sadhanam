'use client'

/**
 * PublicTeamLeagueView — public view for team_league format.
 * Shows: progress bar + standings + round tabs (orange, matching admin style).
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { Trophy } from 'lucide-react'
import { InlineLoader } from '@/components/shared/GlobalLoader'
import { cn } from '@/lib/utils'
import type { Tournament, Team, TeamMatch, Match } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { TeamMatchCard } from '@/components/team/TeamMatchCard'

interface Props { tournament: Tournament }

export function PublicTeamLeagueView({ tournament }: Props) {
  const supabase = createClient()

  const [teams,         setTeams]         = useState<Team[]>([])
  const [teamMatches,   setTeamMatches]   = useState<TeamMatch[]>([])
  const [scoringMatches,setScoringMatches]= useState<Match[]>([])
  const [loading,       setLoading]       = useState(true)
  const [activeRound,   setActiveRound]   = useState<number | null>(null)

  const loadData = async () => {
    const [teamsRes, tmRes] = await Promise.all([
      supabase.from('teams').select('*').eq('tournament_id', tournament.id).order('created_at'),
      supabase.from('team_matches').select(`
        *,
        team_a:team_a_id(id,name,short_name,color),
        team_b:team_b_id(id,name,short_name,color),
        submatches:team_match_submatches(
          id, match_order, label, player_a_name, player_b_name, match_id,
          scoring:match_id(id,player1_id,player2_id,winner_id,player1_games,player2_games,status,
            games(id,match_id,game_number,score1,score2,winner_id))
        )
      `).eq('tournament_id', tournament.id).order('round'),
    ])
    const tms: TeamMatch[] = (tmRes.data ?? []).map((tm: any) => ({
      ...tm,
      submatches: ((tm.submatches ?? []) as any[])
        .sort((a: any, b: any) => a.match_order - b.match_order)
        .map((sm: any) => ({ ...sm, match: sm.scoring ?? null })),
    }))
    setTeams((teamsRes.data ?? []) as Team[])
    setTeamMatches(tms)
    setScoringMatches(tms.flatMap(tm =>
      (tm.submatches ?? []).map((sm: any) => sm.match ?? sm.scoring).filter(Boolean) as Match[]
    ))
    setLoading(false)
  }

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduledReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => { loadData().catch(console.error) }, 300)
  }

  useEffect(() => { loadData() }, [tournament.id])
  useEffect(() => {
    const ch = supabase.channel(`pub-team-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches', filter: `tournament_id=eq.${tournament.id}` }, scheduledReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches',      filter: `tournament_id=eq.${tournament.id}` }, scheduledReload)
      .subscribe()
    return () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); supabase.removeChannel(ch) }
  }, [tournament.id])

  const subMatchScores = useMemo(() => {
    const map = new Map<string, Match>()
    for (const m of scoringMatches) map.set(m.id, m)
    return map
  }, [scoringMatches])

  const standings = useMemo(() => teams.map(team => {
    const played = teamMatches.filter(m => (m.team_a_id === team.id || m.team_b_id === team.id) && m.status === 'complete')
    const wins   = played.filter(m => m.winner_team_id === team.id).length
    const losses = played.length - wins
    let smW = 0, gd = 0
    for (const m of teamMatches.filter(tm => tm.team_a_id === team.id || tm.team_b_id === team.id)) {
      const isA = m.team_a_id === team.id
      for (const sm of (m.submatches ?? [])) {
        const sc = sm.match_id ? subMatchScores.get(sm.match_id) : null
        if (!sc || sc.status !== 'complete') continue
        const og = isA ? sc.player1_games : sc.player2_games
        const tg = isA ? sc.player2_games : sc.player1_games
        if (og > tg) smW++
        gd += og - tg
      }
    }
    return { team, played: played.length, wins, losses, smW, gd }
  }).sort((a, b) => b.wins - a.wins || b.smW - a.smW || b.gd - a.gd || a.team.name.localeCompare(b.team.name)),
  [teams, teamMatches, subMatchScores])

  const roundMap = useMemo(() => {
    const map = new Map<number, TeamMatch[]>()
    for (const m of teamMatches) {
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [teamMatches])

  // Auto-select the live round, or the first incomplete round, or last round
  const defaultRound = useMemo(() => {
    const liveRound = roundMap.find(([, ms]) => ms.some(m => m.status === 'live'))
    if (liveRound) return liveRound[0]
    const incomplete = roundMap.find(([, ms]) => ms.some(m => m.status !== 'complete'))
    if (incomplete) return incomplete[0]
    return roundMap[roundMap.length - 1]?.[0] ?? null
  }, [roundMap])

  const displayRound = activeRound ?? defaultRound

  if (loading) return <InlineLoader label="Loading…" />
  if (teamMatches.length === 0) return (
    <div className="page-content text-center text-muted-foreground py-12">
      <div className="text-4xl mb-3">🏓</div>
      <p className="font-semibold text-foreground">Team schedule not yet generated</p>
      <p className="text-sm mt-1">Check back once the organizer has set up the fixtures.</p>
    </div>
  )

  const doneCount  = teamMatches.filter(m => m.status === 'complete').length
  const totalCount = teamMatches.length
  const liveCount  = teamMatches.filter(m => m.status === 'live').length

  const roundLabel = (round: number, fixtures: TeamMatch[]) =>
    fixtures[0]?.round_name ?? (round >= 900 ? `Round of ${Math.pow(2, 910 - round)}` : `Round ${round}`)

  return (
    <div className="page-content flex flex-col gap-5">
      {/* Progress */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">League Progress</span>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} ties complete
            {liveCount > 0 && <span className="text-orange-500 ml-1">, {liveCount} LIVE</span>}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-orange-500 transition-all duration-500"
            style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }} />
        </div>
      </div>

      {/* Team Standings */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-base">Team Standings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground w-8">#</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">Team</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Ties played">P</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Wins">W</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Losses">L</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Rubber wins">SW</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-8" title="Game diff">GD</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.team.id} className={cn('border-b border-border/50 last:border-0', i === 0 && row.wins > 0 && 'bg-amber-50/40 dark:bg-amber-900/10')}>
                  <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {i === 0 && row.wins > 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: row.team.color ?? '#F06321' }} />
                      <span className="font-medium text-sm">{row.team.name}</span>
                      {row.team.short_name && <span className="text-xs text-muted-foreground hidden sm:inline">({row.team.short_name})</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.played}</td>
                  <td className="px-3 py-2 text-center text-xs font-bold text-foreground">{row.wins}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.losses}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.smW}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground font-mono">
                    {row.gd > 0 ? `+${row.gd}` : row.gd}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fixtures — orange tab bar matching admin BracketView style */}
      {roundMap.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Tab bar */}
          <div
            className="flex items-end gap-1 overflow-x-auto scrollbar-hide border-b-2 px-2 pt-2"
            style={{ borderColor: '#F06321' }}
          >
            {roundMap.map(([round, fixtures]) => {
              const isActive  = displayRound === round
              const hasLive   = fixtures.some(m => m.status === 'live')
              const allDone   = fixtures.every(m => m.status === 'complete')
              const label     = roundLabel(round, fixtures)
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
                  {label}
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

          {/* Active round fixtures */}
          {displayRound != null && (() => {
            const fixtures = roundMap.find(([r]) => r === displayRound)?.[1] ?? []
            return (
              <div className="p-4 flex flex-col gap-3">
                {fixtures.map(tm => (
                  <TeamMatchCard key={tm.id} teamMatch={tm} subMatchScores={subMatchScores} />
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
