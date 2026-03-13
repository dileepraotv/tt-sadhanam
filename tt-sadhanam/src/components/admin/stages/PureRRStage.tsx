'use client'

/**
 * PureRRStage
 *
 * Admin stage panel for format_type = 'pure_round_robin'.
 *
 * State machine:
 *   NO_SCHEDULE  → Generate Schedule button
 *   HAS_SCHEDULE → Standings table + match list by matchday
 */

import { useTransition, useState, useMemo } from 'react'
import { RotateCcw, RefreshCw, Trophy, ChevronDown, ChevronRight } from 'lucide-react'
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
        {matchdays.map(({ round, matches: rMatches }) => {
          const isOpen   = openRounds.has(round)
          const liveMd   = rMatches.filter(m => m.status === 'live').length
          const doneMd   = rMatches.filter(m => m.status === 'complete').length
          const totalMd  = rMatches.filter(m => m.status !== 'bye').length
          const allDone  = doneMd === totalMd && totalMd > 0

          return (
            <Card key={round} className={cn('overflow-hidden', allDone && 'opacity-80 bg-muted/10')}>
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
                    <MatchCard
                      key={m.id}
                      match={m}
                      isAdmin
                      href={`${matchBase}/${m.id}`}
                      compact
                    />
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
