-- =============================================================================
-- SADHANAM — Complete Database Schema
-- Table Tennis Tournament Manager
--
-- HOW TO USE
--   Fresh install:  run this entire file once in the Supabase SQL Editor.
--   Existing install: run this file — every statement is idempotent
--   (uses IF NOT EXISTS / IF EXISTS / DO $$ exception handlers throughout).
--
-- This file consolidates:
--   schema.sql              — base tables (v1/v2)
--   schema-migration-v2     — championships table + tournament FK
--   schema-migration-v3     — stages, round-robin groups, format types
--   schema-migration-v4     — preferred_group column for Excel import
--   schema-migration-v5     — remove seed / player count caps
--   supabase-rls-fix        — optimized RLS policies (select auth.uid())
-- =============================================================================


-- =============================================================================
-- SECTION 1 — EXTENSIONS & ENUMS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN CREATE TYPE tournament_status AS ENUM ('setup','active','complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE match_status AS ENUM ('pending','live','complete','bye');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE match_format AS ENUM ('bo3','bo5','bo7');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tournament_format_type AS ENUM (
    'single_knockout',
    'single_round_robin',
    'multi_rr_to_knockout',
    'pure_round_robin',
    'double_elimination',
    'team_league',
    'team_league_ko',
    'team_league_swaythling'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE match_kind AS ENUM ('knockout', 'round_robin', 'team_submatch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bracket_side AS ENUM ('winners', 'losers', 'grand_final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- SECTION 2 — CORE TABLES
-- =============================================================================

-- ── championships ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS championships (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  location    TEXT,
  year        INTEGER,
  start_date  DATE,
  end_date    DATE,
  published   BOOLEAN     NOT NULL DEFAULT false,
  created_by  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── tournaments / events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id                       UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT                   NOT NULL,
  description              TEXT,
  location                 TEXT,
  date                     DATE,
  format                   match_format           NOT NULL DEFAULT 'bo5',
  status                   tournament_status      NOT NULL DEFAULT 'setup',
  published                BOOLEAN                NOT NULL DEFAULT false,
  bracket_generated        BOOLEAN                NOT NULL DEFAULT false,
  championship_id          UUID                   REFERENCES championships(id) ON DELETE CASCADE,
  created_by               UUID                   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  -- v3 columns (stage / round-robin support)
  format_type              tournament_format_type NOT NULL DEFAULT 'single_knockout',
  rr_groups                INTEGER                NOT NULL DEFAULT 1 CONSTRAINT rr_groups_min CHECK (rr_groups >= 1),
  rr_advance_count         INTEGER                NOT NULL DEFAULT 2 CONSTRAINT rr_advance_range CHECK (rr_advance_count >= 1),
  stage1_complete          BOOLEAN                NOT NULL DEFAULT false,
  stage2_bracket_generated BOOLEAN                NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS tournaments_championship_id_idx ON tournaments (championship_id);

-- ── players ───────────────────────────────────────────────────────────────────
-- seed and preferred_group are unbounded positive integers (no upper cap).
CREATE TABLE IF NOT EXISTS players (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  club            TEXT,
  country_code    CHAR(3),
  seed            INTEGER     CONSTRAINT players_seed_positive CHECK (seed >= 1),
  preferred_group INTEGER     CONSTRAINT players_preferred_group_min CHECK (preferred_group >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_tournament_seed_unique
  ON players (tournament_id, seed) WHERE seed IS NOT NULL;

-- ── bracket_slots ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bracket_slots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_number   INTEGER     NOT NULL,
  player_id     UUID        REFERENCES players(id) ON DELETE SET NULL,
  is_bye        BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, slot_number)
);

-- ── stages ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_number  SMALLINT    NOT NULL,
  stage_type    TEXT        NOT NULL CHECK (stage_type IN ('knockout', 'round_robin')),
  config        JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'active', 'complete')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, stage_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS stages_one_active_per_tournament
  ON stages (tournament_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS stages_tournament_id_idx ON stages (tournament_id);

-- ── rr_groups ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rr_groups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id     UUID        NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  group_number SMALLINT    NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stage_id, group_number)
);
CREATE INDEX IF NOT EXISTS rr_groups_stage_id_idx ON rr_groups (stage_id);

-- ── rr_group_members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rr_group_members (
  group_id   UUID        NOT NULL REFERENCES rr_groups(id)  ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES players(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, player_id)
);
CREATE INDEX IF NOT EXISTS rr_group_members_player_id_idx ON rr_group_members (player_id);

-- ── matches ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID         NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         INTEGER      NOT NULL,
  match_number  INTEGER      NOT NULL,
  player1_id    UUID         REFERENCES players(id) ON DELETE SET NULL,
  player2_id    UUID         REFERENCES players(id) ON DELETE SET NULL,
  player1_games INTEGER      NOT NULL DEFAULT 0,
  player2_games INTEGER      NOT NULL DEFAULT 0,
  winner_id     UUID         REFERENCES players(id) ON DELETE SET NULL,
  status        match_status NOT NULL DEFAULT 'pending',
  next_match_id UUID         REFERENCES matches(id) ON DELETE SET NULL,
  next_slot     SMALLINT     CHECK (next_slot IN (1,2)),
  round_name    TEXT,
  court         TEXT,
  scheduled_at  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- v3 stage / group columns
  stage_id      UUID         REFERENCES stages(id)    ON DELETE SET NULL,
  group_id      UUID         REFERENCES rr_groups(id) ON DELETE SET NULL,
  match_kind    match_kind   NOT NULL DEFAULT 'knockout',
  -- v5 double-elimination columns (null on all non-DE matches)
  bracket_side         bracket_side NULL,
  loser_next_match_id  UUID         NULL REFERENCES matches(id) ON DELETE SET NULL,
  loser_next_slot      SMALLINT     NULL CHECK (loser_next_slot IN (1, 2)),
  -- v7 per-match format override (null = use tournament default)
  match_format         TEXT         NULL CHECK (match_format IN ('bo3','bo5','bo7')),
  UNIQUE (tournament_id, round, match_number)
);
CREATE INDEX IF NOT EXISTS matches_stage_id_idx   ON matches (stage_id)         WHERE stage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_group_id_idx   ON matches (group_id)         WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_group_round_idx ON matches (group_id, round) WHERE match_kind = 'round_robin';

-- ── games ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_number INTEGER     NOT NULL,
  score1      INTEGER     CHECK (score1 >= 0),
  score2      INTEGER     CHECK (score2 >= 0),
  winner_id   UUID        REFERENCES players(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, game_number)
);


-- =============================================================================
-- SECTION 2b — TEAM LEAGUE TABLES (team_league and team_league_ko formats)
-- =============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  short_name     TEXT,
  color          TEXT,
  seed           SMALLINT    NULL CHECK (seed >= 1),
  doubles_p1_pos SMALLINT    NULL,
  doubles_p2_pos SMALLINT    NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  position    SMALLINT    NOT NULL DEFAULT 1 CHECK (position >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_matches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_a_id      UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id      UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round          INTEGER     NOT NULL,
  round_name     TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','live','complete')),
  team_a_score   SMALLINT    NOT NULL DEFAULT 0,
  team_b_score   SMALLINT    NOT NULL DEFAULT 0,
  winner_team_id UUID                 REFERENCES teams(id) ON DELETE SET NULL,
  scheduled_at   TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_match_submatches (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_match_id       UUID        NOT NULL REFERENCES team_matches(id) ON DELETE CASCADE,
  match_order         SMALLINT    NOT NULL CHECK (match_order >= 1),
  label               TEXT        NOT NULL,
  player_a_name       TEXT,
  player_b_name       TEXT,
  team_a_player_id    UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  team_b_player_id    UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  team_a_player2_id   UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  team_b_player2_id   UUID        REFERENCES team_players(id) ON DELETE SET NULL,
  match_id            UUID        REFERENCES matches(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_match_id, match_order)
);

CREATE INDEX IF NOT EXISTS teams_tournament_id_idx ON teams (tournament_id);
CREATE INDEX IF NOT EXISTS team_players_team_id_idx ON team_players (team_id);
CREATE INDEX IF NOT EXISTS team_matches_tournament_id_idx ON team_matches (tournament_id);
CREATE INDEX IF NOT EXISTS team_match_submatches_team_match_id_idx ON team_match_submatches (team_match_id);
CREATE INDEX IF NOT EXISTS matches_bracket_side_idx ON matches (tournament_id, bracket_side) WHERE bracket_side IS NOT NULL;



-- Run-safe: all ALTER TABLE statements use IF NOT EXISTS / DO $$ blocks.
-- Safe to skip on a fresh install — the tables above already have these columns.
-- =============================================================================

-- tournaments v3 columns (already included in CREATE TABLE above for fresh installs)
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format_type              tournament_format_type NOT NULL DEFAULT 'single_knockout';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rr_groups                INTEGER                NOT NULL DEFAULT 1;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rr_advance_count         INTEGER                NOT NULL DEFAULT 2;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS stage1_complete          BOOLEAN                NOT NULL DEFAULT false;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS stage2_bracket_generated BOOLEAN                NOT NULL DEFAULT false;

-- Drop old 1-16 constraint on rr_groups (if migrating from v3)
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS rr_groups_range;
DO $$ BEGIN
  ALTER TABLE tournaments ADD CONSTRAINT rr_groups_min CHECK (rr_groups >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- matches v3 columns
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage_id   UUID       REFERENCES stages(id)    ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id   UUID       REFERENCES rr_groups(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_kind match_kind NOT NULL DEFAULT 'knockout';

-- players v4/v5 columns
ALTER TABLE players ADD COLUMN IF NOT EXISTS preferred_group INTEGER;

-- Remove old seed cap (constraint may be named players_seed_range or have an auto-generated name)
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_seed_range;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_seed_check;
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'players'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%seed%64%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE players DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END$$;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_seed_positive;
DO $$ BEGIN
  ALTER TABLE players ADD CONSTRAINT players_seed_positive CHECK (seed >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Widen columns from smallint → integer (v5)
ALTER TABLE players ALTER COLUMN seed            TYPE INTEGER;
ALTER TABLE players ALTER COLUMN preferred_group TYPE INTEGER;

-- Remove old preferred_group upper-bound constraints (if any)
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_preferred_group_check;
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'players'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%preferred_group%26%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE players DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END$$;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_preferred_group_min;
DO $$ BEGIN
  ALTER TABLE players ADD CONSTRAINT players_preferred_group_min CHECK (preferred_group >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- v3 data backfill: give existing tournaments a knockout stage
-- (idempotent — skips tournaments that already have a stage row)
DO $$
DECLARE rec RECORD;
         new_sid UUID;
BEGIN
  FOR rec IN
    SELECT DISTINCT m.tournament_id
    FROM matches m
    WHERE NOT EXISTS (SELECT 1 FROM stages s WHERE s.tournament_id = m.tournament_id)
  LOOP
    INSERT INTO stages (tournament_id, stage_number, stage_type, config, status)
    VALUES (rec.tournament_id, 1, 'knockout', '{}', 'active')
    ON CONFLICT (tournament_id, stage_number) DO NOTHING
    RETURNING id INTO new_sid;

    IF new_sid IS NOT NULL THEN
      UPDATE matches SET stage_id = new_sid
      WHERE tournament_id = rec.tournament_id AND stage_id IS NULL;
    END IF;
  END LOOP;
END $$;

UPDATE tournaments SET format_type = 'single_knockout' WHERE format_type IS NULL;


-- =============================================================================
-- SECTION 4 — COMMENTS
-- =============================================================================

COMMENT ON COLUMN players.seed IS
  'Optional seeding — positive integer, no upper bound.';

COMMENT ON COLUMN players.preferred_group IS
  'Optional group preference from Excel/paste upload (1=Group 1, 2=Group 2…). '
  'Used by generateGroups() to place the player into their designated group '
  'before remaining slots are filled by snake-seeding.';


-- =============================================================================
-- SECTION 5 — ROW LEVEL SECURITY
-- Enable RLS on all tables, then create optimized policies.
-- Uses (select auth.uid()) instead of auth.uid() to avoid per-row re-evaluation.
-- =============================================================================

ALTER TABLE championships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_slots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE games            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_group_members ENABLE ROW LEVEL SECURITY;

-- Drop any legacy policies before recreating (safe re-run)
DROP POLICY IF EXISTS "Championships select"  ON public.championships;
DROP POLICY IF EXISTS "Championships write"   ON public.championships;
DROP POLICY IF EXISTS "Tournaments select"    ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments write"     ON public.tournaments;
DROP POLICY IF EXISTS "Players select"        ON public.players;
DROP POLICY IF EXISTS "Players write"         ON public.players;
DROP POLICY IF EXISTS "Slots select"          ON public.bracket_slots;
DROP POLICY IF EXISTS "Slots write"           ON public.bracket_slots;
DROP POLICY IF EXISTS "Matches select"        ON public.matches;
DROP POLICY IF EXISTS "Matches write"         ON public.matches;
DROP POLICY IF EXISTS "Games select"          ON public.games;
DROP POLICY IF EXISTS "Games write"           ON public.games;
DROP POLICY IF EXISTS "Stages select"         ON public.stages;
DROP POLICY IF EXISTS "Stages write"          ON public.stages;
DROP POLICY IF EXISTS "RR groups select"      ON public.rr_groups;
DROP POLICY IF EXISTS "RR groups write"       ON public.rr_groups;
DROP POLICY IF EXISTS "RR members select"     ON public.rr_group_members;
DROP POLICY IF EXISTS "RR members write"      ON public.rr_group_members;

-- ── championships ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view published championships" ON public.championships;
CREATE POLICY "Public can view published championships"
  ON public.championships FOR SELECT USING (published = true);

DROP POLICY IF EXISTS "Owner can manage championships" ON public.championships;
CREATE POLICY "Owner can manage championships"
  ON public.championships FOR ALL USING ((SELECT auth.uid()) = created_by);

-- ── tournaments ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view published tournaments" ON public.tournaments;
CREATE POLICY "Public can view published tournaments"
  ON public.tournaments FOR SELECT USING (published = true);

DROP POLICY IF EXISTS "Owner can read own tournaments" ON public.tournaments;
CREATE POLICY "Owner can read own tournaments"
  ON public.tournaments FOR SELECT USING ((SELECT auth.uid()) = created_by);

DROP POLICY IF EXISTS "Authenticated users can create tournaments" ON public.tournaments;
CREATE POLICY "Authenticated users can create tournaments"
  ON public.tournaments FOR INSERT WITH CHECK ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Owner can update own tournaments" ON public.tournaments;
CREATE POLICY "Owner can update own tournaments"
  ON public.tournaments FOR UPDATE USING ((SELECT auth.uid()) = created_by);

DROP POLICY IF EXISTS "Owner can delete own tournaments" ON public.tournaments;
CREATE POLICY "Owner can delete own tournaments"
  ON public.tournaments FOR DELETE USING ((SELECT auth.uid()) = created_by);

-- ── players ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view players of published tournaments" ON public.players;
CREATE POLICY "Public can view players of published tournaments"
  ON public.players FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = players.tournament_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own players" ON public.players;
CREATE POLICY "Owner can view own players"
  ON public.players FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = players.tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can insert players" ON public.players;
CREATE POLICY "Owner can insert players"
  ON public.players FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can update players" ON public.players;
CREATE POLICY "Owner can update players"
  ON public.players FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can delete players" ON public.players;
CREATE POLICY "Owner can delete players"
  ON public.players FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── bracket_slots ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view bracket slots of published tournaments" ON public.bracket_slots;
CREATE POLICY "Public can view bracket slots of published tournaments"
  ON public.bracket_slots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = bracket_slots.tournament_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own bracket slots" ON public.bracket_slots;
CREATE POLICY "Owner can view own bracket slots"
  ON public.bracket_slots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = bracket_slots.tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage bracket slots" ON public.bracket_slots;
CREATE POLICY "Owner can manage bracket slots"
  ON public.bracket_slots FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── matches ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view matches of published tournaments" ON public.matches;
CREATE POLICY "Public can view matches of published tournaments"
  ON public.matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = matches.tournament_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own matches" ON public.matches;
CREATE POLICY "Owner can view own matches"
  ON public.matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = matches.tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage matches" ON public.matches;
CREATE POLICY "Owner can manage matches"
  ON public.matches FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── games ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view games of published tournaments" ON public.games;
CREATE POLICY "Public can view games of published tournaments"
  ON public.games FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    WHERE m.id = games.match_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own games" ON public.games;
CREATE POLICY "Owner can view own games"
  ON public.games FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    WHERE m.id = games.match_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage games" ON public.games;
CREATE POLICY "Owner can manage games"
  ON public.games FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    WHERE m.id = match_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── stages ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view stages" ON public.stages;
CREATE POLICY "Public can view stages"
  ON public.stages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own stages" ON public.stages;
CREATE POLICY "Owner can view own stages"
  ON public.stages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage stages" ON public.stages;
CREATE POLICY "Owner can manage stages"
  ON public.stages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── rr_groups ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view rr_groups" ON public.rr_groups;
CREATE POLICY "Public can view rr_groups"
  ON public.rr_groups FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.stages s
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE s.id = stage_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own rr_groups" ON public.rr_groups;
CREATE POLICY "Owner can view own rr_groups"
  ON public.rr_groups FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.stages s
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE s.id = stage_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage rr_groups" ON public.rr_groups;
CREATE POLICY "Owner can manage rr_groups"
  ON public.rr_groups FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.stages s
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE s.id = stage_id AND t.created_by = (SELECT auth.uid())
  ));

-- ── rr_group_members ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view rr_group_members" ON public.rr_group_members;
CREATE POLICY "Public can view rr_group_members"
  ON public.rr_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.rr_groups g
    JOIN public.stages s ON s.id = g.stage_id
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE g.id = group_id AND t.published = true
  ));

DROP POLICY IF EXISTS "Owner can view own rr_group_members" ON public.rr_group_members;
CREATE POLICY "Owner can view own rr_group_members"
  ON public.rr_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.rr_groups g
    JOIN public.stages s ON s.id = g.stage_id
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE g.id = group_id AND t.created_by = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Owner can manage rr_group_members" ON public.rr_group_members;
CREATE POLICY "Owner can manage rr_group_members"
  ON public.rr_group_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.rr_groups g
    JOIN public.stages s ON s.id = g.stage_id
    JOIN public.tournaments t ON t.id = s.tournament_id
    WHERE g.id = group_id AND t.created_by = (SELECT auth.uid())
  ));


-- =============================================================================
-- SECTION 6 — REALTIME
-- =============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE matches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE games;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE stages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rr_groups;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rr_group_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- SECTION 7 — TRIGGERS (updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN new.updated_at = now(); RETURN new; END; $$;

DO $$ BEGIN
  CREATE TRIGGER championships_updated_at BEFORE UPDATE ON championships
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER games_updated_at BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER stages_updated_at BEFORE UPDATE ON stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER rr_groups_updated_at BEFORE UPDATE ON rr_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Done. Run the Supabase linter to confirm zero RLS warnings.
-- =============================================================================

-- =============================================================================
-- SECTION 7 — PERFORMANCE INDEXES
-- Added from query performance report. All IF NOT EXISTS — safe to re-run.
-- =============================================================================

-- matches: lightweight tournament_id-only index for ANY($1) and simple lookups
CREATE INDEX IF NOT EXISTS matches_tournament_id_idx
  ON matches (tournament_id);

-- matches: covering index for (tournament_id, status) — Query #12 reads ONLY
-- these two columns; no heap fetch needed with this index.
CREATE INDEX IF NOT EXISTS matches_tournament_status_idx
  ON matches (tournament_id, status);

-- matches: Live Now feed — WHERE status='live' ORDER BY updated_at DESC
-- Partial index makes this tiny (only live rows) and eliminates the table scan.
CREATE INDEX IF NOT EXISTS matches_status_updated_at_idx
  ON matches (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS matches_live_idx
  ON matches (updated_at DESC)
  WHERE status = 'live';

-- matches: updated_at for Realtime CDC change ordering
CREATE INDEX IF NOT EXISTS matches_updated_at_idx
  ON matches (updated_at DESC);

-- rr_group_members: group_id was missing an index — standings joins use this
CREATE INDEX IF NOT EXISTS rr_group_members_group_id_idx
  ON rr_group_members (group_id);

-- tournaments: covering index so RLS subqueries never need a heap fetch
CREATE INDEX IF NOT EXISTS tournaments_rls_covering_idx
  ON tournaments (id)
  INCLUDE (published, created_by);

-- audit_log: read-side indexes for future audit trail queries
CREATE INDEX IF NOT EXISTS audit_log_table_record_idx
  ON audit_log (table_name, record_id);

CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON audit_log (created_at DESC);

-- players: covering index so lateral joins in match queries skip heap fetches
CREATE INDEX IF NOT EXISTS players_id_covering_idx
  ON players (id)
  INCLUDE (name, seed, club);


-- =============================================================================
-- SECTION 8 — NEW FORMAT TYPES (Pure RR, Double Elimination, Team League)
-- Added via migration-new-formats.sql — contents appended here for reference.
-- Run migration-new-formats.sql separately on existing databases.
-- =============================================================================

-- For FRESH INSTALLS only (existing DBs: run migration-new-formats.sql):
-- Enum additions (ALTER TYPE … ADD VALUE is idempotent via DO blocks)
-- See migration-new-formats.sql for the complete migration.
