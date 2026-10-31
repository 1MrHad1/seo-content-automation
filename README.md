# SEO Content Automation

Engineering notes and runnable code from building automated content pipelines
across a fleet of WordPress sites and Shopify stores, operated from a single
Claude Code environment.

Everything here is anonymised. The systems described run on client properties,
so there are no domains, credentials or client names in this repository. What is
here is the architecture, the decisions, the failure modes, and working code you
can run in about ten seconds.

```bash
npm test          # 37 tests, zero dependencies
npm run evaluate  # score candidate models against fixtures, offline
npm run integrity # find entries whose body is about the wrong subject
npm run fleet     # generate a 100-site MCP config with no secrets in it
npm run webflow   # plan a Webflow CMS publish, gated, dry run
```

---

## The shape of the work

```
                       one Claude Code environment
                                  |
        +-------------------------+--------------------------+
        |                         |                          |
   content fleet            commerce fleet              data sources
   93 WordPress sites       8 Shopify stores            Search Console
   Webflow over Data API    over Admin GraphQL          GA4
   all over MCP                                         DataForSEO
                                                        Hostinger / Netlify / Vercel

        ingest  ->  relevance gate  ->  rewrite  ->  illustrate  ->  QA gate  ->  publish
         RSS         LLM, rejects       LLM          source image    automated     cron
         dedup       off-topic                       self-hosted     checks
```

116 MCP servers are configured in total: 93 WordPress sites, 8 Shopify stores,
and 15 tooling servers for search data, analytics, hosting and deployment. The
point of that number is not the number. It is that a site becomes addressable by
name in a prompt, so "audit the product titles on the foods store" and "check
which of these forty sites lost impressions last month" are one instruction
rather than forty tabs.

---

## Case studies

| | What it covers |
|---|---|
| [1. Automated newsrooms](case-studies/01-automated-newsrooms.md) | Six sites that ingest, filter, rewrite, illustrate and publish on cron with no human in the loop. The module layout, the backlog self-regulation, and the four bugs that mattered. |
| [2. Model migration under pressure](case-studies/02-model-migration.md) | A paid provider ran out of credit mid-project. Moving to a free tier without changing a line of calling code, and the evaluation that picked the replacement. |
| [3. Content integrity gate](case-studies/03-content-integrity.md) | A third of a bulk-generated wiki had a body about the wrong subject. Finding it cheaply, and the quarantine contract that let the fix ship incrementally. |
| [4. Commerce automation](case-studies/04-commerce-automation.md) | Shopify stores wired over the Admin API: catalogue work, product and meta copy, and the draft-theme rule that keeps client storefronts safe. |
| [5. Operating a fleet](case-studies/05-fleet-operations.md) | Addressing a hundred sites from one environment, keeping secrets out of config, and QA gates that block a publish rather than report on it afterwards. |
| [6. Pre-launch footprint audit](case-studies/06-footprint-audit.md) | Measuring what a network of similar sites gives away before any of them are indexed, and what was changed as a result. |
| [7. Adding a new platform](case-studies/07-webflow-integration.md) | Taking the same discipline to a CMS the fleet had never touched. What transferred, what was new, and the one-character bug a test caught. |

---

## Runnable examples

### `examples/model-router`

A provider chain with the property that mattered most in practice: **every
adapter has the same signature**, so swapping the model behind a pipeline
changes a config line, not the call sites.

- Rate limits are retried with backoff that honours the API's own `Retry-After`.
- A structurally dead provider (deprecated model, missing key) is skipped
  immediately rather than retried three times.
- An unexpected error is surfaced, not swallowed by the fallback. A silent
  fallback that hides a bug is worse than an outage.

`evaluate.mjs` is the part that matters for cost decisions. Before swapping a
model to save money, it scores candidates against fixtures with known answers:

```
Model evaluation

  candidate-a (strict)             ########################  24/24  100%
  candidate-b (never refuses)      ####################....  20/24  83%
  candidate-c (ignores json mode)  ####################....  20/24  83%

Failures

  candidate-b (never refuses)  off-topic-leak
    relevance correct, category correct
  candidate-c (ignores json mode)  on-topic-crypto
    bare json, no fence
```

The off-topic cases carry more weight than the on-topic ones. A model that
classifies confidently but never refuses is the failure mode that puts a
local-council story on a crypto site, and it looks perfectly healthy in a spot
check. `models.json` records what testing actually showed about each candidate,
so the next person does not repeat the evaluation.

### `examples/content-integrity`

A deterministic check for the defect that structural validation cannot see: an
entry whose title says one thing and whose body is about something else.

```
4 entries: 1 ok, 2 review, 1 mismatch (25.0%)

  [MISMATCH] solana
      subject never appears in its own body
  [REVIEW] cardano
      subject first appears at char 280, past the opening
```

No model call and no embeddings. An entry should name its own subject, early,
and more often than any competing subject from the same vocabulary. That one
signal caught a defect rate above thirty percent in a real set. It exits
non-zero, so it can gate a publish step rather than produce a report nobody
reads.

### `examples/webflow-publisher`

An idempotent publisher for the Webflow Data API v2, plus an MCP server written
directly against the protocol rather than with the SDK, so the repository stays
dependency-free.

Three things it gets right, and they are the same three on every platform:

- **Idempotent by slug.** Existing slug is a `PATCH`, new slug is an insert. A
  re-run after a crash changes nothing, which is the difference between a
  pipeline and a cleanup job.
- **The gate runs before the write.** An entry whose body is about the wrong
  subject is blocked and never reaches the API, so there is no retraction path
  to build.
- **Rate limits are expected, not exceptional.** 429 is retried honouring
  `Retry-After`, and the remaining budget is surfaced so a batch can pace
  itself. Webflow allows 60 requests a minute on Starter and Basic.

### `examples/mcp-fleet`

Generates the server map for a large fleet from a plain list of sites.
Credentials are emitted as environment variable references, never values, so
the generated file is safe to commit. Duplicate server names and unknown
platforms fail loudly instead of silently overwriting an entry.

---

## Things that cost time, written down

- **A reasoning model returns a thinking block first.** Reading `content[0]`
  gets you the thinking, not the answer. Iterate and take the text parts.
- **Free tiers are quota-shaped, not capability-shaped.** One candidate model
  worked perfectly and allowed twenty requests per day, which is useless for
  seeding a backlog. The quota was per-model, so switching models gave a fresh
  bucket.
- **Some models accept a JSON response mode and ignore it.** The output is still
  fenced markdown. A tolerant parser hides this, which is why the test checks
  for it separately: tolerating it means every call site carries that parser
  forever.
- **An object cache can serve stale reads across processes.** A seeding job
  over-added because it re-read a stale count between iterations. Flush before
  every monitoring read, and dedupe afterwards on similarity rather than trusting
  the counter.
- **A feed that works in your browser can 403 from the server.** Datacenter IP
  blocks are invisible until you fetch server side. Drop the source rather than
  leaving a silently failing feed in the rotation.
- **Keyword classifiers drift off-topic.** General policy feeds leak stories into
  specific categories. Moving classification into a stage that is allowed to
  *reject* fixed it; a classifier that must pick a bucket will always pick one.

---

## Why these choices

**Code rather than a workflow tool.** Everything here is modules in a
repository, reviewed, tested, and deployed through the same path as any other
code. Workflow canvases are good where a non-engineer needs to see and change a
step. They are bad where correctness matters, because the logic is not
diffable, not testable, and not reviewable.

**Gates rather than reports.** A check that produces a report produces a report
nobody reads. The same check with a non-zero exit code blocks a publish. Both
examples here exit non-zero on failure for that reason.

**Staging before a client property, always.** On commerce stores that means
changes go to an unpublished theme and are verified by role, never by name. The
cost of being wrong on a live storefront is not symmetrical with the cost of one
extra step.

---

MIT licensed. Questions welcome.
