'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Users, ClipboardList, Award, Check, Pencil, X, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Player, Tournament } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea, Badge, Card, CardContent, CardHeader, CardTitle,
         Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/index'
import { addPlayer, bulkAddPlayers, deletePlayer, updatePlayerSeed, updatePlayer } from '@/lib/actions/players'
import { toast } from '@/components/ui/toaster'
import { ExcelUpload, groupLabel } from '@/components/admin/ExcelUpload'

interface PlayerManagerProps {
  tournament: Tournament
  players:    Player[]
}

const SEEDS = Array.from({ length: 64 }, (_, i) => i + 1)

export function PlayerManager({ tournament, players }: PlayerManagerProps) {
  const [mode, setMode]       = useState<'single' | 'bulk' | 'excel'>('single')
  const [name, setName]       = useState('')
  const [club, setClub]       = useState('')
  const [seed, setSeed]       = useState<string>('')
  const [bulkText, setBulkText] = useState('')
  const [nameError, setNameError] = useState('')
  const [isPending, startTransition] = useTransition()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editClub,  setEditClub]  = useState('')

  const isLocked = tournament.bracket_generated

  // ── Add single ──────────────────────────────────────────────────────────────
  const handleAddSingle = () => {
    const trimmed = name.trim()
    if (!trimmed) { setNameError('Player name cannot be empty'); return }
    if (trimmed.length < 2) { setNameError('Name must be at least 2 characters'); return }
    setNameError('')

    const fd = new FormData()
    fd.set('name', trimmed)
    fd.set('club', club.trim())
    if (seed && seed !== 'none') fd.set('seed', seed)

    startTransition(async () => {
      const result = await addPlayer(tournament.id, fd)
      if (result.error) {
        toast({ title: 'Could not add player', description: result.error, variant: 'destructive' })
      } else {
        setName(''); setClub(''); setSeed(''); setNameError('')
        toast({ title: 'Player added', description: trimmed })
      }
    })
  }

  // ── Bulk add ────────────────────────────────────────────────────────────────
  const handleBulkAdd = () => {
    if (!bulkText.trim()) return
    startTransition(async () => {
      const result = await bulkAddPlayers(tournament.id, bulkText)
      if (result.error) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      } else {
        setBulkText('')
        toast({ title: `${result.count} player${result.count !== 1 ? 's' : ''} added` })
      }
    })
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = (p: Player) => {
    startTransition(async () => {
      const result = await deletePlayer(tournament.id, p.id)
      if (result.error) {
        toast({ title: 'Delete failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Player removed', description: p.name })
      }
    })
  }

  // ── Seed change ─────────────────────────────────────────────────────────────
  const handleSeedChange = (playerId: string, newSeed: string) => {
    const s = (newSeed === 'none' || newSeed === '') ? null : parseInt(newSeed, 10)
    startTransition(async () => {
      const result = await updatePlayerSeed(tournament.id, playerId, s)
      if (result.error) toast({ title: 'Seed error', description: result.error, variant: 'destructive' })
    })
  }

  const startEdit = (p: Player) => { setEditingId(p.id); setEditName(p.name); setEditClub(p.club ?? '') }
  const cancelEdit = () => { setEditingId(null); setEditName(''); setEditClub('') }

  const saveEdit = (playerId: string) => {
    if (!editName.trim()) return
    startTransition(async () => {
      const result = await updatePlayer(tournament.id, playerId, {
        name: editName.trim(),
        club: editClub.trim() || null,
      })
      if (result.error) {
        toast({ title: 'Update error', description: result.error, variant: 'destructive' })
      } else {
        setEditingId(null)
        toast({ title: 'Player updated' })
      }
    })
  }

  const usedSeeds = new Set(players.filter(p => p.seed).map(p => p.seed))
  const sorted = players.slice().sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed
    if (a.seed) return -1
    if (b.seed) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex flex-col gap-4">

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Players" value={players.length} max={256} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Seeded"  value={players.filter(p => p.seed).length} max={64}  icon={<Award className="h-4 w-4 text-amber-400" />} />
        <StatCard label="Bracket" value={tournament.bracket_generated ? 'Ready' : 'Pending'} icon={<ClipboardList className="h-4 w-4 text-orange-600" />} />
      </div>

      {/* Add players */}
      {!isLocked && (
        <Card>
          <CardHeader><CardTitle>Add Players</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Mode toggle */}
            <div className="flex rounded-md overflow-hidden border border-border w-fit">
              {(['single', 'bulk', 'excel'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn('px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1',
                    mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {m === 'excel' && <FileSpreadsheet className="h-3.5 w-3.5" />}
                  {m === 'single' ? 'One by one' : m === 'bulk' ? 'Paste list' : 'Excel / CSV'}
                </button>
              ))}
            </div>

            {mode === 'single' ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pname">Player name *</Label>
                    <Input id="pname" placeholder="e.g. Alice Tran"
                      value={name}
                      onChange={e => { setName(e.target.value); setNameError('') }}
                      onKeyDown={e => e.key === 'Enter' && handleAddSingle()}
                      className={nameError ? 'border-red-400 focus-visible:ring-red-400' : ''}
                    />
                    {nameError && <p className="text-xs text-red-500">{nameError}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pclub">Club (optional)</Label>
                    <Input id="pclub" placeholder="e.g. City TTC" value={club}
                      onChange={e => setClub(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddSingle()}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 w-44">
                  <Label>Seed (1–64, optional)</Label>
                  <Select value={seed || 'none'} onValueChange={v => setSeed(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="No seed" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No seed</SelectItem>
                      {SEEDS.filter(s => !usedSeeds.has(s)).map(s => (
                        <SelectItem key={s} value={String(s)}>Seed {s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleAddSingle} disabled={isPending || !name.trim()} variant="cyan" size="sm" className="w-fit">
                  <Plus className="h-4 w-4" /> Add Player
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    One player per line · Format:{' '}
                    <code className="font-mono text-orange-600 text-xs bg-muted/60 px-1 rounded">Name | Club | Seed</code>
                    <span className="ml-2 text-muted-foreground text-xs">(club and seed optional)</span>
                  </Label>
                  <Textarea
                    placeholder={'Alice Tran|City TTC|1\nBruno Melo|Westside TTC|2\nChen Wei||3\nDiana Park\nEvan Ng|North Club'}
                    value={bulkText}
                    onChange={e => setBulkText(e.target.value)}
                    rows={8}
                    className="font-mono text-sm"
                  />
                  {bulkText.trim() && (
                    <p className="text-xs text-muted-foreground">
                      {bulkText.split('\n').filter(l => l.trim()).length} players to add
                    </p>
                  )}
                </div>
                <Button onClick={handleBulkAdd} disabled={isPending || !bulkText.trim()} variant="cyan" size="sm" className="w-fit">
                  <Plus className="h-4 w-4" /> Add All Players
                </Button>
              </div>
            ) : mode === 'excel' ? (
              <ExcelUpload
                tournamentId={tournament.id}
                existingPlayers={players}
                onComplete={() => setMode('single')}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Player list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Player List</span>
            <Badge variant={players.length > 0 ? 'success' : 'secondary'}>{players.length} / 256</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {players.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No players yet. Add players above.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Column header — desktop only */}
              <div className="hidden sm:grid sm:grid-cols-[24px_1fr_48px_100px_64px] gap-2 px-2 pb-2 text-xs font-semibold uppercase tracking-wider border-b border-border text-muted-foreground">
                <span>#</span><span>Name / Club</span><span>Grp</span><span>Seed</span><span />
              </div>

              {sorted.map((player, idx) => {
                const isEditing = editingId === player.id
                return (
                  <div key={player.id}
                    className={cn(
                      'rounded-lg px-3 py-2.5 transition-colors',
                      // Mobile: block card. Desktop: grid row
                      'sm:grid sm:grid-cols-[24px_1fr_48px_100px_64px] sm:items-center sm:gap-2 sm:px-2',
                      isEditing ? 'bg-muted/50 ring-1 ring-orange-500/30' : 'hover:bg-muted/20',
                    )}>

                    {/* Row number — desktop only */}
                    <span className="hidden sm:block text-xs tabular-nums text-right text-muted-foreground/60">{idx + 1}</span>

                    {/* Name / club */}
                    {isEditing ? (
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <Input value={editName} onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveEdit(player.id)}
                          placeholder="Player name" className="h-7 text-sm" autoFocus />
                        <Input value={editClub} onChange={e => setEditClub(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveEdit(player.id)}
                          placeholder="Club (optional)" className="h-7 text-xs" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        {/* Left: number(mobile) + seed + name/club */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Row number — mobile only */}
                          <span className="sm:hidden text-xs text-muted-foreground/50 tabular-nums w-5 shrink-0">{idx + 1}.</span>
                          {player.seed && (
                            <span className="seed-badge shrink-0 text-[10px] h-5 w-5">{player.seed}</span>
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-sm truncate text-foreground dark:text-white">{player.name}</span>
                            {player.club && (
                              <span className="text-xs truncate text-muted-foreground">{player.club}</span>
                            )}
                          </div>
                        </div>

                        {/* Right side on mobile: actions */}
                        {!isLocked && (
                          <div className="flex gap-1 shrink-0 sm:hidden">
                            <button onClick={() => startEdit(player)} disabled={isPending}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDelete(player)} disabled={isPending}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors" title="Remove">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Preferred group — desktop only */}
                    <div className="hidden sm:flex sm:justify-center">
                      {player.preferred_group != null ? (
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 text-[10px] font-bold" title={`Preferred Group ${groupLabel(player.preferred_group)}`}>
                          {groupLabel(player.preferred_group)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>

                    {/* Seed selector — desktop only */}
                    <div className="hidden sm:block">
                      {!isLocked ? (
                        <Select value={player.seed ? String(player.seed) : 'none'}
                          onValueChange={v => handleSeedChange(player.id, v)}
                          disabled={isEditing || isPending}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unseeded</SelectItem>
                            {SEEDS.filter(s => !usedSeeds.has(s) || s === player.seed).map(s => (
                              <SelectItem key={s} value={String(s)}>Seed {s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        player.seed
                          ? <span className="seed-badge">{player.seed}</span>
                          : <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </div>

                    {/* Actions — desktop only */}
                    <div className="hidden sm:flex gap-1 justify-end shrink-0">
                      {!isLocked && (
                        isEditing ? (
                          <>
                            <button onClick={() => saveEdit(player.id)} disabled={isPending || !editName.trim()}
                              className="p-1.5 rounded text-orange-600 hover:text-orange-500 disabled:opacity-40 transition-colors" title="Save">
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={cancelEdit}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(player)} disabled={isPending}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDelete(player)} disabled={isPending}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors" title="Remove">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )
                      )}
                    </div>

                    {/* Edit confirm/cancel — mobile, shown inline when editing */}
                    {isEditing && (
                      <div className="flex gap-2 mt-2 sm:hidden">
                        <button onClick={() => saveEdit(player.id)} disabled={isPending || !editName.trim()}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold disabled:opacity-40">
                          <Check className="h-3.5 w-3.5" /> Save
                        </button>
                        <button onClick={cancelEdit}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-border text-xs font-semibold">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, max, icon }: {
  label: string; value: string | number; max?: number; icon: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/40 border border-border p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display text-xl sm:text-2xl font-bold text-foreground dark:text-white">
        {value}
        {max && typeof value === 'number' && (
          <span className="text-xs sm:text-sm font-normal ml-1 text-muted-foreground">/ {max}</span>
        )}
      </div>
    </div>
  )
}
