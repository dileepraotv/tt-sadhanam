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

import { useState, useMemo } from 'react'
import { Trophy, Shield, GitBranch, Swords } from 'lucide-react'
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
                  <MatchCard
                    key={match.id}
                    match={match}
                    compact
                    isAdmin={isAdmin}
                    href={matchBasePath ? `${matchBasePath}/${match.id}` : undefined}
                    onClick={onMatchClick ? () => onMatchClick(match) : undefined}
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
          <MatchCard
            match={gf1}
            isAdmin={isAdmin}
            href={matchBasePath ? `${matchBasePath}/${gf1.id}` : undefined}
            onClick={onMatchClick ? () => onMatchClick(gf1) : undefined}
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
            <MatchCard
              match={gf2}
              isAdmin={isAdmin}
              href={matchBasePath ? `${matchBasePath}/${gf2.id}` : undefined}
              onClick={onMatchClick ? () => onMatchClick(gf2) : undefined}
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
