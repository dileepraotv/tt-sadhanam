'use client'

/**
 * PublicTeamGroupKOView
 *
 * Public-facing view for team_group_corbillon and team_group_swaythling formats.
 * Shows:
 *   Tab 1 — Groups: per-group standings table + fixture list
 *   Tab 2 — Knockout: KO bracket cards (round by round)
 *
 * Loads data client-side with real-time subscription (same pattern as
 * PublicTeamLeagueView) so live results update without a page reload.
 */

import { useState, useEffect, useRef } from 'react'
import { Layers, Trophy, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { cn }                         from '@/lib/utils'
import type { Tournament }            from '@/lib/types'
import { createClient }               from '@/lib/supabase/client'
import { InlineLoader }               from '@/components/shared/GlobalLoader'
import { WinnerTrophy, matchStatusClasses } from '@/components/shared/MatchUI'

// ─── local types ─────────────────────────────────────────────────────────────

interface TeamRow {
  id:        string
  name:      string
  short_name: string | null
  color:     string | null
}

interface Submatch {
  id:           string
  match_order:  number
  label:        string
  player_a_name: string | null
  player_b_name: string | null
  match_id:     string | null
  scoring?: { player1_games: number; player2_games: number; status: string } | null
}

interface TeamMatchRow {
  id:             string
  team_a_id:      string
  team_b_id:      string
  round:          number
  round_name:     string | null
  status:         string
  team_a_score:   number
  team_b_score:   number
  winner_team_id: string | null
  group_id:       string | null
  team_a:         TeamRow | null
  team_b:         TeamRow | null
  submatches:     Submatch[]
}

interface GroupRow {
  id:           string
  group_number: number
  name:         string
  teamIds:      string[]
}

// ─── in-memory standings ─────────────────────────────────────────────────────

function computeStandings(groupId: string, teamIds: string[], matches: TeamMatchRow[]) {
  const map = new Map(teamIds.map(id => [id, { teamId: id, mW: 0, mL: 0, smW: 0, gd: 0 }]))
  for (const m of matches) {
    if (m.group_id !== groupId || m.status !== 'complete') continue
    const sA = map.get(m.team_a_id)
    const sB = map.get(m.team_b_id)
    if (m.winner_team_id === m.team_a_id) { sA && sA.mW++; sB && sB.mL++ }
    else if (m.winner_team_id === m.team_b_id) { sB && sB.mW++; sA && sA.mL++ }
    for (const sm of m.submatches) {
      const sc = sm.scoring
      if (!sc || sc.status !== 'complete') continue
      if (sA) { sA.smW += sc.player1_games > sc.player2_games ? 1 : 0; sA.gd += sc.player1_games - sc.player2_games }
      if (sB) { sB.smW += sc.player2_games > sc.player1_games ? 1 : 0; sB.gd += sc.player2_games - sc.player1_games }
    }
  }
  return [...map.values()].sort((a, b) => b.mW - a.mW || b.smW - a.smW || b.gd - a.gd)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function PublicTeamGroupKOView({ tournament }: { tournament: Tournament }) {
  const supabase = createClient()

  const [teams,       setTeams]       = useState<TeamRow[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatchRow[]>([])
  const [groups,      setGroups]      = useState<GroupRow[]>([])
  const [advanceCount, setAdvanceCount] = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<'groups' | 'knockout'>('groups')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const loadData = async () => {
    // 3 fully-parallel queries — rr_groups embedded in stage select (no serial 4th trip)
    const [teamsRes, stageRes, matchesRes] = await Promise.all([
      supabase.from('teams').select('id, name, short_name, color')
        .eq('tournament_id', tournament.id).order('created_at'),
      supabase.from('stages')
        .select('id, config, rr_groups(id, group_number, name, team_rr_group_members(team_id))')
        .eq('tournament_id', tournament.id).eq('stage_number', 1).maybeSingle(),
      supabase.from('team_matches')
        .select(`
          id, team_a_id, team_b_id, round, round_name, status,
          team_a_score, team_b_score, winner_team_id, group_id,
          team_a:team_a_id(id,name,short_name,color),
          team_b:team_b_id(id,name,short_name,color),
          submatches:team_match_submatches(
            id, match_order, label,
            player_a_name, player_b_name, match_id,
            scoring:match_id(player1_games, player2_games, status)
          )
        `)
        .eq('tournament_id', tournament.id)
        .order('round'),
    ])

    setTeams(teamsRes.data ?? [])
    setTeamMatches((matchesRes.data ?? []).map(tm => ({
      ...tm,
      submatches: ((tm as unknown as { submatches?: Submatch[] }).submatches ?? [])
        .sort((a, b) => a.match_order - b.match_order),
    })) as unknown as TeamMatchRow[])

    const stageData = stageRes.data
    if (stageData) {
      setAdvanceCount((stageData.config as { advanceCount?: number }).advanceCount ?? 1)
      // rr_groups already loaded via join — no extra round-trip needed
      const groupRows = (stageData as unknown as {
        rr_groups: Array<{ id: string; group_number: number; name: string; team_rr_group_members: { team_id: string }[] }>
      }).rr_groups ?? []
      setGroups(groupRows.map(g => ({
        id:           g.id,
        group_number: g.group_number,
        name:         g.name,
        teamIds:      (g.team_rr_group_members ?? []).map(m => m.team_id),
      })))
    }

    setLoading(false)
  }

  useEffect(() => { loadData() }, [tournament.id])

  // Debounce ref: collapse rapid Realtime bursts into a single reload
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduledReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => { loadData().catch(console.error) }, 300)
  }

  useEffect(() => {
    const channel = supabase
      .channel(`pub-team-group-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches', filter: `tournament_id=eq.${tournament.id}` }, scheduledReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_match_submatches' }, scheduledReload)
      .subscribe()
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [tournament.id])

  if (loading) return <InlineLoader label="Loading…" />

  const rrMatches = teamMatches.filter(m => m.group_id != null)
  const koMatches = teamMatches.filter(m => m.group_id == null && m.round >= 900)
  const teamById  = new Map(teams.map(t => [t.id, t]))

  const hasKO     = koMatches.length > 0

  // Auto-switch to knockout tab when KO exists and all RR done
  const allRRDone = rrMatches.length > 0 && rrMatches.every(m => m.status === 'complete')

  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border px-4 sm:px-6">
        {([
          { key: 'groups',   label: 'Groups',   icon: <Layers className="h-3.5 w-3.5" /> },
          { key: 'knockout', label: 'Knockout',  icon: <Trophy className="h-3.5 w-3.5" />, disabled: !hasKO },
        ] as const).map(t => (
          <button
            key={t.key}
            disabled={'disabled' in t && t.disabled}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.key
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {/* ── Groups tab ── */}
        {tab === 'groups' && (
          <div className="flex flex-col gap-4">
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Group stage not yet started.</p>
            )}

            {groups.map(group => {
              const standings   = computeStandings(group.id, group.teamIds, teamMatches)
              const groupMats   = rrMatches.filter(m => m.group_id === group.id)
              const isExpanded  = expandedGroup === group.id
              const allDone     = groupMats.length > 0 && groupMats.every(m => m.status === 'complete')

              return (
                <div key={group.id} className={cn(
                  'rounded-xl border overflow-hidden',
                  allDone ? 'border-border/40 bg-muted/10' : 'border-border bg-card',
                )}>
                  {/* Group header */}
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-semibold text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {group.teamIds.map(id => (teamById.get(id) as TeamRow | undefined)?.name ?? '?').join(' · ')}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {groupMats.filter(m => m.status === 'complete').length}/{groupMats.length} done
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/40 px-4 pb-4 flex flex-col gap-4 pt-3">
                      {/* Standings */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground border-b border-border">
                              <th className="text-left py-1.5 font-medium w-6">#</th>
                              <th className="text-left py-1.5 font-medium">Team</th>
                              <th className="text-center py-1.5 font-medium w-10">MW</th>
                              <th className="text-center py-1.5 font-medium w-10">ML</th>
                              <th className="text-center py-1.5 font-medium w-12">Ties</th>
                              <th className="text-center py-1.5 font-medium w-12">GD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.map((row, idx) => {
                              const t  = teamById.get(row.teamId) as TeamRow | undefined
                              const adv = idx < advanceCount
                              return (
                                <tr key={row.teamId} className={cn('border-b border-border/30', adv && 'bg-emerald-50/60 dark:bg-emerald-950/20')}>
                                  <td className="py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                                  <td className="py-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t?.color ?? '#888' }} />
                                      <span className="font-medium truncate">{t?.name ?? '?'}</span>
                                      {adv && <span title="Advances to knockout"><ArrowRight className="h-3 w-3 text-emerald-500 shrink-0" /></span>}
                                    </div>
                                  </td>
                                  <td className="py-1.5 text-center font-mono font-semibold">{row.mW}</td>
                                  <td className="py-1.5 text-center font-mono text-muted-foreground">{row.mL}</td>
                                  <td className="py-1.5 text-center font-mono">{row.smW}</td>
                                  <td className="py-1.5 text-center font-mono">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Fixtures */}
                      {groupMats.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fixtures</h4>
                          {groupMats.map(m => (
                            <PublicFixtureRow key={m.id} match={m} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Prompt to switch to KO */}
            {hasKO && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Knockout bracket is live!
                </span>
                <button
                  onClick={() => setTab('knockout')}
                  className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                >
                  View Bracket <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Knockout tab ── */}
        {tab === 'knockout' && (
          <div className="flex flex-col gap-4">
            {koMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Knockout bracket not yet generated.
              </p>
            ) : (
              (() => {
                const roundMap = new Map<number, TeamMatchRow[]>()
                for (const m of koMatches) {
                  const arr = roundMap.get(m.round) ?? []
                  arr.push(m)
                  roundMap.set(m.round, arr)
                }
                return [...roundMap.entries()].sort((a, b) => a[0] - b[0]).map(([roundN, ms]) => (
                  <div key={roundN} className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {ms[0]?.round_name ?? `Round ${roundN - 899}`}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {ms.map(m => <PublicKOCard key={m.id} match={m} />)}
                    </div>
                  </div>
                ))
              })()
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PublicFixtureRow ─────────────────────────────────────────────────────────

function PublicFixtureRow({ match }: { match: TeamMatchRow }) {
  const [expanded, setExpanded] = useState(false)
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const done       = match.submatches.filter(s => s.scoring?.status === 'complete').length
  const total      = match.submatches.length

  return (
    <div className={cn('rounded-lg border overflow-hidden', matchStatusClasses(match.status))}>
      {/* Header — two-line: Team A then Team B */}
      <button
        className="w-full px-3 pt-2.5 pb-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Team A row */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (match.team_a as any)?.color ?? '#888' }} />
          {match.winner_team_id === match.team_a_id && <span className="text-amber-500 text-xs">🏆</span>}
          <span className={cn('text-sm flex-1 min-w-0 truncate',
            isComplete && match.winner_team_id === match.team_a_id ? 'font-bold text-foreground' :
            isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>
            {match.team_a?.name ?? '—'}
          </span>
          <span className={cn('font-mono font-bold text-sm tabular-nums shrink-0',
            isComplete && match.winner_team_id === match.team_a_id ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60')}>
            {match.team_a_score}
          </span>
          {/* Action buttons only on first row */}
          <div className="flex items-center gap-1.5 shrink-0 ml-1">
            {isLive && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600">LIVE</span>}
            <span className="text-xs text-muted-foreground">{done}/{total}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
          </div>
        </div>
        {/* Divider */}
        <div className="border-b border-border/20 my-1 ml-4" />
        {/* Team B row */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (match.team_b as any)?.color ?? '#888' }} />
          {match.winner_team_id === match.team_b_id && <span className="text-amber-500 text-xs">🏆</span>}
          <span className={cn('text-sm flex-1 min-w-0 truncate',
            isComplete && match.winner_team_id === match.team_b_id ? 'font-bold text-foreground' :
            isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>
            {match.team_b?.name ?? '—'}
          </span>
          <span className={cn('font-mono font-bold text-sm tabular-nums shrink-0',
            isComplete && match.winner_team_id === match.team_b_id ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60')}>
            {match.team_b_score}
          </span>
          <span className="w-16 shrink-0" />{/* spacer to align with action row above */}
        </div>
      </button>

      {/* Expanded rubber details */}
      {expanded && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {/* Column headers */}
          <div className="px-3 py-1.5 grid grid-cols-[1fr_auto_1fr] gap-2 bg-muted/30">
            <span className="text-[10px] font-bold text-muted-foreground uppercase">{match.team_a?.name ?? 'Team A'}</span>
            <span className="text-[10px] text-muted-foreground"></span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase text-right">{match.team_b?.name ?? 'Team B'}</span>
          </div>
          {match.submatches.map((sm, idx) => {
            const sc      = sm.scoring
            const smDone  = sc?.status === 'complete'
            const smLive  = sc?.status === 'live'
            const p1g     = sc?.player1_games ?? 0
            const p2g     = sc?.player2_games ?? 0
            const aWon    = smDone && p1g > p2g
            const bWon    = smDone && p2g > p1g
            return (
              <div key={sm.id} className={cn('px-3 py-2 grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-xs',
                smLive && 'bg-orange-50/30 dark:bg-orange-950/10',
                smDone && 'bg-muted/10',
              )}>
                {/* Team A player */}
                <div className="flex items-center gap-1 min-w-0">
                  <span className={cn('text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                    smDone ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                  )}>{idx + 1}</span>
                  <span className={cn('truncate', aWon ? 'font-semibold text-emerald-600 dark:text-emerald-400' : bWon ? 'text-muted-foreground' : '')}>{sm.player_a_name ?? '—'}</span>
                </div>
                {/* Score */}
                <div className="flex items-center gap-1 shrink-0 justify-center">
                  {smDone ? (
                    <span className="font-mono font-bold tabular-nums text-xs">
                      <span className={aWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}>{p1g}</span>
                      <span className="text-muted-foreground mx-0.5">–</span>
                      <span className={bWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}>{p2g}</span>
                    </span>
                  ) : smLive ? (
                    <span className="flex items-center gap-1 text-orange-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                      <span className="font-mono text-xs">{p1g}–{p2g}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/40">vs</span>
                  )}
                </div>
                {/* Team B player */}
                <div className="flex items-center gap-1 min-w-0 justify-end">
                  <span className={cn('truncate text-right', bWon ? 'font-semibold text-emerald-600 dark:text-emerald-400' : aWon ? 'text-muted-foreground' : '')}>{sm.player_b_name ?? '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── PublicKOCard ─────────────────────────────────────────────────────────────

function PublicKOCard({ match }: { match: TeamMatchRow }) {
  const [expanded, setExpanded] = useState(false)
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const done       = match.submatches.filter(s => s.scoring?.status === 'complete').length

  return (
    <div className={cn('rounded-xl border overflow-hidden', matchStatusClasses(match.status))}>
      <button
        className="w-full px-3 py-2.5 flex flex-col gap-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Team A */}
        <div className={cn('flex items-center gap-2', isComplete && match.winner_team_id !== match.team_a_id && 'text-muted-foreground/60')}>
          <WinnerTrophy show={isComplete && match.winner_team_id === match.team_a_id} />
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: (match.team_a as TeamRow | null)?.color ?? '#888' }} />
          <span className={cn('text-sm flex-1 truncate', isComplete && match.winner_team_id === match.team_a_id ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>{match.team_a?.name ?? 'TBD'}</span>
          <span className="text-sm font-bold font-mono tabular-nums">{match.team_a_score}</span>
        </div>
        <div className="border-t border-border/30" />
        {/* Team B */}
        <div className={cn('flex items-center gap-2', isComplete && match.winner_team_id !== match.team_b_id && 'text-muted-foreground/60')}>
          <WinnerTrophy show={isComplete && match.winner_team_id === match.team_b_id} />
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: (match.team_b as TeamRow | null)?.color ?? '#888' }} />
          <span className={cn('text-sm flex-1 truncate', isComplete && match.winner_team_id === (match.team_b as TeamRow | null)?.id ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>{match.team_b?.name ?? 'TBD'}</span>
          <span className="text-sm font-bold font-mono tabular-nums">{match.team_b_score}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border/20 pt-1.5">
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400">
                LIVE
              </span>
            )}
            {isComplete && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Done</span>}
            {!isLive && !isComplete && <span className="text-xs text-muted-foreground">Upcoming</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{done}/{match.submatches.length}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
          </div>
        </div>
      </button>

      {/* Expanded rubber details */}
      {expanded && match.submatches.length > 0 && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {match.submatches.map((sm, idx) => {
            const sc     = sm.scoring
            const smDone = sc?.status === 'complete'
            const smLive = sc?.status === 'live'
            const p1g    = sc?.player1_games ?? 0
            const p2g    = sc?.player2_games ?? 0
            const aWon   = smDone && p1g > p2g
            const bWon   = smDone && p2g > p1g
            return (
              <div key={sm.id} className={cn('px-3 py-2 text-xs',
                smLive && 'bg-orange-50/30 dark:bg-orange-950/10',
                smDone && 'bg-muted/5',
              )}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={cn('text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                    smDone ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                  )}>{idx + 1}</span>
                  <span className="text-muted-foreground">{sm.label}</span>
                  {smDone && (
                    <span className="ml-auto font-mono font-bold tabular-nums">
                      <span className={aWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}>{p1g}</span>
                      <span className="text-muted-foreground mx-0.5">–</span>
                      <span className={bWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}>{p2g}</span>
                    </span>
                  )}
                  {smLive && (
                    <span className="ml-auto flex items-center gap-1 text-orange-500 font-mono font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0" />
                      {p1g}–{p2g}
                    </span>
                  )}
                  {!smDone && !smLive && <span className="ml-auto text-muted-foreground/40">vs</span>}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-1 ml-5">
                  <span className={cn('truncate', aWon ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{sm.player_a_name ?? '—'}</span>
                  <span className="text-muted-foreground/30 text-[10px]">vs</span>
                  <span className={cn('truncate text-right', bWon ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{sm.player_b_name ?? '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
