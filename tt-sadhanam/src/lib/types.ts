// ─── Database row types (mirror Supabase schema) ──────────────────────────────

export type TournamentStatus = 'setup' | 'active' | 'complete'
export type MatchStatus      = 'pending' | 'live' | 'complete' | 'bye'
export type MatchFormat      = 'bo3' | 'bo5' | 'bo7'

// ── Championship (top-level event container) ──────────────────────────────────
export interface Championship {
  id:            string
  name:          string
  description:   string | null
  location:      string | null
  year:          number | null
  start_date:    string | null
  end_date:      string | null
  published:     boolean
  created_by:    string
  created_at:    string
  updated_at:    string
  // joined
  event_count?:  number
  events?:       Tournament[]
}

// ── Tournament / Event (draw within a championship) ────────────────────────────
export interface Tournament {
  id:                  string
  name:                string
  description:         string | null
  location:            string | null
  date:                string | null    // ISO date string
  format:              MatchFormat
  status:              TournamentStatus
  published:           boolean
  bracket_generated:   boolean
  championship_id:     string | null    // null = standalone legacy tournament
  created_by:          string
  created_at:          string
  updated_at:          string
  // v3 multi-stage fields (null/undefined on legacy rows)
  format_type?:                'single_knockout' | 'single_round_robin' | 'multi_rr_to_knockout'
  rr_groups?:                  number
  rr_advance_count?:           number
  stage1_complete?:            boolean
  stage2_bracket_generated?:   boolean
}

export interface Player {
  id:              string
  tournament_id:   string
  name:            string
  club:            string | null
  country_code:    string | null
  seed:            number | null
  preferred_group: number | null   // 1=Group A, 2=Group B, … set via Excel upload
  created_at:      string
  updated_at:      string
}

export interface BracketSlot {
  id:            string
  tournament_id: string
  slot_number:   number
  player_id:     string | null
  is_bye:        boolean
  player?:       Player | null   // joined
}

export interface Match {
  id:              string
  tournament_id:   string
  round:           number
  match_number:    number
  player1_id:      string | null
  player2_id:      string | null
  player1_games:   number
  player2_games:   number
  winner_id:       string | null
  status:          MatchStatus
  next_match_id:   string | null
  next_slot:       1 | 2 | null
  round_name:      string | null
  court:           string | null
  scheduled_at:    string | null
  started_at:      string | null
  completed_at:    string | null
  created_at:      string
  updated_at:      string
  // v3 stage fields (nullable; absent on legacy rows)
  stage_id?:       string | null
  group_id?:       string | null
  match_kind?:     'knockout' | 'round_robin'
  // Joined
  player1?:        Player | null
  player2?:        Player | null
  winner?:         Player | null
  games?:          Game[]
}

export interface Game {
  id:          string
  match_id:    string
  game_number: number
  score1:      number | null
  score2:      number | null
  winner_id:   string | null
  created_at:  string
  updated_at:  string
}

// ─── Stage (v3 multi-stage support) ───────────────────────────────────────────

export type StageType   = 'round_robin' | 'knockout'
export type StageStatus = 'pending' | 'active' | 'complete'

/** Mirrors the `stages` DB table. */
export interface Stage {
  id:            string
  tournament_id: string
  stage_number:  number       // 1 = first stage
  stage_type:    StageType
  config:        RRStageConfig | KOStageConfig
  status:        StageStatus
  created_at:    string
  updated_at:    string
}

/** Config stored in stages.config when stage_type = 'round_robin' */
export interface RRStageConfig {
  numberOfGroups:   number
  advanceCount:     number       // top N per group
  matchFormat:      MatchFormat
  allowBestThird:   boolean      // allow best-placed third-place qualifiers
  bestThirdCount:   number       // how many best-thirds advance (1–4)
  /**
   * Controls when "Close Stage 1 & Advance" is available.
   * 'require_all' — (default) every non-bye RR match must be complete.
   * 'manual'      — admin may force-close at any point with an override dialog.
   */
  finalizationRule?: 'require_all' | 'manual'
}

/** Audit summary returned by reset/force-close actions. */
export interface StageResetLog {
  stageLabel:     string   // e.g. "Group Stage", "KO Bracket"
  matchesDeleted: number
  gamesDeleted:   number
  groupsReset:    number
  skippedMatches?: number  // present only on force-close
  timestamp:      string   // ISO
}

/** Config stored in stages.config when stage_type = 'knockout' */
export interface KOStageConfig {
  seededFromRR:   boolean        // players came from RR standings
  matchFormat:    MatchFormat
}

/** A qualified player ready to enter the knockout bracket. */
export interface Qualifier {
  playerId:   string
  name:       string
  seed:       number | null      // original player seed (may be null for unseeded)
  club:       string | null
  rrRank:     number             // 1 = group winner, 2 = runner-up, 3 = third …
  groupName:  string             // "Group A", "Group B" …
  groupId:    string
  koSeed:     number             // KO bracket seed (1 = top, assigned after avoidance pass)
  isBestThird: boolean           // came via best-third-placed rule
}

// ─── App-level helpers ─────────────────────────────────────────────────────────

/** Maps format code to games-to-win and max games */
export const FORMAT_CONFIG: Record<MatchFormat, { gamesNeeded: number; maxGames: number; label: string }> = {
  bo3: { gamesNeeded: 2, maxGames: 3, label: 'Best of 3' },
  bo5: { gamesNeeded: 3, maxGames: 5, label: 'Best of 5' },
  bo7: { gamesNeeded: 4, maxGames: 7, label: 'Best of 7' },
}

export interface BracketRound {
  roundNumber: number
  roundName:   string
  matches:     Match[]
}
