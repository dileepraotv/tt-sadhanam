-- =============================================================================
-- TT-SADHANAM — Migration: New Event Format Types
-- Run in Supabase SQL editor ONCE.
-- Safe to run on existing databases — uses IF NOT EXISTS / DO $$ guards.
-- Existing tournaments are NOT affected.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — Extend Enums
-- PostgreSQL ALTER TYPE … ADD VALUE is safe and backward-compatible.
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
  ALTER TYPE match_kind ADD VALUE IF NOT EXISTS 'team_submatch';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bracket_side AS ENUM ('winners', 'losers', 'grand_final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- SECTION 2 — Extend matches table for Double Elimination
-- These columns are NULL for all non-DE matches (fully backward-compatible).
-- =============================================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS bracket_side        bracket_side NULL,
  ADD COLUMN IF NOT EXISTS loser_next_match_id UUID         REFERENCES matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loser_next_slot     SMALLINT     CHECK (loser_next_slot IN (1, 2));

-- Index for DE bracket queries
CREATE INDEX IF NOT EXISTS matches_bracket_side_idx
  ON matches (tournament_id, bracket_side)
  WHERE bracket_side IS NOT NULL;


-- =============================================================================
-- SECTION 3 — Team League Tables
-- =============================================================================

-- ── teams ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  short_name    TEXT,
  color         TEXT,       -- hex color e.g. #F06321
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_tournament_id_idx ON teams (tournament_id);

DO $$ BEGIN
  CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── team_players ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_players (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 1,   -- 1 = top player (A1), 2 = second (A2), etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_players_team_id_idx ON team_players (team_id);

-- ── team_matches ──────────────────────────────────────────────────────────────
-- One row per "Team A vs Team B" fixture. Contains aggregate scores.
CREATE TABLE IF NOT EXISTS team_matches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_a_id       UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id       UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round           INTEGER     NOT NULL DEFAULT 1,
  round_name      TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'  -- pending | live | complete
    CHECK (status IN ('pending','live','complete')),
  team_a_score    INTEGER     NOT NULL DEFAULT 0,
  team_b_score    INTEGER     NOT NULL DEFAULT 0,
  winner_team_id  UUID        REFERENCES teams(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_matches_tournament_id_idx ON team_matches (tournament_id);
CREATE INDEX IF NOT EXISTS team_matches_status_idx        ON team_matches (tournament_id, status);

DO $$ BEGIN
  CREATE TRIGGER team_matches_updated_at BEFORE UPDATE ON team_matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── team_match_submatches ─────────────────────────────────────────────────────
-- One row per individual match within a team fixture (e.g. Singles 1, Doubles, etc.)
-- References a scoring match row in the main matches table.
CREATE TABLE IF NOT EXISTS team_match_submatches (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_match_id    UUID        NOT NULL REFERENCES team_matches(id) ON DELETE CASCADE,
  match_order      INTEGER     NOT NULL,   -- 1=Singles 1, 2=Singles 2, 3=Doubles, 4=Singles 3, 5=Singles 4
  label            TEXT        NOT NULL,   -- "Singles 1", "Doubles", etc.
  player_a_name    TEXT,                   -- denormalised name (for display without FK)
  player_b_name    TEXT,
  team_a_player_id UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  team_b_player_id UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  match_id         UUID        REFERENCES matches(id) ON DELETE SET NULL,  -- scoring row
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_match_id, match_order)
);

CREATE INDEX IF NOT EXISTS team_match_submatches_team_match_id_idx
  ON team_match_submatches (team_match_id);

CREATE INDEX IF NOT EXISTS team_match_submatches_match_id_idx
  ON team_match_submatches (match_id)
  WHERE match_id IS NOT NULL;


-- =============================================================================
-- SECTION 4 — Row Level Security
-- =============================================================================

ALTER TABLE teams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_match_submatches ENABLE ROW LEVEL SECURITY;

-- ── teams ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view teams of published tournaments"   ON public.teams;
CREATE POLICY "Public can view teams of published tournaments"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own teams" ON public.teams;
CREATE POLICY "Owner can view own teams"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can manage teams" ON public.teams;
CREATE POLICY "Owner can manage teams"
  ON public.teams FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.created_by = (SELECT auth.uid())
    )
  );

-- ── team_players ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view team_players" ON public.team_players;
CREATE POLICY "Public can view team_players"
  ON public.team_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams tm
      JOIN public.tournaments t ON t.id = tm.tournament_id
      WHERE tm.id = team_players.team_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can manage team_players" ON public.team_players;
CREATE POLICY "Owner can manage team_players"
  ON public.team_players FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.teams tm
      JOIN public.tournaments t ON t.id = tm.tournament_id
      WHERE tm.id = team_players.team_id AND t.created_by = (SELECT auth.uid())
    )
  );

-- ── team_matches ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view team_matches" ON public.team_matches;
CREATE POLICY "Public can view team_matches"
  ON public.team_matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = team_matches.tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can manage team_matches" ON public.team_matches;
CREATE POLICY "Owner can manage team_matches"
  ON public.team_matches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = team_matches.tournament_id AND t.created_by = (SELECT auth.uid())
    )
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
-- SECTION 5 — Realtime Subscriptions
-- =============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teams;             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_players;      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_matches;      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_match_submatches; EXCEPTION WHEN others THEN NULL; END $$;


-- =============================================================================
-- SECTION 6 — Performance Indexes for New Tables
-- =============================================================================

CREATE INDEX IF NOT EXISTS teams_tournament_updated_at_idx
  ON teams (tournament_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS team_matches_round_idx
  ON team_matches (tournament_id, round);
