-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration v7: per-match format override
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- What this adds:
--   • match_format column on matches table (bo3 / bo5 / bo7 per match)
--   • Allows admin to change the format per match without touching the event
--
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Add match_format column
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_format TEXT
    CHECK (match_format IN ('bo3','bo5','bo7'));

-- 2. Verify (should return 1 row)
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'matches' AND column_name = 'match_format';
