'use client'

/**
 * DoubleEliminationView
 *
 * Uses the same round-tab + vertical-list pattern as singles KO (BracketView).
 * Tabs across the top: WB rounds, then LB rounds, then Grand Final.
 * Each tab shows a vertical list of full MatchCards with inline scorer in admin mode.
 *
 * match_number encoding:
 *   WB: as-is (1-based)
 *   LB: +10000
 *   GF: +20000
 */

import { useState } from 'react'
import { Trophy, Shield, GitBranch, Swords } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Match } from '@/lib/types'
import { MatchCard } from '@/components/bracket/MatchCard'
import { SingleMatchInlineScorer } from '@/components/bracket/BracketView'

interface Props {
  wbMatches:      Match[]
  lbMatches:      Match[]
  gfMatches:      Match[]
  isAdmin?:       boolean
  matchBasePath?: string
  onMatchClick?:  (match: Match) => void
}

type TabId = string  // e.g. 'wb-1', 'lb-1', 'gf'

function groupByRound(matches: Match[]): Map<number, Match[]> {
  const map = new Map<number, Match[]>()
  for (const m of matches) {
    if (!map.has(m.round)) map.set(m.round, [])
    map.get(m.round)!.push(m)
  }
  return map
}

export function DoubleEliminationView({
  wbMatches,
  lbMatches,
  gfMatches,
  isAdmin,
  matchBasePath,
  onMatchClick,
}: Props) {
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)

  const wbByRound = groupByRound(wbMatches.filter(m => m.status !== 'bye'))
  const lbByRound = groupByRound(lbMatches.filter(m => m.status !== 'bye'))

  const wbRounds = Array.from(wbByRound.keys()).sort((a, b) => a - b)
  const lbRounds = Array.from(lbByRound.keys()).sort((a, b) => a - b)

  // Build flat tab list
  interface Tab { id: TabId; label: string; matches: Match[]; section: 'wb' | 'lb' | 'gf' }
  const tabs: Tab[] = [
    ...wbRounds.map((r, ri) => {
      const ms     = wbByRound.get(r) ?? []
      const total  = wbRounds.length
      const label  = total === 1 ? 'WB Final'
                   : ri === total - 1 ? 'WB Final'
                   : ri === total - 2 ? 'WB Semi-Finals'
                   : `WB Round ${r}`
      return { id: `wb-${r}` as TabId, label, matches: ms, section: 'wb' as const }
    }),
    ...lbRounds.map((r, ri) => {
      const ms     = lbByRound.get(r) ?? []
      const total  = lbRounds.length
      const label  = ri === total - 1 ? 'LB Final' : `LB Round ${r}`
      return { id: `lb-${r}` as TabId, label, matches: ms, section: 'lb' as const }
    }),
    ...(gfMatches.length > 0
      ? [{ id: 'gf' as TabId, label: 'Grand Final', matches: gfMatches, section: 'gf' as const }]
      : []),
  ]

  // Auto-select: first live tab, else first incomplete, else last
  const firstLive = tabs.find(t => t.matches.some(m => m.status === 'live'))
  const firstIncomplete = tabs.find(t => t.matches.some(m => m.status === 'pending'))
  const defaultTab = (firstLive ?? firstIncomplete ?? tabs[tabs.length - 1])?.id ?? tabs[0]?.id
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab)

  if (tabs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Double-elimination bracket not generated yet.
      </div>
    )
  }

  const currentTab = tabs.find(t => t.id === activeTab) ?? tabs[0]

  // Overall champion
  const gf1 = gfMatches.find(m => m.bracket_side === 'grand_final' && m.match_number === 20001)
    ?? gfMatches.find(m => m.bracket_side === 'grand_final')
  const gf2 = gfMatches.find(m => m.bracket_side === 'grand_final' && m.match_number === 20002)
  const isResetNeeded = gf1?.status === 'complete' && gf1?.winner_id === gf1?.player2_id
  const champion = gf2?.status === 'complete' ? gf2.winner
    : gf1?.status === 'complete' && !isResetNeeded ? gf1.winner
    : null

  const toggleExpand = (id: string) =>
    setExpandedMatchId(prev => prev === id ? null : id)

  const renderCard = (m: Match) => {
    const base       = matchBasePath ?? `/admin/tournaments/${m.tournament_id}/match`
    const isExpanded = expandedMatchId === m.id
    const isBye      = m.status === 'bye'
    const isComplete = m.status === 'complete'

    if (isAdmin && !isBye && !onMatchClick) {
      return (
        <div key={m.id} className="flex flex-col">
          <div className="relative">
            <MatchCard match={m} isAdmin={isAdmin} />
            <button
              onClick={() => toggleExpand(m.id)}
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
                onSaved={() => toggleExpand(m.id)}
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
        onClick={onMatchClick ? () => onMatchClick(m) : undefined}
        href={isAdmin ? `${base}/${m.id}` : undefined}
      />
    )
  }

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

      {/* Round tabs — same style as BracketView */}
      <div
        className="flex items-end gap-1 overflow-x-auto scrollbar-hide border-b-2"
        style={{ borderColor: '#F06321' }}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.id
          const liveCount = tab.matches.filter(m => m.status === 'live').length
          const doneCount = tab.matches.filter(m => m.status === 'complete').length
          const sectionIcon =
            tab.section === 'wb' ? <Trophy className="h-3 w-3" /> :
            tab.section === 'lb' ? <Shield className="h-3 w-3" /> :
            <Swords className="h-3 w-3" />

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={isActive
                ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                : undefined}
              className={cn(
                'shrink-0 flex items-center gap-1.5 px-3 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
                !isActive ? 'text-muted-foreground hover:text-foreground border-2 border-b-0 border-transparent' : '',
              )}
            >
              {sectionIcon}
              {tab.label}
              {liveCount > 0 && <span className="live-dot ml-0.5" />}
              <span className={cn(
                'text-[10px] font-mono ml-0.5',
                isActive ? 'text-white/80' : 'text-muted-foreground',
              )}>
                {doneCount}/{tab.matches.filter(m => m.status !== 'bye').length}
              </span>
            </button>
          )
        })}
      </div>

      {/* Current round matches — vertical list, same as singles KO */}
      {currentTab && (
        <div className="flex flex-col gap-3 animate-fade-in">
          {/* Live indicator */}
          {currentTab.matches.some(m => m.status === 'live') && (
            <div className="flex items-center gap-1.5">
              <span className="live-dot" />
              <span className="text-xs font-bold uppercase tracking-widest text-orange-500">
                {currentTab.matches.filter(m => m.status === 'live').length} on court
              </span>
            </div>
          )}

          {/* Grand Final bracket-reset note */}
          {currentTab.section === 'gf' && (
            <p className="text-xs text-muted-foreground px-1">
              WB champion enters as Player 1 · LB champion enters as Player 2
              {isResetNeeded && ' · Bracket reset required (LB champion won)'}
            </p>
          )}

          {/* Sorted: live → pending → complete */}
          {[...currentTab.matches]
            .filter(m => m.status !== 'bye')
            .sort((a, b) => {
              const o = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
              return o(a.status) - o(b.status)
            })
            .map(m => renderCard(m))
          }
        </div>
      )}
    </div>
  )
}

// Re-export SingleMatchInlineScorer so DoubleEliminationView can use it without circular imports
// (it's already exported from BracketView)
export { }
