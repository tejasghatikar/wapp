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
