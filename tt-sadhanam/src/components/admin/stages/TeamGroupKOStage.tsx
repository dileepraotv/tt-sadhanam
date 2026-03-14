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
  batchUpdateSubmatchPlayers,
} from '@/lib/actions/teamLeague'
import {
  createTeamRRStage, generateTeamGroups, generateTeamGroupFixtures,
  finalizeTeamGroups, resetTeamGroupStage, updateTeamGroupMatchWinner,
} from '@/lib/actions/teamGroupKO'
import { saveGameScore, declareMatchWinner, updateMatchFormat } from '@/lib/actions/matches'
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
  } | null
}

interface TeamMatchRich {
  id:             string
  team_a_id:      string
  team_b_id:      string
  // Team display data embedded at load time — never needs a runtime lookup
  team_a_name:    string
  team_b_name:    string
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
// Data hook — loads teams, stage, groups, and team_matches in parallel
// ─────────────────────────────────────────────────────────────────────────────

// useTeamGroupData — stable supabase ref, flat queries, team names embedded in matches
function useTeamGroupData(tournamentId: string) {
  // ONE stable client for the lifetime of this component tree
  const sbRef     = useRef(createClient())
  const sb        = sbRef.current

  const [teams,       setTeams]       = useState<TeamWithPlayers[]>([])
  const [teamMatches, setTeamMatches] = useState<TeamMatchRich[]>([])
  const [groups,      setGroups]      = useState<RRGroup[]>([])
  const [stage,       setStage]       = useState<StageRow | null>(null)
  const [loading,     setLoading]     = useState(true)

  // Generation counter: only the most recent fetch may commit
  const genRef     = useRef(0)
  const inflightRef = useRef(false)

  const loadData = useCallback(async (silent = false) => {
    // Drop concurrent calls — Realtime debounce ensures we catch up
    if (inflightRef.current && silent) return
    const gen = ++genRef.current
    inflightRef.current = true
    if (!silent) setLoading(true)

    try {
      // ── Fetch 1: teams + their players ─────────────────────────────────────
      const { data: rawTeams } = await sb
        .from('teams')
        .select('id, name, short_name, color, seed, doubles_p1_pos, doubles_p2_pos, team_players(id, name, position)')
        .eq('tournament_id', tournamentId)
        .order('created_at')
      if (gen !== genRef.current) return

      // Build a plain lookup — key is UUID, value is team display data
      // This map is LOCAL to this fetch and never shared with any state
      const tById = new Map((rawTeams ?? []).map((t: any) => [t.id as string, t]))

      const teamList: TeamWithPlayers[] = (rawTeams ?? []).map((t: any) => ({
        id: t.id, name: t.name, short_name: t.short_name, color: t.color,
        seed: t.seed, doubles_p1_pos: t.doubles_p1_pos, doubles_p2_pos: t.doubles_p2_pos,
        tournament_id: tournamentId, created_at: t.created_at ?? '',
        players: ((t.team_players ?? []) as TeamPlayer[]).sort((a, b) => a.position - b.position),
      }))

      // ── Fetch 2: team_matches (IDs + scores only, NO FK joins) ─────────────
      const { data: rawMatches } = await sb
        .from('team_matches')
        .select('id, team_a_id, team_b_id, round, round_name, status, team_a_score, team_b_score, winner_team_id, group_id')
        .eq('tournament_id', tournamentId)
        .order('round')
      if (gen !== genRef.current) return

      const matchIds = (rawMatches ?? []).map((m: any) => m.id as string)

      // ── Fetch 3: submatches (flat, no joins) ───────────────────────────────
      const { data: rawSMs } = matchIds.length > 0
        ? await sb.from('team_match_submatches')
            .select('id, team_match_id, match_order, label, player_a_name, player_b_name, team_a_player_id, team_b_player_id, team_a_player2_id, team_b_player2_id, match_id')
            .in('team_match_id', matchIds)
            .order('match_order')
        : { data: [] }
      if (gen !== genRef.current) return

      // ── Fetch 4: rubber scoring (flat, no joins) ───────────────────────────
      const smMatchIds = ((rawSMs ?? []) as any[]).map(s => s.match_id).filter(Boolean) as string[]
      const { data: rawScoring } = smMatchIds.length > 0
        ? await sb.from('matches')
            .select('id, player1_games, player2_games, status, match_format')
            .in('id', smMatchIds)
        : { data: [] }
      if (gen !== genRef.current) return

      // ── Build scoring index ────────────────────────────────────────────────
      const scoringIdx = new Map(((rawScoring ?? []) as any[]).map(s => [s.id as string, s]))

      // ── Build submatches index by team_match_id ────────────────────────────
      const smIdx = new Map<string, Submatch[]>()
      for (const sm of (rawSMs ?? []) as any[]) {
        const list = smIdx.get(sm.team_match_id) ?? []
        list.push({
          id:                sm.id,
          match_order:       sm.match_order,
          label:             sm.label,
          player_a_name:     sm.player_a_name,
          player_b_name:     sm.player_b_name,
          team_a_player_id:  sm.team_a_player_id,
          team_b_player_id:  sm.team_b_player_id,
          team_a_player2_id: sm.team_a_player2_id,
          team_b_player2_id: sm.team_b_player2_id,
          match_id:          sm.match_id,
          scoring:           sm.match_id ? (scoringIdx.get(sm.match_id) ?? null) : null,
        })
        smIdx.set(sm.team_match_id, list)
      }

      // ── Assemble TeamMatchRich — team names embedded from THIS fetch's tById ──
      // tById is a LOCAL variable, not from state — guaranteed consistent with matches
      const matchList: TeamMatchRich[] = (rawMatches ?? []).map((m: any) => {
        const tA = tById.get(m.team_a_id as string)
        const tB = tById.get(m.team_b_id as string)
        return {
          id:             m.id,
          team_a_id:      m.team_a_id,
          team_b_id:      m.team_b_id,
          team_a_name:    tA?.name   ?? 'Unknown',
          team_b_name:    tB?.name   ?? 'Unknown',
          team_a_color:   tA?.color  ?? '#888',
          team_b_color:   tB?.color  ?? '#888',
          round:          m.round,
          round_name:     m.round_name,
          status:         m.status,
          team_a_score:   m.team_a_score,
          team_b_score:   m.team_b_score,
          winner_team_id: m.winner_team_id,
          group_id:       m.group_id,
          submatches:     (smIdx.get(m.id) ?? []).sort((a, b) => a.match_order - b.match_order),
        }
      })

      // ── Fetch 5: groups + members (only when stage exists) ─────────────────
      const { data: rawStage } = await sb
        .from('stages').select('id, config')
        .eq('tournament_id', tournamentId).eq('stage_number', 1).maybeSingle()
      if (gen !== genRef.current) return

      let groupList: RRGroup[] = []
      if (rawStage) {
        const { data: rawGroups } = await sb
          .from('rr_groups').select('id, group_number, name')
          .eq('stage_id', rawStage.id).order('group_number')
        if (gen !== genRef.current) return

        const gIds = (rawGroups ?? []).map((g: any) => g.id as string)
        const { data: rawMembers } = gIds.length > 0
          ? await sb.from('team_rr_group_members').select('group_id, team_id').in('group_id', gIds)
          : { data: [] }
        if (gen !== genRef.current) return

        const mMap = new Map<string, string[]>()
        for (const r of (rawMembers ?? []) as any[]) {
          const arr = mMap.get(r.group_id) ?? []; arr.push(r.team_id); mMap.set(r.group_id, arr)
        }
        groupList = (rawGroups ?? []).map((g: any) => ({
          id: g.id, group_number: g.group_number, name: g.name,
          teamIds: mMap.get(g.id) ?? [],
        }))
      }

      if (gen !== genRef.current) return

      // ── Commit — all state updated atomically from the same fetch ──────────
      setTeams(teamList)
      setTeamMatches(matchList)
      setGroups(groupList)
      setStage(rawStage as StageRow | null)
    } finally {
      inflightRef.current = false
      if (gen === genRef.current) setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => { loadData() }, [loadData])

  // Debounced realtime — collapses rapid events into one fetch after 500ms quiet
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => loadData(true), 500)
    }
    const ch = sb.channel(`team-group-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches',         filter: `tournament_id=eq.${tournamentId}` }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_match_submatches' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, debounced)
      .subscribe()
    return () => { sb.removeChannel(ch); if (timer) clearTimeout(timer) }
  }, [tournamentId, loadData])

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

// ─────────────────────────────────────────────────────────────────────────────
// RubberScorer — inline game-score entry for one rubber
// ─────────────────────────────────────────────────────────────────────────────

type GameLocal = { s1: string; s2: string }

// ─────────────────────────────────────────────────────────────────────────────
// Table tennis score validation
// Rules: first to 11, win by 2; if both ≥ 10 (deuce) must win by exactly 2
// ─────────────────────────────────────────────────────────────────────────────

function validateTTScore(s1: number, s2: number): string | null {
  if (s1 < 0 || s2 < 0)           return 'Scores cannot be negative'
  const max = Math.max(s1, s2), min = Math.min(s1, s2)
  if (max < 11)                    return `Winner needs at least 11 points (got ${max})`
  if (min >= 10 && max - min < 2)  return `At deuce (both ≥ 10), must win by 2 — ${s1}-${s2} is invalid`
  if (min >= 10 && max - min > 2)  return `At deuce, must win by exactly 2 — ${s1}-${s2} is invalid`
  if (min < 10 && max > 11)        return `${s1}-${s2} is invalid — game ends at 11 when opponent has < 10`
  return null
}

function RubberScorer({
  submatch, teamA, teamB, isCorbillon, tournamentId, matchFormat: propFormat, onSaved,
}: {
  submatch:     Submatch
  teamA:        TeamWithPlayers | null
  teamB:        TeamWithPlayers | null
  isCorbillon:  boolean
  tournamentId: string
  matchFormat:  MatchFormat
  onSaved:      () => void
}) {
  const sbRef = useRef(createClient())
  const supabase = sbRef.current
  const [games,       setGames]    = useState<Array<{id:string;game_number:number;score1:number;score2:number}>>([])
  const [localScores, setLocal]    = useState<Record<number, GameLocal>>({})
  const [saving,      setSaving]   = useState(false)
  const [loadingG,    setLoadingG] = useState(true)
  const [forceEdit,   setForceEdit] = useState(false)
  // Per-rubber format selector — defaults to tournament format, user can override
  const [activeFormat, setActiveFormat] = useState<MatchFormat>(propFormat)
  const scoring = submatch.scoring

  useEffect(() => {
    if (!submatch.match_id) { setLoadingG(false); return }
    supabase.from('games').select('*').eq('match_id', submatch.match_id)
      .order('game_number')
      .then(({ data }) => {
        const gs = data ?? []
        setGames(gs)
        const init: Record<number, GameLocal> = {}
        for (const g of gs) init[g.game_number] = { s1: String(g.score1??''), s2: String(g.score2??'') }
        setLocal(init)
        setLoadingG(false)
      })
  }, [submatch.match_id])

  // When format changes, persist it to the match row so saveGameScore uses it
  const handleFormatChange = async (fmt: MatchFormat) => {
    setActiveFormat(fmt)
    if (submatch.match_id) {
      await updateMatchFormat(submatch.match_id, fmt)
    }
  }

  // Always show exactly maxGames columns (all 5 for bo5, all 3 for bo3, all 7 for bo7)
  const maxGames = activeFormat === 'bo3' ? 3 : activeFormat === 'bo7' ? 7 : 5

  const [scoreErrors, setScoreErrors] = useState<Record<number, string>>({})

  const handleScore = (gn: number, field: 'a' | 'b', val: string) => {
    setLocal(prev => {
      const updated = { ...prev, [gn]: { ...prev[gn] ?? { s1:'', s2:'' }, [field === 'a' ? 's1' : 's2']: val } }
      // Validate immediately once both scores are filled
      const row = updated[gn]
      if (row.s1 !== '' && row.s2 !== '') {
        const s1 = parseInt(row.s1, 10), s2 = parseInt(row.s2, 10)
        if (!isNaN(s1) && !isNaN(s2)) {
          const err = validateTTScore(s1, s2)
          setScoreErrors(prev => ({ ...prev, [gn]: err ?? '' }))
        }
      } else {
        setScoreErrors(prev => { const n = {...prev}; delete n[gn]; return n })
      }
      return updated
    })
  }

  const handleSave = async () => {
    if (!submatch.match_id) return

    // Validate all filled scores before sending to server
    const entries = Array.from({ length: maxGames }, (_, i) => i + 1)
      .map(gn => ({ gn, sc: localScores[gn] }))
      .filter(({ sc }) => sc && !(sc.s1 === '' && sc.s2 === ''))

    for (const { gn, sc } of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) continue
      const validErr = validateTTScore(s1, s2)
      if (validErr) {
        toast({ title: `Game ${gn}: ${validErr}`, variant: 'destructive' })
        return
      }
    }

    setSaving(true)
    for (const { gn, sc } of entries) {
      const s1 = parseInt(sc!.s1, 10), s2 = parseInt(sc!.s2, 10)
      if (isNaN(s1) || isNaN(s2)) continue
      const res = await saveGameScore(submatch.match_id, gn, s1, s2)
      if (!res.success) {
        // If "cannot add" the rubber is already decided — stop silently
        if (res.error?.includes('Cannot add') || res.error?.includes('already complete')) break
        toast({ title: `Game ${gn}: ${res.error}`, variant: 'destructive' })
        setSaving(false)
        return
      }
    }
    toast({ title: 'Rubber scores saved', variant: 'success' })
    setSaving(false)
    onSaved()
  }

  // FIX: pass 'p1'/'p2' — these are the sentinels declareMatchWinner checks for team submatches
  const handleDeclareWinner = async (side: 'p1' | 'p2') => {
    if (!submatch.match_id) return
    setSaving(true)
    const res = await declareMatchWinner(submatch.match_id, side, 'declared')
    setSaving(false)
    if (!res.success) { toast({ title: res.error ?? 'Failed', variant: 'destructive' }); return }
    toast({ title: 'Rubber result saved', variant: 'success' })
    onSaved()
  }

  if (loadingG) return <div className="text-xs text-muted-foreground py-2 px-3">Loading…</div>

  const isComplete   = (scoring?.status === 'complete') && !forceEdit
  const p1Wins       = scoring?.player1_games ?? 0
  const p2Wins       = scoring?.player2_games ?? 0

  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-3">

      {/* Format selector */}
      {!isComplete && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Format:</span>
          <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
            {(['bo3','bo5','bo7'] as MatchFormat[]).map(fmt => (
              <button key={fmt} onClick={() => handleFormatChange(fmt)}
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-semibold transition-colors',
                  activeFormat === fmt
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {fmt === 'bo3' ? 'Best of 3' : fmt === 'bo5' ? 'Best of 5' : 'Best of 7'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Score grid — always show maxGames columns */}
      <div className="overflow-x-auto">
        <div className="grid gap-1 min-w-0"
          style={{ gridTemplateColumns: `minmax(80px,1fr) repeat(${maxGames}, 48px)` }}>
          {/* Header */}
          <div className="text-xs font-semibold text-muted-foreground py-1">Team</div>
          {Array.from({ length: maxGames }, (_, i) => (
            <div key={i} className="text-xs text-center font-mono text-muted-foreground py-1">{i+1}</div>
          ))}
          {/* Team A row */}
          <div className="text-xs font-medium py-1 truncate self-center">{teamA?.name ?? 'Team A'}</div>
          {Array.from({ length: maxGames }, (_, i) => {
            const gn = i + 1
            return (
              <input key={gn} type="number" min={0} max={99}
                value={localScores[gn]?.s1 ?? ''}
                onChange={e => handleScore(gn, 'a', e.target.value)}
                disabled={isComplete || saving}
                className="w-full text-center text-sm py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-orange-500/50 disabled:opacity-40 [appearance:textfield]"
              />
            )
          })}
          {/* Team B row */}
          <div className="text-xs font-medium py-1 truncate self-center">{teamB?.name ?? 'Team B'}</div>
          {Array.from({ length: maxGames }, (_, i) => {
            const gn = i + 1
            return (
              <input key={gn} type="number" min={0} max={99}
                value={localScores[gn]?.s2 ?? ''}
                onChange={e => handleScore(gn, 'b', e.target.value)}
                disabled={isComplete || saving}
                className="w-full text-center text-sm py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-orange-500/50 disabled:opacity-40 [appearance:textfield]"
              />
            )
          })}
        </div>
        {/* Inline validation errors */}
        {Object.entries(scoreErrors).filter(([, e]) => e).map(([gn, err]) => (
          <p key={gn} className="text-xs text-destructive flex items-center gap-1 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Game {gn}: {err}
          </p>
        ))}
      </div>

      {/* Result / actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {isComplete ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {p1Wins > p2Wins ? (teamA?.name ?? 'Team A') : (teamB?.name ?? 'Team B')} wins {p1Wins}–{p2Wins}
            </span>
            <button onClick={() => setForceEdit(true)}
              className="text-xs text-muted-foreground hover:text-orange-500 underline transition-colors">
              Edit
            </button>
          </div>
        ) : (
          <>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 h-7 text-xs">
              {saving ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3 w-3" />}
              Save Scores
            </Button>
            <span className="text-xs text-muted-foreground">or declare:</span>
            <Button size="sm" variant="outline" onClick={() => handleDeclareWinner('p1')} disabled={saving}
              className="h-7 text-xs gap-1">
              <Trophy className="h-3 w-3" /> {teamA?.name ?? 'Team A'} wins
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleDeclareWinner('p2')} disabled={saving}
              className="h-7 text-xs gap-1">
              <Trophy className="h-3 w-3" /> {teamB?.name ?? 'Team B'} wins
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LineupEditor — player selectors for one rubber
// ─────────────────────────────────────────────────────────────────────────────

function LineupEditor({
  submatch, teamA, teamB, isCorbillon,
  onChange,
}: {
  submatch:    Submatch
  teamA:       TeamWithPlayers | null
  teamB:       TeamWithPlayers | null
  isCorbillon: boolean
  onChange:    (aId: string|null, bId: string|null, a2Id?: string|null, b2Id?: string|null) => void
}) {
  const isDbl = isCorbillon && submatch.match_order === 3

  const [aId,  setAId]  = useState<string>(submatch.team_a_player_id ?? '')
  const [bId,  setBId]  = useState<string>(submatch.team_b_player_id ?? '')
  const [a2Id, setA2Id] = useState<string>(submatch.team_a_player2_id ?? '')
  const [b2Id, setB2Id] = useState<string>(submatch.team_b_player2_id ?? '')

  useEffect(() => {
    onChange(aId||null, bId||null, isDbl ? (a2Id||null) : undefined, isDbl ? (b2Id||null) : undefined)
  }, [aId, bId, a2Id, b2Id])

  const aPlayers = teamA?.players ?? []
  const bPlayers = teamB?.players ?? []
  const sel = 'px-2 py-1.5 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-orange-500/50 w-full'

  return (
    <div className="grid grid-cols-2 gap-2 mt-1.5">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">{teamA?.name ?? 'Team A'}</span>
        <select value={aId} onChange={e => setAId(e.target.value)} className={sel}>
          <option value="">— select —</option>
          {aPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={a2Id} onChange={e => setA2Id(e.target.value)} className={sel}>
            <option value="">— partner —</option>
            {aPlayers.filter(p => p.id !== aId).map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">{teamB?.name ?? 'Team B'}</span>
        <select value={bId} onChange={e => setBId(e.target.value)} className={sel}>
          <option value="">— select —</option>
          {bPlayers.map(p => <option key={p.id} value={p.id}>{p.position}. {p.name}</option>)}
        </select>
        {isDbl && (
          <select value={b2Id} onChange={e => setB2Id(e.target.value)} className={sel}>
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
  match, teams, isCorbillon, tournament, loadData,
}: {
  match:       TeamMatchRich
  teams:       TeamWithPlayers[]
  isCorbillon: boolean
  tournament:  { id: string; format: string }
  loadData:    () => void
}) {
  const [expandedRubber, setExpandedRubber] = useState<string | null>(null)
  const [lineupEdits,    setLineupEdits]    = useState<Map<string, [string|null,string|null,string|null|undefined,string|null|undefined]>>(new Map())
  const [savingLineup,   setSavingLineup]   = useState(false)
  const [lineupDirty,    setLineupDirty]    = useState(false)

  // Always look up teams directly by ID — never trust cached team_a/team_b on match objects
  const teamA  = teams.find(t => t.id === match.team_a_id) ?? null
  const teamB  = teams.find(t => t.id === match.team_b_id) ?? null
  const isLocked = match.status === 'complete'
  const format = (tournament.format ?? 'bo5') as MatchFormat

  const handleLineupChange = (smId: string, a: string|null, b: string|null, a2?: string|null, b2?: string|null) => {
    setLineupEdits(prev => { const m = new Map(prev); m.set(smId, [a, b, a2, b2]); return m })
    setLineupDirty(true)
  }

  const handleSaveLineup = async () => {
    setSavingLineup(true)
    const submatches = match.submatches.map(sm => {
      const edit = lineupEdits.get(sm.id)
      return {
        submatchId:      sm.id,
        teamAPlayerId:   edit ? edit[0] : sm.team_a_player_id,
        teamBPlayerId:   edit ? edit[1] : sm.team_b_player_id,
        teamAPlayer2Id:  edit ? edit[2] : sm.team_a_player2_id,
        teamBPlayer2Id:  edit ? edit[3] : sm.team_b_player2_id,
      }
    })
    const res = await batchUpdateSubmatchPlayers({ tournamentId: tournament.id, submatches })
    setSavingLineup(false)
    if (res.error) { toast({ title: res.error, variant: 'destructive' }); return }
    setLineupDirty(false)
    toast({ title: 'Lineup saved', variant: 'success' })
    // Realtime subscription handles the refresh — no explicit loadData needed
  }

  return (
    <div className="flex flex-col gap-0 pt-1">
      {/* Team score strip */}
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

      {/* Lineup save button */}
      {lineupDirty && !isLocked && (
        <div className="flex justify-end mb-3">
          <Button size="sm" onClick={handleSaveLineup} disabled={savingLineup}
            className="gap-1.5 h-7 text-xs">
            {savingLineup ? <span className="tt-spinner tt-spinner-sm" /> : <Check className="h-3 w-3" />}
            Save Lineup
          </Button>
        </div>
      )}

      {/* Rubber rows */}
      <div className="flex flex-col divide-y divide-border/40">
        {match.submatches.map((sm, idx) => {
          const sc         = sm.scoring
          const isRubberDone = sc?.status === 'complete'
          const aWon       = isRubberDone && sc!.player1_games > sc!.player2_games
          const bWon       = isRubberDone && sc!.player2_games > sc!.player1_games
          const isExpanded = expandedRubber === sm.id

          return (
            <div key={sm.id} className="py-2.5">
              {/* Rubber header (clickable) */}
              <button
                onClick={() => setExpandedRubber(isExpanded ? null : sm.id)}
                className="w-full flex items-center gap-2 text-left group"
              >
                {/* Rubber number */}
                <span className={cn(
                  'flex-none text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center',
                  isRubberDone ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                )}>{idx + 1}</span>

                {/* Label */}
                <span className="text-xs font-medium text-muted-foreground flex-1">{sm.label}</span>

                {/* Players */}
                <span className="text-xs text-muted-foreground hidden sm:block">
                  {sm.player_a_name ?? '?'} <span className="opacity-40">vs</span> {sm.player_b_name ?? '?'}
                </span>

                {/* Result or score */}
                {isRubberDone ? (
                  <span className="text-xs font-semibold font-mono shrink-0">
                    <span className={cn(aWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50')}>{sc!.player1_games}</span>
                    <span className="text-muted-foreground mx-0.5">–</span>
                    <span className={cn(bWon ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50')}>{sc!.player2_games}</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">pending</span>
                )}

                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0', isExpanded && 'rotate-180')} />
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="mt-2">
                  {/* Lineup editor */}
                  {!isLocked && (
                    <LineupEditor
                      submatch={sm}
                      teamA={teamA}
                      teamB={teamB}
                      isCorbillon={isCorbillon}
                      onChange={(a, b, a2, b2) => handleLineupChange(sm.id, a, b, a2, b2)}
                    />
                  )}
                  {/* Score entry */}
                  <RubberScorer
                    submatch={sm}
                    teamA={teamA}
                    teamB={teamB}
                    isCorbillon={isCorbillon}
                    tournamentId={tournament.id}
                    matchFormat={format}
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
    startTransition(async () => {
      const G = configMode === 'numGroups' ? numGroups : layout.numGroups
      const res = await createTeamRRStage({
        tournamentId:   tournament.id,
        numberOfGroups: G,
        advanceCount,
        matchFormat:    'bo5',
      })
      if (res.error) { toast({ title: res.error, variant: 'warning' }); return }
      const r2 = await generateTeamGroups(res.stageId!, tournament.id)
      if (r2.error) { toast({ title: r2.error, variant: 'warning' }); return }
      toast({ title: `${G} groups created & teams assigned.`, variant: 'success' })
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
            const groupMatches = rrMatches.filter(m => m.group_id === group.id)
            const standings    = computeStandings(group.id, group.teamIds, teamMatches)
            const isExpanded   = expandedGroup === group.id
            const allDone      = groupMatches.length > 0 && groupMatches.every(m => m.status === 'complete')

            return (
              <Card key={group.id} className={cn(allDone && 'bg-muted/20 border-border/40')}>
                <CardHeader className="py-3">
                  <button className="flex items-center justify-between w-full text-left"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.id)}>
                    <div className="flex items-center gap-2">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-semibold text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {groupTeams.map(t => t.name).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {allDone && <Check className="h-4 w-4 text-emerald-500" />}
                      <span className="text-xs text-muted-foreground">
                        {groupMatches.filter(m => m.status === 'complete').length}/{groupMatches.length}
                      </span>
                    </div>
                  </button>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="flex flex-col gap-5 pt-0">

                    {/* Standings table (ITTF columns) */}
                    {groupMatches.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Standings</p>
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground bg-muted/40 border-b border-border">
                                <th className="text-left py-1.5 px-2 font-medium w-6">#</th>
                                <th className="text-left py-1.5 px-2 font-medium">Team</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Tie wins">TW</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Tie losses">TL</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Rubber wins">RW</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Rubber losses">RL</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Game wins">GW</th>
                                <th className="text-center py-1.5 px-1 font-medium w-8" title="Game losses">GL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {standings.map((row, idx) => {
                                const t = teams.find(x => x.id === row.teamId)
                                const isAdv = idx < stage.config.advanceCount
                                return (
                                  <tr key={row.teamId}
                                    className={cn('border-b border-border/40 last:border-0', isAdv && 'bg-emerald-50/40 dark:bg-emerald-950/20')}>
                                    <td className="py-1.5 px-2 text-xs text-muted-foreground">{idx + 1}</td>
                                    <td className="py-1.5 px-2">
                                      <div className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t?.color ?? '#888' }} />
                                        <span className="font-medium truncate max-w-[120px]">{t?.name ?? '?'}</span>
                                        {isAdv && <ArrowRight className="h-3 w-3 text-emerald-500 shrink-0" />}
                                      </div>
                                    </td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs font-semibold">{row.mW}</td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs text-muted-foreground">{row.mL}</td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs">{row.rW}</td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs text-muted-foreground">{row.rL}</td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs">{row.gW}</td>
                                    <td className="py-1.5 px-1 text-center font-mono text-xs text-muted-foreground">{row.gL}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          <p className="text-[10px] text-muted-foreground px-2 py-1.5 border-t border-border/40">
                            TW/TL = Tie wins/losses · RW/RL = Rubber wins/losses · GW/GL = Game wins/losses
                            {stage.config.advanceCount > 0 && ` · ↗ Top ${stage.config.advanceCount} advance`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Fixtures with inline scoring */}
                    {groupMatches.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Fixtures</p>
                        <div className="flex flex-col gap-2">
                          {groupMatches.map(m => {
                            const isExpM     = expandedMatch === m.id
                            const isComplete = m.status === 'complete'
                            const doneCount  = m.submatches.filter(s => s.scoring?.status === 'complete').length

                            return (
                              <Card key={m.id} className={cn('overflow-hidden', matchStatusClasses(m.status))}>
                                <CardContent className="pt-3 pb-3">
                                  {/* Fixture header (clickable) */}
                                  <button className="w-full flex items-center gap-2 text-left"
                                    onClick={() => setExpandedMatch(isExpM ? null : m.id)}>
                                    <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
                                      <WinnerTrophy show={isComplete && m.winner_team_id === m.team_a_id} />
                                      <span className={cn('font-medium truncate', isComplete && m.winner_team_id !== m.team_a_id && 'text-muted-foreground')}>
                                        {m.team_a_name}
                                      </span>
                                      <span className="font-mono font-bold text-sm shrink-0">{m.team_a_score}–{m.team_b_score}</span>
                                      <WinnerTrophy show={isComplete && m.winner_team_id === m.team_b_id} />
                                      <span className={cn('font-medium truncate', isComplete && m.winner_team_id !== m.team_b_id && 'text-muted-foreground')}>
                                        {m.team_b_name}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-xs text-muted-foreground">{doneCount}/{m.submatches.length}</span>
                                      <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpM && 'rotate-180')} />
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
  const [expandedKO, setExpandedKO] = useState<string | null>(null)

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
                void firstPending // kept for future use

                return (
                  <Card key={m.id} className={cn(matchStatusClasses(m.status), 'overflow-hidden')}>
                    <CardContent className="pt-3 pb-3">
                      {/* Clickable header */}
                      <button className="w-full flex items-center gap-2 text-left"
                        onClick={() => setExpandedKO(expandedKO === m.id ? null : m.id)}>
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                          <div className={cn('flex items-center gap-2', isComplete && m.winner_team_id !== m.team_a_id && 'opacity-50')}>
                            <WinnerTrophy show={isComplete && m.winner_team_id === m.team_a_id} />
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.team_a_color }} />
                            <span className="text-sm font-semibold flex-1 truncate">{m.team_a_name || 'TBD'}</span>
                            <span className="text-sm font-bold font-mono">{m.team_a_score}</span>
                          </div>
                          <div className={cn('flex items-center gap-2', isComplete && m.winner_team_id !== m.team_b_id && 'opacity-50')}>
                            <WinnerTrophy show={isComplete && m.winner_team_id === m.team_b_id} />
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.team_b_color }} />
                            <span className="text-sm font-semibold flex-1 truncate">{m.team_b_name || 'TBD'}</span>
                            <span className="text-sm font-bold font-mono">{m.team_b_score}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {isLive && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600">LIVE</span>}
                          <span className="text-xs text-muted-foreground">{doneCount}/{m.submatches.length}</span>
                          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expandedKO === m.id && 'rotate-180')} />
                        </div>
                      </button>
                      {/* Inline rubber scoring */}
                      {expandedKO === m.id && (
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
