import {
  getRecentSaves,
  getMostRecentSave,
  softDeleteSave,
  findSaveByName,
  countSaves,
  logEvent,
  updateSaveNotes,
  updateUserDisplayName,
  getUserBySlug,
  ensureFriendship,
  getFriends,
  areFriends,
  getMutualSaves,
  getNewForUser,
  createCompareSession
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

function publicBase() {
  return (config.publicUrl || '').replace(/\/$/, '');
}

function firstNameToken(name) {
  return (name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
}

const HELP = `*BiteList* commands:

*Save*
• Forward any *Instagram reel* → saves the restaurant
• Send a *Google Maps link* → saves that place
• *Save Toit Indiranagar* → manual save
• *Bulk save* — type *Save* (or *Add*) then list places one per line:
   _Save_
   _Toit Indiranagar_
   _Maize & Malt MG Road_
   _https://maps.app.goo.gl/..._
• After every save I'll ask: *1* want to go · *2* been there
• *note your text* → add a note to your latest save

*Find*
• Ask anything: *where should I go in JP Nagar*
• *list* → your last 10 saves
• *count* → total saves

*Friends*
• *name <your name>* → set how friends see you
• *friends* → see your connections
• Open a shared list link → tap *Link on BiteList* in WhatsApp (one message) to connect
• *suggest with Rahul* → places you both saved
• *discover with Rahul* → places Rahul saved that you haven't

*Other*
• *undo* → remove last save
• *delete <name>* → remove a specific save
• *share* → public link of your list
• *help* → this message

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
  const base = publicBase();
  const url = `${base}/list/${user.share_slug}`;
  await sendMessage(
    user.whatsapp_number,
    `Here's your shareable list:\n\n${url}\n\nAnyone with this link can see your saved places. They can't edit or message you through it.`
  );
}

// ── Friend / display-name commands ───────────────────────────────────────

export async function handleSetName(user, text) {
  const name = text.replace(/^(my name is|setname|name)\s+/i, '').trim();
  if (!name) {
    await sendMessage(
      user.whatsapp_number,
      'Tell me what to call you. Try: *name Tejas*'
    );
    return false;
  }
  if (name.length > 60) {
    await sendMessage(user.whatsapp_number, 'That name is a bit long — keep it under 60 characters.');
    return false;
  }
  await updateUserDisplayName(user.id, name);
  await logEvent(user.id, 'command', { name: 'set_name', value: name });
  await sendMessage(
    user.whatsapp_number,
    `Got it — friends will see you as *${name}*. Share your list with *share*; when they open the link they can tap *Link on BiteList* to connect.`
  );
  return true;
}

// Triggered by list page WhatsApp button: "friend <share_slug>" (list owner's slug)
export async function handleFriendLink(requester, text) {
  const match = text.trim().match(/^friend\s+([a-f0-9]{10,})$/i);
  if (!match) {
    await sendMessage(
      requester.whatsapp_number,
      "That link looks wrong. Open someone's list in the browser and tap *Link on BiteList*."
    );
    return;
  }

  const [, slug] = match;
  const owner = await getUserBySlug(slug);

  if (!owner) {
    await sendMessage(requester.whatsapp_number, "Couldn't find that list. Check the link.");
    return;
  }

  if (owner.id === requester.id) {
    await sendMessage(requester.whatsapp_number, "That's your own list. Share it so friends can link with you.");
    return;
  }

  const already = await areFriends(requester.id, owner.id);
  if (already) {
    await sendMessage(
      requester.whatsapp_number,
      `You're already connected with *${owner.display_name || 'this list'}*. Try *suggest with ${firstNameToken(owner.display_name || 'them')}*.`
    );
    return;
  }

  await ensureFriendship(owner.id, requester.id);
  await logEvent(requester.id, 'friend_linked', { owner_id: owner.id });

  const requesterLabel = requester.display_name || requester.whatsapp_number;
  const ownerLabel = owner.display_name || 'this list';

  await sendMessage(
    requester.whatsapp_number,
    `You're now connected with *${ownerLabel}* on BiteList.\n\nTry *suggest with ${firstNameToken(owner.display_name || ownerLabel)}* for overlap, or *discover with ${firstNameToken(owner.display_name || ownerLabel)}* for their picks you haven't saved.`
  );

  await sendMessage(
    owner.whatsapp_number,
    `👋 *${requesterLabel}* linked with you on BiteList (they opened your list).`
  );
}

export async function handleFriendsList(user) {
  await logEvent(user.id, 'command', { name: 'friends' });
  const friends = await getFriends(user.id);
  const base = publicBase();
  if (!friends.length) {
    await sendMessage(
      user.whatsapp_number,
      `No connections yet. Share your list link (${base ? `${base}/list/${user.share_slug}` : 'use *share*'}) — when someone opens it and taps *Link on BiteList* in WhatsApp, you'll show up here.`
    );
    return;
  }
  const lines = friends.map((f, i) => {
    const label = f.display_name || f.whatsapp_number;
    const url = base ? ` → ${base}/list/${f.share_slug}` : '';
    return `${i + 1}. ${label}${url}`;
  });
  await sendMessage(user.whatsapp_number, `Your connections:\n\n${lines.join('\n')}`);
}

function findFriendByName(friends, name) {
  const lower = (name || '').toLowerCase();
  return friends.find((f) => (f.display_name || '').toLowerCase().includes(lower));
}

export async function handleSuggest(user, text) {
  const name = text.replace(/^suggest with\s+/i, '').trim();
  if (!name) {
    await sendMessage(user.whatsapp_number, 'Tell me who. Try: *suggest with Priya*.');
    return;
  }
  const friends = await getFriends(user.id);
  const friend = findFriendByName(friends, name);

  if (!friend) {
    await sendMessage(
      user.whatsapp_number,
      `No connection named "${name}". Try *friends* to see your list.`
    );
    return;
  }

  const mutual = await getMutualSaves(user.id, friend.id);

  if (!mutual.length) {
    await sendMessage(
      user.whatsapp_number,
      `You and ${friend.display_name || name} haven't saved any of the same places yet.\n\nTry *discover with ${name}* to see what they've saved that you haven't.`
    );
    return;
  }

  try {
    await createCompareSession(user.share_slug, friend.share_slug);
  } catch (err) {
    logger.warn({ err, userId: user.id, friendId: friend.id }, 'createCompareSession failed (non-fatal)');
  }

  const base = publicBase();
  const url = base
    ? `${base}/compare/${user.share_slug}/${friend.share_slug}`
    : null;

  const preview = mutual
    .slice(0, 3)
    .map((s, i) =>
      `${i + 1}. *${s.restaurant_name}*${s.area ? `, ${s.area}` : ''}${s.google_rating ? ` ⭐${s.google_rating}` : ''}`
    )
    .join('\n');

  const more = mutual.length > 3 ? `\n...and ${mutual.length - 3} more` : '';
  const linkBlock = url ? `\n\n📋 Full list (shareable):\n${url}` : '';
  const friendLabel = friend.display_name || name;

  await sendMessage(
    user.whatsapp_number,
    `You and ${friendLabel} both saved *${mutual.length} place${mutual.length > 1 ? 's' : ''}*:\n\n${preview}${more}${linkBlock}`
  );

  await logEvent(user.id, 'suggest', { friend_id: friend.id, mutual_count: mutual.length });
}

export async function handleDiscover(user, text) {
  const name = text.replace(/^discover with\s+/i, '').trim();
  if (!name) {
    await sendMessage(user.whatsapp_number, 'Tell me who. Try: *discover with Priya*.');
    return;
  }
  const friends = await getFriends(user.id);
  const friend = findFriendByName(friends, name);

  if (!friend) {
    await sendMessage(
      user.whatsapp_number,
      `No connection named "${name}". Try *friends* to see your list.`
    );
    return;
  }

  const newPlaces = await getNewForUser(user.id, friend.id);

  if (!newPlaces.length) {
    await sendMessage(
      user.whatsapp_number,
      `You've already saved everything ${friend.display_name || name} has. They need to save more places!`
    );
    return;
  }

  const header = `${friend.display_name || name} saved these — you haven't been yet:`;
  await sendMessage(user.whatsapp_number, formatSaveList(newPlaces, header));

  await logEvent(user.id, 'discover', { friend_id: friend.id, new_count: newPlaces.length });
}
