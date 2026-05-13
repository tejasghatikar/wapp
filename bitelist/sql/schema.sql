-- BiteList bot tables (isolated from existing app tables)
create extension if not exists "uuid-ossp";

create table if not exists bitelist_users (
  id uuid primary key default uuid_generate_v4(),
  whatsapp_number text unique not null,
  display_name text,
  share_slug text unique,
  onboarded_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists bitelist_saves (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references bitelist_users(id) on delete cascade,
  restaurant_name text not null,
  google_place_id text,
  area text,
  city text default 'Bangalore',
  google_rating numeric(2,1),
  price_level int,
  cuisine_tags text[] default '{}',
  source_type text,
  source_url text,
  notes text,
  google_maps_url text,
  latitude double precision,
  longitude double precision,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_saves_user_area
  on bitelist_saves(user_id, area)
  where deleted_at is null;

create index if not exists idx_bitelist_saves_user_created
  on bitelist_saves(user_id, created_at desc)
  where deleted_at is null;

create unique index if not exists idx_bitelist_saves_user_place
  on bitelist_saves(user_id, google_place_id)
  where deleted_at is null and google_place_id is not null;

create table if not exists bitelist_pending_saves (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references bitelist_users(id) on delete cascade,
  candidates jsonb not null,
  source_url text,
  source_type text,
  expires_at timestamptz default (now() + interval '10 minutes'),
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_pending_user_created
  on bitelist_pending_saves(user_id, created_at desc);

create table if not exists bitelist_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references bitelist_users(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_events_user_type_created
  on bitelist_events(user_id, event_type, created_at desc);

-- Force Supabase/PostgREST to refresh its schema cache after creating tables.
notify pgrst, 'reload schema';
