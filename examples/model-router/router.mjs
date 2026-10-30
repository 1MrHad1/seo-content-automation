/**
 * Provider router.
 *
 * Tries providers in order. A provider that is rate limited is retried with
 * backoff that honours the API's own Retry-After. A provider that is
 * structurally unavailable (deprecated model, missing key) is skipped
 * immediately and the next one is tried.
 *
 * Why a chain rather than a swap: when a key runs out of credit mid-pipeline,
 * you want the work to keep moving on the fallback while you fix the primary,
 * not stop. And when you later want the primary back, you change the order,
 * not the code.
 */

import { RateLimited, ProviderUnavailable, sleep } from './providers.mjs';

const DEFAULTS = {
  maxAttemptsPerProvider: 3,
  maxBackoffMs: 45_000,
  baseBackoffMs: 1_000,
};

export function createRouter(providers, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const usable = providers.filter((provider) => provider.configured);

  if (usable.length === 0) {
    throw new Error('no configured providers: set at least one API key');
  }

  return {
    providers: usable.map((p) => `${p.name}:${p.model}`),

    async call(request) {
      const trail = [];

      for (const provider of usable) {
        for (let attempt = 1; attempt <= config.maxAttemptsPerProvider; attempt += 1) {
          try {
            const result = await provider.call(request);
            return {
              ...result,
              provider: provider.name,
              model: provider.model,
              attempts: attempt,
              trail,
            };
          } catch (error) {
            trail.push({ provider: provider.name, model: provider.model, attempt, error: error.message });

            if (error instanceof RateLimited) {
              if (attempt === config.maxAttemptsPerProvider) break; // move to next provider
              const backoff = Math.min(
                Math.max(error.retryAfterMs, config.baseBackoffMs * 2 ** (attempt - 1)),
                config.maxBackoffMs,
              );
              await sleep(backoff);
              continue;
            }

            if (error instanceof ProviderUnavailable) break; // do not retry, next provider

            throw error; // genuinely unexpected: surface it
          }
        }
      }

      const summary = trail.map((t) => `${t.provider}/${t.model} #${t.attempt}: ${t.error}`).join('; ');
      throw new Error(`all providers failed. ${summary}`);
    },
  };
}
