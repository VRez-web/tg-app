-- Supabase SQL Editor. Session pooler URI → DATABASE_URL (порт 5432, IPv4).

create extension if not exists pgcrypto;

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  category text not null check (category in ('apartments', 'other')),
  created_at timestamptz not null default now(),
  last_parsed_at timestamptz,
  last_error text,
  last_count int not null default 0,
  unique (url, category)
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_id text,
  url text not null,
  category text not null check (category in ('apartments', 'other')),
  title text not null,
  rooms int,
  area_m2 numeric,
  price_byn numeric,
  image text,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_parsed_at timestamptz not null default now()
);

alter table listings add column if not exists first_seen_at timestamptz;

create unique index if not exists listings_external_id_uidx
  on listings (external_id) where external_id is not null;
create index if not exists listings_source_id_idx on listings (source_id);
create index if not exists listings_category_active_idx on listings (category, active);

create table if not exists snapshots (
  listing_id uuid not null references listings(id) on delete cascade,
  date date not null,
  price_byn numeric,
  rooms int,
  area_m2 numeric,
  category text not null check (category in ('apartments', 'other')),
  primary key (listing_id, date)
);

create index if not exists snapshots_date_idx on snapshots (date);
create index if not exists snapshots_category_date_idx on snapshots (category, date);

create table if not exists parse_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'manual' check (trigger in ('cron', 'manual')),
  category text check (category in ('apartments', 'other')),
  parsed_count int not null default 0,
  added_count int not null default 0,
  updated_count int not null default 0,
  removed_count int not null default 0,
  error text
);

create table if not exists parse_changes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references parse_runs(id) on delete cascade,
  listing_id uuid,
  action text not null check (action in ('added', 'updated', 'removed')),
  title text,
  url text,
  old_price_byn numeric,
  new_price_byn numeric,
  old_title text,
  new_title text,
  old_rooms int,
  new_rooms int,
  old_area_m2 numeric,
  new_area_m2 numeric
);

create index if not exists parse_runs_started_at_idx on parse_runs (started_at desc);
create index if not exists parse_changes_run_id_idx on parse_changes (run_id);
create index if not exists parse_changes_listing_id_idx on parse_changes (listing_id);

create table if not exists listing_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  price_byn numeric,
  rooms int,
  area_m2 numeric,
  title text
);

create index if not exists listing_history_listing_idx on listing_history (listing_id, recorded_at);

update listings
set first_seen_at = coalesce(
  first_seen_at,
  (select min(date)::timestamptz from snapshots s where s.listing_id = listings.id),
  last_parsed_at,
  now()
)
where first_seen_at is null;

insert into listing_history (listing_id, recorded_at, price_byn, rooms, area_m2, title)
select s.listing_id, s.date::timestamptz, s.price_byn, s.rooms, s.area_m2, l.title
from snapshots s
join listings l on l.id = s.listing_id
where not exists (
  select 1 from listing_history h
  where h.listing_id = s.listing_id and h.recorded_at::date = s.date
);
