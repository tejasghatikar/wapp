import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bitelistRoot = path.join(__dirname, '..');

// Render injects env in the dashboard — do not load .env files there (avoids wrong paths with rootDir).
if (process.env.RENDER !== 'true') {
  dotenv.config({ path: path.join(bitelistRoot, '../.env.local') });
  dotenv.config({ path: path.join(bitelistRoot, '.env.local') });
  dotenv.config({ path: path.join(bitelistRoot, '.env') });
}

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const placesKey =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

/** Twilio expects `whatsapp:+E164`; accept bare +E164 from .env */
function normalizeTwilioWhatsAppFrom(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  const e164 = s.startsWith('+') ? s : `+${s}`;
  return `whatsapp:${e164}`;
}

const twilioFromRaw = process.env.TWILIO_WHATSAPP_FROM;
const twilioFrom = normalizeTwilioWhatsAppFrom(twilioFromRaw);

const required = [
  ['TWILIO_ACCOUNT_SID', process.env.TWILIO_ACCOUNT_SID],
  ['TWILIO_AUTH_TOKEN', process.env.TWILIO_AUTH_TOKEN],
  ['TWILIO_WHATSAPP_FROM', twilioFromRaw],
  ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY],
  ['GOOGLE_MAPS_API_KEY', placesKey],
  ['SUPABASE_URL', supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY]
];

const missingKeys = [];
for (const [key, val] of required) {
  if (!val) missingKeys.push(key);
}

const runningOnRender = process.env.RENDER === 'true';

if (missingKeys.length && !runningOnRender) {
  throw new Error(
    `Missing required env var: ${missingKeys[0]}. Add it to bitelist/.env or wapp/.env.local (see bitelist/.env.example). On Render, set these in the service Environment tab.`
  );
}

if (missingKeys.length && runningOnRender) {
  console.warn(
    `[bitelist] Incomplete env on Render — add in Dashboard → Environment, then redeploy. Missing: ${missingKeys.join(', ')}`
  );
  const probe = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM',
    'ANTHROPIC_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'GOOGLE_PLACES_API_KEY',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  const presence = Object.fromEntries(
    probe.map((k) => [k, Boolean(String(process.env[k] ?? '').trim())])
  );
  console.warn('[bitelist] env key presence (true = non-empty; no values logged):', JSON.stringify(presence));
}

export const configIncomplete = missingKeys.length > 0;
export const missingEnvKeys = [...missingKeys];

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicUrl: process.env.PUBLIC_URL,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: twilioFrom
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5'
  },
  google: {
    placesApiKey: placesKey || ''
  },
  supabase: {
    url: supabaseUrl || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  },
  allowNewUsers: process.env.ALLOW_NEW_USERS !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info'
};
