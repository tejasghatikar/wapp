-- OPTIONAL — One-time cleanup for legacy table bitelist_friend_requests
--
-- Context: The app no longer creates or reads friend requests; friendships are
-- created via ensureFriendship when a user sends: friend <owner_share_slug>
-- (typically from the public list page WhatsApp button).
--
-- Safe to run if you do not need historical request rows for analytics.
-- This does NOT remove bitelist_friendships or any saves.

drop table if exists bitelist_friend_requests cascade;
