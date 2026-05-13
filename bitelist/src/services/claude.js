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

export class ClaudeUnavailableError extends Error {
  constructor(message, { cause, status, model } = {}) {
    super(message);
    this.name = 'ClaudeUnavailableError';
    this.status = status;
    this.model = model;
    if (cause) this.cause = cause;
  }
}

export async function callClaudeJson(prompt, options = {}) {
  const {
    maxTokens = 1024,
    systemPrompt = 'You return only valid JSON. No preamble, no markdown.'
  } = options;

  let response;
  try {
    response = await getAnthropic().messages.create({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    const status = err?.status || err?.response?.status;
    logger.error(
      { err, status, model: config.anthropic.model },
      'Claude API call failed'
    );
    throw new ClaudeUnavailableError(
      `Claude API call failed (status ${status ?? 'unknown'})`,
      { cause: err, status, model: config.anthropic.model }
    );
  }

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
    throw new ClaudeUnavailableError('Claude returned invalid JSON', {
      cause: err,
      model: config.anthropic.model
    });
  }
}
