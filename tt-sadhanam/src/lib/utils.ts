import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MatchFormat } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

export function formatFormatLabel(format: MatchFormat): string {
  const labels = { bo3: 'Best of 3', bo5: 'Best of 5', bo7: 'Best of 7' }
  return labels[format]
}

export function nextPowerOf2(n: number): number {
  if (n <= 0) return 2
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function getRoundName(roundNumber: number, totalRounds: number): string {
  const fromFinal = totalRounds - roundNumber
  if (fromFinal === 0) return 'Final'
  if (fromFinal === 1) return 'Semifinal'
  if (fromFinal === 2) return 'Quarterfinal'
  const roundOf = Math.pow(2, fromFinal + 1)
  return `R${roundOf}`
}

export function totalRoundsForSize(bracketSize: number): number {
  return Math.log2(bracketSize)
}

/** Full round tab labels — no abbreviations */
export function getRoundTab(roundNumber: number, totalRounds: number): string {
  const fromFinal = totalRounds - roundNumber
  if (fromFinal === 0) return 'Final'
  if (fromFinal === 1) return 'Semi Finals'
  if (fromFinal === 2) return 'Quarter Finals'
  const roundOf = Math.pow(2, fromFinal + 1)
  return `Round ${roundOf}`
}

export function getSeedLabel(seed: number | null): string {
  if (!seed) return ''
  return `[${seed}]`
}

export function isByeOrEmpty(playerId: string | null, isBye?: boolean): boolean {
  return !playerId || !!isBye
}
