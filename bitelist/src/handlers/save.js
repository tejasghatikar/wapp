import { extractionPrompt } from '../prompts/extract.js';
import { callClaudeJson, ClaudeUnavailableError } from '../services/claude.js';
import {
  fetchReelMetadata,
  extractInstagramUrl,
  extractGoogleMapsUrl,
  resolveGoogleMapsPlaceName
} from '../services/instagram.js';
import { searchPlaces, extractAreaFromAddress } from '../services/places.js';
import {
  createSave,
  createPending,
  logEvent,
  deletePending
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveConfirmation, formatCandidates } from '../utils/format.js';
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

export async function handleManualSave(user, text) {
  await logEvent(user.id, 'save_attempt', { source: 'manual' });

  const cleaned = text.replace(/^(save|add)\s+/i, '').trim();
  if (!cleaned) {
    await sendMessage(user.whatsapp_number, 'Save what? Try: *Save Toit Indiranagar*');
    return;
  }

  const parts = cleaned.split(/\s+/);
  const knownAreas = [
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
  const lastWord = parts[parts.length - 1].toLowerCase();
  const hasArea = knownAreas.some((a) => lastWord.includes(a));

  const name = hasArea ? parts.slice(0, -1).join(' ') : cleaned;
  const area = hasArea ? parts[parts.length - 1] : null;

  await runPlaceLookup(user, name, area, { sourceType: 'manual' });
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
    const place = candidates[0];
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
    await sendMessage(user.whatsapp_number, formatSaveConfirmation(saved));
    return;
  }

  await createPending(user.id, candidates, sourceUrl, sourceType);
  logger.info({ userId: user.id, candidateCount: candidates.length }, 'Created pending save for disambiguation');
  await sendMessage(user.whatsapp_number, formatCandidates(candidates));
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

  const place = pending.candidates[choice - 1];

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
    latitude: place.latitude,
    longitude: place.longitude
  });

  await deletePending(pending.id);

  if (saved.duplicate) {
    await sendMessage(user.whatsapp_number, `You'd already saved *${place.name}*. 👍`);
    return;
  }

  await logEvent(user.id, 'save_success', { place_id: place.place_id, source: pending.source_type });
  await sendMessage(user.whatsapp_number, formatSaveConfirmation(saved));
}
