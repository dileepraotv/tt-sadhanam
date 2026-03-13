'use client'

import { useState, useRef } from 'react'
import { useLoading } from '@/components/shared/GlobalLoader'
import Link from 'next/link'
import { Swords, Users, Layers, RotateCcw, GitBranch, Shield, Trophy, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type FormatType =
  | 'single_knockout'
  | 'single_round_robin'
  | 'multi_rr_to_knockout'
  | 'pure_round_robin'
  | 'double_elimination'
  | 'team_league_ko'
  | 'team_league_swaythling'
  | 'team_group_corbillon'
  | 'team_group_swaythling'

// ─── Color themes ─────────────────────────────────────────────────────────────
// Every card shows its colour at rest (subtle tint + coloured border).
// On selection the border thickens and the background deepens.

type ColorTheme = {
  base:         string   // idle: subtle tinted bg + coloured border always visible
  hover:        string   // extra hover nudge
  active:       string   // selected state: deeper bg + bold border
  activeText:   string
  badgeBg:      string
  badgeText:    string
  iconColor:    string
  ring:         string
}

const THEMES: Record<FormatType, ColorTheme> = {
  single_knockout:       { base: 'border-red-200 bg-red-50/60 dark:border-red-800/60 dark:bg-red-950/20',                active: 'border-red-500 bg-red-100 dark:border-red-400 dark:bg-red-950/50 shadow-md shadow-red-100 dark:shadow-red-900/20',       hover: 'hover:border-red-400 hover:bg-red-100/80 dark:hover:border-red-600 dark:hover:bg-red-950/30',         activeText: 'text-red-700 dark:text-red-300',      badgeBg: 'bg-red-200 dark:bg-red-900',       badgeText: 'text-red-700 dark:text-red-300',       iconColor: 'text-red-500 dark:text-red-400',      ring: 'focus-visible:ring-red-400' },
  pure_round_robin:      { base: 'border-sky-200 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/20',                active: 'border-sky-500 bg-sky-100 dark:border-sky-400 dark:bg-sky-950/50 shadow-md shadow-sky-100 dark:shadow-sky-900/20',         hover: 'hover:border-sky-400 hover:bg-sky-100/80 dark:hover:border-sky-600 dark:hover:bg-sky-950/30',         activeText: 'text-sky-700 dark:text-sky-300',      badgeBg: 'bg-sky-200 dark:bg-sky-900',       badgeText: 'text-sky-700 dark:text-sky-300',       iconColor: 'text-sky-500 dark:text-sky-400',      ring: 'focus-visible:ring-sky-400' },
  double_elimination:    { base: 'border-violet-200 bg-violet-50/60 dark:border-violet-800/60 dark:bg-violet-950/20',    active: 'border-violet-500 bg-violet-100 dark:border-violet-400 dark:bg-violet-950/50 shadow-md shadow-violet-100 dark:shadow-violet-900/20', hover: 'hover:border-violet-400 hover:bg-violet-100/80 dark:hover:border-violet-600 dark:hover:bg-violet-950/30', activeText: 'text-violet-700 dark:text-violet-300', badgeBg: 'bg-violet-200 dark:bg-violet-900', badgeText: 'text-violet-700 dark:text-violet-300', iconColor: 'text-violet-500 dark:text-violet-400', ring: 'focus-visible:ring-violet-400' },
  team_league_ko:        { base: 'border-amber-200 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/20',        active: 'border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-950/50 shadow-md shadow-amber-100 dark:shadow-amber-900/20',   hover: 'hover:border-amber-400 hover:bg-amber-100/80 dark:hover:border-amber-600 dark:hover:bg-amber-950/30', activeText: 'text-amber-700 dark:text-amber-300',  badgeBg: 'bg-amber-200 dark:bg-amber-900',   badgeText: 'text-amber-700 dark:text-amber-300',   iconColor: 'text-amber-500 dark:text-amber-400',  ring: 'focus-visible:ring-amber-400' },
  team_league_swaythling:{ base: 'border-orange-200 bg-orange-50/60 dark:border-orange-800/60 dark:bg-orange-950/20',    active: 'border-orange-500 bg-orange-100 dark:border-orange-400 dark:bg-orange-950/50 shadow-md shadow-orange-100 dark:shadow-orange-900/20', hover: 'hover:border-orange-400 hover:bg-orange-100/80 dark:hover:border-orange-600 dark:hover:bg-orange-950/30', activeText: 'text-orange-700 dark:text-orange-300', badgeBg: 'bg-orange-200 dark:bg-orange-900', badgeText: 'text-orange-700 dark:text-orange-300', iconColor: 'text-orange-500 dark:text-orange-400', ring: 'focus-visible:ring-orange-400' },
  single_round_robin:    { base: 'border-teal-200 bg-teal-50/60 dark:border-teal-800/60 dark:bg-teal-950/20',            active: 'border-teal-500 bg-teal-100 dark:border-teal-400 dark:bg-teal-950/50 shadow-md shadow-teal-100 dark:shadow-teal-900/20',       hover: 'hover:border-teal-400 hover:bg-teal-100/80 dark:hover:border-teal-600 dark:hover:bg-teal-950/30',     activeText: 'text-teal-700 dark:text-teal-300',    badgeBg: 'bg-teal-200 dark:bg-teal-900',     badgeText: 'text-teal-700 dark:text-teal-300',     iconColor: 'text-teal-500 dark:text-teal-400',    ring: 'focus-visible:ring-teal-400' },
  multi_rr_to_knockout:  { base: 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-800/60 dark:bg-indigo-950/20',    active: 'border-indigo-500 bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-950/50 shadow-md shadow-indigo-100 dark:shadow-indigo-900/20', hover: 'hover:border-indigo-400 hover:bg-indigo-100/80 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/30', activeText: 'text-indigo-700 dark:text-indigo-300', badgeBg: 'bg-indigo-200 dark:bg-indigo-900', badgeText: 'text-indigo-700 dark:text-indigo-300', iconColor: 'text-indigo-500 dark:text-indigo-400', ring: 'focus-visible:ring-indigo-400' },
  team_group_corbillon:  { base: 'border-rose-200 bg-rose-50/60 dark:border-rose-800/60 dark:bg-rose-950/20',            active: 'border-rose-500 bg-rose-100 dark:border-rose-400 dark:bg-rose-950/50 shadow-md shadow-rose-100 dark:shadow-rose-900/20',       hover: 'hover:border-rose-400 hover:bg-rose-100/80 dark:hover:border-rose-600 dark:hover:bg-rose-950/30',     activeText: 'text-rose-700 dark:text-rose-300',    badgeBg: 'bg-rose-200 dark:bg-rose-900',     badgeText: 'text-rose-700 dark:text-rose-300',     iconColor: 'text-rose-500 dark:text-rose-400',    ring: 'focus-visible:ring-rose-400' },
  team_group_swaythling: { base: 'border-pink-200 bg-pink-50/60 dark:border-pink-800/60 dark:bg-pink-950/20',            active: 'border-pink-500 bg-pink-100 dark:border-pink-400 dark:bg-pink-950/50 shadow-md shadow-pink-100 dark:shadow-pink-900/20',         hover: 'hover:border-pink-400 hover:bg-pink-100/80 dark:hover:border-pink-600 dark:hover:bg-pink-950/30',     activeText: 'text-pink-700 dark:text-pink-300',    badgeBg: 'bg-pink-200 dark:bg-pink-900',     badgeText: 'text-pink-700 dark:text-pink-300',     iconColor: 'text-pink-500 dark:text-pink-400',    ring: 'focus-visible:ring-pink-400' },
}

interface FormatOption {
  value:       FormatType
  icon:        React.ReactNode
  label:       string
  description: string
  badge?:      string
  defaultName: string
}

// ─── Format options ───────────────────────────────────────────────────────────

const SINGLE_STAGE_OPTIONS: FormatOption[] = [
  {
    value:       'single_knockout',
    icon:        <Swords className="h-5 w-5" />,
    label:       'Singles - Knockout',
    description: 'Direct elimination bracket. One loss and you\'re out. Fast, decisive, and ideal for large draws.',
    defaultName: 'Singles - Knockout',
  },
  {
    value:       'pure_round_robin',
    icon:        <RotateCcw className="h-5 w-5" />,
    label:       'Singles - Round Robin',
    description: 'Every player plays every other player exactly once. Final standings determine the winner.',
    defaultName: 'Singles - Round Robin',
  },
  {
    value:       'double_elimination',
    icon:        <GitBranch className="h-5 w-5" />,
    label:       'Singles - Double Elimination',
    description: 'Two losses required to be eliminated. Winners and Losers brackets run in parallel, converging at the Grand Final.',
    defaultName: 'Singles - Double Elimination',
  },
  {
    value:       'team_league_ko',
    icon:        <Shield className="h-5 w-5" />,
    label:       'Teams - Knockout (Corbillon Cup)',
    description: '4 singles + 1 doubles per tie. Order: A×X, B×Y, Doubles, A×Y, B×X. Each team requires exactly 2 players.',
    badge:       'Teams',
    defaultName: 'Teams - Knockout (Corbillon Cup)',
  },
  {
    value:       'team_league_swaythling',
    icon:        <Shield className="h-5 w-5" />,
    label:       'Teams - Knockout (Swaythling Cup)',
    description: '5 singles per tie, no doubles. Order: A×X, B×Y, C×Z, A×Y, B×X. Each team requires exactly 3 players.',
    badge:       'Teams',
    defaultName: 'Teams - Knockout (Swaythling Cup)',
  },
]

const MULTI_STAGE_OPTIONS: FormatOption[] = [
  {
    value:       'single_round_robin',
    icon:        <Users className="h-5 w-5" />,
    label:       'Singles - Round Robin + Knockout',
    description: 'Players are seeded into round-robin groups. Top finishers from each group advance to a knockout bracket.',
    defaultName: 'Singles - Round Robin + Knockout',
  },
  {
    value:       'multi_rr_to_knockout',
    icon:        <Layers className="h-5 w-5" />,
    label:       'Singles - Groups + Knockout',
    description: 'Players compete in groups; the top N players ranked across all groups advance to a single-elimination knockout bracket.',
    defaultName: 'Singles - Groups + Knockout',
  },
  {
    value:       'team_group_corbillon',
    icon:        <Shield className="h-5 w-5" />,
    label:       'Teams - Groups + Knockout (Corbillon Cup)',
    description: 'Teams seeded into groups. Each group tie is best-of-5 (4 singles + 1 doubles). Top 2 per group advance to a Corbillon Cup knockout.',
    badge:       'Teams',
    defaultName: 'Teams - Groups + Knockout (Corbillon Cup)',
  },
  {
    value:       'team_group_swaythling',
    icon:        <Shield className="h-5 w-5" />,
    label:       'Teams - Groups + Knockout (Swaythling Cup)',
    description: 'Teams seeded into groups. Each group tie is best-of-5 (5 singles, no doubles). Top 2 per group advance to a Swaythling Cup knockout.',
    badge:       'Teams',
    defaultName: 'Teams - Groups + Knockout (Swaythling Cup)',
  },
]

const ALL_OPTIONS = [...SINGLE_STAGE_OPTIONS, ...MULTI_STAGE_OPTIONS]

// ─── FormatCard ───────────────────────────────────────────────────────────────

function FormatCard({ opt, isActive, onSelect }: {
  opt: FormatOption; isActive: boolean; onSelect: (v: FormatType) => void
}) {
  const t = THEMES[opt.value]
  return (
    <button
      type="button"
      onClick={() => onSelect(opt.value)}
      className={cn(
        'relative flex flex-col gap-2 rounded-xl border-2 px-4 py-3.5 text-left',
        'transition-all duration-150 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2', t.ring,
        isActive ? t.active : [t.base, t.hover],
      )}
    >
      {opt.badge && (
        <span className={cn(
          'absolute top-2.5 right-2.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider',
          t.badgeBg, t.badgeText,
        )}>
          {opt.badge}
        </span>
      )}
      {/* Icon + label */}
      <div className={cn(
        'flex items-center gap-2 font-semibold text-sm',
        isActive ? t.activeText : ['text-foreground', t.iconColor.replace('text-', '[&>svg]:text-')],
      )}>
        <span className={cn(isActive ? t.activeText : t.iconColor)}>{opt.icon}</span>
        <span className="leading-tight pr-6">{opt.label}</span>
      </div>
      {/* Description — always fully visible */}
      <p className="text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
    </button>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

interface Props {
  cid:          string
  createAction: (formData: FormData) => Promise<void>
}

export function NewEventForm({ cid, createAction }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const [formatType,  setFormatTypeState] = useState<FormatType>('single_knockout')
  const [name,        setName]            = useState(SINGLE_STAGE_OPTIONS[0].defaultName)
  const [nameEdited,  setNameEdited]      = useState(false)
  const [date,        setDate]            = useState(today)
  const [busy,        setBusy]            = useState(false)
  const { setLoading } = useLoading()
  const formRef = useRef<HTMLFormElement>(null)

  const handleSelectFormat = (value: FormatType) => {
    setFormatTypeState(value)
    if (!nameEdited) {
      const opt = ALL_OPTIONS.find(o => o.value === value)
      if (opt) setName(opt.defaultName)
    }
  }

  const handleNameChange = (v: string) => {
    setName(v)
    setNameEdited(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formRef.current || !name.trim() || busy) return
    const fd = new FormData(formRef.current)
    setBusy(true)
    setLoading(true)
    try {
      await createAction(fd)
      setBusy(false)
      setLoading(false)
    } catch (err: unknown) {
      const digest = (err as { digest?: string })?.digest ?? ''
      if (digest.startsWith('NEXT_REDIRECT')) throw err
      setBusy(false)
      setLoading(false)
      toast({ title: 'Could not create event', description: err instanceof Error ? err.message : 'Unexpected error.', variant: 'destructive' })
    }
  }

  const activeTheme = THEMES[formatType]

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="name"        value={name} />
      <input type="hidden" name="format_type" value={formatType} />
      <input type="hidden" name="format"      value="bo5" />

      {/* ── Name + Date row ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <label htmlFor="event-name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Event Name *
          </label>
          <input
            id="event-name"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="e.g. Under 13 Boys"
            required
            className={cn(
              'flex h-10 w-full rounded-lg border-2 bg-card px-3 py-2 text-sm text-foreground',
              'focus:outline-none focus:ring-2 transition-all duration-150',
              activeTheme.active.split(' ').filter(c => c.startsWith('border-')).join(' '),
              activeTheme.ring,
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-44 shrink-0">
          <label htmlFor="event-date" className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> Date
          </label>
          <input
            id="event-date"
            name="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="flex h-10 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400 transition-colors"
          />
        </div>
      </div>

      {/* ── Single Stage ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest whitespace-nowrap">
            Single Stage
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {SINGLE_STAGE_OPTIONS.map(opt => (
            <FormatCard key={opt.value} opt={opt}
              isActive={formatType === opt.value}
              onSelect={handleSelectFormat}
            />
          ))}
        </div>
      </div>

      {/* ── Multi Stage ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest whitespace-nowrap">
            Multi Stage
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 gap-3">
          {MULTI_STAGE_OPTIONS.map(opt => (
            <FormatCard key={opt.value} opt={opt}
              isActive={formatType === opt.value}
              onSelect={handleSelectFormat}
            />
          ))}
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="outline" className="flex-1" asChild>
          <Link href={`/admin/championships/${cid}`}>Cancel</Link>
        </Button>
        <Button type="submit" variant="default" className="flex-1 gap-2" disabled={!name.trim() || busy}>
          {busy
            ? <><span className="tt-spinner tt-spinner-sm" /> Creating…</>
            : <><Trophy className="h-4 w-4" /> Create Event</>
          }
        </Button>
      </div>
    </form>
  )
}
