// Talking to the models. One function shape for every provider: a system prompt and one user message in,
// text and token counts out. Plain fetch, no SDK.

export type Request = { system: string; user: string; maxTokens: number; temperature?: number };
export type Usage = { input: number; output: number };
export type Reply = { text: string; usage: Usage; stop: string; blocks?: string[] }; // blocks: content block types, e.g. ['thinking', 'text']

/** Anything that answers a request. The real ones call an API; tests and the simulation use fakes. */
export type Model = (req: Request) => Promise<Reply>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with retries for rate limits, overloads and dropped connections. Anything else is a real error. */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      if (attempt >= 5) throw e;
      await wait(2000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    const retry = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retry || attempt >= 5) throw new Error(`API ${res.status}: ${await res.text()}`);
    await wait(Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt);
  }
}

// ---------- Anthropic ----------

const ANTHROPIC = `${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1`;
const anthropicHeaders = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

export function claude(model: string, apiKey: string): Model {
  return async ({ system, user, maxTokens, temperature }) => {
    const body: Record<string, unknown> = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    if (temperature !== undefined) body.temperature = temperature;
    const res = (await post(`${ANTHROPIC}/messages`, anthropicHeaders(apiKey), body)) as {
      content: { type: string; text?: string }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, stop: res.stop_reason, blocks: res.content.map((b) => b.type), usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
  };
}

// ---------- OpenAI (optional: set OPENAI_API_KEY and use a gpt-... model id) ----------
// Written to the Chat Completions API but not yet run against it - smoke-test it before a full run.

const OPENAI = `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'}/v1`;

export function openai(model: string, apiKey: string): Model {
  return async ({ system, user, maxTokens, temperature }) => {
    const body: Record<string, unknown> = {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (temperature !== undefined) body.temperature = temperature;
    const res = (await post(`${OPENAI}/chat/completions`, { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body)) as {
      choices: { message: { content: string | null }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      text: res.choices[0]?.message.content ?? '',
      stop: res.choices[0]?.finish_reason ?? '',
      usage: { input: res.usage.prompt_tokens, output: res.usage.completion_tokens },
    };
  };
}

// ---------- picking models ----------

export const isOpenAI = (id: string) => /^(gpt-|o\d)/.test(id);

/** "opus", "sonnet" or "haiku" becomes the newest of that family the key can use. Full ids are left alone. */
export async function resolveModel(name: string): Promise<string> {
  if (!/^(sonnet|haiku|opus)$/.test(name)) return name;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error(`Need ANTHROPIC_API_KEY to work out which model "${name}" means`);
  const res = await fetch(`${ANTHROPIC}/models?limit=100`, { headers: anthropicHeaders(key) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const { data } = (await res.json()) as { data: { id: string }[] }; // newest first
  const hit = data.find((m) => m.id.includes(name));
  if (!hit) throw new Error(`No ${name} model on this key. Pick one of: ${data.map((m) => m.id).join(', ')}`);
  return hit.id;
}

/** The right client for a model id, using the key for its provider. */
export function modelFor(id: string): Model {
  if (isOpenAI(id)) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error(`Need OPENAI_API_KEY for ${id}`);
    return openai(id, key);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error(`Need ANTHROPIC_API_KEY for ${id}`);
  return claude(id, key);
}
