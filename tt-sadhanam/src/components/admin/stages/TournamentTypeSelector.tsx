'use client'

/**
 * TournamentTypeSelector
 *
 * Three mutually-exclusive cards for choosing the tournament format.
 * Calls setFormatType() immediately on click — no confirm needed because
 * the action is guarded server-side (locked once bracket activity starts).
 *
 * Disabled rules (mirrored from setFormatType server action):
 *   - Locked if bracket_generated || stage1_complete || stage2_bracket_generated
 */

import { useTransition } from 'react'
import { Swords, Users, Layers, Lock, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tournament } from '@/lib/types'
import { setFormatType } from '@/lib/actions/stages'
import { toast } from '@/components/ui/toaster'

type FormatType = 'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout'

const OPTIONS: Array<{
  value:       FormatType
  icon:        React.ReactNode
  label:       string
  description: string
  badge?:      string
}> = [
  {
    value:       'single_knockout',
    icon:        <Swords className="h-5 w-5" />,
    label:       'Single Knockout',
    description: 'All players enter a direct elimination bracket. Fastest format.',
  },
  {
    value:       'single_round_robin',
    icon:        <Users className="h-5 w-5" />,
    label:       'Round Robin',
    description: 'Everyone plays everyone in a group. Fair, but longer.',
  },
  {
    value:       'multi_rr_to_knockout',
    icon:        <Layers className="h-5 w-5" />,
    label:       'Groups → Knockout',
    description: 'Group stage first, then top players advance to a bracket.',
    badge:       'Recommended',
  },
]

interface Props {
  tournament:    Tournament
  /** Called after a successful format-type change so parent can refresh */
  onChanged?:   () => void
}

export function TournamentTypeSelector({ tournament }: Props) {
  const [isPending, startTransition] = useTransition()

  const current = tournament.format_type ?? 'single_knockout'
  const isLocked =
    tournament.bracket_generated ||
    tournament.stage1_complete ||
    tournament.stage2_bracket_generated

  const handleSelect = (value: FormatType) => {
    if (value === current || isLocked || isPending) return
    startTransition(async () => {
      const result = await setFormatType(tournament.id, value)
      if (result?.error) {
        toast({ title: 'Could not change format', description: result.error, variant: 'destructive' })
      } else {
        const labels: Record<FormatType, string> = {
          single_knockout:      'Single Knockout',
          single_round_robin:   'Round Robin',
          multi_rr_to_knockout: 'Groups → Knockout',
        }
        toast({ title: `Format set to ${labels[value]}` })
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Tournament Type
        </span>
        {isLocked && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map(opt => {
          const isActive  = current === opt.value
          const disabled  = isLocked && !isActive
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              disabled={disabled || isPending}
              className={cn(
                'relative flex flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && !disabled && [
                  'border-orange-500 bg-orange-50 dark:bg-orange-950/30',
                  'shadow-sm shadow-orange-200 dark:shadow-orange-900/20',
                ],
                !isActive && !disabled && [
                  'border-border bg-card hover:border-orange-300 dark:hover:border-orange-700',
                  'hover:bg-orange-50/40 dark:hover:bg-orange-950/10 cursor-pointer',
                ],
                disabled && 'border-border/40 bg-muted/20 opacity-50 cursor-not-allowed',
                isPending && 'opacity-70',
              )}
            >
              {/* Badge */}
              {opt.badge && (
                <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300 px-1.5 py-0.5 rounded-full">
                  {opt.badge}
                </span>
              )}

              {/* Icon + label */}
              <div className={cn(
                'flex items-center gap-2 font-semibold text-sm',
                isActive ? 'text-orange-600 dark:text-orange-400' : 'text-foreground',
              )}>
                {opt.icon}
                {opt.label}
                {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-60" />}
              </div>

              <p className="text-xs text-muted-foreground leading-snug pr-6">
                {opt.description}
              </p>
            </button>
          )
        })}
      </div>

      {isLocked && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Tournament type is locked after bracket activity begins. Reset all stages to change it.
        </p>
      )}
    </div>
  )
}
