import {
  getFriends,
  getDistinctSaveAreaNormsForUser,
  mergeFriendActivityDigestPlace,
  listPendingFriendDigestRowsForDate,
  markFriendDigestSentForRecipientDate,
  getUserById
} from './db.js';
import { sendMessage } from '../twilio/client.js';
import { logger } from '../utils/logger.js';

/** YYYY-MM-DD in Asia/Kolkata for the given instant. */
export function kolkataCalendarDateYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/** Previous calendar day (Kolkata) as YYYY-MM-DD — used to send "yesterday's" digest. */
export function kolkataYesterdayYmd() {
  const today = kolkataCalendarDateYmd();
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function placeLineForFriend(friendLabel, places) {
  const areas = [...new Set(places.map((p) => (p.area || '').trim()).filter(Boolean))];
  const names = places.map((p) => `*${p.restaurant_name}*`).join(', ');
  if (places.length === 1 && areas.length === 1) {
    return `*${friendLabel}* saved ${names} in ${areas[0]} — an area you love.`;
  }
  if (areas.length === 1) {
    return `*${friendLabel}* saved ${names} in ${areas[0]} — an area you love.`;
  }
  return `*${friendLabel}* saved ${names} (${areas.join(', ')}) — areas you save in too.`;
}

function buildDigestBody(rowsByFriend) {
  const lines = [];
  for (const row of rowsByFriend.values()) {
    const places = Array.isArray(row.places) ? row.places : [];
    if (!places.length) continue;
    const friendLabel = row._friendLabel || 'A friend';
    lines.push(placeLineForFriend(friendLabel, places));
  }
  return lines.join('\n\n');
}

/**
 * After a successful new save: queue at most one digest row per friend per Kolkata day
 * for each connected user who shares that area on their own list. Respects friend's quiet_mode.
 */
export async function enqueueFriendActivityAfterSave(saver, saved) {
  if (!saved || saved.duplicate || !saved.id) return;
  const areaRaw = (saved.area || '').trim();
  if (!areaRaw) return;

  const areaNorm = areaRaw.toLowerCase();
  const activityDate = kolkataCalendarDateYmd();

  try {
    const friends = await getFriends(saver.id);
    if (!friends.length) return;

    for (const friend of friends) {
      if (friend.quiet_mode) continue;
      const recipientAreas = await getDistinctSaveAreaNormsForUser(friend.id);
      if (!recipientAreas.has(areaNorm)) continue;

      await mergeFriendActivityDigestPlace({
        recipientId: friend.id,
        sourceFriendId: saver.id,
        activityDate,
        restaurantName: saved.restaurant_name,
        areaDisplay: areaRaw
      });
    }
  } catch (err) {
    logger.warn({ err, saverId: saver.id, saveId: saved.id }, 'enqueueFriendActivityAfterSave failed (non-fatal)');
  }
}

/**
 * Send one batched WhatsApp per recipient for all pending digest rows on `activityDate`.
 * Call daily via cron (yesterday in Kolkata) after that calendar day has finished accumulating saves.
 */
export async function runFriendActivityDigestForActivityDate(activityDate) {
  const rows = await listPendingFriendDigestRowsForDate(activityDate);
  if (!rows.length) {
    return { activityDate, recipients: 0, messagesSent: 0, skippedQuiet: 0 };
  }

  const byRecipient = new Map();
  for (const row of rows) {
    const list = byRecipient.get(row.recipient_id) || [];
    list.push(row);
    byRecipient.set(row.recipient_id, list);
  }

  let messagesSent = 0;
  let skippedQuiet = 0;

  for (const [recipientId, group] of byRecipient) {
    const recipient = await getUserById(recipientId);
    if (!recipient?.whatsapp_number) {
      await markFriendDigestSentForRecipientDate(recipientId, activityDate);
      continue;
    }

    if (recipient.quiet_mode) {
      skippedQuiet += 1;
      await markFriendDigestSentForRecipientDate(recipientId, activityDate);
      continue;
    }

    const rowsByFriend = new Map();
    for (const row of group) {
      const f = await getUserById(row.source_friend_id);
      const label = (f?.display_name || '').trim() || 'A friend';
      rowsByFriend.set(row.source_friend_id, { ...row, _friendLabel: label });
    }

    const body = buildDigestBody(rowsByFriend);
    if (!body.trim()) {
      await markFriendDigestSentForRecipientDate(recipientId, activityDate);
      continue;
    }

    const header = `Friends' saves you might care about (${activityDate} · India time):\n\n`;
    const text = `${header}${body}`;
    const capped = text.length > 1500 ? `${text.slice(0, 1490)}…` : text;

    try {
      await sendMessage(recipient.whatsapp_number, capped);
      messagesSent += 1;
    } catch (err) {
      logger.error({ err, recipientId }, 'Friend activity digest send failed');
    } finally {
      await markFriendDigestSentForRecipientDate(recipientId, activityDate);
    }
  }

  return {
    activityDate,
    recipients: byRecipient.size,
    messagesSent,
    skippedQuiet
  };
}
