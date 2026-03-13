'use client'

/**
 * TeamGroupKOStage
 *
 * Admin UI for:
 *   format_type = 'team_group_corbillon'  — Teams: Groups + Knockout (Corbillon Cup)
 *   format_type = 'team_group_swaythling' — Teams: Groups + Knockout (Swaythling Cup)
 *
 * Three tabs:
 *   1. Teams      — Add/edit/import teams (reuses TeamLeagueStage's team CRUD via shared actions)
 *   2. Groups     — Configure groups, assign teams, show group standings + fixtures
 *   3. Knockout   — Show KO bracket after finalisation (delegates to TeamLeagueStage view='bracket')
 */

import React, { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shield, Plus, RefreshCw, PlayCircle, Check, Users,
  ChevronDown, ChevronRight, Layers, Trophy, AlertTriangle, ArrowRight, Lock,
  Upload, X, Pencil, Trash2,
} from 'lucide-react'
import { cn }                from '@/lib/utils'
import type { Tournament }   from '@/lib/types'
import { Button }            from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { NextStepBanner }    from './NextStepBanner'
import { toast }             from '@/components/ui/toaster'
import { InlineLoader, useLoading } from '@/components/shared/GlobalLoader'
import { WinnerTrophy, matchStatusClasses } from '@/components/shared/MatchUI'
import { createClient }      from '@/lib/supabase/client'
import {
  createTeam, updateTeam, deleteTeam, upsertTeamPlayers,
} from '@/lib/actions/teamLeague'
import {
  createTeamRRStage, generateTeamGroups, generateTeamGroupFixtures,
  finalizeTeamGroups, resetTeamGroupStage,
} from '@/lib/actions/teamGroupKO'
import { computeGroupLayout, groupLayoutSummary } from '@/lib/roundrobin/groupLayout'

// ─────────────────────────────────────────────────────────────────────────────
// Local types (mirrors TeamLeagueStage to avoid cross-file coupling)
// ─────────────────────────────────────────────────────────────────────────────

interface TeamPlayer { id: string; name: string; position: number }

interface TeamWithPlayers {
  id:             string
  tournament_id:  string
  name:           string
  short_name:     string | null
  color:          string | null
  seed:           number | null
  doubles_p1_pos: number | null
  doubles_p2_pos: number | null
  created_at:     string
  players:        TeamPlayer[]
}

interface Submatch {
  id:              string
  match_order:     number
  label:           string
  player_a_name:   string | null
  player_b_name:   string | null
  match_id:        string | null
  scoring?: {
    id:            string
    player1_games: number
    player2_games: number
    status:        string
  } | null
}

interface TeamMatchRich {
  id:             string
  team_a_id:      string
  team_b_id:      string
  round:          number
  round_name:     string | null
  status:         'pending' | 'live' | 'complete'
  team_a_score:   number
  team_b_score:   number
  winner_team_id: string | null
  group_id:       string | null
  team_a:         (TeamWithPlayers & { players: TeamPlayer[] }) | null
  team_b:         (TeamWithPlayers & { players: TeamPlayer[] }) | null
  submatches:     Submatch[]
}

interface RRGroup {
  id:           string
  group_number: number
  name:         string
  teamIds:      string[]
}

interface StageRow {
  id:     string
  config: {
    numberOfGroups: number
    advanceCount:   number
    matchFormat:    string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colours
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_COLORS = [
  '#F06321','#6366f1','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#84cc16','#f97316','#ec4899',
]
function pickColor(i: number) { return TEAM_COLORS[i % TEAM_COLORS.length] }

// ─────────────────────────────────────────────────────────────────────────────
// Data hook — loads teams, stage, groups, and team_matches in parallel
// ─────────────────────────────────────────────────────────────────────────────

function useTeamGroupData(tournamentId: string) {
  const supabase = createClient()
  const [teams,       setTeams]       = useState<TeamWithPlayers[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatchRich[]>([])
  const [groups,      setGroups]      = useState<RRGroup[]>([])
  const [stage,       setStage]       = useState<StageRow | null>(null)
  const [loading,     setLoading]     = useState(true)

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)

    // 3 parallel queries
    const [teamsRes, stageRes, matchesRes] = await Promise.all([
      supabase
        .from('teams')
        .select('*, doubles_p1_pos, doubles_p2_pos, team_players(id, name, position)')
        .eq('tournament_id', tournamentId)
        .order('created_at'),
      supabase
        .from('stages')
        .select('id, config')
        .eq('tournament_id', tournamentId)
        .eq('stage_number', 1)
        .maybeSingle(),
      supabase
        .from('team_matches')
        .select(`
          *,
          team_a:team_a_id(id,name,short_name,color,team_players(id,name,position)),
          team_b:team_b_id(id,name,short_name,color,team_players(id,name,position)),
          submatches:team_match_submatches(
            id,match_order,label,
            player_a_name,player_b_name,
            match_id,
            scoring:match_id(id,player1_games,player2_games,status)
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('round'),
    ])

    const stageData = stageRes.data as StageRow | null
    setStage(stageData)

    setTeams((teamsRes.data ?? []).map(t => ({
      ...t,
      players: ((t.team_players ?? []) as TeamPlayer[]).sort((a, b) => a.position - b.position),
    })) as TeamWithPlayers[])

    setTeamMatches((matchesRes.data ?? []).map(tm => ({
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

    // Load groups + members if stage exists (4th query, only when needed)
    if (stageData) {
      const { data: groupRows } = await supabase
        .from('rr_groups')
        .select('id, group_number, name, team_rr_group_members(team_id)')
        .eq('stage_id', stageData.id)
        .order('group_number')

      setGroups((groupRows ?? []).map(g => ({
        id:           g.id,
        group_number: g.group_number,
        name:         g.name,
        teamIds: ((g as unknown as { team_rr_group_members: { team_id: string }[] })
          .team_rr_group_members ?? []).map((m: { team_id: string }) => m.team_id),
      })))
    } else {
      setGroups([])
    }

    setLoading(false)
  }

  useEffect(() => { loadData() }, [tournamentId])

  useEffect(() => {
    const channel = supabase
      .channel(`team-group-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams',        filter: `tournament_id=eq.${tournamentId}` }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches', filter: `tournament_id=eq.${tournamentId}` }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_match_submatches' }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rr_groups' },  () => loadData(true))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournamentId])

  return { teams, teamMatches, groups, stage, loading, loadData }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory standings (same algorithm as server-side, runs on client data)
// ─────────────────────────────────────────────────────────────────────────────

function computeStandings(groupId: string, teamIds: string[], matches: TeamMatchRich[]) {
  const map = new Map(teamIds.map(id => [id, { teamId: id, mW: 0, mL: 0, smW: 0, gd: 0 }]))

  for (const m of matches) {
    if (m.group_id !== groupId || m.status !== 'complete') continue
    const sA = map.get(m.team_a_id)
    const sB = map.get(m.team_b_id)
    if (m.winner_team_id === m.team_a_id) { sA && sA.mW++; sB && sB.mL++ }
    else if (m.winner_team_id === m.team_b_id) { sB && sB.mW++; sA && sA.mL++ }
    for (const sm of m.submatches) {
      const sc = sm.scoring
      if (!sc || sc.status !== 'complete') continue
      if (sA) { sA.smW += sc.player1_games > sc.player2_games ? 1 : 0; sA.gd += sc.player1_games - sc.player2_games }
      if (sB) { sB.smW += sc.player2_games > sc.player1_games ? 1 : 0; sB.gd += sc.player2_games - sc.player1_games }
    }
  }

  return [...map.values()].sort((a, b) => b.mW - a.mW || b.smW - a.smW || b.gd - a.gd)
}

// ─────────────────────────────────────────────────────────────────────────────
// Input style
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-orange-500/50 text-foreground ' +
  'placeholder:text-muted-foreground/60'

// ─────────────────────────────────────────────────────────────────────────────
// TeamGroupKOStage — main export
// ─────────────────────────────────────────────────────────────────────────────

export function TeamGroupKOStage({ tournament, matchBase }: {
  tournament: Tournament
  matchBase:  string
}) {
  const [isPending, startTransition] = useTransition()
  const { setLoading }               = useLoading()
  const router                       = useRouter()
  const { teams, teamMatches, groups, stage, loading, loadData } = useTeamGroupData(tournament.id)

  const isCorbillon  = tournament.format_type === 'team_group_corbillon'
  const formatLabel  = isCorbillon ? 'Corbillon Cup' : 'Swaythling Cup'

  const [activeTab, setActiveTab] = useState<'teams' | 'groups' | 'knockout'>('teams')

  const rrMatches     = teamMatches.filter(m => m.group_id != null)
  const koMatches     = teamMatches.filter(m => m.group_id == null && m.round >= 900)
  const fixturesExist = rrMatches.length > 0
  const allRRDone     = fixturesExist && rrMatches.every(m => m.status === 'complete')
  const koExists      = koMatches.length > 0

  // Auto-advance tab when stages are set up
  useEffect(() => {
    if (koExists) setActiveTab('knockout')
    else if (stage) setActiveTab('groups')
  }, [stage?.id, koExists])

  if (loading) return <InlineLoader label="Loading team data…" />

  const tabs: { key: 'teams' | 'groups' | 'knockout'; label: string; icon: React.ReactNode; done?: boolean }[] = [
    { key: 'teams',    label: 'Teams',    icon: <Users className="h-4 w-4" />, done: teams.length >= 2 },
    { key: 'groups',   label: 'Groups',   icon: <Layers className="h-4 w-4" />, done: fixturesExist },
    { key: 'knockout', label: 'Knockout', icon: <Trophy className="h-4 w-4" />, done: koExists },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.done && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Tab: Teams */}
      {activeTab === 'teams' && (
        <TeamsTab
          tournament={tournament}
          teams={teams}
          teamMatches={teamMatches}
          stage={stage}
          loadData={loadData}
          isPending={isPending}
          startTransition={startTransition}
          setLoading={setLoading}
          router={router}
          onNext={() => setActiveTab('groups')}
          formatLabel={formatLabel}
        />
      )}

      {/* Tab: Groups */}
      {activeTab === 'groups' && (
        <GroupsTab
          tournament={tournament}
          teams={teams}
          groups={groups}
          stage={stage}
          teamMatches={teamMatches}
          rrMatches={rrMatches}
          matchBase={matchBase}
          loadData={loadData}
          isPending={isPending}
          startTransition={startTransition}
          setLoading={setLoading}
          router={router}
          allRRDone={allRRDone}
          fixturesExist={fixturesExist}
          koExists={koExists}
          onNext={() => setActiveTab('knockout')}
          isCorbillon={isCorbillon}
        />
      )}

      {/* Tab: Knockout */}
      {activeTab === 'knockout' && (
        <KnockoutTab
          tournament={tournament}
          teams={teams}
          koMatches={koMatches}
          matchBase={matchBase}
          loadData={loadData}
          isCorbillon={isCorbillon}
          formatLabel={formatLabel}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SheetJS lazy loader
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _xlsxCache: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadXLSX(): Promise<any> {
  if (_xlsxCache) return _xlsxCache
  if (typeof window !== 'undefined' && (window as any).XLSX) {
    _xlsxCache = (window as any).XLSX; return _xlsxCache
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('sheetjs-cdn')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const s = document.createElement('script')
    s.id = 'sheetjs-cdn'
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load SheetJS'))
    document.head.appendChild(s)
  })
  _xlsxCache = (window as any).XLSX; return _xlsxCache
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk import parser
// Row format: Team Name | Seed (opt) | Player 1 | Player 2 | Player 3 …
// ─────────────────────────────────────────────────────────────────────────────

interface TeamImportRow { name: string; seed: number | null; players: string[] }

function parseTeamRows(raw: string[][]): TeamImportRow[] {
  return raw
    .filter(r => r.some(c => String(c ?? '').trim()))
    .map(r => {
      const cols = r.map(c => String(c ?? '').trim())
      const name = cols[0]; if (!name) return null
      let seed: number | null = null; let playerStart = 1
      if (cols.length > 1) {
        const maybeNum = parseInt(cols[1], 10)
        if (!isNaN(maybeNum) && maybeNum >= 1 && String(maybeNum) === cols[1].trim()) {
          seed = maybeNum; playerStart = 2
        }
      }
      return { name, seed, players: cols.slice(playerStart).filter(Boolean) }
    })
    .filter(Boolean) as TeamImportRow[]
}

function parseTextInput(raw: string): TeamImportRow[] {
  const rows = raw.split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/[|,\t]/).map(s => s.trim()))
  return parseTeamRows(rows)
}

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportDialog
// ─────────────────────────────────────────────────────────────────────────────

function BulkImportDialog({ tournamentId, existingTeamCount, isCorbillon, onClose, onDone }: {
  tournamentId:      string
  existingTeamCount: number
  isCorbillon:       boolean
  onClose:           () => void
  onDone:            () => Promise<void>
}) {
  const [isPending, startTx]  = useTransition()
  const { setLoading }         = useLoading()
  const [mode, setMode]        = useState<'text' | 'file'>('text')
  const [pasteText, setPaste]  = useState('')
  const [preview, setPreview]  = useState<TeamImportRow[]>([])
  const [parseError, setErr]   = useState('')
  const [fileName, setFileName]= useState('')
  const [importing, setImp]    = useState(false)
  const inputRef               = useRef<HTMLInputElement>(null)

  const handleTextChange = (raw: string) => {
    setPaste(raw); setErr('')
    if (!raw.trim()) { setPreview([]); return }
    try {
      const rows = parseTextInput(raw)
      setPreview(rows)
      if (rows.length === 0) setErr('No valid rows found. Check format.')
    } catch { setErr('Could not parse. Check format.') }
  }

  const processFile = async (file: File) => {
    setFileName(file.name); setErr(''); setPreview([])
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
      const first = String(rawRows[0]?.[0] ?? '').toLowerCase()
      const dataRows = (first === 'team' || first === 'team name') ? rawRows.slice(1) : rawRows
      const rows = parseTeamRows(dataRows)
      if (rows.length === 0) { setErr('No valid rows found in file.'); return }
      setPreview(rows)
    } catch (e) { setErr(`Could not read file: ${(e as Error).message}`) }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''
  }

  const handleImport = () => {
    if (preview.length === 0) return
    setImp(true); setLoading(true)
    startTx(async () => {
      let idx = existingTeamCount, ok = 0
      for (const row of preview) {
        const res = await createTeam({ tournamentId, name: row.name, color: pickColor(idx++), seed: row.seed })
        if (res.error || !res.teamId) continue
        const filtered = row.players.map((n, i) => ({ name: n, position: i + 1 })).filter(p => p.name)
        if (filtered.length > 0) await upsertTeamPlayers({ tournamentId, teamId: res.teamId, players: filtered })
        ok++
      }
      setLoading(false); setImp(false)
      if (ok > 0) { toast({ title: `Imported ${ok} team${ok !== 1 ? 's' : ''}` }); await onDone() }
      else toast({ title: 'Import failed', description: 'No teams could be created.', variant: 'destructive' })
    })
  }

  const playerCols  = isCorbillon ? '| Player 1 | Player 2' : '| Player 1 | Player 2 | Player 3'
  const example1    = `TT Lions | 1 ${playerCols}`
  const example2    = `Westside TTC | 2 ${playerCols.replace(/Player \d/g, (_, i) => `Player ${parseInt(_[_.length-1])+0}`)}`

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onClose}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors self-start">
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
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Row format — one row per team</p>
            <code className="text-xs font-mono text-orange-600 dark:text-orange-400">
              Team Name | Seed {playerCols} …
            </code>
            <div className="flex flex-col gap-0.5">
              <code className="text-[11px] font-mono text-muted-foreground">{example1}</code>
              <code className="text-[11px] font-mono text-muted-foreground">{example2}</code>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Separator: <strong>|</strong>, comma, or tab. Seed is optional.{' '}
              Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>, or paste text below.
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {(['text', 'file'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={cn('px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                  mode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {m === 'text' ? 'Paste Text' : 'Upload File'}
              </button>
            ))}
          </div>

          {mode === 'text' ? (
            <textarea value={pasteText} onChange={e => handleTextChange(e.target.value)}
              placeholder={`${example1}\n${example2}`} rows={6}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-y" />
          ) : (
            <div onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors border-border hover:border-orange-300 hover:bg-orange-50/40 dark:hover:bg-orange-950/10">
              <Upload className="h-6 w-6 text-orange-400" />
              <p className="text-sm font-medium text-muted-foreground">
                {fileName ? fileName : 'Click to upload .xlsx, .xls, .csv, or .txt'}
              </p>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt,text/plain"
                className="hidden" onChange={handleFileChange} />
            </div>
          )}

          {parseError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {parseError}
            </p>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                Preview — {preview.length} team{preview.length !== 1 ? 's' : ''},{' '}
                {preview.reduce((s, t) => s + t.players.length, 0)} players total
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted-foreground">Team</th>
                      <th className="text-center px-2 py-1.5 text-xs font-semibold text-muted-foreground w-12">Seed</th>
                      <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted-foreground">Players</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {preview.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                        <td className="px-3 py-2 font-semibold text-sm">{row.name}</td>
                        <td className="px-2 py-2 text-center">
                          {row.seed != null
                            ? <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[10px] font-bold">{row.seed}</span>
                            : <span className="text-muted-foreground/40 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.players.length === 0
                            ? <span className="text-amber-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> No players</span>
                            : row.players.map((p, j) => <span key={j} className="mr-2"><span className="font-mono text-muted-foreground/40">{j+1}.</span> {p}</span>)
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
            <Button size="sm" onClick={handleImport}
              disabled={importing || isPending || preview.length === 0} className="gap-1.5">
              {importing
                ? <><span className="tt-spinner tt-spinner-sm" /> Importing…</>
                : <><Upload className="h-3.5 w-3.5" /> Import {preview.length > 0 ? `${preview.length} Teams` : ''}</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamsTab — add/edit/import teams with bulk import + Excel support
// ─────────────────────────────────────────────────────────────────────────────

function TeamsTab({ tournament, teams, teamMatches, stage, loadData, isPending, startTransition, setLoading, router, onNext, formatLabel }: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  teamMatches:     TeamMatchRich[]
  stage:           StageRow | null
  loadData:        (s?: boolean) => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  onNext:          () => void
  formatLabel:     string
}) {
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showReset,  setShowReset]  = useState(false)

  const hasFixtures = teamMatches.some(m => m.group_id != null)
  const isCorbillon = tournament.format_type === 'team_group_corbillon'
  const playerCount = isCorbillon ? 2 : 3

  const handleAdd = async (data: TeamFormData) => {
    startTransition(async () => {
      const res = await createTeam({
        tournamentId: tournament.id, name: data.name, shortName: data.short,
        color: data.color, seed: data.seed,
        doublesP1Pos: isCorbillon ? data.doublesP1Pos : null,
        doublesP2Pos: isCorbillon ? data.doublesP2Pos : null,
      })
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      if (res.teamId) {
        const named = data.players.map((n, i) => ({ name: n.trim(), position: i + 1 })).filter(p => p.name)
        if (named.length > 0) await upsertTeamPlayers({ teamId: res.teamId, tournamentId: tournament.id, players: named })
      }
      setShowAdd(false)
      await loadData(true); router.refresh()
    })
  }

  const handleEdit = async (teamId: string, data: TeamFormData) => {
    startTransition(async () => {
      await updateTeam({
        teamId, tournamentId: tournament.id,
        name: data.name, shortName: data.short, color: data.color, seed: data.seed,
        doublesP1Pos: isCorbillon ? data.doublesP1Pos : null,
        doublesP2Pos: isCorbillon ? data.doublesP2Pos : null,
      })
      const named = data.players.map((n, i) => ({ name: n.trim(), position: i + 1 })).filter(p => p.name)
      await upsertTeamPlayers({ teamId, tournamentId: tournament.id, players: named })
      setEditingId(null)
      await loadData(true); router.refresh()
    })
  }

  const handleDelete = async (teamId: string) => {
    startTransition(async () => {
      const res = await deleteTeam(teamId, tournament.id)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      await loadData(true); router.refresh()
    })
  }

  const handleReset = async () => {
    if (!stage) return
    setLoading(true)
    startTransition(async () => {
      const res = await resetTeamGroupStage(stage.id, tournament.id)
      setLoading(false)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      setShowReset(false)
      toast({ title: 'Stage reset.', variant: 'success' })
      await loadData(); router.refresh()
    })
  }

  // Show bulk import view
  if (showImport) {
    return (
      <BulkImportDialog
        tournamentId={tournament.id}
        existingTeamCount={teams.length}
        isCorbillon={isCorbillon}
        onClose={() => setShowImport(false)}
        onDone={async () => { setShowImport(false); await loadData(true); router.refresh() }}
      />
    )
  }

  const missingPlayers = teams.filter(t => t.players.length < playerCount)

  return (
    <div className="flex flex-col gap-5">

      {/* ── Step banner ── */}
      {teams.length === 0 ? (
        <NextStepBanner variant="action" step="Step 1"
          title={`Add teams for ${formatLabel}`}
          description={isCorbillon
            ? 'Each team needs 2 players (A and B). Add individually or bulk import below.'
            : 'Each team needs 3 players (A, B, C). Add individually or bulk import below.'} />
      ) : hasFixtures ? (
        <NextStepBanner variant="action" title="Fixtures generated"
          description="Group fixtures are locked. Go to the Groups tab to view standings." />
      ) : missingPlayers.length > 0 ? (
        <NextStepBanner variant="warning"
          title={`${missingPlayers.length} team${missingPlayers.length !== 1 ? 's' : ''} need${missingPlayers.length === 1 ? 's' : ''} ${playerCount} players`}
          description="Assign all players before configuring groups." />
      ) : (
        <NextStepBanner variant="action" step="Step 2"
          title={`${teams.length} teams ready — configure groups next`}
          onClick={onNext} />
      )}

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Teams — {formatLabel}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isCorbillon
              ? 'Corbillon Cup: 4 singles + 1 doubles per tie. 2 players per team (Position 1 = A, 2 = B).'
              : 'Swaythling Cup: 5 singles, no doubles per tie. 3 players per team (A, B, C).'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stage && (
            <Button size="sm" variant="outline" onClick={() => setShowReset(true)} disabled={isPending}
              className="text-destructive hover:text-destructive gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
          {!hasFixtures && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowImport(true)} disabled={isPending}
                className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null) }} disabled={isPending}
                className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Team
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Reset confirm ── */}
      {showReset && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive font-medium">
                This will delete all group assignments, fixtures, and the KO bracket. Teams and their players will be preserved.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={handleReset} disabled={isPending}>Yes, Reset Stage</Button>
              <Button size="sm" variant="outline" onClick={() => setShowReset(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Add form ── */}
      {showAdd && !hasFixtures && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Team</CardTitle></CardHeader>
          <CardContent>
            <TeamForm
              playerCount={playerCount} showSeed showDoubles={isCorbillon}
              submitLabel="Add Team"
              onCancel={() => setShowAdd(false)}
              onSave={handleAdd}
              isPending={isPending}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Team list ── */}
      {teams.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center py-12 gap-2 text-center">
          <p className="text-sm font-medium text-muted-foreground">No teams yet</p>
          <p className="text-xs text-muted-foreground/60">
            Add teams individually or use <strong>Import</strong> to paste a list
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Teams ({teams.length})
          </p>
          {teams.map((team, idx) => (
            <Card key={team.id} className={cn('overflow-hidden', editingId === team.id && 'ring-1 ring-orange-500/40')}>
              <CardContent className="pt-4 pb-4">
                {editingId === team.id ? (
                  <TeamForm
                    playerCount={playerCount} showSeed showDoubles={isCorbillon}
                    initialName={team.name} initialShort={team.short_name ?? ''}
                    initialColor={team.color ?? '#F06321'}
                    initialPlayers={team.players.map(p => p.name)}
                    initialSeed={team.seed}
                    initialDoublesP1={team.doubles_p1_pos}
                    initialDoublesP2={team.doubles_p2_pos}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSave={data => handleEdit(team.id, data)}
                    isPending={isPending}
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: team.color ?? pickColor(idx) }}>
                      {(team.short_name ?? team.name).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{team.name}</span>
                        {team.seed != null && (
                          <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">S{team.seed}</span>
                        )}
                        {team.players.length < playerCount && (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                            {team.players.length}/{playerCount} players
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {team.players.length === 0
                          ? <span className="text-amber-600">No players assigned</span>
                          : team.players.map((p, pi) => (
                            <span key={pi} className="mr-2">
                              <span className="font-mono opacity-40">{String.fromCharCode(65 + pi)}.</span> {p.name}
                            </span>
                          ))
                        }
                      </div>
                    </div>
                    {!hasFixtures && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditingId(team.id); setShowAdd(false) }}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Edit team">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(team.id)}
                          disabled={isPending}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete team">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// GroupsTab — configure groups, show standings + fixtures
// ─────────────────────────────────────────────────────────────────────────────

function GroupsTab({
  tournament, teams, groups, stage, teamMatches, rrMatches, matchBase,
  loadData, isPending, startTransition, setLoading, router,
  allRRDone, fixturesExist, koExists, onNext, isCorbillon,
}: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  groups:          RRGroup[]
  stage:           StageRow | null
  teamMatches:     TeamMatchRich[]
  rrMatches:       TeamMatchRich[]
  matchBase:       string
  loadData:        (s?: boolean) => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  allRRDone:       boolean
  fixturesExist:   boolean
  koExists:        boolean
  onNext:          () => void
  isCorbillon:     boolean
}) {
  const [numGroups,     setNumGroups]     = useState(2)
  const [advanceCount,  setAdvanceCount]  = useState(1)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const formatType   = tournament.format_type ?? 'team_group_corbillon'
  const layout       = computeGroupLayout(teams.length, Math.ceil(teams.length / numGroups))
  const canCreate    = teams.length >= 2 && !stage
  const canGenerate  = !!stage && groups.every(g => g.teamIds.length >= 2) && !fixturesExist
  const canFinalize  = allRRDone && !koExists
  const groupsAssigned = groups.length > 0 && groups.every(g => g.teamIds.length >= 2)

  const teamById = new Map(teams.map(t => [t.id, t]))

  const handleCreateStage = () => {
    startTransition(async () => {
      const res = await createTeamRRStage({
        tournamentId:   tournament.id,
        numberOfGroups: numGroups,
        advanceCount,
        matchFormat:    'bo5',
      })
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }

      // Auto-assign teams to groups
      const r2 = await generateTeamGroups(res.stageId!, tournament.id)
      if (r2.error) { toast({ title: r2.error, variant: 'warning' }); return }

      toast({ title: `${numGroups} groups created.`, variant: 'success' })
      await loadData(); router.refresh()
    })
  }

  const handleRegenerateGroups = () => {
    if (!stage) return
    startTransition(async () => {
      const res = await generateTeamGroups(stage.id, tournament.id)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      toast({ title: 'Groups re-assigned.', variant: 'success' })
      await loadData(true); router.refresh()
    })
  }

  const handleGenerateFixtures = () => {
    if (!stage) return
    startTransition(async () => {
      const res = await generateTeamGroupFixtures(stage.id, tournament.id, formatType)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      toast({ title: `${res.fixtureCount} group fixtures generated.`, variant: 'success' })
      await loadData(); router.refresh()
    })
  }

  const handleFinalize = () => {
    if (!stage) return
    setLoading(true)
    startTransition(async () => {
      const res = await finalizeTeamGroups(stage.id, tournament.id, formatType, stage.config.advanceCount)
      setLoading(false)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      toast({ title: 'KO bracket generated!', variant: 'success' })
      await loadData(); router.refresh()
      onNext()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Group Stage</h2>

      {/* Step 1: Configure groups */}
      {!stage && (
        <Card>
          <CardHeader><CardTitle className="text-base">Configure Groups</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Teams: <strong>{teams.length}</strong>
            </p>

            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Number of Groups
                </label>
                <input
                  type="number" min={1} max={Math.floor(teams.length / 2)}
                  value={numGroups}
                  onChange={e => setNumGroups(Math.max(1, parseInt(e.target.value) || 1))}
                  className={cn(inputCls, 'w-24')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Advance Per Group
                </label>
                <input
                  type="number" min={1}
                  value={advanceCount}
                  onChange={e => setAdvanceCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className={cn(inputCls, 'w-24')}
                />
              </div>
            </div>

            {/* Preview */}
            {teams.length >= 2 && (
              <p className="text-sm text-muted-foreground">
                Preview: {groupLayoutSummary(layout)}
              </p>
            )}

            <Button
              size="sm" onClick={handleCreateStage}
              disabled={isPending || !canCreate || teams.length < 2}
              className="gap-1.5 self-start"
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Create Groups &amp; Assign Teams
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stage exists: show groups */}
      {stage && (
        <div className="flex flex-col gap-4">
          {/* Config summary */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>{groups.length} groups</span>
            <span>·</span>
            <span>Top {stage.config.advanceCount} advance per group</span>
            {!fixturesExist && (
              <>
                <span>·</span>
                <button
                  onClick={handleRegenerateGroups}
                  disabled={isPending}
                  className="text-orange-500 hover:text-orange-400 transition-colors text-xs font-medium"
                >
                  Re-assign teams
                </button>
              </>
            )}
          </div>

          {/* Groups */}
          {groups.map(group => {
            const groupTeams    = group.teamIds.map(id => teamById.get(id)).filter(Boolean) as TeamWithPlayers[]
            const groupMatches  = rrMatches.filter(m => m.group_id === group.id)
            const standings     = computeStandings(group.id, group.teamIds, teamMatches)
            const isExpanded    = expandedGroup === group.id
            const allDone       = groupMatches.length > 0 && groupMatches.every(m => m.status === 'complete')

            return (
              <Card key={group.id} className={cn(allDone ? 'bg-muted/20 border-border/40' : '')}>
                <CardHeader className="py-3">
                  <button
                    className="flex items-center justify-between w-full text-left"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-semibold text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {groupTeams.map(t => t.name).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {allDone && <Check className="h-4 w-4 text-emerald-500" />}
                      <span className="text-xs text-muted-foreground">
                        {groupMatches.filter(m => m.status === 'complete').length}/{groupMatches.length} done
                      </span>
                    </div>
                  </button>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="flex flex-col gap-4 pt-0">
                    {/* Standings table */}
                    {groupMatches.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground border-b border-border">
                              <th className="text-left py-1.5 font-medium w-6">#</th>
                              <th className="text-left py-1.5 font-medium">Team</th>
                              <th className="text-center py-1.5 font-medium w-10">MW</th>
                              <th className="text-center py-1.5 font-medium w-10">ML</th>
                              <th className="text-center py-1.5 font-medium w-12">Ties</th>
                              <th className="text-center py-1.5 font-medium w-12">GD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.map((row, idx) => {
                              const t = teamById.get(row.teamId)
                              const isAdvancing = idx < stage.config.advanceCount
                              return (
                                <tr key={row.teamId} className={cn('border-b border-border/50', isAdvancing && 'bg-emerald-50/50 dark:bg-emerald-950/20')}>
                                  <td className="py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                                  <td className="py-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t?.color ?? '#888' }} />
                                      <span className="font-medium truncate">{t?.name ?? '?'}</span>
                                      {isAdvancing && <ArrowRight className="h-3 w-3 text-emerald-500 shrink-0" />}
                                    </div>
                                  </td>
                                  <td className="py-1.5 text-center font-mono">{row.mW}</td>
                                  <td className="py-1.5 text-center font-mono text-muted-foreground">{row.mL}</td>
                                  <td className="py-1.5 text-center font-mono">{row.smW}</td>
                                  <td className="py-1.5 text-center font-mono">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Fixtures */}
                    {groupMatches.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fixtures</h4>
                        {groupMatches.map(m => (
                          <GroupFixtureCard key={m.id} match={m} matchBase={matchBase} />
                        ))}
                      </div>
                    )}

                    {groupMatches.length === 0 && fixturesExist && (
                      <p className="text-sm text-muted-foreground">No fixtures for this group yet.</p>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}

          {/* Generate fixtures */}
          {!fixturesExist && groupsAssigned && (
            <Button size="sm" onClick={handleGenerateFixtures} disabled={isPending || !canGenerate}
              className="gap-1.5 self-start">
              <PlayCircle className="h-3.5 w-3.5" />
              Generate Group Fixtures
            </Button>
          )}

          {/* Finalize banner */}
          {fixturesExist && !koExists && (
            <NextStepBanner
              variant={allRRDone ? 'action' : 'info'}
              title={allRRDone
                ? 'All group matches complete! Generate the knockout bracket.'
                : 'Complete all group matches to advance to the knockout stage.'}
              onClick={allRRDone ? handleFinalize : undefined}
            />
          )}

          {koExists && (
            <NextStepBanner
              variant="action"
              title="KO bracket generated. View in the Knockout tab."
              onClick={onNext}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupFixtureCard — compact read-only fixture card for group view
// ─────────────────────────────────────────────────────────────────────────────

function GroupFixtureCard({ match, matchBase }: { match: TeamMatchRich; matchBase: string }) {
  const isComplete = match.status === 'complete'
  const isLive     = match.status === 'live'
  const doneCount  = match.submatches.filter(s => s.scoring?.status === 'complete').length
  const totalCount = match.submatches.length

  const completedFirst = match.submatches.find(s => s.scoring?.status === 'complete')
  const firstScoreUrl  = completedFirst?.match_id
    ? `${matchBase}/${completedFirst.match_id}`
    : null

  // Find first incomplete or first submatch for linking
  const linkSm = match.submatches.find(s => s.scoring?.status !== 'complete') ?? match.submatches[0]
  const href   = linkSm?.match_id ? `${matchBase}/${linkSm.match_id}` : null

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5 flex items-center gap-3',
      matchStatusClasses(match.status),
    )}>
      {/* Teams + score */}
      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <WinnerTrophy show={isComplete && match.winner_team_id === match.team_a_id} />
          <span className={cn('font-medium truncate', isComplete && match.winner_team_id !== match.team_a_id && 'text-muted-foreground')}>
            {match.team_a?.name ?? '—'}
          </span>
        </div>
        <span className="text-xs font-mono font-bold shrink-0">
          {match.team_a_score} – {match.team_b_score}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <WinnerTrophy show={isComplete && match.winner_team_id === match.team_b_id} />
          <span className={cn('font-medium truncate', isComplete && match.winner_team_id !== match.team_b_id && 'text-muted-foreground')}>
            {match.team_b?.name ?? '—'}
          </span>
        </div>
      </div>

      {/* Progress + link */}
      <div className="flex items-center gap-2 shrink-0">
        {isLive && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400">
            LIVE
          </span>
        )}
        <span className="text-xs text-muted-foreground">{doneCount}/{totalCount}</span>
        {href && (
          <a href={href}
            className="text-xs font-medium text-orange-500 hover:text-orange-400 transition-colors whitespace-nowrap"
          >
            Score →
          </a>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KnockoutTab — shows the KO bracket for the team group+KO event
// ─────────────────────────────────────────────────────────────────────────────

function KnockoutTab({ tournament, teams, koMatches, matchBase, loadData, isCorbillon, formatLabel }: {
  tournament:  Tournament
  teams:       TeamWithPlayers[]
  koMatches:   TeamMatchRich[]
  matchBase:   string
  loadData:    (s?: boolean) => Promise<void>
  isCorbillon: boolean
  formatLabel: string
}) {
  if (koMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Lock className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">
          KO bracket not yet generated. Complete all group matches first.
        </p>
      </div>
    )
  }

  // Group by round
  const roundMap = new Map<number, TeamMatchRich[]>()
  for (const m of koMatches) {
    const arr = roundMap.get(m.round) ?? []
    arr.push(m)
    roundMap.set(m.round, arr)
  }
  const rounds = [...roundMap.entries()].sort((a, b) => a[0] - b[0])
  const teamById = new Map(teams.map(t => [t.id, t]))

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Knockout — {formatLabel}</h2>

      {rounds.map(([roundN, matches]) => {
        const rName = matches[0]?.round_name ?? `Round ${roundN}`
        return (
          <div key={roundN} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{rName}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map(m => {
                const isComplete = m.status === 'complete'
                const isLive     = m.status === 'live'
                const doneCount  = m.submatches.filter(s => s.scoring?.status === 'complete').length
                const firstPending = m.submatches.find(s => s.scoring?.status !== 'complete')
                const href = firstPending?.match_id ? `${matchBase}/${firstPending.match_id}` : null

                return (
                  <Card key={m.id} className={cn(matchStatusClasses(m.status), 'overflow-hidden')}>
                    <CardContent className="pt-3 pb-3 flex flex-col gap-2">
                      {/* Team A */}
                      <div className={cn('flex items-center gap-2', isComplete && m.winner_team_id !== m.team_a_id && 'opacity-50')}>
                        <WinnerTrophy show={isComplete && m.winner_team_id === m.team_a_id} />
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.team_a?.color ?? '#888' }} />
                        <span className="text-sm font-semibold flex-1 truncate">{m.team_a?.name ?? 'TBD'}</span>
                        <span className="text-sm font-bold font-mono">{m.team_a_score}</span>
                      </div>
                      <div className="border-t border-border/40 my-0.5" />
                      {/* Team B */}
                      <div className={cn('flex items-center gap-2', isComplete && m.winner_team_id !== m.team_b_id && 'opacity-50')}>
                        <WinnerTrophy show={isComplete && m.winner_team_id === m.team_b_id} />
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.team_b?.color ?? '#888' }} />
                        <span className="text-sm font-semibold flex-1 truncate">{m.team_b?.name ?? 'TBD'}</span>
                        <span className="text-sm font-bold font-mono">{m.team_b_score}</span>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-border/30">
                        <div className="flex items-center gap-1.5">
                          {isLive && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400">LIVE</span>
                          )}
                          {isComplete && <span className="text-xs text-muted-foreground">Done</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{doneCount}/{m.submatches.length}</span>
                          {href && (
                            <a href={href} className="text-xs font-medium text-orange-500 hover:text-orange-400 transition-colors">
                              Score →
                            </a>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamForm — compact form for add/edit team
// ─────────────────────────────────────────────────────────────────────────────

interface TeamFormData {
  name:        string
  short:       string
  color:       string
  players:     string[]
  seed:        number | null
  doublesP1Pos: number | null
  doublesP2Pos: number | null
}

function TeamForm({
  initialName = '', initialShort = '', initialColor = '#F06321',
  initialPlayers, initialSeed = null, initialDoublesP1 = null, initialDoublesP2 = null,
  playerCount = 3, showSeed = false, showDoubles = false,
  submitLabel, onCancel, onSave, isPending,
}: {
  initialName?:    string
  initialShort?:   string
  initialColor?:   string
  initialPlayers?: string[]
  initialSeed?:    number | null
  initialDoublesP1?: number | null
  initialDoublesP2?: number | null
  playerCount?:    number
  showSeed?:       boolean
  showDoubles?:    boolean
  submitLabel:     string
  onCancel?:       () => void
  onSave:          (data: TeamFormData) => void
  isPending:       boolean
}) {
  const [name,      setName]      = useState(initialName)
  const [short,     setShort]     = useState(initialShort)
  const [color,     setColor]     = useState(initialColor)
  const [seedVal,   setSeedVal]   = useState(initialSeed != null ? String(initialSeed) : '')
  const [dp1,       setDp1]       = useState<number | null>(initialDoublesP1)
  const [dp2,       setDp2]       = useState<number | null>(initialDoublesP2)
  const [players,   setPlayers]   = useState<string[]>(() => {
    const base = [...(initialPlayers ?? [])]
    while (base.length < playerCount) base.push('')
    return base
  })

  const setPlayer = (i: number, v: string) =>
    setPlayers(prev => { const n = [...prev]; n[i] = v; return n })

  const named = players.map((p, i) => ({ pos: i + 1, name: p.trim() })).filter(p => p.name)

  const handleSave = () => {
    if (!name.trim()) return
    const seed = seedVal.trim() !== '' ? parseInt(seedVal, 10) || null : null
    onSave({ name: name.trim(), short: short.trim(), color, players, seed, doublesP1Pos: dp1, doublesP2Pos: dp2 })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn('grid gap-3 items-end', showSeed ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]')}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="e.g. TT Lions" className={inputCls} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Short</label>
          <input value={short} onChange={e => setShort(e.target.value)}
            placeholder="TTL" className={cn(inputCls, 'w-20')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colour</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            className="h-9 w-12 rounded-lg border border-border cursor-pointer p-0.5" />
        </div>
        {showSeed && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seed</label>
            <input type="number" min={1} value={seedVal}
              onChange={e => setSeedVal(e.target.value)}
              placeholder="—" className={cn(inputCls, 'w-16')} />
          </div>
        )}
      </div>

      {/* Players */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Players</label>
        {players.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 text-xs font-mono text-muted-foreground/50 text-right shrink-0">{i + 1}</span>
            <input
              value={p} onChange={e => setPlayer(i, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder={`Player ${i + 1}`}
              className={inputCls}
            />
          </div>
        ))}
      </div>

      {/* Doubles (Corbillon only) */}
      {showDoubles && named.length >= 2 && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Doubles Pair (opt)</label>
          <div className="flex items-center gap-3">
            <select value={dp1 ?? ''} onChange={e => setDp1(e.target.value ? Number(e.target.value) : null)}
              className={cn(inputCls, 'w-40')}>
              <option value="">Player 1…</option>
              {named.map(p => <option key={p.pos} value={p.pos}>{p.pos}. {p.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">&amp;</span>
            <select value={dp2 ?? ''} onChange={e => setDp2(e.target.value ? Number(e.target.value) : null)}
              className={cn(inputCls, 'w-40')}>
              <option value="">Player 2…</option>
              {named.filter(p => p.pos !== dp1).map(p => <option key={p.pos} value={p.pos}>{p.pos}. {p.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isPending || !name.trim()} className="gap-1.5">
          {isPending ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3.5 w-3.5" />}
          {isPending ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}
