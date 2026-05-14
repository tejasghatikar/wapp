# BiteList — Phase 2: Friends + Webapp (current spec)

> **Supersedes** the earlier draft that used `connect with` / `accept` / `decline`. The live product uses an **instant link**: list page → WhatsApp → `friend <share_slug>` → `bitelist_friendships` upsert.  
> **Source of truth:** `bitelist/sql/schema.sql`, `bitelist/src/services/db.js`, `bitelist/src/services/friendActivity.js`, `bitelist/src/handlers/commands.js`, `bitelist/src/handlers/router.js`, `bitelist/src/routes/share.js`.

---

## Product slice

```
Phase 1 (done): Save → Query (solo)
Phase 2 (done): Share list → Link on BiteList (WhatsApp) → Friends → Suggest / Compare
```

**Read-only web**

| Route | Purpose |
|--------|--------|
| `GET /list/:slug` | Public list for `share_slug`. **Link on BiteList** opens `wa.me` with pre-filled `friend <owner.share_slug>`. |
| `GET /compare/:slugA/:slugB` | Mutual saves + asymmetric previews; WhatsApp share for shortlist. |
| `GET /internal/cron/friend-activity-digest?secret=…&date=YYYY-MM-DD` | **Optional.** Sends batched “friends saved in areas you use” WhatsApp digests for a given `activity_date` (defaults to **yesterday** in `Asia/Kolkata`). Requires `CRON_SECRET` on the server. |

**Bot remains** the only way to add/remove saves and manage the account.

### Friend activity digests (WhatsApp)

- When a friend **successfully saves** a place with a non-empty **`area`**, each connected friend may get **one queued line** for that Kolkata calendar day — **only if** that friend already has at least one save in the **same area** (case-insensitive match on trimmed `area` text).
- **At most one digest row per (recipient, friend, day)**; multiple saves that day are merged into that row’s list.
- **Quiet mode** (`quiet`, `quiet on`, `dnd`, `do not disturb`, …): recipient gets **no** digest sends; queued rows for a run are marked sent without messaging. `quiet off` / `loud` re-enables.
- **Cron** should run **once per day** after the India calendar day you want to close out (e.g. process **yesterday** so the full day is captured). Schedule an HTTP GET with `?secret=$CRON_SECRET` (see `src/index.js`).

---

## Friendship (instant, no request queue)

1. **Identity:** The browser page does not know the visitor’s WhatsApp id. The **WhatsApp message** to the bot does.
2. Visitor taps **Link on BiteList** → `https://wa.me/<digits>?text=friend%20<share_slug>`.
3. Bot handles `handleFriendLink` in `commands.js`: resolves owner by `getUserBySlug(slug)`, validates, then **`ensureFriendship(ownerId, requesterId)`** (bidirectional upsert into `bitelist_friendships`). The list owner gets a WhatsApp ping **only once the linker has a non-empty `display_name`** (immediate if they already set a name; otherwise deferred until onboarding / `name` sets it — see `pending_friend_link_notify_owner_ids` on `bitelist_users`).
4. Router runs **`^friend\s`** **before** onboarding name capture so new users can send the pre-filled message right after joining.

There are **no** `accept` / `decline` commands and **no** application reads/writes to `bitelist_friend_requests`.

---

## Database (Postgres / Supabase)

Canonical definitions: **`bitelist/sql/schema.sql`** (prefixed tables `bitelist_*`).

| Table | Role |
|--------|------|
| `bitelist_users` | `share_slug`, `display_name`, `whatsapp_number`, `quiet_mode`, `pending_friend_link_notify_owner_ids`, … |
| `bitelist_saves` | Saves per user (`user_id` → `on delete cascade`). |
| `bitelist_friendships` | Undirected edges stored as two rows `(A,B)` and `(B,A)` with `unique(user_a_id, user_b_id)`. |
| `bitelist_friend_activity_digest` | Pending lines for daily batched friend-save WhatsApp digests (`digest_sent_at` when processed). |
| `bitelist_compare_sessions` | Optional analytics rows; **FK** `slug_a`, `slug_b` → `bitelist_users(share_slug)`. **Important for user delete** — see `bitelist/sql/admin-remove-user.sql`. |
| `bitelist_friend_requests` | **Legacy / unused by app.** See § “Friend requests table” below. |

**RPCs** (in schema): `bitelist_mutual_saves`, `bitelist_new_for_user` — used by `getMutualSaves` / `getNewForUser` in `db.js`.

---

## Friend requests table (`bitelist_friend_requests`)

- **Decision:** Leave the table in **schema baseline** for existing deployments that already created it; **application code does not use it** after the instant-friend flow.
- **Optional cleanup:** If you want a DB with no dead table, run **`bitelist/sql/optional-drop-friend-requests.sql`** once in Supabase SQL Editor (review the file first; irreversible for that table’s rows).

---

## Bot commands (current)

| Message pattern | Handler / behavior |
|------------------|-------------------|
| `friend <hex_slug>` | `handleFriendLink` — instant connect (usually from list page). |
| `quiet` / `quiet on` / `dnd` / `do not disturb` | Enable **quiet mode** (no friend-activity digests). |
| `quiet off` / `loud` / `notifications on` | Disable quiet mode. |
| `friends` | List connections + list URLs when `PUBLIC_URL` is set. |
| `suggest with <name>` | Substring match on friend `display_name`; mutual saves + `/compare/...` link. |
| `discover with <name>` | Friend’s saves you don’t have (by `google_place_id`). |
| `name` / `setname` / `my name is` | Set display name. |
| Natural language (fallback) | `handleQuery` — can include friend hints via `augmentWithFriendData` in `query.js`. |

**HELP** text lives in `commands.js` (`HELP` constant) — keep it in sync when behavior changes.

---

## Router notes (`router.js`)

- **`^friend\s`** is handled **early** (including the **first message** after `handleOnboarding` for brand-new users).
- **`quiet` / `loud` / `notifications on|off`** are handled early (before onboarding name capture) so they are not mistaken for names.
- Onboarding name capture denies generic tokens including `friend`, `accept`, `decline`, `connect` so they are not mistaken for names.

---

## Social augmentation in queries

`query.js` loads friends and uses **`getFriendSavesForPlaces`** (see `db.js`) so results can carry `_friends_who_saved` where applicable. Formatting: `formatSaveList` / prompt pipeline as implemented in repo.

---

## Admin: remove a user safely

Runbook and transactional template: **`bitelist/sql/admin-remove-user.sql`** (comments explain `bitelist_compare_sessions` FK on `share_slug`).

---

## Test checklist (manual)

- [ ] Share list → `/list/:slug` loads; **Link on BiteList** opens WhatsApp with `friend <slug>`.
- [ ] Existing user sends `friend <valid_slug>` → friendship rows; confirmations as coded.
- [ ] New user: first inbound message is `friend <slug>` after onboarding → handled; not swallowed as a name.
- [ ] `friends` lists connection; `suggest with` / `discover with` match display names.
- [ ] No mutual saves → suggest path suggests `discover with`.
- [ ] `/compare/:slugA/:slugB` loads; WhatsApp share works when mutual saves exist.
- [ ] Natural-language query returns sensible results when saves + friends exist.

---

## End-to-end story (current)

```
Tejas saves places via bot → types share → opens /list/<tejas_slug>
  → sends link to Priya
Priya opens link → taps Link on BiteList
  → WhatsApp opens with: friend <tejas_slug>
Priya sends → bot upserts bitelist_friendships
  → both users get confirmation-style messages (see commands.js)
Tejas: suggest with priya → mutual list + compare URL
Tejas shares compare link to a group → group uses read-only page + share button
```

---

## Still out of scope (same spirit as Phase 1)

- Friend activity feed, group bot in WhatsApp groups, swipe UI, web login/auth for saves, likes/comments/stories.

---

## Historical note

Older revisions of this file documented **`connect with <name> <slug>`**, **`accept` / `decline`**, and example code against non-`bitelist_` table names. That flow was **removed** to reduce bot friction; do not reintroduce it unless you intentionally redesign onboarding and privacy again.
