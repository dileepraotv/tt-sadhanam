'use client'

import { useState, useRef, useTransition } from 'react'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/index'
import { bulkAddPlayersFromSheet } from '@/lib/actions/players'
import { toast } from '@/components/ui/toaster'
import type { Player } from '@/lib/types'

interface ParsedRow {
  rowIndex:       number
  name:           string
  club:           string | null
  seed:           number | null
  preferredGroup: number | null
  nameError?:     string
  seedError?:     string
  groupError?:    string
}

interface Props {
  tournamentId:    string
  existingPlayers: Player[]
  onComplete:      () => void
}

const NAME_COLS  = ['name', 'player', 'player name', 'playername', 'full name', 'fullname']
const CLUB_COLS  = ['club', 'country', 'country/club', 'club/country', 'country / club', 'club / country', 'association', 'team']
const SEED_COLS  = ['seed', 'seeding', 'rank', 'ranking', 'seeded']
const GROUP_COLS = ['group', 'group name', 'groupname', 'preferred group', 'group no', 'group number']

function detectColumns(headers: string[]) {
  const norm = headers.map(h => String(h ?? '').trim().toLowerCase())
  return {
    nameIdx:  norm.findIndex(h => NAME_COLS.includes(h)),
    clubIdx:  norm.findIndex(h => CLUB_COLS.includes(h)),
    seedIdx:  norm.findIndex(h => SEED_COLS.includes(h)),
    groupIdx: norm.findIndex(h => GROUP_COLS.includes(h)),
  }
}

function parseGroup(raw: string | null | undefined): { value: number | null; error?: string } {
  if (!raw) return { value: null }
  const s = String(raw).trim().replace(/^Group\s*/i, '')
  const n = parseInt(s, 10)
  if (!isNaN(n) && Number.isInteger(n) && n >= 1) return { value: n }
  return { value: null, error: `Invalid group "${raw}" — use a number like 1, 2, 3` }
}

export function groupLabel(n: number | null | undefined): string {
  return n != null ? String(n) : '—'
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else field += c
    } else {
      if      (c === '"')  inQuote = true
      else if (c === ',')  { row.push(field); field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  row.push(field)
  if (row.some(f => f)) rows.push(row)
  return rows
}

// ── SheetJS CDN loader ────────────────────────────────────────────────────────
// Load SheetJS from CDN via a script tag (avoids SSR/bundler issues with xlsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let xlsxCache: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadXLSX(): Promise<any> {
  if (xlsxCache) return xlsxCache
  // Already loaded by a previous call
  if (typeof window !== 'undefined' && (window as any).XLSX) {
    xlsxCache = (window as any).XLSX
    return xlsxCache
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('sheetjs-cdn')
    if (existing) {
      // Script already injected — wait for it
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('SheetJS CDN load failed')))
      return
    }
    const s = document.createElement('script')
    s.id  = 'sheetjs-cdn'
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload  = () => resolve()
    s.onerror = () => reject(new Error('Could not load SheetJS from CDN — check your internet connection'))
    document.head.appendChild(s)
  })
  xlsxCache = (window as any).XLSX
  return xlsxCache
}

// ── Sheet parser ──────────────────────────────────────────────────────────────

function parseSheetData(rawRows: string[][], existingNames: Set<string>) {
  if (!rawRows.length) return { parsed: [] as ParsedRow[], headerError: 'File is empty' }

  const headers = rawRows[0].map(h => String(h ?? ''))
  const { nameIdx, clubIdx, seedIdx, groupIdx } = detectColumns(headers)

  if (nameIdx === -1) {
    return {
      parsed: [] as ParsedRow[],
      headerError: `No "Name" column found. Headers: ${headers.map(h => `"${h}"`).join(', ')}`,
    }
  }

  const dataRows  = rawRows.slice(1).filter(r => r.some(c => String(c ?? '').trim()))
  const seenNames = new Set<string>()
  const seenSeeds = new Set<number>()

  const parsed: ParsedRow[] = dataRows.map((row, i) => {
    const get      = (idx: number) => idx >= 0 ? String(row[idx] ?? '').trim() : ''
    const rawName  = get(nameIdx)
    const rawClub  = get(clubIdx)
    const rawSeed  = get(seedIdx)
    const rawGroup = get(groupIdx)

    const nameLower = rawName.toLowerCase()
    let nameError: string | undefined
    if (!rawName) {
      nameError = 'Name is required'
    } else if (existingNames.has(nameLower) || seenNames.has(nameLower)) {
      nameError = 'Duplicate name'
    } else {
      seenNames.add(nameLower)
    }

    let seed: number | null = null
    let seedError: string | undefined
    if (rawSeed) {
      const n = parseInt(rawSeed, 10)
      if (isNaN(n) || n < 1 || !Number.isInteger(n)) seedError = `"${rawSeed}" must be a positive integer`
      else if (seenSeeds.has(n)) seedError = `Seed ${n} used more than once`
      else { seed = n; seenSeeds.add(n) }
    }

    const { value: preferredGroup, error: groupError } = parseGroup(rawGroup || null)
    return { rowIndex: i + 2, name: rawName, club: rawClub || null, seed, preferredGroup, nameError, seedError, groupError }
  })

  return { parsed, headerError: undefined as string | undefined }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExcelUpload({ tournamentId, existingPlayers, onComplete }: Props) {
  const [parsed,       setParsed]       = useState<ParsedRow[] | null>(null)
  const [headerError,  setHeaderError]  = useState<string | null>(null)
  const [fileName,     setFileName]     = useState<string>('')
  const [isParsing,    setIsParsing]    = useState(false)
  const [showErrors,   setShowErrors]   = useState(false)
  const [isPending,    startTransition] = useTransition()
  const [dragging,     setDragging]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const existingNames = new Set(existingPlayers.map(p => p.name.toLowerCase()))

  const processFile = async (file: File) => {
    setIsParsing(true); setParsed(null); setHeaderError(null); setFileName(file.name)
    try {
      let rawRows: string[][]
      if (file.name.toLowerCase().endsWith('.csv')) {
        rawRows = parseCSV(await file.text())
      } else {
        const XLSX = await loadXLSX()
        const wb   = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        rawRows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
      }
      const { parsed: rows, headerError: hErr } = parseSheetData(rawRows, existingNames)
      if (hErr) { setHeaderError(hErr); return }
      setParsed(rows)
    } catch (e) {
      setHeaderError(`Could not read file: ${(e as Error).message}`)
    } finally {
      setIsParsing(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) processFile(f)
  }
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''
  }

  const validRows = parsed?.filter(r => !r.nameError && !r.seedError && !r.groupError) ?? []
  const errorRows = parsed?.filter(r =>  r.nameError ||  r.seedError ||  r.groupError) ?? []
  const hasGroup  = validRows.some(r => r.preferredGroup != null)

  const handleImport = () => {
    if (!validRows.length) return
    startTransition(async () => {
      const result = await bulkAddPlayersFromSheet(
        tournamentId,
        validRows.map(r => ({ name: r.name, club: r.club, seed: r.seed, preferredGroup: r.preferredGroup })),
      )
      if (result.error) {
        toast({ title: 'Import failed', description: result.error, variant: 'destructive' })
      } else {
        toast({
          title: `✓ ${result.count} player${result.count !== 1 ? 's' : ''} imported`,
          description: errorRows.length ? `${errorRows.length} row${errorRows.length > 1 ? 's' : ''} skipped` : undefined,
        })
        setParsed(null); setFileName(''); onComplete()
      }
    })
  }

  const handleClear = () => {
    setParsed(null); setHeaderError(null); setFileName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Drop zone (initial) ───────────────────────────────────────────────────

  if (!parsed && !headerError) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-medium mb-2">Expected columns (row 1 = headers)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
            {[
              { col: 'Name',         note: 'Required' },
              { col: 'Country/Club', note: 'Optional' },
              { col: 'Seeding',      note: 'Optional integer' },
              { col: 'Group',        note: 'Optional: 1, 2, 3…' },
            ].map(({ col, note }) => (
              <div key={col} className="flex flex-col gap-0.5">
                <code className="font-mono text-foreground bg-muted px-1 rounded text-[11px]">{col}</code>
                <span>{note}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, and <strong>.csv</strong>.
            Headers are case-insensitive — &quot;Club&quot;, &quot;Country/Club&quot; etc. all work.
          </p>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10',
            'cursor-pointer transition-colors select-none touch-manipulation',
            dragging
              ? 'border-orange-400 bg-orange-50/40 dark:bg-orange-950/20'
              : 'border-border hover:border-orange-300 hover:bg-muted/30',
          )}
        >
          <div className="rounded-full bg-orange-100 dark:bg-orange-950/40 p-3">
            {isParsing
              ? <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              : <FileSpreadsheet className="h-6 w-6 text-orange-500" />}
          </div>
          <div className="text-center">
            <p className="font-medium text-sm">{isParsing ? 'Reading file…' : 'Drop spreadsheet here'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isParsing ? 'Please wait' : 'or tap to browse  ·  .xlsx  ·  .xls  ·  .csv'}
            </p>
          </div>
          <input
            ref={inputRef} type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={handleFileChange} className="hidden"
          />
        </div>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (headerError) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-800 dark:text-red-300 text-sm">Could not parse file</p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5 break-words">{headerError}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClear} className="w-fit">Try a different file</Button>
      </div>
    )
  }

  // ── Preview state ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Badge variant={validRows.length > 0 ? 'success' : 'secondary'}>{validRows.length} valid</Badge>
          {errorRows.length > 0 && <Badge variant="destructive">{errorRows.length} errors</Badge>}
          {hasGroup && <Badge variant="outline" className="text-orange-600 border-orange-300">Groups detected</Badge>}
          <button onClick={handleClear} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Clear">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {errorRows.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <button
            onClick={() => setShowErrors(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {errorRows.length} row{errorRows.length > 1 ? 's' : ''} will be skipped
            </span>
            {showErrors ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showErrors && (
            <div className="border-t border-amber-200 dark:border-amber-800 px-4 py-2 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {errorRows.map(r => (
                <div key={r.rowIndex} className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded mr-1.5">Row {r.rowIndex}</span>
                  {r.name || '(empty)'}
                  {r.nameError  && ` — ${r.nameError}`}
                  {r.seedError  && ` — Seed: ${r.seedError}`}
                  {r.groupError && ` — Group: ${r.groupError}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {validRows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Country/Club</th>
                  <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground w-14">Seed</th>
                  {hasGroup && (
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground w-14">Grp</th>
                  )}
                  <th className="text-center px-2 py-2 w-7">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {validRows.map((r, i) => (
                  <tr key={r.rowIndex} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-sm leading-tight">{r.name}</div>
                      {r.club && <div className="text-xs text-muted-foreground sm:hidden">{r.club}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground text-xs hidden sm:table-cell">{r.club ?? '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      {r.seed != null
                        ? <span className="seed-badge text-[10px] h-5 min-w-[20px] px-1 inline-flex items-center justify-center">{r.seed}</span>
                        : <span className="text-xs text-muted-foreground/50">—</span>}
                    </td>
                    {hasGroup && (
                      <td className="px-2 py-1.5 text-center">
                        {r.preferredGroup != null
                          ? <span className="inline-flex items-center justify-center h-5 min-w-[22px] px-1 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 text-[10px] font-bold">{r.preferredGroup}</span>
                          : <span className="text-xs text-muted-foreground/50">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-center">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {validRows.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground">
          No valid rows to import. Fix the errors above and re-upload.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleImport} disabled={isPending || validRows.length === 0} variant="cyan" size="sm" className="min-w-[140px]">
          <Upload className="h-4 w-4" />
          {isPending ? 'Importing…' : `Import ${validRows.length} Player${validRows.length !== 1 ? 's' : ''}`}
        </Button>
        <Button variant="outline" size="sm" onClick={handleClear} disabled={isPending}>Cancel</Button>
        {hasGroup && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            Group assignments used when generating Stage 1 groups
          </p>
        )}
      </div>
    </div>
  )
}
