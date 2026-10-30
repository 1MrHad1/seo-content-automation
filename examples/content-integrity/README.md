# content-integrity

Finds entries whose body is about a different subject than their title. No model
call, no embeddings, deterministic, fast enough for CI.

```bash
node check.mjs entries.sample.json
node check.mjs entries.sample.json --json
node --test check.test.mjs
```

Exits non-zero when any entry is a mismatch, so it can gate a publish step.

Context: [case study 3](../../case-studies/03-content-integrity.md).
