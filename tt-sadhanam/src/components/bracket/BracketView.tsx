'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getRoundTab } from '@/lib/utils'
import type { Match, Game } from '@/lib/types'
import { MatchCard } from './MatchCard'

interface BracketViewProps {
  tournament:    { id: string; name: string }
  matches:       Match[]
  isAdmin?:      boolean
  matchBasePath?: string   // override match href base, e.g. /admin/championships/cid/events/eid/match
  onMatchClick?: (match: Match) => void
}

export function BracketView({ tournament, matches, isAdmin, matchBasePath, onMatchClick }: BracketViewProps) {
  const latestRound = useMemo(() => {
    const live = matches.find(m => m.status === 'live')?.round
    if (live) return live
    const done = matches.filter(m => m.status === 'complete').map(m => m.round)
    if (done.length) return Math.max(...done)
    return 1
  }, [matches])

  const [activeRound, setActiveRound] = useState<number | null>(null)

  if (!matches.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <div className="text-5xl mb-3">🏓</div>
        <p className="text-lg font-bold text-foreground">Bracket not generated yet</p>
        {isAdmin && <p className="text-sm mt-1 text-muted-foreground">Add players and generate the draw</p>}
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
    <div className="flex flex-col gap-4">

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
          Full Draw
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
const CARD_W = 290   // px — wide enough for typical names
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
                          onClick={onMatchClick ? () => onMatchClick(match) : undefined}
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
function DrawCard({ match, onClick }: { match: Match; onClick?: () => void }) {
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

  return (
    <Wrapper
      onClick={onClick}
      className={`w-full text-left block rounded-lg overflow-hidden transition-all duration-150 border-[1.5px] ${cardClass}`}
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
        <span
          className="shrink-0 text-amber-500 text-xs leading-none"
          style={{ width: 16, textAlign: 'center', opacity: isWinner ? 1 : 0 }}
          aria-hidden={!isWinner}
        >🏆</span>

        {/* Seed pill */}
        {player?.seed && (
          <span className="seed-badge shrink-0 text-[11px]">{player.seed}</span>
        )}

        {/* Name */}
        <span className={cn(
          'text-[11px] sm:text-[15px] overflow-hidden text-ellipsis whitespace-nowrap leading-tight',
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
function RoundList({ round, isAdmin, matchBasePath, onMatchClick }: {
  round:          RoundGroup
  isAdmin?:       boolean
  matchBasePath?: string
  onMatchClick?:  (match: Match) => void
}) {
  if (!round) return null

  const live      = round.matches.filter(m => m.status === 'live')
  const pending   = round.matches.filter(m => m.status === 'pending')
  const completed = round.matches.filter(m => m.status === 'complete' || m.status === 'bye')

  const card = (m: Match) => {
    const base = matchBasePath ?? `/admin/tournaments/${m.tournament_id}/match`
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
    <div className="flex flex-col gap-3 animate-fade-in">

      {live.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-orange-600 dark:text-orange-400">
            <span className="live-dot" /> On Court
          </p>
          {live.map(card)}
        </section>
      )}

      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          {live.length > 0 && (
            <p className="text-xs font-bold tracking-widest uppercase mt-2 text-muted-foreground">
              Upcoming
            </p>
          )}
          {pending.map(card)}
        </section>
      )}

      {completed.length > 0 && (
        <section className="flex flex-col gap-2 mt-1">
          <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Completed
          </p>
          {completed.map(card)}
        </section>
      )}

    </div>
  )
}
