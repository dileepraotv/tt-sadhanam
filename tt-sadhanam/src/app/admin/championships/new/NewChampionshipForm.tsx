'use client'

import { useRef, useState } from 'react'
import { useLoading } from '@/components/shared/GlobalLoader'
import { Button } from '@/components/ui/button'
import { Trophy } from 'lucide-react'

interface Props {
  createAction: (fd: FormData) => Promise<void>
  year:  number
  today: string
}

export function NewChampionshipForm({ createAction, year, today }: Props) {
  const { setLoading } = useLoading()
  const formRef        = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formRef.current || busy) return
    const fd = new FormData(formRef.current)
    setBusy(true)
    setLoading(true)
    try {
      await createAction(fd)
    } finally {
      setBusy(false)
      setLoading(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-5">

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-semibold text-foreground">Championship Name *</label>
        <input
          id="name" name="name" required
          placeholder="e.g. National Championships 2026"
          className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-semibold text-foreground">Description</label>
        <textarea
          id="description" name="description" rows={2}
          placeholder="Brief description (optional)"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="location" className="text-sm font-semibold text-foreground">Location</label>
          <input id="location" name="location" placeholder="e.g. Bengaluru"
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="year" className="text-sm font-semibold text-foreground">Year</label>
          <input id="year" name="year" type="number" defaultValue={year} min="2000" max="2099"
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="start_date" className="text-sm font-semibold text-foreground">Start Date</label>
          <input id="start_date" name="start_date" type="date" defaultValue={today}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="end_date" className="text-sm font-semibold text-foreground">End Date</label>
          <input id="end_date" name="end_date" type="date" defaultValue={today}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" variant="default" className="flex-1" disabled={busy}>
          {busy
            ? <><span className="tt-spinner tt-spinner-sm" /> Creating…</>
            : <><Trophy className="h-4 w-4" /> Create Championship →</>
          }
        </Button>
      </div>
    </form>
  )
}
