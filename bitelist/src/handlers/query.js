import {
  getRecentSaves,
  logEvent,
  getFriends,
  getFriendSavesForPlaces
} from '../services/db.js';
import { callClaudeJson, ClaudeUnavailableError } from '../services/claude.js';
import { queryPrompt } from '../prompts/query.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';
import { logger } from '../utils/logger.js';

async function augmentWithFriendData(userId, saves) {
  if (!saves || saves.length === 0) return saves;
  let friends;
  try {
    friends = await getFriends(userId);
  } catch (err) {
    logger.warn({ err, userId }, 'augmentWithFriendData: getFriends failed');
    return saves;
  }
  if (!friends.length) return saves;

  const placeIds = saves.map((s) => s.google_place_id).filter(Boolean);
  if (!placeIds.length) return saves;

  const friendsById = new Map(friends.map((f) => [f.id, f]));
  let rows;
  try {
    rows = await getFriendSavesForPlaces(
      friends.map((f) => f.id),
      placeIds
    );
  } catch (err) {
    logger.warn({ err, userId }, 'augmentWithFriendData: friend save lookup failed');
    return saves;
  }

  const friendSaveMap = new Map();
  for (const row of rows) {
    const friend = friendsById.get(row.user_id);
    if (!friend || !row.google_place_id) continue;
    const list = friendSaveMap.get(row.google_place_id) || [];
    const label = friend.display_name || 'a friend';
    if (!list.includes(label)) list.push(label);
    friendSaveMap.set(row.google_place_id, list);
  }

  return saves.map((s) => ({
    ...s,
    _friends_who_saved: s.google_place_id ? friendSaveMap.get(s.google_place_id) || [] : []
  }));
}

export async function handleQuery(user, text) {
  const saves = await getRecentSaves(user.id, 200);

  if (saves.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      "Your list is empty so far. Send a Google Maps link, forward an Instagram reel, or type *Save <name> <area>* to add your first place."
    );
    return;
  }

  await logEvent(user.id, 'query', { text, save_count: saves.length });

  let result;
  try {
    result = await callClaudeJson(queryPrompt(text, saves));
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      logger.warn(
        { userId: user.id, status: err.status, model: err.model, text },
        'Claude unavailable — replying with friendly fallback'
      );
      await sendMessage(
        user.whatsapp_number,
        `I couldn't search your list just now (the assistant service didn't respond). To add a place, try *Save ${text}* or send a Google Maps link. *list* shows everything you've saved.`
      );
      return;
    }
    throw err;
  }

  const ids = Array.isArray(result?.matched_ids) ? result.matched_ids : [];
  const matched = ids
    .map((id) => saves.find((s) => s.id === id))
    .filter(Boolean)
    .slice(0, 5);

  if (matched.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      `I couldn't find a match for "${text}" in your list of ${saves.length} saves. Want to add it? Reply *Save ${text}*. Type *list* to see everything you've saved.`
    );
    return;
  }

  const augmented = await augmentWithFriendData(user.id, matched);
  const header = `Here are ${augmented.length} from your list:`;
  await sendMessage(user.whatsapp_number, formatSaveList(augmented, header));
}
