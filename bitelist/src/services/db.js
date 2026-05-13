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
  events: 'bitelist_events'
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
