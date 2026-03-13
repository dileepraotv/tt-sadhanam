'use client'

/**
 * DoubleEliminationStage
 *
 * Admin stage panel for format_type = 'double_elimination'.
 *
 * State machine:
 *   NO_BRACKET   → Generate Bracket button
 *   HAS_BRACKET  → WB + LB + GF bracket display (uses DoubleEliminationView)
 */

import { useTransition, useState } from 'react'
import { GitBranch, RefreshCw, Shield, Trophy } from 'lucide-react'
import type { Tournament, Player, Match } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { NextStepBanner } from './NextStepBanner'
import { toast } from '@/components/ui/toaster'
import { useLoading } from '@/components/shared/GlobalLoader'
import { generateDEBracket, resetDEBracket } from '@/lib/actions/doubleElimination'
import { DoubleEliminationView } from '@/components/brackets/DoubleEliminationView'
import { nextPowerOf2 } from '@/lib/utils'

interface Props {
  tournament: Tournament
  players:    Player[]
  matches:    Match[]
  matchBase:  string
}

export function DoubleEliminationStage({ tournament, players, matches, matchBase }: Props) {
  const [isPending, startTransition] = useTransition()
  const { setLoading }               = useLoading()
  const [showReset, setShowReset]    = useState(false)

  const isGenerated = tournament.bracket_generated
  const wbMatches   = matches.filter(m => m.bracket_side === 'winners')
  const lbMatches   = matches.filter(m => m.bracket_side === 'losers')
  const gfMatches   = matches.filter(m => m.bracket_side === 'grand_final')
  // Detect schema missing bracket_side (all null) — migration not yet run
  const bracketSideMissing = isGenerated && matches.length > 0 && wbMatches.length === 0 && lbMatches.length === 0 && gfMatches.length === 0
  const hasScores   = matches.some(m => m.status === 'complete' || m.status === 'live')

  const bracketSize  = nextPowerOf2(players.length)
  const wbRounds     = Math.log2(bracketSize)
  const totalDE      = wbMatches.length + lbMatches.length + gfMatches.length
  const doneCount    = matches.filter(m => m.status === 'complete').length

  const handleGenerate = () => {
    setLoading(true)
    startTransition(async () => {
      const result = await generateDEBracket(tournament.id)
      setLoading(false)
      if (result.error) {
        toast({ title: 'Generation failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `✅ Double elimination bracket generated — ${result.totalMatches} matches` })
      }
    })
  }

  const handleReset = () => {
    setLoading(true)
    setShowReset(false)
    startTransition(async () => {
      const result = await resetDEBracket(tournament.id)
      setLoading(false)
      if (result.error) {
        toast({ title: 'Reset failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Bracket reset' })
      }
    })
  }

  // ── NOT GENERATED YET ──────────────────────────────────────────────────────
  if (!isGenerated) {
    return (
      <div className="flex flex-col gap-6">
        {players.length < 2 ? (
          <NextStepBanner
            variant="warning"
            title="Add players first"
            description="Add at least 2 players before generating the bracket."
          />
        ) : (
          <>
            <NextStepBanner
              variant="action"
              step="Step 1"
              title="Generate double elimination bracket"
              description={`${players.length} players → bracket size ${bracketSize} (${wbRounds} WB rounds + Losers Bracket + Grand Final).`}
            />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-orange-500" />
                  Double Elimination Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center mb-6">
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-foreground">{players.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">Players</p>
                  </div>
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-orange-500">{bracketSize}</p>
                    <p className="text-xs text-muted-foreground mt-1">Bracket Size</p>
                  </div>
                  <div className="bg-muted/30 rounded-xl p-4">
                    <p className="text-2xl font-bold text-foreground">{wbRounds}</p>
                    <p className="text-xs text-muted-foreground mt-1">WB Rounds</p>
                  </div>
                </div>
                <div className="bg-muted/20 rounded-lg p-3 mb-4 text-xs text-muted-foreground flex flex-col gap-1">
                  <p>• <span className="font-semibold text-foreground">Winners Bracket</span> — seeded draw, same as single KO</p>
                  <p>• <span className="font-semibold text-foreground">Losers Bracket</span> — WB losers enter; 2 losses = eliminated</p>
                  <p>• <span className="font-semibold text-foreground">Grand Final</span> — WB champion vs LB champion (optional bracket reset)</p>
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={isPending || players.length < 2}
                  className="w-full gap-2"
                >
                  {isPending
                    ? <><span className="tt-spinner tt-spinner-sm" /> Generating…</>
                    : <><GitBranch className="h-4 w-4" /> Generate DE Bracket</>
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
      {/* Migration warning: bracket_side column missing from DB */}
      {bracketSideMissing && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50 px-4 py-3 flex gap-3 items-start">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Database migration required</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              The <code className="font-mono bg-amber-100 dark:bg-amber-800/40 px-1 rounded">bracket_side</code> column is missing.
              Run <strong>schema-migration-v6-team-ko.sql</strong> on your Supabase database, then reset and regenerate this bracket.
            </p>
          </div>
        </div>
      )}
      {/* Progress */}
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">Bracket Progress</span>
            <span className="text-xs text-muted-foreground">
              {doneCount}/{totalDE} complete
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-500"
              style={{ width: totalDE ? `${(doneCount / totalDE) * 100}%` : '0%' }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bracket view */}
      <DoubleEliminationView
        wbMatches={wbMatches}
        lbMatches={lbMatches}
        gfMatches={gfMatches}
        isAdmin
        matchBasePath={matchBase}
      />

      {/* Reset */}
      {!showReset ? (
        <button
          onClick={() => setShowReset(true)}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors mt-2 self-start"
        >
          Reset bracket…
        </button>
      ) : (
        <Card className="border-destructive/40">
          <CardContent className="p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-destructive">
              {hasScores
                ? '⚠️ This will delete all match scores. Are you sure?'
                : 'Reset the entire DE bracket?'}
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
