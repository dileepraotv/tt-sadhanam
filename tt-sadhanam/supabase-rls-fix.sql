-- ============================================================================
-- supabase-rls-fix.sql
--
-- Fixes two categories of Supabase advisor warnings:
--
-- 1. auth_rls_initplan  — Replace auth.uid() with (select auth.uid()) in every
--    RLS policy so Postgres evaluates the function ONCE per query rather than
--    once per row. This can be 10–100× faster on large tables.
--
-- 2. multiple_permissive_policies — Drop the redundant broad "select/write"
--    policies that were added alongside the original specific policies.
--    Keeping both causes Postgres to evaluate both for every row (OR logic),
--    doubling unnecessary work.
--
-- HOW TO APPLY:
--   Paste into the Supabase SQL editor (Dashboard → SQL editor → New query)
--   and run. No data is modified — only policy definitions change.
-- ============================================================================

-- ============================================================================
-- STEP 1 — Drop the redundant broad policies (multiple_permissive_policies fix)
-- ============================================================================

DROP POLICY IF EXISTS "Tournaments select" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments write"  ON public.tournaments;

DROP POLICY IF EXISTS "Players select" ON public.players;
DROP POLICY IF EXISTS "Players write"  ON public.players;

DROP POLICY IF EXISTS "Matches select" ON public.matches;
DROP POLICY IF EXISTS "Matches write"  ON public.matches;

DROP POLICY IF EXISTS "Games select" ON public.games;
DROP POLICY IF EXISTS "Games write"  ON public.games;

DROP POLICY IF EXISTS "Slots select" ON public.bracket_slots;
DROP POLICY IF EXISTS "Slots write"  ON public.bracket_slots;

DROP POLICY IF EXISTS "Championships select" ON public.championships;
DROP POLICY IF EXISTS "Championships write"  ON public.championships;

DROP POLICY IF EXISTS "Stages select" ON public.stages;
DROP POLICY IF EXISTS "Stages write"  ON public.stages;

DROP POLICY IF EXISTS "RR groups select" ON public.rr_groups;
DROP POLICY IF EXISTS "RR groups write"  ON public.rr_groups;

DROP POLICY IF EXISTS "RR members select" ON public.rr_group_members;
DROP POLICY IF EXISTS "RR members write"  ON public.rr_group_members;

-- ============================================================================
-- STEP 2 — Recreate all specific policies with (select auth.uid())
-- Each table gets:
--   • A PUBLIC SELECT  — anyone can read published/active data
--   • An OWNER SELECT  — creator can always read their own data (even unpublished)
--   • Write policies   — only creator can mutate
-- ============================================================================

-- ── tournaments ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view published tournaments" ON public.tournaments;
CREATE POLICY "Public can view published tournaments"
  ON public.tournaments FOR SELECT
  USING (published = true);

DROP POLICY IF EXISTS "Owner can read own tournaments" ON public.tournaments;
CREATE POLICY "Owner can read own tournaments"
  ON public.tournaments FOR SELECT
  USING ((select auth.uid()) = created_by);

DROP POLICY IF EXISTS "Authenticated users can create tournaments" ON public.tournaments;
CREATE POLICY "Authenticated users can create tournaments"
  ON public.tournaments FOR INSERT
  WITH CHECK ((select auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Owner can update own tournaments" ON public.tournaments;
CREATE POLICY "Owner can update own tournaments"
  ON public.tournaments FOR UPDATE
  USING ((select auth.uid()) = created_by);

DROP POLICY IF EXISTS "Owner can delete own tournaments" ON public.tournaments;
CREATE POLICY "Owner can delete own tournaments"
  ON public.tournaments FOR DELETE
  USING ((select auth.uid()) = created_by);

-- ── players ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view players of published tournaments" ON public.players;
CREATE POLICY "Public can view players of published tournaments"
  ON public.players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = players.tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own players" ON public.players;
CREATE POLICY "Owner can view own players"
  ON public.players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = players.tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can insert players" ON public.players;
CREATE POLICY "Owner can insert players"
  ON public.players FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can update players" ON public.players;
CREATE POLICY "Owner can update players"
  ON public.players FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can delete players" ON public.players;
CREATE POLICY "Owner can delete players"
  ON public.players FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

-- ── matches ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view matches of published tournaments" ON public.matches;
CREATE POLICY "Public can view matches of published tournaments"
  ON public.matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own matches" ON public.matches;
CREATE POLICY "Owner can view own matches"
  ON public.matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can manage matches" ON public.matches;
CREATE POLICY "Owner can manage matches"
  ON public.matches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

-- ── games ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view games of published tournaments" ON public.games;
CREATE POLICY "Public can view games of published tournaments"
  ON public.games FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = games.match_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own games" ON public.games;
CREATE POLICY "Owner can view own games"
  ON public.games FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = games.match_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can manage games" ON public.games;
CREATE POLICY "Owner can manage games"
  ON public.games FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.id = match_id AND t.created_by = (select auth.uid())
    )
  );

-- ── bracket_slots ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view bracket slots of published tournaments" ON public.bracket_slots;
CREATE POLICY "Public can view bracket slots of published tournaments"
  ON public.bracket_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = bracket_slots.tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own bracket slots" ON public.bracket_slots;
CREATE POLICY "Owner can view own bracket slots"
  ON public.bracket_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = bracket_slots.tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can manage bracket slots" ON public.bracket_slots;
CREATE POLICY "Owner can manage bracket slots"
  ON public.bracket_slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

-- ── championships ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Owner can manage championships" ON public.championships;
CREATE POLICY "Owner can manage championships"
  ON public.championships FOR ALL
  USING ((select auth.uid()) = created_by);

DROP POLICY IF EXISTS "Public can view published championships" ON public.championships;
CREATE POLICY "Public can view published championships"
  ON public.championships FOR SELECT
  USING (published = true);

-- ── stages ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Owner can manage stages" ON public.stages;
CREATE POLICY "Owner can manage stages"
  ON public.stages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Public can view stages" ON public.stages;
CREATE POLICY "Public can view stages"
  ON public.stages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own stages" ON public.stages;
CREATE POLICY "Owner can view own stages"
  ON public.stages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.created_by = (select auth.uid())
    )
  );

-- ── rr_groups ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Owner can manage rr_groups" ON public.rr_groups;
CREATE POLICY "Owner can manage rr_groups"
  ON public.rr_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Public can view rr_groups" ON public.rr_groups;
CREATE POLICY "Public can view rr_groups"
  ON public.rr_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own rr_groups" ON public.rr_groups;
CREATE POLICY "Owner can view own rr_groups"
  ON public.rr_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.stages s
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE s.id = stage_id AND t.created_by = (select auth.uid())
    )
  );

-- ── rr_group_members ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Owner can manage rr_group_members" ON public.rr_group_members;
CREATE POLICY "Owner can manage rr_group_members"
  ON public.rr_group_members FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Public can view rr_group_members" ON public.rr_group_members;
CREATE POLICY "Public can view rr_group_members"
  ON public.rr_group_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.published = true
    )
  );

DROP POLICY IF EXISTS "Owner can view own rr_group_members" ON public.rr_group_members;
CREATE POLICY "Owner can view own rr_group_members"
  ON public.rr_group_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.rr_groups g
      JOIN public.stages s ON s.id = g.stage_id
      JOIN public.tournaments t ON t.id = s.tournament_id
      WHERE g.id = group_id AND t.created_by = (select auth.uid())
    )
  );

-- ── audit_log ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can read own audit entries" ON public.audit_log;
CREATE POLICY "Users can read own audit entries"
  ON public.audit_log FOR SELECT
  USING ((select auth.uid()) = actor_id);

-- ============================================================================
-- Done. Re-run the Supabase linter to confirm zero warnings.
-- ============================================================================
