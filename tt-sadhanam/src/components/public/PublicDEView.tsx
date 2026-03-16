'use client'

/**
 * PublicDEView
 *
 * Public view for format_type = 'double_elimination'.
 * Renders the DoubleEliminationView with realtime score updates.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Tournament, Match } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { DoubleEliminationView } from '@/components/brackets/DoubleEliminationView'

interface Props {
  tournament: Tournament
  matches:    Match[]
}

export function PublicDEView({ tournament, matches: initialMatches }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const [matches, setMatches] = useState<Match[]>(initialMatches)

  const wbMatches = matches.filter(m => m.bracket_side === 'winners')
  const lbMatches = matches.filter(m => m.bracket_side === 'losers')
  const gfMatches = matches.filter(m => m.bracket_side === 'grand_final')

  useEffect(() => {
    const channel = supabase
      .channel(`public-de-${tournament.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` },
        () => router.refresh(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        () => router.refresh(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournament.id])

  if (matches.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 text-center text-muted-foreground">
        <div className="text-4xl mb-3">🏓</div>
        <p className="font-semibold text-foreground">Bracket not yet generated</p>
        <p className="text-sm mt-1">Check back once the organizer has drawn the bracket.</p>
      </div>
    )
  }

  return (
    <div className="page-content">
      <DoubleEliminationView
        wbMatches={wbMatches}
        lbMatches={lbMatches}
        gfMatches={gfMatches}
        isAdmin={false}
      />
    </div>
  )
}
