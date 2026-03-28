'use client'
// cache-bust: 1773842500

import { useState, useRef } from 'react'
import { useLoading } from '@/components/shared/GlobalLoader'
import Link from 'next/link'
import {
  Swords, Users, Layers, RotateCcw, GitBranch, Shield,
  Trophy, CalendarDays, CheckCircle2, ArrowRight,
} from 'lucide-react'
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

// ─── Date suffix ──────────────────────────────────────────────────────────────

function getDateSuffix(): string {
  const now = new Date()
  const dd  = String(now.getDate()).padStart(2, '0')
  const mm  = String(now.getMonth() + 1).padStart(2, '0')
  const yy  = String(now.getFullYear()).slice(-2)
  const hh  = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${dd}${mm}${yy}-${hh}:${min}`
}

// ─── Format catalogue ─────────────────────────────────────────────────────────

type Category = 'singles' | 'teams'

interface FormatOption {
  value:       FormatType
  category:    Category
  icon:        React.ReactNode
  label:       string
  tagline:     string          // one-line in the picker list
  description: string          // shown in the detail pane
  bullets:     string[]        // key facts shown in detail pane
  defaultName: string
  badge?:      string
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'single_knockout', category: 'singles',
    icon: <Swords className="h-4 w-4" />,
    label: 'Knockout',
    tagline: 'Single-elimination bracket',
    description: 'The classic knockout format. One loss and you\'re out. Seeds are placed into the bracket so top players meet in the later rounds.',
    bullets: ['Draw supported (seeded & random)', 'Any number of players', 'Quickest format to complete', 'Best of 5 per match'],
    defaultName: 'Singles - Knockout',
  },
  {
    value: 'pure_round_robin', category: 'singles',
    icon: <RotateCcw className="h-4 w-4" />,
    label: 'Round Robin',
    tagline: 'Everyone plays everyone',
    description: 'Every player faces every other player exactly once. Final standings are determined by wins, then game difference, then H2H.',
    bullets: ['ITTF-compliant tiebreakers', 'Guaranteed matches for all', 'Great for small groups', 'Full standings table'],
    defaultName: 'Singles - Round Robin',
  },
  {
    value: 'double_elimination', category: 'singles',
    icon: <GitBranch className="h-4 w-4" />,
    label: 'Double Elimination',
    tagline: 'Two losses to be knocked out',
    description: 'Winners and Losers brackets run in parallel. A player must lose twice to be eliminated, giving a second chance to every participant.',
    bullets: ['Winners + Losers brackets', 'Grand Final with bracket reset', 'Fairer than single KO', 'Best of 5 per match'],
    defaultName: 'Singles - Double Elimination',
  },
  {
    value: 'single_round_robin', category: 'singles',
    icon: <Users className="h-4 w-4" />,
    label: 'Round Robin + Knockout',
    tagline: 'Round-robin groups then knockout',
    description: 'Players are placed into round-robin groups. Top finishers from each group advance to a single-elimination knockout bracket.',
    bullets: ['Configure group count & size', 'Best third across groups option', 'Group standings + KO bracket', 'Most common tournament format'],
    defaultName: 'Singles - Round Robin + Knockout',
  },
  {
    value: 'multi_rr_to_knockout', category: 'singles',
    icon: <Layers className="h-4 w-4" />,
    label: 'Round Robin + Knockout (Flexible)',
    tagline: 'Top N across all groups advance',
    description: 'Like Round Robin + Knockout, but advancement is based on overall ranking across all groups rather than per-group qualification.',
    bullets: ['Top N players across all groups advance', 'More balanced bracket seeding', 'Best-third handling built in', 'Configurable advance count'],
    defaultName: 'Singles - Round Robin + Knockout (Flexible)',
  },
  {
    value: 'team_league_ko', category: 'teams',
    icon: <Shield className="h-4 w-4" />,
    label: 'Knockout (Corbillon Cup)',
    tagline: '4 singles + 1 doubles · 2 players/team',
    description: 'Team knockout using the Corbillon Cup rubber order. Each tie consists of 4 singles rubbers and 1 doubles rubber. First team to win 3 rubbers wins the tie.',
    bullets: ['Order: A×X, B×Y, Doubles A/B×X/Y, A×Y, B×X', '2 players per team (positions A and B)', 'Seeded bracket draw', 'Same scoring UI as Round Robin+KO'],
    defaultName: 'Teams - Knockout (Corbillon Cup)',
  },
  {
    value: 'team_league_swaythling', category: 'teams',
    icon: <Shield className="h-4 w-4" />,
    label: 'Knockout (Swaythling Cup)',
    tagline: '5 singles, no doubles · 3 players/team',
    description: 'Team knockout using the Swaythling Cup rubber order. Each tie consists of 5 singles rubbers and no doubles. First team to win 3 rubbers wins the tie.',
    bullets: ['Order: A×X, B×Y, C×Z, A×Y, B×X', '3 players per team (positions A, B and C)', 'Seeded bracket draw', 'Same scoring UI as Round Robin+KO'],
    defaultName: 'Teams - Knockout (Swaythling Cup)',
  },
  {
    value: 'team_group_corbillon', category: 'teams',
    icon: <Shield className="h-4 w-4" />,
    label: 'Groups + Knockout (Corbillon Cup)',
    tagline: 'Groups stage then Corbillon KO',
    description: 'Teams are seeded into round-robin groups. Top teams from each group advance to a Corbillon Cup knockout bracket (4 singles + 1 doubles).',
    bullets: ['Group stage + Corbillon KO bracket', '2 players per team', 'Configurable group size & advance count', 'Full group standings + KO draw'],
    defaultName: 'Teams - Groups + Knockout (Corbillon Cup)',
  },
  {
    value: 'team_group_swaythling', category: 'teams',
    icon: <Shield className="h-4 w-4" />,
    label: 'Groups + Knockout (Swaythling Cup)',
    tagline: 'Groups stage then Swaythling KO',
    description: 'Teams are seeded into round-robin groups. Top teams from each group advance to a Swaythling Cup knockout bracket (5 singles, no doubles).',
    bullets: ['Group stage + Swaythling KO bracket', '3 players per team', 'Configurable group size & advance count', 'Full group standings + KO draw'],
    defaultName: 'Teams - Groups + Knockout (Swaythling Cup)',
  },
]

const ACCENT: Record<FormatType, { border: string; bg: string; text: string; ring: string; pill: string }> = {
  single_knockout:        { border: 'border-red-400',    bg: 'bg-red-50 dark:bg-red-950/30',      text: 'text-red-600 dark:text-red-400',    ring: 'ring-red-400',    pill: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  pure_round_robin:       { border: 'border-sky-400',    bg: 'bg-sky-50 dark:bg-sky-950/30',      text: 'text-sky-600 dark:text-sky-400',    ring: 'ring-sky-400',    pill: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  double_elimination:     { border: 'border-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-600 dark:text-violet-400', ring: 'ring-violet-400', pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  single_round_robin:     { border: 'border-teal-400',   bg: 'bg-teal-50 dark:bg-teal-950/30',    text: 'text-teal-600 dark:text-teal-400',   ring: 'ring-teal-400',   pill: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  multi_rr_to_knockout:   { border: 'border-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-600 dark:text-indigo-400', ring: 'ring-indigo-400', pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  team_league_ko:         { border: 'border-amber-400',  bg: 'bg-amber-50 dark:bg-amber-950/30',  text: 'text-amber-600 dark:text-amber-400',  ring: 'ring-amber-400',  pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  team_league_swaythling: { border: 'border-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400', ring: 'ring-orange-400', pill: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  team_group_corbillon:   { border: 'border-rose-400',   bg: 'bg-rose-50 dark:bg-rose-950/30',    text: 'text-rose-600 dark:text-rose-400',   ring: 'ring-rose-400',   pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  team_group_swaythling:  { border: 'border-pink-400',   bg: 'bg-pink-50 dark:bg-pink-950/30',    text: 'text-pink-600 dark:text-pink-400',   ring: 'ring-pink-400',   pill: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' },
}

// ─── Main form ────────────────────────────────────────────────────────────────

interface Props {
  cid:          string
  createAction: (formData: FormData) => Promise<void>
}

export function NewEventForm({ cid, createAction }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const [formatType,  setFormatTypeState] = useState<FormatType>('single_knockout')
  const [name,        setName]            = useState(() => `${FORMAT_OPTIONS[0].defaultName} ${getDateSuffix()}`)
  const [nameEdited,  setNameEdited]      = useState(false)
  const [date,        setDate]            = useState(today)
  const [activeTab,   setActiveTab]       = useState<Category>('singles')
  const [busy,        setBusy]            = useState(false)
  const { setLoading } = useLoading()
  const formRef = useRef<HTMLFormElement>(null)

  const handleSelectFormat = (value: FormatType) => {
    setFormatTypeState(value)
    if (!nameEdited) {
      const opt = FORMAT_OPTIONS.find(o => o.value === value)
      if (opt) setName(`${opt.defaultName} ${getDateSuffix()}`)
    }
  }

  const handleNameChange = (v: string) => { setName(v); setNameEdited(true) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formRef.current || !name.trim() || busy) return
    const fd = new FormData(formRef.current)
    setBusy(true); setLoading(true)
    try {
      await createAction(fd)
      setBusy(false); setLoading(false)
    } catch (err: unknown) {
      const digest = (err as { digest?: string })?.digest ?? ''
      if (digest.startsWith('NEXT_REDIRECT')) throw err
      setBusy(false); setLoading(false)
      toast({ title: 'Could not create event', description: err instanceof Error ? err.message : 'Unexpected error.', variant: 'destructive' })
    }
  }

  const selected    = FORMAT_OPTIONS.find(o => o.value === formatType)!
  const accent      = ACCENT[formatType]
  const singlesOpts = FORMAT_OPTIONS.filter(o => o.category === 'singles')
  const teamsOpts   = FORMAT_OPTIONS.filter(o => o.category === 'teams')
  const listOpts    = activeTab === 'singles' ? singlesOpts : teamsOpts

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <input type="hidden" name="name"        value={name} />
      <input type="hidden" name="format_type" value={formatType} />
      <input type="hidden" name="format"      value="bo5" />

      {/* ── Two-column master–detail layout ─────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-0 rounded-2xl border border-border overflow-hidden bg-card shadow-sm">

        {/* ── LEFT: format picker ───────────────────────────────────────── */}
        <div className="lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col">

          {/* Category tabs */}
          <div className="flex border-b border-border">
            {(['singles', 'teams'] as Category[]).map(cat => (
              <button key={cat} type="button"
                onClick={() => {
                  setActiveTab(cat)
                  // Auto-select first in category if current selection is other category
                  const currentCat = FORMAT_OPTIONS.find(o => o.value === formatType)?.category
                  if (currentCat !== cat) {
                    const first = FORMAT_OPTIONS.find(o => o.category === cat)
                    if (first) handleSelectFormat(first.value)
                  }
                }}
                className={cn(
                  'flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors',
                  activeTab === cat
                    ? 'bg-card text-foreground border-b-2 border-orange-500 -mb-px'
                    : 'text-muted-foreground hover:text-foreground bg-muted/30',
                )}
              >
                {cat === 'singles' ? '👤 Singles' : '🛡️ Teams'}
              </button>
            ))}
          </div>

          {/* Format list */}
          <div className="flex flex-col py-1 overflow-y-auto">
            {listOpts.map(opt => {
              const isSelected = formatType === opt.value
              const a = ACCENT[opt.value]
              return (
                <button key={opt.value} type="button"
                  onClick={() => handleSelectFormat(opt.value)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 text-left transition-all border-l-2',
                    isSelected
                      ? `${a.bg} ${a.border} ${a.text}`
                      : 'border-transparent hover:bg-muted/40 text-foreground',
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', isSelected ? a.text : 'text-muted-foreground')}>
                    {opt.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-sm font-semibold leading-tight', isSelected ? a.text : '')}>{opt.label}</span>
                      {opt.badge && (
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0',
                          isSelected ? a.pill : 'bg-muted text-muted-foreground'
                        )}>{opt.badge}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.tagline}</p>
                  </div>
                  {isSelected && <CheckCircle2 className={cn('h-4 w-4 shrink-0 mt-0.5', a.text)} />}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT: detail + config ────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Format detail header */}
          <div className={cn('px-6 py-5 border-b border-border', accent.bg)}>
            <div className="flex items-start gap-3">
              <span className={cn('mt-0.5 p-2 rounded-lg bg-white/60 dark:bg-black/20 shrink-0', accent.text)}>
                {selected.icon}
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-base text-foreground leading-tight">{selected.label}</h3>
                  {selected.badge && (
                    <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide', accent.pill)}>
                      {selected.badge}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{selected.description}</p>
              </div>
            </div>

            {/* Key facts */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {selected.bullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ArrowRight className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', accent.text)} />
                  <span className="text-xs text-muted-foreground leading-snug">{b}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Event config fields */}
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Event Details</p>

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-name" className="text-xs font-semibold text-muted-foreground">
                Event Name <span className="text-destructive">*</span>
              </label>
              <input
                id="event-name"
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder={`e.g. Under 13 Boys · ${selected.defaultName} ${getDateSuffix()}`}
                required
                className={cn(
                  'flex h-10 w-full rounded-lg border-2 bg-background px-3 py-2 text-sm text-foreground',
                  'focus:outline-none focus:ring-2 transition-all duration-150',
                  accent.border, `focus:ring-2 ${accent.ring}/40`,
                )}
              />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5 sm:w-52">
              <label htmlFor="event-date" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> Date
              </label>
              <input
                id="event-date"
                name="date"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="flex h-10 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400/40 transition-colors"
              />
            </div>
          </div>

          {/* Actions pinned to bottom */}
          <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center gap-3">
            <Button type="button" variant="outline" asChild>
              <Link href={`/admin/championships/${cid}`}>Cancel</Link>
            </Button>
            <Button type="submit" className={cn('flex-1 gap-2 max-w-xs', !name.trim() || busy ? '' : `${accent.bg} ${accent.border} ${accent.text} border`)}
              disabled={!name.trim() || busy}
              variant="default"
            >
              {busy
                ? <><span className="tt-spinner tt-spinner-sm" /> Creating…</>
                : <><Trophy className="h-4 w-4" /> Create Event</>
              }
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
