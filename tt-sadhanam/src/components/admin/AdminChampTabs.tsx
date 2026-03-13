'use client'
/**
 * AdminChampTabs — controlled tab wrapper for the championship event admin page.
 *
 * Tab IDs by format_type:
 *   single_knockout      : players | bracket
 *   pure_round_robin     : players | league
 *   double_elimination   : players | bracket
 *   team_league          : teams | schedule
 *   single_round_robin   : players | groups
 *   multi_rr_to_knockout : players | stage1 | stage2
 */

import { useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/index'
import { Users, Layers, Trophy, RotateCcw, GitBranch, Shield, Calendar } from 'lucide-react'
import type { TournamentFormatType } from '@/lib/types'

interface Props {
  defaultTab:            string
  formatType:            TournamentFormatType | undefined | null
  playerCount:           number
  rrLive:                boolean
  koLive:                boolean
  stage2Generated:       boolean
  teamScheduleGenerated: boolean
  children:              React.ReactNode
}

export function AdminChampTabs({
  defaultTab, formatType,
  playerCount, rrLive, koLive, stage2Generated, teamScheduleGenerated,
  children,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const currentTab = searchParams.get('tab') ?? defaultTab

  const handleChange = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  const ft = formatType ?? 'single_knockout'
  const isLive = rrLive || koLive

  // ── Team Group KO (Corbillon / Swaythling Groups + Knockout) ─────────────────
  if (ft === 'team_group_corbillon' || ft === 'team_group_swaythling') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="teams" className="flex-none gap-1.5">
            <Shield className="h-3.5 w-3.5 hidden sm:block" />
            Teams
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Team League RR+KO ─────────────────────────────────────────────────────
  if (ft === 'team_league') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="teams" className="flex-none gap-1.5">
            <Shield className="h-3.5 w-3.5 hidden sm:block" />
            Teams
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex-none gap-1.5" disabled={!teamScheduleGenerated}>
            <Calendar className="h-3.5 w-3.5 hidden sm:block" />
            RR Schedule
            {rrLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
          <TabsTrigger value="knockout" className="flex-none gap-1.5" disabled={!stage2Generated}>
            <Trophy className="h-3.5 w-3.5 hidden sm:block" />
            SF &amp; Final
            {koLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Team League KO (pure knockout) ───────────────────────────────────────────
  if (ft === 'team_league_ko' || ft === 'team_league_swaythling') {
    const bracketLabel = ft === 'team_league_swaythling' ? 'Swaythling Bracket' : 'Corbillon Bracket'
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="teams" className="flex-none gap-1.5">
            <Shield className="h-3.5 w-3.5 hidden sm:block" />
            Teams
          </TabsTrigger>
          <TabsTrigger value="bracket" className="flex-none gap-1.5" disabled={!teamScheduleGenerated}>
            <Trophy className="h-3.5 w-3.5 hidden sm:block" />
            {bracketLabel}
            {isLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Multi-stage Groups → Knockout ────────────────────────────────────────────
  if (ft === 'multi_rr_to_knockout') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="players" className="flex-none gap-1.5">
            <Users className="h-3.5 w-3.5 hidden sm:block" />
            Players
            {playerCount > 0 && <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="stage1" className="flex-none gap-1.5">
            <Layers className="h-3.5 w-3.5 hidden sm:block" />
            Stage 1: Groups
            {rrLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
          <TabsTrigger value="stage2" className="flex-none gap-1.5" disabled={!stage2Generated}>
            <Trophy className="h-3.5 w-3.5 hidden sm:block" />
            Stage 2: Knockout
            {koLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Single Round Robin ───────────────────────────────────────────────────────
  if (ft === 'single_round_robin') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="players" className="flex-none gap-1.5">
            <Users className="h-3.5 w-3.5 hidden sm:block" />
            Players
            {playerCount > 0 && <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex-none gap-1.5">
            <Layers className="h-3.5 w-3.5 hidden sm:block" />
            Groups
            {rrLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Pure Round Robin ─────────────────────────────────────────────────────────
  if (ft === 'pure_round_robin') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="players" className="flex-none gap-1.5">
            <Users className="h-3.5 w-3.5 hidden sm:block" />
            Players
            {playerCount > 0 && <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="stages" className="flex-none gap-1.5">
            <RotateCcw className="h-3.5 w-3.5 hidden sm:block" />
            League
            {isLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Double Elimination ───────────────────────────────────────────────────────
  if (ft === 'double_elimination') {
    return (
      <Tabs value={currentTab} onValueChange={handleChange}>
        <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
          <TabsTrigger value="players" className="flex-none gap-1.5">
            <Users className="h-3.5 w-3.5 hidden sm:block" />
            Players
            {playerCount > 0 && <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="stages" className="flex-none gap-1.5">
            <GitBranch className="h-3.5 w-3.5 hidden sm:block" />
            Bracket
            {isLive && <span className="live-dot ml-1" />}
          </TabsTrigger>
        </TabsList>
        {children}
      </Tabs>
    )
  }

  // ── Default: single_knockout ─────────────────────────────────────────────────
  return (
    <Tabs value={currentTab} onValueChange={handleChange}>
      <TabsList className="w-full sm:w-auto mb-6 overflow-x-auto shrink-0">
        <TabsTrigger value="players" className="flex-none gap-1.5">
          <Users className="h-3.5 w-3.5 hidden sm:block" />
          Players
          {playerCount > 0 && <span className="ml-0.5 text-xs opacity-60">({playerCount})</span>}
        </TabsTrigger>
        <TabsTrigger value="stages" className="flex-none gap-1.5">
          <Trophy className="h-3.5 w-3.5 hidden sm:block" />
          Bracket
          {isLive && <span className="live-dot ml-1" />}
        </TabsTrigger>
      </TabsList>
      {children}
    </Tabs>
  )
}
