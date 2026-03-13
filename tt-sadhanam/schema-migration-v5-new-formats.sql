-- =============================================================================
-- MIGRATION v5 — New Format Types
-- Adds: pure_round_robin, team_league, double_elimination
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS / DO $$ exception guards.
-- Run AFTER the base schema-all.sql.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — EXTEND ENUMS
-- =============================================================================

-- Add 3 new format types (idempotent — ALTER TYPE ADD VALUE ignores duplicates in pg14+)
DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'pure_round_robin';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_league';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'double_elimination';
EXCEPTION WHEN others THEN NULL; END $$;

-- match_kind: add team_submatch for individual matches within a team match
DO $$ BEGIN
  ALTER TYPE match_kind ADD VALUE IF NOT EXISTS 'team_submatch';
EXCEPTION WHEN others THEN NULL; END $$;

-- New enum: bracket side for double elimination
DO $$ BEGIN
  CREATE TYPE bracket_side AS ENUM ('winners', 'losers', 'grand_final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- SECTION 2 — EXTEND matches TABLE (backward-safe new columns)
-- =============================================================================

-- bracket_side: null on all non-DE matches (fully backward compatible)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS bracket_side   bracket_side NULL;

-- loser routing: where the loser of a WB match goes in the LB (DE only)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_match_id UUID NULL
  REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_slot SMALLINT NULL
  CHECK (loser_next_slot IN (1, 2));

-- =============================================================================
-- SECTION 3 — TEAM LEAGUE TABLES
-- =============================================================================

-- ── teams ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  short_name     TEXT,                          -- e.g. "IND", "CHN" (max 4 chars)
  color          TEXT,                          -- hex colour for UI badges
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── team_players ──────────────────────────────────────────────────────────────
-- Players belonging to a team. Independent of the main players table —
-- team players have names but no seeding in the league context.
CREATE TABLE IF NOT EXISTS team_players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  position    SMALLINT    NOT NULL DEFAULT 1 CHECK (position >= 1),  -- 1=top player
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── team_matches ──────────────────────────────────────────────────────────────
-- One row per fixture (Team A vs Team B in round R).
CREATE TABLE IF NOT EXISTS team_matches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_a_id      UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id      UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round          INTEGER     NOT NULL,
  round_name     TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'  -- pending | live | complete
                             CHECK (status IN ('pending','live','complete')),
  team_a_score   SMALLINT    NOT NULL DEFAULT 0,  -- individual matches won
  team_b_score   SMALLINT    NOT NULL DEFAULT 0,
  winner_team_id UUID                 REFERENCES teams(id) ON DELETE SET NULL,
  scheduled_at   TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, team_a_id, team_b_id)   -- each pair meets once
);

-- ── team_match_submatches ─────────────────────────────────────────────────────
-- Each individual match within a team fixture (e.g. A1 vs B1, Doubles, etc.)
-- The actual scoring lives in the matches table (match_kind = 'team_submatch').
CREATE TABLE IF NOT EXISTS team_match_submatches (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_match_id    UUID        NOT NULL REFERENCES team_matches(id) ON DELETE CASCADE,
  match_order      SMALLINT    NOT NULL CHECK (match_order >= 1),  -- 1..5 for Bo5 team match
  label            TEXT        NOT NULL,    -- e.g. "Singles 1", "Doubles", "Singles 4"
  player_a_name    TEXT,                    -- denormalised for quick display
  player_b_name    TEXT,
  team_a_player_id UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  team_b_player_id UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  match_id         UUID        REFERENCES matches(id) ON DELETE SET NULL,  -- the scoring match
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_match_id, match_order)
);

-- =============================================================================
-- SECTION 4 — INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS teams_tournament_id_idx
  ON teams (tournament_id);

CREATE INDEX IF NOT EXISTS team_players_team_id_idx
  ON team_players (team_id);

CREATE INDEX IF NOT EXISTS team_matches_tournament_id_idx
  ON team_matches (tournament_id);

CREATE INDEX IF NOT EXISTS team_matches_team_a_idx
  ON team_matches (team_a_id);

CREATE INDEX IF NOT EXISTS team_matches_team_b_idx
  ON team_matches (team_b_id);

CREATE INDEX IF NOT EXISTS team_match_submatches_team_match_id_idx
  ON team_match_submatches (team_match_id);

CREATE INDEX IF NOT EXISTS matches_bracket_side_idx
  ON matches (bracket_side)
  WHERE bracket_side IS NOT NULL;

-- =============================================================================
-- SECTION 5 — ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_matches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_match_submatches ENABLE ROW LEVEL SECURITY;

-- ── teams ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view teams of published tournaments" ON public.teams;
CREATE POLICY "Public can view teams of published tournaments"
  ON public.teams FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.tournaments t
            WHERE t.id = teams.tournament_id AND t.published = true)
  );

DROP POLICY IF EXISTS "Owner can manage teams" ON public.teams;
CREATE POLICY "Owner can manage teams"
  ON public.teams FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.tournaments t
            WHERE t.id = teams.tournament_id AND t.created_by = (SELECT auth.uid()))
  );

-- ── team_players ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view team_players" ON public.team_players;
CREATE POLICY "Public can view team_players"
  ON public.team_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams te
      JOIN public.tournaments t ON t.id = te.tournament_id
      WHERE te.id = team_players.team_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can manage team_players" ON public.team_players;
CREATE POLICY "Owner can manage team_players"
  ON public.team_players FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.teams te
      JOIN public.tournaments t ON t.id = te.tournament_id
      WHERE te.id = team_players.team_id AND t.created_by = (SELECT auth.uid())
    )
  );

-- ── team_matches ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view team_matches" ON public.team_matches;
CREATE POLICY "Public can view team_matches"
  ON public.team_matches FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.tournaments t
            WHERE t.id = team_matches.tournament_id AND t.published = true)
  );

DROP POLICY IF EXISTS "Owner can manage team_matches" ON public.team_matches;
CREATE POLICY "Owner can manage team_matches"
  ON public.team_matches FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.tournaments t
            WHERE t.id = team_matches.tournament_id AND t.created_by = (SELECT auth.uid()))
  );

-- ── team_match_submatches ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view team_match_submatches" ON public.team_match_submatches;
CREATE POLICY "Public can view team_match_submatches"
  ON public.team_match_submatches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_matches tm
      JOIN public.tournaments t ON t.id = tm.tournament_id
      WHERE tm.id = team_match_submatches.team_match_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can manage team_match_submatches" ON public.team_match_submatches;
CREATE POLICY "Owner can manage team_match_submatches"
  ON public.team_match_submatches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.team_matches tm
      JOIN public.tournaments t ON t.id = tm.tournament_id
      WHERE tm.id = team_match_submatches.team_match_id AND t.created_by = (SELECT auth.uid())
    )
  );

-- =============================================================================
-- SECTION 6 — REALTIME (add new tables to publication)
-- =============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teams;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_matches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_match_submatches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Done. Existing tournaments are unaffected — all new columns are nullable.
-- =============================================================================
