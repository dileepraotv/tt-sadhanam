'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Swords, Users, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COMMON_EVENTS = [
  "Men's Singles", "Women's Singles", "Mixed Doubles",
]

type FormatType = 'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout'

const FORMAT_OPTIONS: Array<{
  value:       FormatType
  icon:        React.ReactNode
  label:       string
  description: string
  badge?:      string
}> = [
  {
    value:       'single_knockout',
    icon:        <Swords className="h-4 w-4" />,
    label:       'Single Knockout',
    description: 'Direct elimination bracket. Fastest format.',
  },
  {
    value:       'single_round_robin',
    icon:        <Users className="h-4 w-4" />,
    label:       'Round Robin',
    description: 'Everyone plays everyone. Fair, but longer.',
  },
  {
    value:       'multi_rr_to_knockout',
    icon:        <Layers className="h-4 w-4" />,
    label:       'Groups → Knockout',
    description: 'Group stage, then top players advance to a bracket.',
  },
]

interface Props {
  cid:           string
  createAction:  (formData: FormData) => Promise<void>
}

export function NewEventForm({ cid, createAction }: Props) {
  const [name, setName]           = useState('')
  const [formatType, setFormatType] = useState<FormatType>('single_knockout')
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-col gap-6">
      {/* Quick pick */}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Quick Pick</p>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_EVENTS.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => setName(label)}
              className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-colors
                ${name === label
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form action={createAction} className="flex flex-col gap-5">
        {/* Sync hidden fields */}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="format_type" value={formatType} />

        {/* Event name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-name" className="text-sm font-semibold text-foreground">
            Event Name *
          </label>
          <input
            id="event-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Under 13 Boys"
            required
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {/* Tournament type — shown upfront */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-foreground">Tournament Type *</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {FORMAT_OPTIONS.map(opt => {
              const isActive = formatType === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormatType(opt.value)}
                  className={cn(
                    'relative flex flex-col gap-1 rounded-xl border px-3 py-3 text-left transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30 shadow-sm shadow-orange-200 dark:shadow-orange-900/20'
                      : 'border-border bg-card hover:border-orange-300 dark:hover:border-orange-700 hover:bg-orange-50/40 dark:hover:bg-orange-950/10 cursor-pointer',
                  )}
                >
                  <div className={cn(
                    'flex items-center gap-2 font-semibold text-sm',
                    isActive ? 'text-orange-600 dark:text-orange-400' : 'text-foreground',
                  )}>
                    {opt.icon}
                    {opt.label}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug pr-4">{opt.description}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Match format + date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="format" className="text-sm font-semibold text-foreground">Match Format</label>
            <select
              name="format"
              id="format"
              defaultValue="bo5"
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="bo3">Best of 3</option>
              <option value="bo5">Best of 5</option>
              <option value="bo7">Best of 7</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="date" className="text-sm font-semibold text-foreground">Date</label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={today}
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" asChild>
            <Link href={`/admin/championships/${cid}`}>Cancel</Link>
          </Button>
          <Button type="submit" variant="default" className="flex-1" disabled={!name.trim()}>
            Create Event →
          </Button>
        </div>
      </form>
    </div>
  )
}
