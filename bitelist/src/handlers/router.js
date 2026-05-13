import {
  getUserByPhone,
  getLatestPending,
  getLatestPendingStatus,
  deletePending,
  deleteOnboardingNamePendingForUser,
  updateUserDisplayName,
  logEvent
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { handleOnboarding } from './onboarding.js';
import {
  handleReelSave,
  handleManualSave,
  handleGoogleMapsSave,
  handleDisambiguation,
  handleBulkSave,
  handleStatusReply,
  isStatusReply
} from './save.js';
import { handleQuery } from './query.js';
import {
  handleHelp,
  handleList,
  handleCount,
  handleUndo,
  handleDelete,
  handleShare,
  handleAddNote,
  handleSetName,
  handleFriendLink,
  handleFriendsList,
  handleSuggest,
  handleDiscover
} from './commands.js';
import { extractInstagramUrl, extractGoogleMapsUrl } from '../services/instagram.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export async function routeMessage(incoming) {
  const { from, body } = incoming;

  let user = await getUserByPhone(from);
  if (!user) {
    if (!config.allowNewUsers) {
      logger.warn({ from }, 'Blocked new user (ALLOW_NEW_USERS=false)');
      return;
    }
    const newUser = await handleOnboarding(from);
    const trimmedFirst = body.trim();
    if (/^friend\s/i.test(trimmedFirst)) {
      try {
        await handleFriendLink(newUser, trimmedFirst);
      } catch (err) {
        logger.error({ err, from }, 'Friend link failed right after onboarding');
      }
      try {
        await deleteOnboardingNamePendingForUser(newUser.id);
      } catch (err) {
        logger.warn({ err, userId: newUser.id }, 'Failed to clear onboarding pending after friend link');
      }
    }
    return;
  }

  await logEvent(user.id, 'message_in', { body });

  const lower = body.toLowerCase().trim();
  const trimmedBody = body.trim();

  // Friend link must win over onboarding name capture (`friend <share_slug>` from list page).
  if (/^friend\s/i.test(trimmedBody)) {
    await handleFriendLink(user, trimmedBody);
    return;
  }

  const pending = await getLatestPending(user.id);

  if (
    pending?.source_type === 'onboarding' &&
    pending.candidates?.[0]?.type === 'awaiting_name' &&
    /^(name|setname|my name is)\s+/i.test(lower)
  ) {
    const ok = await handleSetName(user, body);
    if (ok) await deletePending(pending.id);
    return;
  }

  if (pending?.source_type === 'onboarding' && pending.candidates?.[0]?.type === 'awaiting_name') {
    if (await handleAwaitingName(user, body, pending)) return;
  }

  const pendingStatus = await getLatestPendingStatus(user.id);
  if (pendingStatus && isStatusReply(body)) {
    await handleStatusReply(user, body, pendingStatus);
    return;
  }

  if (pending && pending.candidates?.length > 0 && pending.source_type !== 'onboarding' && /^[1-9]$|^option\s+[1-9]/i.test(body)) {
    await handleDisambiguation(user, body, pending);
    return;
  }

  const nonEmptyLines = body
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (nonEmptyLines.length > 1 && nonEmptyLines.every((line) => extractGoogleMapsUrl(line))) {
    await handleBulkSave(user, nonEmptyLines);
    return;
  }

  if (extractInstagramUrl(body)) {
    await handleReelSave(user, body);
    return;
  }
  if (extractGoogleMapsUrl(body)) {
    await handleGoogleMapsSave(user, body);
    return;
  }

  if (/^(help|hi|hello|start)$/i.test(lower)) return handleHelp(user);
  if (/^(list|my list|my saves|show)$/i.test(lower)) return handleList(user);
  if (/^count$/i.test(lower)) return handleCount(user);
  if (/^undo$/i.test(lower)) return handleUndo(user);
  if (/^(delete|remove)\s+/i.test(lower)) return handleDelete(user, body);
  if (/^share$/i.test(lower)) return handleShare(user);
  if (/^(note|notes)\s+/i.test(body)) return handleAddNote(user, body);
  if (/^(name|setname|my name is)\s+/i.test(lower)) return handleSetName(user, body);

  if (/^friends$/i.test(lower)) return handleFriendsList(user);
  if (/^suggest with\s+/i.test(lower)) return handleSuggest(user, body);
  if (/^discover with\s+/i.test(lower)) return handleDiscover(user, body);

  if (/^(save|add)\s+/i.test(lower)) return handleManualSave(user, body);

  await handleQuery(user, body);
}

/**
 * Returns true if the message was consumed by the onboarding name flow.
 * Returns false if the input doesn't look like a name and the message should
 * be re-prompted (we keep the pending alive in that case).
 */
async function handleAwaitingName(user, body, pending) {
  const trimmed = body.trim();

  if (/^skip$/i.test(trimmed)) {
    await deletePending(pending.id);
    await logEvent(user.id, 'name_skipped');
    await sendMessage(
      user.whatsapp_number,
      "No problem — you can set it any time with *name <your name>*. Send a Maps link or *Save <place>* to start your list."
    );
    return true;
  }

  const myNameMatch = trimmed.match(/^my name is\s+(.+)$/i);
  const namePart = (myNameMatch ? myNameMatch[1] : trimmed).trim();
  const firstWord = namePart.split(/\s+/)[0] || '';

  const GENERIC_DENY = new Set([
    'hi',
    'hey',
    'hello',
    'yo',
    'sup',
    'ok',
    'okay',
    'yes',
    'no',
    'help',
    'start',
    'my',
    'the',
    'a',
    'an',
    'friend',
    'accept',
    'decline',
    'connect'
  ]);
  if (GENERIC_DENY.has(firstWord.toLowerCase())) {
    await sendMessage(
      user.whatsapp_number,
      "That doesn't look like a name. Send your first name, or *my name is Tejas*, or *skip*."
    );
    return true;
  }

  const looksLikeName =
    firstWord.length >= 2 &&
    firstWord.length <= 30 &&
    !/^\d+$/.test(firstWord) &&
    !/[^\p{L}\p{M}'.\-]/u.test(firstWord);

  if (!looksLikeName) {
    await sendMessage(
      user.whatsapp_number,
      "That doesn't look like a name. Send just your first name, or *my name is Tejas*, or reply *skip*."
    );
    return true;
  }

  const name = firstWord.replace(/['.\-]+$/, '');

  try {
    await updateUserDisplayName(user.id, name);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to save onboarding display name');
    await sendMessage(
      user.whatsapp_number,
      "Couldn't save that name just now. Try again in a moment, or send *skip*."
    );
    return true;
  }

  await deletePending(pending.id);
  user.display_name = name;
  await logEvent(user.id, 'name_set', { name, via: 'onboarding' });

  await sendMessage(
    user.whatsapp_number,
    `Perfect! Your list is now *${name}'s picks*.\n\nStart saving — forward an Instagram reel, paste a Google Maps link, or type *Save Toit Indiranagar*. Type *help* anytime.`
  );
  return true;
}
