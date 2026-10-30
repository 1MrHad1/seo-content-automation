# model-router

A provider chain where every adapter has the same signature, plus an evaluation
harness for deciding whether a cheaper model is actually good enough.

```bash
node evaluate.mjs          # offline, deterministic, no API keys
node evaluate.mjs --live   # needs GEMINI_API_KEY or ANTHROPIC_API_KEY
node --test router.test.mjs
```

- `providers.mjs` adapters, and the two error types that drive retry behaviour
- `router.mjs` the chain: backoff on rate limits, skip on unavailable, surface anything unexpected
- `evaluate.mjs` score candidates against fixtures with known answers
- `models.json` what testing actually showed about each candidate

Context: [case study 2](../../case-studies/02-model-migration.md).
