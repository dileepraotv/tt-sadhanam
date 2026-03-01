-- =============================================================================
-- SADHANAM v4 Migration — Excel Player Import support
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- =============================================================================

-- Add preferred_group to players table.
-- Stores the group letter (as 1-based number: 1=A, 2=B, …) that was
-- specified in the Excel upload. generateGroups() honours this before
-- snake-seeding the remaining players.
alter table players
  add column if not exists preferred_group smallint
    check (preferred_group between 1 and 26);

comment on column players.preferred_group is
  'Optional group preference from Excel upload (1=Group A, 2=Group B, …). '
  'Used by generateGroups() to place the player into their designated group '
  'before remaining slots are filled by snake-seeding.';
