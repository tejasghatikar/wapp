import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let client;
function getClient() {
  if (!client) {
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error(
        'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Render → Environment.'
      );
    }
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
}

export async function sendMessage(to, body) {
  try {
    const message = await getClient().messages.create({
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
