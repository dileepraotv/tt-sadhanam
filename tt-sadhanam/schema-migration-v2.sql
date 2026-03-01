-- =============================================================================
-- SADHANAM v2 MIGRATION — Run this if you already have a tournaments table
-- =============================================================================
-- Paste into Supabase SQL Editor → Run. Safe to run multiple times.
-- =============================================================================

-- 1. Championships table
create table if not exists championships (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  location    text,
  year        integer,
  start_date  date,
  end_date    date,
  published   boolean     not null default false,
  created_by  uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Add the missing column to your existing tournaments table
alter table tournaments
  add column if not exists championship_id uuid references championships(id) on delete cascade;

create index if not exists tournaments_championship_id_idx
  on tournaments (championship_id);

-- 3. RLS
alter table championships enable row level security;

do $$ begin
  create policy "Championships select" on championships for select
    using (published = true or auth.uid() = created_by);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Championships write" on championships for all
    using (auth.uid() = created_by);
exception when duplicate_object then null; end $$;

-- 4. updated_at trigger
create or replace function set_championships_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ begin
  create trigger championships_updated_at before update on championships
    for each row execute function set_championships_updated_at();
exception when duplicate_object then null; end $$;

-- Done. Existing tournaments are unaffected (championship_id will be null).
