-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration v11: Performance — missing FK indexes + RLS init plan fixes
--
-- WHY THIS MIGRATION?
--
-- Supabase Lint identified 15+ unindexed foreign keys causing sequential scans
-- on every join. The worst offenders are on the hot team_matches + team_match_submatches
-- query path which runs ~1100 times with 29ms average — totally avoidable.
--
-- Additionally, two RLS policies on team_rr_group_members use auth.uid() as an
-- InitPlan (re-evaluated per row instead of once per query), causing 10–100x
-- slowdown on any write to that table.
--
-- Safe to re-run: all statements are idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Unindexed foreign keys — highest impact ────────────────────────────────

-- team_matches: team FK lookups (used in every team match join)
CREATE INDEX IF NOT EXISTS idx_team_matches_team_a_id
  ON team_matches (team_a_id);

CREATE INDEX IF NOT EXISTS idx_team_matches_team_b_id
  ON team_matches (team_b_id);

CREATE INDEX IF NOT EXISTS idx_team_matches_winner_team_id
  ON team_matches (winner_team_id) WHERE winner_team_id IS NOT NULL;

-- team_match_submatches: player FK lookups
CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_a_player_id
  ON team_match_submatches (team_a_player_id) WHERE team_a_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_b_player_id
  ON team_match_submatches (team_b_player_id) WHERE team_b_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_a_player2_id
  ON team_match_submatches (team_a_player2_id) WHERE team_a_player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_match_submatches_team_b_player2_id
  ON team_match_submatches (team_b_player2_id) WHERE team_b_player2_id IS NOT NULL;

-- matches: player + winner FK lookups (hot path for all match queries)
CREATE INDEX IF NOT EXISTS idx_matches_player1_id
  ON matches (player1_id) WHERE player1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_player2_id
  ON matches (player2_id) WHERE player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_winner_id
  ON matches (winner_id) WHERE winner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_loser_next_match_id
  ON matches (loser_next_match_id) WHERE loser_next_match_id IS NOT NULL;

-- games: winner FK
CREATE INDEX IF NOT EXISTS idx_games_winner_id
  ON games (winner_id) WHERE winner_id IS NOT NULL;

-- championships + tournaments: created_by FK (used in every RLS check)
CREATE INDEX IF NOT EXISTS idx_championships_created_by
  ON championships (created_by);

CREATE INDEX IF NOT EXISTS idx_tournaments_created_by
  ON tournaments (created_by);

-- bracket_slots: player FK
CREATE INDEX IF NOT EXISTS idx_bracket_slots_player_id
  ON bracket_slots (player_id) WHERE player_id IS NOT NULL;

-- ── 2. Covering index for the hot team_matches query path ─────────────────────
-- The slug query in loadMatches fetches: tournament_id filter, round order,
-- team_a_id, team_b_id, status, group_id. This covering index eliminates
-- the heap fetch for all fields except the joined submatches.

CREATE INDEX IF NOT EXISTS idx_team_matches_covering
  ON team_matches (tournament_id, round)
  INCLUDE (team_a_id, team_b_id, status, team_a_score, team_b_score, winner_team_id, group_id);

-- ── 3. KO-only partial index — speeds up KO bracket queries ──────────────────
-- KO matches are always round >= 900 and group_id IS NULL. A partial index
-- makes the KO tab load dramatically faster for large tournaments.

CREATE INDEX IF NOT EXISTS idx_team_matches_ko_rounds
  ON team_matches (tournament_id, round)
  WHERE group_id IS NULL AND round >= 900;

-- ── 4. Group fixtures partial index ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_team_matches_group_fixtures
  ON team_matches (tournament_id, group_id, round)
  WHERE group_id IS NOT NULL;

-- ── 5. Fix RLS InitPlan anti-pattern on team_rr_group_members ────────────────
-- Current policies call auth.uid() inside a subquery that is re-evaluated
-- per row (InitPlan). Wrapping in a set-returning function forces evaluation
-- once per statement.

-- Helper function for owner check (evaluated once per statement, not per row)
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

-- Recreate the INSERT policy using the function
DROP POLICY IF EXISTS "team_rr_group_members_insert_owner" ON team_rr_group_members;
CREATE POLICY "team_rr_group_members_insert_owner"
  ON team_rr_group_members FOR INSERT
  WITH CHECK (team_rr_group_owner_check(group_id));

-- Recreate the DELETE policy using the function
DROP POLICY IF EXISTS "team_rr_group_members_delete_owner" ON team_rr_group_members;
CREATE POLICY "team_rr_group_members_delete_owner"
  ON team_rr_group_members FOR DELETE
  USING (team_rr_group_owner_check(group_id));

-- ── 6. Fix RLS InitPlan on audit_log ─────────────────────────────────────────
-- auth.uid() re-evaluated per row — rewrite using (select auth.uid())
DROP POLICY IF EXISTS "Authenticated users can insert audit entries" ON audit_log;
CREATE POLICY "Authenticated users can insert audit entries"
  ON audit_log FOR INSERT
  WITH CHECK (actor_id = (SELECT auth.uid()));

-- ── 7. Drop provably unused indexes to reduce write overhead ─────────────────
-- These were confirmed unused in the Supabase lint report.
-- Comment out any you're not sure about before running.

DROP INDEX IF EXISTS matches_status_updated_at_idx;
DROP INDEX IF EXISTS matches_updated_at_idx;
DROP INDEX IF EXISTS matches_bracket_side_idx;
DROP INDEX IF EXISTS matches_group_round_idx;       -- superseded by idx_team_matches_group_fixtures
DROP INDEX IF EXISTS team_matches_status_idx;       -- status not selectively queried standalone
DROP INDEX IF EXISTS teams_tournament_updated_at_idx;
-- audit_log indexes: drop if audit_log is not actively queried
-- DROP INDEX IF EXISTS audit_log_table_record_idx;
-- DROP INDEX IF EXISTS audit_log_actor_created_idx;
-- DROP INDEX IF EXISTS audit_log_created_at_idx;
-- DROP INDEX IF EXISTS idx_audit_log_actor;

-- ── 8. Analyze updated tables ────────────────────────────────────────────────
ANALYZE team_matches;
ANALYZE team_match_submatches;
ANALYZE matches;
ANALYZE games;
ANALYZE championships;
ANALYZE tournaments;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (run in reverse if needed)
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_team_matches_team_a_id;
-- DROP INDEX IF EXISTS idx_team_matches_team_b_id;
-- DROP INDEX IF EXISTS idx_team_matches_winner_team_id;
-- DROP INDEX IF EXISTS idx_team_match_submatches_team_a_player_id;
-- DROP INDEX IF EXISTS idx_team_match_submatches_team_b_player_id;
-- DROP INDEX IF EXISTS idx_team_match_submatches_team_a_player2_id;
-- DROP INDEX IF EXISTS idx_team_match_submatches_team_b_player2_id;
-- DROP INDEX IF EXISTS idx_matches_player1_id;
-- DROP INDEX IF EXISTS idx_matches_player2_id;
-- DROP INDEX IF EXISTS idx_matches_winner_id;
-- DROP INDEX IF EXISTS idx_matches_loser_next_match_id;
-- DROP INDEX IF EXISTS idx_games_winner_id;
-- DROP INDEX IF EXISTS idx_championships_created_by;
-- DROP INDEX IF EXISTS idx_tournaments_created_by;
-- DROP INDEX IF EXISTS idx_bracket_slots_player_id;
-- DROP INDEX IF EXISTS idx_team_matches_covering;
-- DROP INDEX IF EXISTS idx_team_matches_ko_rounds;
-- DROP INDEX IF EXISTS idx_team_matches_group_fixtures;
-- DROP FUNCTION IF EXISTS team_rr_group_owner_check(uuid);
