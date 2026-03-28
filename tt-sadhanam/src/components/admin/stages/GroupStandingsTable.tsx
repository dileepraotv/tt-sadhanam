'use client'
// cache-bust: 1773800313

/**
 * GroupStandingsTable
 *
 * Full group view: tab picker → standings table → matchday fixtures.
 * Used by both SingleRRStage and MultiStagePanel (Stage 1).
 * Read-only display; scoring links are passed via matchBase.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { validateGameScore, formatValidationErrors } from '@/lib/scoring/engine'
import { MatchCard } from '@/components/bracket/MatchCard'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import type { Match } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'

// Inline winner trophy (avoids importing full WinnerTrophy to keep bundle lean)
function WinnerTrophyInline({ show }: { show: boolean }) {
  return (
    <span className="inline-flex items-center justify-center shrink-0 w-4" style={{ opacity: show ? 1 : 0 }}>
      <svg className="h-3 w-3 text-amber-500 fill-current" viewBox="0 0 24 24"><path d="M12 2C9.79 2 8 3.79 8 6v2H6c-1.1 0-2 .9-2 2v2c0 2.97 2.13 5.44 5 5.9V20H7v2h10v-2h-2v-2.1c2.87-.46 5-2.93 5-5.9V10c0-1.1-.9-2-2-2h-2V6c0-2.21-1.79-4-4-4zm0 2c1.1 0 2 .9 2 2v2h-4V6c0-1.1.9-2 2-2zm6 6v2c0 2.21-1.79 4-4 4h-4c-2.21 0-4-1.79-4-4v-2h12z"/></svg>
    </span>
  )
}

interface Props {
  standings:      GroupStandings[]
  allMatches:     Match[]
  matchBase:      string
  isAdmin?:       boolean
  advanceCount:   number
  allowBestThird?: boolean
  bestThirdCount?: number
  initialGroup?:  number
}

export function GroupStandingsTable({
  standings,
  allMatches,
  matchBase,
  isAdmin = false,
  advanceCount,
  allowBestThird = false,
  bestThirdCount = 0,
  initialGroup = 0,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(Math.min(initialGroup, Math.max(0, standings.length - 1)))

  if (!standings.length) return null

  const { group, standings: rows } = standings[activeIdx]
  const groupMatches = allMatches.filter(m => m.group_id === group.id)
  const matchdays    = Array.from(new Set(groupMatches.map(m => m.round))).sort((a, b) => a - b)

  // Cross-group best-thirds for amber highlight
  const allThirds = standings
    .map(gs => gs.standings.find(s => s.rank === advanceCount + 1))
    .filter(Boolean)
    .sort((a, b) => {
      if (b!.wins !== a!.wins) return b!.wins - a!.wins
      if (b!.gameDifference !== a!.gameDifference) return b!.gameDifference - a!.gameDifference
      return b!.pointsDifference - a!.pointsDifference
    })
  const bestThirdIds = new Set(
    allowBestThird ? allThirds.slice(0, bestThirdCount).map(s => s!.playerId) : [],
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Group selector cards — show group name + player dots */}
      <div className="flex flex-wrap gap-2">
        {standings.map((gs, idx) => {
          const played = gs.standings.some(s => s.matchesPlayed > 0)
          const done   = gs.standings.length > 0 && gs.standings.every(s =>
            s.matchesPlayed === gs.standings.length - 1,
          )
          const isActive = activeIdx === idx
          return (
            <button
              key={gs.group.id}
              onClick={() => setActiveIdx(idx)}
              className={cn(
                'flex flex-col gap-2 px-4 py-3 rounded-xl border text-left transition-all min-w-[140px]',
                isActive
                  ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-200/40 dark:shadow-orange-900/20'
                  : 'bg-card text-foreground border-border hover:border-orange-400 hover:shadow-sm',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{gs.group.name}</span>
                {done && <span className={cn('text-[10px] font-bold', isActive ? 'text-white/80' : 'text-emerald-500')}>✓ Done</span>}
                {!done && played && <span className={cn('h-2 w-2 rounded-full shrink-0', isActive ? 'bg-white/60' : 'bg-orange-400 animate-pulse')} />}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {gs.standings.slice(0, 6).map((s, si) => (
                  <span key={s.playerId} title={s.playerName}
                    className={cn(
                      'text-[10px] font-medium truncate max-w-[70px]',
                      isActive ? 'text-white/90' : 'text-muted-foreground',
                    )}>
                    <span className={cn('font-mono opacity-60 mr-0.5', isActive ? 'text-white/60' : '')}>{si + 1}.</span>{s.playerName.split(' ')[0]}
                  </span>
                ))}
                {gs.standings.length > 6 && (
                  <span className={cn('text-[10px]', isActive ? 'text-white/60' : 'text-muted-foreground/50')}>
                    +{gs.standings.length - 6}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Standings table */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Standings — {group.name}
        </p>
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                {[
                  { h: '#',   cls: 'w-8 text-center' },
                  { h: 'Player', cls: 'text-left pl-3' },
                  { h: 'MP', cls: 'text-center' },
                  { h: 'W',  cls: 'text-center' },
                  { h: 'L',  cls: 'text-center' },
                  { h: 'GD', cls: 'text-center' },
                  { h: 'PD', cls: 'text-center' },
                ].map(({ h, cls }) => (
                  <th key={h} className={cn('py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground', cls)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const qualifies   = s.rank <= advanceCount
                const isBestThird = !qualifies && bestThirdIds.has(s.playerId)
                return (
                  <tr
                    key={s.playerId}
                    className={cn(
                      'border-b border-border/40 last:border-0',
                      qualifies   && 'bg-green-50/70 dark:bg-green-950/20',
                      isBestThird && 'bg-amber-50/70 dark:bg-amber-950/20',
                    )}
                  >
                    <td className="py-2.5 px-2 text-center">
                      <span className={cn(
                        'inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold',
                        qualifies   && 'bg-green-500 text-white',
                        isBestThird && 'bg-amber-400 text-white',
                        !qualifies && !isBestThird && 'bg-muted/60 text-muted-foreground',
                      )}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 pr-2">
                      <div className="flex items-center gap-2">
                        {s.playerSeed && (
                          <span className="text-[10px] tabular-nums text-muted-foreground font-mono bg-muted/60 px-1 rounded">
                            [{s.playerSeed}]
                          </span>
                        )}
                        <span className="font-medium text-foreground">{s.playerName}</span>
                        {s.playerClub && (
                          <span className="hidden sm:inline text-xs text-muted-foreground">{s.playerClub}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-xs text-muted-foreground">
                      {s.matchesPlayed}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums font-semibold text-green-700 dark:text-green-400">
                      {s.wins}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-red-600 dark:text-red-400">
                      {s.losses}
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums">
                      <span className={cn(
                        'font-semibold text-sm',
                        s.gameDifference > 0 ? 'text-green-700 dark:text-green-400' :
                        s.gameDifference < 0 ? 'text-red-600 dark:text-red-400' :
                        'text-muted-foreground',
                      )}>
                        {s.gameDifference > 0 ? '+' : ''}{s.gameDifference}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums">
                      <span className={cn(
                        'text-xs',
                        s.pointsDifference > 0 ? 'text-green-700 dark:text-green-400' :
                        s.pointsDifference < 0 ? 'text-red-600 dark:text-red-400' :
                        'text-muted-foreground',
                      )}>
                        {s.pointsDifference > 0 ? '+' : ''}{s.pointsDifference}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-green-500/70" />
            <span className="text-[10px] text-muted-foreground">Qualifies (top {advanceCount})</span>
          </div>
          {allowBestThird && bestThirdCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-amber-400/70" />
              <span className="text-[10px] text-muted-foreground">Best-third ({bestThirdCount})</span>
            </div>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            MP · W · L · GD = game diff · PD = point diff
          </span>
        </div>
      </div>

      {/* Fixtures */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Fixtures — {group.name}
        </p>
        {matchdays.length === 0 ? (
          <EmptyFixtures />
        ) : (
          <div className="flex flex-col gap-3">
            {matchdays.map(day => {
              const dayMatches = groupMatches.filter(m => m.round === day)
              // Sort: live first, then pending, then complete (greyed at bottom)
              const sortedDay = [...dayMatches].sort((a, b) => {
                const order = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
                return order(a.status) - order(b.status)
              })
              const allDone = dayMatches.every(m => m.status === 'complete' || m.status === 'bye')
              const liveCount = dayMatches.filter(m => m.status === 'live').length
              return (
                <div key={day}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-orange-600">Round {day}</span>
                    {liveCount > 0 && <span className="text-[10px] font-bold text-orange-500 animate-pulse">● LIVE</span>}
                    {allDone && <span className="text-[10px] text-muted-foreground">✓ complete</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {sortedDay
                      .filter(m => m.status !== 'pending' || m.player1_id || m.player2_id)
                      .map(m => (
                        <FixtureRow key={m.id} match={m} matchBase={matchBase} isAdmin={isAdmin} />
                      ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty states ───────────────────────────────────────────────────────────────

function EmptyFixtures() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-dashed border-border">
      <p className="text-muted-foreground text-sm">No fixtures yet</p>
      <p className="text-xs text-muted-foreground/70 mt-0.5">
        Assign players to groups, then generate the schedule.
      </p>
    </div>
  )
}

// ── Fixture row ────────────────────────────────────────────────────────────────

function FixtureRow({ match: m, matchBase, isAdmin }: {
  match:     Match
  matchBase: string
  isAdmin:   boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isBye      = m.status === 'bye'
  const isComplete = m.status === 'complete'
  const isLive     = m.status === 'live'
  const p1         = m.player1
  const p2         = m.player2
  const p1Won      = isComplete && m.winner_id === m.player1_id
  const p2Won      = isComplete && m.winner_id === m.player2_id
  const games      = m.games ? [...m.games].sort((a, b) => a.game_number - b.game_number) : []
  const isDeclared = isComplete && games.length === 0

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-all',
      isLive     ? 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm' :
      isComplete ? 'border-border/40 bg-[#BEBEBE]/60 dark:bg-[#5a5a5a]/40' :
      isBye      ? 'border-border/20 bg-muted/5' :
                   'border-border bg-card',
    )}>
      <div className="px-3 py-2">
        {/* Player 1 row */}
        <div className={cn(
          'flex items-center gap-2 py-1 px-1 rounded',
          p1Won && 'border border-blue-900/35 bg-blue-950/5 dark:bg-blue-900/10 dark:border-blue-700/40',
        )}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <WinnerTrophyInline show={p1Won} />
            <span className={cn(
              'truncate text-xs',
              p1Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p1?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p1Won ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )} style={{fontSize:'12px'}}>
              {m.player1_games}
            </span>
          )}
          {isAdmin && !isBye && (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
              className={cn(
                'text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap ml-1',
                isComplete
                  ? 'text-slate-600 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30',
              )}
            >
              {expanded ? '↑' : isComplete ? 'Edit' : 'Score'}
            </button>
          )}
        </div>

        <div className="border-b border-border/30 mx-1 my-0.5" />

        {/* Player 2 row */}
        <div className={cn(
          'flex items-center gap-2 py-1 px-1 rounded',
          p2Won && 'border border-blue-900/35 bg-blue-950/5 dark:bg-blue-900/10 dark:border-blue-700/40',
        )}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <WinnerTrophyInline show={p2Won} />
            <span className={cn(
              'truncate text-xs',
              p2Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p2?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p2Won ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )} style={{fontSize:'12px'}}>
              {m.player2_games}
            </span>
          )}
          {isAdmin && !isBye && <span className="w-[42px] ml-1 shrink-0" />}
        </div>
      </div>

      {/* Game chips */}
      {(isComplete || isLive) && games.length > 0 && (
        <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1 border-t border-border/20">
          {games.map((g, i) => {
            const p1WonGame = g.winner_id === m.player1_id
            return (
              <span key={i} className={cn(
                'text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border',
                p1WonGame
                  ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/40'
                  : 'text-muted-foreground bg-muted/60 border-border/40',
              )}>
                {g.score1}–{g.score2}
              </span>
            )
          })}
        </div>
      )}

      {isDeclared && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20">
          <span className="text-[10px] text-muted-foreground/60 italic">Admin-declared result</span>
        </div>
      )}

      {isLive && <div className="h-0.5 bg-gradient-to-r from-orange-400/0 via-orange-500 to-orange-400/0 animate-pulse" />}

      {/* Inline scorer — expands below the match card */}
      {expanded && isAdmin && m.id && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <InlineMatchScorer
            matchId={m.id}
            player1Name={p1?.name ?? 'Player 1'}
            player2Name={p2?.name ?? 'Player 2'}
            onSaved={() => { setExpanded(false) }}
          />
        </div>
      )}
    </div>
  )
}

// ── InlineMatchScorer ──────────────────────────────────────────────────────────
// Validation uses render-time computation (same pattern as the working
// SingleMatchInlineScorer in BracketView). No scoreErrors state — errors
// appear the instant both scores are typed, with zero React batching lag.

function InlineMatchScorer({ matchId, player1Name, player2Name, onSaved }: {
  matchId:     string
  player1Name: string
  player2Name: string
  onSaved:     () => void
}) {
  const router = useRouter()
  const [games,       setGames]     = useState<{id:string;game_number:number;score1:number;score2:number;winner_id:string|null}[]>([])
  const [local,       setLocal]     = useState<Record<number,{s1:string;s2:string}>>({})
  const [saving,      setSaving]    = useState(false)
  const [loading,     setLoading_]  = useState(true)
  const [format,      setFormat]    = useState<'bo3'|'bo5'|'bo7'>('bo5')
  const [matchStatus, setMatchStatus] = useState<string>('pending')
  const [p1Id,        setP1Id]      = useState<string|null>(null)
  const [p2Id,        setP2Id]      = useState<string|null>(null)
  const [saveError,   setSaveError] = useState<string|null>(null)
  const sbRef = useRef<any>(null)

  const getSb = useCallback(async () => {
    if (!sbRef.current) {
      const { createClient } = await import('@/lib/supabase/client')
      sbRef.current = createClient()
    }
    return sbRef.current
  }, [])

  const load = useCallback(async () => {
    setLoading_(true)
    const sb = await getSb()
    const [gRes, mRes] = await Promise.all([
      sb.from('games').select('*').eq('match_id', matchId).order('game_number'),
      sb.from('matches').select('match_format, player1_id, player2_id, status').eq('id', matchId).single(),
    ])
    const gs = gRes.data ?? []
    setGames(gs)
    const init: Record<number,{s1:string;s2:string}> = {}
    for (const g of gs) init[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
    setLocal(init)
    setSaveError(null)
    if (mRes.data?.match_format) setFormat(mRes.data.match_format as 'bo3'|'bo5'|'bo7')
    if (mRes.data?.player1_id)   setP1Id(mRes.data.player1_id)
    if (mRes.data?.player2_id)   setP2Id(mRes.data.player2_id)
    if (mRes.data?.status)       setMatchStatus(mRes.data.status)
    setLoading_(false)
  }, [matchId, getSb])

  useEffect(() => { load() }, [load])

  const maxG = format === 'bo3' ? 3 : format === 'bo7' ? 7 : 5

  const handleChange = (gn: number, side: 's1'|'s2', val: string) =>
    setLocal(prev => ({ ...prev, [gn]: { ...prev[gn] ?? { s1:'', s2:'' }, [side]: val } }))

  const handleSave = async () => {
    setSaveError(null)
    setSaving(true)
    const entries = Array.from({length:maxG},(_,i)=>i+1)
      .map(gn => ({gn, sc: local[gn]}))
      .filter(({sc}) => sc && !(sc.s1==='' && sc.s2===''))
    if (!entries.length) { setSaveError('Enter at least one game score'); setSaving(false); return }
    for (const {gn, sc} of entries) {
      const s1 = parseInt(sc!.s1,10), s2 = parseInt(sc!.s2,10)
      if (isNaN(s1)||isNaN(s2)) { setSaveError(`Game ${gn}: enter valid numbers`); setSaving(false); return }
      const vr = validateGameScore({ score1: s1, score2: s2 })
      if (!vr.ok) { setSaveError(`Game ${gn}: ${formatValidationErrors(vr)}`); setSaving(false); return }
    }
    const { bulkSaveGameScores } = await import('@/lib/actions/matches')
    const res = await bulkSaveGameScores(
      matchId,
      entries.map(({gn,sc}) => ({ gameNumber:gn, score1:parseInt(sc!.s1,10), score2:parseInt(sc!.s2,10) })),
      matchStatus === 'complete',
    )
    if (!res.success) { setSaveError(res.error); setSaving(false); return }
    
    // Show notification if any games were skipped due to match already being decided
    if (res.skippedCount > 0 && res.decidingGameNumber) {
      const gameText = res.skippedCount === 1 ? 'Game' : 'Games'
      const gameNums = Array.from({length: res.skippedCount}, (_, i) => res.decidingGameNumber! + i + 1).join(', ')
      toast({
        title: `${gameText} ${gameNums} not saved`,
        description: `Match winner was already decided at game ${res.decidingGameNumber}`,
        variant: 'warning',
      })
    }
    
    setSaving(false)
    await load()
    router.refresh()
    onSaved()
  }

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>

  // ── Render-time validation — computed fresh every keystroke, zero lag ──────
  const gameValidation: Record<number,{valid:boolean;errorMsg:string}> = {}
  for (let gn = 1; gn <= maxG; gn++) {
    const row = local[gn]
    const s1str = row?.s1 ?? '', s2str = row?.s2 ?? ''
    if (s1str !== '' && s2str !== '') {
      const s1 = parseInt(s1str,10), s2 = parseInt(s2str,10)
      if (!isNaN(s1) && !isNaN(s2)) {
        const vr = validateGameScore({ score1:s1, score2:s2 })
        gameValidation[gn] = { valid: vr.ok, errorMsg: vr.ok ? '' : vr.errors[0]?.message ?? 'Invalid score' }
      } else { gameValidation[gn] = { valid:true, errorMsg:'' } }
    } else { gameValidation[gn] = { valid:true, errorMsg:'' } }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Format pills */}
      <div className="flex items-center gap-1">
        {(['bo3','bo5','bo7'] as const).map(f => (
          <button key={f}
            onClick={async () => { setFormat(f); const { updateMatchFormat } = await import('@/lib/actions/matches'); await updateMatchFormat(matchId, f) }}
            className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',
              format===f ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground')}>
            {f==='bo3'?'Best of 3':f==='bo5'?'Best of 5':'Best of 7'}
          </button>
        ))}
      </div>

      {/* Score grid */}
      <div className="overflow-x-auto">
        <div className="grid gap-1" style={{gridTemplateColumns:`minmax(80px,1fr) repeat(${maxG},44px)`, minWidth: 'fit-content'}}>
          <div className="text-[10px] font-bold text-muted-foreground uppercase py-1">Player</div>
          {Array.from({length:maxG},(_,i) => (
            <div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-1 font-bold">G{i+1}</div>
          ))}
        {/* P1 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player1Name}</div>
        {Array.from({length:maxG},(_,i) => {
          const gn=i+1, stored=games.find(g=>g.game_number===gn)
          const {valid} = gameValidation[gn]
          const aWon = stored ? stored.score1>stored.score2 : false
          return <input key={gn} type="number" min={0} max={99}
            value={local[gn]?.s1??''}
            onChange={e => handleChange(gn,'s1',e.target.value)}
            className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
              !valid                ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20' :
              aWon&&stored          ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' :
                                      'border-border bg-background')} />
        })}
        {/* P2 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player2Name}</div>
        {Array.from({length:maxG},(_,i) => {
          const gn=i+1, stored=games.find(g=>g.game_number===gn)
          const {valid} = gameValidation[gn]
          const bWon = stored ? stored.score2>stored.score1 : false
          return <input key={gn} type="number" min={0} max={99}
            value={local[gn]?.s2??''}
            onChange={e => handleChange(gn,'s2',e.target.value)}
            className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
              !valid                ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20' :
              bWon&&stored          ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' :
                                      'border-border bg-background')} />
        })}
      </div>
      </div>

      {/* Per-game errors — always current, no state lag */}
      {Array.from({length:maxG},(_,i) => {
        const gn=i+1, {valid,errorMsg} = gameValidation[gn]
        if (valid||!errorMsg) return null
        return (
          <p key={gn} className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1 mt-0.5">
            <AlertTriangle className="h-3 w-3 shrink-0"/> Game {gn}: {errorMsg}
          </p>
        )
      })}
      {saveError && (
        <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1 mt-0.5">
          <AlertTriangle className="h-3 w-3 shrink-0"/> {saveError}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5">
          {saving ? 'Saving…' : '✓ Save Scores'}
        </button>
        <button disabled={saving||!p1Id} onClick={async () => {
          setSaving(true)
          const { declareMatchWinner } = await import('@/lib/actions/matches')
          await declareMatchWinner(matchId, p1Id!, 'declared')
          setSaving(false); await load(); router.refresh(); onSaved()
        }} className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
          🏆 {player1Name} wins
        </button>
        <button disabled={saving||!p2Id} onClick={async () => {
          setSaving(true)
          const { declareMatchWinner } = await import('@/lib/actions/matches')
          await declareMatchWinner(matchId, p2Id!, 'declared')
          setSaving(false); await load(); router.refresh(); onSaved()
        }} className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
          🏆 {player2Name} wins
        </button>
      </div>
    </div>
  )
}

