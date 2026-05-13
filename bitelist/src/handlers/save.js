import { extractionPrompt } from '../prompts/extract.js';
import { callClaudeJson, ClaudeUnavailableError } from '../services/claude.js';
import {
  fetchReelMetadata,
  extractInstagramUrl,
  extractGoogleMapsUrl,
  resolveGoogleMapsPlaceName
} from '../services/instagram.js';
import { searchPlaces, extractAreaFromAddress, resolvePhotoUrl } from '../services/places.js';
import {
  createSave,
  createPending,
  logEvent,
  deletePending,
  getLatestPending,
  createPendingStatus,
  deletePendingStatus,
  updateSaveStatus
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveConfirmation, formatCandidates, formatStatusUpdated } from '../utils/format.js';
import { logger } from '../utils/logger.js';

export async function handleReelSave(user, text) {
  const url = extractInstagramUrl(text);
  if (!url) return;

  await logEvent(user.id, 'save_attempt', { source: 'instagram_reel', url });

  const meta = await fetchReelMetadata(url);

  if (!meta.success) {
    await sendMessage(
      user.whatsapp_number,
      "I couldn't read that reel (Instagram blocked it). What's the restaurant name and area? Reply like: *Toit Indiranagar*"
    );
    await createPending(user.id, [], url, 'instagram_reel');
    return;
  }

  let extracted;
  try {
    extracted = await callClaudeJson(extractionPrompt(meta.rawText));
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      logger.warn(
        { userId: user.id, status: err.status, model: err.model, url },
        'Claude unavailable during reel extraction — replying with friendly fallback'
      );
      await sendMessage(
        user.whatsapp_number,
        "I read that reel but couldn't pull out the restaurant name (the assistant service didn't respond). What's the name and area? Reply like: *Toit Indiranagar*"
      );
      await createPending(user.id, [], url, 'instagram_reel');
      return;
    }
    throw err;
  }

  if (extracted.confidence < 0.6 || !extracted.restaurant_name) {
    await sendMessage(
      user.whatsapp_number,
      "I couldn't pin down the restaurant from this reel. What's the name and area? Reply like: *Toit Indiranagar*"
    );
    await createPending(user.id, [], url, 'instagram_reel');
    return;
  }

  await runPlaceLookup(user, extracted.restaurant_name, extracted.area, {
    sourceType: 'instagram_reel',
    sourceUrl: url
  });
}

const KNOWN_AREAS = [
  'indiranagar',
  'koramangala',
  'jp',
  'jayanagar',
  'hsr',
  'whitefield',
  'malleshwaram',
  'mg',
  'brigade'
];

/** Strip leading bullets / numbering like "1. ", "- ", "* ", "• " */
function cleanBulkLine(line) {
  return line
    .replace(/^[\s>]+/, '')
    .replace(/^[-*•]+\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
}

function splitBulkInput(text) {
  return text
    .split(/\r?\n+/)
    .map(cleanBulkLine)
    .filter(Boolean);
}

function parseNameAndArea(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 2) return { name: line, area: null };
  const lastWord = parts[parts.length - 1].toLowerCase();
  const hasArea = KNOWN_AREAS.some((a) => lastWord.includes(a));
  return hasArea
    ? { name: parts.slice(0, -1).join(' '), area: parts[parts.length - 1] }
    : { name: line, area: null };
}

export async function handleManualSave(user, text) {
  const cleaned = text.replace(/^(save|add)\s+/i, '').trim();
  if (!cleaned) {
    await sendMessage(user.whatsapp_number, 'Save what? Try: *Save Toit Indiranagar*');
    return;
  }

  const lines = splitBulkInput(cleaned);
  if (lines.length > 1) {
    await handleBulkSave(user, lines);
    return;
  }

  await logEvent(user.id, 'save_attempt', { source: 'manual' });
  const { name, area } = parseNameAndArea(cleaned);
  await runPlaceLookup(user, name, area, { sourceType: 'manual' });
}

/**
 * Bulk save: each line is either a Google Maps link or a plain "name [area]" entry.
 * Always picks the top Places result for each line to keep the flow non-interactive,
 * then sends one summary so the user can fix wrong picks via *delete <name>*.
 */
export async function handleBulkSave(user, lines) {
  await logEvent(user.id, 'save_attempt', { source: 'bulk', count: lines.length });

  const stale = await getLatestPending(user.id);
  if (stale) {
    try {
      await deletePending(stale.id);
    } catch (err) {
      logger.warn({ err, pendingId: stale.id }, 'Failed to clear stale pending before bulk save');
    }
  }

  await sendMessage(
    user.whatsapp_number,
    `Got ${lines.length} places — adding them now. I'll send a summary in a moment.`
  );

  const results = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const result = await processBulkEntry(user, line);
      results.push(result);
    } catch (err) {
      logger.error({ err, line }, 'Bulk entry crashed');
      results.push({ line, status: 'error' });
    }
  }

  await sendMessage(user.whatsapp_number, formatBulkSummary(results));
}

async function processBulkEntry(user, line) {
  const mapsUrl = extractGoogleMapsUrl(line);

  let name = line;
  let area = null;
  let sourceType = 'manual';
  let sourceUrl = null;

  if (mapsUrl) {
    sourceType = 'google_maps';
    sourceUrl = mapsUrl;
    try {
      const { placeName } = await resolveGoogleMapsPlaceName(mapsUrl);
      if (!placeName) {
        return { line, status: 'maps_unresolved' };
      }
      name = placeName;
      area = null;
    } catch (err) {
      logger.error({ err, mapsUrl }, 'Bulk: Maps resolve failed');
      return { line, status: 'maps_error' };
    }
  } else {
    const parsed = parseNameAndArea(line);
    name = parsed.name;
    area = parsed.area;
  }

  const candidates = await searchPlaces(name, area);
  logger.info(
    { line, name, area, candidateCount: candidates.length },
    'Bulk: place lookup complete'
  );

  if (candidates.length === 0) {
    return { line, status: 'not_found', name };
  }

  const place = await enrichWithPhoto(candidates[0]);
  const saved = await createSave(user.id, {
    restaurant_name: place.name,
    google_place_id: place.place_id,
    area: extractAreaFromAddress(place.address),
    google_rating: place.rating,
    price_level: place.price_level,
    cuisine_tags: place.cuisine_tags,
    source_type: sourceType,
    source_url: sourceUrl,
    google_maps_url: place.google_maps_url,
    google_photo_url: place.google_photo_url || null,
    latitude: place.latitude,
    longitude: place.longitude
  });

  if (saved.duplicate) {
    await logEvent(user.id, 'save_duplicate', { place_id: place.place_id, source: 'bulk' });
    return { line, status: 'duplicate', place };
  }

  await logEvent(user.id, 'save_success', { place_id: place.place_id, source: 'bulk' });
  return { line, status: 'saved', place };
}

function formatBulkSummary(results) {
  const saved = results.filter((r) => r.status === 'saved');
  const duplicates = results.filter((r) => r.status === 'duplicate');
  const notFound = results.filter(
    (r) => r.status === 'not_found' || r.status === 'maps_unresolved' || r.status === 'maps_error'
  );
  const errored = results.filter((r) => r.status === 'error');

  const out = [`Bulk save: ${saved.length} added, ${duplicates.length} already on list, ${notFound.length + errored.length} skipped.`];

  if (saved.length) {
    out.push('', `Saved (${saved.length}):`);
    saved.forEach((r, i) => out.push(`${i + 1}. ${r.place.name}`));
  }

  if (duplicates.length) {
    out.push('', `Already saved (${duplicates.length}):`);
    duplicates.forEach((r) => out.push(`• ${r.place.name}`));
  }

  if (notFound.length) {
    out.push('', `Couldn't find on Maps (${notFound.length}):`);
    notFound.forEach((r) => out.push(`• ${r.line}`));
    out.push('Reply *Save <name> <area>* with more detail, or paste the Google Maps link.');
  }

  if (errored.length) {
    out.push('', `Skipped due to errors (${errored.length}):`);
    errored.forEach((r) => out.push(`• ${r.line}`));
  }

  out.push('', 'Wrong pick? *delete <name>* to remove it.');
  return out.join('\n');
}

export async function handleGoogleMapsSave(user, text) {
  const url = extractGoogleMapsUrl(text);
  if (!url) {
    logger.warn({ text }, 'No Google Maps URL detected in message');
    await sendMessage(
      user.whatsapp_number,
      "I didn't spot a Google Maps link. Paste one starting with https://maps.app.goo.gl/ or https://goo.gl/maps"
    );
    return;
  }

  await logEvent(user.id, 'save_attempt', { source: 'google_maps', url });

  try {
    const { placeName, resolvedUrl } = await resolveGoogleMapsPlaceName(url);
    logger.info({ shortUrl: url, resolvedUrl, placeName }, 'Resolved Google Maps link');

    if (!placeName) {
      await sendMessage(
        user.whatsapp_number,
        "Couldn't read that Maps link after opening it. Try *Save <name> <area>* or a different Maps share link."
      );
      return;
    }

    await runPlaceLookup(user, placeName, null, { sourceType: 'google_maps', sourceUrl: url });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve Google Maps link');
    await sendMessage(
      user.whatsapp_number,
      "That link didn't open from the server. Try typing the name: *Save Toit Indiranagar*"
    );
  }
}

async function runPlaceLookup(user, name, area, { sourceType, sourceUrl = null }) {
  logger.info({ userId: user.id, name, area, sourceType }, 'Starting place lookup');
  const candidates = await searchPlaces(name, area);
  logger.info(
    {
      userId: user.id,
      name,
      area,
      sourceType,
      candidateCount: candidates.length,
      candidates: candidates.map((c) => ({ name: c.name, place_id: c.place_id }))
    },
    'Place lookup complete'
  );

  if (candidates.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      `I couldn't find "${name}" on Google Maps${area ? ` near ${area}` : ''}. Try the full name with the area (e.g. *Save ${name} Indiranagar*) or share the Google Maps link directly.`
    );
    return;
  }

  if (candidates.length === 1 || isStrongMatch(candidates[0], candidates[1])) {
    const place = await enrichWithPhoto(candidates[0]);
    logger.info(
      { userId: user.id, placeName: place.name, placeId: place.place_id, sourceType },
      'Saving selected place'
    );
    const saved = await createSave(user.id, {
      restaurant_name: place.name,
      google_place_id: place.place_id,
      area: extractAreaFromAddress(place.address),
      google_rating: place.rating,
      price_level: place.price_level,
      cuisine_tags: place.cuisine_tags,
      source_type: sourceType,
      source_url: sourceUrl,
      google_maps_url: place.google_maps_url,
      google_photo_url: place.google_photo_url || null,
      latitude: place.latitude,
      longitude: place.longitude
    });
    logger.info({ userId: user.id, saveId: saved.id, duplicate: saved.duplicate }, 'Save insert complete');

    if (saved.duplicate) {
      await sendMessage(user.whatsapp_number, `You've already saved *${place.name}*. 👍`);
      await logEvent(user.id, 'save_duplicate', { place_id: place.place_id });
      return;
    }

    await logEvent(user.id, 'save_success', { place_id: place.place_id, source: sourceType });
    await promptStatusAfterSave(user, saved);
    return;
  }

  await createPending(user.id, candidates, sourceUrl, sourceType);
  logger.info({ userId: user.id, candidateCount: candidates.length }, 'Created pending save for disambiguation');
  await sendMessage(user.whatsapp_number, formatCandidates(candidates));
}

async function enrichWithPhoto(place) {
  if (!place || !place.photo_name) return place;
  try {
    place.google_photo_url = await resolvePhotoUrl(place.photo_name);
  } catch (err) {
    logger.warn({ err, placeId: place.place_id }, 'Photo enrich failed (non-fatal)');
  }
  return place;
}

function isStrongMatch(top, second) {
  if (!second) return true;
  if (top.rating && second.rating && top.rating - second.rating >= 0.5) return true;
  return false;
}

export async function handleDisambiguation(user, text, pending) {
  const choice = parseInt(text.match(/\d+/)?.[0], 10);
  if (!choice || choice < 1 || choice > pending.candidates.length) {
    await sendMessage(
      user.whatsapp_number,
      `Please reply with a number from 1 to ${pending.candidates.length}.`
    );
    return;
  }

  const place = await enrichWithPhoto(pending.candidates[choice - 1]);

  const saved = await createSave(user.id, {
    restaurant_name: place.name,
    google_place_id: place.place_id,
    area: extractAreaFromAddress(place.address),
    google_rating: place.rating,
    price_level: place.price_level,
    cuisine_tags: place.cuisine_tags,
    source_type: pending.source_type,
    source_url: pending.source_url,
    google_maps_url: place.google_maps_url,
    google_photo_url: place.google_photo_url || null,
    latitude: place.latitude,
    longitude: place.longitude
  });

  await deletePending(pending.id);

  if (saved.duplicate) {
    await sendMessage(user.whatsapp_number, `You'd already saved *${place.name}*. 👍`);
    return;
  }

  await logEvent(user.id, 'save_success', { place_id: place.place_id, source: pending.source_type });
  await promptStatusAfterSave(user, saved);
}

async function promptStatusAfterSave(user, saved) {
  try {
    await createPendingStatus(user.id, saved.id);
  } catch (err) {
    logger.warn({ err, userId: user.id, saveId: saved.id }, 'Failed to create pending_status; sending plain confirmation');
    await sendMessage(user.whatsapp_number, formatSaveConfirmation(saved));
    return;
  }
  await sendMessage(user.whatsapp_number, formatSaveConfirmation(saved, { askStatus: true }));
}

const STATUS_REPLY_REGEX = /^(1|2|been|haven|haven't|want|want to go|been there)\b/i;

export function isStatusReply(body) {
  return STATUS_REPLY_REGEX.test(body.trim());
}

export async function handleStatusReply(user, text, pendingStatus) {
  const trimmed = text.trim();
  let status;

  if (/^1\b/.test(trimmed) || /^(haven|want)/i.test(trimmed)) {
    status = 'want_to_go';
  } else if (/^2\b/.test(trimmed) || /^been/i.test(trimmed)) {
    status = 'been_there';
  } else {
    await sendMessage(
      user.whatsapp_number,
      'Reply *1* (want to go) or *2* (been here). Or send another save / link.'
    );
    return;
  }

  const save = pendingStatus.save;
  if (!save) {
    logger.warn({ pendingStatus }, 'pending_status with missing save; clearing');
    await deletePendingStatus(pendingStatus.id);
    return;
  }

  try {
    await updateSaveStatus(save.id, status);
    await logEvent(user.id, 'status_set', { save_id: save.id, status });
  } catch (err) {
    logger.error({ err, saveId: save.id, status }, 'Failed to update save status');
    await sendMessage(user.whatsapp_number, "Couldn't save that just now. Try again in a sec.");
    return;
  }

  await deletePendingStatus(pendingStatus.id);
  await sendMessage(user.whatsapp_number, formatStatusUpdated(save, status));
}
