// ─── Database row types (mirror Supabase schema) ──────────────────────────────

export type TournamentStatus = 'setup' | 'active' | 'complete'
export type MatchStatus      = 'pending' | 'live' | 'complete' | 'bye'
export type MatchFormat      = 'bo3' | 'bo5' | 'bo7'

/**
 * All tournament format types.
 * Single-stage:
 *   single_knockout     — direct elimination bracket
 *   pure_round_robin    — everyone plays everyone, standings decide winner
 *   double_elimination  — winners + losers brackets, eliminated after 2 losses
 *   team_league         — ITTF team-match style: Round Robin then Top-4 Knockout
 *   team_league_ko      — Corbillon Cup: seeded Knockout bracket, 4 singles + 1 doubles per tie
 *   team_league_swaythling — Swaythling Cup: seeded Knockout bracket, 5 singles per tie (no doubles)
 * Multi-stage:
 *   single_round_robin      — groups stage (configurable groups, top N advance to KO)
 *   multi_rr_to_knockout    — round-robin groups → single KO bracket
 */
export type TournamentFormatType =
  | 'single_knockout'
  | 'single_round_robin'
  | 'multi_rr_to_knockout'
  | 'pure_round_robin'
  | 'team_league'
  | 'team_league_ko'
  | 'team_league_swaythling'
  | 'team_group_corbillon'
  | 'team_group_swaythling'
  | 'double_elimination'

/** Bracket side for double-elimination matches (null on all other formats). */
export type BracketSide = 'winners' | 'losers' | 'grand_final'

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
  format_type?:                TournamentFormatType
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
  preferred_group: number | null   // 1=Group 1, 2=Group 2, … set via Excel/paste upload
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
  match_kind?:     'knockout' | 'round_robin' | 'team_submatch'
  match_format?:   MatchFormat | null   // per-match override (null = use tournament default)
  // Double-elimination fields (null on all non-DE matches)
  bracket_side?:          BracketSide | null
  loser_next_match_id?:   string | null
  loser_next_slot?:       1 | 2 | null
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

// ─────────────────────────────────────────────────────────────────────────────
// Homepage data shapes (derived server-side from Supabase queries)
// ─────────────────────────────────────────────────────────────────────────────

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

export interface OngoingChampRow {
  id:           string
  name:         string
  location:     string | null
  startDate:    string | null
  endDate:      string | null
  published:    boolean
  eventCount:   number
  liveCount:    number
  doneCount:    number
  totalMatches: number
  doneMatches:  number
}

export interface ActiveEventRow {
  id:           string
  name:         string
  champId:      string | null
  champName:    string | null
  formatType:   string | null
  status:       string
  stageLabel:   string
  progress:     number
  totalMatches: number
  doneMatches:  number
  liveCount:    number
}

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

// ─── Team League Types ────────────────────────────────────────────────────────

export interface Team {
  id:            string
  tournament_id: string
  name:          string
  short_name:    string | null
  color:         string | null
  seed:          number | null   // optional bracket seed for team_league_ko
  // positions (1-based) of the two players who play doubles; null = not designated
  doubles_p1_pos: number | null
  doubles_p2_pos: number | null
  created_at:    string
  updated_at:    string
  // joined
  players?:      TeamPlayer[]
  wins?:         number
  losses?:       number
  matches_played?: number
}

export interface TeamPlayer {
  id:         string
  team_id:    string
  name:       string
  position:   number   // 1 = top player
  created_at: string
}

export interface TeamMatch {
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
  scheduled_at:   string | null
  completed_at:   string | null
  created_at:     string
  updated_at:     string
  // joined
  team_a?:        Team | null
  team_b?:        Team | null
  submatches?:    TeamMatchSubmatch[]
}

export interface TeamMatchSubmatch {
  id:               string
  team_match_id:    string
  match_order:      number
  label:            string
  player_a_name:    string | null
  player_b_name:    string | null
  team_a_player_id: string | null
  team_b_player_id: string | null
  match_id:         string | null
  created_at:       string
  // joined scoring match (if match_id is set)
  match?:           Match | null
}

// ─── Pure Round Robin types ───────────────────────────────────────────────────

/** Config stored in tournament.rr_config JSONB when format_type = 'pure_round_robin' */
export interface PureRRConfig {
  matchFormat: MatchFormat
  generated:   boolean
}

// ─── Double Elimination Types ─────────────────────────────────────────────────

export interface DEBracketResult {
  winnersBracket: DEMatch[]
  losersBracket:  DEMatch[]
  grandFinal:     DEMatch[]
  totalMatches:   number
}

export interface DEMatch {
  id:             string   // pre-assigned UUID for DB insert
  round:          number
  matchNumber:    number
  roundName:      string
  bracketSide:    BracketSide
  player1Id:      string | null
  player2Id:      string | null
  isBye:          boolean
  nextMatchId:    string | null   // where winner goes
  nextSlot:       1 | 2 | null
  loserNextMatchId: string | null  // where loser goes (WB matches only)
  loserNextSlot:  1 | 2 | null
}
