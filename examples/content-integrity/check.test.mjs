import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEntry, checkAll } from './check.mjs';

const vocab = [
  { title: 'Ethereum', aliases: ['ETH'] },
  { title: 'Solana', aliases: ['SOL'] },
];

const body = (s) => s.padEnd(240, ' filler text about the subject.');

test('a correct entry passes', () => {
  const r = checkEntry(
    { title: 'Ethereum', aliases: ['ETH'], body: body('Ethereum is a blockchain. Ethereum uses ETH as its native asset. Ethereum went live in 2015.') },
    vocab,
  );
  assert.equal(r.status, 'ok');
});

test('catches a body about a different subject', () => {
  const r = checkEntry(
    { title: 'Solana', aliases: ['SOL'], body: body('Ethereum is a blockchain. Ethereum uses ETH. Ethereum went live in 2015.') },
    vocab,
  );
  assert.equal(r.status, 'mismatch');
  assert.match(r.reasons[0], /never appears/);
});

test('catches a body where a rival subject dominates', () => {
  const r = checkEntry(
    { title: 'Solana', aliases: ['SOL'], body: body('Solana is often compared to Ethereum. Ethereum has more developers, Ethereum has more value locked, and Ethereum came first.') },
    vocab,
  );
  assert.equal(r.status, 'mismatch');
  assert.match(r.reasons[0], /Ethereum/);
});

test('flags an entry that only names itself at the very end', () => {
  const tail = 'A proof of stake network built on peer reviewed research. '.repeat(10) + 'This is Solana.';
  const r = checkEntry({ title: 'Solana', aliases: [], body: tail }, vocab);
  assert.equal(r.status, 'review');
  assert.match(r.reasons[0], /past the opening/);
});

test('flags a stub', () => {
  const r = checkEntry({ title: 'Solana', aliases: [], body: 'Solana is short.' }, vocab);
  assert.notEqual(r.status, 'ok');
  assert.ok(r.reasons.some((x) => /very short/.test(x)));
});

test('word boundaries: a substring is not a hit', () => {
  // "ETH" must not match inside "whether" or "Ethereum".
  const r = checkEntry(
    { title: 'Solana', aliases: ['SOL'], body: body('Whether or not this is relevant, Solana is the subject here. Solana scales well. Solana uses SOL.') },
    vocab,
  );
  assert.equal(r.status, 'ok');
});

test('counts across a set and reports a rate', () => {
  const report = checkAll([
    { title: 'Ethereum', aliases: [], body: body('Ethereum is a blockchain. Ethereum is widely used. Ethereum has many users.') },
    { title: 'Solana', aliases: [], body: body('Ethereum is a blockchain. Ethereum is widely used. Ethereum has many users.') },
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.counts.mismatch, 1);
});
