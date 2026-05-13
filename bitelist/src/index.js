import express from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { parseIncoming } from './twilio/parser.js';
import { routeMessage } from './handlers/router.js';
import { shareRouter } from './routes/share.js';

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (_req, res) => res.send('BiteList is alive'));

app.use('/', shareRouter);

app.post('/webhook', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  const incoming = parseIncoming(req.body);
  logger.info({ from: incoming.from, body: incoming.body }, 'Incoming message');

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
