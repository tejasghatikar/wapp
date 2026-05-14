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
  status text default 'want_to_go',
  visited_notes text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

-- Idempotently add the new columns to existing deployments.
alter table bitelist_users add column if not exists pending_friend_link_notify_owner_ids uuid[] not null default '{}';
alter table bitelist_users add column if not exists quiet_mode boolean not null default false;

alter table bitelist_saves add column if not exists status text default 'want_to_go';
alter table bitelist_saves add column if not exists visited_notes text;
alter table bitelist_saves add column if not exists google_photo_url text;

do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'bitelist_saves' and constraint_name = 'bitelist_saves_status_check'
  ) then
    alter table bitelist_saves
      add constraint bitelist_saves_status_check
      check (status in ('want_to_go', 'been_there'));
  end if;
end $$;

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

create table if not exists bitelist_pending_status (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references bitelist_users(id) on delete cascade,
  save_id uuid references bitelist_saves(id) on delete cascade,
  expires_at timestamptz default (now() + interval '15 minutes'),
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_pending_status_user_created
  on bitelist_pending_status(user_id, created_at desc);

create table if not exists bitelist_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references bitelist_users(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_events_user_type_created
  on bitelist_events(user_id, event_type, created_at desc);

-- ── Phase 2: Friends graph + compare sessions ─────────────────────────────
--
-- bitelist_friend_requests: legacy table. The app does not read or write it
-- after the instant "friend <share_slug>" linking flow (see bitelist-phase2-
-- friends-webapp.md). Existing databases may still have this table; new rows
-- are never inserted by current code. Optional removal:
--   bitelist/sql/optional-drop-friend-requests.sql

create table if not exists bitelist_friend_requests (
  id uuid primary key default uuid_generate_v4(),
  requester_id uuid references bitelist_users(id) on delete cascade,
  recipient_id uuid references bitelist_users(id) on delete cascade,
  status text default 'pending',
  created_at timestamptz default now(),
  unique(requester_id, recipient_id)
);

do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'bitelist_friend_requests'
      and constraint_name = 'bitelist_friend_requests_status_check'
  ) then
    alter table bitelist_friend_requests
      add constraint bitelist_friend_requests_status_check
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end $$;

create table if not exists bitelist_friendships (
  id uuid primary key default uuid_generate_v4(),
  user_a_id uuid references bitelist_users(id) on delete cascade,
  user_b_id uuid references bitelist_users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_a_id, user_b_id)
);

create index if not exists idx_bitelist_friendships_a
  on bitelist_friendships(user_a_id);

create index if not exists idx_bitelist_friendships_b
  on bitelist_friendships(user_b_id);

-- Friend save activity: one row per (recipient, friend, Kolkata calendar day).
-- Cron sends one WhatsApp digest per recipient per day, then sets digest_sent_at.
create table if not exists bitelist_friend_activity_digest (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references bitelist_users(id) on delete cascade,
  source_friend_id uuid not null references bitelist_users(id) on delete cascade,
  activity_date date not null,
  places jsonb not null default '[]',
  digest_sent_at timestamptz,
  created_at timestamptz default now(),
  unique(recipient_id, source_friend_id, activity_date)
);

create index if not exists idx_friend_activity_digest_pending
  on bitelist_friend_activity_digest(activity_date, digest_sent_at);

create table if not exists bitelist_compare_sessions (
  id uuid primary key default uuid_generate_v4(),
  slug_a text not null references bitelist_users(share_slug),
  slug_b text not null references bitelist_users(share_slug),
  created_at timestamptz default now()
);

create index if not exists idx_bitelist_compare_sessions_created
  on bitelist_compare_sessions(created_at desc);

-- Places both users saved (ordered by user A's rating).
create or replace function bitelist_mutual_saves(user_a uuid, user_b uuid)
returns table (
  id uuid,
  restaurant_name text,
  area text,
  google_rating numeric,
  price_level int,
  cuisine_tags text[],
  google_maps_url text
)
language sql stable as $$
  select s1.id, s1.restaurant_name, s1.area, s1.google_rating,
         s1.price_level, s1.cuisine_tags, s1.google_maps_url
  from bitelist_saves s1
  join bitelist_saves s2 on s2.google_place_id = s1.google_place_id
  where s1.user_id = user_a
    and s2.user_id = user_b
    and s1.deleted_at is null
    and s2.deleted_at is null
    and s1.google_place_id is not null
  order by coalesce(s1.google_rating, 0) desc
  limit 10;
$$;

-- Places friend has saved that `me` hasn't (by google_place_id).
create or replace function bitelist_new_for_user(me uuid, friend uuid)
returns table (
  id uuid,
  restaurant_name text,
  area text,
  google_rating numeric,
  price_level int,
  cuisine_tags text[],
  google_maps_url text
)
language sql stable as $$
  select s.id, s.restaurant_name, s.area, s.google_rating,
         s.price_level, s.cuisine_tags, s.google_maps_url
  from bitelist_saves s
  where s.user_id = friend
    and s.deleted_at is null
    and s.google_place_id is not null
    and not exists (
      select 1 from bitelist_saves s2
      where s2.user_id = me
        and s2.google_place_id = s.google_place_id
        and s2.deleted_at is null
    )
  order by coalesce(s.google_rating, 0) desc
  limit 10;
$$;

-- Force Supabase/PostgREST to refresh its schema cache after creating tables.
notify pgrst, 'reload schema';
