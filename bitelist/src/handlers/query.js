import { getRecentSaves, logEvent } from '../services/db.js';
import { callClaudeJson } from '../services/claude.js';
import { queryPrompt } from '../prompts/query.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';

export async function handleQuery(user, text) {
  const saves = await getRecentSaves(user.id, 200);

  if (saves.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      "You haven't saved anything yet. Forward me an Instagram reel or type *Save <name> <area>* to get started."
    );
    return;
  }

  await logEvent(user.id, 'query', { text, save_count: saves.length });

  const result = await callClaudeJson(queryPrompt(text, saves));
  const ids = Array.isArray(result.matched_ids) ? result.matched_ids : [];
  const matched = ids
    .map((id) => saves.find((s) => s.id === id))
    .filter(Boolean)
    .slice(0, 5);

  if (matched.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      `Nothing in your list matches that. You have ${saves.length} saves total — try *list* to see them, or save more places.`
    );
    return;
  }

  const header = `Here are ${matched.length} from your list:`;
  await sendMessage(user.whatsapp_number, formatSaveList(matched, header));
}
