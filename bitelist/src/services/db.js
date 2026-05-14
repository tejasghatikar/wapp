import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { randomBytes } from 'crypto';

let cachedSupabase;
function getSupabase() {
  if (!cachedSupabase) {
    const { url, serviceRoleKey } = config.supabase;
    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in Render → Environment.'
      );
    }
    cachedSupabase = createClient(url, serviceRoleKey);
  }
  return cachedSupabase;
}

const T = {
  users: 'bitelist_users',
  saves: 'bitelist_saves',
  pending: 'bitelist_pending_saves',
  pendingStatus: 'bitelist_pending_status',
  events: 'bitelist_events',
  friendRequests: 'bitelist_friend_requests',
  friendships: 'bitelist_friendships',
  compareSessions: 'bitelist_compare_sessions'
};

export async function checkDatabaseHealth() {
  const results = {};
  for (const [label, table] of Object.entries(T)) {
    const { error } = await getSupabase()
      .from(table)
      .select('id', { count: 'exact', head: true })
      .limit(1);
    results[label] = error
      ? { ok: false, code: error.code, message: error.message }
      : { ok: true };
  }
  return results;
}

export async function getUserByPhone(whatsappNumber) {
  const { data, error } = await getSupabase()
    .from(T.users)
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createUser(whatsappNumber) {
  const shareSlug = randomBytes(5).toString('hex');
  const { data, error } = await getSupabase()
    .from(T.users)
    .insert({
      whatsapp_number: whatsappNumber,
      share_slug: shareSlug,
      onboarded_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserBySlug(slug) {
  const { data } = await getSupabase()
    .from(T.users)
    .select('*')
    .eq('share_slug', slug)
    .maybeSingle();
  return data;
}

export async function getUserById(userId) {
  const { data, error } = await getSupabase()
    .from(T.users)
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Queue list-owner user ids to notify once this user sets display_name (friend link before naming). */
export async function appendPendingFriendLinkNotifyOwner(userId, ownerUserId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(T.users)
    .select('pending_friend_link_notify_owner_ids')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.pending_friend_link_notify_owner_ids;
  const cur = Array.isArray(raw) ? raw : [];
  const sid = String(ownerUserId);
  if (cur.some((id) => String(id) === sid)) return;
  const next = [...cur, ownerUserId];
  const { error: uerr } = await supabase
    .from(T.users)
    .update({ pending_friend_link_notify_owner_ids: next })
    .eq('id', userId);
  if (uerr) throw uerr;
}

/** Returns queued owner user ids and clears the queue (single consumer). */
export async function takeAndClearPendingFriendLinkNotifyOwnerIds(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(T.users)
    .select('pending_friend_link_notify_owner_ids')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.pending_friend_link_notify_owner_ids;
  const ids = Array.isArray(raw) ? raw : [];
  if (ids.length === 0) return [];
  const { error: uerr } = await supabase
    .from(T.users)
    .update({ pending_friend_link_notify_owner_ids: [] })
    .eq('id', userId);
  if (uerr) throw uerr;
  return ids;
}

export async function createSave(userId, save) {
  const { data, error } = await getSupabase()
    .from(T.saves)
    .insert({ user_id: userId, ...save })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return { duplicate: true };
    logger.error(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        userId,
        save
      },
      'Failed to insert save'
    );
    throw error;
  }
  return data;
}

export async function updateSaveNotes(saveId, notes) {
  const { error } = await getSupabase().from(T.saves).update({ notes }).eq('id', saveId);
  if (error) throw error;
}

export async function getRecentSaves(userId, limit = 200) {
  const { data, error } = await getSupabase()
    .from(T.saves)
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getSavesByArea(userId, area) {
  const { data, error } = await getSupabase()
    .from(T.saves)
    .select('*')
    .eq('user_id', userId)
    .ilike('area', `%${area}%`)
    .is('deleted_at', null)
    .order('google_rating', { ascending: false, nullsLast: true });
  if (error) throw error;
  return data || [];
}

export async function softDeleteSave(saveId) {
  const { error } = await getSupabase()
    .from(T.saves)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', saveId);
  if (error) throw error;
}

export async function getMostRecentSave(userId) {
  const { data } = await getSupabase()
    .from(T.saves)
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function findSaveByName(userId, name) {
  const { data } = await getSupabase()
    .from(T.saves)
    .select('*')
    .eq('user_id', userId)
    .ilike('restaurant_name', `%${name}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function countSaves(userId) {
  const { count } = await getSupabase()
    .from(T.saves)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);
  return count || 0;
}

export async function createPending(userId, candidates, sourceUrl, sourceType) {
  const { data, error } = await getSupabase()
    .from(T.pending)
    .insert({
      user_id: userId,
      candidates,
      source_url: sourceUrl,
      source_type: sourceType
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestPending(userId) {
  const { data } = await getSupabase()
    .from(T.pending)
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function deletePending(pendingId) {
  await getSupabase().from(T.pending).delete().eq('id', pendingId);
}

/** Clears onboarding name-capture pending rows so a structured command (e.g. `friend`) can proceed. */
export async function deleteOnboardingNamePendingForUser(userId) {
  await getSupabase()
    .from(T.pending)
    .delete()
    .eq('user_id', userId)
    .eq('source_type', 'onboarding');
}

export async function updateSaveStatus(saveId, status, visitedNotes = null) {
  const patch = { status };
  if (visitedNotes !== null) patch.visited_notes = visitedNotes;
  const { error } = await getSupabase().from(T.saves).update(patch).eq('id', saveId);
  if (error) throw error;
}

export async function createPendingStatus(userId, saveId) {
  await getSupabase()
    .from(T.pendingStatus)
    .delete()
    .eq('user_id', userId);

  const { data, error } = await getSupabase()
    .from(T.pendingStatus)
    .insert({ user_id: userId, save_id: saveId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestPendingStatus(userId) {
  const { data, error } = await getSupabase()
    .from(T.pendingStatus)
    .select('*, save:bitelist_saves!inner(*)')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn({ err: error, userId }, 'Failed to load pending status');
    return null;
  }
  return data;
}

export async function deletePendingStatus(pendingStatusId) {
  await getSupabase().from(T.pendingStatus).delete().eq('id', pendingStatusId);
}

export async function updateUserDisplayName(userId, displayName) {
  const { error } = await getSupabase()
    .from(T.users)
    .update({ display_name: displayName })
    .eq('id', userId);
  if (error) throw error;
}

// ── Friends (instant link via list page → WhatsApp `friend <slug>`) ───────

export async function ensureFriendship(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return;
  const supabase = getSupabase();
  const { error } = await supabase.from(T.friendships).upsert(
    [
      { user_a_id: userAId, user_b_id: userBId },
      { user_a_id: userBId, user_b_id: userAId }
    ],
    { onConflict: 'user_a_id,user_b_id', ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function getFriends(userId) {
  const { data, error } = await getSupabase()
    .from(T.friendships)
    .select('friend:user_b_id(id, display_name, share_slug, whatsapp_number)')
    .eq('user_a_id', userId);
  if (error) throw error;
  return (data || []).map((row) => row.friend).filter(Boolean);
}

export async function areFriends(userAId, userBId) {
  const { data, error } = await getSupabase()
    .from(T.friendships)
    .select('id')
    .eq('user_a_id', userAId)
    .eq('user_b_id', userBId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// ── Mutual saves (RPC) ───────────────────────────────────────────────────

export async function getMutualSaves(userAId, userBId) {
  const { data, error } = await getSupabase().rpc('bitelist_mutual_saves', {
    user_a: userAId,
    user_b: userBId
  });
  if (error) throw error;
  return data || [];
}

export async function getNewForUser(userId, friendId) {
  const { data, error } = await getSupabase().rpc('bitelist_new_for_user', {
    me: userId,
    friend: friendId
  });
  if (error) throw error;
  return data || [];
}

// ── Compare sessions ─────────────────────────────────────────────────────

export async function createCompareSession(slugA, slugB) {
  const { data, error } = await getSupabase()
    .from(T.compareSessions)
    .insert({ slug_a: slugA, slug_b: slugB })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Friend augmentation helper ───────────────────────────────────────────

export async function getFriendSavesForPlaces(friendIds, placeIds) {
  if (!friendIds?.length || !placeIds?.length) return [];
  const { data, error } = await getSupabase()
    .from(T.saves)
    .select('user_id, google_place_id')
    .in('user_id', friendIds)
    .in('google_place_id', placeIds)
    .is('deleted_at', null);
  if (error) throw error;
  return data || [];
}

export async function logEvent(userId, eventType, payload = {}) {
  try {
    await getSupabase().from(T.events).insert({
      user_id: userId,
      event_type: eventType,
      payload
    });
  } catch (err) {
    logger.warn({ err, userId, eventType }, 'Failed to log event');
  }
}
