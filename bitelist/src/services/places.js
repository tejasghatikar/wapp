import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const BANGALORE_CENTER = { latitude: 12.9716, longitude: 77.5946 };
const SEARCH_RADIUS_M = 30000;

export async function checkPlacesHealth() {
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.google.placesApiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName'
      },
      body: JSON.stringify({
        textQuery: 'Toit Indiranagar Bangalore',
        regionCode: 'IN',
        locationBias: {
          circle: {
            center: BANGALORE_CENTER,
            radius: SEARCH_RADIUS_M
          }
        }
      })
    });

    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: body.slice(0, 500)
      };
    }

    const data = JSON.parse(body);
    return { ok: true, status: response.status, placeCount: data.places?.length || 0 };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function searchPlaces(query, area = null) {
  const textQuery = area ? `${query} ${area} Bangalore` : `${query} Bangalore`;

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.google.placesApiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.priceLevel',
          'places.types',
          'places.googleMapsUri',
          'places.location'
        ].join(',')
      },
      body: JSON.stringify({
        textQuery,
        regionCode: 'IN',
        locationBias: {
          circle: {
            center: BANGALORE_CENTER,
            radius: SEARCH_RADIUS_M
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, 'Places API error');
      return [];
    }

    const data = await response.json();
    return (data.places || []).slice(0, 5).map(normalizePlace);
  } catch (err) {
    logger.error({ err }, 'Places search failed');
    return [];
  }
}

function normalizePlace(p) {
  const priceMap = {
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4
  };
  return {
    place_id: p.id,
    name: p.displayName?.text,
    address: p.formattedAddress,
    rating: p.rating,
    price_level: priceMap[p.priceLevel] || null,
    types: p.types || [],
    google_maps_url: p.googleMapsUri,
    latitude: p.location?.latitude,
    longitude: p.location?.longitude,
    cuisine_tags: inferCuisineTags(p.types || [])
  };
}

const TYPE_TO_CUISINE = {
  indian_restaurant: 'indian',
  chinese_restaurant: 'chinese',
  italian_restaurant: 'italian',
  japanese_restaurant: 'japanese',
  thai_restaurant: 'thai',
  mexican_restaurant: 'mexican',
  fast_food_restaurant: 'fast food',
  pizza_restaurant: 'pizza',
  seafood_restaurant: 'seafood',
  steak_house: 'steak',
  vegetarian_restaurant: 'vegetarian',
  vegan_restaurant: 'vegan',
  cafe: 'cafe',
  bakery: 'bakery',
  bar: 'bar',
  pub: 'pub',
  night_club: 'club',
  ice_cream_shop: 'ice cream',
  coffee_shop: 'coffee'
};

function inferCuisineTags(types) {
  const tags = new Set();
  for (const t of types) {
    if (TYPE_TO_CUISINE[t]) tags.add(TYPE_TO_CUISINE[t]);
  }
  return [...tags];
}

export function extractAreaFromAddress(address) {
  if (!address) return null;
  const parts = address.split(',').map((s) => s.trim());
  const bangaloreIdx = parts.findIndex((p) => /bengaluru|bangalore/i.test(p));
  if (bangaloreIdx > 0) return parts[bangaloreIdx - 1];
  return null;
}
