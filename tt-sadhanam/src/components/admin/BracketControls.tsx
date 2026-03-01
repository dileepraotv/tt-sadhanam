'use client'

/**
 * BracketControls — Setup Tab
 *
 * Shows static tournament info. Tournament type is chosen at event creation
 * and is displayed (locked) in the event header — not changeable here.
 */

import type { Tournament, Player } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { formatDate, formatFormatLabel } from '@/lib/utils'
import { Calendar, MapPin, Trophy } from 'lucide-react'

interface BracketControlsProps {
  tournament: Tournament
  players:    Player[]
}

export function BracketControls({ tournament, players }: BracketControlsProps) {
  return (
    <div className="flex flex-col gap-5">

      {/* Tournament info — read-only summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-orange-500" />
            Tournament Details
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoTile label="Players"  value={`${players.length}`} />
            <InfoTile label="Format"   value={formatFormatLabel(tournament.format)} />
            <InfoTile
              label="Date"
              value={tournament.date ? formatDate(tournament.date) : '—'}
              icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <InfoTile
              label="Location"
              value={tournament.location ?? '—'}
              icon={<MapPin className="h-3.5 w-3.5 text-muted-foreground" />}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Tournament type was set at event creation and cannot be changed. To edit other details, go to the championship settings.
          </p>
        </CardContent>
      </Card>

    </div>
  )
}

function InfoTile({
  label, value, icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-muted/30 border border-border/60 px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-semibold text-foreground text-sm truncate">{value}</span>
      </div>
    </div>
  )
}


