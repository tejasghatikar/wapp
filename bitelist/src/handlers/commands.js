import {
  getRecentSaves,
  getMostRecentSave,
  softDeleteSave,
  findSaveByName,
  countSaves,
  logEvent,
  updateSaveNotes
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';
import { config } from '../config.js';

const HELP = `*BiteList* commands:

• Forward any *Instagram reel* → saves the restaurant
• Send a *Google Maps link* → saves that place
• *Save Toit Indiranagar* → manual save
• *Bulk save* — type *Save* (or *Add*) then list places one per line:
   _Save_
   _Toit Indiranagar_
   _Maize & Malt MG Road_
   _https://maps.app.goo.gl/..._
• After every save I'll ask: *1* want to go · *2* been there
• Ask *where should I go in JP Nagar* → query your list
• *list* → your last 10 saves
• *count* → how many you've saved
• *undo* → remove last save
• *delete <name>* → remove a specific save
• *share* → public link of your list
• *note your text* → add a note to your latest save

Your phone number is your account. No app needed.`;

export async function handleHelp(user) {
  await logEvent(user.id, 'command', { name: 'help' });
  await sendMessage(user.whatsapp_number, HELP);
}

export async function handleList(user) {
  await logEvent(user.id, 'command', { name: 'list' });
  const saves = await getRecentSaves(user.id, 10);
  await sendMessage(
    user.whatsapp_number,
    formatSaveList(saves, `Your last ${saves.length} saves:`)
  );
}

export async function handleCount(user) {
  const total = await countSaves(user.id);
  await logEvent(user.id, 'command', { name: 'count', total });
  await sendMessage(user.whatsapp_number, `You've saved *${total}* restaurants. Keep going.`);
}

export async function handleUndo(user) {
  const latest = await getMostRecentSave(user.id);
  if (!latest) {
    await sendMessage(user.whatsapp_number, 'Nothing to undo — your list is empty.');
    return;
  }
  await softDeleteSave(latest.id);
  await logEvent(user.id, 'command', { name: 'undo', save_id: latest.id });
  await sendMessage(user.whatsapp_number, `Removed: *${latest.restaurant_name}*.`);
}

export async function handleDelete(user, text) {
  const name = text.replace(/^(delete|remove)\s+/i, '').trim();
  if (!name) {
    await sendMessage(user.whatsapp_number, 'Delete what? Try: *delete Toit*');
    return;
  }
  const save = await findSaveByName(user.id, name);
  if (!save) {
    await sendMessage(user.whatsapp_number, `No save matching "${name}" found.`);
    return;
  }
  await softDeleteSave(save.id);
  await logEvent(user.id, 'command', { name: 'delete', save_id: save.id });
  await sendMessage(user.whatsapp_number, `Removed: *${save.restaurant_name}*.`);
}

export async function handleAddNote(user, text) {
  await logEvent(user.id, 'command', { name: 'note' });
  const note = text.replace(/^(note|notes)\s+/i, '').trim();
  if (!note) {
    await sendMessage(user.whatsapp_number, 'What should I save? Try: *note great for birthdays*');
    return;
  }
  const latest = await getMostRecentSave(user.id);
  if (!latest) {
    await sendMessage(user.whatsapp_number, 'Save a place first, then send *note your text here*.');
    return;
  }
  const merged = [latest.notes, note].filter(Boolean).join(' — ');
  await updateSaveNotes(latest.id, merged);
  await logEvent(user.id, 'command', { name: 'note_saved', save_id: latest.id });
  await sendMessage(
    user.whatsapp_number,
    `📝 Noted for *${latest.restaurant_name}*: ${note}`
  );
}

export async function handleShare(user) {
  await logEvent(user.id, 'command', { name: 'share' });
  if (!config.publicUrl) {
    await sendMessage(
      user.whatsapp_number,
      'Share links are not configured yet (missing PUBLIC_URL on the server).'
    );
    return;
  }
  const base = config.publicUrl.replace(/\/$/, '');
  const url = `${base}/list/${user.share_slug}`;
  await sendMessage(
    user.whatsapp_number,
    `Here's your shareable list:\n\n${url}\n\nAnyone with this link can see your saved places. They can't edit or message you through it.`
  );
}
