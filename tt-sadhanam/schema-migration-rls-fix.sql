-- ============================================================
-- RLS Performance Fix Migration
-- 
-- Fixes two categories of Supabase Linter warnings:
--
-- 1. auth_rls_initplan — replace auth.uid() with (select auth.uid())
--    so Postgres evaluates it once per query, not once per row.
--
-- 2. multiple_permissive_policies — drop old legacy per-action policies
--    that duplicate the consolidated "select"/"write" policies added later.
--    Having multiple PERMISSIVE policies for the same role+action means
--    Postgres evaluates ALL of them for every row.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- STEP 1: Drop redundant legacy policies
-- (These were superseded by the consolidated "select"/"write" policies)
-- ──────────────────────────────────────────────────────────────

-- tournaments — legacy per-action policies
DROP POLICY IF EXISTS "Owner can read own tournaments"     ON public.tournaments;
DROP POLICY IF EXISTS "Authenticated users can create tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Owner can update own tournaments"  ON public.tournaments;
DROP POLICY IF EXISTS "Owner can delete own tournaments"  ON public.tournaments;
DROP POLICY IF EXISTS "Public can view published tournaments"      ON public.tournaments;

-- players — legacy per-action policies
DROP POLICY IF EXISTS "Public can view players of published tournaments" ON public.players;
DROP POLICY IF EXISTS "Owner can insert players"          ON public.players;
DROP POLICY IF EXISTS "Owner can update players"          ON public.players;
DROP POLICY IF EXISTS "Owner can delete players"          ON public.players;

-- matches — legacy per-action policies
DROP POLICY IF EXISTS "Public can view matches of published tournaments" ON public.matches;
DROP POLICY IF EXISTS "Owner can manage matches"          ON public.matches;

-- games — legacy per-action policies
DROP POLICY IF EXISTS "Public can view games of published tournaments" ON public.games;
DROP POLICY IF EXISTS "Owner can manage games"            ON public.games;

-- bracket_slots — legacy per-action policies
DROP POLICY IF EXISTS "Public can view bracket slots of published tournaments" ON public.bracket_slots;
DROP POLICY IF EXISTS "Owner can manage bracket slots"    ON public.bracket_slots;

-- audit_log — legacy per-action policies
DROP POLICY IF EXISTS "Users can read own audit entries"               ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit entries"   ON public.audit_log;


-- ──────────────────────────────────────────────────────────────
-- STEP 2: Drop and recreate the consolidated policies with
-- (select auth.uid()) to avoid per-row re-evaluation
-- ──────────────────────────────────────────────────────────────

-- ── championships ────────────────────────────────────────────
DROP POLICY IF EXISTS "Championships select" ON public.championships;
DROP POLICY IF EXISTS "Championships write"  ON public.championships;

CREATE POLICY "Championships select" ON public.championships
  FOR SELECT USING (
    published = true
    OR (select auth.uid()) = created_by
  );

CREATE POLICY "Championships write" ON public.championships
  FOR ALL USING ((select auth.uid()) = created_by)
  WITH CHECK ((select auth.uid()) = created_by);


-- ── tournaments ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Tournaments select" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments write"  ON public.tournaments;

CREATE POLICY "Tournaments select" ON public.tournaments
  FOR SELECT USING (
    published = true
    OR (select auth.uid()) = created_by
  );

CREATE POLICY "Tournaments write" ON public.tournaments
  FOR ALL USING ((select auth.uid()) = created_by)
  WITH CHECK ((select auth.uid()) = created_by);


-- ── players ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Players select" ON public.players;
DROP POLICY IF EXISTS "Players write"  ON public.players;

CREATE POLICY "Players select" ON public.players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "Players write" ON public.players
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );


-- ── matches ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Matches select" ON public.matches;
DROP POLICY IF EXISTS "Matches write"  ON public.matches;

CREATE POLICY "Matches select" ON public.matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "Matches write" ON public.matches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );


-- ── games ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Games select" ON public.games;
DROP POLICY IF EXISTS "Games write"  ON public.games;

CREATE POLICY "Games select" ON public.games
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = match_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "Games write" ON public.games
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = match_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = match_id AND t.created_by = (select auth.uid())
    )
  );


-- ── stages ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Stages select" ON public.stages;
DROP POLICY IF EXISTS "Stages write"  ON public.stages;

CREATE POLICY "Stages select" ON public.stages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "Stages write" ON public.stages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );


-- ── rr_groups ────────────────────────────────────────────────
DROP POLICY IF EXISTS "RR groups select" ON public.rr_groups;
DROP POLICY IF EXISTS "RR groups write"  ON public.rr_groups;

CREATE POLICY "RR groups select" ON public.rr_groups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "RR groups write" ON public.rr_groups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id AND t.created_by = (select auth.uid())
    )
  );


-- ── rr_group_members ─────────────────────────────────────────
DROP POLICY IF EXISTS "RR members select" ON public.rr_group_members;
DROP POLICY IF EXISTS "RR members write"  ON public.rr_group_members;

CREATE POLICY "RR members select" ON public.rr_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "RR members write" ON public.rr_group_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = (select auth.uid())
    )
  );


-- ── bracket_slots ────────────────────────────────────────────
DROP POLICY IF EXISTS "Slots select" ON public.bracket_slots;
DROP POLICY IF EXISTS "Slots write"  ON public.bracket_slots;

CREATE POLICY "Slots select" ON public.bracket_slots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id
      AND (t.published = true OR t.created_by = (select auth.uid()))
    )
  );

CREATE POLICY "Slots write" ON public.bracket_slots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );


-- ── audit_log ────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_log select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log write"  ON public.audit_log;

CREATE POLICY "audit_log select" ON public.audit_log
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "audit_log write" ON public.audit_log
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
