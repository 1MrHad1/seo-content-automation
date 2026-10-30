import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFleet, serverName, requiredEnv } from './generate.mjs';

const sites = [
  { platform: 'wordpress', host: 'www.example-one.test' },
  { platform: 'shopify', host: 'shop.myshopify.com', name: 'apparel' },
];

test('names are addressable from a prompt', () => {
  assert.equal(serverName(sites[0]), 'wordpress-example-one-test');
  assert.equal(serverName(sites[1]), 'shopify-apparel');
});

test('no secret values appear in the generated config', () => {
  const json = JSON.stringify(buildFleet(sites));
  assert.ok(json.includes('${WORDPRESS_EXAMPLE_ONE_TEST_APP_PASSWORD}'));
  assert.ok(!/password"\s*:\s*"(?!\$\{)/i.test(json), 'no literal credentials');
});

test('duplicate server names are rejected rather than silently overwriting', () => {
  assert.throws(
    () => buildFleet([
      { platform: 'wordpress', host: 'a.test', name: 'dup' },
      { platform: 'wordpress', host: 'b.test', name: 'dup' },
    ]),
    /duplicate server name/,
  );
});

test('an unknown platform fails loudly', () => {
  assert.throws(() => buildFleet([{ platform: 'drupal', host: 'x.test' }]), /unknown platform/);
});

test('lists every env var that must be set', () => {
  assert.deepEqual(requiredEnv(sites), [
    'WORDPRESS_EXAMPLE_ONE_TEST_USER',
    'WORDPRESS_EXAMPLE_ONE_TEST_APP_PASSWORD',
    'SHOPIFY_APPAREL_TOKEN',
  ]);
});
