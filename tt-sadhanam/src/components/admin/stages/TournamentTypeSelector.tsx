'use client'

/**
 * TournamentTypeSelector
 *
 * Six mutually-exclusive format cards in two groups: Single Stage / Multi Stage.
 * Calls setFormatType() immediately on click — guarded server-side once any
 * bracket activity has started.
 */

import { useTransition } from 'react'
import {
  Swords, Users, Layers, Lock, ChevronRight,
  RotateCcw, Shield, GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tournament, TournamentFormatType } from '@/lib/types'
import { setFormatType } from '@/lib/actions/stages'
import { toast } from '@/components/ui/toaster'
import { useLoading } from '@/components/shared/GlobalLoader'

type FmtOption = {
  value:       TournamentFormatType
  icon:        React.ReactNode
  label:       string
  description: string
  badge?:      string
}

const SINGLE_OPTIONS: FmtOption[] = [
  {
    value: 'single_knockout',
    icon:  <Swords className="h-4 w-4" />,
    label: 'Singles - Knockout',
    description: "Direct elimination bracket. One loss and you're out. Fast and decisive.",
  },
  {
    value: 'pure_round_robin',
    icon:  <RotateCcw className="h-4 w-4" />,
    label: 'Singles - Round Robin',
    description: 'Every player faces every other player once. Final standings decide the winner.',
  },
  {
    value: 'double_elimination',
    icon:  <GitBranch className="h-4 w-4" />,
    label: 'Singles - Double Elimination',
    description: 'Two losses required to exit. Winners and Losers brackets run in parallel.',
  },
  {
    value: 'team_league_ko',
    icon:  <Shield className="h-4 w-4" />,
    label: 'Teams - Knockout (Corbillon Cup)',
    description: '4 singles + 1 doubles per tie. A vs X, B vs Y, Doubles, A vs Y, B vs X. Each team needs 2 players.',
  },
  {
    value: 'team_league_swaythling',
    icon:  <Shield className="h-4 w-4" />,
    label: 'Teams - Knockout (Swaythling Cup)',
    description: '5 singles per tie, no doubles. A vs X, B vs Y, C vs Z, A vs Y, B vs X. Each team needs 3 players.',
  },
]

const MULTI_OPTIONS: FmtOption[] = [
  {
    value: 'single_round_robin',
    icon:  <Users className="h-4 w-4" />,
    label: 'Singles - Round Robin + Knockout',
    description: 'Players seeded into round-robin groups. Top finishers from each group advance to a knockout bracket.',
  },
  {
    value: 'multi_rr_to_knockout',
    icon:  <Layers className="h-4 w-4" />,
    label: 'Singles - Round Robin + Knockout',
    description: 'Top N players ranked across all groups advance to a single-elimination knockout bracket.',
  },
  {
    value: 'team_group_corbillon',
    icon:  <Shield className="h-4 w-4" />,
    label: 'Teams - Groups + Knockout (Corbillon Cup)',
    description: 'Teams in groups; each tie is 4 singles + 1 doubles. Top 2 per group advance to Corbillon Cup knockout.',
  },
  {
    value: 'team_group_swaythling',
    icon:  <Shield className="h-4 w-4" />,
    label: 'Teams - Groups + Knockout (Swaythling Cup)',
    description: 'Teams in groups; each tie is 5 singles, no doubles. Top 2 per group advance to Swaythling Cup knockout.',
  },
]

const FORMAT_LABELS: Record<TournamentFormatType, string> = {
  single_knockout:        'Singles - Knockout',
  pure_round_robin:       'Singles - Round Robin',
  double_elimination:     'Singles - Double Elimination',
  team_league:            'Teams - Round Robin + Knockout',
  team_league_ko:       'Teams - Knockout (Corbillon Cup)',
  team_league_swaythling: 'Teams - Knockout (Swaythling Cup)',
  team_group_corbillon:   'Teams - Groups + KO (Corbillon)',
  team_group_swaythling:  'Teams - Groups + KO (Swaythling)',
  single_round_robin:     'Singles - Round Robin + Knockout',
  multi_rr_to_knockout:   'Singles - Round Robin + Knockout',
}

interface Props { tournament: Tournament }

function FormatBtn({
  opt, isActive, disabled, isPending, onClick,
}: {
  opt: FmtOption; isActive: boolean; disabled: boolean; isPending: boolean; onClick: () => void
}) {
  const isSingles = opt.label.startsWith('Singles')
  const singlesActiveColor = 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-sm shadow-blue-200 dark:shadow-blue-900/20'
  const singlesInactiveColor = 'border-border bg-card hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/10'
  const singlesLabelColor = 'text-blue-600 dark:text-blue-400'
  
  const teamsActiveColor = 'border-purple-500 bg-purple-50 dark:bg-purple-950/30 shadow-sm shadow-purple-200 dark:shadow-purple-900/20'
  const teamsInactiveColor = 'border-border bg-card hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50/40 dark:hover:bg-purple-950/10'
  const teamsLabelColor = 'text-purple-600 dark:text-purple-400'
  
  const activeColor = isSingles ? singlesActiveColor : teamsActiveColor
  const inactiveColor = isSingles ? singlesInactiveColor : teamsInactiveColor
  const labelColor = isSingles ? singlesLabelColor : teamsLabelColor
  
  return (
    <button
      onClick={onClick}
      disabled={disabled || isPending}
      className={cn(
        'relative flex flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive && !disabled && activeColor,
        !isActive && !disabled && inactiveColor,
        disabled && 'border-border/40 bg-muted/20 opacity-50 cursor-not-allowed',
        isPending && 'opacity-70',
      )}
    >
      <div className={cn(
        'flex items-center gap-2 font-semibold text-sm',
        isActive ? labelColor : 'text-foreground',
      )}>
        {opt.icon}
        {opt.label}
        {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-60" />}
      </div>
      <p className="text-xs text-muted-foreground leading-snug pr-6">{opt.description}</p>
    </button>
  )
}

export function TournamentTypeSelector({ tournament }: Props) {
  const [isPending, startTransition] = useTransition()
  const { setLoading } = useLoading()

  const current = (tournament.format_type ?? 'single_knockout') as TournamentFormatType
  const isLocked =
    tournament.bracket_generated ||
    tournament.stage1_complete ||
    tournament.stage2_bracket_generated

  const handleSelect = (value: TournamentFormatType) => {
    if (value === current || isLocked || isPending) return
    setLoading(true)
    startTransition(async () => {
      const result = await setFormatType(tournament.id, value)
      setLoading(false)
      if (result?.error) {
        toast({ title: 'Could not change format', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `Format set to ${FORMAT_LABELS[value]}` })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tournament Type</span>
        {isLocked && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </div>

      <div>
        <p className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-2">Single Stage</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {SINGLE_OPTIONS.map(opt => (
            <FormatBtn key={opt.value} opt={opt}
              isActive={current === opt.value}
              disabled={!!isLocked && current !== opt.value}
              isPending={isPending}
              onClick={() => handleSelect(opt.value)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-2">Multi Stage</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MULTI_OPTIONS.map(opt => (
            <FormatBtn key={opt.value} opt={opt}
              isActive={current === opt.value}
              disabled={!!isLocked && current !== opt.value}
              isPending={isPending}
              onClick={() => handleSelect(opt.value)}
            />
          ))}
        </div>
      </div>

      {isLocked && (
        <p className="text-xs text-muted-foreground">
          Tournament type is locked after bracket activity begins. Reset all stages to change it.
        </p>
      )}
    </div>
  )
}
