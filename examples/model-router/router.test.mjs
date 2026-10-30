import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from './router.mjs';
import { mock, RateLimited, ProviderUnavailable } from './providers.mjs';
import { evaluate } from './evaluate.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('returns the first provider that answers', async () => {
  const router = createRouter([
    mock({ name: 'primary', handler: () => 'from primary' }),
    mock({ name: 'fallback', handler: () => 'from fallback' }),
  ]);
  const result = await router.call({ system: 's', user: 'u' });
  assert.equal(result.text, 'from primary');
  assert.equal(result.provider, 'primary');
  assert.equal(result.attempts, 1);
});

test('retries a rate limited provider, then succeeds on it', async () => {
  const router = createRouter(
    [mock({ name: 'primary', handler: () => 'ok', failFirst: 2 })],
    { baseBackoffMs: 1, maxBackoffMs: 2 },
  );
  const result = await router.call({ system: 's', user: 'u' });
  assert.equal(result.text, 'ok');
  assert.equal(result.attempts, 3);
});

test('falls through to the next provider once attempts are exhausted', async () => {
  const router = createRouter(
    [
      mock({ name: 'primary', handler: () => 'never', failFirst: 99 }),
      mock({ name: 'fallback', handler: () => 'rescued' }),
    ],
    { maxAttemptsPerProvider: 2, baseBackoffMs: 1, maxBackoffMs: 2 },
  );
  const result = await router.call({ system: 's', user: 'u' });
  assert.equal(result.text, 'rescued');
  assert.equal(result.provider, 'fallback');
  assert.equal(result.trail.length, 2, 'both failed attempts are recorded');
});

test('an unavailable provider is skipped immediately, not retried', async () => {
  let primaryCalls = 0;
  const primary = {
    name: 'primary', model: 'dead', configured: true,
    async call() { primaryCalls += 1; throw new ProviderUnavailable('404 deprecated'); },
  };
  const router = createRouter([primary, mock({ name: 'fallback', handler: () => 'ok' })]);
  const result = await router.call({ system: 's', user: 'u' });
  assert.equal(result.provider, 'fallback');
  assert.equal(primaryCalls, 1, 'a deprecated model must not be retried');
});

test('skips providers with no key configured', () => {
  const router = createRouter([
    { name: 'nokey', model: 'x', configured: false, call: async () => ({ text: '' }) },
    mock({ name: 'fallback', handler: () => 'ok' }),
  ]);
  assert.deepEqual(router.providers, ['fallback:mock-1']);
});

test('throws a readable error when every provider fails', async () => {
  const router = createRouter(
    [mock({ name: 'a', handler: () => '', failFirst: 99 })],
    { maxAttemptsPerProvider: 1, baseBackoffMs: 1 },
  );
  await assert.rejects(
    () => router.call({ system: 's', user: 'u' }),
    (error) => error.message.includes('all providers failed') && error.message.includes('a/mock-1'),
  );
});

test('an unexpected error is surfaced, not swallowed by the fallback', async () => {
  const boom = {
    name: 'boom', model: 'x', configured: true,
    async call() { throw new TypeError('bug in the call site'); },
  };
  const router = createRouter([boom, mock({ name: 'fallback', handler: () => 'ok' })]);
  await assert.rejects(() => router.call({ system: 's', user: 'u' }), TypeError);
});

test('evaluation scores a refusing model above one that never refuses', async () => {
  const fixture = JSON.parse(await readFile(join(here, 'fixtures', 'classify.json'), 'utf8'));
  const strict = mock({
    name: 'mock', model: 'strict',
    handler: (r) => JSON.stringify(
      /etf|sec /i.test(r.user)
        ? { relevant: true, category: 'crypto-regulation', reason: 'r' }
        : /ai act/i.test(r.user)
          ? { relevant: true, category: 'ai-regulation', reason: 'r' }
          : { relevant: false, category: null, reason: 'r' },
    ),
  });
  const eager = mock({
    name: 'mock', model: 'eager',
    handler: () => JSON.stringify({ relevant: true, category: 'ai-regulation', reason: 'r' }),
  });

  const rows = await evaluate({
    fixture,
    candidates: [{ label: 'strict', provider: strict }, { label: 'eager', provider: eager }],
  });
  const [a, b] = rows;
  assert.equal(a.passed, a.total, 'the strict model passes everything');
  assert.ok(b.passed < b.total, 'the over-eager model must lose points on the off-topic cases');
});
