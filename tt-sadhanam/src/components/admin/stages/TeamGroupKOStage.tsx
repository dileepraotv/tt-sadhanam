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

import React, { useState, useTransition, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Shield, Plus, RefreshCw, PlayCircle, Check, Users,
  ChevronDown, ChevronRight, Layers, Trophy, AlertTriangle, ArrowRight, Lock,
  Upload, X, Pencil, Trash2, Swords, ChevronUp,
} from 'lucide-react'
import { cn }                from '@/lib/utils'
import type { Tournament }   from '@/lib/types'
import { Button }            from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/index'
import { NextStepBanner }    from './NextStepBanner'
import { toast }             from '@/components/ui/toaster'
import { InlineLoader, useLoading } from '@/components/shared/GlobalLoader'
import { WinnerTrophy, matchStatusClasses, T } from '@/components/shared/MatchUI'
import { createClient }      from '@/lib/supabase/client'
import {
  createTeam, updateTeam, deleteTeam, upsertTeamPlayers,
  batchUpdateSubmatchPlayers,
  generateTeamKOBracket, generateTeamSwaythlingBracket,
} from '@/lib/actions/teamLeague'
import {
  createTeamRRStage, generateTeamGroups, generateTeamGroupFixtures,
  finalizeTeamGroups, resetTeamGroupStage, updateTeamGroupMatchWinner,
} from '@/lib/actions/teamGroupKO'
import { saveGameScore, declareMatchWinner, updateMatchFormat } from '@/lib/actions/matches'
import { RubberScorer, type RubberSubmatch } from '@/components/shared/RubberScorer'
import { computeGroupLayout, groupLayoutSummary, snakeAssign } from '@/lib/roundrobin/groupLayout'
import type { MatchFormat } from '@/lib/types'

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
  id:               string
  match_order:      number
  label:            string
  player_a_name:    string | null
  player_b_name:    string | null
  team_a_player_id: string | null
  team_b_player_id: string | null
  team_a_player2_id?: string | null
  team_b_player2_id?: string | null
  match_id:         string | null
  scoring?: {
    id:            string
    player1_games: number
    player2_games: number
    status:        string
    match_format?: string | null
  } | null
}

interface TeamMatchRich {
  id:             string
  team_a_id:      string
  team_b_id:      string
  // Team display data embedded at load time — never needs a runtime lookup
  // null = TBD slot (KO bracket match not yet seeded)
  team_a_name:    string | null
  team_b_name:    string | null
  team_a_color:   string
  team_b_color:   string
  round:          number
  round_name:     string | null
  status:         'pending' | 'live' | 'complete'
  team_a_score:   number
  team_b_score:   number
  winner_team_id: string | null
  group_id:       string | null
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
// Shared input style
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-orange-500/50 text-foreground ' +
  'placeholder:text-muted-foreground/60'

// ─────────────────────────────────────────────────────────────────────────────
// In-memory ITTF standings — runs on client data, no extra DB queries
// ─────────────────────────────────────────────────────────────────────────────

function computeStandings(groupId: string, teamIds: string[], matches: TeamMatchRich[]) {
  type Row = { teamId: string; mW: number; mL: number; rW: number; rL: number; gW: number; gL: number }
  const map = new Map<string, Row>(teamIds.map(id => [id, { teamId: id, mW: 0, mL: 0, rW: 0, rL: 0, gW: 0, gL: 0 }]))
  const h2h = new Map<string, Map<string, number>>()
  for (const id of teamIds) h2h.set(id, new Map())

  for (const m of matches) {
    if (m.group_id !== groupId || m.status !== 'complete') continue
    const sA = map.get(m.team_a_id), sB = map.get(m.team_b_id)
    if (m.winner_team_id === m.team_a_id) {
      sA && sA.mW++; sB && sB.mL++
      h2h.get(m.team_a_id)?.set(m.team_b_id, (h2h.get(m.team_a_id)?.get(m.team_b_id) ?? 0) + 1)
    } else if (m.winner_team_id === m.team_b_id) {
      sB && sB.mW++; sA && sA.mL++
      h2h.get(m.team_b_id)?.set(m.team_a_id, (h2h.get(m.team_b_id)?.get(m.team_a_id) ?? 0) + 1)
    }
    for (const sm of m.submatches) {
      const sc = sm.scoring; if (!sc || sc.status !== 'complete') continue
      const aWon = sc.player1_games > sc.player2_games
      if (sA) { sA.rW += aWon ? 1:0; sA.rL += aWon ? 0:1; sA.gW += sc.player1_games; sA.gL += sc.player2_games }
      if (sB) { sB.rW += aWon ? 0:1; sB.rL += aWon ? 1:0; sB.gW += sc.player2_games; sB.gL += sc.player1_games }
    }
  }

  const ratio = (w: number, l: number) => (w + l === 0 ? 0 : w / (w + l))
  return [...map.values()].sort((a, b) => {
    if (b.mW !== a.mW) return b.mW - a.mW
    const rr = ratio(b.rW, b.rL) - ratio(a.rW, a.rL); if (Math.abs(rr) > 1e-9) return rr
    const gr = ratio(b.gW, b.gL) - ratio(a.gW, a.gL); if (Math.abs(gr) > 1e-9) return gr
    const bH = h2h.get(b.teamId)?.get(a.teamId) ?? 0
    const aH = h2h.get(a.teamId)?.get(b.teamId) ?? 0
    return bH - aH
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Data hook — loads teams, stage, groups, and team_matches in parallel
// ─────────────────────────────────────────────────────────────────────────────

// useTeamGroupData
// ─────────────────────────────────────────────────────────────────────────────
// Design principles that eliminate the "wrong team name" bug once and for all:
//
//  1. Teams are loaded ONCE into a stable ref (teamNamesRef). They never change
//     during a tournament session, so there is no reason to ever re-fetch them.
//     The ref is set before any match data is committed to state.
//
//  2. Match data (team_matches, submatches, scoring) is loaded separately and
//     can be refreshed freely by Realtime events without touching teams.
//
//  3. team_a_name / team_b_name are resolved from teamNamesRef at the moment
//     each loadMatches() call builds the match list — the ref is always fully
//     populated at that point because loadTeams() is awaited first.
//
//  4. A single generation counter prevents stale async responses from
//     overwriting newer ones.
// ─────────────────────────────────────────────────────────────────────────────

function useTeamGroupData(tournamentId: string) {
  const sbRef = useRef(createClient())
  const sb    = sbRef.current

  // Stable name/color map — loaded ONCE, never re-fetched
  // Key: team UUID  Value: { name, color, team object }
  const teamNamesRef = useRef<Map<string, TeamWithPlayers>>(new Map())

  const [teams,       setTeams]       = useState<TeamWithPlayers[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatchRich[]>([])
  const [groups,      setGroups]      = useState<RRGroup[]>([])
  const [stage,       setStage]       = useState<StageRow | null>(null)
  const [loading,     setLoading]     = useState(true)

  const genRef = useRef(0)

  // ── Load teams once — stores into ref AND state ───────────────────────────
  const loadTeams = useCallback(async (): Promise<boolean> => {
    const { data } = await sb
      .from('teams')
      .select('id, name, short_name, color, seed, doubles_p1_pos, doubles_p2_pos, team_players(id, name, position)')
      .eq('tournament_id', tournamentId)
      .order('created_at')
    if (!data) return false

    const list: TeamWithPlayers[] = data.map((t: any) => ({
      id: t.id, name: t.name, short_name: t.short_name, color: t.color,
      seed: t.seed, doubles_p1_pos: t.doubles_p1_pos, doubles_p2_pos: t.doubles_p2_pos,
      tournament_id: tournamentId, created_at: t.created_at ?? '',
      players: ((t.team_players ?? []) as TeamPlayer[]).sort((a, b) => a.position - b.position),
    }))

    // Populate the ref FIRST — match loading reads from it
    teamNamesRef.current = new Map(list.map(t => [t.id, t]))
    setTeams(list)
    return true
  }, [tournamentId])

  // ── Load match data — reads names from the stable ref ────────────────────
  const loadMatches = useCallback(async (gen: number): Promise<boolean> => {
    // Single join query: team_matches + submatches + scoring in one round-trip.
    // PostgREST embeds submatches and scoring inline — no serial N+1 queries.
    const { data: raw } = await sb
      .from('team_matches')
      .select(`
        id, team_a_id, team_b_id, round, round_name,
        status, team_a_score, team_b_score, winner_team_id, group_id,
        submatches:team_match_submatches(
          id, match_order, label,
          player_a_name, player_b_name,
          team_a_player_id, team_b_player_id,
          team_a_player2_id, team_b_player2_id,
          match_id,
          scoring:match_id(id, player1_games, player2_games, status, match_format)
        )
      `)
      .eq('tournament_id', tournamentId)
      .order('round')
    if (gen !== genRef.current) return false

    const nameMap = teamNamesRef.current
    const matchList: TeamMatchRich[] = (raw ?? []).map((m: any) => {
      const tA = nameMap.get(m.team_a_id as string)
      const tB = nameMap.get(m.team_b_id as string)
      const subs: Submatch[] = ((m.submatches ?? []) as any[])
        .sort((a: any, b: any) => a.match_order - b.match_order)
        .map((sm: any): Submatch => ({
          id:               sm.id,
          match_order:      sm.match_order,
          label:            sm.label,
          player_a_name:    sm.player_a_name,
          player_b_name:    sm.player_b_name,
          team_a_player_id: sm.team_a_player_id,
          team_b_player_id: sm.team_b_player_id,
          team_a_player2_id: sm.team_a_player2_id,
          team_b_player2_id: sm.team_b_player2_id,
          match_id:         sm.match_id,
          scoring:          sm.scoring ?? null,
        }))
      return {
        id:             m.id,
        team_a_id:      m.team_a_id,
        team_b_id:      m.team_b_id,
        team_a_name:    m.team_a_id ? (tA?.name ?? m.team_a_id.slice(0,6)) : null,
        team_b_name:    m.team_b_id ? (tB?.name ?? m.team_b_id.slice(0,6)) : null,
        team_a_color:   tA?.color ?? '#94a3b8',
        team_b_color:   tB?.color ?? '#94a3b8',
        round:          m.round,
        round_name:     m.round_name,
        status:         m.status,
        team_a_score:   m.team_a_score,
        team_b_score:   m.team_b_score,
        winner_team_id: m.winner_team_id,
        group_id:       m.group_id,
        submatches:     subs,
      }
    })

    setTeamMatches(matchList)
    return true
  }, [tournamentId])

  // ── Load stage + groups ───────────────────────────────────────────────────
  const loadGroups = useCallback(async (gen: number): Promise<boolean> => {
    // Single joined query: stages + groups + members in one round-trip
    const { data: rawStage } = await sb
      .from('stages')
      .select('id, config, rr_groups(id, group_number, name, members:team_rr_group_members(team_id))')
      .eq('tournament_id', tournamentId).eq('stage_number', 1).maybeSingle()
    if (gen !== genRef.current) return false

    let groupList: RRGroup[] = []
    if (rawStage) {
      const rawGroups = (rawStage as any).rr_groups ?? []
      groupList = [...rawGroups]
        .sort((a: any, b: any) => a.group_number - b.group_number)
        .map((g: any) => ({
          id: g.id,
          group_number: g.group_number,
          name: g.name,
          teamIds: ((g.members ?? []) as any[]).map((m: any) => m.team_id as string),
        }))
    }

    setStage(rawStage as StageRow | null)
    setGroups(groupList)
    return true
  }, [tournamentId])

  // ── Full initial load ─────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    const gen = ++genRef.current
    if (!silent) setLoading(true)

    // Teams MUST complete before matches — names are read from the ref
    if (teamNamesRef.current.size === 0) {
      await loadTeams()
      if (gen !== genRef.current) return
    }
    // loadMatches and loadGroups are independent — run in parallel
    await Promise.all([loadMatches(gen), loadGroups(gen)])
    if (gen === genRef.current) setLoading(false)
  }, [loadTeams, loadMatches, loadGroups])

  // Initial mount load
  useEffect(() => {
    loadTeams().then(() => {
      const gen = ++genRef.current
      Promise.all([loadMatches(gen), loadGroups(gen)])
        .then(() => { if (gen === genRef.current) setLoading(false) })
    })
  }, [tournamentId])

  // Realtime: only refresh matches + groups (NOT teams — they never change)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const gen = ++genRef.current
        loadMatches(gen).then(() => loadGroups(gen))
      }, 400)
    }
    const ch = sb.channel(`team-group-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches',         filter: `tournament_id=eq.${tournamentId}` }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_match_submatches' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, debounced)
      .subscribe()
    return () => { sb.removeChannel(ch); if (timer) clearTimeout(timer) }
  }, [tournamentId, loadMatches, loadGroups])

  return { teams, teamMatches, groups, stage, loading, loadData }
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
  const [mode, setMode]        = useState<'text' | 'file'>('file')
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

function TeamsTab({ tournament, teams, teamMatches, stage, loadData, isPending, startTransition, setLoading, router, onNext, formatLabel, isKOOnly = false, koExists = false, onGenerateKO }: {
  tournament:      Tournament
  teams:           TeamWithPlayers[]
  teamMatches:     TeamMatchRich[]
  stage:           StageRow | null
  loadData:        (s?: boolean) => Promise<void>
  isPending:       boolean
  startTransition: ReturnType<typeof useTransition>[1]
  setLoading:      (v: boolean) => void
  router:          ReturnType<typeof useRouter>
  onNext?:         () => void
  formatLabel:     string
  isKOOnly?:       boolean
  koExists?:       boolean
  onGenerateKO?:   () => void
}) {
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showReset,  setShowReset]  = useState(false)

  const hasFixtures = teamMatches.some(m => m.group_id != null)
  const isCorbillon = tournament.format_type === 'team_group_corbillon' || tournament.format_type === 'team_league_ko'
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
      ) : (hasFixtures || (isKOOnly && koExists)) ? (
        <NextStepBanner variant="action" title={koExists ? 'Bracket generated' : 'Fixtures generated'}
          description={isKOOnly
            ? 'Bracket is ready. Go to the Knockout tab to score matches.'
            : 'Group fixtures are locked. Go to the Groups tab to view standings.'} />
      ) : (!isKOOnly && missingPlayers.length > 0) ? (
        <NextStepBanner variant="warning"
          title={`${missingPlayers.length} team${missingPlayers.length !== 1 ? 's' : ''} need${missingPlayers.length === 1 ? 's' : ''} ${playerCount} players`}
          description="Assign all players before configuring groups." />
      ) : isKOOnly ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <NextStepBanner variant="action" step="Step 2"
              title={`${teams.length} teams ready — generate bracket`}
              description="Teams will be seeded into the bracket by their seed number." />
          </div>
          <Button onClick={onGenerateKO} disabled={isPending || teams.length < 2} className="gap-2 shrink-0">
            {isPending
              ? <><span className="tt-spinner tt-spinner-sm" /> Generating…</>
              : <><PlayCircle className="h-4 w-4" /> {isCorbillon ? 'Generate Corbillon Bracket' : 'Generate Swaythling Bracket'}</>
            }
          </Button>
        </div>
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
          {(!hasFixtures && !koExists) && (
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
      {showAdd && (!hasFixtures && !koExists) && (
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
                        {!isKOOnly && team.players.length < playerCount && (
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
                    {(!hasFixtures && !koExists) && (
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

// ─────────────────────────────────────────────────────────────────────────────
// RubberScorer — inline game-score entry for one rubber
// ─────────────────────────────────────────────────────────────────────────────

type GameLocal = { s1: string; s2: string }

// ─────────────────────────────────────────────────────────────────────────────
// Table tennis score validation
// Rules: first to 11, win by 2; if both ≥ 10 (deuce) must win by exactly 2
// ─────────────────────────────────────────────────────────────────────────────

// RubberScorer — inline game-score entry for one rubber

// RubberScorer is imported from @/components/shared/RubberScorer
// This thin adapter translates local Submatch type to the shared interface
function RubberScorerAdapter({
  submatch, teamA, teamB, tournamentId, matchFormat, onSaved,
}: {
  submatch:     Submatch
  teamA:        TeamWithPlayers | null
  teamB:        TeamWithPlayers | null
  isCorbillon:  boolean
  tournamentId: string
  matchFormat:  MatchFormat
  onSaved:      () => void
}) {
  return (
    <RubberScorer
      submatch={submatch}
      nameA={teamA?.name ?? 'Team A'}
      nameB={teamB?.name ?? 'Team B'}
      tournamentId={tournamentId}
      matchFormat={matchFormat}
      onSaved={onSaved}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LineupEditor — player selectors for one rubber
// ─────────────────────────────────────────────────────────────────────────────

function LineupEditor({
  submatch, teamA, teamB, isCorbillon, onChange, sideOnly,
}: {
  submatch:    Submatch
  teamA:       TeamWithPlayers | null
  teamB:       TeamWithPlayers | null
  isCorbillon: boolean
  onChange:    (aId: string|null, bId: string|null, a2Id?: string|null, b2Id?: string|null) => void
  sideOnly?:   'a' | 'b'   // when set, renders only that team's selectors (for column layout)
}) {
  const isDbl = isCorbillon && submatch.match_order === 3

  const [aId,  setAId]  = useState<string>(submatch.team_a_player_id ?? '')
  const [bId,  setBId]  = useState<string>(submatch.team_b_player_id ?? '')
  const [a2Id, setA2Id] = useState<string>(submatch.team_a_player2_id ?? '')
  const [b2Id, setB2Id] = useState<string>(submatch.team_b_player2_id ?? '')

  // Track whether any field has actually changed from the saved DB value
  const savedRef = useRef({
    aId:  submatch.team_a_player_id ?? '',
    bId:  submatch.team_b_player_id ?? '',
    a2Id: submatch.team_a_player2_id ?? '',
    b2Id: submatch.team_b_player2_id ?? '',
  })

  // Only notify parent when user actually changes something
  const notify = (newAId: string, newBId: string, newA2Id: string, newB2Id: string) => {
    const s = savedRef.current
    const changed = newAId !== s.aId || newBId !== s.bId || newA2Id !== s.a2Id || newB2Id !== s.b2Id
    if (changed) {
      onChange(newAId||null, newBId||null, isDbl ? (newA2Id||null) : undefined, isDbl ? (newB2Id||null) : undefined)
    }
  }

  const handleA  = (v: string) => { setAId(v);  notify(v,   bId,  a2Id, b2Id) }
  const handleB  = (v: string) => { setBId(v);  notify(aId, v,    a2Id, b2Id) }
  const handleA2 = (v: string) => { setA2Id(v); notify(aId, bId,  v,    b2Id) }
  const handleB2 = (v: string) => { setB2Id(v); notify(aId, bId,  a2Id, v   ) }

  const aPlayers = teamA?.players ?? []
  const bPlayers = teamB?.players ?? []
  const sel = 'px-2 py-1.5 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-orange-500/50 w-full'

  // sideOnly: render only one team's selectors for the column layout
  if (sideOnly === 'a') {
    return (
      <div className="flex flex-col gap-1.5">
        <select value={aId} onChange={e => handleA(e.target.value)} className={sel}>
          <option value="">Select player…</option>
          {aPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={a2Id} onChange={e => handleA2(e.target.value)} className={sel}>
            <option value="">Partner…</option>
            {aPlayers.filter(p => p.id !== aId).map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
          </select>
        )}
      </div>
    )
  }
  if (sideOnly === 'b') {
    return (
      <div className="flex flex-col gap-1.5">
        <select value={bId} onChange={e => handleB(e.target.value)} className={sel}>
          <option value="">Select player…</option>
          {bPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={b2Id} onChange={e => handleB2(e.target.value)} className={sel}>
            <option value="">Partner…</option>
            {bPlayers.filter(p => p.id !== bId).map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
          </select>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 mt-1.5">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">{teamA?.name ?? 'Team A'}</span>
        <select value={aId} onChange={e => handleA(e.target.value)} className={sel}>
          <option value="">— select —</option>
          {aPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={a2Id} onChange={e => handleA2(e.target.value)} className={sel}>
            <option value="">— partner —</option>
            {aPlayers.filter(p => p.id !== aId).map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">{teamB?.name ?? 'Team B'}</span>
        <select value={bId} onChange={e => handleB(e.target.value)} className={sel}>
          <option value="">— select —</option>
          {bPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={b2Id} onChange={e => handleB2(e.target.value)} className={sel}>
            <option value="">— partner —</option>
            {bPlayers.filter(p => p.id !== bId).map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FixtureDetailPanel — inline expandable match entry for group/KO fixtures
// ─────────────────────────────────────────────────────────────────────────────

function FixtureDetailPanel({
  match, teams, isCorbillon, tournament, loadData, showColumnLayout = false,
}: {
  match:            TeamMatchRich
  teams:            TeamWithPlayers[]
  isCorbillon:      boolean
  tournament:       { id: string; format: string }
  loadData:         () => void
  showColumnLayout?: boolean
}) {
  const [expandedRubber, setExpandedRubber] = useState<string | null>(null)
  const [lineupEdits,    setLineupEdits]    = useState<Map<string, [string|null,string|null,string|null|undefined,string|null|undefined]>>(new Map())
  const [savingLineup,   setSavingLineup]   = useState(false)
  const [lineupDirty,    setLineupDirty]    = useState(false)
  const [autoSaving,     setAutoSaving]     = useState(false)
  const autoSavedRef = useRef(false)

  // Always look up teams directly by ID — never trust cached team_a/team_b on match objects
  const teamA  = teams.find(t => t.id === match.team_a_id) ?? null
  const teamB  = teams.find(t => t.id === match.team_b_id) ?? null
  const isLocked = match.status === 'complete'
  // Use the individual match's saved format if available, fall back to tournament default
  const getMatchFormat = (sm: Submatch): MatchFormat =>
    (sm.scoring?.match_format as MatchFormat | undefined) ?? (tournament.format as MatchFormat) ?? 'bo5'

  // Auto-save default player assignments on first render if not yet saved
  // This ensures scoring pages always show real names instead of TBD
  useEffect(() => {
    if (isLocked || autoSavedRef.current) return
    const anyUnsaved = match.submatches.some(sm => {
      const a = teamA?.players ?? []
      const b = teamB?.players ?? []
      if (sm.team_a_player_id && sm.team_b_player_id) return false // already saved
      // Check if there are players to auto-assign
      return a.length > 0 || b.length > 0
    })
    if (!anyUnsaved) return
    autoSavedRef.current = true

    // Build auto-assignments from position defaults
    const isDbl = (sm: Submatch) => isCorbillon && sm.match_order === 3
    const posFromLabel = (label: string, side: 'a' | 'b'): number => {
      const m = label.match(/\(([A-Z/]+)\s+vs\s+([A-Z/]+)\)/)
      if (!m) return side === 'a' ? 1 : 1
      const letter = side === 'a' ? m[1][0] : m[2][0]
      return ({ A: 1, B: 2, C: 3, X: 1, Y: 2, Z: 3 } as Record<string, number>)[letter] ?? 1
    }

    const submatches = match.submatches.map(sm => {
      const aPlayers = teamA?.players ?? []
      const bPlayers = teamB?.players ?? []
      const isDouble = isDbl(sm)
      const aPos = isDouble ? 1 : posFromLabel(sm.label, 'a')
      const bPos = isDouble ? 2 : posFromLabel(sm.label, 'b')
      const aP1 = sm.team_a_player_id ?? aPlayers.find(p => p.position === aPos)?.id ?? null
      const bP1 = sm.team_b_player_id ?? bPlayers.find(p => p.position === bPos)?.id ?? null
      // Partner = the OTHER position on each team
      const aP2 = isDouble ? (sm.team_a_player2_id ?? aPlayers.find(p => p.position !== aPos && p.position <= 2)?.id ?? null) : null
      const bP2 = isDouble ? (sm.team_b_player2_id ?? bPlayers.find(p => p.position !== bPos && p.position <= 2)?.id ?? null) : null
      return { submatchId: sm.id, teamAPlayerId: aP1, teamBPlayerId: bP1, teamAPlayer2Id: aP2, teamBPlayer2Id: bP2 }
    })

    setAutoSaving(true)
    batchUpdateSubmatchPlayers({ tournamentId: tournament.id, submatches })
      .then(() => { setAutoSaving(false) })
      .catch(() => { setAutoSaving(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLineupChange = (smId: string, a: string|null, b: string|null, a2?: string|null, b2?: string|null) => {
    setLineupEdits(prev => { const m = new Map(prev); m.set(smId, [a, b, a2, b2]); return m })
    setLineupDirty(true)
  }

  const handleSaveLineup = async () => {
    setSavingLineup(true)
    const submatches = match.submatches.map(sm => {
      const edit = lineupEdits.get(sm.id)
      // Coerce "" → null so FK columns never receive an invalid UUID
      const aId  = (edit ? edit[0] : sm.team_a_player_id)  || null
      const bId  = (edit ? edit[1] : sm.team_b_player_id)  || null
      const a2Id = (edit ? edit[2] : sm.team_a_player2_id) || null
      const b2Id = (edit ? edit[3] : sm.team_b_player2_id) || null
      return {
        submatchId:      sm.id,
        teamAPlayerId:   aId,
        teamBPlayerId:   bId,
        teamAPlayer2Id:  a2Id,
        teamBPlayer2Id:  b2Id,
      }
    })
    const res = await batchUpdateSubmatchPlayers({ tournamentId: tournament.id, submatches })
    setSavingLineup(false)
    if (res.error) { toast({ title: res.error, variant: 'destructive' }); return }
    setLineupDirty(false)
    setLineupEdits(new Map())
    toast({ title: 'Lineup saved', variant: 'success' })
  }

  return (
    <div className="flex flex-col gap-0 pt-1">
      {/* Team score strip — only shown in compact group fixture view, not in KO column view */}
      {!showColumnLayout && (
        <div className="flex items-center justify-between px-1 py-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: match.team_a_color }} />
            <span className="text-sm font-semibold">{match.team_a_name}</span>
          </div>
          <span className="text-lg font-bold font-mono tabular-nums">
            {match.team_a_score} – {match.team_b_score}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{match.team_b_name}</span>
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: match.team_b_color }} />
          </div>
        </div>
      )}

      {/* Lineup save/status bar */}
      {!isLocked && (autoSaving || lineupDirty) && (
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-[11px] text-muted-foreground">
            {autoSaving
              ? '⏳ Auto-saving player assignments…'
              : '⚠ Player assignments changed — save to confirm'}
          </span>
          {lineupDirty && !autoSaving && (
            <Button size="sm" onClick={handleSaveLineup} disabled={savingLineup}
              className="gap-1.5 h-7 text-xs">
              {savingLineup ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3 w-3" />}
              Save Lineup
            </Button>
          )}
        </div>
      )}

      {/* Rubber rows */}
      <div className={cn('flex flex-col', showColumnLayout ? 'divide-y divide-border/30' : 'divide-y divide-border/40')}>
        {match.submatches.map((sm, idx) => {
          const sc           = sm.scoring
          const isRubberDone = sc?.status === 'complete'
          const smLive       = sc?.status === 'live'
          const aWon         = isRubberDone && sc!.player1_games > sc!.player2_games
          const bWon         = isRubberDone && sc!.player2_games > sc!.player1_games
          const isExpanded   = expandedRubber === sm.id
          const p1g          = sc?.player1_games ?? 0
          const p2g          = sc?.player2_games ?? 0

          if (showColumnLayout) {
            // Column layout: matches TeamMatchBracketCard grid style
            return (
              <div key={sm.id} className={cn('px-4 py-3',
                smLive && 'bg-orange-50/30 dark:bg-orange-950/10',
                isRubberDone && 'bg-muted/10',
              )}>
                {/* Mobile label */}
                <p className="sm:hidden text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">{sm.label}</p>
                <div className="grid grid-cols-1 sm:grid-cols-[7rem_1fr_3rem_1fr_6rem] gap-2 items-start">
                  {/* Match label (desktop) */}
                  <div className="hidden sm:flex items-start pt-1">
                    <span className="text-xs font-semibold text-foreground/80 leading-tight">{sm.label}</span>
                  </div>
                  {/* Team A player */}
                  <div className="flex flex-col gap-1.5">
                    {!isLocked ? (
                      <LineupEditor
                        submatch={sm}
                        teamA={teamA}
                        teamB={teamB}
                        isCorbillon={isCorbillon}
                        onChange={(a, b, a2, b2) => handleLineupChange(sm.id, a, b, a2, b2)}
                        sideOnly="a"
                      />
                    ) : (
                      <span className={cn('text-sm font-semibold truncate',
                        aWon ? 'font-semibold text-foreground' : bWon ? 'text-muted-foreground' : '',
                      )}>{sm.player_a_name ?? '—'}</span>
                    )}
                  </div>
                  {/* vs */}
                  <div className="hidden sm:flex items-center justify-center pt-1.5">
                    <span className="text-[11px] font-bold text-muted-foreground/60">vs</span>
                  </div>
                  {/* Team B player */}
                  <div className="flex flex-col gap-1.5">
                    {!isLocked ? (
                      <LineupEditor
                        submatch={sm}
                        teamA={teamA}
                        teamB={teamB}
                        isCorbillon={isCorbillon}
                        onChange={(a, b, a2, b2) => handleLineupChange(sm.id, a, b, a2, b2)}
                        sideOnly="b"
                      />
                    ) : (
                      <span className={cn('text-sm font-semibold truncate',
                        bWon ? 'font-semibold text-foreground' : aWon ? 'text-muted-foreground' : '',
                      )}>{sm.player_b_name ?? '—'}</span>
                    )}
                  </div>
                  {/* Score + scorer link */}
                  <div className="flex sm:flex-col sm:items-end items-center gap-2 sm:gap-1 pt-0.5">
                    {sc && (
                      <div className={cn('flex items-center gap-1 text-xs font-mono font-bold tabular-nums',
                        isRubberDone ? 'text-foreground' : smLive ? 'text-orange-500' : 'text-muted-foreground/50',
                      )}>
                        {smLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0" />}
                        <span className={aWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p1g}</span>
                        <span className="text-muted-foreground/40">–</span>
                        <span className={bWon ? 'font-bold text-foreground' : 'text-muted-foreground/50'}>{p2g}</span>
                        {isRubberDone && <Check className="h-3 w-3 text-emerald-500 ml-0.5" />}
                      </div>
                    )}
                    {/* Inline score entry toggle */}
                    <button
                      onClick={() => setExpandedRubber(isExpanded ? null : sm.id)}
                      className={cn(
                        'inline-flex items-center justify-center text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap',
                        isRubberDone
                          ? 'text-emerald-600 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                          : 'text-orange-500 border-orange-200 dark:border-orange-800/40 hover:bg-orange-50 dark:hover:bg-orange-950/30',
                      )}
                    >
                      {isRubberDone ? 'Edit →' : 'Score →'}
                    </button>
                  </div>
                </div>
                {/* Expanded inline scorer */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <RubberScorerAdapter
                      submatch={sm}
                      teamA={teamA}
                      teamB={teamB}
                      isCorbillon={isCorbillon}
                      tournamentId={tournament.id}
                      matchFormat={getMatchFormat(sm)}
                      onSaved={loadData}
                    />
                  </div>
                )}
              </div>
            )
          }

          // Compact accordion layout for group fixtures
          return (
            <div key={sm.id} className="py-2.5">
              <button
                onClick={() => setExpandedRubber(isExpanded ? null : sm.id)}
                className="w-full flex items-center gap-2 text-left group"
              >
                <span className={cn(
                  'flex-none text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center',
                  isRubberDone ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                )}>{idx + 1}</span>
                <span className="text-xs font-medium text-muted-foreground flex-1">{sm.label}</span>
                <span className="text-xs text-muted-foreground hidden sm:block">
                  {sm.player_a_name ?? '?'} <span className="opacity-40">vs</span> {sm.player_b_name ?? '?'}
                </span>
                {isRubberDone ? (
                  <span className="text-xs font-semibold font-mono shrink-0">
                    <span className={cn(aWon ? 'font-bold text-foreground' : 'text-muted-foreground/50')}>{p1g}</span>
                    <span className="text-muted-foreground mx-0.5">–</span>
                    <span className={cn(bWon ? 'font-bold text-foreground' : 'text-muted-foreground/50')}>{p2g}</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">pending</span>
                )}
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0', isExpanded && 'rotate-180')} />
              </button>
              {isExpanded && (
                <div className="mt-2">
                  {!isLocked && (
                    <LineupEditor
                      submatch={sm}
                      teamA={teamA}
                      teamB={teamB}
                      isCorbillon={isCorbillon}
                      onChange={(a, b, a2, b2) => handleLineupChange(sm.id, a, b, a2, b2)}
                    />
                  )}
                  <RubberScorerAdapter
                    submatch={sm}
                    teamA={teamA}
                    teamB={teamB}
                    isCorbillon={isCorbillon}
                    tournamentId={tournament.id}
                    matchFormat={getMatchFormat(sm)}
                    onSaved={loadData}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupsTab — configure groups, assign teams, show fixtures + inline scoring
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
  // ── Group config mode ──────────────────────────────────────────────────────
  const [configMode, setConfigMode] = useState<'numGroups' | 'perGroup'>('numGroups')
  const [numGroups,    setNumGroups]    = useState(2)
  const [teamsPerGroup, setTeamsPerGroup] = useState(4)
  const [advanceCount, setAdvanceCount]  = useState(2)
  const [expandedGroup,  setExpandedGroup]  = useState<string | null>(null)
  const [expandedMatch,  setExpandedMatch]  = useState<string | null>(null)

  const formatType   = tournament.format_type ?? 'team_group_corbillon'
  const numTeams     = teams.length
  const N            = configMode === 'numGroups' ? numGroups : Math.max(1, Math.floor(numTeams / Math.max(1, teamsPerGroup)))
  const layout       = computeGroupLayout(numTeams, Math.ceil(numTeams / Math.max(1, N)))
  const canCreate    = numTeams >= 2 && !stage
  const canGenerate  = !!stage && groups.every(g => g.teamIds.length >= 2) && !fixturesExist
  const canFinalize  = allRRDone && !koExists
  const groupsAssigned = groups.length > 0 && groups.every(g => g.teamIds.length >= 2)

  // Snake preview — use N directly (not layout.numGroups which may differ when numTeams
  // isn't cleanly divisible by the requested group count)
  const seeded   = [...teams].filter(t => t.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
  const unseeded = [...teams].filter(t => t.seed == null)
  const ordered  = [...seeded, ...unseeded]
  const previewN = Math.max(1, configMode === 'numGroups' ? numGroups : layout.numGroups)
  const preview  = numTeams >= 2 && previewN > 0 ? snakeAssign(ordered, previewN) : []

  const handleCreateStage = () => {
    setLoading(true)
    startTransition(async () => {
      const G = configMode === 'numGroups' ? numGroups : layout.numGroups
      const res = await createTeamRRStage({
        tournamentId:   tournament.id,
        numberOfGroups: G,
        advanceCount,
        matchFormat:    'bo5',
      })
      if (res.error) { setLoading(false); toast({ title: res.error, variant: 'warning' }); return }
      const r2 = await generateTeamGroups(res.stageId!, tournament.id)
      setLoading(false)
      if (r2.error) { toast({ title: r2.error, variant: 'warning' }); return }
      toast({ title: `${G} groups created & teams assigned.`, variant: 'success' })
      await loadData(); router.refresh()
    })
  }

  const handleRegenerateGroups = () => {
    if (!stage) return
    setLoading(true)
    startTransition(async () => {
      const res = await generateTeamGroups(stage.id, tournament.id)
      setLoading(false)
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      toast({ title: 'Groups re-assigned.', variant: 'success' })
      await loadData(true); router.refresh()
    })
  }

  const handleGenerateFixtures = () => {
    if (!stage) return
    setLoading(true)
    startTransition(async () => {
      const res = await generateTeamGroupFixtures(stage.id, tournament.id, formatType)
      setLoading(false)
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

      {/* ── Step 1: Configure groups (only before stage created) ── */}
      {!stage && (
        <Card>
          <CardHeader><CardTitle className="text-base">Configure Groups</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              <strong>{numTeams}</strong> teams · Snake seeding distributes seeds evenly across groups.
            </p>

            {/* Mode toggle */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Define groups by</p>
              <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                {(['numGroups', 'perGroup'] as const).map(m => (
                  <button key={m} onClick={() => setConfigMode(m)}
                    className={cn('px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                      configMode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {m === 'numGroups' ? '# of groups' : 'Teams per group'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              {configMode === 'numGroups' ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Number of groups</label>
                  <input type="number" min={1} max={Math.max(1, Math.floor(numTeams / 2))}
                    value={numGroups} onChange={e => setNumGroups(Math.max(1, parseInt(e.target.value) || 1))}
                    className={cn(inputCls, 'w-24')} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Teams per group</label>
                  <input type="number" min={2} max={numTeams}
                    value={teamsPerGroup} onChange={e => setTeamsPerGroup(Math.max(2, parseInt(e.target.value) || 2))}
                    className={cn(inputCls, 'w-24')} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Advance per group</label>
                <input type="number" min={1}
                  value={advanceCount} onChange={e => setAdvanceCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className={cn(inputCls, 'w-24')} />
              </div>
            </div>

            {/* Layout preview text */}
            {numTeams >= 2 && (
              <p className="text-sm text-muted-foreground">
                Layout: <strong>{groupLayoutSummary(layout)}</strong>
                {advanceCount > 0 && ` · Top ${advanceCount} advance → ${layout.numGroups * advanceCount} in KO bracket`}
              </p>
            )}

            {/* Snake distribution preview */}
            {numTeams >= 2 && preview.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Snake seeding preview
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        {preview.map((_, gi) => (
                          <th key={gi} className="text-left px-3 py-1.5 font-semibold text-muted-foreground">
                            Group {gi + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.max(...preview.map(g => g.length)) }, (_, ri) => (
                        <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-muted/20'}>
                          {preview.map((grp, gi) => {
                            const t = grp[ri]
                            return (
                              <td key={gi} className="px-3 py-1.5">
                                {t ? (
                                  <div className="flex items-center gap-1.5">
                                    {t.seed != null && (
                                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[9px] font-bold">
                                        {t.seed}
                                      </span>
                                    )}
                                    <span className="font-medium">{t.name}</span>
                                  </div>
                                ) : null}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Button size="sm" onClick={handleCreateStage}
              disabled={isPending || !canCreate || numTeams < 2} className="gap-1.5 self-start">
              <PlayCircle className="h-3.5 w-3.5" />
              Create Groups &amp; Assign Teams
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Stage exists ── */}
      {stage && (
        <div className="flex flex-col gap-4">
          {/* Config summary */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>{groups.length} group{groups.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>Top {stage.config.advanceCount} advance per group</span>
            {!fixturesExist && (
              <>
                <span>·</span>
                <button onClick={handleRegenerateGroups} disabled={isPending}
                  className="text-orange-500 hover:text-orange-400 transition-colors text-xs font-medium">
                  Re-assign teams
                </button>
              </>
            )}
          </div>

          {/* Groups */}
          {groups.map(group => {
            const groupTeams   = group.teamIds.map(id => teams.find(t => t.id === id)).filter(Boolean) as TeamWithPlayers[]
            const groupMatches = [...rrMatches.filter(m => m.group_id === group.id)].sort((a, b) => {
              const o = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
              return o(a.status) - o(b.status)
            })
            const standings    = computeStandings(group.id, group.teamIds, teamMatches)
            const isExpanded   = expandedGroup === group.id
            const allDone      = groupMatches.length > 0 && groupMatches.every(m => m.status === 'complete')

            return (
              <Card key={group.id} className={cn(
                'overflow-hidden',
                allDone ? 'border-border/40' :
                groupMatches.some(m => m.status === 'live') ? 'border-orange-400/50' : '',
              )}>
                {/* Always-visible: group header + inline standings */}
                <div className="px-4 pt-3 pb-2">
                  {/* Group name + status */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{group.name}</span>
                      {groupMatches.some(m => m.status === 'live') && (
                        <span className="live-dot" />
                      )}
                      {allDone && <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">✓ Complete</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {groupMatches.filter(m => m.status === 'complete').length}/{groupMatches.length} done
                    </span>
                  </div>

                  {/* Inline standings — always visible */}
                  <div className="flex flex-col gap-0.5">
                    {standings.map((row, idx) => {
                      const t = teams.find(x => x.id === row.teamId)
                      const isAdv = idx < stage.config.advanceCount
                      const played = row.mW + row.mL
                      return (
                        <div key={row.teamId} className={cn(
                          'flex items-center gap-2 px-2 py-1.5 rounded-lg',
                          isAdv && played > 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/15' : '',
                        )}>
                          <span className={cn(
                            'text-xs font-bold w-4 text-center shrink-0',
                            isAdv && played > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                          )}>{idx + 1}</span>
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t?.color ?? '#888' }} />
                          <span className={cn(
                            'text-sm flex-1 min-w-0 truncate',
                            idx === 0 && played > 0 ? 'font-semibold text-foreground' : 'text-foreground',
                          )}>{t?.name ?? '?'}</span>
                          {/* Stats: TW · RW · GW */}
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs font-mono tabular-nums" title="Ties Won">
                              <span className={cn('font-bold', row.mW > 0 ? 'text-foreground' : 'text-muted-foreground/40')}>{row.mW}</span>
                              <span className="text-muted-foreground/40">-{row.mL}</span>
                            </span>
                            <span className="text-xs font-mono tabular-nums text-muted-foreground" title="Rubbers">
                              {row.rW}-{row.rL}
                            </span>
                          </div>
                          {isAdv && played > 0 && <ArrowRight className="h-3 w-3 text-emerald-500 shrink-0" />}
                        </div>
                      )
                    })}
                  </div>
                  {stage.config.advanceCount > 0 && standings.some(r => r.mW + r.mL > 0) && (
                    <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                      Top {stage.config.advanceCount} advance · TW = Tie wins · RW = Rubber wins
                    </p>
                  )}
                </div>

                {/* Fixtures toggle */}
                <button
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  className="w-full flex items-center justify-between px-4 py-2 border-t border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                >
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {isExpanded ? 'Hide Fixtures' : 'Show Fixtures'}
                  </span>
                  {isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>

                {isExpanded && (
                  <CardContent className="flex flex-col gap-3 pt-3">

                    {/* Fixtures with inline scoring */}
                    {groupMatches.length > 0 && (
                      <div>
                        <p className={cn(T.roundHeading, "mb-2")}>Fixtures</p>
                        <div className="flex flex-col gap-2">
                          {groupMatches.map(m => {
                            const isExpM     = expandedMatch === m.id
                            const isComplete = m.status === 'complete'
                            const doneCount  = m.submatches.filter(s => s.scoring?.status === 'complete').length

                            return (
                              <Card key={m.id} className={cn(
                                'overflow-hidden transition-all',
                                m.status === 'complete' ? 'bg-[#BEBEBE]/60 dark:bg-[#5a5a5a]/40 border-border/40' :
                                m.status === 'live'     ? 'border-orange-400/70 shadow-sm shadow-orange-100/40 dark:shadow-orange-900/10' :
                                ''
                              )}>
                                <CardContent className="pt-3 pb-3">
                                  {/* Fixture header — grid layout for perfect score alignment */}
                                  <button className="w-full text-left" onClick={() => setExpandedMatch(isExpM ? null : m.id)}>
                                    <div className="grid py-1" style={{ gridTemplateColumns: '1fr 2.5rem 4.5rem' }}>
                                      {/* Team A name */}
                                      <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                        {isComplete && m.winner_team_id === m.team_a_id
                                          ? <span className="text-amber-500 text-xs shrink-0">🏆</span>
                                          : <span className="w-3.5 shrink-0" />}
                                        <span className={cn('text-sm truncate',
                                          isComplete && m.winner_team_id === m.team_a_id ? 'font-bold text-foreground' :
                                          isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>
                                          {m.team_a_name ?? <span className="italic text-muted-foreground/50">TBD</span>}
                                        </span>
                                      </div>
                                      {/* Team A score — centre column */}
                                      <span className={cn('font-mono font-bold text-lg tabular-nums text-center self-center',
                                        isComplete && m.winner_team_id === m.team_a_id ? 'text-foreground' : isComplete ? 'text-muted-foreground/50' : 'text-muted-foreground/60')}>
                                        {m.team_a_score}
                                      </span>
                                      {/* Action column — progress + chevron */}
                                      <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground self-center">
                                        <span>{doneCount}/{m.submatches.length}</span>
                                        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0', isExpM && 'rotate-180')} />
                                      </div>
                                    </div>
                                    <div className="border-b border-border/20 mx-1" />
                                    <div className="grid py-1" style={{ gridTemplateColumns: '1fr 2.5rem 4.5rem' }}>
                                      {/* Team B name */}
                                      <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                        {isComplete && m.winner_team_id === m.team_b_id
                                          ? <span className="text-amber-500 text-xs shrink-0">🏆</span>
                                          : <span className="w-3.5 shrink-0" />}
                                        <span className={cn('text-sm truncate',
                                          isComplete && m.winner_team_id === m.team_b_id ? 'font-bold text-foreground' :
                                          isComplete ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>
                                          {m.team_b_name ?? <span className="italic text-muted-foreground/50">TBD</span>}
                                        </span>
                                      </div>
                                      {/* Team B score */}
                                      <span className={cn('font-mono font-bold text-lg tabular-nums text-center self-center',
                                        isComplete && m.winner_team_id === m.team_b_id ? 'text-foreground' : isComplete ? 'text-muted-foreground/50' : 'text-muted-foreground/60')}>
                                        {m.team_b_score}
                                      </span>
                                      <span />{/* empty action column */}
                                    </div>
                                  </button>

                                  {/* Inline rubber entry */}
                                  {isExpM && (
                                    <FixtureDetailPanel
                                      match={m}
                                      teams={teams}
                                      isCorbillon={isCorbillon}
                                      tournament={tournament}
                                      loadData={() => loadData(true)}
                                    />
                                  )}
                                </CardContent>
                              </Card>
                            )
                          })}
                        </div>
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

          {/* Finalize / proceed */}
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
            <NextStepBanner variant="action"
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
// ─────────────────────────────────────────────────────────────────────────────
// KOMatchCard — full-width expandable match card matching TeamMatchBracketCard
// style from TeamLeagueStage: round tabs at top, team name + player dropdowns
// ─────────────────────────────────────────────────────────────────────────────

function KOMatchCard({ match, teams, isCorbillon, tournament, highlightFix, loadData }: {
  match:       TeamMatchRich
  teams:       TeamWithPlayers[]
  isCorbillon: boolean
  tournament:  Tournament
  highlightFix?: string
  loadData:    (s?: boolean) => Promise<void>
}) {
  const isHighlighted = !!highlightFix && highlightFix === match.id
  const [open, setOpen] = useState(isHighlighted)
  const isDone  = match.status === 'complete'
  const isLive  = match.status === 'live'
  const aWon    = isDone && match.winner_team_id === match.team_a_id
  const bWon    = isDone && match.winner_team_id === match.team_b_id
  const subsDone = match.submatches.filter(s => s.scoring?.status === 'complete').length

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden transition-all',
      isDone  && 'bg-[#BEBEBE]/60 dark:bg-[#5a5a5a]/40 border-border/40',
      isLive  && 'border-orange-400 dark:border-orange-500 shadow-md shadow-orange-100/40 dark:shadow-orange-950/30 bg-card',
      !isLive && !isDone && 'bg-card border-border',
      isHighlighted && 'ring-2 ring-orange-400/50',
    )}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3.5 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {/* Team A */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: match.team_a_color }} />
              <WinnerTrophy show={aWon} size="sm" />
              <span className={cn('text-sm truncate flex-1',
                aWon ? 'font-bold text-foreground' : bWon ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
              )}>
                {match.team_a_name ?? <span className="text-muted-foreground/40 italic">TBD</span>}
              </span>
              <span className={cn('font-mono font-bold tabular-nums text-base',
                aWon ? 'text-foreground' : isDone ? 'text-muted-foreground/50' : 'text-muted-foreground/60',
              )}>{match.team_a_score}</span>
            </div>
            <div className="flex items-center gap-1 my-0.5 ml-9">
              <span className="text-xs text-muted-foreground/40">—</span>
            </div>
            {/* Team B */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: match.team_b_color }} />
              <WinnerTrophy show={bWon} size="sm" />
              <span className={cn('text-sm truncate flex-1',
                bWon ? 'font-bold text-foreground' : aWon ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground',
              )}>
                {match.team_b_name ?? <span className="text-muted-foreground/40 italic">TBD</span>}
              </span>
              <span className={cn('font-mono font-bold tabular-nums text-base',
                bWon ? 'text-foreground' : isDone ? 'text-muted-foreground/50' : 'text-muted-foreground/60',
              )}>{match.team_b_score}</span>
            </div>
            {/* Status row */}
            <div className="flex items-center gap-2 mt-1.5 ml-0">
              {isLive && <span className="flex items-center gap-1 text-[11px] font-bold text-orange-500"><span className="live-dot" /> Live</span>}
              {isDone && <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Complete</span>}
              {!isLive && !isDone && (
                <span className="text-[11px] text-muted-foreground">
                  {subsDone}/{match.submatches.length} matches done
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {open ? 'Hide' : 'Show'} matches
            </span>
            {open
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </button>

      {/* Live bar */}
      {isLive && (
        <div className="h-0.5" style={{ background: 'linear-gradient(90deg,#F06321,#F5853F,#F06321)', backgroundSize: '200% 100%' }} />
      )}

      {/* Expanded: sub-match details — compact accordion same as groups tab */}
      {open && (
        <div className="border-t border-border/50 px-4 py-1">
          <FixtureDetailPanel
            match={match}
            teams={teams}
            isCorbillon={isCorbillon}
            tournament={tournament}
            loadData={() => loadData(true)}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KnockoutTab — tabbed bracket with round tabs + full-width match cards
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
  const searchParams = useSearchParams()
  const highlightFix: string = searchParams.get('fix') ?? ''

  const isKOOnly = tournament.format_type === 'team_league_ko'
               || tournament.format_type === 'team_league_swaythling'

  if (koMatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Lock className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">
          {isKOOnly
            ? 'KO bracket not yet generated. Go to the Teams tab and generate the bracket.'
            : 'KO bracket not yet generated. Complete all group matches first.'}
        </p>
      </div>
    )
  }

  // Group by round, sorted
  const roundEntries = useMemo((): [number, TeamMatchRich[]][] => {
    const map = new Map<number, TeamMatchRich[]>()
    for (const m of koMatches) {
      const arr = map.get(m.round) ?? []; arr.push(m); map.set(m.round, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  }, [koMatches])

  const totalRounds = roundEntries.length

  // Auto-select active round: live > first incomplete > last
  const latestRound = useMemo((): number => {
    const live = koMatches.find(m => m.status === 'live')?.round
    if (live) return live
    const incomplete = koMatches.filter(m => m.status !== 'complete')
    if (incomplete.length) return Math.min(...incomplete.map(m => m.round))
    return (roundEntries[roundEntries.length - 1]?.[0] as number) ?? koMatches[0]?.round ?? 900
  }, [koMatches, roundEntries])

  const [activeRound, setActiveRound] = useState<number>(latestRound)
  const prevLatest = useRef(latestRound)
  useEffect(() => {
    if (prevLatest.current !== latestRound) {
      prevLatest.current = latestRound
      setActiveRound(latestRound)
    }
  }, [latestRound])

  const rawActiveMatches = roundEntries.find(([r]: [number, TeamMatchRich[]]) => r === activeRound)?.[1] ?? []
  const activeMatches = [...rawActiveMatches].sort((a, b) => {
    const o = (s: string) => s === 'live' ? 0 : s === 'pending' ? 1 : 2
    return o(a.status) - o(b.status)
  })
  const doneCount = koMatches.filter(m => m.status === 'complete').length
  const liveCount = koMatches.filter(m => m.status === 'live').length

  const getRoundLabel = (roundNum: number, idx: number) => {
    const fromEnd = totalRounds - idx
    if (fromEnd === 1) return '🏆 Final'
    if (fromEnd === 2) return 'Semi-Finals'
    if (fromEnd === 3) return 'Quarter-Finals'
    return `Round of ${Math.pow(2, fromEnd)}`
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Swords className="h-5 w-5 text-amber-500" />
        <div className="flex-1">
          <h2 className="font-bold text-base text-foreground">{formatLabel} — Knockout</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {doneCount}/{koMatches.length} matches complete
            {liveCount > 0 && <span className="ml-2 text-orange-500 font-semibold">· {liveCount} live</span>}
          </p>
        </div>
      </div>

      {/* Round tabs */}
      <div
        className="flex items-end gap-1 overflow-x-auto pb-0 scrollbar-hide border-b-2 mb-5"
        style={{ borderColor: '#F06321' }}
      >
        {roundEntries.map(([roundNum, matches]: [number, TeamMatchRich[]], idx: number) => {
          const isActive    = activeRound === roundNum
          const liveInRound = matches.filter(m => m.status === 'live').length
          const doneInRound = matches.filter(m => m.status === 'complete').length
          const label       = getRoundLabel(roundNum, idx)
          const isLatest    = roundNum === latestRound

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

      {/* Active round matches */}
      <div className="flex flex-col gap-3">
        {activeMatches.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-sm">No matches in this round.</div>
        )}
        {(activeMatches as TeamMatchRich[]).map((m: TeamMatchRich) => (
          <KOMatchCard
            key={m.id}
            match={m}
            teams={teams}
            isCorbillon={isCorbillon}
            tournament={tournament}
            highlightFix={highlightFix}
            loadData={loadData}
          />
        ))}
      </div>
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

  const isCorbillon  = tournament.format_type === 'team_group_corbillon' || tournament.format_type === 'team_league_ko'
  const formatLabel  = isCorbillon ? 'Corbillon Cup' : 'Swaythling Cup'
  // KO-only formats: team_league_ko and team_league_swaythling have no group stage
  const isKOOnly = tournament.format_type === 'team_league_ko'
               || tournament.format_type === 'team_league_swaythling'

  type TabKey = 'teams' | 'groups' | 'knockout'
  const [activeTab, setActiveTab] = useState<TabKey>('teams')

  const rrMatches     = teamMatches.filter(m => m.group_id != null)
  const koMatches     = teamMatches.filter(m => m.group_id == null && m.round >= 900)
  const fixturesExist = rrMatches.length > 0
  const allRRDone     = fixturesExist && rrMatches.every(m => m.status === 'complete')
  const koExists      = koMatches.length > 0

  useEffect(() => {
    if (koExists) setActiveTab('knockout')
    else if (!isKOOnly && stage) setActiveTab('groups')
  }, [stage?.id, koExists, isKOOnly])

  if (loading) return <InlineLoader label="Loading team data…" />

  const tabs = [
    { key: 'teams'    as TabKey, label: 'Teams',    icon: <Users className="h-4 w-4" />, done: teams.length >= 2 },
    ...(!isKOOnly ? [{ key: 'groups' as TabKey, label: 'Groups', icon: <Layers className="h-4 w-4" />, done: fixturesExist }] : []),
    { key: 'knockout' as TabKey, label: 'Knockout', icon: <Trophy className="h-4 w-4" />, done: koExists },
  ]

  // KO-only generate handler — bypasses group stage
  // NOTE: must NOT use startTransition here — React batches state inside transitions
  // which causes KnockoutTab to render before teamMatches state has updated.
  const handleGenerateKODirect = async () => {
    setLoading(true)
    const res = isCorbillon
      ? await generateTeamKOBracket(tournament.id)
      : await generateTeamSwaythlingBracket(tournament.id)
    setLoading(false)
    if (res.error) {
      toast({ title: 'Generation failed', description: res.error, variant: 'destructive' })
      return
    }
    // Load fresh data FIRST, then switch tabs so KnockoutTab sees populated koMatches
    await loadData()
    router.refresh()
    toast({ title: '✅ Bracket generated', variant: 'success' })
    setActiveTab('knockout')
  }

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
          onNext={isKOOnly ? undefined : () => setActiveTab('groups')}
          formatLabel={formatLabel}
          isKOOnly={isKOOnly}
          koExists={koExists}
          onGenerateKO={isKOOnly ? handleGenerateKODirect : undefined}
        />
      )}

      {/* Tab: Groups (Groups+KO formats only) */}
      {activeTab === 'groups' && !isKOOnly && (
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
