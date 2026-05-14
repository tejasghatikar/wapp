-- BiteList — Admin: remove a user safely (Supabase SQL Editor or psql)
--
-- WHY THIS EXISTS
--   Most child data references bitelist_users(id) with ON DELETE CASCADE.
--   bitelist_compare_sessions references bitelist_users(share_slug), NOT id.
--   Deleting a user row removes their share_slug from the parent; Postgres will
--   block the delete if any compare session row still references that slug.
--
-- RUNBOOK
--   1) Identify the user (replace placeholders). Prefer id over fuzzy name.
--   2) Run the SELECT preview; confirm one row.
--   3) Uncomment the transaction (BEGIN … COMMIT), set :user_id, run once.
--
-- After delete: that WhatsApp number will onboard as a new user on next message
-- (if ALLOW_NEW_USERS / your bot policy permits).

-- ── 1) Preview: who will be removed? ─────────────────────────────────────
-- Replace the UUID with the real bitelist_users.id

select id, whatsapp_number, display_name, share_slug, created_at
from bitelist_users
where id = '00000000-0000-0000-0000-000000000000'::uuid;
-- or: where display_name ilike '%ravi%'  (risky if multiple matches)


-- ── 2) See compare sessions that reference this user's public slug ─────────

select c.*
from bitelist_compare_sessions c
cross join bitelist_users u
where u.id = '00000000-0000-0000-0000-000000000000'::uuid
  and (c.slug_a = u.share_slug or c.slug_b = u.share_slug);


-- ── 3) Delete user (transaction) ─────────────────────────────────────────
-- Uncomment and paste the correct UUID before running.

/*
begin;

delete from bitelist_compare_sessions c
using bitelist_users u
where u.id = '00000000-0000-0000-0000-000000000000'::uuid
  and (c.slug_a = u.share_slug or c.slug_b = u.share_slug);

delete from bitelist_users
where id = '00000000-0000-0000-0000-000000000000'::uuid;

commit;
*/
