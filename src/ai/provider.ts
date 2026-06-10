import { appConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ai-provider');

/**
 * Pluggable LLM client. Supports Anthropic and OpenAI via plain fetch (no extra SDK deps).
 * Set AI_PROVIDER=anthropic|openai|none, or it auto-detects from ANTHROPIC_API_KEY / OPENAI_API_KEY.
 * Always returns null on failure so callers fall back to heuristics.
 */
export async function completeJson(systemPrompt: string, userPayload: unknown): Promise<string | null> {
  const provider = appConfig.aiProvider;
  if (provider === 'none') return null;
  try {
    if (provider === 'anthropic') return await callAnthropic(systemPrompt, userPayload);
    if (provider === 'openai') return await callOpenAi(systemPrompt, userPayload);
  } catch (error) {
    log.warn(`AI call failed (${provider}); falling back to heuristics.`, error instanceof Error ? error.message : error);
  }
  return null;
}

async function callAnthropic(system: string, payload: unknown): Promise<string | null> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: appConfig.anthropicModel,
      max_tokens: 4_000,
      system: `${system}\nRespond with a single JSON object only — no markdown fences.`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    })
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.find((block) => block.type === 'text')?.text ?? null;
}

async function callOpenAi(system: string, payload: unknown): Promise<string | null> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: appConfig.openAiModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? null;
}

export function parseJsonResponse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/^```(json)?|```$/gm, '').trim()) as T;
  } catch {
    return null;
  }
}
