'use client'

/**
 * DoubleEliminationView
 *
 * Dual bracket visualizer for double_elimination events.
 * Shows Winners Bracket, Losers Bracket, and Grand Final in a
 * tabbed + scrollable layout.
 *
 * WB: rounds left-to-right, seeded standard KO structure
 * LB: alternating major (WB drops in) and minor (LB survivors) rounds
 * GF: WB Champion vs LB Champion (with optional bracket reset)
 *
 * Architecture:
 *   - Each bracket gets its own horizontal scroll panel
 *   - Matches use the existing MatchCard compact variant
 *   - Admin links to scoring page via matchBasePath
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Trophy, Shield, GitBranch, Swords, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Match } from '@/lib/types'
import { MatchCard } from '@/components/bracket/MatchCard'

interface Props {
  wbMatches:     Match[]
  lbMatches:     Match[]
  gfMatches:     Match[]
  isAdmin?:      boolean
  matchBasePath?: string
  onMatchClick?: (match: Match) => void
}

type BracketView = 'winners' | 'losers' | 'final'

export function DoubleEliminationView({
  wbMatches,
  lbMatches,
  gfMatches,
  isAdmin,
  matchBasePath,
  onMatchClick,
}: Props) {
  const [activeView, setActiveView] = useState<BracketView>('winners')

  // Group by round
  const wbByRound = groupByRound(wbMatches)
  const lbByRound = groupByRound(lbMatches)

  // Live indicators
  const wbLive = wbMatches.filter(m => m.status === 'live').length
  const lbLive = lbMatches.filter(m => m.status === 'live').length
  const gfLive = gfMatches.filter(m => m.status === 'live').length

  // Completion
  const wbDone = wbMatches.filter(m => m.status === 'complete').length
  const lbDone = lbMatches.filter(m => m.status === 'complete').length
  const gfDone = gfMatches.filter(m => m.status === 'complete').length

  // Overall winner
  const champion = gfMatches.find(m => m.status === 'complete' && m.winner_id)?.winner ?? null

  const tabs: Array<{
    id:    BracketView
    label: string
    icon:  React.ReactNode
    live:  number
    done:  number
    total: number
  }> = [
    { id: 'winners', label: "Winners'", icon: <Trophy className="h-3.5 w-3.5" />,   live: wbLive, done: wbDone, total: wbMatches.length },
    { id: 'losers',  label: "Losers'",  icon: <Shield className="h-3.5 w-3.5" />,   live: lbLive, done: lbDone, total: lbMatches.length },
    { id: 'final',   label: 'Grand Final', icon: <Swords className="h-3.5 w-3.5" />, live: gfLive, done: gfDone, total: gfMatches.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Champion banner */}
      {champion && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
          <Trophy className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">Champion</p>
            <p className="font-bold text-amber-800 dark:text-amber-200 text-base">{champion.name}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="flex items-end gap-1 overflow-x-auto scrollbar-hide border-b-2"
        style={{ borderColor: '#F06321' }}
      >
        {tabs.map(tab => {
          const isActive = activeView === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              style={isActive
                ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                : undefined}
              className={cn(
                'shrink-0 flex items-center gap-1.5 px-3 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
                !isActive
                  ? 'text-muted-foreground hover:text-foreground border-2 border-b-0 border-transparent'
                  : '',
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.live > 0 && <span className="live-dot ml-0.5" />}
              <span className={cn(
                'text-[10px] font-mono ml-0.5',
                isActive ? 'text-white/80' : 'text-muted-foreground',
              )}>
                {tab.done}/{tab.total}
              </span>
            </button>
          )
        })}
      </div>

      {/* Winners Bracket */}
      {activeView === 'winners' && (
        <BracketPanel
          rounds={wbByRound}
          label="Winners' Bracket"
          emptyMessage="Winners' bracket not generated yet."
          isAdmin={isAdmin}
          matchBasePath={matchBasePath}
          onMatchClick={onMatchClick}
          accentColor="#F06321"
        />
      )}

      {/* Losers Bracket */}
      {activeView === 'losers' && (
        <BracketPanel
          rounds={lbByRound}
          label="Losers' Bracket"
          emptyMessage="Losers' bracket will appear once Winners' bracket has started."
          isAdmin={isAdmin}
          matchBasePath={matchBasePath}
          onMatchClick={onMatchClick}
          accentColor="#6366f1"
          roundPrefix="LB Round"
        />
      )}

      {/* Grand Final */}
      {activeView === 'final' && (
        <GrandFinalPanel
          matches={gfMatches}
          isAdmin={isAdmin}
          matchBasePath={matchBasePath}
          onMatchClick={onMatchClick}
        />
      )}
    </div>
  )
}

// ── Bracket panel ─────────────────────────────────────────────────────────────

function BracketPanel({
  rounds,
  label,
  emptyMessage,
  isAdmin,
  matchBasePath,
  onMatchClick,
  accentColor,
  roundPrefix = 'Round',
}: {
  rounds:         Map<number, Match[]>
  label:          string
  emptyMessage:   string
  isAdmin?:       boolean
  matchBasePath?: string
  onMatchClick?:  (match: Match) => void
  accentColor:    string
  roundPrefix?:   string
}) {
  const roundNums = Array.from(rounds.keys()).sort((a, b) => a - b)
  const totalRounds = roundNums.length

  if (totalRounds === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="flex gap-4 pb-4"
        style={{ minWidth: `${Math.max(totalRounds * 220, 440)}px` }}
      >
        {roundNums.map((round, ri) => {
          const roundMatches  = (rounds.get(round) ?? []).filter(m => m.status !== 'bye')
          const isLastRound   = ri === totalRounds - 1
          const roundName     = roundMatches[0]?.round_name ?? `${roundPrefix} ${round}`

          return (
            <div
              key={round}
              className="flex flex-col gap-3 flex-shrink-0"
              style={{ width: 210 }}
            >
              {/* Round header */}
              <div
                className="text-xs font-bold uppercase tracking-wider text-center py-1.5 rounded-md"
                style={{
                  background: `${accentColor}18`,
                  color:      accentColor,
                  borderBottom: isLastRound ? `2px solid ${accentColor}` : undefined,
                }}
              >
                {roundName}
              </div>

              {/* Matches */}
              <div className="flex flex-col gap-3">
                {roundMatches.map(match => (
                  <DEMatchCard
                    key={match.id}
                    match={match}
                    isAdmin={isAdmin}
                    matchBasePath={matchBasePath}
                    onMatchClick={onMatchClick}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Grand Final panel ─────────────────────────────────────────────────────────

function GrandFinalPanel({
  matches,
  isAdmin,
  matchBasePath,
  onMatchClick,
}: {
  matches:        Match[]
  isAdmin?:       boolean
  matchBasePath?: string
  onMatchClick?:  (match: Match) => void
}) {
  const gf1 = matches.find(m => m.match_number === 1)
  const gf2 = matches.find(m => m.match_number === 2)  // bracket reset

  if (!gf1) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Grand Final will appear once both brackets are complete.
      </div>
    )
  }

  const isResetNeeded = gf1.status === 'complete' && gf1.winner_id === gf1.player2_id
  const champion      = gf2?.status === 'complete' ? gf2.winner
                      : gf1?.status === 'complete' && !isResetNeeded ? gf1.winner
                      : null

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {champion && (
        <div className="flex flex-col items-center gap-2 text-center">
          <Trophy className="h-10 w-10 text-amber-400" />
          <p className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">Tournament Champion</p>
          <p className="text-2xl font-bold text-foreground">{champion.name}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {/* Grand Final */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-center text-muted-foreground">Grand Final</p>
          <DEMatchCard
            match={gf1}
            isAdmin={isAdmin}
            matchBasePath={matchBasePath}
            onMatchClick={onMatchClick}
          />
        </div>

        {/* Bracket Reset (appears only when LB champion wins GF) */}
        {gf2 && isResetNeeded && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 justify-center">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-bold uppercase tracking-wider text-orange-500 whitespace-nowrap">
                Bracket Reset
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <p className="text-xs text-center text-muted-foreground">
              LB champion won — one more match required.
            </p>
            <DEMatchCard
              match={gf2}
              isAdmin={isAdmin}
              matchBasePath={matchBasePath}
              onMatchClick={onMatchClick}
            />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground mt-2">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: '#F06321' }} />
          WB Champion (Slot 1)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          LB Champion (Slot 2)
        </span>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByRound(matches: Match[]): Map<number, Match[]> {
  const map = new Map<number, Match[]>()
  for (const m of matches) {
    if (!map.has(m.round)) map.set(m.round, [])
    map.get(m.round)!.push(m)
  }
  return map
}


// ── DEMatchCard — MatchCard with inline scorer for admin ─────────────────────
function DEMatchCard({ match, isAdmin, matchBasePath, onMatchClick }: {
  match:          Match
  isAdmin?:       boolean
  matchBasePath?: string
  onMatchClick?:  (match: Match) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isBye      = match.status === 'bye'
  const isComplete = match.status === 'complete'

  // Non-admin or click-handler: use original behaviour
  if (!isAdmin || onMatchClick) {
    return (
      <MatchCard
        match={match}
        compact
        isAdmin={isAdmin}
        href={matchBasePath ? `${matchBasePath}/${match.id}` : undefined}
        onClick={onMatchClick ? () => onMatchClick(match) : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col">
      <div className="relative">
        <MatchCard match={match} compact isAdmin={isAdmin} />
        {!isBye && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={cn(
              'absolute bottom-1.5 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors bg-card',
              isComplete
                ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50'
                : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50',
            )}
          >
            {expanded ? 'Close' : isComplete ? 'Edit' : 'Score'}
          </button>
        )}
      </div>
      {expanded && (
        <DEInlineScorer
          matchId={match.id}
          p1Name={match.player1?.name ?? 'Player 1'}
          p2Name={match.player2?.name ?? 'Player 2'}
          onSaved={() => setExpanded(false)}
        />
      )}
    </div>
  )
}

function DEInlineScorer({ matchId, p1Name, p2Name, onSaved }: {
  matchId:  string
  p1Name:   string
  p2Name:   string
  onSaved?: () => void
}) {
  const [games,   setGames]   = useState<{id:string;game_number:number;score1:number;score2:number}[]>([])
  const [local,   setLocal]   = useState<Record<number,{s1:string;s2:string}>>({})
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [fmt,     setFmt]     = useState<'bo3'|'bo5'|'bo7'>('bo5')
  const sbRef = useRef<any>(null)
  const getSb = useCallback(async () => {
    if (!sbRef.current) { const { createClient } = await import('@/lib/supabase/client'); sbRef.current = createClient() }
    return sbRef.current
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const sb = await getSb()
    const [gR, mR] = await Promise.all([
      sb.from('games').select('*').eq('match_id', matchId).order('game_number'),
      sb.from('matches').select('match_format').eq('id', matchId).single(),
    ])
    const gs = gR.data ?? []
    setGames(gs)
    const init: Record<number,{s1:string;s2:string}> = {}
    for (const g of gs) init[g.game_number] = { s1: String(g.score1 ?? ''), s2: String(g.score2 ?? '') }
    setLocal(init)
    if (mR.data?.match_format) setFmt(mR.data.match_format as any)
    setLoading(false)
  }, [matchId, getSb])

  useEffect(() => { load() }, [load])

  const maxG = fmt === 'bo3' ? 3 : fmt === 'bo7' ? 7 : 5

  const handleSave = async () => {
    setSaving(true)
    const entries = Array.from({length: maxG}, (_, i) => i + 1)
      .map(gn => ({ gn, sc: local[gn] }))
      .filter(({sc}) => sc && !(sc.s1 === '' && sc.s2 === ''))
    if (!entries.length) { setSaving(false); return }
    if (games.length > 0) {
      const { deleteGameScore } = await import('@/lib/actions/matches')
      const sb = await getSb()
      for (const g of games) await deleteGameScore(matchId, g.game_number)
      await sb.from('matches').update({ status: 'pending', winner_id: null, player1_games: 0, player2_games: 0, completed_at: null }).eq('id', matchId)
    }
    const { saveGameScore } = await import('@/lib/actions/matches')
    for (const { gn, sc } of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) continue
      const r = await saveGameScore(matchId, gn, s1, s2)
      if (!r.success) { if (r.error?.includes('Cannot add') || r.error?.includes('already complete')) break; break }
    }
    setSaving(false)
    await load()
    onSaved?.()
  }

  if (loading) return <div className="border border-t-0 border-border/40 rounded-b-xl px-3 pb-2 pt-1.5 text-xs text-muted-foreground">Loading…</div>

  return (
    <div className="border border-t-0 border-border/40 rounded-b-xl px-3 pb-3 pt-2 bg-card flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {(['bo3','bo5','bo7'] as const).map(f => (
          <button key={f} onClick={async () => { setFmt(f); const { updateMatchFormat } = await import('@/lib/actions/matches'); await updateMatchFormat(matchId, f) }}
            className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors',
              fmt === f ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:text-foreground')}>
            {f === 'bo3' ? 'Bo3' : f === 'bo5' ? 'Bo5' : 'Bo7'}
          </button>
        ))}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(70px,1fr) repeat(${maxG}, 40px)` }}>
        <div className="text-[10px] font-bold text-muted-foreground uppercase py-0.5">Player</div>
        {Array.from({length: maxG}, (_, i) => <div key={i} className="text-[10px] text-center font-mono text-muted-foreground py-0.5 font-bold">G{i+1}</div>)}
        <div className="text-xs font-semibold py-1 truncate self-center">{p1Name}</div>
        {Array.from({length: maxG}, (_, i) => {
          const gn = i + 1, s = games.find(g => g.game_number === gn), w = s ? s.score1 > s.score2 : false
          return <input key={gn} type="number" min={0} max={99} value={local[gn]?.s1 ?? ''} onChange={e => setLocal(p => ({...p, [gn]: {...(p[gn] ?? {s1:'',s2:''}), s1: e.target.value}}))} disabled={saving}
            className={cn('w-full text-center text-xs font-bold py-1 rounded border focus:outline-none focus:ring-1 focus:ring-orange-500/40 [appearance:textfield]', w && s ? 'border-emerald-400/50 bg-emerald-50/60 text-emerald-700' : 'border-border bg-background')} />
        })}
        <div className="text-xs font-semibold py-1 truncate self-center">{p2Name}</div>
        {Array.from({length: maxG}, (_, i) => {
          const gn = i + 1, s = games.find(g => g.game_number === gn), w = s ? s.score2 > s.score1 : false
          return <input key={gn} type="number" min={0} max={99} value={local[gn]?.s2 ?? ''} onChange={e => setLocal(p => ({...p, [gn]: {...(p[gn] ?? {s1:'',s2:''}), s2: e.target.value}}))} disabled={saving}
            className={cn('w-full text-center text-xs font-bold py-1 rounded border focus:outline-none focus:ring-1 focus:ring-orange-500/40 [appearance:textfield]', w && s ? 'border-emerald-400/50 bg-emerald-50/60 text-emerald-700' : 'border-border bg-background')} />
        })}
      </div>
      <button onClick={handleSave} disabled={saving}
        className="self-start px-3 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1">
        {saving ? '…' : <Check className="h-3 w-3" />} {saving ? 'Saving' : 'Save'}
      </button>
    </div>
  )
}
