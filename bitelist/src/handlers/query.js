import { getRecentSaves, logEvent } from '../services/db.js';
import { callClaudeJson, ClaudeUnavailableError } from '../services/claude.js';
import { queryPrompt } from '../prompts/query.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';
import { logger } from '../utils/logger.js';

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

  const header = `Here are ${matched.length} from your list:`;
  await sendMessage(user.whatsapp_number, formatSaveList(matched, header));
}
