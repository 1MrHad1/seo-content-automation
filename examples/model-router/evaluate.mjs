#!/usr/bin/env node
/**
 * Model evaluation harness.
 *
 * The rule this exists to enforce: before swapping a model to cut cost, prove
 * the replacement is as good on real examples. Not "it responded", not "the
 * output looked fine". A score against fixtures with known answers.
 *
 *   node evaluate.mjs                 # offline, deterministic, no keys needed
 *   node evaluate.mjs --live          # hits the real providers
 *
 * The off-topic cases matter more than the on-topic ones. A model that
 * classifies confidently but never refuses is the failure mode that puts a
 * cycle-lane story on a crypto site.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRouter } from './router.mjs';
import { anthropic, gemini, mock } from './providers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');

// --- the checks -------------------------------------------------------------

const CHECKS = [
  {
    name: 'valid json',
    run: ({ text }) => {
      try { JSON.parse(stripFence(text)); return true; } catch { return false; }
    },
  },
  {
    name: 'has required fields',
    run: ({ parsed }) =>
      parsed !== null &&
      typeof parsed.relevant === 'boolean' &&
      'category' in parsed &&
      typeof parsed.reason === 'string',
  },
  {
    name: 'relevance correct',
    run: ({ parsed, expect }) => parsed?.relevant === expect.relevant,
  },
  {
    name: 'category correct',
    run: ({ parsed, expect }) => (parsed ?? {}).category === expect.category,
  },
  {
    name: 'bare json, no fence',
    // A model that wraps JSON in a markdown fence has ignored the response-mime
    // setting. A tolerant parser hides it, which is exactly why it is checked
    // separately: it means every call site needs that tolerant parser forever.
    run: ({ text }) => !text.trim().startsWith('```'),
  },
  {
    name: 'no em dash',
    // House rule across every property: an em dash is an AI tell to a reader.
    run: ({ text }) => !text.includes('—'),
  },
];

const stripFence = (text) =>
  text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

// --- candidates -------------------------------------------------------------

function offlineCandidates() {
  const good = (request) => {
    const u = request.user.toLowerCase();
    if (u.includes('etf') || u.includes('sec ')) {
      return JSON.stringify({ relevant: true, category: 'crypto-regulation', reason: 'Regulator action on a crypto product.' });
    }
    if (u.includes('ai act')) {
      return JSON.stringify({ relevant: true, category: 'ai-regulation', reason: 'Direct AI statute enforcement news.' });
    }
    return JSON.stringify({ relevant: false, category: null, reason: 'Outside both verticals.' });
  };

  // A plausible but worse model: never refuses, buckets everything.
  const overEager = (request) => {
    const u = request.user.toLowerCase();
    const category = u.includes('etf') || u.includes('sec ') ? 'crypto-regulation' : 'ai-regulation';
    return JSON.stringify({ relevant: true, category, reason: 'Looks related.' });
  };

  // A model that ignores the JSON response mode and wraps output in a fence.
  const fenced = (request) => '```json\n' + good(request) + '\n```';

  return [
    { label: 'candidate-a (strict)',      provider: mock({ name: 'mock', model: 'candidate-a', handler: good }) },
    { label: 'candidate-b (never refuses)', provider: mock({ name: 'mock', model: 'candidate-b', handler: overEager }) },
    { label: 'candidate-c (ignores json mode)', provider: mock({ name: 'mock', model: 'candidate-c', handler: fenced }) },
  ];
}

function liveCandidates() {
  const g = process.env.GEMINI_API_KEY;
  const a = process.env.ANTHROPIC_API_KEY;
  const list = [];
  if (g) {
    for (const model of ['gemini-flash-lite-latest', 'gemini-3.6-flash']) {
      list.push({ label: `gemini:${model}`, provider: gemini({ apiKey: g, model }) });
    }
  }
  if (a) list.push({ label: 'anthropic:claude-sonnet-5', provider: anthropic({ apiKey: a }) });
  if (list.length === 0) throw new Error('--live needs GEMINI_API_KEY or ANTHROPIC_API_KEY');
  return list;
}

// --- run --------------------------------------------------------------------

export async function evaluate({ candidates, fixture }) {
  const rows = [];

  for (const { label, provider } of candidates) {
    const router = createRouter([provider]);
    const results = [];

    for (const testCase of fixture.cases) {
      let text = '';
      let error = null;
      try {
        ({ text } = await router.call({
          system: fixture.system,
          user: testCase.user,
          json: true,
          maxTokens: 300,
        }));
      } catch (e) {
        error = e.message;
      }

      let parsed = null;
      try { parsed = JSON.parse(stripFence(text)); } catch { /* checked below */ }

      const context = { text, parsed, expect: testCase.expect };
      const checks = CHECKS.map((check) => ({
        name: check.name,
        pass: error ? false : Boolean(check.run(context)),
      }));

      results.push({ id: testCase.id, error, checks });
    }

    const total = results.length * CHECKS.length;
    const passed = results.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0);
    rows.push({ label, passed, total, results });
  }

  return rows;
}

function report(rows) {
  const width = Math.max(...rows.map((r) => r.label.length));
  console.log('\nModel evaluation\n');
  for (const row of rows) {
    const pct = ((row.passed / row.total) * 100).toFixed(0);
    const bar = '#'.repeat(Math.round((row.passed / row.total) * 24)).padEnd(24, '.');
    console.log(`  ${row.label.padEnd(width)}  ${bar}  ${row.passed}/${row.total}  ${pct}%`);
  }

  console.log('\nFailures\n');
  let any = false;
  for (const row of rows) {
    for (const result of row.results) {
      const failed = result.checks.filter((c) => !c.pass).map((c) => c.name);
      if (failed.length === 0) continue;
      any = true;
      console.log(`  ${row.label}  ${result.id}`);
      console.log(`    ${result.error ? 'error: ' + result.error : failed.join(', ')}`);
    }
  }
  if (!any) console.log('  none');

  const best = rows.reduce((a, b) => (b.passed > a.passed ? b : a));
  console.log(`\nBest: ${best.label} (${best.passed}/${best.total})\n`);
  return best;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = JSON.parse(await readFile(join(here, 'fixtures', 'classify.json'), 'utf8'));
  const candidates = live ? liveCandidates() : offlineCandidates();
  const rows = await evaluate({ candidates, fixture });
  report(rows);
}
