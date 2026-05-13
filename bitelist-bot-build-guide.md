# BiteList — WhatsApp Bot Build Guide

> Implementation guide for Claude Code. Build the bot in 2 days. No webapp tabs, no friend graph, no swipe UI. Just: forward a reel → bot saves it. Ask "where should I eat in Indiranagar?" → bot answers from your saves.

---

## 0. What You're Building

A WhatsApp bot that:
1. Saves restaurants when users forward Instagram reels, Google Maps links, or type `Save <name>`.
2. Returns a filtered list when users ask natural-language questions about their saved places.
3. Generates a public read-only share link of any user's list.

That's the whole product. If a feature isn't on that list, don't build it yet.

---

## 1. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Web framework | Express | ^4.19 |
| Module system | ESM (`"type": "module"`) | — |
| WhatsApp gateway | Twilio (Sandbox for dev → Business for prod) | `twilio` ^5 |
| Database | Supabase (Postgres) | `@supabase/supabase-js` ^2 |
| LLM | Anthropic Claude Sonnet 4 | `@anthropic-ai/sdk` ^0.30+ |
| Restaurant data | Google Places API (New) | direct fetch |
| Hosting | Render (free → $7/mo) | — |
| Dev tunnel | ngrok | — |
| Logging | pino | ^9 |
| Env loading | dotenv | ^16 |

---

## 2. Pre-Build Setup (Do This BEFORE Writing Code)

These steps take ~45 minutes total. Do them in order. Each one unblocks the next.

### 2.1 Twilio WhatsApp Sandbox

1. Sign up at https://www.twilio.com (free $15 trial credit).
2. Console → Develop → Messaging → Try it out → Send a WhatsApp message.
3. Note three things:
   - Account SID (starts with `AC...`)
   - Auth Token (click to reveal)
   - Sandbox number (e.g. `+14155238886`) and the `join <two-words>` join code
4. From your own WhatsApp, send `join <two-words>` to the sandbox number. You should get a confirmation.
5. Leave the webhook URL blank for now — we'll set it after ngrok is running.

### 2.2 Supabase Project

1. Sign up at https://supabase.com (free).
2. Create a new project. Region: `ap-south-1` (Mumbai) for lowest latency from Bangalore.
3. Once provisioned, go to Project Settings → API. Note:
   - Project URL (`https://xxx.supabase.co`)
   - `service_role` key (use this server-side only, NEVER expose to client)
4. Go to SQL Editor → paste the schema from §4 → Run.

### 2.3 Anthropic API Key

1. Go to https://console.anthropic.com.
2. Settings → API Keys → Create Key. Save it.
3. Add at least $5 of credits to avoid rate-limit issues during testing.

### 2.4 Google Places API Key

1. Go to https://console.cloud.google.com.
2. Create a new project: `bitelist-mvp`.
3. APIs & Services → Library → enable **Places API (New)**.
4. APIs & Services → Credentials → Create Credentials → API Key.
5. Restrict the key (recommended): under Application restrictions choose "None" for now (lock down later); under API restrictions select "Places API (New)".
6. Set up billing (required even for free tier). Google gives ~$200/month free credit for Maps Platform — you'll use under $5 in the test.

### 2.5 ngrok

1. Sign up at https://ngrok.com (free).
2. Install: `brew install ngrok` (Mac) or download from site.
3. Add your authtoken: `ngrok config add-authtoken <YOUR_TOKEN>`

---

## 3. Repo Scaffold

### 3.1 Init Commands

```bash
mkdir bitelist && cd bitelist
git init
npm init -y
npm install express twilio @supabase/supabase-js @anthropic-ai/sdk dotenv pino pino-pretty
npm install --save-dev nodemon
```

### 3.2 Folder Structure

```
bitelist/
├── .env
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
├── public/
│   └── list.html              # Template for shared list pages
├── sql/
│   └── schema.sql
└── src/
    ├── index.js               # Express + webhook entrypoint
    ├── config.js              # Env var loading & validation
    ├── twilio/
    │   ├── client.js          # Twilio send helpers
    │   └── parser.js          # Parse incoming webhook
    ├── handlers/
    │   ├── router.js          # Intent classification
    │   ├── onboarding.js
    │   ├── save.js
    │   ├── query.js
    │   └── commands.js        # help, list, count, undo, delete, share
    ├── services/
    │   ├── db.js              # Supabase client + repo methods
    │   ├── claude.js          # Anthropic SDK wrapper
    │   ├── places.js          # Google Places API
    │   └── instagram.js       # Reel URL fetch + og-tag extraction
    ├── prompts/
    │   ├── extract.js
    │   └── query.js
    ├── routes/
    │   └── share.js           # GET /list/:slug → render public page
    └── utils/
        ├── logger.js
        └── format.js          # WhatsApp message formatting
```

### 3.3 package.json

```json
{
  "name": "bitelist",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js"
  },
  "engines": {
    "node": "20.x"
  }
}
```

### 3.4 .env.example

```bash
# Server
PORT=3000
NODE_ENV=development
PUBLIC_URL=https://your-ngrok-url.ngrok-free.app

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Anthropic
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-20250514

# Google
GOOGLE_PLACES_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Feature flags
ALLOW_NEW_USERS=true
LOG_LEVEL=info
```

### 3.5 .gitignore

```
node_modules/
.env
.DS_Store
*.log
```

---

## 4. Database Schema

Paste into Supabase SQL Editor and run:

```sql
create extension if not exists "uuid-ossp";

-- Users
create table users (
  id uuid primary key default uuid_generate_v4(),
  whatsapp_number text unique not null,
  display_name text,
  share_slug text unique,
  onboarded_at timestamptz,
  created_at timestamptz default now()
);

-- Saves
create table saves (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  restaurant_name text not null,
  google_place_id text,
  area text,
  city text default 'Bangalore',
  google_rating numeric(2,1),
  price_level int,
  cuisine_tags text[] default '{}',
  source_type text,
  source_url text,
  notes text,
  google_maps_url text,
  latitude double precision,
  longitude double precision,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create index idx_saves_user_area
  on saves(user_id, area)
  where deleted_at is null;

create index idx_saves_user_created
  on saves(user_id, created_at desc)
  where deleted_at is null;

create unique index idx_saves_user_place
  on saves(user_id, google_place_id)
  where deleted_at is null and google_place_id is not null;

-- Pending state for multi-turn flows (disambiguation)
create table pending_saves (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  candidates jsonb not null,
  source_url text,
  source_type text,
  expires_at timestamptz default (now() + interval '10 minutes'),
  created_at timestamptz default now()
);

create index idx_pending_user_created
  on pending_saves(user_id, created_at desc);

-- Events (analytics)
create table events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index idx_events_user_type_created
  on events(user_id, event_type, created_at desc);
```

---

## 5. Build the Bot (File by File)

Each file below has its full implementation or a tight spec Claude Code can fill in.

### 5.1 `src/config.js`

```javascript
import dotenv from 'dotenv';
dotenv.config();

const required = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM',
  'ANTHROPIC_API_KEY',
  'GOOGLE_PLACES_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicUrl: process.env.PUBLIC_URL,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
  },
  google: {
    placesApiKey: process.env.GOOGLE_PLACES_API_KEY
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  },
  allowNewUsers: process.env.ALLOW_NEW_USERS !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info'
};
```

### 5.2 `src/utils/logger.js`

```javascript
import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});
```

### 5.3 `src/services/db.js`

Repository pattern — every database call goes through here. No raw Supabase calls in handlers.

```javascript
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { randomBytes } from 'crypto';

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

// ── Users ────────────────────────────────────────────────────────────────

export async function getUserByPhone(whatsappNumber) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createUser(whatsappNumber) {
  const shareSlug = randomBytes(5).toString('hex');
  const { data, error } = await supabase
    .from('users')
    .insert({
      whatsapp_number: whatsappNumber,
      share_slug: shareSlug,
      onboarded_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserBySlug(slug) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('share_slug', slug)
    .maybeSingle();
  return data;
}

// ── Saves ────────────────────────────────────────────────────────────────

export async function createSave(userId, save) {
  const { data, error } = await supabase
    .from('saves')
    .insert({ user_id: userId, ...save })
    .select()
    .single();
  if (error) {
    // Handle duplicate constraint gracefully
    if (error.code === '23505') return { duplicate: true };
    throw error;
  }
  return data;
}

export async function getRecentSaves(userId, limit = 200) {
  const { data, error } = await supabase
    .from('saves')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getSavesByArea(userId, area) {
  const { data, error } = await supabase
    .from('saves')
    .select('*')
    .eq('user_id', userId)
    .ilike('area', `%${area}%`)
    .is('deleted_at', null)
    .order('google_rating', { ascending: false, nullsLast: true });
  if (error) throw error;
  return data || [];
}

export async function softDeleteSave(saveId) {
  const { error } = await supabase
    .from('saves')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', saveId);
  if (error) throw error;
}

export async function getMostRecentSave(userId) {
  const { data } = await supabase
    .from('saves')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function findSaveByName(userId, name) {
  const { data } = await supabase
    .from('saves')
    .select('*')
    .eq('user_id', userId)
    .ilike('restaurant_name', `%${name}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function countSaves(userId) {
  const { count } = await supabase
    .from('saves')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);
  return count || 0;
}

// ── Pending saves ────────────────────────────────────────────────────────

export async function createPending(userId, candidates, sourceUrl, sourceType) {
  const { data, error } = await supabase
    .from('pending_saves')
    .insert({
      user_id: userId,
      candidates,
      source_url: sourceUrl,
      source_type: sourceType
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestPending(userId) {
  const { data } = await supabase
    .from('pending_saves')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function deletePending(pendingId) {
  await supabase.from('pending_saves').delete().eq('id', pendingId);
}

// ── Events ───────────────────────────────────────────────────────────────

export async function logEvent(userId, eventType, payload = {}) {
  try {
    await supabase.from('events').insert({
      user_id: userId,
      event_type: eventType,
      payload
    });
  } catch (err) {
    logger.warn({ err, userId, eventType }, 'Failed to log event');
  }
}
```

### 5.4 `src/services/claude.js`

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Calls Claude and returns parsed JSON.
 * Strips ```json fences defensively.
 */
export async function callClaudeJson(prompt, options = {}) {
  const { maxTokens = 1024, systemPrompt = 'You return only valid JSON. No preamble, no markdown.' } = options;
  
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }]
  });
  
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error({ raw: text, cleaned }, 'Claude returned invalid JSON');
    throw new Error('Invalid JSON from Claude');
  }
}
```

### 5.5 `src/services/places.js`

```javascript
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const BANGALORE_CENTER = { latitude: 12.9716, longitude: 77.5946 };
const SEARCH_RADIUS_M = 30000;

/**
 * Search Google Places for restaurants matching the query.
 * Returns up to 5 candidates with rating, types, location.
 */
export async function searchPlaces(query, area = null) {
  const textQuery = area
    ? `${query} ${area} Bangalore`
    : `${query} Bangalore`;
  
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
  const priceMap = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
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

/**
 * Extract area from a formatted address.
 * Bangalore addresses typically have area as the second-to-last meaningful component.
 */
export function extractAreaFromAddress(address) {
  if (!address) return null;
  // Address format: "Restaurant Name, Street, Area, Bangalore, Karnataka 5xxxxx, India"
  const parts = address.split(',').map(s => s.trim());
  // Find Bangalore index, area is just before
  const bangaloreIdx = parts.findIndex(p => /bengaluru|bangalore/i.test(p));
  if (bangaloreIdx > 0) return parts[bangaloreIdx - 1];
  return null;
}
```

### 5.6 `src/services/instagram.js`

```javascript
import { logger } from '../utils/logger.js';

const INSTAGRAM_URL_REGEX = /(https?:\/\/(www\.)?instagram\.com\/(reel|p|reels)\/[A-Za-z0-9_-]+)/i;
const GMAPS_URL_REGEX = /(https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps)[^\s]+)/i;

export function extractInstagramUrl(text) {
  return text?.match(INSTAGRAM_URL_REGEX)?.[1] || null;
}

export function extractGoogleMapsUrl(text) {
  return text?.match(GMAPS_URL_REGEX)?.[1] || null;
}

/**
 * Fetch Instagram reel page and extract og: meta tags.
 * Best-effort; expect failures and fall back to asking the user.
 */
export async function fetchReelMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
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
```

### 5.7 `src/prompts/extract.js`

```javascript
export const extractionPrompt = (rawText) => `You extract restaurant information from Instagram reel metadata for an Indian user in Bangalore.

Input text (caption / og-description from Instagram):
"""
${rawText}
"""

Return ONLY valid JSON, no preamble or markdown. Schema:
{
  "restaurant_name": string,
  "area": string | null,
  "city": string,
  "cuisine_hints": string[],
  "confidence": number
}

Rules:
- "area" = Bangalore neighborhood like "Indiranagar", "JP Nagar", "Koramangala", "HSR Layout", "Whitefield", "MG Road", "Jayanagar", "Malleshwaram", "Brigade Road", "Church Street". Null if not mentioned.
- "city" = "Bangalore" by default. Only change if another Indian city is clearly mentioned.
- "confidence" = 0.0 to 1.0. Rate how sure you are about the restaurant name.
  - >0.8: restaurant name explicitly mentioned and unambiguous
  - 0.5-0.8: name inferred from context but reasonable
  - <0.5: unclear, ambiguous, or generic content
- "cuisine_hints": lowercase tags from this list when applicable: italian, chinese, indian, north indian, south indian, biryani, cafe, microbrewery, bar, pub, vegetarian, vegan, continental, japanese, thai, mexican, pizza, dessert, bakery, coffee.

If the input is clearly NOT about a restaurant, return: {"restaurant_name": "", "area": null, "city": "Bangalore", "cuisine_hints": [], "confidence": 0}`;
```

### 5.8 `src/prompts/query.js`

```javascript
export const queryPrompt = (userQuery, userSaves) => {
  const compact = userSaves.map(s => ({
    id: s.id,
    name: s.restaurant_name,
    area: s.area,
    rating: s.google_rating,
    price_level: s.price_level,
    cuisine_tags: s.cuisine_tags
  }));
  
  return `You help a user find restaurants from their personal saved list.

User's saved restaurants (JSON):
${JSON.stringify(compact, null, 2)}

User's query: "${userQuery}"

Return ONLY valid JSON. Schema:
{
  "matched_ids": string[],
  "reasoning": string
}

Matching rules:
- If query mentions an area (Indiranagar, JP Nagar, Koramangala, etc.), filter to that area first.
- If query mentions cuisine (italian, drinks, biryani, coffee, etc.), filter to matching cuisine_tags.
- If query mentions vibe ("date", "casual", "fancy", "drinks"), use cuisine_tags + price_level as proxies. Pubs/microbreweries match "drinks". Higher price_level matches "fancy". Cafes match "casual".
- If query is generic ("where should I eat", "any recos"), return top-rated saves by rating.
- Always cap at 5 results, ordered most-relevant first.
- If no good matches, return empty matched_ids array.
- "reasoning" is one short internal line, never shown to user.

Be liberal in interpretation. Indian users often mix English with Hindi/Kannada — "khaane ka kuch achha hai?" = "is there something good to eat?" Map to top-rated.`;
};
```

### 5.9 `src/utils/format.js`

```javascript
/**
 * Format saved restaurants as a numbered WhatsApp message.
 */
export function formatSaveList(saves, header = null) {
  if (!saves || saves.length === 0) {
    return "Nothing matches yet. Try saving a few places first by forwarding Instagram reels or typing 'Save <name> <area>'.";
  }
  
  const lines = [];
  if (header) lines.push(header, '');
  
  saves.forEach((s, i) => {
    const rating = s.google_rating ? `⭐${s.google_rating}` : '';
    const price = s.price_level ? '₹'.repeat(s.price_level) : '';
    const cuisine = s.cuisine_tags?.length ? s.cuisine_tags.slice(0, 2).join(', ') : '';
    const meta = [cuisine, price].filter(Boolean).join(' · ');
    
    lines.push(`${i + 1}. *${s.restaurant_name}*${s.area ? `, ${s.area}` : ''} ${rating}`);
    if (meta) lines.push(`   ${meta}`);
    if (s.google_maps_url) lines.push(`   📍 ${s.google_maps_url}`);
    lines.push('');
  });
  
  return lines.join('\n').trim();
}

/**
 * Format Google Places candidates for disambiguation.
 */
export function formatCandidates(candidates) {
  const lines = ['I found a few options — reply with the number:', ''];
  candidates.forEach((c, i) => {
    const rating = c.rating ? `⭐${c.rating}` : '';
    lines.push(`${i + 1}. *${c.name}* ${rating}`);
    lines.push(`   ${c.address}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function formatSaveConfirmation(save) {
  const rating = save.google_rating ? `⭐${save.google_rating}` : '';
  const cuisine = save.cuisine_tags?.length ? save.cuisine_tags.slice(0, 2).join(', ') : '';
  const price = save.price_level ? '₹'.repeat(save.price_level) : '';
  const meta = [cuisine, price].filter(Boolean).join(' · ');
  
  return [
    `✅ Saved: *${save.restaurant_name}*${save.area ? `, ${save.area}` : ''}`,
    rating && meta ? `${rating} · ${meta}` : (rating || meta),
    save.google_maps_url ? `📍 ${save.google_maps_url}` : '',
    '',
    `Reply with any notes if you want to add them, or just keep forwarding reels.`
  ].filter(Boolean).join('\n');
}
```

### 5.10 `src/twilio/client.js`

```javascript
import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export async function sendMessage(to, body) {
  try {
    const message = await client.messages.create({
      from: config.twilio.from,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body
    });
    logger.debug({ sid: message.sid, to }, 'Sent WhatsApp message');
    return message;
  } catch (err) {
    logger.error({ err, to }, 'Failed to send WhatsApp message');
    throw err;
  }
}
```

### 5.11 `src/twilio/parser.js`

```javascript
/**
 * Parse incoming Twilio webhook body.
 * Twilio sends URL-encoded form data.
 */
export function parseIncoming(body) {
  return {
    from: body.From,              // "whatsapp:+919876543210"
    to: body.To,
    body: (body.Body || '').trim(),
    messageSid: body.MessageSid,
    numMedia: parseInt(body.NumMedia || '0', 10)
  };
}
```

### 5.12 `src/handlers/onboarding.js`

```javascript
import { createUser, logEvent } from '../services/db.js';
import { sendMessage } from '../twilio/client.js';

const WELCOME = `Hey 👋 I'm *BiteList* — your personal restaurant memory for Bangalore.

Best pubs in JP Nagar? Date spots in Indiranagar? Cafes near Koramangala? I help you remember the places you wanted to try and find them when you need them.

Here's what I do:
• Forward me any Instagram reel of a restaurant → I save it
• Type *Save Toit Indiranagar* → I save that too
• Ask *where should I go in Indiranagar?* → I show you your list

No app. No login. Your number is your account.

Try forwarding a reel right now, or type *help* anytime.`;

export async function handleOnboarding(from) {
  const user = await createUser(from);
  await logEvent(user.id, 'onboarded', { source: 'whatsapp' });
  await sendMessage(from, WELCOME);
  return user;
}
```

### 5.13 `src/handlers/save.js`

This is the meatiest handler. Three entry points: reel URL, Google Maps URL, manual save. All converge on Google Places lookup → disambiguation or direct save.

```javascript
import { extractionPrompt } from '../prompts/extract.js';
import { callClaudeJson } from '../services/claude.js';
import { fetchReelMetadata, extractInstagramUrl, extractGoogleMapsUrl } from '../services/instagram.js';
import { searchPlaces, extractAreaFromAddress } from '../services/places.js';
import { createSave, createPending, logEvent } from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveConfirmation, formatCandidates } from '../utils/format.js';
import { logger } from '../utils/logger.js';

/**
 * Entry: user forwarded an Instagram reel URL.
 */
export async function handleReelSave(user, text) {
  const url = extractInstagramUrl(text);
  if (!url) return;
  
  await logEvent(user.id, 'save_attempt', { source: 'instagram_reel', url });
  
  const meta = await fetchReelMetadata(url);
  
  if (!meta.success) {
    await sendMessage(user.whatsapp_number,
      "I couldn't read that reel (Instagram blocked it). What's the restaurant name and area? Reply like: *Toit Indiranagar*");
    await createPending(user.id, [], url, 'instagram_reel');
    return;
  }
  
  const extracted = await callClaudeJson(extractionPrompt(meta.rawText));
  
  if (extracted.confidence < 0.6 || !extracted.restaurant_name) {
    await sendMessage(user.whatsapp_number,
      "I couldn't pin down the restaurant from this reel. What's the name and area? Reply like: *Toit Indiranagar*");
    await createPending(user.id, [], url, 'instagram_reel');
    return;
  }
  
  await runPlaceLookup(user, extracted.restaurant_name, extracted.area, {
    sourceType: 'instagram_reel',
    sourceUrl: url
  });
}

/**
 * Entry: user typed "Save Toit Indiranagar" or similar.
 */
export async function handleManualSave(user, text) {
  await logEvent(user.id, 'save_attempt', { source: 'manual' });
  
  // Strip "save" / "add" prefix
  const cleaned = text.replace(/^(save|add)\s+/i, '').trim();
  if (!cleaned) {
    await sendMessage(user.whatsapp_number, "Save what? Try: *Save Toit Indiranagar*");
    return;
  }
  
  // Naive split: last word might be area, but Places handles either way
  const parts = cleaned.split(/\s+/);
  const knownAreas = ['indiranagar', 'koramangala', 'jp', 'jayanagar', 'hsr', 'whitefield', 'malleshwaram', 'mg', 'brigade'];
  const lastWord = parts[parts.length - 1].toLowerCase();
  const hasArea = knownAreas.some(a => lastWord.includes(a));
  
  const name = hasArea ? parts.slice(0, -1).join(' ') : cleaned;
  const area = hasArea ? parts[parts.length - 1] : null;
  
  await runPlaceLookup(user, name, area, { sourceType: 'manual' });
}

/**
 * Entry: user forwarded a Google Maps share link.
 */
export async function handleGoogleMapsSave(user, text) {
  const url = extractGoogleMapsUrl(text);
  if (!url) return;
  
  await logEvent(user.id, 'save_attempt', { source: 'google_maps', url });
  
  // Google Maps short links redirect to the place. Fetch with redirect to resolve.
  try {
    const response = await fetch(url, { redirect: 'follow' });
    const resolvedUrl = response.url;
    // The resolved URL typically contains "/place/<NAME>/..." — extract name
    const match = resolvedUrl.match(/\/place\/([^/]+)/);
    const placeName = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
    
    if (!placeName) {
      await sendMessage(user.whatsapp_number, "Couldn't read that Google Maps link. Just type the name like *Save Toit Indiranagar*");
      return;
    }
    
    await runPlaceLookup(user, placeName, null, { sourceType: 'google_maps', sourceUrl: url });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve Google Maps link');
    await sendMessage(user.whatsapp_number, "That link didn't open. Try typing the name: *Save Toit Indiranagar*");
  }
}

/**
 * Common path: name + (optional) area → Places search → save or disambiguate.
 */
async function runPlaceLookup(user, name, area, { sourceType, sourceUrl = null }) {
  const candidates = await searchPlaces(name, area);
  
  if (candidates.length === 0) {
    await sendMessage(user.whatsapp_number,
      `Couldn't find "${name}" on Maps. Want to save it anyway? Reply *yes* or fix the name.`);
    // Note: "save anyway" flow is out of scope for v0 — log and stop
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
  
  // Multiple candidates → disambiguate
  await createPending(user.id, candidates, sourceUrl, sourceType);
  await sendMessage(user.whatsapp_number, formatCandidates(candidates));
}

function isStrongMatch(top, second) {
  if (!second) return true;
  // If top is clearly higher-rated and other has low rating or differs significantly, treat as strong
  if (top.rating && second.rating && top.rating - second.rating >= 0.5) return true;
  return false;
}

/**
 * Entry: user replied with a number (1-5) to a candidate list.
 */
export async function handleDisambiguation(user, text, pending) {
  const choice = parseInt(text.match(/\d+/)?.[0], 10);
  if (!choice || choice < 1 || choice > pending.candidates.length) {
    await sendMessage(user.whatsapp_number,
      `Please reply with a number from 1 to ${pending.candidates.length}.`);
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
  
  // Clean up pending row regardless of duplicate
  const { deletePending } = await import('../services/db.js');
  await deletePending(pending.id);
  
  if (saved.duplicate) {
    await sendMessage(user.whatsapp_number, `You'd already saved *${place.name}*. 👍`);
    return;
  }
  
  await logEvent(user.id, 'save_success', { place_id: place.place_id, source: pending.source_type });
  await sendMessage(user.whatsapp_number, formatSaveConfirmation(saved));
}
```

### 5.14 `src/handlers/query.js`

```javascript
import { getRecentSaves, logEvent } from '../services/db.js';
import { callClaudeJson } from '../services/claude.js';
import { queryPrompt } from '../prompts/query.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';

export async function handleQuery(user, text) {
  const saves = await getRecentSaves(user.id, 200);
  
  if (saves.length === 0) {
    await sendMessage(user.whatsapp_number,
      "You haven't saved anything yet. Forward me an Instagram reel or type *Save <name> <area>* to get started.");
    return;
  }
  
  await logEvent(user.id, 'query', { text, save_count: saves.length });
  
  const result = await callClaudeJson(queryPrompt(text, saves));
  const matched = result.matched_ids
    .map(id => saves.find(s => s.id === id))
    .filter(Boolean)
    .slice(0, 5);
  
  if (matched.length === 0) {
    await sendMessage(user.whatsapp_number,
      `Nothing in your list matches that. You have ${saves.length} saves total — try *list* to see them, or save more places.`);
    return;
  }
  
  const header = `Here are ${matched.length} from your list:`;
  await sendMessage(user.whatsapp_number, formatSaveList(matched, header));
}
```

### 5.15 `src/handlers/commands.js`

```javascript
import {
  getRecentSaves,
  getMostRecentSave,
  softDeleteSave,
  findSaveByName,
  countSaves,
  logEvent
} from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { formatSaveList } from '../utils/format.js';
import { config } from '../config.js';

const HELP = `*BiteList* commands:

• Forward any *Instagram reel* → saves the restaurant
• *Save Toit Indiranagar* → manual save
• Ask *where should I go in JP Nagar* → query your list
• *list* → your last 10 saves
• *count* → how many you've saved
• *undo* → remove last save
• *delete <name>* → remove a specific save
• *share* → public link of your list

Your phone number is your account. No app needed.`;

export async function handleHelp(user) {
  await logEvent(user.id, 'command', { name: 'help' });
  await sendMessage(user.whatsapp_number, HELP);
}

export async function handleList(user) {
  await logEvent(user.id, 'command', { name: 'list' });
  const saves = await getRecentSaves(user.id, 10);
  await sendMessage(user.whatsapp_number, formatSaveList(saves, `Your last ${saves.length} saves:`));
}

export async function handleCount(user) {
  const total = await countSaves(user.id);
  await logEvent(user.id, 'command', { name: 'count', total });
  await sendMessage(user.whatsapp_number,
    `You've saved *${total}* restaurants. Keep going.`);
}

export async function handleUndo(user) {
  const latest = await getMostRecentSave(user.id);
  if (!latest) {
    await sendMessage(user.whatsapp_number, "Nothing to undo — your list is empty.");
    return;
  }
  await softDeleteSave(latest.id);
  await logEvent(user.id, 'command', { name: 'undo', save_id: latest.id });
  await sendMessage(user.whatsapp_number, `Removed: *${latest.restaurant_name}*.`);
}

export async function handleDelete(user, text) {
  const name = text.replace(/^(delete|remove)\s+/i, '').trim();
  if (!name) {
    await sendMessage(user.whatsapp_number, "Delete what? Try: *delete Toit*");
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

export async function handleShare(user) {
  await logEvent(user.id, 'command', { name: 'share' });
  const url = `${config.publicUrl}/list/${user.share_slug}`;
  await sendMessage(user.whatsapp_number,
    `Here's your shareable list:\n\n${url}\n\nAnyone with this link can see your saved places. They can't edit or message you through it.`);
}
```

### 5.16 `src/handlers/router.js`

The brain. Classifies intent and dispatches.

```javascript
import { getUserByPhone, getLatestPending, logEvent } from '../services/db.js';
import { handleOnboarding } from './onboarding.js';
import {
  handleReelSave,
  handleManualSave,
  handleGoogleMapsSave,
  handleDisambiguation
} from './save.js';
import { handleQuery } from './query.js';
import {
  handleHelp,
  handleList,
  handleCount,
  handleUndo,
  handleDelete,
  handleShare
} from './commands.js';
import { extractInstagramUrl, extractGoogleMapsUrl } from '../services/instagram.js';
import { logger } from '../utils/logger.js';

export async function routeMessage(incoming) {
  const { from, body } = incoming;
  
  let user = await getUserByPhone(from);
  if (!user) {
    await handleOnboarding(from);
    return;
  }
  
  await logEvent(user.id, 'message_in', { body });
  
  const lower = body.toLowerCase().trim();
  
  // 1. Disambiguation: short numeric reply when pending state exists
  const pending = await getLatestPending(user.id);
  if (pending && pending.candidates?.length > 0 && /^[1-9]$|^option\s+[1-9]/i.test(body)) {
    await handleDisambiguation(user, body, pending);
    return;
  }
  
  // 2. URL-based saves (highest priority)
  if (extractInstagramUrl(body)) {
    await handleReelSave(user, body);
    return;
  }
  if (extractGoogleMapsUrl(body)) {
    await handleGoogleMapsSave(user, body);
    return;
  }
  
  // 3. Rule-based commands
  if (/^(help|hi|hello|start)$/i.test(lower)) return handleHelp(user);
  if (/^(list|my list|my saves|show)$/i.test(lower)) return handleList(user);
  if (/^count$/i.test(lower)) return handleCount(user);
  if (/^undo$/i.test(lower)) return handleUndo(user);
  if (/^(delete|remove)\s+/i.test(lower)) return handleDelete(user, body);
  if (/^share$/i.test(lower)) return handleShare(user);
  if (/^(save|add)\s+/i.test(lower)) return handleManualSave(user, body);
  
  // 4. Default → query
  await handleQuery(user, body);
}
```

### 5.17 `src/routes/share.js`

The single public webapp route. Renders a static HTML page with the user's saves.

```javascript
import express from 'express';
import { getUserBySlug, getRecentSaves } from '../services/db.js';

export const shareRouter = express.Router();

shareRouter.get('/list/:slug', async (req, res) => {
  const user = await getUserBySlug(req.params.slug);
  if (!user) {
    res.status(404).send('List not found');
    return;
  }
  
  const saves = await getRecentSaves(user.id, 50);
  
  res.set('Content-Type', 'text/html');
  res.send(renderList(saves, user.display_name));
});

function renderList(saves, ownerName) {
  const ownerLabel = ownerName ? `${ownerName}'s` : 'A BiteList';
  const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  
  const cards = saves.map(s => `
    <div class="card">
      <h3>${escape(s.restaurant_name)}</h3>
      <div class="meta">
        ${s.area ? `<span>${escape(s.area)}</span>` : ''}
        ${s.google_rating ? `<span>⭐ ${s.google_rating}</span>` : ''}
        ${s.price_level ? `<span>${'₹'.repeat(s.price_level)}</span>` : ''}
      </div>
      ${s.cuisine_tags?.length ? `<div class="tags">${s.cuisine_tags.map(t => `<span class="tag">${escape(t)}</span>`).join(' ')}</div>` : ''}
      ${s.google_maps_url ? `<a class="maps" href="${escape(s.google_maps_url)}" target="_blank" rel="noopener">Open in Maps →</a>` : ''}
    </div>
  `).join('');
  
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(ownerLabel)} restaurant list — BiteList</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background: #fafafa; color: #222; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #888; font-size: 14px; margin-bottom: 24px; }
    .card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .card h3 { margin: 0 0 6px; font-size: 17px; }
    .meta { color: #666; font-size: 13px; display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .tags { margin: 8px 0; }
    .tag { display: inline-block; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-right: 6px; }
    .maps { color: #0066cc; font-size: 14px; text-decoration: none; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <h1>${escape(ownerLabel)} restaurant list</h1>
  <div class="sub">${saves.length} saved place${saves.length === 1 ? '' : 's'}</div>
  ${cards || '<p style="color:#888">No saves yet.</p>'}
  <div class="footer">Powered by BiteList — WhatsApp restaurant memory for Bangalore</div>
</body>
</html>`;
}
```

### 5.18 `src/index.js`

```javascript
import express from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { parseIncoming } from './twilio/parser.js';
import { routeMessage } from './handlers/router.js';
import { shareRouter } from './routes/share.js';

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get('/', (_req, res) => res.send('BiteList is alive'));

// Public list page
app.use('/', shareRouter);

// Twilio WhatsApp webhook — ALWAYS responds quickly with empty TwiML,
// processing happens async so Claude/Places latency doesn't trip the 15-sec timeout.
app.post('/webhook', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
  
  const incoming = parseIncoming(req.body);
  logger.info({ from: incoming.from, body: incoming.body }, 'Incoming message');
  
  try {
    await routeMessage(incoming);
  } catch (err) {
    logger.error({ err, incoming }, 'Routing failed');
    // Optional: send a friendly error message
    try {
      const { sendMessage } = await import('./twilio/client.js');
      await sendMessage(incoming.from, "Something broke on my side. Try again in a minute?");
    } catch (_) { /* swallow */ }
  }
});

app.listen(config.port, () => {
  logger.info(`BiteList listening on port ${config.port}`);
});
```

---

## 6. Run Locally

```bash
# Terminal 1
npm run dev

# Terminal 2
ngrok http 3000
# Copy the https forwarding URL, e.g. https://abc123.ngrok-free.app
```

Then in Twilio Console → WhatsApp Sandbox Settings:
- **When a message comes in:** `https://abc123.ngrok-free.app/webhook`
- **Method:** HTTP POST

From your WhatsApp (after sending `join <code>` to the sandbox):
1. Send `help` → should receive onboarding message.
2. Send `Save Toit Indiranagar` → should receive save confirmation.
3. Forward an Instagram reel of any Bangalore restaurant → should save it.
4. Send `places in Indiranagar` → should return your list filtered to Indiranagar.
5. Send `share` → should return a `https://abc123.ngrok-free.app/list/<slug>` URL — open it.

---

## 7. Deploy to Render

### 7.1 `render.yaml` (in repo root)

```yaml
services:
  - type: web
    name: bitelist
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: TWILIO_ACCOUNT_SID
        sync: false
      - key: TWILIO_AUTH_TOKEN
        sync: false
      - key: TWILIO_WHATSAPP_FROM
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: CLAUDE_MODEL
        value: claude-sonnet-4-20250514
      - key: GOOGLE_PLACES_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: PUBLIC_URL
        sync: false
```

### 7.2 Deploy Steps

1. Push your repo to GitHub.
2. Render → New → Web Service → connect the repo.
3. Render reads `render.yaml`. Set the `sync: false` env vars in the dashboard (don't commit secrets).
4. Set `PUBLIC_URL` to your final Render URL (e.g. `https://bitelist.onrender.com`).
5. Once deployed, update Twilio Sandbox webhook to `https://bitelist.onrender.com/webhook`.
6. Test from your phone. Ngrok is no longer needed.

---

## 8. Test Scenarios (Run All Before Inviting Users)

- [ ] New number → receives onboarding message
- [ ] `help` → returns help text
- [ ] `Save Toit Indiranagar` → saves, returns confirmation with Maps link
- [ ] `Save Toit` (no area) → returns 2–3 candidates, replying `2` selects the second
- [ ] Forward a public Instagram reel of a Bangalore restaurant → saves it
- [ ] Forward a reel from a meme account → bot says "couldn't pin down restaurant"
- [ ] Forward a Google Maps share link → resolves and saves
- [ ] `places in Indiranagar` → returns filtered list
- [ ] `where should I eat tonight` → returns top-rated saves
- [ ] `any drinks places` → returns bars/pubs/microbreweries
- [ ] `list` → returns last 10 saves
- [ ] `count` → returns total
- [ ] `undo` → removes most recent save, confirms
- [ ] `delete Toit` → removes matching save
- [ ] `share` → returns URL; URL opens to formatted HTML page
- [ ] Save the same place twice → second attempt says "already saved"
- [ ] Random gibberish ("asdfghj") → handled gracefully (probably empty query result)

---

## 9. Engagement Tracking (Day 30 Decision)

Run this query in Supabase SQL editor on day 30:

```sql
with active_users as (
  select id from users where onboarded_at < now() - interval '21 days'
),
heavy_savers as (
  select u.id
  from active_users u
  join saves s on s.user_id = u.id
  where s.created_at between
    (select onboarded_at from users where id = u.id)
    and (select onboarded_at from users where id = u.id) + interval '7 days'
    and s.deleted_at is null
  group by u.id
  having count(s.id) >= 5
),
returners as (
  select distinct e.user_id
  from events e
  join users u on u.id = e.user_id
  where e.event_type = 'query'
    and e.created_at between u.onboarded_at + interval '7 days'
      and u.onboarded_at + interval '28 days'
)
select
  (select count(*) from active_users) as total_users,
  (select count(*) from heavy_savers) as heavy_savers_count,
  (select count(*) from returners) as returners_count,
  (select count(*) from heavy_savers hs where hs.id in (select user_id from returners)) as both_count,
  round(100.0 *
    (select count(*) from heavy_savers hs where hs.id in (select user_id from returners))
    / nullif((select count(*) from active_users), 0), 1) as success_pct;
```

- `success_pct >= 40` → KEEP, plan phase 2
- `success_pct` 25–39 → ONE iteration cycle (2 weeks), re-decide
- `success_pct < 25` → KILL, write post-mortem, refocus on dinner app

---

## 10. What's NOT in This Build (Hold the Line)

Do not add these until day 30 + keep decision:

- Friend graph / mutual saves
- Trust signals ("3 of your friends saved this")
- Swipe discovery
- Group chat bot / voting
- Restaurant tagging beyond Google Places types
- Webapp with multiple tabs
- Notifications / proactive messages
- Voice notes
- Image OCR
- Payments / restaurant partnerships
- Login UI (phone number IS the identity)

If any of these feel essential before day 30, re-read this section.

---

## 11. Sunday 11pm Acceptance Criteria

By Sunday night you should be able to:

1. Send `help` from your WhatsApp to the sandbox number
2. Receive the BiteList onboarding message
3. Send `Save Toit Indiranagar`
4. Receive the save confirmation with the Maps link
5. Open Supabase, see your user row and the save row

That's the milestone. Everything else (Instagram parsing, query flow, share command) can land during the weekdays.

Ship the minimum first. Then layer.
