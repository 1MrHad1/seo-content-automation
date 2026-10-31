#!/usr/bin/env node
/**
 * Idempotent Webflow CMS publisher.
 *
 * The property that matters: running this twice does not create duplicates.
 * A publishing pipeline is re-run constantly, after a crash, after a partial
 * batch, after someone fixes one row in the source. A create-only integration
 * turns every one of those into a cleanup job.
 *
 * So the unit of identity is the slug. Existing slug means PATCH, new slug
 * means insert. Then the touched items are published in one call.
 *
 * The QA gate runs before anything is written, not after. A pipeline that
 * publishes first and checks later is a pipeline that needs a retraction
 * process.
 *
 *   node publish.mjs content.sample.json --dry
 *   node publish.mjs content.sample.json
 *
 * Env: WEBFLOW_TOKEN, WEBFLOW_COLLECTION_ID
 */

import { readFile } from 'node:fs/promises';
import { createClient } from './client.mjs';
import { checkAll } from '../content-integrity/check.mjs';

const INSERT_BATCH = 100; // Webflow's documented maximum per insert call

export function planChanges(incoming, existingItems) {
  const bySlug = new Map();
  for (const item of existingItems) {
    const slug = item.fieldData?.slug;
    if (slug) bySlug.set(slug, item);
  }

  const create = [];
  const update = [];
  const unchanged = [];

  for (const entry of incoming) {
    const existing = bySlug.get(entry.slug);
    const fieldData = { name: entry.title, slug: entry.slug, ...(entry.fields ?? {}) };

    if (!existing) { create.push({ fieldData, isDraft: false }); continue; }

    // Only send a PATCH if something a human would notice actually changed.
    const changed = Object.entries(fieldData).some(
      ([k, v]) => JSON.stringify(existing.fieldData?.[k]) !== JSON.stringify(v),
    );
    if (changed) update.push({ id: existing.id, fieldData });
    else unchanged.push(existing.id);
  }

  return { create, update, unchanged };
}

export async function run({ client, collectionId, incoming, dryRun = false, log = console.error }) {
  // ---- gate first ---------------------------------------------------------
  const gate = checkAll(incoming.map((e) => ({ title: e.title, slug: e.slug, body: e.body ?? '' })));
  const blocked = gate.results.filter((r) => r.status === 'mismatch').map((r) => r.slug);

  if (blocked.length > 0) {
    log(`QA gate blocked ${blocked.length} of ${incoming.length}: ${blocked.join(', ')}`);
    incoming = incoming.filter((e) => !blocked.includes(e.slug));
  }
  const flagged = gate.results.filter((r) => r.status === 'review').map((r) => r.slug);
  if (flagged.length > 0) log(`flagged for review, still published: ${flagged.join(', ')}`);

  if (incoming.length === 0) return { created: 0, updated: 0, unchanged: 0, published: 0, blocked };

  // ---- diff against what is already there ---------------------------------
  const existing = [];
  for (let offset = 0; ; offset += 100) {
    const page = await client.listItems(collectionId, { limit: 100, offset });
    const items = page?.items ?? [];
    existing.push(...items);
    if (items.length < 100) break;
  }

  const { create, update, unchanged } = planChanges(incoming, existing);
  log(`plan: ${create.length} create, ${update.length} update, ${unchanged.length} unchanged`);

  if (dryRun) {
    return { created: 0, updated: 0, unchanged: unchanged.length, published: 0, blocked, dryRun: true };
  }

  // ---- write --------------------------------------------------------------
  const touched = [];

  for (let i = 0; i < create.length; i += INSERT_BATCH) {
    const batch = create.slice(i, i + INSERT_BATCH);
    const result = await client.createItems(collectionId, batch);
    for (const item of result?.items ?? []) if (item.id) touched.push(item.id);
  }

  for (const item of update) {
    await client.updateItem(collectionId, item.id, item.fieldData);
    touched.push(item.id);
  }

  // ---- publish ------------------------------------------------------------
  let published = 0;
  const errors = [];
  if (touched.length > 0) {
    const result = await client.publishItems(collectionId, touched);
    published = (result?.publishedItemIds ?? []).length;
    if (result?.errors?.length) errors.push(...result.errors);
  }

  return { created: create.length, updated: update.length, unchanged: unchanged.length,
           published, blocked, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry');
  if (!file) {
    console.error('usage: node publish.mjs <content.json> [--dry]');
    process.exit(2);
  }

  const token = process.env.WEBFLOW_TOKEN;
  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  if (!token || !collectionId) {
    console.error('set WEBFLOW_TOKEN and WEBFLOW_COLLECTION_ID');
    process.exit(2);
  }

  const incoming = JSON.parse(await readFile(file, 'utf8'));
  const client = createClient({
    token,
    onBudget: (left) => { if (left < 8) console.error(`rate budget low: ${left} left this minute`); },
  });

  const result = await run({ client, collectionId, incoming, dryRun });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.blocked?.length ? 1 : 0);
}
