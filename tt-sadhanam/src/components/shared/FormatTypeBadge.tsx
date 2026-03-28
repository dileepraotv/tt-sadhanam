/**
 * FormatTypeBadge — canonical, single-source format type badge.
 *
 * Replaces the 4 separate inline implementations that existed in:
 *   - admin/championships/[cid]/events/[eid]/page.tsx   (FormatTypeBadge)
 *   - admin/championships/[cid]/page.tsx                (FormatTypeLabel)
 *   - admin/tournaments/[id]/page.tsx                   (FormatTypeBadge)
 *   - championships/[cid]/page.tsx                      (FormatTypeBadge)
 *
 * Standardized labels — one authoritative string per format:
 *   single_knockout         → Singles · Knockout
 *   single_round_robin      → Singles · RR + Knockout
 *   multi_rr_to_knockout    → Singles · RR + Knockout
 *   pure_round_robin        → Singles · Round Robin   ← was "League" in some files
 *   double_elimination      → Singles · Double Elim
 *   team_league             → Teams · RR + Knockout
 *   team_league_ko          → Teams · Corbillon KO
 *   team_league_swaythling  → Teams · Swaythling KO
 *   team_group_corbillon     → Teams · Corbillon Groups
 *   team_group_swaythling    → Teams · Swaythling Groups
 *
 * Size variants:
 *   'sm'  — text-[10px] px-1.5 py-0.5  (used in dense admin lists)
 *   'md'  — text-xs   px-2   py-0.5    (default — event detail headers)
 */

import { Swords, Users, Layers, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FormatTypeBadgeProps {
  formatType: string | null | undefined
  size?: 'sm' | 'md'
  className?: string
}

interface BadgeConfig {
  label:   string
  color:   string    // Tailwind color classes (text + bg + border)
  Icon:    React.ElementType
}

const FORMAT_MAP: Record<string, BadgeConfig> = {
  single_knockout: {
    label: 'Singles · Knockout',
    color: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60',
    Icon:  Swords,
  },
  single_round_robin: {
    label: 'Singles · RR + Knockout',
    color: 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800/60',
    Icon:  Users,
  },
  multi_rr_to_knockout: {
    label: 'Singles · RR + Knockout',
    color: 'text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/60',
    Icon:  Layers,
  },
  pure_round_robin: {
    label: 'Singles · Round Robin',
    color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800/60',
    Icon:  Users,
  },
  double_elimination: {
    label: 'Singles · Double Elim',
    color: 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800/60',
    Icon:  Layers,
  },
  team_league: {
    label: 'Teams · RR + Knockout',
    color: 'text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800/60',
    Icon:  Shield,
  },
  team_league_ko: {
    label: 'Teams · Corbillon KO',
    color: 'text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800/60',
    Icon:  Swords,
  },
  team_league_swaythling: {
    label: 'Teams · Swaythling KO',
    color: 'text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800/60',
    Icon:  Swords,
  },
  team_group_corbillon: {
    label: 'Teams · Corbillon Groups',
    color: 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800/60',
    Icon:  Layers,
  },
  team_group_swaythling: {
    label: 'Teams · Swaythling Groups',
    color: 'text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-900/30 border-teal-200 dark:border-teal-800/60',
    Icon:  Layers,
  },
}

const FALLBACK: BadgeConfig = {
  label: 'Unknown Format',
  color: 'text-muted-foreground bg-muted border-border',
  Icon:  Layers,
}

export function FormatTypeBadge({
  formatType,
  size = 'md',
  className,
}: FormatTypeBadgeProps) {
  const cfg = formatType ? (FORMAT_MAP[formatType] ?? FALLBACK) : FORMAT_MAP['single_knockout']
  const { label, color, Icon } = cfg

  const textSize   = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const padding    = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
  const iconSize   = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold rounded-full border',
        textSize,
        padding,
        color,
        className,
      )}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  )
}

/**
 * Helper: return just the human-readable label string for a format type.
 * Useful in <title>, aria-label, and plain-text contexts.
 */
export function formatTypeLabel(formatType: string | null | undefined): string {
  if (!formatType) return FORMAT_MAP['single_knockout'].label
  return (FORMAT_MAP[formatType] ?? FALLBACK).label
}
