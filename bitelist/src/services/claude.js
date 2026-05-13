import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let client;
function getAnthropic() {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it in Render → Environment.');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

export async function callClaudeJson(prompt, options = {}) {
  const {
    maxTokens = 1024,
    systemPrompt = 'You return only valid JSON. No preamble, no markdown.'
  } = options;

  const response = await getAnthropic().messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
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
