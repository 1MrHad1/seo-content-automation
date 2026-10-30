# 2. Model migration under pressure

The paid provider's key ran out of credit mid-project. The pipeline stopped. The
fix had to be same-day and could not involve rewriting the call sites.

## What made it a config change instead of a rewrite

Every provider adapter had the same signature. The function that classifies an
article does not know which model answers it, and does not need to. So the
migration was:

1. Write a new adapter against the replacement API with the same signature.
2. Make the entry point prefer whichever provider is configured.
3. Keep the original as the fallback.

The call sites were untouched. See
[`examples/model-router`](../examples/model-router) for a cleaned-up version of
the pattern, with tests.

Two details did the work:

**A chain, not a swap.** The old provider stays in the list. When credit is
restored, the order changes and nothing else does. A hard swap means doing the
migration again in reverse later, under the same time pressure.

**JSON at the API level.** The replacement supports a JSON response mode, so the
existing parser kept working without a tolerant wrapper. If the model had only
offered fenced markdown, every call site would have needed a strip-the-fence
helper, permanently.

## The evaluation

Four model families were tested before one was chosen. Three failed, and the
reasons are the useful part:

| Candidate | Result |
|---|---|
| Latest small model, alias tag | Works, high free daily cap, honours JSON response mode. **Selected.** |
| Newer flash model | Works, but twenty requests per day on the free tier. Useless for seeding a backlog. The quota was per-model, so switching models gave a fresh bucket. |
| Previous-generation flash models | HTTP 404 for new keys. Deprecated, with no deprecation signal other than the status code. |
| Open-weight family | Responds, accepts the JSON response mode field, and silently ignores it. Output came back fenced. |

Three of those four look identical if your test is "did it return something".
Only the fourth column distinguishes them, and only if you are checking output
shape and refusal behaviour rather than liveness.

## The thing the harness is actually for

`evaluate.mjs` scores candidates against fixtures with known answers, and it
weights the **off-topic** cases deliberately. A model that classifies
confidently and never refuses scores well on a naive eval and is a disaster in
production: it puts a local-council story on a crypto site, and the output looks
fine in a spot check because each individual post is well written.

The rule this enforces: before swapping a model to cut cost, prove the
replacement is as good on real examples. Not "it responded". A score.

## Operational detail

Rate limiting during a seeding burst is not an error condition, it is the
expected condition. The adapter retries with backoff that honours the API's own
retry hint, capped, with a small number of attempts before falling through to
the next provider. Seeding runs sequentially rather than in parallel, which
costs wall-clock time and avoids spending the entire retry budget in the first
ten seconds.
