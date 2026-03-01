/**
 * Shared data shapes for the refactored homepage sections.
 * All derived server-side from Supabase queries in page.tsx.
 */

// Live match card displayed in the "Live Now" horizontal strip
export interface LiveMatchRow {
  matchId:     string
  eventId:     string
  eventName:   string
  champId:     string | null
  champName:   string | null
  roundName:   string | null
  matchNumber: number | null
  p1Name:      string | null
  p2Name:      string | null
  p1Games:     number
  p2Games:     number
  p1Leading:   boolean
  p2Leading:   boolean
}

// Championship card with aggregated event/match stats
export interface OngoingChampRow {
  id:           string
  name:         string
  location:     string | null
  startDate:    string | null
  endDate:      string | null
  published:    boolean
  eventCount:   number
  liveCount:    number   // events that have at least one live match
  doneCount:    number   // completed events
  totalMatches: number
  doneMatches:  number
}

// Active event card (setup or active status)
export interface ActiveEventRow {
  id:           string
  name:         string
  champId:      string | null
  champName:    string | null
  formatType:   string | null   // 'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout'
  status:       string
  stageLabel:   string          // human-readable current stage
  progress:     number          // 0–100
  totalMatches: number
  doneMatches:  number
  liveCount:    number
}

// Compact recently-completed result row
export interface RecentResultRow {
  id:          string
  name:        string
  champId:     string | null
  champName:   string | null
  winner:      string | null
  runnerUp:    string | null
  updatedAt:   string | null
  formatType:  string | null
}
