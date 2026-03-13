'use client'

import { useRef, useState } from 'react'
import { useLoading } from '@/components/shared/GlobalLoader'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/index'

interface Props {
  createAction: (fd: FormData) => Promise<void>
}

export function NewTournamentForm({ createAction }: Props) {
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
        <Label htmlFor="name">Tournament Name *</Label>
        <Input id="name" name="name" placeholder="e.g. City Open 2025" required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" placeholder="e.g. Sports Hall A" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* format is now set per-match, default to bo5 */}
        <input type="hidden" name="format" value="bo5" />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" variant="cyan" className="flex-1" disabled={busy}>
          {busy
            ? <><span className="tt-spinner tt-spinner-sm" /> Creating…</>
            : 'Create Tournament →'
          }
        </Button>
      </div>
    </form>
  )
}
