#!/usr/bin/env node
/**
 * Content integrity gate.
 *
 * The problem this was written for: a wiki of a few hundred entries had been
 * bulk generated, and roughly a third of them had a body about a different
 * subject than the title. "Ethereum" as a title, Solana's history as the body.
 * Every page returned 200, every page looked fine in a spot check, and the
 * defect was invisible to anything that only validated structure.
 *
 * The cheap signal that catches it: an entry's own subject should appear in its
 * own body, early and more often than any competing subject from the same
 * vocabulary. That is it. No model call, no embedding, runs over hundreds of
 * entries in a second, and it is deterministic enough to put in CI.
 *
 * On `subject`: for a reference entry the title *is* the subject, so the title
 * is used. For an article the title is usually a sentence, and matching a whole
 * sentence against the body finds nothing, which would flag every healthy
 * entry. Those entries declare `subject` explicitly, and the title stays for
 * display. Guessing the noun phrase out of a title is the kind of cleverness
 * that fails silently, so it is asked for instead.
 *
 *   node check.mjs entries.json
 *   node check.mjs entries.json --json
 */

import { readFile } from 'node:fs/promises';

const ALIAS_SPLIT = /\s*[\/|,]\s*/;

export function checkEntry(entry, vocabulary) {
  const title = (entry.title ?? '').trim();
  const subject = (entry.subject ?? title).trim();
  const body = (entry.body ?? '');
  const haystack = body.toLowerCase();

  const own = subjectTerms(subject, entry.aliases);
  const ownHits = countAll(haystack, own);

  // Which other known subjects show up in this body?
  const rivals = [];
  for (const other of vocabulary) {
    const otherSubject = (other.subject ?? other.title ?? '').trim();
    if (sameSubject(otherSubject, subject)) continue;
    const hits = countAll(haystack, subjectTerms(otherSubject, other.aliases));
    if (hits > 0) rivals.push({ title: other.title ?? otherSubject, hits });
  }
  rivals.sort((a, b) => b.hits - a.hits);
  const topRival = rivals[0] ?? null;

  // Where the subject first appears matters: a correct entry names itself in
  // the opening sentence. One mention in a "see also" at the end does not count.
  const firstAt = firstIndex(haystack, own);
  const earlyWindow = Math.min(400, Math.max(120, Math.round(body.length * 0.08)));
  const namedEarly = firstAt !== -1 && firstAt <= earlyWindow;

  let status = 'ok';
  const reasons = [];

  if (ownHits === 0) {
    status = 'mismatch';
    reasons.push('subject never appears in its own body');
  } else if (topRival && topRival.hits > ownHits) {
    status = 'mismatch';
    reasons.push(`"${topRival.title}" appears ${topRival.hits}x vs own ${ownHits}x`);
  } else if (!namedEarly) {
    status = 'review';
    reasons.push(`subject first appears at char ${firstAt}, past the opening`);
  } else if (topRival && topRival.hits >= ownHits * 0.75) {
    status = 'review';
    reasons.push(`"${topRival.title}" is nearly as prominent (${topRival.hits} vs ${ownHits})`);
  }

  if (body.trim().length < 200) {
    status = status === 'ok' ? 'review' : status;
    reasons.push('body is very short');
  }

  return { slug: entry.slug ?? slugify(title), title, subject, status, ownHits, topRival, reasons };
}

export function checkAll(entries) {
  const vocabulary = entries.map((e) => ({ title: e.title, subject: e.subject, aliases: e.aliases }));
  const results = entries.map((entry) => checkEntry(entry, vocabulary));
  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    { ok: 0, review: 0, mismatch: 0 },
  );
  return { results, counts, total: results.length };
}

// --- helpers ---------------------------------------------------------------

function subjectTerms(title, aliases) {
  const terms = new Set();
  for (const raw of [title, ...(aliases ?? [])]) {
    if (!raw) continue;
    for (const part of String(raw).split(ALIAS_SPLIT)) {
      const term = part.trim().toLowerCase();
      if (term.length >= 3) terms.add(term);
    }
  }
  return [...terms];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function countAll(haystack, terms) {
  let total = 0;
  for (const term of terms) {
    const matches = haystack.match(new RegExp(`\\b${escape(term)}\\b`, 'g'));
    total += matches ? matches.length : 0;
  }
  return total;
}

function firstIndex(haystack, terms) {
  let best = -1;
  for (const term of terms) {
    const match = new RegExp(`\\b${escape(term)}\\b`).exec(haystack);
    if (match && (best === -1 || match.index < best)) best = match.index;
  }
  return best;
}

const sameSubject = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- cli -------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node check.mjs <entries.json> [--json]');
    process.exit(2);
  }
  const entries = JSON.parse(await readFile(file, 'utf8'));
  const report = checkAll(entries);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = ((report.counts.mismatch / report.total) * 100).toFixed(1);
    console.log(`\n${report.total} entries: ${report.counts.ok} ok, ${report.counts.review} review, ${report.counts.mismatch} mismatch (${pct}%)\n`);
    for (const r of report.results) {
      if (r.status === 'ok') continue;
      console.log(`  [${r.status.toUpperCase()}] ${r.slug}`);
      for (const reason of r.reasons) console.log(`      ${reason}`);
    }
    console.log();
  }

  // Non-zero exit so this can gate a publish step in CI.
  process.exit(report.counts.mismatch > 0 ? 1 : 0);
}
