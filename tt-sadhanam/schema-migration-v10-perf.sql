-- ─────────────────────────────────────────────────────────────────────────────
-- Migration v10: Performance — indexes + games.tournament_id denormalization
--
-- WHY THIS MIGRATION?
--
-- 1. MISSING INDEXES
--    Several hot query paths were doing sequential scans on tables with no
--    covering index for the filter columns used in the most-accessed queries.
--
-- 2. games.tournament_id DENORMALIZATION
--    The Supabase Realtime subscription for the `games` table cannot use a
--    server-side filter because games only store match_id, not tournament_id.
--    This means every game change across the entire database is delivered over
--    the wire to every connected viewer, with filtering done client-side.
--
--    Adding a denormalized tournament_id column (populated via trigger) lets
--    the Realtime subscription use:
--        filter: `tournament_id=eq.<id>`
--    This drops WAL fan-out from O(all_games) to O(this_tournament_games),
--    which dramatically reduces the load on realtime.list_changes.
--
-- ROLLBACK: see bottom of file.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Core query indexes ─────────────────────────────────────────────────────

-- matches: the most-queried filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_tournament_id
  ON matches (tournament_id);

-- matches: public page orders by round + match_number
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_tournament_round
  ON matches (tournament_id, round, match_number);

-- matches: status filter used by admin dashboards and realtime guards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_tournament_status
  ON matches (tournament_id, status);

-- games: primary join path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_match_id
  ON games (match_id);

-- team_matches: fixture list filter + ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_matches_tournament_round
  ON team_matches (tournament_id, round);

-- team_match_submatches: join from team_match_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_match_submatches_team_match_id
  ON team_match_submatches (team_match_id);

-- team_match_submatches: join from scoring match
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_match_submatches_match_id
  ON team_match_submatches (match_id);

-- rr_groups: stage lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rr_groups_stage_id
  ON rr_groups (stage_id);

-- rr_group_members / team_rr_group_members: group lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rr_group_members_group_id
  ON rr_group_members (group_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_rr_group_members_group_id
  ON team_rr_group_members (group_id);

-- stages: tournament + stage_number lookup (used in getTeamGroupStageData)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stages_tournament_stage_number
  ON stages (tournament_id, stage_number);

-- ── 2. games.tournament_id — denormalized column for Realtime filtering ────────

-- Add the column (nullable; backfilled below)
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS tournament_id uuid REFERENCES tournaments(id) ON DELETE CASCADE;

-- Backfill existing rows
UPDATE games g
SET    tournament_id = m.tournament_id
FROM   matches m
WHERE  g.match_id = m.id
  AND  g.tournament_id IS NULL;

-- Index for Realtime filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_tournament_id
  ON games (tournament_id);

-- Trigger: keep tournament_id in sync on INSERT (no UPDATEs change match_id)
CREATE OR REPLACE FUNCTION games_set_tournament_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT tournament_id INTO NEW.tournament_id
  FROM   matches
  WHERE  id = NEW.match_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_games_set_tournament_id ON games;

CREATE TRIGGER trg_games_set_tournament_id
  BEFORE INSERT ON games
  FOR EACH ROW
  EXECUTE FUNCTION games_set_tournament_id();

-- ── 3. Update the Realtime subscription in code ───────────────────────────────
-- After running this migration, update useRealtimeTournament.ts LISTENER 2
-- to add a server-side filter:
--
--   channel.on('postgres_changes', {
--     event:  '*',
--     schema: 'public',
--     table:  'games',
--     filter: `tournament_id=eq.${tournament.id}`,   // ← ADD THIS LINE
--   }, ...)
--
-- This eliminates the client-side matchIds.has() guard (which can be removed
-- once you're confident the migration is applied everywhere).

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP TRIGGER  IF EXISTS trg_games_set_tournament_id ON games;
-- DROP FUNCTION IF EXISTS games_set_tournament_id();
-- DROP INDEX    IF EXISTS idx_games_tournament_id;
-- ALTER TABLE games DROP COLUMN IF EXISTS tournament_id;
-- DROP INDEX IF EXISTS idx_matches_tournament_id;
-- DROP INDEX IF EXISTS idx_matches_tournament_round;
-- DROP INDEX IF EXISTS idx_matches_tournament_status;
-- DROP INDEX IF EXISTS idx_games_match_id;
-- DROP INDEX IF EXISTS idx_team_matches_tournament_round;
-- DROP INDEX IF EXISTS idx_team_match_submatches_team_match_id;
-- DROP INDEX IF EXISTS idx_team_match_submatches_match_id;
-- DROP INDEX IF EXISTS idx_rr_groups_stage_id;
-- DROP INDEX IF EXISTS idx_rr_group_members_group_id;
-- DROP INDEX IF EXISTS idx_team_rr_group_members_group_id;
-- DROP INDEX IF EXISTS idx_stages_tournament_stage_number;
