import { extractionPrompt } from '../prompts/extract.js';
import { callClaudeJson } from '../services/claude.js';
import {
  fetchReelMetadata,
  extractInstagramUrl,
  extractGoogleMapsUrl
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

  const extracted = await callClaudeJson(extractionPrompt(meta.rawText));

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
  if (!url) return;

  await logEvent(user.id, 'save_attempt', { source: 'google_maps', url });

  try {
    const response = await fetch(url, { redirect: 'follow' });
    const resolvedUrl = response.url;
    const match = resolvedUrl.match(/\/place\/([^/]+)/);
    const placeName = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;

    if (!placeName) {
      await sendMessage(
        user.whatsapp_number,
        "Couldn't read that Google Maps link. Just type the name like *Save Toit Indiranagar*"
      );
      return;
    }

    await runPlaceLookup(user, placeName, null, { sourceType: 'google_maps', sourceUrl: url });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve Google Maps link');
    await sendMessage(
      user.whatsapp_number,
      "That link didn't open. Try typing the name: *Save Toit Indiranagar*"
    );
  }
}

async function runPlaceLookup(user, name, area, { sourceType, sourceUrl = null }) {
  const candidates = await searchPlaces(name, area);

  if (candidates.length === 0) {
    await sendMessage(
      user.whatsapp_number,
      `Couldn't find "${name}" on Maps. Want to save it anyway? Reply *yes* or fix the name.`
    );
    return;
  }

  if (candidates.length === 1 || isStrongMatch(candidates[0], candidates[1])) {
    const place = candidates[0];
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
