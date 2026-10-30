/**
 * Provider adapters.
 *
 * Every adapter exposes the SAME signature:
 *
 *   async call({ system, user, maxTokens, json }) -> { text, raw }
 *
 * That is the whole point. When a provider has to be swapped under time
 * pressure, nothing downstream should have to change. The call site that
 * classifies an article does not know or care which model answered.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Errors worth retrying. Anything else should surface immediately. */
export class RateLimited extends Error {
  constructor(retryAfterMs) {
    super(`rate limited, retry in ${retryAfterMs}ms`);
    this.name = 'RateLimited';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Provider is configured but structurally unusable (deprecated model, bad key). */
export class ProviderUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderUnavailable';
  }
}

// ---------------------------------------------------------------------------

export function anthropic({ apiKey, model = 'claude-sonnet-5', fetchImpl = fetch }) {
  return {
    name: 'anthropic',
    model,
    configured: Boolean(apiKey),
    async call({ system, user, maxTokens = 1024, json = false }) {
      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });

      if (response.status === 429) throw new RateLimited(retryAfterMs(response, 2000));
      if (!response.ok) throw new ProviderUnavailable(`anthropic ${response.status}`);

      const body = await response.json();
      // A reasoning model can return a thinking block first. Reading content[0]
      // blindly is a real bug: iterate and take the text parts.
      const text = (body.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return { text, raw: body };
    },
  };
}

export function gemini({ apiKey, model = 'gemini-flash-lite-latest', fetchImpl = fetch }) {
  return {
    name: 'gemini',
    model,
    configured: Boolean(apiKey),
    async call({ system, user, maxTokens = 1024, json = false }) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.5 };
      // Asking for JSON at the API level means the downstream parser is
      // unchanged. Note: Gemma models accept this field and ignore it, which
      // is why they are not in the candidate list.
      if (json) generationConfig.responseMimeType = 'application/json';

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig,
        }),
      });

      if (response.status === 429) throw new RateLimited(retryAfterMs(response, 5000));
      if (response.status === 404) {
        throw new ProviderUnavailable(`gemini model ${model} is not available to this key`);
      }
      if (!response.ok) throw new ProviderUnavailable(`gemini ${response.status}`);

      const body = await response.json();
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      return { text, raw: body };
    },
  };
}

/** Deterministic adapter for tests and for demoing the router without keys. */
export function mock({ name = 'mock', model = 'mock-1', handler, failFirst = 0 }) {
  let calls = 0;
  return {
    name,
    model,
    configured: true,
    async call(request) {
      calls += 1;
      if (calls <= failFirst) throw new RateLimited(10);
      return { text: handler(request), raw: { mock: true, calls } };
    },
  };
}

// ---------------------------------------------------------------------------

function retryAfterMs(response, fallback) {
  const header = response.headers?.get?.('retry-after');
  if (!header) return fallback;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : fallback;
}

export { sleep };
