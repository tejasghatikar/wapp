import { logger } from '../utils/logger.js';

const INSTAGRAM_URL_REGEX =
  /(https?:\/\/(www\.)?instagram\.com\/(reel|p|reels)\/[A-Za-z0-9_-]+)/i;
const GMAPS_URL_REGEX =
  /(https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps)[^\s]+)/i;

export function extractInstagramUrl(text) {
  return text?.match(INSTAGRAM_URL_REGEX)?.[1] || null;
}

export function extractGoogleMapsUrl(text) {
  return text?.match(GMAPS_URL_REGEX)?.[1] || null;
}

export async function fetchReelMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Instagram fetch failed');
      return { success: false, reason: 'fetch_failed' };
    }

    const html = await response.text();

    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
    const description = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];

    const rawText = [title, description].filter(Boolean).join(' — ').trim();

    if (!rawText) {
      return { success: false, reason: 'no_metadata' };
    }

    return { success: true, title, description, image, rawText };
  } catch (err) {
    logger.error({ err, url }, 'Instagram fetch threw');
    return { success: false, reason: 'exception' };
  }
}
