'use client'

/**
 * TeamLeagueStage
 *
 * view='teams'    → Create/manage teams with inline player entry, bulk import, generate schedule
 * view='schedule' → Fixtures by round with per-submatch player selectors and standings
 */

import React, { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Shield, Plus, Trash2, RefreshCw, PlayCircle,
  ChevronDown, ChevronRight, Trophy, Upload, X,
  AlertTriangle, Check, Pencil, Users, ChevronUp, Loader2, Swords,
} from 'lucide-react'
import { cn, getRoundTab } from '@/lib/utils'
import type { Tournament, Team } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { NextStepBanner } from './NextStepBanner'
import { toast } from '@/components/ui/toaster'
import { useLoading, InlineLoader } from '@/components/shared/GlobalLoader'
import { WinnerTrophy, matchStatusClasses, T } from '@/components/shared/MatchUI'
import { createClient } from '@/lib/supabase/client'
import {
  createTeam, updateTeam, deleteTeam, upsertTeamPlayers,
  generateTeamSchedule, resetTeamLeague, updateSubmatchPlayers,
  batchUpdateSubmatchPlayers, generateTeamRRKnockout, generateTeamKOBracket,
  generateTeamSwaythlingBracket,
} from '@/lib/actions/teamLeague'
import { useRouter } from 'next/navigation'
import { RubberScorer } from '@/components/shared/RubberScorer'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  tournament:     Tournament
  matchBase:      string
  view:           'teams' | 'schedule' | 'knockout' | 'bracket'
  showSeedInput?: boolean   // true for team_league_ko
}

interface TeamPlayer { id: string; name: string; position: number }

interface TeamWithPlayers {
  id:            string
  tournament_id: string
  name:          string
  short_name:    string | null
  color:         string | null
  seed:          number | null
  doubles_p1_pos: number | null
  doubles_p2_pos: number | null
  created_at:    string
  players:       TeamPlayer[]
}

interface Submatch {
  id:               string
  match_order:      number
  label:            string
  player_a_name:    string | null
  player_b_name:    string | null
  team_a_player_id:  string | null
  team_b_player_id:  string | null
  team_a_player2_id: string | null  // doubles only
  team_b_player2_id: string | null  // doubles only
  match_id:         string | null
  // joined from matches table
  scoring?: {
    id:            string
    player1_games: number
    player2_games: number
    status:        string
  } | null
}

interface TeamMatchRich {
  id:             string
  tournament_id:  string
  team_a_id:      string
  team_b_id:      string
  round:          number
  round_name:     string | null
  status:         'pending' | 'live' | 'complete'
  team_a_score:   number
  team_b_score:   number
  winner_team_id: string | null
  team_a: (Team & { players: TeamPlayer[] }) | null
  team_b: (Team & { players: TeamPlayer[] }) | null
  submatches: Submatch[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_COLORS = [
  '#F06321', '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#3b82f6', '#eab308', '#22c55e',
]
function pickColor(index: number) { return TEAM_COLORS[index % TEAM_COLORS.length] }

// ─────────────────────────────────────────────────────────────────────────────
// Data loading hook
// ─────────────────────────────────────────────────────────────────────────────

function useTeamData(tournamentId: string) {
  const supabase                      = createClient()
  const [teams, setTeams]             = useState<TeamWithPlayers[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatchRich[]>([])
  const [loading, setLoading]         = useState(true)

  // silent=true: background refresh — don't show spinner (keeps cards open)
  // silent=false (default): initial load — show spinner
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    const [teamsRes, tmRes] = await Promise.all([
      supabase
        .from('teams')
        .select('*, doubles_p1_pos, doubles_p2_pos, team_players(id, name, position)')
        .eq('tournament_id', tournamentId)
        .order('created_at'),
      supabase
        .from('team_matches')
        .select(`
          *,
          team_a:team_a_id(id,name,short_name,color,team_players(id,name,position)),
          team_b:team_b_id(id,name,short_name,color,team_players(id,name,position)),
          submatches:team_match_submatches(
            id,match_order,label,
            player_a_name,player_b_name,
            team_a_player_id,team_b_player_id,
            team_a_player2_id,team_b_player2_id,
            match_id,
            scoring:match_id(id,player1_games,player2_games,status)
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('round'),
    ])

    setTeams((teamsRes.data ?? []).map(t => ({
      ...t,
      players: ((t.team_players ?? []) as TeamPlayer[]).sort((a, b) => a.position - b.position),
    })) as TeamWithPlayers[])

    setTeamMatches((tmRes.data ?? []).map(tm => ({
      ...tm,
      team_a: tm.team_a ? {
        ...tm.team_a,
        players: (((tm.team_a as unknown as { team_players?: TeamPlayer[] }).team_players) ?? [])
          .sort((a: TeamPlayer, b: TeamPlayer) => a.position - b.position),
      } : null,
      team_b: tm.team_b ? {
        ...tm.team_b,
        players: (((tm.team_b as unknown as { team_players?: TeamPlayer[] }).team_players) ?? [])
          .sort((a: TeamPlayer, b: TeamPlayer) => a.position - b.position),
      } : null,
      submatches: ((tm as unknown as { submatches?: Submatch[] }).submatches ?? [])
        .sort((a, b) => a.match_order - b.match_order),
    })) as unknown as TeamMatchRich[])

    setLoading(false)
  }

  useEffect(() => { loadData() }, [tournamentId])

  useEffect(() => {
    const channel = supabase
      .channel(`team-league-${tournamentId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_matches', filter: `tournament_id=eq.${tournamentId}` },
        () => loadData(true),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `tournament_id=eq.${tournamentId}` },
        () => loadData(true),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'team_match_submatches' },
        () => loadData(true),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournamentId])

  return { teams, teamMatches, loading, loadData }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function TeamLeagueStage({ tournament, matchBase, view: _view, showSeedInput = false }: Props) {
  const [isPending, startTransition] = useTransition()
  const { setLoading }               = useLoading()
  const router                       = useRouter()
  const { teams, teamMatches, loading, loadData } = useTeamData(tournament.id)
  const isGenerated = tournament.bracket_generated

  const ft = tournament.format_type ?? 'team_league'
  const isKOFormat       = ft === 'team_league_ko'
  const isSwaythling     = ft === 'team_league_swaythling'
  const isRRKO           = ft === 'team_league'
  const hasKO            = teamMatches.some(m => m.round >= 900)
  const rrMatches        = teamMatches.filter(m => m.round < 900)
  const koMatches        = teamMatches.filter(m => m.round >= 900)
  const allRRDone        = rrMatches.length > 0 && rrMatches.every(m => m.status === 'complete')

  // Internal tab state — mirrors TeamGroupKOStage pattern
  const formatLabel = isKOFormat ? 'Corbillon Cup' : isSwaythling ? 'Swaythling Cup' : 'Team League'
  const tabs = [
    { key: 'teams',    label: 'Teams' },
    { key: 'schedule', label: isRRKO ? 'Schedule' : 'Fixtures', disabled: !isGenerated },
    ...(isRRKO || isKOFormat || isSwaythling
      ? [{ key: 'knockout', label: 'Knockout', disabled: !hasKO }]
      : []),
  ] as const
  type TabKey = 'teams' | 'schedule' | 'knockout'
  const [activeTab, setActiveTab] = React.useState<TabKey>(() => {
    if (hasKO) return 'knockout'
    if (isGenerated) return 'schedule'
    return 'teams'
  })

  // Auto-advance tab when data changes
  React.useEffect(() => {
    if (activeTab === 'teams' && isGenerated && !loading) setActiveTab('schedule')
    if (activeTab === 'schedule' && hasKO) setActiveTab('knockout')
  }, [isGenerated, hasKO]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <InlineLoader label="Loading team data…" />
  }

  return (
    <div className="flex flex-col gap-0">
      {/* ── Tab strip — matches TeamGroupKOStage style ── */}
      <div
        className="flex items-end gap-1 overflow-x-auto pb-0 scrollbar-hide border-b-2 mb-6"
        style={{ borderColor: '#F06321' }}
      >
        {tabs.map(tab => {
          const isActive   = activeTab === tab.key
          const isDisabled = 'disabled' in tab && tab.disabled
          return (
            <button
              key={tab.key}
              disabled={isDisabled}
              onClick={() => !isDisabled && setActiveTab(tab.key as TabKey)}
              style={isActive
                ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                : undefined}
              className={cn(
                'shrink-0 px-4 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
                !isActive && !isDisabled && 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                !isActive && isDisabled && 'text-muted-foreground/30 cursor-not-allowed',
              )}
            >
              {tab.label}
            </button>
          )
        })}
        <div className="flex-1" />
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'teams' && (
        <TeamSetupView
          tournament={tournament}
          teams={teams}
          teamMatches={teamMatches}
          loadData={loadData}
          isPending={isPending}
          startTransition={startTransition}
          setLoading={setLoading}
          router={router}
          isGenerated={isGenerated}
          showSeedInput={showSeedInput}
          onNext={() => setActiveTab('schedule')}
        />
      )}

      {activeTab === 'schedule' && (
        <TeamScheduleView
          tournament={tournament}
          teams={teams}
          teamMatches={teamMatches}
          matchBase={matchBase}
          loadData={loadData}
          isPending={isPending}
          startTransition={startTransition}
          setLoading={setLoading}
          router={router}
          isGenerated={isGenerated}
          onNextKO={() => setActiveTab('knockout')}
        />
      )}

      {activeTab === 'knockout' && (
        <TeamKOView
          tournament={tournament}
          teams={teams}
          teamMatches={teamMatches}
          rrMatches={rrMatches}
          koMatches={koMatches}
          matchBase={matchBase}
          loadData={loadData}
          isPending={isPending}
          startTransition={startTransition}
          setLoading={setLoading}
          router={router}
          isRRKO={isRRKO}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared input class
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-orange-500/50 text-foreground ' +
  'placeholder:text-muted-foreground/60'

// ─────────────────────────────────────────────────────────────────────────────
// TeamForm — reusable for both Add and Edit
// ─────────────────────────────────────────────────────────────────────────────

function TeamForm({
  initialName = '',
  initialShort = '',
  initialColor = '#F06321',
  initialPlayers = ['', '', ''],
  initialSeed = null,
  initialDoublesP1 = null,
  initialDoublesP2 = null,
  showSeed = false,
  submitLabel,
  onCancel,
  onSave,
  isPending,
}: {
  initialName?:    string
  initialShort?:   string
  initialColor?:   string
  initialPlayers?: string[]
  initialSeed?:    number | null
  initialDoublesP1?: number | null
  initialDoublesP2?: number | null
  showSeed?:       boolean
  submitLabel:     string
  onCancel?:       () => void
  onSave:          (data: { name: string; short: string; color: string; players: string[]; seed: number | null; doublesP1Pos: number | null; doublesP2Pos: number | null }) => void
  isPending:       boolean
}) {
  const [name,    setName]    = useState(initialName)
  const [short,   setShort]   = useState(initialShort)
  const [color,   setColor]   = useState(initialColor)
  const [seedVal, setSeedVal] = useState<string>(initialSeed != null ? String(initialSeed) : '')
  const [doublesP1, setDoublesP1] = useState<number | null>(initialDoublesP1)
  const [doublesP2, setDoublesP2] = useState<number | null>(initialDoublesP2)
  const [players, setPlayers] = useState<string[]>(() => {
    const base = [...initialPlayers]
    while (base.length < 3) base.push('')
    return base
  })

  const setPlayer = (i: number, val: string) =>
    setPlayers(prev => { const n = [...prev]; n[i] = val; return n })
  const removePlayer = (i: number) =>
    setPlayers(prev => prev.filter((_, idx) => idx !== i))

  const namedPlayers = players.map((p, i) => ({ pos: i + 1, name: p.trim() })).filter(p => p.name)

  const handleSave = () => {
    if (!name.trim()) return
    const seed = seedVal.trim() !== '' ? parseInt(seedVal, 10) || null : null
    onSave({ name: name.trim(), short: short.trim(), color, players, seed, doublesP1Pos: doublesP1, doublesP2Pos: doublesP2 })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Team meta */}
      <div className={cn('grid grid-cols-1 gap-3 items-end', showSeed ? 'sm:grid-cols-[1fr_auto_auto_auto]' : 'sm:grid-cols-[1fr_auto_auto]')}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Team Name *
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="e.g. TT Lions"
            className={inputCls}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Short (opt)
          </label>
          <input
            value={short}
            onChange={e => setShort(e.target.value)}
            placeholder="TTL"
            className={cn(inputCls, 'sm:w-24')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Colour
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="h-9 w-12 rounded-lg border border-border cursor-pointer p-0.5"
            />
            <span className="text-xs font-mono text-muted-foreground">{color}</span>
          </div>
        </div>
        {showSeed && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Seed (opt)
            </label>
            <input
              type="number"
              min={1}
              value={seedVal}
              onChange={e => setSeedVal(e.target.value)}
              placeholder="e.g. 1"
              className={cn(inputCls, 'sm:w-20')}
            />
          </div>
        )}
      </div>

      {/* Players */}
      <div className="flex flex-col gap-2">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Players
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Position 1 is the top singles player.
          </p>
        </div>
        {players.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 text-xs font-mono text-muted-foreground/50 text-right shrink-0">
              {i + 1}
            </span>
            <input
              value={p}
              onChange={e => setPlayer(i, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder={
                i === 0 ? 'Player 1 — top singles (e.g. John Smith)' :
                i === 1 ? 'Player 2 (e.g. Alex Jones)' :
                i === 2 ? 'Player 3 (e.g. Sam Lee)' :
                          `Player ${i + 1} (optional)`
              }
              className={inputCls}
            />
            {players.length > 3 && (
              <button
                type="button"
                onClick={() => removePlayer(i)}
                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPlayers(p => [...p, ''])}
          className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-400 transition-colors self-start mt-1"
        >
          <Plus className="h-3 w-3" /> Add another player
        </button>
      </div>

      {/* Doubles designation */}
      {namedPlayers.length >= 2 && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Doubles Pair (opt)
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pre-assign your doubles players. They'll auto-fill the Doubles row in every fixture.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={doublesP1 ?? ''}
              onChange={e => setDoublesP1(e.target.value ? Number(e.target.value) : null)}
              className={cn(inputCls, 'sm:w-48')}
            >
              <option value="">Select player 1…</option>
              {namedPlayers.map(p => (
                <option key={p.pos} value={p.pos}>{p.pos}. {p.name}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">&amp;</span>
            <select
              value={doublesP2 ?? ''}
              onChange={e => setDoublesP2(e.target.value ? Number(e.target.value) : null)}
              className={cn(inputCls, 'sm:w-48')}
            >
              <option value="">Select player 2…</option>
              {namedPlayers.filter(p => p.pos !== doublesP1).map(p => (
                <option key={p.pos} value={p.pos}>{p.pos}. {p.name}</option>
              ))}
            </select>
            {(doublesP1 || doublesP2) && (
              <button
                type="button"
                onClick={() => { setDoublesP1(null); setDoublesP2(null) }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isPending || !name.trim()} className="gap-1.5">
          {isPending
            ? <span className="tt-spinner tt-spinner-sm" />
            : <Check className="h-3.5 w-3.5" />
          }
          {isPending ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Setup View
// ─────────────────────────────────────────────────────────────────────────────

function TeamSetupView({
  tournament, teams, teamMatches, loadData,
  isPending, startTransition, setLoading, router, isGenerated, showSeedInput, onNext,
}: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  teamMatches:     TeamMatchRich[]
  loadData:        () => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  isGenerated:     boolean
  showSeedInput:   boolean
  onNext?:         () => void
}) {
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [showAddForm,   setShowAddForm]   = useState(false)
  const [showImport,    setShowImport]    = useState(false)
  const [showReset,     setShowReset]     = useState(false)

  const teamMatchCount = (teams.length * (teams.length - 1)) / 2

  const handleAddTeam = ({ name, short, color, players, seed, doublesP1Pos, doublesP2Pos }: {
    name: string; short: string; color: string; players: string[]; seed: number | null; doublesP1Pos: number | null; doublesP2Pos: number | null
  }) => {
    setLoading(true)
    startTransition(async () => {
      const res = await createTeam({
        tournamentId: tournament.id, name, shortName: short || undefined, color,
        seed: seed ?? null, doublesP1Pos: doublesP1Pos ?? null, doublesP2Pos: doublesP2Pos ?? null,
      })
      if (res.error) {
        setLoading(false)
        toast({ title: 'Failed to create team', description: res.error, variant: 'destructive' })
        return
      }
      const filtered = players.map((n, i) => ({ name: n.trim(), position: i + 1 })).filter(p => p.name)
      if (filtered.length > 0 && res.teamId) {
        await upsertTeamPlayers({ tournamentId: tournament.id, teamId: res.teamId, players: filtered })
      }
      setLoading(false)
      setShowAddForm(false)
      await loadData()
      toast({ title: `Team "${name}" created` })
    })
  }

  const handleSavePlayers = (teamId: string) => ({ players, doublesP1Pos, doublesP2Pos }: {
    name: string; short: string; color: string; players: string[]; seed: number | null; doublesP1Pos: number | null; doublesP2Pos: number | null
  }) => {
    setLoading(true)
    startTransition(async () => {
      const filtered = players.map((n, i) => ({ name: n.trim(), position: i + 1 })).filter(p => p.name)
      const [pr, dr] = await Promise.all([
        upsertTeamPlayers({ tournamentId: tournament.id, teamId, players: filtered }),
        updateTeam({ teamId, tournamentId: tournament.id, doublesP1Pos, doublesP2Pos }),
      ])
      setLoading(false)
      if (pr.error || dr.error) {
        toast({ title: 'Failed to save', description: pr.error ?? dr.error, variant: 'destructive' })
        return
      }
      setEditingTeamId(null)
      await loadData()
      toast({ title: 'Players saved' })
    })
  }

  const handleDeleteTeam = (teamId: string, teamName: string) => {
    setLoading(true)
    startTransition(async () => {
      const res = await deleteTeam(teamId, tournament.id)
      setLoading(false)
      if (res.error) {
        toast({ title: 'Failed to delete team', description: res.error, variant: 'destructive' })
      } else {
        await loadData()
        toast({ title: `Team "${teamName}" deleted` })
      }
    })
  }

  const isKOFormat = tournament.format_type === 'team_league_ko'
  const isSwaythlingFormat = tournament.format_type === 'team_league_swaythling'
  const isAnyKOFormat = isKOFormat || isSwaythlingFormat

  const handleGenerate = () => {
    setLoading(true)
    startTransition(async () => {
      const res = isKOFormat
        ? await generateTeamKOBracket(tournament.id)
        : isSwaythlingFormat
        ? await generateTeamSwaythlingBracket(tournament.id)
        : await generateTeamSchedule(tournament.id)
      setLoading(false)
      if (res.error) {
        toast({ title: 'Generation failed', description: res.error, variant: 'destructive' })
      } else {
        await loadData(); router.refresh()
        toast({ title: isAnyKOFormat
          ? '✅ Bracket generated'
          : `✅ Schedule generated — ${(res as { teamMatchCount?: number }).teamMatchCount} fixtures`,
          variant: 'success',
        })
        onNext?.()
      }
    })
  }

  const handleReset = () => {
    setLoading(true); setShowReset(false)
    startTransition(async () => {
      const res = await resetTeamLeague(tournament.id)
      setLoading(false)
      if (res.error) {
        toast({ title: 'Reset failed', description: res.error, variant: 'destructive' })
      } else {
        await loadData(); router.refresh()
        toast({ title: 'Team league reset' })
      }
    })
  }

  if (showImport) {
    return (
      <BulkImportDialog
        tournamentId={tournament.id}
        existingTeamCount={teams.length}
        showSeedInput={showSeedInput}
        onClose={() => setShowImport(false)}
        onDone={async () => { setShowImport(false); await loadData(); router.refresh() }}
      />
    )
  }

  const canGenerate = teams.length >= 2 && !isGenerated

  return (
    <div className="flex flex-col gap-5">

      {/* Banner */}
      {teams.length === 0 ? (
        <NextStepBanner variant="action" step="Step 1" title="Create your first team"
          description="Enter a team name and players. You need at least 2 teams to generate the schedule." />
      ) : isGenerated ? (
        <NextStepBanner variant="action" title={isAnyKOFormat ? 'Bracket generated' : 'Schedule generated'}
          description={isAnyKOFormat
            ? `${teamMatches.length} fixtures created. View them in the Bracket tab.`
            : `${teamMatches.length} fixtures created. View them in the Schedule tab.`} />
      ) : teams.some(t => t.players.length === 0) ? (
        <NextStepBanner variant="warning" title="Assign players to all teams"
          description="Each team needs at least one player before generating the schedule." />
      ) : (
        <NextStepBanner variant="action" step="Step 2" title="Generate schedule"
          description={`${teams.length} teams → ${teamMatchCount} fixtures.`} />
      )}

      {/* Teams list */}
      {teams.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Teams ({teams.length})
            </h3>
            {!isGenerated && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={() => setShowImport(true)}>
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
            )}
          </div>

          {teams.map(team => (
            <Card key={team.id} className={cn(editingTeamId === team.id && 'ring-1 ring-orange-500/40')}>
              {editingTeamId === team.id ? (
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: team.color ?? '#F06321' }} />
                    <span className="text-sm font-semibold text-foreground">{team.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">Edit players</span>
                  </div>
                  <TeamForm
                    initialName={team.name}
                    initialShort={team.short_name ?? ''}
                    initialColor={team.color ?? '#F06321'}
                    initialPlayers={team.players.map(p => p.name)}
                    initialSeed={team.seed ?? null}
                    initialDoublesP1={team.doubles_p1_pos ?? null}
                    initialDoublesP2={team.doubles_p2_pos ?? null}
                    showSeed={showSeedInput}
                    submitLabel="Save Players"
                    onCancel={() => setEditingTeamId(null)}
                    onSave={handleSavePlayers(team.id)}
                    isPending={isPending}
                  />
                </CardContent>
              ) : (
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: team.color ?? '#F06321' }}>
                      {(team.short_name ?? team.name).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{team.name}</span>
                        {team.short_name && (
                          <span className="text-xs text-muted-foreground border border-border rounded px-1 py-0.5 font-mono">
                            {team.short_name}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                        {team.players.length === 0 ? (
                          <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> No players yet
                          </span>
                        ) : team.players.map(p => (
                          <span key={p.id} className="text-xs text-muted-foreground">
                            <span className="font-mono text-muted-foreground/40 mr-0.5">{p.position}.</span>
                            {p.name}
                          </span>
                        ))}
                      </div>
                      {(team.doubles_p1_pos || team.doubles_p2_pos) && (() => {
                        const d1 = team.players.find(p => p.position === team.doubles_p1_pos)
                        const d2 = team.players.find(p => p.position === team.doubles_p2_pos)
                        return (d1 || d2) ? (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">Doubles:</span>
                            <span className="text-xs text-muted-foreground">
                              {[d1?.name, d2?.name].filter(Boolean).join(' & ')}
                            </span>
                          </div>
                        ) : null
                      })()}
                    </div>
                    {!isGenerated && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                          onClick={() => setEditingTeamId(team.id)}>
                          <Pencil className="h-3 w-3" />
                          <span className="hidden sm:inline">Players</span>
                        </Button>
                        <button
                          onClick={() => handleDeleteTeam(team.id, team.name)}
                          className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete team"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Add team */}
      {!isGenerated && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-orange-500" />
                {showAddForm ? 'New Team' : 'Add Team'}
              </span>
              {!showAddForm && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => setShowImport(true)}>
                    <Upload className="h-3.5 w-3.5" /> Bulk Import
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => setShowAddForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          {showAddForm && (
            <CardContent>
              <TeamForm
                initialColor={pickColor(teams.length)}
                showSeed={showSeedInput}
                submitLabel="Create Team"
                onCancel={() => setShowAddForm(false)}
                onSave={handleAddTeam}
                isPending={isPending}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Generate */}
      {canGenerate && (
        <Button onClick={handleGenerate} disabled={isPending} size="lg" className="gap-2 w-full">
          {isPending
            ? <><span className="tt-spinner tt-spinner-sm" /> Generating…</>
            : <><PlayCircle className="h-5 w-5" /> {isKOFormat ? 'Generate Corbillon Cup Bracket' : isSwaythlingFormat ? 'Generate Swaythling Cup Bracket' : 'Generate Team Schedule'}</>
          }
        </Button>
      )}

      {/* Reset */}
      {isGenerated && (
        <div className="mt-1">
          {!showReset ? (
            <button onClick={() => setShowReset(true)}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors">
              Reset schedule &amp; start over…
            </button>
          ) : (
            <Card className="border-destructive/40">
              <CardContent className="p-4 flex flex-col gap-3">
                <p className="text-sm font-semibold text-destructive">
                  ⚠️ This will delete all fixtures and scores. Are you sure?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowReset(false)}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={handleReset} disabled={isPending}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Schedule View
// ─────────────────────────────────────────────────────────────────────────────

function TeamScheduleView({
  tournament, teams, teamMatches, matchBase, isGenerated,
  loadData, isPending, startTransition, setLoading, router, onNextKO,
}: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  teamMatches:     TeamMatchRich[]
  matchBase:       string
  loadData:        () => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  isGenerated:     boolean
  onNextKO?:       () => void
}) {
  const searchParams  = useSearchParams()
  const initRound     = Number(searchParams.get('round') ?? 1)
  const highlightFix  = searchParams.get('fix') ?? ''

  const [openFixtures, setOpenFixtures] = useState<Set<number>>(new Set([initRound]))

  const rrMatches     = teamMatches.filter(m => m.round < 900)
  const allRRDone     = rrMatches.length > 0 && rrMatches.every(m => m.status === 'complete')
  const koExists      = teamMatches.some(m => m.round >= 900)
  const isRRKO        = tournament.format_type === 'team_league'
  const canGenKO      = isRRKO && allRRDone && !koExists

  const handleGenKO = () => {
    setLoading(true)
    startTransition(async () => {
      const res = await generateTeamRRKnockout(tournament.id, 4)
      setLoading(false)
      if (res.error) {
        toast({ title: 'Could not generate knockout', description: res.error, variant: 'destructive' })
      } else {
        await loadData(); router.refresh()
        toast({ title: '✅ Knockout phase generated — Semi-Finals + Final', variant: 'success' })
        onNextKO?.()
      }
    })
  }

  if (!isGenerated || teamMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Shield className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm font-medium">Schedule not yet generated.</p>
        <p className="text-muted-foreground text-xs">
          Go to the Teams tab to create teams, add players, then generate the schedule.
        </p>
      </div>
    )
  }

  const standings = teams.map(team => {
    const matches = teamMatches.filter(m =>
      (m.team_a_id === team.id || m.team_b_id === team.id) && m.status === 'complete')
    const wins   = matches.filter(m => m.winner_team_id === team.id).length
    const losses = matches.length - wins

    // Tiebreaker 1: submatch (individual game) wins within all team matches
    let submatchWins = 0
    let submatchLosses = 0
    // Tiebreaker 2: net game difference across submatches
    let gameDiff = 0

    for (const m of teamMatches.filter(tm =>
      tm.team_a_id === team.id || tm.team_b_id === team.id
    )) {
      const isTeamA = m.team_a_id === team.id
      for (const sm of m.submatches ?? []) {
        const sc = sm.scoring
        if (!sc || sc.status !== 'complete') continue
        const ourGames  = isTeamA ? sc.player1_games : sc.player2_games
        const theirGames = isTeamA ? sc.player2_games : sc.player1_games
        if (ourGames > theirGames) submatchWins++
        else submatchLosses++
        gameDiff += (ourGames - theirGames)
      }
    }

    return { team, played: matches.length, wins, losses, submatchWins, submatchLosses, gameDiff }
  }).sort((a, b) =>
    // 1. Team wins
    b.wins - a.wins ||
    // 2. Individual submatch wins
    b.submatchWins - a.submatchWins ||
    // 3. Net game difference
    b.gameDiff - a.gameDiff ||
    // 4. Alphabetical (stable)
    a.team.name.localeCompare(b.team.name)
  )

  // Only RR rounds in the schedule tab — KO rounds belong in the Knockout tab
  const rounds = Array.from(
    rrMatches.reduce<Map<number, TeamMatchRich[]>>((map, m) => {
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
      return map
    }, new Map()).entries()
  ).sort(([a], [b]) => a - b)

  const doneCount  = rrMatches.filter(m => m.status === 'complete').length
  const totalCount = rrMatches.length

  const toggleFixture = (round: number) =>
    setOpenFixtures(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })

  return (
    <div className="flex flex-col gap-6">

      {/* Progress bar */}
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">League Progress</span>
            <span className="text-xs text-muted-foreground">{doneCount}/{totalCount} ties complete</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-orange-500 transition-all duration-500"
              style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }} />
          </div>
        </CardContent>
      </Card>

      {/* Standings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" /> Team Standings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground w-8">#</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">Team</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground" title="Ties played">P</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground" title="Tie wins">W</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground" title="Tie losses">L</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground" title="Individual match wins (tiebreaker 1)">SW</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground" title="Net game difference (tiebreaker 2)">GD</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => (
                  <tr key={row.team.id} className={cn(
                    'border-b border-border/50',
                    i === 0 && standings[0].wins > 0 && 'bg-amber-50/40 dark:bg-amber-900/10',
                  )}>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {i === 0 && standings[0].wins > 0 && (
                          <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        <div className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: row.team.color ?? '#F06321' }} />
                        <span className="font-medium text-sm">{row.team.name}</span>
                        {row.team.short_name && (
                          <span className="text-xs text-muted-foreground">({row.team.short_name})</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.played}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">{row.wins}</td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.losses}</td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.submatchWins}</td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground font-mono">
                      {row.gameDiff > 0 ? `+${row.gameDiff}` : row.gameDiff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Generate Knockout Phase — shown when all RR done */}
      {isRRKO && (
        <Card className={cn(
          'border-2 transition-colors',
          canGenKO ? 'border-orange-400 dark:border-orange-600 bg-orange-50/40 dark:bg-orange-950/20' :
          koExists  ? 'border-emerald-300 dark:border-emerald-700/50' : 'border-border opacity-60',
        )}>
          <CardContent className="p-4 flex items-center gap-4">
            <Trophy className={cn('h-6 w-6 shrink-0', canGenKO ? 'text-orange-500' : koExists ? 'text-emerald-500' : 'text-muted-foreground/40')} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground">Knockout Phase</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {koExists
                  ? 'Semi-Finals & Final generated. Go to the Knockout tab.'
                  : canGenKO
                  ? 'All Round Robin matches complete. Ready to generate Semi-Finals & Final.'
                  : 'Complete all Round Robin matches first.'}
              </p>
            </div>
            {canGenKO && (
              <Button size="sm" onClick={handleGenKO} disabled={isPending}
                className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white shrink-0">
                <PlayCircle className="h-4 w-4" /> Generate KO
              </Button>
            )}
            {koExists && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase shrink-0">✓ Generated</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Next match to enter ── */}
      {(() => {
        const nextMatch = teamMatches
          .filter(m => m.round < 900 && m.status !== 'complete')
          .sort((a, b) => a.round - b.round || 0)[0]
        if (!nextMatch) return null
        const tA = nextMatch.team_a
        const tB = nextMatch.team_b
        const nextSub = nextMatch.submatches?.find(s => s.match_id && !s.scoring?.status?.includes('complete'))
        const scoreHref = nextSub?.match_id
          ? `${matchBase}/${nextSub.match_id}?round=${nextMatch.round}&fix=${nextMatch.id}`
          : null

        return (
          <div className="rounded-xl border-2 border-orange-400 dark:border-orange-600 bg-orange-50/40 dark:bg-orange-950/20 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide mb-1">
                ▶ Up Next — Round {nextMatch.round}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {tA && (
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tA.color ?? '#F06321' }} />
                    {tA.short_name ?? tA.name}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">vs</span>
                {tB && (
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tB.color ?? '#6366f1' }} />
                    {tB.short_name ?? tB.name}
                  </span>
                )}
                {nextSub && (
                  <span className="text-xs text-muted-foreground">— {nextSub.label}</span>
                )}
              </div>
            </div>
            {scoreHref && (
              <a
                href={scoreHref}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl px-4 py-2 transition-colors shrink-0"
              >
                Enter Scores →
              </a>
            )}
          </div>
        )
      })()}

      {/* Fixtures */}
      <div className="flex flex-col gap-2">
        <h3 className={T.roundHeading}>Fixtures</h3>
        {rounds.map(([round, fixtures]) => {
          const isOpen = openFixtures.has(round)
          const done   = fixtures.filter(f => f.status === 'complete').length
          const live   = fixtures.filter(f => f.status === 'live').length
          return (
            <Card key={round}>
              <button
                onClick={() => toggleFixture(round)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="font-semibold text-sm text-foreground flex-1">Round {round}</span>
                {live > 0 && <span className="live-dot" />}
                {done === fixtures.length && done > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Done
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{done}/{fixtures.length}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3 border-t border-border/40 pt-3">
                  {fixtures.map(tm => (
                    <TeamMatchAdminCard
                      key={tm.id}
                      teamMatch={tm}
                      matchBase={matchBase}
                      tournamentId={tournament.id}
                      highlightFix={highlightFix as string}
                    />
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Team KO Bracket Tab
// Uses round tabs (like BracketView) + expandable team-match cards with
// per-submatch player selection and auto-assign from position slots.
// ─────────────────────────────────────────────────────────────────────────────

// ── Player auto-assign helper ────────────────────────────────────────────────
// Given a submatch label like "Singles 1 (A vs X)" or "Doubles (A/B vs X/Y)",
// returns the default player id for side 'A' (left team) or 'B' (right team).
function autoAssignPlayerId(
  label:          string,
  side:           'A' | 'B',
  doubleSlot:     1 | 2 | null,   // non-null only for doubles rows
  players:        TeamPlayer[],
  doublesP1Pos:   number | null,
  doublesP2Pos:   number | null,
): string | null {
  const isDoubles = label.toLowerCase().includes('doubles')
  if (isDoubles && doubleSlot !== null) {
    const preferredPos = doubleSlot === 1 ? doublesP1Pos : doublesP2Pos
    const fallbackPos  = doubleSlot === 1 ? 1 : 2
    const p = players.find(pl => pl.position === (preferredPos ?? fallbackPos))
    return p?.id ?? null
  }
  // Extract "(A vs X)" or "(A/B vs X/Y)" from label
  const m = label.match(/\(([A-Z/]+)\s+vs\s+([A-Z/]+)\)/)
  if (!m) return null
  const letterMap: Record<string, number> = { A: 1, B: 2, C: 3, X: 1, Y: 2, Z: 3 }
  const letter = side === 'A' ? m[1][0] : m[2][0]
  const pos    = letterMap[letter] ?? 1
  return players.find(pl => pl.position === pos)?.id ?? null
}

// ── Build default draft for a set of submatches ──────────────────────────────
function buildDefaultDraft(
  subs:     Submatch[],
  playersA: TeamPlayer[],
  playersB: TeamPlayer[],
  teamA:    TeamWithPlayers | null,
  teamB:    TeamWithPlayers | null,
): Record<string, { teamAPlayerId: string | null; teamBPlayerId: string | null; teamAPlayer2Id: string | null; teamBPlayer2Id: string | null }> {
  return Object.fromEntries(subs.map(s => {
    const isDoubles = s.label.toLowerCase().includes('doubles')
    // If already assigned, keep; otherwise auto-assign
    const aId  = s.team_a_player_id  ?? autoAssignPlayerId(s.label, 'A', isDoubles ? 1 : null, playersA, teamA?.doubles_p1_pos ?? null, teamA?.doubles_p2_pos ?? null)
    const bId  = s.team_b_player_id  ?? autoAssignPlayerId(s.label, 'B', isDoubles ? 1 : null, playersB, teamB?.doubles_p1_pos ?? null, teamB?.doubles_p2_pos ?? null)
    const a2Id = s.team_a_player2_id ?? (isDoubles ? autoAssignPlayerId(s.label, 'A', 2, playersA, teamA?.doubles_p1_pos ?? null, teamA?.doubles_p2_pos ?? null) : null)
    const b2Id = s.team_b_player2_id ?? (isDoubles ? autoAssignPlayerId(s.label, 'B', 2, playersB, teamB?.doubles_p1_pos ?? null, teamB?.doubles_p2_pos ?? null) : null)
    return [s.id, { teamAPlayerId: aId, teamBPlayerId: bId, teamAPlayer2Id: a2Id, teamBPlayer2Id: b2Id }]
  }))
}

function TeamKOView({
  tournament, teams, teamMatches, rrMatches, koMatches, matchBase,
  loadData, isPending, startTransition, setLoading, router, isRRKO,
}: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  teamMatches:     TeamMatchRich[]
  rrMatches:       TeamMatchRich[]
  koMatches:       TeamMatchRich[]
  matchBase:       string
  loadData:        (silent?: boolean) => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  isRRKO:          boolean
}) {
  const isCorbillon  = tournament.format_type === 'team_league_ko'
  const isSwaythling = tournament.format_type === 'team_league_swaythling'

  // ── Empty state ────────────────────────────────────────────────────────────
  if (koMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Trophy className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm font-medium">
          {isRRKO ? 'Knockout phase not yet generated.' : 'No bracket generated yet.'}
        </p>
        <p className="text-muted-foreground text-xs">
          {isRRKO
            ? 'Complete all Round Robin matches first, then generate from the RR Schedule tab.'
            : 'Go to the Teams tab to add teams, then generate the bracket.'}
        </p>
      </div>
    )
  }

  // ── Group KO matches by round ──────────────────────────────────────────────
  const roundEntries = Array.from(
    koMatches.reduce<Map<number, TeamMatchRich[]>>((map, m) => {
      if (!map.has(m.round)) map.set(m.round, [])
      map.get(m.round)!.push(m)
      return map
    }, new Map()).entries()
  ).sort(([a], [b]) => a - b)

  const totalRounds = roundEntries.length

  // Find the "latest active" round (live → last incomplete → last)
  const latestRound = (() => {
    const liveRnd = koMatches.find(m => m.status === 'live')?.round
    if (liveRnd) return liveRnd
    const incomplete = koMatches.filter(m => m.status !== 'complete')
    if (incomplete.length) return Math.min(...incomplete.map(m => m.round))
    return roundEntries[roundEntries.length - 1]?.[0] ?? koMatches[0].round
  })()

  return (
    <TeamKOBracketUI
      tournament={tournament}
      koMatches={koMatches}
      roundEntries={roundEntries}
      totalRounds={totalRounds}
      latestRound={latestRound}
      matchBase={matchBase}
      tournamentId={tournament.id}
      isCorbillon={isCorbillon}
      isSwaythling={isSwaythling}
      isRRKO={isRRKO}
      loadData={loadData}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamKOBracketUI — the actual bracket UI with round tabs + expandable cards
// ─────────────────────────────────────────────────────────────────────────────

function TeamKOBracketUI({
  tournament, koMatches, roundEntries, totalRounds, latestRound,
  matchBase, tournamentId, isCorbillon, isSwaythling, isRRKO, loadData,
}: {
  tournament:   Tournament
  koMatches:    TeamMatchRich[]
  roundEntries: [number, TeamMatchRich[]][]
  totalRounds:  number
  latestRound:  number
  matchBase:    string
  tournamentId: string
  isCorbillon:  boolean
  isSwaythling: boolean
  isRRKO:       boolean
  loadData:     (silent?: boolean) => Promise<void>
}) {
  const searchParams = useSearchParams()
  // Restore the round the admin was viewing when they navigated to a match page
  const urlRound = Number(searchParams.get('round') ?? 0)
  const validRounds = new Set(roundEntries.map(([r]) => r))
  const initRound = (urlRound && validRounds.has(urlRound)) ? urlRound : latestRound

  const [activeRound, setActiveRound] = useState<number>(initRound)
  // Highlight the specific team match the admin came back from
  const highlightFix = searchParams.get('fix') ?? ''

  // Keep in sync if data refreshes and latestRound changes
  const prevLatest = useRef(latestRound)
  useEffect(() => {
    if (prevLatest.current !== latestRound) {
      prevLatest.current = latestRound
      // Only auto-update if the user is not looking at a specific URL-driven round
      if (!urlRound) setActiveRound(latestRound)
    }
  }, [latestRound, urlRound])

  const rawActiveMatches = roundEntries.find(([r]) => r === activeRound)?.[1] ?? []
  const activeMatches = [...rawActiveMatches].sort((a, b) => {
    const o = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
    return o(a.status) - o(b.status)
  })
  const doneCount     = koMatches.filter(m => m.status === 'complete').length
  const liveCount     = koMatches.filter(m => m.status === 'live').length

  // Tab label mapping (Final, Semi-Finals, etc.)
  const getRoundLabel = (roundNum: number, idx: number) => {
    const fromEnd = totalRounds - idx
    if (fromEnd === 1) return '🏆 Final'
    if (fromEnd === 2) return 'Semi-Finals'
    if (fromEnd === 3) return 'Quarter-Finals'
    return `Round of ${Math.pow(2, fromEnd)}`
  }

  const formatTitle = isCorbillon ? 'Corbillon Cup' : isSwaythling ? 'Swaythling Cup' : isRRKO ? 'Knockout Phase' : 'Team Knockout'

  return (
    <div className="flex flex-col gap-0">

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Swords className="h-5 w-5 text-amber-500" />
        <div className="flex-1">
          <h2 className="font-bold text-base text-foreground">{formatTitle}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {doneCount}/{koMatches.length} matches complete
            {liveCount > 0 && <span className="ml-2 text-orange-500 font-semibold">· {liveCount} live</span>}
          </p>
        </div>
      </div>

      {/* ── Round tabs (same orange style as BracketView) ── */}
      <div
        className="flex items-end gap-1 overflow-x-auto pb-0 scrollbar-hide border-b-2 mb-5"
        style={{ borderColor: '#F06321' }}
      >
        {roundEntries.map(([roundNum, matches], idx) => {
          const isActive   = activeRound === roundNum
          const liveInRound = matches.filter(m => m.status === 'live').length
          const doneInRound = matches.filter(m => m.status === 'complete').length
          const label      = getRoundLabel(roundNum, idx)
          const isLatest   = roundNum === latestRound

          return (
            <button
              key={roundNum}
              onClick={() => setActiveRound(roundNum)}
              style={isActive
                ? { background: '#F06321', color: '#fff', border: '2px solid #F06321', borderBottom: 'none' }
                : undefined}
              className={cn(
                'shrink-0 px-4 pt-2 pb-2 text-sm font-bold transition-all rounded-t-lg whitespace-nowrap',
                !isActive && isLatest && 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-2 border-b-0 border-orange-300 dark:border-orange-600/50',
                !isActive && !isLatest && 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              )}
            >
              {label}
              {liveInRound > 0 && (
                <span
                  className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: isActive ? 'rgba(255,255,255,0.35)' : '#F06321', color: '#fff' }}
                >
                  {liveInRound}
                </span>
              )}
              {doneInRound === matches.length && doneInRound > 0 && !isActive && (
                <span className="ml-1 text-[10px] font-bold text-emerald-500">✓</span>
              )}
            </button>
          )
        })}
        <div className="flex-1" />
      </div>

      {/* ── Active round matches ── */}
      <div className="flex flex-col gap-3">
        {activeMatches.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-sm">No matches in this round.</div>
        )}
        {activeMatches.map(tm => (
          <TeamMatchBracketCard
            key={tm.id}
            teamMatch={tm}
            matchBase={matchBase}
            tournamentId={tournamentId}
            isCorbillon={isCorbillon}
            highlightFix={highlightFix as string}
            loadData={loadData}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamMatchBracketCard
// Expandable card: header shows Team A vs Team B + scores.
// Expanded: per-submatch rows with player selectors + score links.
// Auto-assigns players from positions (A=1, B=2, C=3) on first open.
// ─────────────────────────────────────────────────────────────────────────────

function TeamMatchBracketCard({
  teamMatch, matchBase, tournamentId, isCorbillon, highlightFix, loadData,
}: {
  teamMatch:    TeamMatchRich
  matchBase:    string
  tournamentId: string
  isCorbillon:  boolean
  highlightFix?: string
  loadData?:    (silent?: boolean) => Promise<void>
}) {
  // Auto-expand this card if the admin just came back from one of its sub-matches
  const isHighlighted = !!highlightFix && highlightFix === teamMatch.id
  const [open, setOpen]      = useState(isHighlighted)
  const [expandedSub, setExpandedSub] = useState<string | null>(null)
  const [isPending, startTx] = useTransition()
  const { setLoading }       = useLoading()
  const router               = useRouter()

  const teamA  = teamMatch.team_a as (typeof teamMatch.team_a & { doubles_p1_pos?: number | null; doubles_p2_pos?: number | null }) | null
  const teamB  = teamMatch.team_b as (typeof teamMatch.team_b & { doubles_p1_pos?: number | null; doubles_p2_pos?: number | null }) | null
  const isLive = teamMatch.status === 'live'
  const isDone = teamMatch.status === 'complete'
  const subs   = [...(teamMatch.submatches ?? [])].sort((a, b) => a.match_order - b.match_order)
  const aWon   = isDone && teamMatch.winner_team_id === teamA?.id
  const bWon   = isDone && teamMatch.winner_team_id === teamB?.id

  const playersA: TeamPlayer[] = (teamA as unknown as { players?: TeamPlayer[] })?.players ?? []
  const playersB: TeamPlayer[] = (teamB as unknown as { players?: TeamPlayer[] })?.players ?? []

  // ── Draft state ────────────────────────────────────────────────────────────
  type DraftRow = { teamAPlayerId: string | null; teamBPlayerId: string | null; teamAPlayer2Id: string | null; teamBPlayer2Id: string | null }

  const buildDraft = useCallback(
    () => buildDefaultDraft(
      subs, playersA, playersB,
      teamA as TeamWithPlayers | null,
      teamB as TeamWithPlayers | null,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subs.map(s => [s.id, s.team_a_player_id, s.team_b_player_id, s.team_a_player2_id, s.team_b_player2_id].join(',')).join('|')]
  )

  const [draft, setDraft] = useState<Record<string, DraftRow>>(buildDraft)
  useEffect(() => { setDraft(buildDraft()) }, [buildDraft])

  // isDirty = draft differs from what's actually saved in DB.
  // This means Save shows when auto-assigned players haven't been confirmed yet.
  const isDirty = subs.some(s => {
    const d = draft[s.id]; if (!d) return false
    return d.teamAPlayerId  !== (s.team_a_player_id  ?? null) ||
           d.teamBPlayerId  !== (s.team_b_player_id  ?? null) ||
           d.teamAPlayer2Id !== (s.team_a_player2_id ?? null) ||
           d.teamBPlayer2Id !== (s.team_b_player2_id ?? null)
  })

  // Auto-save player assignments the first time the card is opened so the
  // scoring page shows real names instead of "TBD".
  const autoSavedRef   = useRef(false)
  const [autoSaving, setAutoSaving] = useState(false)

  useEffect(() => {
    if (open && isDirty && !autoSavedRef.current && !isPending) {
      autoSavedRef.current = true
      setAutoSaving(true)
      setLoading(true)
      startTx(async () => {
        await batchUpdateSubmatchPlayers({
          tournamentId,
          submatches: subs.map(s => ({
            submatchId:     s.id,
            teamAPlayerId:  draft[s.id]?.teamAPlayerId  ?? null,
            teamBPlayerId:  draft[s.id]?.teamBPlayerId  ?? null,
            teamAPlayer2Id: draft[s.id]?.teamAPlayer2Id ?? null,
            teamBPlayer2Id: draft[s.id]?.teamBPlayer2Id ?? null,
          })),
        })
        // Use silent refresh so the spinner doesn't flash and collapse all cards
        loadData && await loadData(true)
        setLoading(false)
        setAutoSaving(false)
      })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (subId: string, field: keyof DraftRow, value: string | null) =>
    setDraft(prev => ({ ...prev, [subId]: { ...prev[subId], [field]: value } }))

  const handleSave = () => {
    setLoading(true)
    startTx(async () => {
      const res = await batchUpdateSubmatchPlayers({
        tournamentId,
        submatches: subs.map(s => ({
          submatchId:     s.id,
          teamAPlayerId:  draft[s.id]?.teamAPlayerId  ?? null,
          teamBPlayerId:  draft[s.id]?.teamBPlayerId  ?? null,
          teamAPlayer2Id: draft[s.id]?.teamAPlayer2Id ?? null,
          teamBPlayer2Id: draft[s.id]?.teamBPlayer2Id ?? null,
        })),
      })
      setLoading(false)
      if (res.error) {
        toast({ title: 'Could not save players', description: res.error, variant: 'destructive' })
      } else {
        toast({ title: 'Players saved ✓' })
        loadData && await loadData(true)
      }
    })
  }

  // Completion counts
  const subsDone = subs.filter(s => s.scoring?.status === 'complete').length
  const subsLive = subs.filter(s => s.scoring?.status === 'live').length

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden transition-all duration-150',
      isDone  && 'bg-slate-100/80 dark:bg-slate-800/40 border-border/40',
      isLive  && !isDone && 'bg-card border-orange-400 dark:border-orange-500 shadow-md shadow-orange-100 dark:shadow-orange-950/30',
      !isLive && !isDone && 'bg-card border-border',
      isHighlighted && 'ring-2 ring-orange-400/50',
    )}>
      {/* ── Match header (always visible) ─────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3.5 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Teams + score */}
          <div className="flex-1 min-w-0">
            {/* Two-line: Team A row / Team B row with aligned score column */}
            <div className="grid" style={{ gridTemplateColumns: '1fr 2.5rem' }}>
              {/* Team A */}
              <div className="flex items-center gap-1.5 min-w-0 pr-2 py-0.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamA?.color ?? '#F06321' }} />
                <WinnerTrophy show={aWon} size="sm" />
                <span className={cn('text-sm truncate',
                  aWon ? 'font-bold text-foreground' :
                  bWon ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
                )}>
                  {teamA?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
                </span>
              </div>
              <span className={cn('font-mono font-bold tabular-nums text-base text-center self-center',
                aWon ? 'font-bold text-foreground' : 'text-muted-foreground/50',
              )}>{teamMatch.team_a_score}</span>
            </div>
            <div className="border-b border-border/20 my-0.5" />
            <div className="grid" style={{ gridTemplateColumns: '1fr 2.5rem' }}>
              {/* Team B */}
              <div className="flex items-center gap-1.5 min-w-0 pr-2 py-0.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamB?.color ?? '#6366f1' }} />
                <WinnerTrophy show={bWon} size="sm" />
                <span className={cn('text-sm truncate',
                  bWon ? 'font-bold text-foreground' :
                  aWon ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
                )}>
                  {teamB?.name ?? <span className="italic text-muted-foreground/50">TBD</span>}
                </span>
              </div>
              <span className={cn('font-mono font-bold tabular-nums text-base text-center self-center',
                bWon ? 'font-bold text-foreground' : 'text-muted-foreground/50',
              )}>{teamMatch.team_b_score}</span>
            </div>

            {/* Sub-match progress */}
            <div className="flex items-center gap-2 mt-1.5">
              {isLive && <span className="flex items-center gap-1 text-[11px] font-bold text-orange-500"><span className="live-dot" /> Live</span>}
              {isDone && <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Complete</span>}
              {!isLive && !isDone && (
                <span className="text-[11px] text-muted-foreground">
                  {subsDone}/{subs.length} matches done
                  {subsLive > 0 && <span className="ml-1 text-orange-500 font-semibold">· {subsLive} live</span>}
                </span>
              )}
              {isDone && subsDone > 0 && (
                <span className="text-[11px] text-muted-foreground">{subsDone}/{subs.length} matches</span>
              )}
            </div>
          </div>

          {/* Expand toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {open ? 'Hide' : 'Show'} matches
            </span>
            {open
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />
            }
          </div>
        </div>
      </button>

      {/* Live progress bar */}
      {isLive && (
        <div className="h-0.5" style={{
          background: 'linear-gradient(90deg, #F06321, #F5853F, #F06321)',
          animation: 'animate-pulse-slow 2s ease-in-out infinite',
        }} />
      )}

      {/* ── Expanded: sub-match details ────────────────────────────────── */}
      {open && (
        <div className="border-t border-border/50">
          {/* Column headers (desktop) */}
          <div className="hidden sm:grid sm:grid-cols-[7rem_1fr_3rem_1fr_6rem] gap-2 px-4 pt-3 pb-1.5 items-center bg-muted/20">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Match</span>
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: teamA?.color ?? '#F06321' }}>
              {teamA?.name ?? 'Team A'}
            </span>
            <span />
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: teamB?.color ?? '#6366f1' }}>
              {teamB?.name ?? 'Team B'}
            </span>
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide text-right">Score</span>
          </div>

          <div className="divide-y divide-border/30">
            {subs.map(sm => {
              const isDoubles = sm.label.toLowerCase().includes('doubles')
              const scoring   = sm.scoring
              const smDone    = scoring?.status === 'complete'
              const smLive    = scoring?.status === 'live'
              const p1g       = scoring?.player1_games ?? 0
              const p2g       = scoring?.player2_games ?? 0
              const smAWon    = smDone && p1g > p2g
              const smBWon    = smDone && p2g > p1g
              const scoreHref = sm.match_id ? `${matchBase}/${sm.match_id}?round=${teamMatch.round}&fix=${teamMatch.id}` : null
              const d         = draft[sm.id] ?? { teamAPlayerId: null, teamBPlayerId: null, teamAPlayer2Id: null, teamBPlayer2Id: null }

              return (
                <div key={sm.id} className={cn(
                  'px-4 py-3',
                  smLive && 'bg-orange-50/30 dark:bg-orange-950/10',
                  smDone && 'bg-muted/10',
                )}>
                  {/* Mobile label */}
                  <p className="sm:hidden text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                    {sm.label}
                    {isDoubles && <span className="ml-1.5 text-indigo-500 text-[10px]">Doubles</span>}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-[7rem_1fr_3rem_1fr_6rem] gap-2 items-start">
                    {/* Match label (desktop) */}
                    <div className="hidden sm:flex items-start pt-1">
                      <span className="text-xs font-semibold text-foreground/80 leading-tight">{sm.label}</span>
                    </div>

                    {/* Team A player selector(s) */}
                    <div className="flex flex-col gap-1.5">
                      <PlayerSelect
                        players={playersA}
                        value={d.teamAPlayerId}
                        placeholder="Select player…"
                        accentColor={teamA?.color ?? '#F06321'}
                        disabled={smDone || isPending}
                        winner={smAWon}
                        onChange={id => setField(sm.id, 'teamAPlayerId', id)}
                      />
                      {isDoubles && (
                        <PlayerSelect
                          players={playersA}
                          value={d.teamAPlayer2Id}
                          placeholder="Partner…"
                          accentColor={teamA?.color ?? '#F06321'}
                          disabled={smDone || isPending}
                          winner={smAWon}
                          onChange={id => setField(sm.id, 'teamAPlayer2Id', id)}
                        />
                      )}
                    </div>

                    {/* vs */}
                    <div className="hidden sm:flex items-center justify-center pt-1.5">
                      <span className="text-[11px] font-bold text-muted-foreground/60">vs</span>
                    </div>

                    {/* Team B player selector(s) */}
                    <div className="flex flex-col gap-1.5">
                      <PlayerSelect
                        players={playersB}
                        value={d.teamBPlayerId}
                        placeholder="Select player…"
                        accentColor={teamB?.color ?? '#6366f1'}
                        disabled={smDone || isPending}
                        winner={smBWon}
                        onChange={id => setField(sm.id, 'teamBPlayerId', id)}
                      />
                      {isDoubles && (
                        <PlayerSelect
                          players={playersB}
                          value={d.teamBPlayer2Id}
                          placeholder="Partner…"
                          accentColor={teamB?.color ?? '#6366f1'}
                          disabled={smDone || isPending}
                          winner={smBWon}
                          onChange={id => setField(sm.id, 'teamBPlayer2Id', id)}
                        />
                      )}
                    </div>

                    {/* Score + inline scorer toggle */}
                    <div className="flex sm:flex-col sm:items-end items-center gap-2 sm:gap-1 pt-0.5">
                      {scoring && (
                        <div className={cn(
                          'flex items-center gap-1 text-xs font-mono font-bold tabular-nums',
                          smDone ? 'text-foreground' : smLive ? 'text-orange-500' : 'text-muted-foreground/50',
                        )}>
                          {smLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0" />}
                          <span className={smAWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p1g}</span>
                          <span className="text-muted-foreground/40">–</span>
                          <span className={smBWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p2g}</span>
                          {smDone && <Check className="h-3 w-3 text-emerald-500 ml-0.5" />}
                        </div>
                      )}
                      {sm.match_id ? (
                        <button
                          onClick={() => setExpandedSub(expandedSub === sm.id ? null : sm.id)}
                          className={cn(
                            'inline-flex items-center justify-center text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap',
                            smDone
                              ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                              : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30',
                          )}
                        >
                          {expandedSub === sm.id ? 'Close ↑' : smDone ? 'Edit →' : 'Score →'}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </div>

                  {/* Mobile: "vs" label between player selectors */}
                  <p className="sm:hidden text-center text-[11px] text-muted-foreground mt-1.5">
                    <span style={{ color: teamA?.color ?? '#F06321' }}>{teamA?.short_name ?? teamA?.name ?? 'A'}</span>
                    {' '}vs{' '}
                    <span style={{ color: teamB?.color ?? '#6366f1' }}>{teamB?.short_name ?? teamB?.name ?? 'B'}</span>
                  </p>

                  {/* Inline rubber scorer — shows when Score/Edit button is clicked */}
                  {expandedSub === sm.id && sm.match_id && (
                    <div className="mt-3 col-span-full">
                      <RubberScorer
                        submatch={sm}
                        nameA={sm.player_a_name ?? (teamA?.name ?? 'Team A')}
                        nameB={sm.player_b_name ?? (teamB?.name ?? 'Team B')}
                        tournamentId={tournamentId}
                        matchFormat={(teamMatch as any).match_format ?? 'bo5'}
                        onSaved={() => setExpandedSub(null)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {subs.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No sub-matches yet.</div>
          )}

          {/* ── Save / auto-save hint ─────────────────────────────────── */}
          <div className={cn(
            'flex items-center justify-between px-4 py-3 border-t border-border/40',
            isDirty || autoSaving ? 'bg-amber-50/40 dark:bg-amber-950/20' : 'bg-muted/10',
          )}>
            <p className="text-[11px] text-muted-foreground">
              {autoSaving
                ? '⏳ Auto-saving player assignments…'
                : isDirty
                ? '⚠ Player assignments changed — save to confirm'
                : 'Players auto-assigned from positions. Change via dropdowns if needed.'}
            </p>
            {isDirty && !autoSaving && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isPending}
                className="h-8 px-4 text-xs bg-orange-500 hover:bg-orange-600 text-white shrink-0"
              >
                {isPending ? 'Saving…' : 'Save players'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamMatchAdminCard
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TeamMatchAdminCard
// ─────────────────────────────────────────────────────────────────────────────

function TeamMatchAdminCard({
  teamMatch, matchBase, tournamentId, highlightFix,
}: {
  teamMatch:    TeamMatchRich
  matchBase:    string
  tournamentId: string
  highlightFix: string
}) {
  const [open, setOpen]      = useState(teamMatch.id === highlightFix)
  const [expandedSub, setExpandedSub] = useState<string | null>(null)
  const [isPending, startTx] = useTransition()
  const { setLoading }       = useLoading()
  const router               = useRouter()

  const teamA  = teamMatch.team_a
  const teamB  = teamMatch.team_b
  const isLive = teamMatch.status === 'live'
  const isDone = teamMatch.status === 'complete'
  const subs   = teamMatch.submatches ?? []
  const aWon   = isDone && teamMatch.winner_team_id === teamA?.id
  const bWon   = isDone && teamMatch.winner_team_id === teamB?.id

  const playersA: TeamPlayer[] = (teamA as unknown as { players?: TeamPlayer[] })?.players ?? []
  const playersB: TeamPlayer[] = (teamB as unknown as { players?: TeamPlayer[] })?.players ?? []

  // ── Local draft state per submatch ────────────────────────────────────────
  type DraftRow = {
    teamAPlayerId:  string | null
    teamBPlayerId:  string | null
    teamAPlayer2Id: string | null
    teamBPlayer2Id: string | null
  }

  const buildDraft = useCallback((): Record<string, DraftRow> =>
    Object.fromEntries(subs.map(s => [s.id, {
      teamAPlayerId:  s.team_a_player_id,
      teamBPlayerId:  s.team_b_player_id,
      teamAPlayer2Id: s.team_a_player2_id ?? null,
      teamBPlayer2Id: s.team_b_player2_id ?? null,
    }])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [subs.map(s => s.id).join(',')])

  const [draft, setDraft] = useState<Record<string, DraftRow>>(buildDraft)

  // Re-sync when remote data updates (realtime from another session)
  const subsSig = subs.map(s => [
    s.team_a_player_id, s.team_b_player_id,
    s.team_a_player2_id, s.team_b_player2_id,
  ].join(',')).join('|')
  useEffect(() => { setDraft(buildDraft()) }, [subsSig]) // eslint-disable-line

  const isDirty = subs.some(s => {
    const d = draft[s.id]
    if (!d) return false
    return d.teamAPlayerId  !== s.team_a_player_id       ||
           d.teamBPlayerId  !== s.team_b_player_id       ||
           d.teamAPlayer2Id !== (s.team_a_player2_id ?? null) ||
           d.teamBPlayer2Id !== (s.team_b_player2_id ?? null)
  })

  const setField = (subId: string, field: keyof DraftRow, value: string | null) =>
    setDraft(prev => ({ ...prev, [subId]: { ...prev[subId], [field]: value } }))

  const handleSave = () => {
    setLoading(true)
    startTx(async () => {
      const res = await batchUpdateSubmatchPlayers({
        tournamentId,
        submatches: subs.map(s => ({
          submatchId:     s.id,
          teamAPlayerId:  draft[s.id]?.teamAPlayerId  ?? null,
          teamBPlayerId:  draft[s.id]?.teamBPlayerId  ?? null,
          teamAPlayer2Id: draft[s.id]?.teamAPlayer2Id ?? null,
          teamBPlayer2Id: draft[s.id]?.teamBPlayer2Id ?? null,
        })),
      })
      setLoading(false)
      if (res.error) {
        toast({ title: 'Could not save players', description: res.error, variant: 'destructive' })
      } else {
        toast({ title: 'Players saved' })
        // Update URL so round + fixture stays open on refresh / back navigation
        const url = new URL(window.location.href)
        url.searchParams.set('round', String(teamMatch.round))
        url.searchParams.set('fix', teamMatch.id)
        router.replace(url.pathname + url.search, { scroll: false })
      }
    })
  }

  const handleDiscard = () => setDraft(buildDraft())

  return (
    <div className={cn(
      'rounded-xl border border-border overflow-hidden',
      isLive && 'border-orange-400 dark:border-orange-500',
      isDone && 'border-emerald-300 dark:border-emerald-700/50',
    )}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          {/* Team A row */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: teamA?.color ?? '#F06321' }} />
            {aWon && <span className="text-amber-400 text-xs">🏆</span>}
            <span className={cn('font-semibold text-sm truncate flex-1 min-w-0',
              aWon ? 'font-bold text-foreground' :
              bWon ? 'text-muted-foreground font-normal' : 'text-foreground',
            )}>
              {teamA?.short_name ?? teamA?.name ?? '—'}
            </span>
            <span className={cn('font-mono font-bold text-sm tabular-nums shrink-0',
              aWon ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )}>
              {teamMatch.team_a_score}
            </span>
          </div>
          <div className="border-b border-border/30 ml-4 mr-2" />
          {/* Team B row */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: teamB?.color ?? '#6366f1' }} />
            {bWon && <span className="text-amber-400 text-xs">🏆</span>}
            <span className={cn('font-semibold text-sm truncate flex-1 min-w-0',
              bWon ? 'font-bold text-foreground' :
              aWon ? 'text-muted-foreground font-normal' : 'text-foreground',
            )}>
              {teamB?.short_name ?? teamB?.name ?? '—'}
            </span>
            <span className={cn('font-mono font-bold text-sm tabular-nums shrink-0',
              bWon ? 'font-bold text-foreground' : 'text-muted-foreground/50',
            )}>
              {teamMatch.team_b_score}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isDirty && <span className="text-[10px] font-bold text-amber-500 uppercase">Unsaved</span>}
          {isLive && <span className="live-dot" />}
          {isDone && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Done</span>}
        </div>
      </button>

      {/* Submatch rows */}
      {open && (
        <div className="border-t border-border/50 bg-muted/5">
          {/* Desktop column headers */}
          <div className="hidden sm:grid sm:grid-cols-[5.5rem_1fr_2.5rem_1fr_5.5rem] gap-2 px-4 pt-3 pb-1.5 items-center">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Match</span>
            <span className="text-[11px] font-bold uppercase tracking-wide truncate"
              style={{ color: teamA?.color ?? '#F06321' }}>{teamA?.name ?? 'Team A'}</span>
            <span />
            <span className="text-[11px] font-bold uppercase tracking-wide truncate"
              style={{ color: teamB?.color ?? '#6366f1' }}>{teamB?.name ?? 'Team B'}</span>
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide text-right">Score</span>
          </div>

          <div className="flex flex-col divide-y divide-border/30">
            {subs.map(sm => {
              const isDoubles = sm.label.toLowerCase().includes('doubles')
              const scoring   = sm.scoring
              const smDone    = scoring?.status === 'complete'
              const smLive    = scoring?.status === 'live'
              const p1g       = scoring?.player1_games ?? 0
              const p2g       = scoring?.player2_games ?? 0
              const smAWon    = smDone && p1g > p2g
              const smBWon    = smDone && p2g > p1g
              const scoreHref = `${matchBase}/${sm.match_id}?round=${teamMatch.round}&fix=${teamMatch.id}`
              const d         = draft[sm.id] ?? {
                teamAPlayerId: sm.team_a_player_id,
                teamBPlayerId: sm.team_b_player_id,
                teamAPlayer2Id: sm.team_a_player2_id ?? null,
                teamBPlayer2Id: sm.team_b_player2_id ?? null,
              }

              return (
                <div key={sm.id} className="px-4 py-2.5">
                  <p className="sm:hidden text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                    {sm.label}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr_2.5rem_1fr_5.5rem] gap-2 items-start">
                    <span className="hidden sm:flex items-center text-xs font-semibold text-foreground/80 self-center">
                      {sm.label}
                    </span>

                    {/* Team A selectors */}
                    <div className="flex flex-col gap-1">
                      <PlayerSelect
                        players={playersA}
                        value={d.teamAPlayerId}
                        placeholder={isDoubles ? 'Player 1…' : 'Select player…'}
                        accentColor={teamA?.color ?? '#F06321'}
                        disabled={smDone || isPending}
                        winner={smAWon}
                        onChange={id => setField(sm.id, 'teamAPlayerId', id)}
                      />
                      {isDoubles && (
                        <PlayerSelect
                          players={playersA}
                          value={d.teamAPlayer2Id}
                          placeholder="Player 2…"
                          accentColor={teamA?.color ?? '#F06321'}
                          disabled={smDone || isPending}
                          winner={smAWon}
                          onChange={id => setField(sm.id, 'teamAPlayer2Id', id)}
                        />
                      )}
                    </div>

                    <span className="hidden sm:flex items-center justify-center text-xs text-muted-foreground self-center">vs</span>

                    {/* Team B selectors */}
                    <div className="flex flex-col gap-1">
                      <PlayerSelect
                        players={playersB}
                        value={d.teamBPlayerId}
                        placeholder={isDoubles ? 'Player 1…' : 'Select player…'}
                        accentColor={teamB?.color ?? '#6366f1'}
                        disabled={smDone || isPending}
                        winner={smBWon}
                        onChange={id => setField(sm.id, 'teamBPlayerId', id)}
                      />
                      {isDoubles && (
                        <PlayerSelect
                          players={playersB}
                          value={d.teamBPlayer2Id}
                          placeholder="Player 2…"
                          accentColor={teamB?.color ?? '#6366f1'}
                          disabled={smDone || isPending}
                          winner={smBWon}
                          onChange={id => setField(sm.id, 'teamBPlayer2Id', id)}
                        />
                      )}
                    </div>

                    {/* Score column */}
                    <div className="flex sm:flex-col sm:items-end gap-2 sm:gap-1 self-center">
                      {scoring && (
                        <div className={cn(
                          'flex items-center gap-1 text-xs font-mono font-bold tabular-nums',
                          smDone ? 'text-foreground' : smLive ? 'text-orange-500' : 'text-muted-foreground',
                        )}>
                          {smLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0" />}
                          <span className={smAWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p1g}</span>
                          <span className="text-muted-foreground/60">–</span>
                          <span className={smBWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p2g}</span>
                          {smDone && <Check className="h-3 w-3 text-emerald-500 ml-0.5" />}
                        </div>
                      )}
                      {sm.match_id ? (
                        <a
                          href={scoreHref}
                          className="inline-flex items-center justify-center text-xs font-semibold text-orange-500 hover:text-orange-400 border border-orange-200 dark:border-orange-800/40 rounded-lg px-2.5 py-1 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors whitespace-nowrap"
                        >
                          {smDone ? 'Edit →' : 'Score →'}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 sm:text-right">—</span>
                      )}
                    </div>
                  </div>
                  <p className="sm:hidden text-center text-xs text-muted-foreground mt-1">↑ Team A &nbsp;|&nbsp; Team B ↑</p>
                </div>
              )
            })}
          </div>

          {subs.length === 0 && (
            <div className="px-4 py-4 text-xs text-muted-foreground">No sub-matches yet.</div>
          )}

          {/* Save / Discard footer — only shown when there are unsaved changes */}
          {isDirty && (
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border/40 bg-amber-50/40 dark:bg-amber-950/20">
              <button
                onClick={handleDiscard}
                disabled={isPending}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Discard
              </button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isPending}
                className="h-8 px-4 text-xs bg-orange-500 hover:bg-orange-600 text-white"
              >
                {isPending ? 'Saving…' : 'Save players'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerSelect — native select styled to match the design system
// ─────────────────────────────────────────────────────────────────────────────

function PlayerSelect({
  players, value, placeholder, accentColor, disabled, winner, onChange,
}: {
  players:     TeamPlayer[]
  value:       string | null
  placeholder: string
  accentColor: string
  disabled:    boolean
  winner?:     boolean
  onChange:    (id: string | null) => void
}) {
  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        disabled={disabled || players.length === 0}
        className={cn(
          'w-full appearance-none rounded-lg border border-border bg-background',
          'px-3 py-1.5 pr-7 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-orange-500/40',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          value ? 'text-foreground' : 'text-muted-foreground',
          winner && 'border-emerald-400 dark:border-emerald-600',
        )}
        style={value && !winner ? { borderColor: `${accentColor}70` } : undefined}
      >
        <option value="">{players.length === 0 ? 'No players assigned' : placeholder}</option>
        {players.map(p => (
          <option key={p.id} value={p.id}>
            {p.position}. {p.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SheetJS loader (same pattern as ExcelUpload.tsx)
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _xlsxCache: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadXLSX(): Promise<any> {
  if (_xlsxCache) return _xlsxCache
  if (typeof window !== 'undefined' && (window as any).XLSX) {
    _xlsxCache = (window as any).XLSX
    return _xlsxCache
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('sheetjs-cdn')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const s = document.createElement('script')
    s.id = 'sheetjs-cdn'
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload  = () => resolve()
    s.onerror = () => reject(new Error('Could not load SheetJS'))
    document.head.appendChild(s)
  })
  _xlsxCache = (window as any).XLSX
  return _xlsxCache
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Import Dialog
// Horizontal row format: Team Name | Seed (opt) | Player1 | Player2 | Player3 …
// Accepts plain text/CSV paste OR .xlsx/.xls/.csv file upload.
// ─────────────────────────────────────────────────────────────────────────────

interface TeamImportRow {
  name:    string
  seed:    number | null
  players: string[]
}

function parseTeamRows(raw: string[][]): TeamImportRow[] {
  return raw
    .filter(r => r.some(c => String(c ?? '').trim()))
    .map(r => {
      const cols = r.map(c => String(c ?? '').trim())
      const name = cols[0]
      if (!name) return null
      // Col 1: optional seed (integer) or first player name
      let seed: number | null = null
      let playerStart = 1
      if (cols.length > 1) {
        const maybeNum = parseInt(cols[1], 10)
        if (!isNaN(maybeNum) && maybeNum >= 1 && String(maybeNum) === cols[1].trim()) {
          seed = maybeNum
          playerStart = 2
        }
      }
      const players = cols.slice(playerStart).filter(Boolean)
      return { name, seed, players }
    })
    .filter(Boolean) as TeamImportRow[]
}

function parseTextInput(raw: string): TeamImportRow[] {
  const rows = raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/[|,\t]/).map(s => s.trim()))
  return parseTeamRows(rows)
}

function BulkImportDialog({
  tournamentId, existingTeamCount, showSeedInput, onClose, onDone,
}: {
  tournamentId:      string
  existingTeamCount: number
  showSeedInput:     boolean
  onClose:           () => void
  onDone:            () => Promise<void>
}) {
  const [isPending, startTx] = useTransition()
  const { setLoading }       = useLoading()
  const [mode,        setMode]        = useState<'text' | 'file'>('file')
  const [pasteText,   setPasteText]   = useState('')
  const [preview,     setPreview]     = useState<TeamImportRow[]>([])
  const [parseError,  setParseError]  = useState('')
  const [fileName,    setFileName]    = useState('')
  const [importing,   setImporting]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleTextChange = (raw: string) => {
    setPasteText(raw); setParseError('')
    if (!raw.trim()) { setPreview([]); return }
    try {
      const rows = parseTextInput(raw)
      setPreview(rows)
      if (rows.length === 0) setParseError('No valid rows found. Check format.')
    } catch { setParseError('Could not parse. Check format.') }
  }

  const processFile = async (file: File) => {
    setFileName(file.name); setParseError(''); setPreview([])
    try {
      let rawRows: string[][]
      if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/plain') {
        rawRows = (await file.text()).split('\n').map(l => l.split(/[,|\t]/).map(s => s.trim()))
      } else {
        const XLSX = await loadXLSX()
        const wb   = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        rawRows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
      }
      // Skip header row if first cell looks like a label
      const firstCell = String(rawRows[0]?.[0] ?? '').toLowerCase()
      const dataRows = (firstCell === 'team' || firstCell === 'team name') ? rawRows.slice(1) : rawRows
      const rows = parseTeamRows(dataRows)
      if (rows.length === 0) { setParseError('No valid rows found in file.'); return }
      setPreview(rows)
    } catch (e) {
      setParseError(`Could not read file: ${(e as Error).message}`)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''
  }

  const handleImport = () => {
    if (preview.length === 0) return
    setImporting(true); setLoading(true)
    startTx(async () => {
      let idx = existingTeamCount, ok = 0
      for (const row of preview) {
        const res = await createTeam({ tournamentId, name: row.name, color: pickColor(idx++), seed: row.seed })
        if (res.error || !res.teamId) continue
        const filtered = row.players.map((n, i) => ({ name: n, position: i + 1 })).filter(p => p.name)
        if (filtered.length > 0) {
          await upsertTeamPlayers({ tournamentId, teamId: res.teamId, players: filtered })
        }
        ok++
      }
      setLoading(false); setImporting(false)
      if (ok > 0) {
        toast({ title: `Imported ${ok} team${ok !== 1 ? 's' : ''}` })
        await onDone()
      } else {
        toast({ title: 'Import failed', description: 'No teams could be created.', variant: 'destructive' })
      }
    })
  }

  const seedCol = showSeedInput ? ' | Seed' : ''
  const exampleRow = `TT Lions${seedCol} | John Smith | Alex Jones | Sam Lee`
  const exampleRow2 = `Westside TTC${showSeedInput ? ' | 2' : ''} | Mike Chen | Bob Lee | Chris Park`

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onClose}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        <ChevronRight className="h-4 w-4 rotate-180" /> Back to Teams
      </button>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4 text-orange-500" /> Bulk Import Teams
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

          {/* Format guide */}
          <div className="rounded-lg bg-muted/40 border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Row format — one row per team</p>
              <a
                href="https://drive.google.com/drive/folders/1r45xuGSDsa7Y4Q0DdVkirbvqnUE4E_Pq?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="download-samples-btn inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors shrink-0"
              >
                ⬇ Download Samples
              </a>
            </div>
            <code className="text-xs font-mono text-orange-600 dark:text-orange-400">
              Team Name{seedCol} | Player 1 | Player 2 | Player 3 | Player 4 …
            </code>
            <div className="flex flex-col gap-0.5">
              <code className="text-[11px] font-mono text-muted-foreground">{exampleRow}</code>
              <code className="text-[11px] font-mono text-muted-foreground">{exampleRow2}</code>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Separator: <strong>|</strong>, comma, or tab.{showSeedInput ? ' Seed is optional — omit the column if not seeding.' : ''}{' '}
              Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>, or paste text below.
            </p>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            <button
              onClick={() => setMode('text')}
              className={cn('px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                mode === 'text' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Paste Text
            </button>
            <button
              onClick={() => setMode('file')}
              className={cn('px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                mode === 'file' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Upload File
            </button>
          </div>

          {mode === 'text' ? (
            <textarea
              value={pasteText}
              onChange={e => handleTextChange(e.target.value)}
              placeholder={`${exampleRow}\n${exampleRow2}`}
              rows={6}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-y"
            />
          ) : (
            <div
              onClick={() => inputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8',
                'cursor-pointer transition-colors',
                'border-border hover:border-orange-300 hover:bg-orange-50/40 dark:hover:bg-orange-950/10',
              )}
            >
              <Upload className="h-6 w-6 text-orange-400" />
              <p className="text-sm font-medium text-muted-foreground">
                {fileName ? fileName : 'Click to upload .xlsx, .xls, .csv, or .txt'}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt,text/plain"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {parseError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {parseError}
            </p>
          )}

          {/* Preview table */}
          {preview.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                Preview — {preview.length} team{preview.length !== 1 ? 's' : ''}
                {preview.reduce((s, t) => s + t.players.length, 0)} players total
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted-foreground">Team</th>
                      {showSeedInput && <th className="text-center px-2 py-1.5 text-xs font-semibold text-muted-foreground w-12">Seed</th>}
                      <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted-foreground">Players</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {preview.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                        <td className="px-3 py-2 font-semibold text-sm">{row.name}</td>
                        {showSeedInput && (
                          <td className="px-2 py-2 text-center">
                            {row.seed != null
                              ? <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[10px] font-bold">{row.seed}</span>
                              : <span className="text-muted-foreground/40 text-xs">—</span>
                            }
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.players.length === 0
                            ? <span className="text-amber-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> No players</span>
                            : row.players.map((p, j) => (
                              <span key={j} className="mr-2"><span className="font-mono text-muted-foreground/40">{j+1}.</span> {p}</span>
                            ))
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing || isPending || preview.length === 0}
              className="gap-1.5"
            >
              {importing
                ? <><span className="tt-spinner tt-spinner-sm" /> Importing…</>
                : <><Upload className="h-3.5 w-3.5" /> Import {preview.length > 0 ? `${preview.length} Teams` : ''}</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
