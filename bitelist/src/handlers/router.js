import {
  getUserByPhone,
  getLatestPending,
  getLatestPendingStatus,
  logEvent
} from '../services/db.js';
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
  handleConnectRequest,
  handleFriendResponse,
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
    await handleOnboarding(from);
    return;
  }

  await logEvent(user.id, 'message_in', { body });

  const lower = body.toLowerCase().trim();

  const pendingStatus = await getLatestPendingStatus(user.id);
  if (pendingStatus && isStatusReply(body)) {
    await handleStatusReply(user, body, pendingStatus);
    return;
  }

  const pending = await getLatestPending(user.id);
  if (pending && pending.candidates?.length > 0 && /^[1-9]$|^option\s+[1-9]/i.test(body)) {
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

  if (/^connect with /i.test(body)) return handleConnectRequest(user, body);
  if (/^accept\s+/i.test(lower)) return handleFriendResponse(user, body);
  if (/^decline\s+/i.test(lower)) return handleFriendResponse(user, body);
  if (/^friends$/i.test(lower)) return handleFriendsList(user);
  if (/^suggest with\s+/i.test(lower)) return handleSuggest(user, body);
  if (/^discover with\s+/i.test(lower)) return handleDiscover(user, body);

  if (/^(save|add)\s+/i.test(lower)) return handleManualSave(user, body);

  await handleQuery(user, body);
}
