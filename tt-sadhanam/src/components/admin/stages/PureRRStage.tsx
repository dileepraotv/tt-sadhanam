'use client'
// cache-bust: 1773593664

/**
 * PureRRStage
 *
 * Admin stage panel for format_type = 'pure_round_robin'.
 *
 * State machine:
 *   NO_SCHEDULE  → Generate Schedule button
 *   HAS_SCHEDULE → Standings table + match list by matchday
 */

import { useTransition, useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, RefreshCw, Trophy, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { validateGameScore, formatValidationErrors } from '@/lib/scoring/engine'
import { matchStatusClasses } from '@/components/shared/MatchUI'
import { cn } from '@/lib/utils'
import type { Tournament, Player, Match, Game } from '@/lib/types'
import type { PlayerStanding } from '@/lib/roundrobin/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { MatchCard } from '@/components/bracket/MatchCard'
import { NextStepBanner } from './NextStepBanner'
import { toast } from '@/components/ui/toaster'
import { useLoading } from '@/components/shared/GlobalLoader'
import { generateLeagueFixtures, resetLeague } from '@/lib/actions/pureRoundRobin'
import { computeLeagueStandings } from '@/lib/roundrobin/standings'
import { leagueMatchCount, leagueRoundCount } from '@/lib/roundrobin/leagueScheduler'

interface Props {
  tournament: Tournament
  players:    Player[]
  matches:    Match[]
  games:      Game[]
  matchBase:  string
}

export function PureRRStage({ tournament, players, matches, games, matchBase }: Props) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { setLoading }               = useLoading()
  const [showReset, setShowReset]    = useState(false)
  const [openRounds, setOpenRounds]  = useState<Set<number>>(new Set([1]))

  const isGenerated = tournament.bracket_generated
  const rrMatches   = matches.filter(m => m.match_kind === 'round_robin' || (!m.match_kind && !m.bracket_side))
  const realMatches = rrMatches.filter(m => m.status !== 'bye')
  const liveCount   = rrMatches.filter(m => m.status === 'live').length
  const doneCount   = rrMatches.filter(m => m.status === 'complete').length
  const hasScores   = games.length > 0

  const standings: PlayerStanding[] = useMemo(
    () => computeLeagueStandings(players, rrMatches, games),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, rrMatches, games],
  )

  // Group matches by matchday
  const matchdays = useMemo(() => {
    const map = new Map<number, Match[]>()
    for (const m of rrMatches) {
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
    }
    return Array.from(map.entries()).sort(([a],[b]) => a-b).map(([round, ms]) => ({ round, matches: ms }))
  }, [rrMatches])

  const handleGenerate = () => {
    setLoading(true)
    startTransition(async () => {
      const result = await generateLeagueFixtures(tournament.id)
      setLoading(false)
      if (result.error) {
        toast({ title: 'Generation failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `✅ Schedule generated — ${result.matchCount} matches` })
        setOpenRounds(new Set([1]))
        router.refresh()
      }
    })
  }

  const handleReset = () => {
    setLoading(true)
    setShowReset(false)
    startTransition(async () => {
      const result = await resetLeague(tournament.id)
      setLoading(false)
      if (result.error) {
        toast({ title: 'Reset failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'League reset' })
        router.refresh()
      }
    })
  }

  const toggleRound = (round: number) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  // ── NOT GENERATED YET ──────────────────────────────────────────────────────
  if (!isGenerated) {
    const expectedMatches = leagueMatchCount(players.length)
    const expectedRounds  = leagueRoundCount(players.length)

    return (
      <div className="flex flex-col gap-6">
        {players.length < 2 ? (
          <NextStepBanner
            variant="warning"
            title="Add players first"
            description="Add at least 2 players before generating the league schedule."
          />
        ) : (
          <>
            <NextStepBanner
              variant="action"
              step="Step 1"
              title="Generate the league schedule"
              description={`${players.length} players → ${expectedMatches} matches across ${expectedRounds} rounds using the circle method.`}
            />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RotateCcw className="h-4 w-4 text-orange-500" />
                  Pure Round Robin Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center mb-6">
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-foreground">{players.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">Players</p>
                  </div>
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-orange-500">{expectedMatches}</p>
                    <p className="text-xs text-muted-foreground mt-1">Matches</p>
                  </div>
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-foreground">{expectedRounds}</p>
                    <p className="text-xs text-muted-foreground mt-1">Rounds</p>
                  </div>
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={isPending || players.length < 2}
                  className="w-full gap-2"
                >
                  {isPending
                    ? <><span className="tt-spinner tt-spinner-sm" /> Generating…</>
                    : <><RotateCcw className="h-4 w-4" /> Generate League Schedule</>
                  }
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    )
  }

  // ── GENERATED ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar */}
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">League Progress</span>
            <span className="text-xs text-muted-foreground">{doneCount}/{realMatches.length} complete{liveCount > 0 && `, ${liveCount} live`}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-500"
              style={{ width: realMatches.length ? `${(doneCount / realMatches.length) * 100}%` : '0%' }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Standings table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" />
            League Standings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeagueStandingsTable standings={standings} />
        </CardContent>
      </Card>

      {/* Matchday accordion */}
      <div className="flex flex-col gap-2">
        {matchdays.map(({ round, matches: rMatches }: { round: number; matches: Match[] }) => {
          const isOpen   = openRounds.has(round)
          const liveMd   = rMatches.filter(m => m.status === 'live').length
          const doneMd   = rMatches.filter(m => m.status === 'complete').length
          const totalMd  = rMatches.filter(m => m.status !== 'bye').length
          const allDone  = doneMd === totalMd && totalMd > 0

          return (
            <Card key={round} className={cn('overflow-hidden', allDone && 'bg-slate-50/80 dark:bg-slate-800/30 border-border/40')}>
              <button
                onClick={() => toggleRound(round)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="font-semibold text-sm text-foreground flex-1">Matchday {round}</span>
                {liveMd > 0 && <span className="live-dot" />}
                {allDone && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Done</span>}
                <span className="text-xs text-muted-foreground">{doneMd}/{totalMd}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2">
                  {rMatches.filter(m => m.status !== 'bye').map(m => (
                    <PureRRFixtureRow key={m.id} match={m} matchBase={matchBase} />
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Reset */}
      {!showReset ? (
        <button
          onClick={() => setShowReset(true)}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors mt-2 self-start"
        >
          Reset league schedule…
        </button>
      ) : (
        <Card className="border-destructive/40">
          <CardContent className="p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-destructive">
              {hasScores
                ? '⚠️ This will delete all match scores. Are you sure?'
                : 'Reset the league schedule?'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowReset(false)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={handleReset} disabled={isPending}>
                <RefreshCw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Inline standings table ────────────────────────────────────────────────────

function LeagueStandingsTable({ standings }: { standings: PlayerStanding[] }) {
  if (standings.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">No standings yet.</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground w-8">#</th>
            <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">Player</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">MP</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">W</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">L</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">GW</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">GL</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">GD</th>
            <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground">PD</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr key={s.playerId} className={cn('border-b border-border/50 transition-colors', i === 0 && 'bg-amber-50/40 dark:bg-amber-900/10')}>
              <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {i === 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  <span className={cn('font-medium text-sm', i === 0 && 'text-amber-700 dark:text-amber-400')}>
                    {s.playerName}
                  </span>
                  {s.playerSeed && (
                    <span className="text-[10px] text-muted-foreground">[{s.playerSeed}]</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.matchesPlayed}</td>
              <td className="px-3 py-2 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">{s.wins}</td>
              <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.losses}</td>
              <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.gamesWon}</td>
              <td className="px-3 py-2 text-center text-xs text-muted-foreground">{s.gamesLost}</td>
              <td className={cn('px-3 py-2 text-center text-xs font-semibold',
                s.gameDifference > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                s.gameDifference < 0 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {s.gameDifference > 0 ? `+${s.gameDifference}` : s.gameDifference}
              </td>
              <td className={cn('px-3 py-2 text-center text-xs font-semibold',
                s.pointsDifference > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                s.pointsDifference < 0 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {s.pointsDifference > 0 ? `+${s.pointsDifference}` : s.pointsDifference}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


// ── PureRRFixtureRow — inline scorer with render-time validation ──────────────
function PureRRFixtureRow({ match: m, matchBase }: { match: Match; matchBase: string }) {
  const [expanded, setExpanded] = useState(false)
  const isBye      = m.status === 'bye'
  const isComplete = m.status === 'complete'
  const isLive     = m.status === 'live'
  const p1Won = isComplete && m.winner_id === m.player1_id
  const p2Won = isComplete && m.winner_id === m.player2_id
  const games = m.games ? [...m.games].sort((a,b) => a.game_number - b.game_number) : []

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden',
      isLive ? 'border-orange-400/60 bg-orange-50/20 dark:bg-orange-950/10' :
      isComplete ? 'border-border/40 bg-muted/10' : 'border-border bg-card',
    )}>
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/10 transition-colors"
        onClick={() => !isBye && setExpanded(v => !v)}>
        {/* P1 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end text-right">
          <span className={cn('truncate text-sm', p1Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold')}>
            {m.player1?.name ?? '—'}
          </span>
          {p1Won && <span className="text-amber-500 text-xs shrink-0">🏆</span>}
          {(isComplete || isLive) && (
            <span className={cn('font-mono font-bold tabular-nums text-sm shrink-0', p1Won ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60')}>
              {m.player1_games}
            </span>
          )}
        </div>
        <span className="text-[11px] font-bold text-muted-foreground/50 shrink-0">vs</span>
        {/* P2 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {(isComplete || isLive) && (
            <span className={cn('font-mono font-bold tabular-nums text-sm shrink-0', p2Won ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60')}>
              {m.player2_games}
            </span>
          )}
          {p2Won && <span className="text-amber-500 text-xs shrink-0">🏆</span>}
          <span className={cn('truncate text-sm', p2Won ? 'font-bold text-foreground' : isComplete ? 'font-normal text-muted-foreground' : 'font-semibold')}>
            {m.player2?.name ?? '—'}
          </span>
        </div>
        {/* Score chips */}
        {games.length > 0 && (
          <div className="hidden sm:flex items-center gap-0.5 shrink-0">
            {games.map((g,i) => (
              <span key={i} className={cn('text-[10px] font-mono px-1 py-0.5 rounded tabular-nums',
                g.winner_id === m.player1_id ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-600' : 'bg-muted text-muted-foreground')}>
                {g.score1}–{g.score2}
              </span>
            ))}
          </div>
        )}
        {!isBye && (
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
            className={cn('text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors whitespace-nowrap shrink-0',
              isComplete ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                         : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30')}>
            {expanded ? 'Close' : isComplete ? 'Edit' : 'Score'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <PureRRInlineScorer matchId={m.id} p1Name={m.player1?.name ?? 'P1'} p2Name={m.player2?.name ?? 'P2'} onSaved={() => setExpanded(false)} />
        </div>
      )}
    </div>
  )
}

// ── PureRRInlineScorer — render-time validation, no stale state ───────────────
function PureRRInlineScorer({ matchId, p1Name, p2Name, onSaved }: {
  matchId: string; p1Name: string; p2Name: string; onSaved: () => void
}) {
  const router = useRouter()
  const [games,   setGames]  = useState<{id:string;game_number:number;score1:number;score2:number;winner_id:string|null}[]>([])
  const [local,   setLocal]  = useState<Record<number,{s1:string;s2:string}>>({})
  const [saving,  setSaving] = useState(false)
  const [loading, setLoad_]  = useState(true)
  const [fmt,     setFmt]    = useState<'bo3'|'bo5'|'bo7'>('bo5')
  const [matchStatus, setMatchStatus] = useState<string>('pending')
  const [p1Id,    setP1Id]   = useState<string|null>(null)
  const [p2Id,    setP2Id]   = useState<string|null>(null)
  const [saveError, setSaveError] = useState<string|null>(null)
  const sbRef = useRef<any>(null)

  const getSb = useCallback(async () => {
    if (!sbRef.current) {
      const { createClient } = await import('@/lib/supabase/client')
      sbRef.current = createClient()
    }
    return sbRef.current
  }, [])

  const load = useCallback(async () => {
    setLoad_(true)
    const sb = await getSb()
    const [gR, mR] = await Promise.all([
      sb.from('games').select('*').eq('match_id', matchId).order('game_number'),
      sb.from('matches').select('match_format, player1_id, player2_id, status').eq('id', matchId).single(),
    ])
    const gs = gR.data ?? []
    setGames(gs)
    const init: Record<number,{s1:string;s2:string}> = {}
    for (const g of gs) init[g.game_number] = { s1: String(g.score1??''), s2: String(g.score2??'') }
    setLocal(init)
    setSaveError(null)
    if (mR.data?.match_format) setFmt(mR.data.match_format as 'bo3'|'bo5'|'bo7')
    if (mR.data?.player1_id)   setP1Id(mR.data.player1_id)
    if (mR.data?.player2_id)   setP2Id(mR.data.player2_id)
    if (mR.data?.status)       setMatchStatus(mR.data.status)
    setLoad_(false)
  }, [matchId, getSb])

  useEffect(() => { load() }, [load])

  const maxG = fmt==='bo3'?3:fmt==='bo7'?7:5

  const handleChange = (gn: number, side: 's1'|'s2', val: string) =>
    setLocal(prev => ({ ...prev, [gn]: { ...prev[gn]??{s1:'',s2:''}, [side]: val } }))

  const handleSave = async () => {
    setSaveError(null)
    setSaving(true)
    const entries = Array.from({length:maxG},(_,i)=>i+1)
      .map(gn=>({gn,sc:local[gn]})).filter(({sc})=>sc&&!(sc.s1===''&&sc.s2===''))
    if (!entries.length) { setSaveError('Enter at least one game score'); setSaving(false); return }
    for (const {gn,sc} of entries) {
      const s1=parseInt(sc!.s1,10), s2=parseInt(sc!.s2,10)
      if (isNaN(s1)||isNaN(s2)) { setSaveError(`Game ${gn}: enter valid numbers`); setSaving(false); return }
      const vr = validateGameScore({score1:s1,score2:s2})
      if (!vr.ok) { setSaveError(`Game ${gn}: ${formatValidationErrors(vr)}`); setSaving(false); return }
    }
    const { bulkSaveGameScores } = await import('@/lib/actions/matches')
    const res = await bulkSaveGameScores(
      matchId,
      entries.map(({gn,sc})=>({gameNumber:gn,score1:parseInt(sc!.s1,10),score2:parseInt(sc!.s2,10)})),
      matchStatus==='complete',
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
    
    setSaving(false); await load(); router.refresh(); onSaved()
  }

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>

  // Render-time validation — fresh every keystroke
  const gv: Record<number,{valid:boolean;errorMsg:string}> = {}
  for (let gn=1;gn<=maxG;gn++) {
    const row=local[gn], s1str=row?.s1??'', s2str=row?.s2??''
    if (s1str!==''&&s2str!=='') {
      const s1=parseInt(s1str,10), s2=parseInt(s2str,10)
      if (!isNaN(s1)&&!isNaN(s2)) {
        const vr=validateGameScore({score1:s1,score2:s2})
        gv[gn]={valid:vr.ok,errorMsg:vr.ok?'':vr.errors[0]?.message??'Invalid score'}
      } else gv[gn]={valid:true,errorMsg:''}
    } else gv[gn]={valid:true,errorMsg:''}
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {(['bo3','bo5','bo7'] as const).map(f=>(
          <button key={f} onClick={async()=>{setFmt(f);const{updateMatchFormat}=await import('@/lib/actions/matches');await updateMatchFormat(matchId,f)}}
            className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',fmt===f?'bg-orange-500 text-white':'text-muted-foreground hover:text-foreground')}>
            {f==='bo3'?'Best of 3':f==='bo5'?'Best of 5':'Best of 7'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="grid gap-1" style={{gridTemplateColumns:`minmax(80px,1fr) repeat(${maxG},44px)`, minWidth: 'fit-content'}}>
          <div className="text-[10px] font-bold text-muted-foreground uppercase py-1">Player</div>
          {Array.from({length:maxG},(_,i)=><div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-1 font-bold">G{i+1}</div>)}
        <div className="text-xs font-semibold py-1 truncate self-center">{p1Name}</div>
        {Array.from({length:maxG},(_,i)=>{const gn=i+1,s=games.find(g=>g.game_number===gn),{valid}=gv[gn],w=s?s.score1>s.score2:false
          return <input key={gn} type="number" min={0} max={99} value={local[gn]?.s1??''}
            onChange={e=>handleChange(gn,'s1',e.target.value)}
            className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
              !valid?'border-red-400 bg-red-50/40 dark:bg-red-950/20':w&&s?'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700':'border-border bg-background')}/>
        })}
        <div className="text-xs font-semibold py-1 truncate self-center">{p2Name}</div>
        {Array.from({length:maxG},(_,i)=>{const gn=i+1,s=games.find(g=>g.game_number===gn),{valid}=gv[gn],w=s?s.score2>s.score1:false
          return <input key={gn} type="number" min={0} max={99} value={local[gn]?.s2??''}
            onChange={e=>handleChange(gn,'s2',e.target.value)}
            className={cn('w-full text-center text-sm font-bold py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
              !valid?'border-red-400 bg-red-50/40 dark:bg-red-950/20':w&&s?'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700':'border-border bg-background')}/>
        })}
      </div>
      </div>
      {Array.from({length:maxG},(_,i)=>{const gn=i+1,{valid,errorMsg}=gv[gn];if(valid||!errorMsg)return null
        return <p key={gn} className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1 mt-0.5">
          <AlertTriangle className="h-3 w-3 shrink-0"/> Game {gn}: {errorMsg}</p>})}
      {saveError&&<p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1 mt-0.5"><AlertTriangle className="h-3 w-3 shrink-0"/> {saveError}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50">
          {saving?'Saving…':'✓ Save Scores'}
        </button>
        <button disabled={saving||!p1Id} onClick={async()=>{setSaving(true);const{declareMatchWinner}=await import('@/lib/actions/matches');await declareMatchWinner(matchId,p1Id!,'declared');setSaving(false);await load();router.refresh();onSaved()}}
          className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
          🏆 {p1Name} wins
        </button>
        <button disabled={saving||!p2Id} onClick={async()=>{setSaving(true);const{declareMatchWinner}=await import('@/lib/actions/matches');await declareMatchWinner(matchId,p2Id!,'declared');setSaving(false);await load();router.refresh();onSaved()}}
          className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
          🏆 {p2Name} wins
        </button>
      </div>
    </div>
  )
}
