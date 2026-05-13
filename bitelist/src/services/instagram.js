import { logger } from '../utils/logger.js';

const INSTAGRAM_URL_REGEX =
  /(https?:\/\/(www\.)?instagram\.com\/(reel|p|reels)\/[A-Za-z0-9_-]+)/i;
/** Short links + common Maps hosts (incl. regional TLDs). */
const GMAPS_URL_REGEX =
  /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.[^/\s]+\/maps|maps\.google\.[^/\s]+)(?:\/[^\s]*)?)/i;

export function extractInstagramUrl(text) {
  return text?.match(INSTAGRAM_URL_REGEX)?.[1] || null;
}

export function extractGoogleMapsUrl(text) {
  const raw = text?.match(GMAPS_URL_REGEX)?.[1];
  if (!raw) return null;
  return raw.replace(/[),.;]+$/g, '');
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

/**
 * Best-effort place label from a resolved Google Maps URL.
 */
export function extractPlaceNameFromMapsUrl(resolvedUrl) {
  if (!resolvedUrl) return null;
  const place = resolvedUrl.match(/\/place\/([^/?#]+)/i);
  if (place) {
    let seg = place[1].split('@')[0];
    try {
      seg = decodeURIComponent(seg.replace(/\+/g, ' '));
    } catch {
      seg = seg.replace(/\+/g, ' ');
    }
    const trimmed = seg.trim();
    return trimmed || null;
  }
  const query =
    resolvedUrl.match(/[?&]query=([^&]+)/i)?.[1] || resolvedUrl.match(/[?&]q=([^&]+)/i)?.[1];
  if (query) {
    const raw = query.replace(/\+/g, ' ');
    try {
      const q = decodeURIComponent(raw).trim();
      return q || null;
    } catch {
      try {
        const q = decodeURI(raw).trim();
        return q || null;
      } catch {
        return raw.trim() || null;
      }
    }
  }
  return null;
}

async function drainResponseBody(response) {
  try {
    await response.arrayBuffer();
  } catch {
    try {
      await response.text();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Follow Maps / goo.gl links without `redirect: follow`.
 * Google's first HTTP `Location` usually includes `?q=…`; the final HTML page is often a
 * bot/consent shell on cloud IPs, so we parse each redirect target before following further.
 */
export async function resolveGoogleMapsPlaceName(shortUrl) {
  let url = shortUrl;
  const seen = new Set();

  for (let hop = 0; hop < 15; hop++) {
    if (seen.has(url)) {
      logger.warn({ url }, 'Maps resolve: redirect loop');
      break;
    }
    seen.add(url);

    const direct = extractPlaceNameFromMapsUrl(url);
    if (direct) return { placeName: direct, resolvedUrl: url };

    const response = await fetch(url, {
      redirect: 'manual',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000)
    });

    const loc = response.headers.get('location');
    if (loc && response.status >= 300 && response.status < 400) {
      await drainResponseBody(response);
      const next = new URL(loc, url).href;
      const fromLoc = extractPlaceNameFromMapsUrl(next);
      if (fromLoc) {
        return { placeName: fromLoc, resolvedUrl: next };
      }
      url = next;
      continue;
    }

    const resolvedUrl = response.url;
    const fromUrl = extractPlaceNameFromMapsUrl(resolvedUrl);
    if (fromUrl) {
      await drainResponseBody(response);
      return { placeName: fromUrl, resolvedUrl };
    }

    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (response.ok && ct.includes('text/html')) {
      const html = await response.text();
      const og =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
      if (og) {
        const cleaned = og.replace(/\s*[-–|:]\s*Google\s*Maps.*$/i, '').trim();
        if (cleaned) return { placeName: cleaned, resolvedUrl };
      }
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
      if (title) {
        const cleaned = title.replace(/\s*[-–|:]\s*Google\s*Maps.*$/i, '').trim();
        if (cleaned) return { placeName: cleaned, resolvedUrl };
      }
    } else {
      await drainResponseBody(response);
    }

    logger.warn(
      { hop, status: response.status, resolvedUrl, hadLocation: Boolean(loc) },
      'Maps resolve: no place name from URL or HTML'
    );
    return { placeName: null, resolvedUrl: resolvedUrl || url };
  }

  return { placeName: null, resolvedUrl: url };
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
