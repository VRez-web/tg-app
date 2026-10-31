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
  last_parsed_at timestamptz not null default now()
);

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
