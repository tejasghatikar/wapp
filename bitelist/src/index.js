import express from 'express';
import { config, configIncomplete, missingEnvKeys } from './config.js';
import { logger } from './utils/logger.js';
import { parseIncoming } from './twilio/parser.js';
import { routeMessage } from './handlers/router.js';
import { shareRouter } from './routes/share.js';
import { checkDatabaseHealth } from './services/db.js';
import { checkPlacesHealth } from './services/places.js';
import { runFriendActivityDigestForActivityDate, kolkataYesterdayYmd } from './services/friendActivity.js';

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (_req, res) => {
  if (configIncomplete) {
    return res.type('text').send(
      `BiteList is running but required environment variables are missing.\n\nMissing: ${missingEnvKeys.join(', ')}\n\nRender → your service → Environment → add each (same as local .env.local), Save, then redeploy. See bitelist/.env.example.\n\nDebug (no secrets): open /health/env-status in this browser while config is incomplete.\n`
    );
  }
  res.send('BiteList is alive');
});

/** Only on Render while env incomplete: shows which keys exist (booleans), not values. */
app.get('/health/env-status', (_req, res) => {
  if (process.env.RENDER !== 'true' || !configIncomplete) {
    return res.status(404).end();
  }
  const keys = [
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
    keys.map((k) => [k, Boolean(String(process.env[k] ?? '').trim())])
  );
  res.json({
    hint: 'true = non-empty for this Node process (values never shown). If all false, variables are not on this Web Service in Render or were not saved.',
    missingEnvKeys,
    presence
  });
});

app.get('/health/deps', async (_req, res) => {
  if (configIncomplete) {
    return res.status(503).json({ ok: false, missingEnvKeys });
  }

  const [database, places] = await Promise.all([
    checkDatabaseHealth(),
    checkPlacesHealth()
  ]);

  const ok =
    Object.values(database).every((result) => result.ok) &&
    places.ok &&
    places.placeCount > 0;

  res.status(ok ? 200 : 503).json({ ok, database, places });
});

/**
 * Daily job: send batched friend-activity digests for *yesterday* (Asia/Kolkata).
 * Configure Render Cron (or similar) to GET this URL once per day with ?secret=CRON_SECRET
 */
app.get('/internal/cron/friend-activity-digest', async (req, res) => {
  if (configIncomplete) {
    return res.status(503).json({ ok: false, missingEnvKeys });
  }
  const secret = String(req.query.secret || '');
  if (!config.cronSecret) {
    return res.status(503).json({ ok: false, error: 'CRON_SECRET is not set on the server' });
  }
  if (secret !== config.cronSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const override = String(req.query.date || '').trim();
  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : kolkataYesterdayYmd();

  try {
    const result = await runFriendActivityDigestForActivityDate(activityDate);
    logger.info(result, 'Friend activity digest cron completed');
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, activityDate }, 'Friend activity digest cron failed');
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.use('/', shareRouter);

app.post('/webhook', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  const incoming = parseIncoming(req.body);
  logger.info({ from: incoming.from, body: incoming.body }, 'Incoming message');

  if (configIncomplete) {
    logger.warn({ missing: missingEnvKeys }, 'Webhook ignored until env is configured');
    return;
  }

  try {
    await routeMessage(incoming);
  } catch (err) {
    logger.error({ err, incoming }, 'Routing failed');
    try {
      const { sendMessage } = await import('./twilio/client.js');
      await sendMessage(incoming.from, 'Something broke on my side. Try again in a minute?');
    } catch (_) {
      /* swallow */
    }
  }
});

app.listen(config.port, () => {
  logger.info(`BiteList listening on port ${config.port}`);
});
