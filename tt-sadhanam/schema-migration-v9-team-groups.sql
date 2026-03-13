-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration v9: Team Groups + Knockout (Corbillon & Swaythling)
-- Run this in Supabase SQL Editor ONCE.
-- Safe to re-run: all statements are idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. New format type enum values ──────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_group_corbillon';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE tournament_format_type ADD VALUE IF NOT EXISTS 'team_group_swaythling';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── 2. team_rr_group_members ────────────────────────────────────────────────
-- Maps teams into rr_groups (mirrors rr_group_members for players).

CREATE TABLE IF NOT EXISTS team_rr_group_members (
  group_id UUID NOT NULL REFERENCES rr_groups(id)  ON DELETE CASCADE,
  team_id  UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
  PRIMARY KEY (group_id, team_id)
);

CREATE INDEX IF NOT EXISTS team_rr_group_members_group_id_idx ON team_rr_group_members (group_id);
CREATE INDEX IF NOT EXISTS team_rr_group_members_team_id_idx  ON team_rr_group_members (team_id);

-- ── 3. group_id on team_matches ─────────────────────────────────────────────
-- RR team fixtures carry a group_id; KO matches leave it NULL.

ALTER TABLE team_matches
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES rr_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_matches_group_id_idx
  ON team_matches (group_id) WHERE group_id IS NOT NULL;

-- ── 4. RLS on new table ──────────────────────────────────────────────────────
ALTER TABLE team_rr_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_rr_group_members_select_public"  ON team_rr_group_members;
DROP POLICY IF EXISTS "team_rr_group_members_insert_owner"   ON team_rr_group_members;
DROP POLICY IF EXISTS "team_rr_group_members_delete_owner"   ON team_rr_group_members;

CREATE POLICY "team_rr_group_members_select_public"
  ON team_rr_group_members FOR SELECT USING (true);

CREATE POLICY "team_rr_group_members_insert_owner"
  ON team_rr_group_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rr_groups g
      JOIN stages s ON s.id = g.stage_id
      JOIN tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = auth.uid()
    )
  );

CREATE POLICY "team_rr_group_members_delete_owner"
  ON team_rr_group_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM rr_groups g
      JOIN stages s ON s.id = g.stage_id
      JOIN tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = auth.uid()
    )
  );
