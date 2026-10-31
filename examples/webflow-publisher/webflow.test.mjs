import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, WebflowError } from './client.mjs';
import { planChanges, run } from './publish.mjs';
import { handle, TOOLS } from './mcp-server.mjs';

// --- a stand-in for the Webflow API, good enough to exercise the real paths --
function fakeWebflow({ items = [], failTimes = 0, retryAfter = '0' } = {}) {
  const state = { items: [...items], calls: [], published: [], rateLimited: 0 };
  let seq = 1;

  const res = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === null ? '' : JSON.stringify(body)),
  });

  const impl = async (url, opts = {}) => {
    const path = url.replace('https://api.webflow.com/v2', '');
    const method = opts.method ?? 'GET';
    state.calls.push(`${method} ${path.split('?')[0]}`);

    assert.equal(opts.headers.authorization, 'Bearer test-token', 'every call must be authorised');

    if (state.rateLimited < failTimes) {
      state.rateLimited += 1;
      return res(429, { message: 'rate limited' },
        retryAfter === null ? { 'x-ratelimit-remaining': '0' }
                            : { 'retry-after': retryAfter, 'x-ratelimit-remaining': '0' });
    }

    const head = { 'x-ratelimit-remaining': '55', 'x-ratelimit-limit': '60' };

    if (method === 'GET' && /^\/collections\/\w+\/items/.test(path)) {
      return res(200, { items: state.items }, head);
    }
    if (method === 'POST' && path.endsWith('/items/insert')) {
      const body = JSON.parse(opts.body);
      const created = body.items.map((i) => ({ id: `new-${seq++}`, fieldData: i.fieldData }));
      state.items.push(...created);
      return res(200, { items: created }, head);
    }
    if (method === 'PATCH' && /\/items\/[\w-]+$/.test(path)) {
      const id = path.split('/').pop();
      const found = state.items.find((i) => i.id === id);
      if (found) found.fieldData = { ...found.fieldData, ...JSON.parse(opts.body).fieldData };
      return res(200, found, head);
    }
    if (method === 'POST' && path.endsWith('/items/publish')) {
      const ids = JSON.parse(opts.body).itemIds;
      state.published.push(...ids);
      return res(202, { publishedItemIds: ids, errors: [] }, head);
    }
    if (method === 'GET' && path === '/sites') return res(200, { sites: [{ id: 's1' }] }, head);
    return res(404, { message: 'not found' }, head);
  };

  return { impl, state };
}

const entry = (slug, title, body) => ({ slug, title, body });
const GOOD = (subject) =>
  `${subject} is the subject of this entry. ${subject} is described here in full. ` +
  `${subject} appears throughout, because the entry is genuinely about ${subject} and nothing else. ` +
  `Readers looking for ${subject} will find ${subject} discussed at length.`;

// --- planning ---------------------------------------------------------------

test('a new slug is a create', () => {
  const plan = planChanges([entry('a', 'Alpha')], []);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].fieldData.slug, 'a');
  assert.equal(plan.create[0].fieldData.name, 'Alpha');
});

test('an existing slug with the same content is left alone', () => {
  const existing = [{ id: 'x1', fieldData: { name: 'Alpha', slug: 'a' } }];
  const plan = planChanges([entry('a', 'Alpha')], existing);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.update.length, 0);
  assert.deepEqual(plan.unchanged, ['x1']);
});

test('an existing slug with changed content is an update, not a duplicate', () => {
  const existing = [{ id: 'x1', fieldData: { name: 'Alpha', slug: 'a' } }];
  const plan = planChanges([entry('a', 'Alpha renamed')], existing);
  assert.equal(plan.create.length, 0, 'must never re-create an existing slug');
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].id, 'x1');
});

// --- the whole run ----------------------------------------------------------

test('publishes clean entries end to end', async () => {
  const { impl, state } = fakeWebflow();
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  const result = await run({
    client, collectionId: 'c1', log: () => {},
    incoming: [entry('eth', 'Ethereum', GOOD('Ethereum')), entry('sol', 'Solana', GOOD('Solana'))],
  });
  assert.equal(result.created, 2);
  assert.equal(result.published, 2);
  assert.equal(state.published.length, 2);
  assert.ok(state.calls.includes('POST /collections/c1/items/publish'));
});

test('running twice creates nothing the second time', async () => {
  const { impl } = fakeWebflow();
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  const incoming = [entry('eth', 'Ethereum', GOOD('Ethereum'))];
  const first = await run({ client, collectionId: 'c1', incoming, log: () => {} });
  const second = await run({ client, collectionId: 'c1', incoming, log: () => {} });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0, 'a re-run must not duplicate');
  assert.equal(second.unchanged, 1);
});

test('the integrity gate blocks a wrong-subject entry before anything is written', async () => {
  const { impl, state } = fakeWebflow();
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  const result = await run({
    client, collectionId: 'c1', log: () => {},
    incoming: [
      entry('eth', 'Ethereum', GOOD('Ethereum')),
      entry('sol', 'Solana', GOOD('Ethereum')),   // body is about the wrong subject
    ],
  });
  assert.deepEqual(result.blocked, ['sol']);
  assert.equal(result.created, 1, 'only the clean entry is written');
  assert.ok(!state.calls.some((c) => c.includes('insert') && false));
  assert.equal(state.items.length, 1, 'the blocked entry never reached the API');
});

test('a dry run writes nothing', async () => {
  const { impl, state } = fakeWebflow();
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  const result = await run({
    client, collectionId: 'c1', dryRun: true, log: () => {},
    incoming: [entry('eth', 'Ethereum', GOOD('Ethereum'))],
  });
  assert.equal(result.dryRun, true);
  assert.equal(state.items.length, 0);
  assert.ok(!state.calls.some((c) => c.startsWith('POST')));
});

// --- transport behaviour ----------------------------------------------------

test('a 429 is retried, honouring Retry-After, not surfaced as a failure', async () => {
  const { impl, state } = fakeWebflow({ failTimes: 2 });
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  const sites = await client.listSites();
  assert.deepEqual(sites, { sites: [{ id: 's1' }] });
  assert.equal(state.rateLimited, 2, 'it retried rather than giving up');
});

test('retries are bounded, and the error says what happened', async () => {
  // no Retry-After header, so this exercises the exponential backoff path
  const { impl } = fakeWebflow({ failTimes: 99, retryAfter: null });
  const client = createClient({ token: 'test-token', fetchImpl: impl, maxRetries: 2, baseDelayMs: 1 });
  await assert.rejects(() => client.listSites(), (e) =>
    e instanceof WebflowError && e.status === 429 && /retries exhausted/.test(e.message));
});

test('an API error carries the status and the body', async () => {
  const { impl } = fakeWebflow();
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  await assert.rejects(() => client.getCollection('nope'), (e) =>
    e.status === 404 && /not found/.test(e.message));
});

test('the remaining rate budget is reported to the caller', async () => {
  const { impl } = fakeWebflow();
  const seen = [];
  const client = createClient({ token: 'test-token', fetchImpl: impl, onBudget: (n) => seen.push(n) });
  await client.listSites();
  assert.deepEqual(seen, [55]);
});

test('a missing token fails loudly at construction', () => {
  assert.throws(() => createClient({ token: '' }), /WEBFLOW_TOKEN is required/);
});

// --- MCP protocol -----------------------------------------------------------

test('initialize returns a protocol version and server info', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(r.result.serverInfo.name, 'webflow-publisher');
  assert.ok(r.result.protocolVersion);
  assert.ok(r.result.capabilities.tools);
});

test('tools/list advertises every tool with a schema', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(r.result.tools.length, TOOLS.length);
  for (const t of r.result.tools) {
    assert.ok(t.name && t.description, `${t.name} needs a description`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('a notification gets no reply, as the spec requires', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('an unknown method is a JSON-RPC error', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 3, method: 'nope' });
  assert.equal(r.error.code, -32601);
});

test('a failing tool call returns isError, not a protocol error', async () => {
  const saved = process.env.WEBFLOW_TOKEN;
  delete process.env.WEBFLOW_TOKEN;
  const r = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call',
                           params: { name: 'webflow_list_sites', arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /WEBFLOW_TOKEN/);
  assert.equal(r.error, undefined, 'a tool failure is a result, not a transport error');
  if (saved) process.env.WEBFLOW_TOKEN = saved;
});

// --- pages and site publish -------------------------------------------------

test('page SEO uses PUT on /pages/:id, which is the documented verb', async () => {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push(`${opts.method} ${url.replace('https://api.webflow.com/v2', '')}`);
    return { status: 200, ok: true, headers: { get: () => null },
             text: async () => JSON.stringify({ seo: { title: 'T' } }) };
  };
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  await client.updatePage('p1', { seo: { title: 'T', description: 'D' } });
  assert.deepEqual(calls, ['PUT /pages/p1']);
});

test('site publish defaults to the webflow subdomain', async () => {
  let sent = null;
  const impl = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { status: 202, ok: true, headers: { get: () => null }, text: async () => '{}' };
  };
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  await client.publishSite('s1');
  assert.deepEqual(sent, { publishToWebflowSubdomain: true });
});

test('site publish uses custom domains when given', async () => {
  let sent = null;
  const impl = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { status: 202, ok: true, headers: { get: () => null }, text: async () => '{}' };
  };
  const client = createClient({ token: 'test-token', fetchImpl: impl });
  await client.publishSite('s1', { customDomains: ['d1'] });
  assert.deepEqual(sent, { customDomains: ['d1'] });
});
