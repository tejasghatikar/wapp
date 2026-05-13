import { createUser, logEvent, createPending } from '../services/db.js';
import { sendMessage } from '../twilio/client.js';
import { logger } from '../utils/logger.js';

const WELCOME = `Hey 👋 I'm *BiteList* — your personal restaurant memory for Bangalore.

Best pubs in JP Nagar? Date spots in Indiranagar? Cafes near Koramangala? I help you remember the places you wanted to try and find them when you need them.

Here's what I do:
• Forward me any Instagram reel of a restaurant → I save it
• Type *Save Toit Indiranagar* → I save that too
• Ask *where should I go in Indiranagar?* → I show you your list

No app. No login. Your number is your account.`;

const NAME_PROMPT_DELAY_MS = 1200;

export async function handleOnboarding(from) {
  const user = await createUser(from);
  await logEvent(user.id, 'onboarded', { source: 'whatsapp' });

  await sendMessage(from, WELCOME);

  // Mark user as awaiting name BEFORE the delayed prompt so the next inbound
  // message is interpreted as the name even if the prompt hasn't sent yet.
  try {
    await createPending(user.id, [{ type: 'awaiting_name' }], null, 'onboarding');
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'Failed to set onboarding pending; name capture will fall back to *name X* command');
    return user;
  }

  setTimeout(() => {
    sendMessage(
      from,
      "What's your name? Just reply with it (one word is fine, or send *skip*)."
    ).catch((err) => {
      logger.error({ err, from }, 'Failed to send onboarding name prompt');
    });
  }, NAME_PROMPT_DELAY_MS);

  return user;
}
