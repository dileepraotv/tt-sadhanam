-- =============================================================================
-- MIGRATION v6 — Team KO & Double Elimination Fixes
--
-- Adds:
--   1. New tournament format types: pure_round_robin, double_elimination,
--      team_league, team_league_ko  (idempotent — safe to re-run)
--   2. match_kind: team_submatch
--   3. bracket_side enum + matches columns for DE
--   4. teams.seed, teams.doubles_p1_pos, teams.doubles_p2_pos
--   5. team_match_submatches.team_a_player2_id, team_b_player2_id
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS / exception guards.
-- Run AFTER schema-all.sql and any prior migrations.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — EXTEND ENUMS
-- =============================================================================

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'pure_round_robin';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'double_elimination';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_league';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_league_ko';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_league_swaythling';
EXCEPTION WHEN others THEN NULL; END $$;

-- match_kind: add team_submatch
DO $$ BEGIN
  ALTER TYPE match_kind ADD VALUE IF NOT EXISTS 'team_submatch';
EXCEPTION WHEN others THEN NULL; END $$;

-- bracket_side enum for double elimination
DO $$ BEGIN
  CREATE TYPE bracket_side AS ENUM ('winners', 'losers', 'grand_final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- SECTION 2 — EXTEND matches TABLE (DE columns)
-- =============================================================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS bracket_side         bracket_side NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_match_id  UUID         NULL
  REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_slot      SMALLINT     NULL
  CHECK (loser_next_slot IN (1, 2));

-- =============================================================================
-- SECTION 3 — EXTEND teams TABLE (Team KO columns)
-- =============================================================================

ALTER TABLE teams ADD COLUMN IF NOT EXISTS seed           SMALLINT NULL CHECK (seed >= 1);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS doubles_p1_pos SMALLINT NULL;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS doubles_p2_pos SMALLINT NULL;

-- =============================================================================
-- SECTION 4 — EXTEND team_match_submatches TABLE (doubles support)
-- =============================================================================

ALTER TABLE team_match_submatches ADD COLUMN IF NOT EXISTS team_a_player2_id UUID NULL
  REFERENCES team_players(id) ON DELETE SET NULL;
ALTER TABLE team_match_submatches ADD COLUMN IF NOT EXISTS team_b_player2_id UUID NULL
  REFERENCES team_players(id) ON DELETE SET NULL;

-- =============================================================================
-- SECTION 5 — INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS matches_bracket_side_idx
  ON matches (tournament_id, bracket_side)
  WHERE bracket_side IS NOT NULL;

-- =============================================================================
-- Done. All existing data is unaffected — all new columns are nullable.
-- =============================================================================
