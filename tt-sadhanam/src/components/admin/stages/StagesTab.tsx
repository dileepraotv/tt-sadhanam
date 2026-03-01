'use client'

/**
 * StagesTab
 *
 * Routes to the correct stage-management component based on format_type.
 *
 * format_type === 'single_knockout'      → SingleKOStage
 * format_type === 'single_round_robin'   → SingleRRStage
 * format_type === 'multi_rr_to_knockout' → MultiStagePanel
 * undefined / null                       → prompts user to pick a type in Setup
 *
 * This component is intentionally thin — it just dispatches.
 * All state and server action calls live in the individual stage components.
 */

import { Layers } from 'lucide-react'
import type { Tournament, Player, Match, Stage } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'
import { SingleKOStage }    from './SingleKOStage'
import { SingleRRStage }    from './SingleRRStage'
import { MultiStagePanel }  from './MultiStagePanel'

interface Props {
  tournament:  Tournament
  players:     Player[]
  matches:     Match[]           // all matches (both RR and KO)
  rrStage:     Stage | null
  koStage:     Stage | null
  rrStandings: GroupStandings[]
  hasScores:   boolean
  allComplete: boolean
  matchBase:   string            // URL base for scoring links
}

export function StagesTab({
  tournament, players, matches,
  rrStage, koStage, rrStandings,
  hasScores, allComplete, matchBase,
}: Props) {
  const ft = tournament.format_type

  // Partition for components that need splits
  const rrMatches = matches.filter(m => m.match_kind === 'round_robin')
  const koMatches = matches.filter(m => m.match_kind === 'knockout' || !m.match_kind)

  // ── 1. Not configured yet ─────────────────────────────────────────────────
  if (!ft || ft === 'single_knockout') {
    // single_knockout is the default — show the KO stage
    return (
      <SingleKOStage
        tournament={tournament}
        players={players}
        matches={koMatches}
        matchBase={matchBase}
      />
    )
  }

  // ── 2. Single Round Robin ─────────────────────────────────────────────────
  if (ft === 'single_round_robin') {
    return (
      <SingleRRStage
        tournament={tournament}
        players={players}
        stage={rrStage}
        standings={rrStandings}
        rrMatches={rrMatches}
        hasScores={hasScores}
        allComplete={allComplete}
        matchBase={matchBase}
      />
    )
  }

  // ── 3. Multi-stage RR → KO ────────────────────────────────────────────────
  if (ft === 'multi_rr_to_knockout') {
    return (
      <MultiStagePanel
        tournament={tournament}
        players={players}
        rrStage={rrStage}
        koStage={koStage}
        rrStandings={rrStandings}
        rrMatches={rrMatches}
        koMatches={koMatches}
        hasScores={hasScores}
        allComplete={allComplete}
        matchBase={matchBase}
      />
    )
  }

  // ── Fallback (should never reach here) ────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <Layers className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-muted-foreground font-medium">Select a tournament type in the Setup tab.</p>
    </div>
  )
}
