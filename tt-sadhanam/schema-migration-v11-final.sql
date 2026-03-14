-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration v11: Performance indexes + KO bracket fix + match_number guard
--
-- Changes:
--   1. Missing FK indexes (15+) — eliminates sequential scans on hot paths
--   2. slot_index column on team_matches — fixes TBD not progressing in KO brackets
--   3. match_number INTEGER guard — ensures no smallint overflow on group fixtures
--   4. Covering indexes for team fixture queries
--   5. RLS InitPlan fix for team_rr_group_members
--   6. Drop unused indexes
--
-- Safe to re-run: all statements are idempotent (IF NOT EXISTS / IF EXISTS).
-- Run in Supabase SQL Editor (NOT wrapped in a transaction — no CONCURRENTLY).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Ensure match_number is INTEGER (not smallint) ─────────────────────────
-- Some instances created before v5 may still have SMALLINT.
-- Group fixture generation uses roundN * 100 + ... which fits in INTEGER fine.
ALTER TABLE matches ALTER COLUMN match_number TYPE INTEGER;

-- ── 2. slot_index column for deterministic KO bracket propagation ─────────────
-- Stores the 0-based position of a KO team_match within its round.
-- Without this, updateTeamKOWinner was ordering by created_at which is
-- non-deterministic for bulk-inserted rows → winners propagated to wrong slots.
ALTER TABLE team_matches
  ADD COLUMN IF NOT EXISTS slot_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_team_matches_slot_index
  ON team_matches (tournament_id, round, slot_index)
  WHERE group_id IS NULL;

-- ── 3. Unindexed FK indexes — highest impact ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_team_matches_team_a_id
  ON team_matches (team_a_id);

CREATE INDEX IF NOT EXISTS idx_team_matches_team_b_id
  ON team_matches (team_b_id);

CREATE INDEX IF NOT EXISTS idx_team_matches_winner_team_id
  ON team_matches (winner_team_id)
  WHERE winner_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_a_player_id
  ON team_match_submatches (team_a_player_id)
  WHERE team_a_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_b_player_id
  ON team_match_submatches (team_b_player_id)
  WHERE team_b_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_a_player2_id
  ON team_match_submatches (team_a_player2_id)
  WHERE team_a_player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_b_player2_id
  ON team_match_submatches (team_b_player2_id)
  WHERE team_b_player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_player1_id
  ON matches (player1_id)
  WHERE player1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_player2_id
  ON matches (player2_id)
  WHERE player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_winner_id
  ON matches (winner_id)
  WHERE winner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_loser_next_match_id
  ON matches (loser_next_match_id)
  WHERE loser_next_match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_games_winner_id
  ON games (winner_id)
  WHERE winner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_championships_created_by
  ON championships (created_by);

CREATE INDEX IF NOT EXISTS idx_tournaments_created_by
  ON tournaments (created_by);

CREATE INDEX IF NOT EXISTS idx_bracket_slots_player_id
  ON bracket_slots (player_id)
  WHERE player_id IS NOT NULL;

-- ── 4. Covering indexes for hot team fixture queries ──────────────────────────

-- Covers the loadMatches single-join query fully for KO tab
CREATE INDEX IF NOT EXISTS idx_team_matches_covering
  ON team_matches (tournament_id, round)
  INCLUDE (team_a_id, team_b_id, status, team_a_score, team_b_score, winner_team_id, group_id, slot_index);

-- KO-only partial index
CREATE INDEX IF NOT EXISTS idx_team_matches_ko_rounds
  ON team_matches (tournament_id, round, slot_index)
  WHERE group_id IS NULL AND round >= 900;

-- Group fixtures partial index
CREATE INDEX IF NOT EXISTS idx_team_matches_group_fixtures
  ON team_matches (tournament_id, group_id, round)
  WHERE group_id IS NOT NULL;

-- Core query indexes (may already exist from v10)
CREATE INDEX IF NOT EXISTS idx_matches_tournament_id
  ON matches (tournament_id);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_round
  ON matches (tournament_id, round, match_number);

CREATE INDEX IF NOT EXISTS idx_games_match_id
  ON games (match_id);

CREATE INDEX IF NOT EXISTS idx_team_matches_tournament_round
  ON team_matches (tournament_id, round);

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_match_id
  ON team_match_submatches (team_match_id);

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_match_id
  ON team_match_submatches (match_id);

CREATE INDEX IF NOT EXISTS idx_stages_tournament_stage_number
  ON stages (tournament_id, stage_number);

-- ── 5. RLS InitPlan fix — auth.uid() re-evaluated per row ────────────────────
-- Wrap in SECURITY DEFINER function so auth.uid() is called once per statement.

CREATE OR REPLACE FUNCTION team_rr_group_owner_check(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rr_groups g
    JOIN   stages s    ON s.id = g.stage_id
    JOIN   tournaments t ON t.id = s.tournament_id
    WHERE  g.id = p_group_id
    AND    t.created_by = auth.uid()
  )
$$;

DROP POLICY IF EXISTS "team_rr_group_members_insert_owner" ON team_rr_group_members;
CREATE POLICY "team_rr_group_members_insert_owner"
  ON team_rr_group_members FOR INSERT
  WITH CHECK (team_rr_group_owner_check(group_id));

DROP POLICY IF EXISTS "team_rr_group_members_delete_owner" ON team_rr_group_members;
CREATE POLICY "team_rr_group_members_delete_owner"
  ON team_rr_group_members FOR DELETE
  USING (team_rr_group_owner_check(group_id));

-- Fix audit_log RLS InitPlan
DROP POLICY IF EXISTS "Authenticated users can insert audit entries" ON audit_log;
CREATE POLICY "Authenticated users can insert audit entries"
  ON audit_log FOR INSERT
  WITH CHECK (actor_id = (SELECT auth.uid()));

-- ── 6. Drop confirmed-unused indexes ─────────────────────────────────────────
DROP INDEX IF EXISTS matches_status_updated_at_idx;
DROP INDEX IF EXISTS matches_updated_at_idx;
DROP INDEX IF EXISTS matches_bracket_side_idx;
DROP INDEX IF EXISTS matches_group_round_idx;
DROP INDEX IF EXISTS team_matches_status_idx;
DROP INDEX IF EXISTS teams_tournament_updated_at_idx;

-- ── 7. Analyze ────────────────────────────────────────────────────────────────
ANALYZE team_matches;
ANALYZE team_match_submatches;
ANALYZE matches;
ANALYZE games;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING THIS MIGRATION:
-- 1. Deploy the updated application code
-- 2. For existing tournaments: regenerate KO brackets from the admin UI
--    (the new bracket generation stores slot_index; old brackets need regeneration)
-- ═══════════════════════════════════════════════════════════════════════════════
