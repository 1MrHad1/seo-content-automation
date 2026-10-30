# 5. Operating a fleet

93 WordPress sites and 8 Shopify stores, addressable by name from one
environment. 116 MCP servers in total once search data, analytics, hosting and
deployment are included.

The number is not the point. The point is that a site stops being a tab and
becomes a thing you can refer to. "Check which of these forty sites lost
impressions last month, and for the ones that did, tell me whether anything
changed on the page" is one instruction instead of a day.

## Config generation, not config editing

A hundred hand-maintained server entries is a hundred chances to paste a
credential into a file that gets committed. So the map is generated from a plain
list of sites, and credentials are emitted as **environment variable
references, never values**.

Working version: [`examples/mcp-fleet`](../examples/mcp-fleet).

Three properties it enforces:

- **Names are addressable.** Stable, lowercase, no dots, derived from the host.
  You have to be able to type the name in a prompt without looking it up.
- **Duplicates fail loudly.** Two sites resolving to the same server name would
  silently overwrite one entry, and you would not notice until an operation hit
  the wrong site.
- **No secrets in the output.** The generated file is safe to commit. There is a
  test asserting that, because "we are careful about this" is not a control.

## Gates, not reports

The pattern that made the difference across the fleet: every quality check exits
non-zero.

A check that prints a report produces a report, and reports accumulate unread.
The same check wired as a gate blocks a publish, a deploy or a merge. It is the
same logic and a completely different outcome.

In practice that meant:

- A page is not "done" until a browser-driven check passes against the live
  render: computed styles, and screenshots at desktop and mobile widths. Not a
  visual review, assertions.
- Content does not publish until it passes its integrity check (see
  [case study 3](03-content-integrity.md)).
- A theme change does not reach a live storefront until it has been verified on
  an unpublished draft (see [case study 4](04-commerce-automation.md)).

## Why things are checked against the live render

Builder-based sites are the reason. A page builder's own typography settings
frequently do not reach the published page, because theme CSS, a caching layer
or a plugin overrides them. The builder preview shows one thing and the live
page shows another.

So the check reads **computed styles from the rendered page**, not the settings
that were supposed to produce them. Anything else is checking your intention
rather than the result.

## Writing it down as the actual deliverable

On a fleet this size, undocumented knowledge is an outage waiting for a holiday.
The convention that worked was to turn each repeatable operation into a written
procedure stored next to the work: what the modules are, what the gotchas are,
and how to replicate it to the next site.

That is what made the newsroom pipeline replicable from one reference build to
five more. The code was maybe sixty percent of it. The written procedure, with
the four bugs and why each decision went the way it did, was the rest.
