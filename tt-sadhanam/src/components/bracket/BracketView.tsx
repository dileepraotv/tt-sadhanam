'use client'
// cache-bust: 1773800313

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { WinnerTrophy } from '@/components/shared/MatchUI'
import { InlineLoader } from '@/components/shared/GlobalLoader'
import { getRoundTab } from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import { MatchCard } from './MatchCard'
import { Check, Trophy, AlertTriangle } from 'lucide-react'
import { validateGameScore, formatValidationErrors } from '@/lib/scoring/engine'

interface BracketViewProps {
  tournament:    { id: string; name: string }
  matches:       Match[]
  isAdmin?:      boolean
  isPending?:     boolean   // shows loading overlay while bracket is generating
  matchBasePath?: string   // override match href base, e.g. /admin/championships/cid/events/eid/match
  onMatchClick?: (match: Match) => void
}

export function BracketView({ tournament, matches, isAdmin, isPending, matchBasePath, onMatchClick }: BracketViewProps) {
  const latestRound = useMemo(() => {
    const live = matches.find(m => m.status === 'live')?.round
    if (live) return live
    const done = matches.filter(m => m.status === 'complete').map(m => m.round)
    if (done.length) return Math.max(...done)
    return 1
  }, [matches])

  const [activeRound, setActiveRound] = useState<number | null>(null)
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)

  if (!matches.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <div className="text-5xl mb-3">🏓</div>
        <p className="text-lg font-bold text-foreground">Groups not generated yet</p>
        {isAdmin && <p className="text-sm mt-1 text-muted-foreground">Add players and generate the bracket</p>}
      </div>
    )
  }

  const rounds       = groupByRound(matches)
  const totalRounds  = rounds.length
  const displayRound = activeRound ?? latestRound

  const roundTabs = rounds.map(r => ({
    round:     r.round,
    label:     getRoundTab(r.round, totalRounds),
    liveCount: r.matches.filter(m => m.status === 'live').length,
    isLatest:  r.round === latestRound,
  }))

  return (
    <div className="relative flex flex-col gap-4">
      {isPending && (
        <InlineLoader />
      )}

      {/* ── Round tabs ── */}
      <div
        className="flex items-end gap-1 overflow-x-auto pb-0 scrollbar-hide border-b-2"
        style={{ borderColor: '#F06321' }}
      >
        {roundTabs.map(tab => {
          const isActive = displayRound === tab.round
          return (
            <button
              key={tab.round}
              onClick={() => setActiveRound(tab.round)}
              style={isActive
                ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                : undefined}
              className={cn(
                // whitespace-nowrap so "Semi Finals" never wraps mid-word
                'shrink-0 px-4 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
                !isActive && tab.isLatest && !activeRound
                  ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-2 border-b-0 border-orange-300 dark:border-orange-600/50'
                  : !isActive
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted/60 dark:hover:bg-muted/40'
                  : '',
              )}
            >
              {tab.label}

              {/* Live count bubble */}
              {tab.liveCount > 0 && (
                <span
                  className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: isActive ? 'rgba(255,255,255,0.35)' : '#F06321', color: '#fff' }}
                >
                  {tab.liveCount}
                </span>
              )}

              {/* Dot: latest round, not yet chosen */}
              {tab.isLatest && !isActive && !activeRound && (
                <span
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: '#F06321', verticalAlign: 'middle' }}
                />
              )}
            </button>
          )
        })}

        <div className="flex-1" />

        <button
          onClick={() => setActiveRound(-1)}
          style={displayRound === -1
            ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
            : undefined}
          className={cn(
            'shrink-0 px-4 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
            displayRound !== -1 && 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          All Groups
        </button>
      </div>

      {/* ── Content ── */}
      {displayRound === -1 ? (
        <FullBracket rounds={rounds} isAdmin={isAdmin} onMatchClick={onMatchClick} />
      ) : (
        <RoundList
          round={rounds.find(r => r.round === displayRound)!}
          isAdmin={isAdmin}
          matchBasePath={matchBasePath}
          onMatchClick={onMatchClick}
          expandedMatchId={expandedMatchId}
          onToggleExpand={(id) => setExpandedMatchId(prev => prev === id ? null : id)}
        />
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
interface RoundGroup {
  round:     number
  roundName: string
  matches:   Match[]
}

function groupByRound(matches: Match[]): RoundGroup[] {
  const map = new Map<number, Match[]>()
  matches.forEach(m => {
    if (!map.has(m.round)) map.set(m.round, [])
    map.get(m.round)!.push(m)
  })
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([round, ms]) => ({
      round,
      roundName: ms[0].round_name ?? `Round ${round}`,
      matches:   ms.sort((a, b) => a.match_number - b.match_number),
    }))
}

// ── Full Draw horizontal scroll ───────────────────────────────────────────────
//
// Card sizing — deliberately wider so player names are always visible.
// Scores are shown in a small monospaced font to the right so they don't compete.
//
const CARD_W = 240   // px — mobile-friendly width
const CARD_H = 92    // px — enough height for two player rows + divider
const CONN_W = 30    // connector line width
const COL_PAD = 10   // gap between card edge and connector

function FullBracket({ rounds, isAdmin, onMatchClick }: {
  rounds:        RoundGroup[]
  isAdmin?:      boolean
  onMatchClick?: (match: Match) => void
}) {
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max" style={{ alignItems: 'flex-start' }}>
        {rounds.map((round, roundIdx) => {
          const mul        = Math.pow(2, roundIdx)
          const gap        = (mul - 1) * CARD_H + 8
          const topPad     = (mul - 1) * (CARD_H / 2)
          const isLast     = roundIdx === rounds.length - 1
          const hasLive    = round.matches.some(m => m.status === 'live')

          return (
            <div key={round.round} className="flex flex-col">
              {/* Round column header */}
              <div className="text-center py-2 px-3 mb-1">
                <span
                  className={cn(
                    'text-xs font-bold uppercase tracking-wider',
                    hasLive ? 'text-orange-500' : 'text-muted-foreground',
                  )}
                >
                  {round.roundName}
                </span>
              </div>

              {/* Match column */}
              <div className="flex flex-col" style={{ gap: `${gap}px` }}>
                {round.matches.map((match, matchIdx) => {
                  const isEven = matchIdx % 2 === 0

                  return (
                    <div
                      key={match.id}
                      className="relative"
                      style={{
                        paddingTop:   matchIdx === 0 ? `${topPad}px` : '0',
                        paddingRight: isLast ? '0' : `${CONN_W + COL_PAD}px`,
                      }}
                    >
                      {/*
                        Connector geometry:
                        Each match div has height = CARD_H (plus topPad on matchIdx===0).
                        The card midpoint in the div's local coordinate space:
                          - matchIdx === 0: topPad + CARD_H/2   (paddingTop shifts card down)
                          - matchIdx  > 0: CARD_H/2             (no padding)

                        Vertical connector (on even/top match of each sibling pair):
                          Runs from top-match midpoint DOWN to bottom-match midpoint.
                          Height = gap + CARD_H  (exactly spans gap between siblings + one card).

                        Horizontal connector (every match):
                          Goes right from card midpoint to the connector column.
                      */}
                      {/* Vertical connector joining sibling pair — drawn on the EVEN (top) match */}
                      {!isLast && isEven && (
                        <div className="bracket-connector" style={{
                          position:   'absolute',
                          right:      COL_PAD,
                          top:        matchIdx === 0 ? topPad + CARD_H / 2 : CARD_H / 2,
                          width:      1,
                          height:     gap + CARD_H,
                        }} />
                      )}
                      {/* Horizontal connector to next round — drawn on every match */}
                      {!isLast && (
                        <div className="bracket-connector" style={{
                          position:   'absolute',
                          right:      COL_PAD,
                          top:        matchIdx === 0 ? topPad + CARD_H / 2 : CARD_H / 2,
                          width:      CONN_W,
                          height:     1,
                        }} />
                      )}

                      {/* Card */}
                      <div style={{ width: CARD_W, paddingLeft: 4, paddingRight: 4 }}>
                        <DrawCard
                          match={match}
                          isAdmin={isAdmin}
                          onClick={onMatchClick && match.status !== 'bye' ? () => onMatchClick(match) : undefined}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── DrawCard — compact card used ONLY in the Full Draw view ───────────────────
//
// Design goals:
//  • Name is the primary element — large, never truncated by score
//  • Set score (games won) is small monospaced digits on the right
//  • Individual game point-scores are hidden here (too cramped)
//  • Completed cards get a clear grey background
//  • Trophy emoji for winner — no icon import needed
//
function DrawCard({ match, isAdmin, onClick }: { match: Match; isAdmin?: boolean; onClick?: () => void }) {
  const { player1, player2, player1_games, player2_games, status, winner_id } = match

  const isComplete = status === 'complete'
  const isLive     = status === 'live'
  const isBye      = status === 'bye'

  const p1Win = isComplete && winner_id === match.player1_id
  const p2Win = isComplete && winner_id === match.player2_id

  const cardClass = (isComplete || isBye)
    ? 'draw-card-complete'
    : isLive
    ? 'draw-card-live'
    : 'draw-card-pending'

  const Wrapper = onClick ? 'button' : 'div'
  const canScore = isAdmin && !isBye && (status === 'pending' || status === 'live')

  return (
    <div className={canScore ? 'score-cta-wrap relative' : 'relative'}>
      {canScore && (
        <div className="score-cta">
          <span
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold text-white shadow-lg"
            style={{ background: '#F06321', pointerEvents: 'none' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Enter Score
          </span>
        </div>
      )}
      <Wrapper
        onClick={onClick}
        className={`w-full text-left block rounded-lg overflow-hidden transition-all duration-150 border-[1.5px] ${cardClass}${canScore ? ' hover:border-orange-400/70' : ''}`}
        style={{
          cursor:    onClick ? 'pointer' : 'default',
          minHeight: CARD_H,
        }}
      >
      <DrawPlayerRow
        player={player1}
        games={player1_games}
        isWinner={p1Win}
        isLoser={p2Win}
        showScore={isLive || isComplete}
        matchIsBye={isBye}
      />
      <div className="border-b border-border/30 mx-2" />
      <DrawPlayerRow
        player={player2}
        games={player2_games}
        isWinner={p2Win}
        isLoser={p1Win}
        showScore={isLive || isComplete}
        matchIsBye={isBye}
      />
      {isLive && (
        <div style={{
          height:     3,
          background: 'linear-gradient(90deg,#F06321,#F5853F,#F06321)',
          animation:  'animate-pulse-slow 2s ease-in-out infinite',
        }} />
      )}
    </Wrapper>
    </div>
  )
}

function DrawPlayerRow({ player, games, isWinner, isLoser, showScore, matchIsBye }: {
  player?:    { name?: string | null; seed?: number | null } | null
  games:      number
  isWinner:   boolean
  isLoser:    boolean
  showScore:  boolean
  matchIsBye: boolean
}) {
  const name  = (matchIsBye && !player?.name) ? 'BYE' : (player?.name ?? 'TBD')
  const isTbd = name === 'TBD'

  return (
    <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5" style={{ minHeight: 44 }}>
      {/* Left: trophy + seed + name */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {/* Trophy slot — fixed width to keep name column aligned */}
        <WinnerTrophy show={isWinner} size="md" />

        {/* Seed pill */}
        {player?.seed && (
          <span className="seed-badge shrink-0 text-[11px]">{player.seed}</span>
        )}

        {/* Name */}
        <span className={cn(
          'text-[13px] sm:text-[15px] overflow-hidden text-ellipsis whitespace-nowrap leading-tight',
          isTbd          && 'text-muted-foreground/60 italic',
          isWinner       && 'font-bold text-foreground',
          isLoser        && 'text-muted-foreground',
          !isWinner && !isLoser && !isTbd && 'text-foreground',
        )}>
          {name}
        </span>
      </div>

      {/* Set score */}
      {showScore && (
        <span className={cn(
          'font-mono text-xs font-bold tabular-nums shrink-0',
          isWinner ? 'text-orange-600 dark:text-orange-400' :
          isLoser  ? 'text-muted-foreground/60' :
                     'text-muted-foreground',
        )}>
          {games}
        </span>
      )}
    </div>
  )
}

// ── Single-round list (tab view) ──────────────────────────────────────────────
function RoundList({ round, isAdmin, matchBasePath, onMatchClick, expandedMatchId, onToggleExpand }: {
  round:           RoundGroup
  isAdmin?:        boolean
  matchBasePath?:  string
  onMatchClick?:   (match: Match) => void
  expandedMatchId?: string | null
  onToggleExpand?:  (id: string) => void
}) {
  if (!round) return null

  // Sort: live first, then pending, then completed (greyed at bottom)
  const sortedMatches = [...round.matches].sort((a, b) => {
    const order = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
    return order(a.status) - order(b.status)
  })
  const live      = round.matches.filter(m => m.status === 'live')
  const pending   = round.matches.filter(m => m.status === 'pending')
  const completed = round.matches.filter(m => m.status === 'complete' || m.status === 'bye')

  const card = (m: Match) => {
    const base      = matchBasePath ?? `/admin/tournaments/${m.tournament_id}/match`
    const isExpanded = expandedMatchId === m.id
    const isBye     = m.status === 'bye'
    const isComplete = m.status === 'complete'

    // Admin: show inline scorer, no navigation
    if (isAdmin && !isBye && !onMatchClick) {
      return (
        <div key={m.id} className="flex flex-col">
          <div className="relative">
            <MatchCard
              match={m}
              isAdmin={isAdmin}
              // no href — scoring is inline
            />
            {/* Score / Edit button overlaid at bottom of card */}
            <button
              onClick={() => onToggleExpand?.(m.id)}
              className={cn(
                'absolute bottom-2 right-2 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors',
                isComplete
                  ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 bg-card hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  : 'text-orange-500 border-orange-200 dark:border-orange-800/40 bg-card hover:bg-orange-50 dark:hover:bg-orange-950/30',
              )}
            >
              {isExpanded ? 'Close ↑' : isComplete ? 'Edit →' : 'Score →'}
            </button>
          </div>
          {isExpanded && (
            <div className="border border-t-0 border-border/50 rounded-b-xl px-3 pb-3 pt-2 bg-card">
              <SingleMatchInlineScorer
                matchId={m.id}
                player1Name={m.player1?.name ?? 'Player 1'}
                player2Name={m.player2?.name ?? 'Player 2'}
                onSaved={() => onToggleExpand?.(m.id)}
              />
            </div>
          )}
        </div>
      )
    }

    return (
      <MatchCard
        key={m.id}
        match={m}
        isAdmin={isAdmin}
        onClick={onMatchClick && !isBye ? () => onMatchClick(m) : undefined}
        href={isAdmin ? `${base}/${m.id}` : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {live.length > 0 && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="live-dot" />
          <span className="text-xs font-bold uppercase tracking-widest text-orange-500">
            {live.length} on court
          </span>
        </div>
      )}
      {/* Sorted: live → pending → completed (greyed + pushed to bottom) */}
      {sortedMatches.map(m => card(m))}
    </div>
  )
}


// ── SingleMatchInlineScorer ────────────────────────────────────────────────────
// Inline scorer for KO bracket matches.
// Uses render-time validation (no scoreErrors state) and bulkSaveGameScores.

export function SingleMatchInlineScorer({ matchId, player1Name, player2Name, onSaved }: {
  matchId:     string
  player1Name: string
  player2Name: string
  onSaved?:    () => void
}) {
  const router = useRouter()
  const [games,   setGames]   = useState<{id:string;game_number:number;score1:number;score2:number;winner_id:string|null}[]>([])
  const [local,   setLocal]   = useState<Record<number,{s1:string;s2:string}>>({})
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [format,  setFormat]  = useState<'bo3'|'bo5'|'bo7'>('bo5')
  const [matchStatus, setMatchStatus] = useState<string>('pending')
  const [p1Id,    setP1Id]    = useState<string|null>(null)
  const [p2Id,    setP2Id]    = useState<string|null>(null)
  const [saveError, setSaveError] = useState<string|null>(null)
  const sbRef = useRef<ReturnType<typeof import('@/lib/supabase/client').createClient> | null>(null)

  const getSb = useCallback(async () => {
    if (!sbRef.current) {
      const { createClient } = await import('@/lib/supabase/client')
      sbRef.current = createClient()
    }
    return sbRef.current!
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
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
    } finally {
      setLoading(false)
    }
  }, [matchId, getSb])

  useEffect(() => { load() }, [load])

  const maxG = format === 'bo3' ? 3 : format === 'bo7' ? 7 : 5

  const handleFormatChange = async (f: 'bo3'|'bo5'|'bo7') => {
    setFormat(f)
    const { updateMatchFormat } = await import('@/lib/actions/matches')
    await updateMatchFormat(matchId, f)
  }

  // Simple onChange — just update local state. Validation is render-time below.
  const handleChange = (gn: number, side: 's1'|'s2', val: string) =>
    setLocal(prev => ({ ...prev, [gn]: { ...prev[gn] ?? { s1:'', s2:'' }, [side]: val } }))

  const handleSave = async () => {
    setSaveError(null)
    const entries = Array.from({length:maxG},(_,i)=>i+1)
      .map(gn => ({gn, sc: local[gn]}))
      .filter(({sc}) => sc && !(sc.s1==='' && sc.s2===''))
    if (!entries.length) { setSaveError('Enter at least one game score'); return }
    for (const {gn, sc} of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) { setSaveError(`Game ${gn}: enter valid numbers`); return }
      const vr = validateGameScore({ score1: s1, score2: s2 })
      if (!vr.ok) { setSaveError(`Game ${gn}: ${formatValidationErrors(vr)}`); return }
    }
    setSaving(true)
    const { bulkSaveGameScores } = await import('@/lib/actions/matches')
    const res = await bulkSaveGameScores(
      matchId,
      entries.map(({gn, sc}) => ({ gameNumber: gn, score1: parseInt(sc!.s1,10), score2: parseInt(sc!.s2,10) })),
      matchStatus === 'complete',
    )
    if (!res.success) { setSaveError(res.error); setSaving(false); return }
    setSaving(false)
    await load()
    router.refresh()
    onSaved?.()
  }

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>

  // ── Render-time validation — computed fresh every render, zero lag ──────────
  const gameValidation: Record<number, { valid: boolean; errorMsg: string }> = {}
  for (let gn = 1; gn <= maxG; gn++) {
    const row = local[gn]
    const s1str = row?.s1 ?? '', s2str = row?.s2 ?? ''
    if (s1str !== '' && s2str !== '') {
      const s1 = parseInt(s1str, 10), s2 = parseInt(s2str, 10)
      if (!isNaN(s1) && !isNaN(s2)) {
        const vr = validateGameScore({ score1: s1, score2: s2 })
        gameValidation[gn] = { valid: vr.ok, errorMsg: vr.ok ? '' : vr.errors[0]?.message ?? 'Invalid score' }
      } else { gameValidation[gn] = { valid: true, errorMsg: '' } }
    } else { gameValidation[gn] = { valid: true, errorMsg: '' } }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Format selector */}
      <div className="flex items-center gap-1 pt-1">
        {(['bo3','bo5','bo7'] as const).map(f => (
          <button key={f} onClick={() => handleFormatChange(f)}
            className={cn(
              'px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',
              format === f ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground',
            )}>
            {f === 'bo3' ? 'Best of 3' : f === 'bo5' ? 'Best of 5' : 'Best of 7'}
          </button>
        ))}
      </div>

      {/* Score grid */}
      <div className="grid gap-1" style={{gridTemplateColumns: `minmax(80px,1fr) repeat(${maxG}, 44px)`}}>
        <div className="text-[10px] font-bold text-muted-foreground uppercase py-1">Player</div>
        {Array.from({length: maxG}, (_, i) => (
          <div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-1 font-bold">G{i+1}</div>
        ))}
        {/* P1 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player1Name}</div>
        {Array.from({length: maxG}, (_, i) => {
          const gn = i + 1
          const stored = games.find(g => g.game_number === gn)
          const { valid } = gameValidation[gn]
          const won = stored ? stored.score1 > stored.score2 : false
          return (
            <input key={gn} type="number" min={0} max={99}
              value={local[gn]?.s1 ?? ''} disabled={saving}
              onChange={e => handleChange(gn, 's1', e.target.value)}
              className={cn(
                'w-full text-center text-sm font-bold py-1.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                !valid              ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20' :
                won && stored       ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' :
                                      'border-border bg-background',
                saving && 'opacity-40',
              )}
            />
          )
        })}
        {/* P2 */}
        <div className="text-xs font-semibold py-1 truncate self-center">{player2Name}</div>
        {Array.from({length: maxG}, (_, i) => {
          const gn = i + 1
          const stored = games.find(g => g.game_number === gn)
          const { valid } = gameValidation[gn]
          const won = stored ? stored.score2 > stored.score1 : false
          return (
            <input key={gn} type="number" min={0} max={99}
              value={local[gn]?.s2 ?? ''} disabled={saving}
              onChange={e => handleChange(gn, 's2', e.target.value)}
              className={cn(
                'w-full text-center text-sm font-bold py-1.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/40 [appearance:textfield]',
                !valid              ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20' :
                won && stored       ? 'border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' :
                                      'border-border bg-background',
                saving && 'opacity-40',
              )}
            />
          )
        })}
      </div>

      {/* Per-game validation errors — render-time, always current */}
      {Array.from({length: maxG}, (_, i) => {
        const gn = i + 1
        const { valid, errorMsg } = gameValidation[gn]
        if (valid || !errorMsg) return null
        return (
          <p key={gn} className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Game {gn}: {errorMsg}
          </p>
        )
      })}

      {/* Save */}
      <div className="flex flex-col gap-1.5 pt-1">
        {saveError && (
          <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {saveError}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3 w-3" />}
            {saving ? 'Saving…' : 'Save Scores'}
          </button>
          <button onClick={async () => {
            setSaving(true)
            const { declareMatchWinner } = await import('@/lib/actions/matches')
            await declareMatchWinner(matchId, p1Id ?? 'p1', 'declared')
            setSaving(false); await load(); router.refresh(); onSaved?.()
          }} disabled={saving || !p1Id}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
            <Trophy className="h-3 w-3 text-amber-500" /> {player1Name} wins
          </button>
          <button onClick={async () => {
            setSaving(true)
            const { declareMatchWinner } = await import('@/lib/actions/matches')
            await declareMatchWinner(matchId, p2Id ?? 'p2', 'declared')
            setSaving(false); await load(); router.refresh(); onSaved?.()
          }} disabled={saving || !p2Id}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:border-amber-400 hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1">
            <Trophy className="h-3 w-3 text-amber-500" /> {player2Name} wins
          </button>
        </div>
      </div>
    </div>
  )
}
