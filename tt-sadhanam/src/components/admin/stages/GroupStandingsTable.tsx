'use client'

/**
 * GroupStandingsTable
 *
 * Full group view: tab picker → standings table → matchday fixtures.
 * Used by both SingleRRStage and MultiStagePanel (Stage 1).
 * Read-only display; scoring links are passed via matchBase.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { MatchCard } from '@/components/bracket/MatchCard'
import { cn } from '@/lib/utils'
import type { Match } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'

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
// Horizontal layout: [Player1 name] [score] vs [score] [Player2 name]
// Expands inline to show game score entry when admin clicks Score/Edit

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

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-all',
      isLive     ? 'border-orange-400/70 bg-orange-50/30 dark:bg-orange-950/10 shadow-sm' :
      isComplete ? 'border-border/20 bg-muted/10 opacity-60' :
      isBye      ? 'border-border/20 bg-muted/5 opacity-50' :
                   'border-border bg-card',
    )}>
      {/* Two-line player rows */}
      <div className="px-3 py-2">
        {/* Player 1 row */}
        <div className="flex items-center gap-2 py-1">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {p1Won && <span className="text-amber-500 text-sm shrink-0">🏆</span>}
            {!p1Won && <span className="w-4 shrink-0" />}
            <span className={cn(
              'truncate text-sm',
              p1Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p1?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {/* Per-game scores for P1 */}
          {(isComplete || isLive) && games.length > 0 && (
            <div className="flex items-center gap-0.5 shrink-0">
              {games.map((g, i) => {
                const score = g.score1
                const won   = g.winner_id === m.player1_id
                return (
                  <span key={i} className={cn(
                    'text-xs font-mono tabular-nums w-6 text-center rounded',
                    won ? 'font-bold text-orange-600 dark:text-orange-400' : 'text-muted-foreground/50',
                  )}>
                    {score ?? '–'}
                  </span>
                )
              })}
            </div>
          )}
          {/* Sets won */}
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p1Won ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50',
            )}>
              {m.player1_games}
            </span>
          )}
          {/* Score/Edit button (only on P1 row to avoid duplication) */}
          {isAdmin && !isBye && (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
              className={cn(
                'text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap ml-1',
                isComplete
                  ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30',
              )}
            >
              {expanded ? '↑' : isComplete ? 'Edit' : 'Score'}
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="border-b border-border/30 ml-6" />

        {/* Player 2 row */}
        <div className="flex items-center gap-2 py-1">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {p2Won && <span className="text-amber-500 text-sm shrink-0">🏆</span>}
            {!p2Won && <span className="w-4 shrink-0" />}
            <span className={cn(
              'truncate text-sm',
              p2Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
            )}>
              {p2?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
            </span>
          </div>
          {/* Per-game scores for P2 */}
          {(isComplete || isLive) && games.length > 0 && (
            <div className="flex items-center gap-0.5 shrink-0">
              {games.map((g, i) => {
                const score = g.score2
                const won   = g.winner_id === m.player2_id
                return (
                  <span key={i} className={cn(
                    'text-xs font-mono tabular-nums w-6 text-center rounded',
                    won ? 'font-bold text-orange-600 dark:text-orange-400' : 'text-muted-foreground/50',
                  )}>
                    {score ?? '–'}
                  </span>
                )
              })}
            </div>
          )}
          {/* Sets won */}
          {(isComplete || isLive) && (
            <span className={cn(
              'font-bold tabular-nums text-sm shrink-0 w-5 text-right',
              p2Won ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50',
            )}>
              {m.player2_games}
            </span>
          )}
          {/* Spacer to align with Score button above */}
          {isAdmin && !isBye && <span className="w-[42px] ml-1 shrink-0" />}
        </div>
      </div>

      {/* Live pulse bar */}
      {isLive && <div className="h-0.5 bg-gradient-to-r from-orange-400/0 via-orange-500 to-orange-400/0 animate-pulse" />}

      {/* Inline score entry */}
      {expanded && isAdmin && m.id && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <InlineMatchScorer matchId={m.id} player1Name={p1?.name ?? 'Player 1'} player2Name={p2?.name ?? 'Player 2'} />
        </div>
      )}
    </div>
  )
}

// ── InlineMatchScorer ──────────────────────────────────────────────────────────
// Minimal inline game-score entry for single-player (singles) matches in RR groups.
// Uses the same saveGameScore / declareMatchWinner actions as all other scorers.

function InlineMatchScorer({ matchId, player1Name, player2Name }: {
  matchId:     string
  player1Name: string
  player2Name: string
}) {
  const [games,       setGames]    = useState<{id:string;game_number:number;score1:number;score2:number}[]>([])
  const [local,       setLocal]    = useState<Record<number,{s1:string;s2:string}>>({})
  const [saving,      setSaving]   = useState(false)
  const [loading,     setLoading_] = useState(true)
  const [format,      setFormat]   = useState<'bo3'|'bo5'|'bo7'>('bo5')
  const sb = useRef(createClientForScorer()).current

  const load = useCallback(async () => {
    setLoading_(true)
    const [gRes, mRes] = await Promise.all([
      sb.from('games').select('*').eq('match_id', matchId).order('game_number'),
      sb.from('matches').select('match_format').eq('id', matchId).single(),
    ])
    const gs = gRes.data ?? []
    setGames(gs)
    const init: Record<number,{s1:string;s2:string}> = {}
    for (const g of gs) init[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
    setLocal(init)
    if (mRes.data?.match_format) setFormat(mRes.data.match_format as 'bo3'|'bo5'|'bo7')
    setLoading_(false)
  }, [matchId])

  useEffect(() => { load() }, [load])

  const maxG = format === 'bo3' ? 3 : format === 'bo7' ? 7 : 5

  const handleSave = async () => {
    setSaving(true)
    const entries = Array.from({length:maxG},(_,i)=>i+1)
      .map(gn=>({gn,sc:local[gn]}))
      .filter(({sc})=>sc&&!(sc.s1===''&&sc.s2===''))
    if (!entries.length) { setSaving(false); return }
    // Reset if match was already complete
    const isWasComplete = games.length > 0
    if (isWasComplete) {
      const { deleteGameScore: del } = await import('@/lib/actions/matches')
      for (const g of games) await del(matchId, g.game_number)
      const { createClient: cc } = await import('@/lib/supabase/client')
      await cc().from('matches').update({status:'pending',winner_id:null,player1_games:0,player2_games:0,completed_at:null}).eq('id',matchId)
    }
    const { saveGameScore } = await import('@/lib/actions/matches')
    for (const {gn,sc} of entries) {
      const s1=parseInt(sc!.s1,10), s2=parseInt(sc!.s2,10)
      if(isNaN(s1)||isNaN(s2)) continue
      const res = await saveGameScore(matchId,gn,s1,s2)
      if(!res.success) { if(res.error?.includes('Cannot add')||res.error?.includes('already complete')) break }
    }
    setSaving(false)
    await load()
  }

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>

  return (
    <div className="flex flex-col gap-2">
      {/* Format pills */}
      <div className="flex items-center gap-1">
        {(['bo3','bo5','bo7'] as const).map(f => (
          <button key={f} onClick={async()=>{setFormat(f);const{updateMatchFormat}=await import('@/lib/actions/matches');await updateMatchFormat(matchId,f)}}
            className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',
              format===f ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground')}>
            {f==='bo3'?'Best of 3':f==='bo5'?'Best of 5':'Best of 7'}
          </button>
        ))}
      </div>
      {/* Score grid */}
      <div className="grid gap-1" style={{gridTemplateColumns:`minmax(80px,1fr) repeat(${maxG},44px)`}}>
        <div className="text-[10px] font-bold text-muted-foreground uppercase py-1">Player</div>
        {Array.from({length:maxG},(_,i)=>(
          <div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-1 font-bold">G{i+1}</div>
        ))}
        {/* P1 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player1Name}</div>
        {Array.from({length:maxG},(_,i)=>{
          const gn=i+1, stored=games.find(g=>g.game_number===gn)
          const aWon=stored?stored.score1>stored.score2:false
          return (
            <input key={gn} type="number" min={0} max={99}
              value={local[gn]?.s1??''}
              onChange={e=>setLocal(p=>({...p,[gn]:{...p[gn]??{s1:'',s2:''},s1:e.target.value}}))}
              className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                aWon&&stored?'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300':'border-border bg-background')}
            />
          )
        })}
        {/* P2 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player2Name}</div>
        {Array.from({length:maxG},(_,i)=>{
          const gn=i+1, stored=games.find(g=>g.game_number===gn)
          const bWon=stored?stored.score2>stored.score1:false
          return (
            <input key={gn} type="number" min={0} max={99}
              value={local[gn]?.s2??''}
              onChange={e=>setLocal(p=>({...p,[gn]:{...p[gn]??{s1:'',s2:''},s2:e.target.value}}))}
              className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                bWon&&stored?'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300':'border-border bg-background')}
            />
          )
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Scores'}
        </button>
        <span className="text-[10px] text-muted-foreground">or declare:</span>
        <button disabled={saving} onClick={async () => {
          setSaving(true)
          const [{ declareMatchWinner }, mRow] = await Promise.all([
            import('@/lib/actions/matches'),
            sb.from('matches').select('player1_id').eq('id', matchId).single(),
          ])
          await declareMatchWinner(matchId, mRow.data?.player1_id ?? 'p1', 'declared')
          setSaving(false)
          await load()
        }} className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30">
          🏆 {player1Name} wins
        </button>
        <button disabled={saving} onClick={async () => {
          setSaving(true)
          const [{ declareMatchWinner }, mRow] = await Promise.all([
            import('@/lib/actions/matches'),
            sb.from('matches').select('player2_id').eq('id', matchId).single(),
          ])
          await declareMatchWinner(matchId, mRow.data?.player2_id ?? 'p2', 'declared')
          setSaving(false)
          await load()
        }} className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30">
          🏆 {player2Name} wins
        </button>
      </div>
    </div>
  )
}

// lazy supabase client for scorer (avoids SSR issues)
function createClientForScorer() {
  const { createClient } = require('@/lib/supabase/client')
  return createClient()
}
