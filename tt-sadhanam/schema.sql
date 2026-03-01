-- =============================================================================
-- SADHANAM v2 — Table Tennis Tournament Manager
-- Full Database Schema (Championships + Events + Matches)
-- =============================================================================
-- Paste into Supabase SQL Editor and click Run. Safe to run multiple times.
-- =============================================================================

create extension if not exists "pgcrypto";

do $$ begin create type tournament_status as enum ('setup','active','complete');
exception when duplicate_object then null; end $$;
do $$ begin create type match_status as enum ('pending','live','complete','bye');
exception when duplicate_object then null; end $$;
do $$ begin create type match_format as enum ('bo3','bo5','bo7');
exception when duplicate_object then null; end $$;

-- ── championships ─────────────────────────────────────────────────────────────
-- Top-level container: "National Championships 2026", "State Ranking – Chennai"
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

-- ── tournaments / events ──────────────────────────────────────────────────────
-- Each row is one draw/category: "Under 13 Boys", "Men's Singles", etc.
-- championship_id is nullable so legacy standalone tournaments still work.
create table if not exists tournaments (
  id                uuid              primary key default gen_random_uuid(),
  name              text              not null,
  description       text,
  location          text,
  date              date,
  format            match_format      not null default 'bo5',
  status            tournament_status not null default 'setup',
  published         boolean           not null default false,
  bracket_generated boolean           not null default false,
  championship_id   uuid              references championships(id) on delete cascade,
  created_by        uuid              not null references auth.users(id) on delete cascade,
  created_at        timestamptz       not null default now(),
  updated_at        timestamptz       not null default now()
);
create index if not exists tournaments_championship_id_idx on tournaments(championship_id);

-- ── players ───────────────────────────────────────────────────────────────────
create table if not exists players (
  id            uuid        primary key default gen_random_uuid(),
  tournament_id uuid        not null references tournaments(id) on delete cascade,
  name          text        not null,
  club          text,
  country_code  char(3),
  seed          smallint    check (seed between 1 and 64),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists players_tournament_seed_unique
  on players (tournament_id, seed) where seed is not null;

-- ── bracket_slots ─────────────────────────────────────────────────────────────
create table if not exists bracket_slots (
  id            uuid        primary key default gen_random_uuid(),
  tournament_id uuid        not null references tournaments(id) on delete cascade,
  slot_number   integer     not null,
  player_id     uuid        references players(id) on delete set null,
  is_bye        boolean     not null default false,
  created_at    timestamptz not null default now(),
  unique (tournament_id, slot_number)
);

-- ── matches ───────────────────────────────────────────────────────────────────
create table if not exists matches (
  id            uuid         primary key default gen_random_uuid(),
  tournament_id uuid         not null references tournaments(id) on delete cascade,
  round         integer      not null,
  match_number  integer      not null,
  player1_id    uuid         references players(id) on delete set null,
  player2_id    uuid         references players(id) on delete set null,
  player1_games integer      not null default 0,
  player2_games integer      not null default 0,
  winner_id     uuid         references players(id) on delete set null,
  status        match_status not null default 'pending',
  next_match_id uuid         references matches(id) on delete set null,
  next_slot     smallint     check (next_slot in (1,2)),
  round_name    text,
  court         text,
  scheduled_at  timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  unique (tournament_id, round, match_number)
);

-- ── games ─────────────────────────────────────────────────────────────────────
create table if not exists games (
  id          uuid        primary key default gen_random_uuid(),
  match_id    uuid        not null references matches(id) on delete cascade,
  game_number integer     not null,
  score1      integer     check (score1 >= 0),
  score2      integer     check (score2 >= 0),
  winner_id   uuid        references players(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (match_id, game_number)
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table championships enable row level security;
alter table tournaments    enable row level security;
alter table players        enable row level security;
alter table bracket_slots  enable row level security;
alter table matches        enable row level security;
alter table games          enable row level security;

do $$ begin
  create policy "Championships select" on championships for select
    using (published = true or auth.uid() = created_by);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Championships write" on championships for all
    using (auth.uid() = created_by);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Tournaments select" on tournaments for select
    using (published = true or auth.uid() = created_by
      or championship_id in (select id from championships where published=true));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Tournaments write" on tournaments for all
    using (auth.uid() = created_by);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Players select" on players for select
    using (tournament_id in (
      select id from tournaments where published=true or auth.uid()=created_by));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Players write" on players for all
    using (tournament_id in (
      select id from tournaments where auth.uid()=created_by));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Slots select" on bracket_slots for select
    using (tournament_id in (
      select id from tournaments where published=true or auth.uid()=created_by));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Slots write" on bracket_slots for all
    using (tournament_id in (
      select id from tournaments where auth.uid()=created_by));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Matches select" on matches for select
    using (tournament_id in (
      select id from tournaments where published=true or auth.uid()=created_by));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Matches write" on matches for all
    using (tournament_id in (
      select id from tournaments where auth.uid()=created_by));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Games select" on games for select
    using (match_id in (
      select m.id from matches m join tournaments t on t.id=m.tournament_id
      where t.published=true or auth.uid()=t.created_by));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Games write" on games for all
    using (match_id in (
      select m.id from matches m join tournaments t on t.id=m.tournament_id
      where auth.uid()=t.created_by));
exception when duplicate_object then null; end $$;

-- =============================================================================
-- REALTIME
-- =============================================================================
do $$ begin alter publication supabase_realtime add table matches;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table games;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table tournaments;
exception when duplicate_object then null; end $$;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ begin
  create trigger championships_updated_at before update on championships
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger tournaments_updated_at before update on tournaments
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger matches_updated_at before update on matches
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger games_updated_at before update on games
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
