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

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Tournament, Player, Match, Stage } from '@/lib/types'
import type { GroupStandings } from '@/lib/roundrobin/types'
import { SingleKOStage }          from './SingleKOStage'
import { BracketView } from '@/components/bracket/BracketView'
import { SingleRRStage }          from './SingleRRStage'
import { MultiStagePanel }        from './MultiStagePanel'
import { PureRRStage }            from './PureRRStage'
import { DoubleEliminationStage } from './DoubleEliminationStage'
import { TeamLeagueStage }        from './TeamLeagueStage'
import { TeamGroupKOStage }       from './TeamGroupKOStage'

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
  const router  = useRouter()
  const supabase = createClient()

  // ── Realtime: refresh page when any match or game in this tournament changes ──
  // This ensures both admin users see the same data at all times.
  useEffect(() => {
    const channel = supabase
      .channel(`admin-stages-${tournament.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` },
        () => { router.refresh() },
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        () => { router.refresh() },
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'rr_group_members' },
        () => { router.refresh() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournament.id])

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
    // After group stage closes, show KO bracket below the locked group stage
    if (tournament.stage1_complete) {
      return (
        <div className="flex flex-col gap-6">
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
          <div className="border-t border-border/60 pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Knockout Stage</p>
            <SingleKOStage
              tournament={tournament}
              players={players}
              matches={koMatches}
              matchBase={matchBase}
            />
          </div>
        </div>
      )
    }
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

  // ── 4. Pure Round Robin ───────────────────────────────────────────────────
  if (ft === 'pure_round_robin') {
    const allGames = matches.flatMap(m => m.games ?? [])
    return (
      <PureRRStage
        tournament={tournament}
        players={players}
        matches={matches}
        games={allGames}
        matchBase={matchBase}
      />
    )
  }

  // ── 5. Double Elimination ─────────────────────────────────────────────────
  if (ft === 'double_elimination') {
    return (
      <DoubleEliminationStage
        tournament={tournament}
        players={players}
        matches={matches}
        matchBase={matchBase}
      />
    )
  }

  // ── 6. Team League (RR+KO) ────────────────────────────────────────────────
  if (ft === 'team_league') {
    return (
      <TeamLeagueStage
        tournament={tournament}
        matchBase={matchBase}
        view="teams"
      />
    )
  }

  // ── 7. Team League KO (Corbillon Cup) ─────────────────────────────────────
  if (ft === 'team_league_ko') {
    return (
      <TeamLeagueStage
        tournament={tournament}
        matchBase={matchBase}
        view="teams"
        showSeedInput={true}
      />
    )
  }

  // ── 8. Team League Swaythling Cup ─────────────────────────────────────────
  if (ft === 'team_league_swaythling') {
    return (
      <TeamLeagueStage
        tournament={tournament}
        matchBase={matchBase}
        view="teams"
        showSeedInput={true}
      />
    )
  }

  // ── 9. Teams - Groups + Knockout (Corbillon Cup) ───────────────────────────
  if (ft === 'team_group_corbillon') {
    return (
      <TeamGroupKOStage
        tournament={tournament}
        matchBase={matchBase}
      />
    )
  }

  // ── 10. Teams - Groups + Knockout (Swaythling Cup) ────────────────────────
  if (ft === 'team_group_swaythling') {
    return (
      <TeamGroupKOStage
        tournament={tournament}
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
