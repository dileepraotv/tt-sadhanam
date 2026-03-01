'use client'

/**
 * ExcelUpload
 *
 * Accepts .xlsx / .xls / .csv files.
 * Expected columns (first row = headers, case-insensitive, flexible names):
 *   Name         — required
 *   Country/Club — optional  (also: Club, Country, Club/Country)
 *   Seeding      — optional  (also: Seed, Rank)
 *   Group        — optional  (A–Z or 1–26; used for preferred_group)
 *
 * Shows a preview table with per-row validation, then calls
 * bulkAddPlayersFromSheet on confirm.
 */

import { useState, useRef, useTransition } from 'react'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/index'
import { bulkAddPlayersFromSheet } from '@/lib/actions/players'
import { toast } from '@/components/ui/toaster'
import type { Player } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  rowIndex:       number    // 1-based (excludes header)
  name:           string
  club:           string | null
  seed:           number | null
  preferredGroup: number | null   // 1=A, 2=B, …
  // validation
  nameError?:     string
  seedError?:     string
  groupError?:    string
  isDuplicate?:   boolean
}

interface Props {
  tournamentId:  string
  existingPlayers: Player[]
  onComplete:    () => void   // called after successful import
}

// ── Column header aliases ──────────────────────────────────────────────────────

const NAME_COLS  = ['name', 'player', 'player name', 'playername', 'full name', 'fullname']
const CLUB_COLS  = ['club', 'country', 'country/club', 'club/country', 'country / club', 'club / country', 'association', 'team']
const SEED_COLS  = ['seed', 'seeding', 'rank', 'ranking', 'seeded']
const GROUP_COLS = ['group', 'group name', 'groupname', 'preferred group']

function detectColumns(headers: string[]): {
  nameIdx: number; clubIdx: number; seedIdx: number; groupIdx: number
} {
  const norm = headers.map(h => h.trim().toLowerCase())
  return {
    nameIdx:  norm.findIndex(h => NAME_COLS.includes(h)),
    clubIdx:  norm.findIndex(h => CLUB_COLS.includes(h)),
    seedIdx:  norm.findIndex(h => SEED_COLS.includes(h)),
    groupIdx: norm.findIndex(h => GROUP_COLS.includes(h)),
  }
}

/** Convert group string like "A", "B", "Group A", "1", "2" → 1-based number or null */
function parseGroup(raw: string | null | undefined): { value: number | null; error?: string } {
  if (!raw) return { value: null }
  const s = String(raw).trim().toUpperCase().replace(/^GROUP\s*/i, '')
  // Letter: A→1, B→2, …
  if (/^[A-Z]$/.test(s)) return { value: s.charCodeAt(0) - 64 }
  // Number
  const n = parseInt(s, 10)
  if (!isNaN(n) && n >= 1 && n <= 26) return { value: n }
  return { value: null, error: `Invalid group "${raw}" (use A–Z or 1–26)` }
}

/** Convert group number back to letter label for display */
export function groupLabel(n: number | null): string {
  if (!n) return '—'
  return String.fromCharCode(64 + n)  // 1→A, 2→B, …
}

// ── Pure CSV parser (handles quoted fields) ────────────────────────────────────

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
      else { field += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else { field += c }
    }
  }
  row.push(field)
  if (row.some(f => f)) rows.push(row)
  return rows
}

// ── Parser: raw sheet data → ParsedRow[] ──────────────────────────────────────

function parseSheetData(rawRows: string[][], existingNames: Set<string>): {
  parsed: ParsedRow[]
  headerError?: string
} {
  if (!rawRows.length) return { parsed: [], headerError: 'File is empty' }

  const headers = rawRows[0]
  const { nameIdx, clubIdx, seedIdx, groupIdx } = detectColumns(headers)

  if (nameIdx === -1) {
    return {
      parsed:      [],
      headerError: `Could not find a "Name" column. Found: ${headers.map(h => `"${h}"`).join(', ')}`,
    }
  }

  const dataRows = rawRows.slice(1).filter(r => r.some(c => c?.trim()))
  const seenNames = new Set<string>()
  const seenSeeds = new Set<number>()

  const parsed: ParsedRow[] = dataRows.map((row, i) => {
    const get = (idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '')

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

    // Seed
    let seed: number | null = null
    let seedError: string | undefined
    if (rawSeed) {
      const n = parseInt(rawSeed, 10)
      if (isNaN(n)) {
        seedError = `"${rawSeed}" is not a number`
      } else if (n < 1 || n > 64) {
        seedError = 'Seed must be 1–64'
      } else if (seenSeeds.has(n)) {
        seedError = `Seed ${n} duplicated`
      } else {
        seed = n
        seenSeeds.add(n)
      }
    }

    // Group
    const { value: preferredGroup, error: groupError } = parseGroup(rawGroup || null)

    return {
      rowIndex:       i + 2,    // 1-based including header
      name:           rawName,
      club:           rawClub || null,
      seed,
      preferredGroup,
      nameError,
      seedError,
      groupError,
      isDuplicate:    !!nameError,
    }
  })

  return { parsed }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ExcelUpload({ tournamentId, existingPlayers, onComplete }: Props) {
  const [parsed,       setParsed]       = useState<ParsedRow[] | null>(null)
  const [headerError,  setHeaderError]  = useState<string | null>(null)
  const [fileName,     setFileName]     = useState<string>('')
  const [isParsing,    setIsParsing]    = useState(false)
  const [showErrors,   setShowErrors]   = useState(false)
  const [isPending,    startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const existingNames = new Set(existingPlayers.map(p => p.name.toLowerCase()))

  // ── File → raw rows ──────────────────────────────────────────────────────

  const processFile = async (file: File) => {
    setIsParsing(true)
    setParsed(null)
    setHeaderError(null)
    setFileName(file.name)

    try {
      const isCSV = file.name.toLowerCase().endsWith('.csv')

      let rawRows: string[][]
      if (isCSV) {
        const text = await file.text()
        rawRows = parseCSV(text)
      } else {
        // xlsx / xls — dynamic import so it doesn't bloat the initial bundle
        const XLSX = (await import('xlsx')).default
        const buf  = await file.arrayBuffer()
        const wb   = XLSX.read(buf, { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        rawRows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
      }

      const { parsed: rows, headerError: hErr } = parseSheetData(rawRows, existingNames)
      if (hErr) { setHeaderError(hErr); setIsParsing(false); return }
      setParsed(rows)
    } catch (e) {
      setHeaderError(`Could not read file: ${(e as Error).message}`)
    } finally {
      setIsParsing(false)
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
    e.target.value = ''
  }

  // ── Import ────────────────────────────────────────────────────────────────

  const validRows = parsed?.filter(r => !r.nameError && !r.seedError && !r.groupError) ?? []
  const errorRows = parsed?.filter(r => r.nameError || r.seedError || r.groupError) ?? []
  const hasGroup  = validRows.some(r => r.preferredGroup != null)

  const handleImport = () => {
    if (!validRows.length) return
    startTransition(async () => {
      const result = await bulkAddPlayersFromSheet(tournamentId, validRows.map(r => ({
        name:           r.name,
        club:           r.club,
        seed:           r.seed,
        preferredGroup: r.preferredGroup,
      })))
      if (result.error) {
        toast({ title: 'Import failed', description: result.error, variant: 'destructive' })
      } else {
        toast({
          title:       `✓ ${result.count} player${result.count !== 1 ? 's' : ''} imported`,
          description: errorRows.length ? `${errorRows.length} row${errorRows.length > 1 ? 's' : ''} skipped due to errors` : undefined,
        })
        setParsed(null); setFileName(''); onComplete()
      }
    })
  }

  const handleClear = () => {
    setParsed(null); setHeaderError(null); setFileName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!parsed && !headerError) {
    return (
      <div className="flex flex-col gap-4">
        {/* Format hint */}
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-medium mb-1">Expected columns (row 1 = headers)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
            {[
              { col: 'Name', note: 'Required' },
              { col: 'Country/Club', note: 'Optional' },
              { col: 'Seeding', note: 'Optional, 1–64' },
              { col: 'Group', note: 'Optional, A–Z' },
            ].map(({ col, note }) => (
              <div key={col} className="flex flex-col gap-0.5">
                <code className="font-mono text-foreground bg-muted px-1 rounded text-[11px]">{col}</code>
                <span>{note}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, and <strong>.csv</strong> files.
            Header names are case-insensitive and flexible (e.g. "Club", "Club/Country" all work).
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10',
            'cursor-pointer transition-colors select-none',
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
            <p className="font-medium text-sm">
              {isParsing ? 'Reading file…' : 'Drop spreadsheet here'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isParsing ? 'Please wait' : 'or click to browse  ·  .xlsx · .xls · .csv'}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={handleFileChange}
            className="hidden"
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
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{headerError}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClear} className="w-fit">
          Try a different file
        </Button>
      </div>
    )
  }

  // ── Preview state ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={validRows.length > 0 ? 'success' : 'secondary'}>
            {validRows.length} valid
          </Badge>
          {errorRows.length > 0 && (
            <Badge variant="destructive">{errorRows.length} errors</Badge>
          )}
          {hasGroup && (
            <Badge variant="outline" className="text-orange-600 border-orange-300">
              Group column detected
            </Badge>
          )}
          <button onClick={handleClear} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Clear">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error rows toggle */}
      {errorRows.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <button
            onClick={() => setShowErrors(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {errorRows.length} row{errorRows.length > 1 ? 's' : ''} will be skipped (errors)
            </span>
            {showErrors ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showErrors && (
            <div className="border-t border-amber-200 dark:border-amber-800 px-4 py-2 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {errorRows.map(r => (
                <div key={r.rowIndex} className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded mr-1.5">Row {r.rowIndex}</span>
                  {r.name || '(empty)'}
                  {r.nameError && ` — ${r.nameError}`}
                  {r.seedError && ` — Seed: ${r.seedError}`}
                  {r.groupError && ` — Group: ${r.groupError}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {validRows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Country/Club</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground w-16">Seed</th>
                  {hasGroup && (
                    <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground w-16">Group</th>
                  )}
                  <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground w-8">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {validRows.map((r, i) => (
                  <tr key={r.rowIndex} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">{r.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-xs">{r.club ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center">
                      {r.seed != null
                        ? <span className="seed-badge text-[10px] h-5 w-5 inline-flex items-center justify-center">{r.seed}</span>
                        : <span className="text-xs text-muted-foreground/60">—</span>}
                    </td>
                    {hasGroup && (
                      <td className="px-3 py-1.5 text-center">
                        {r.preferredGroup != null
                          ? <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 text-[10px] font-bold">{groupLabel(r.preferredGroup)}</span>
                          : <span className="text-xs text-muted-foreground/60">—</span>}
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

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleImport}
          disabled={isPending || validRows.length === 0}
          variant="cyan"
          size="sm"
        >
          <Upload className="h-4 w-4" />
          {isPending
            ? 'Importing…'
            : `Import ${validRows.length} Player${validRows.length !== 1 ? 's' : ''}`}
        </Button>
        <Button variant="outline" size="sm" onClick={handleClear} disabled={isPending}>
          Cancel
        </Button>
        {hasGroup && (
          <p className="text-xs text-muted-foreground ml-auto">
            Group assignments will be used when generating Stage 1 groups
          </p>
        )}
      </div>
    </div>
  )
}
