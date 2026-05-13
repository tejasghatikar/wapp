import { createUser, logEvent } from '../services/db.js';
import { sendMessage } from '../twilio/client.js';

const WELCOME = `Hey 👋 I'm *BiteList* — your personal restaurant memory for Bangalore.

Best pubs in JP Nagar? Date spots in Indiranagar? Cafes near Koramangala? I help you remember the places you wanted to try and find them when you need them.

Here's what I do:
• Forward me any Instagram reel of a restaurant → I save it
• Type *Save Toit Indiranagar* → I save that too
• Ask *where should I go in Indiranagar?* → I show you your list

No app. No login. Your number is your account.

Tell me what to call you with *name <your name>* so friends can recognise you.

Try forwarding a reel right now, or type *help* anytime.`;

export async function handleOnboarding(from) {
  const user = await createUser(from);
  await logEvent(user.id, 'onboarded', { source: 'whatsapp' });
  await sendMessage(from, WELCOME);
  return user;
}
