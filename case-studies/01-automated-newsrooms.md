# 1. Automated newsrooms

Six sites. Each one ingests, filters, rewrites, illustrates and publishes on its
own schedule with no human in the loop. Twenty-four posts seeded per site across
six categories, then a steady cadence on cron.

## The pipeline

Five modules per site, each one independently runnable so a stage can be tested
without running the whole chain.

| Module | Responsibility |
|---|---|
| `ingest` | Fetch roughly eighteen feeds, dedupe by URL hash against a capped seen-set, keyword classify, stage as draft |
| `rewrite` | Relevance gate, classify, rewrite. Off-topic items are marked rejected, not published |
| `image` | Take the real source image, download and self-host it, fall back to generated cover art |
| `cron` | Orchestrate a cycle, with a backlog that self-regulates |
| `fill` | Seed a category from a feed map, with a scan cap |

Staging as draft first is what makes the rest safe. Every stage reads and writes
a status field, so a failure leaves a visible intermediate state rather than a
half-published post.

## Two design decisions worth the space

**The relevance gate is allowed to reject.** The first version was a keyword
classifier, and it was too loose: general policy feeds carried stories that had
nothing to do with the vertical, and a classifier that must choose a bucket will
always choose one. Moving the decision into a stage with an explicit
`relevant: false` path fixed it. The lesson generalises: a classifier without a
refusal option does not fail loudly, it fails quietly into your best-matching
category.

**The backlog regulates itself.** Ingestion skips entirely while the draft
backlog is at or above a threshold. Without that, a scheduled ingest keeps
adding on every cycle regardless of whether the rewrite stage is keeping up, and
you get a queue that only grows. With it, the system drains before it refills,
and a slow day upstream is self-correcting.

## Images

The first version generated cover art. It was rejected on quality, which was the
right call. The replacement takes the real image from the feed item, falling
back through `media:content`, thumbnail, enclosure, first inline image, and then
the source page's `og:image`.

The part that matters: it **downloads and self-hosts** rather than hotlinking.
Hotlinking makes your page's appearance depend on someone else's server and
their willingness to serve you. Generated art stayed as the fallback for items
with no usable image.

This carries a real caveat that should be stated rather than buried: reusing a
publisher's image has copyright implications. It was flagged at the time rather
than discovered later.

## Four bugs that cost real time

**A stale object cache across processes.** The seeding job read a count, added
posts, and re-read the count on the next iteration. The cache served the old
value, so it over-added. Fixed by flushing before every monitoring read, and by
deduping afterwards on text similarity rather than trusting the counter at all.

**Duplicates from overlapping feeds.** URL hashing catches the same URL. It does
not catch the same story published by two outlets. A similarity threshold on the
title and opening text does.

**A feed that 403s only from the server.** It loaded fine in a browser and
returned 403 from the host, a datacenter IP block. It was dropped from the
server-side rotation. The general version of this: test fetches from where the
fetch will actually happen.

**Reading `content[0]` from a reasoning model.** The first content block is the
thinking, not the answer. Iterate the blocks and take the text parts.

## What was deliberately not automated

The sites stayed `noindex` until a go-live gate that was never purely technical:
a real accountable editor, filled trust pages, and a minimum volume of seeded
content. Automation can produce the posts. It cannot produce the accountability
that makes publishing them reasonable, and pretending otherwise is how these
projects go wrong.
