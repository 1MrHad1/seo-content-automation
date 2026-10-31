# 7. Adding a platform the fleet had never touched

Every other case study here describes something already in production. This one
is different and worth labelling as such: it is a platform I had not worked on,
added deliberately, to find out how much of the existing approach transfers.

The answer was: the transport is new, the discipline is not.

## What was actually new

- The Data API v2 shape. Items are created as drafts and published separately,
  so "create" and "live" are two calls, not one.
- Rate limits scale with the site plan: 60 requests a minute on Starter and
  Basic, 120 on CMS and Business.
- Site-wide publishing is capped at one successful call per minute, which makes
  it unusable in a loop. Item-level publishing has no such cap.

## What transferred unchanged

**Idempotency by natural key.** The same reasoning as inventory sync: identify
by something stable, diff against what is already there, and only write the
difference. Slug is the natural key, so an existing slug is a `PATCH` and a new
one is an insert. A re-run after a crash changes nothing.

**Only write what actually changed.** Comparing field by field before sending a
`PATCH` keeps the request count down, which matters directly when the budget is
60 a minute.

**The gate runs before the write.** The content integrity check from
[case study 3](03-content-integrity.md) is wired in ahead of the API calls, not
after them. An entry whose body is about the wrong subject is blocked and never
reaches Webflow. There is no retraction path to build because nothing wrong was
ever published.

**Rate limits are an expected condition, not an error.** Same as the model
router: retry, honour the server's own hint, and surface the remaining budget so
the caller can pace itself.

## One real bug, caught by a test

The first version treated `Retry-After: 0` as absent and fell through to
exponential backoff, because the check was `retryAfter > 0`. Zero is a valid
instruction meaning retry immediately. The practical effect was a suite that
took twelve seconds instead of forty milliseconds, and in production it would
have been a pipeline sleeping through a window it was allowed to use.

It was a one-character class of mistake, found only because the test asserted on
behaviour rather than on "did it eventually succeed".

## The MCP server, and why

A script is enough to publish. An MCP server makes the site **addressable**:
one more entry in the fleet, callable by name in a session alongside the
WordPress sites and Shopify stores. That is the difference between automating a
task and operating a fleet.

It is written directly against the protocol rather than with the SDK. MCP over
stdio is newline-delimited JSON-RPC 2.0, and three methods carry a server of
this size. Hand-writing it keeps the repository dependency-free and means
anyone reading it can see exactly what the agent is being offered.

One detail worth stating, since it is the kind of thing that gets it wrong: a
tool that throws returns `isError` on the **result**, not a JSON-RPC error. The
call reached the server and was handled correctly. It was the work that failed,
and the model needs to be able to read why and try something else.

## What running it against a real site taught me

None of this is in the quickstart. Every one cost time.

**`published-on` is a reserved slug.** Declaring it on collection create does
not error. The field is **silently dropped**, and you get a collection with one
fewer field than you asked for.

**The single-field endpoint does not accept a slug.** It derives one from the
display name and appends a suffix on collision, so asking for `published-on` a
second way produced `published-on-2`. That also meant my reconcile compared
slugs, never found the field it asked for, and would have re-created it on
every run forever. Reconcile now matches display name as well as slug.

**Item publish fails on a site that has never been published.**
`409 Conflict: The site is not published.` The site needs one publish before
item-level publishing works at all.

**"Unchanged" is about content, not about being live.** A run that created
items and then failed before the publish step leaves items that compare as
identical on the next run and are therefore skipped, forever unpublished. An
item with no `lastPublished` now gets published even when its content has not
changed.

**A regenerated timestamp destroys idempotency.** Setting a publish date to
`new Date()` on every run makes the diff always differ, so every item updates
every time. A publish date belongs to the item, not to the run. There is now a
write-once field set, and two consecutive runs are provably clean.

**Page settings are a PUT to `/pages/:id`, not a PATCH**, and PATCH returns
route-not-found rather than method-not-allowed, which is a confusing way to
learn the difference. It needs `pages:write`, which a token created for CMS
work alone will not have.

## Where the Data API stops

Worth stating plainly, because it is the thing people assume wrongly: **the
Webflow Data API is a content and metadata API, not a page builder.**

- Collections, fields, items, publishing: yes.
- Page title, description and OpenGraph: yes.
- Creating a page: no. `POST /sites/:id/pages` returns 404.
- Creating elements or layout: no. The page DOM endpoint updates text in nodes
  that already exist, so on a blank page, where `nodes` is `[]`, there is
  nothing to write to.

So a site can be fully populated and fully optimised from code, and still need
a designer to lay out the template once. Knowing exactly where that line falls
is more useful than assuming it is further in either direction.

## Honest scope

This is a working integration with tests, not years of Webflow experience. What
it demonstrates is the part that actually transfers between platforms: that the
hard problems in publishing automation are idempotency, gating, and rate
discipline, and that those are the same whether the CMS is WordPress, Shopify or
Webflow. Only the transport changes.
