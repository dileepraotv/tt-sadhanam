'use client'
/**
 * AdminTabs — controlled tab wrapper for the tournament admin page.
 *
 * WHY: Radix <Tabs defaultValue> is uncontrolled — it only reads the prop on
 * first mount. So router.push('?tab=stages') triggers an RSC re-render that
 * passes a new defaultValue, but Radix ignores it because the component is
 * already mounted. This wrapper uses `value` (controlled) + `onValueChange`
 * to keep the active tab in sync with the URL search param at all times.
 *
 * Team formats (team_league*, team_group_corbillon, team_group_swaythling):
 *   - The "Players" tab is hidden — teams + their players are managed inside
 *     the stage component (TeamsTab), not via the global PlayerManager.
 *   - The stages tab is labelled "Teams" to reflect this.
 */

import { useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/index'
import { Settings2, Users, Layers, Radio, Shield } from 'lucide-react'
import { LiveBadge } from '@/components/shared/LiveBadge'

type TabId = 'setup' | 'players' | 'stages' | 'live'

interface Props {
  defaultTab:    TabId
  formatType:    string
  playerCount:   number
  stagesLive:    boolean
  liveCount:     number
  children:      React.ReactNode   // four <TabsContent> children in order: setup, players, stages, live
}

const TEAM_FORMATS = new Set([
  'team_league',
  'team_league_ko',
  'team_league_swaythling',
  'team_group_corbillon',
  'team_group_swaythling',
])

function stagesTabLabel(formatType: string): string {
  switch (formatType) {
    case 'multi_rr_to_knockout':   return 'Stages'
    case 'single_round_robin':     return 'Groups'
    case 'pure_round_robin':       return 'League'
    case 'double_elimination':     return 'Bracket'
    case 'team_league':
    case 'team_league_ko':
    case 'team_league_swaythling':
    case 'team_group_corbillon':
    case 'team_group_swaythling':  return 'Teams'
    default:                       return 'Bracket'
  }
}

export function AdminTabs({
  defaultTab, formatType, playerCount, stagesLive, liveCount, children,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const isTeamFormat = TEAM_FORMATS.has(formatType)

  // For team formats redirect away from 'players' tab — teams are managed inside StagesTab
  const rawTab  = (searchParams.get('tab') as TabId | null) ?? defaultTab
  const currentTab: TabId = isTeamFormat && rawTab === 'players' ? 'stages' : rawTab

  const handleChange = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  return (
    <Tabs value={currentTab} onValueChange={handleChange}>
      <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">

        <TabsTrigger value="setup" className="flex-none gap-1.5">
          <Settings2 className="h-3.5 w-3.5 hidden sm:block" />
          Setup
        </TabsTrigger>

        {/* Hide Players tab for all team formats — managed inside the stage */}
        {!isTeamFormat && (
          <TabsTrigger value="players" className="flex-none gap-1.5">
            <Users className="h-3.5 w-3.5 hidden sm:block" />
            Players
            {playerCount > 0 && (
              <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>
            )}
          </TabsTrigger>
        )}

        <TabsTrigger value="stages" className="flex-none gap-1.5">
          {isTeamFormat
            ? <Shield className="h-3.5 w-3.5 hidden sm:block" />
            : <Layers className="h-3.5 w-3.5 hidden sm:block" />
          }
          {stagesTabLabel(formatType)}
          {stagesLive && <span className="live-dot ml-1" />}
        </TabsTrigger>

        <TabsTrigger value="live" className="flex-none gap-1.5">
          <Radio className="h-3.5 w-3.5 hidden sm:block" />
          Live
          {liveCount > 0 && <span className="live-dot ml-1" />}
        </TabsTrigger>

      </TabsList>

      {children}
    </Tabs>
  )
}
