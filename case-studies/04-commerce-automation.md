# 4. Commerce automation

Eight Shopify stores wired into the same environment as the content fleet, over
the Admin API. Catalogue operations, product and metadata copy, merchandising,
and conversion work, driven from code rather than through the admin UI.

## Why the API rather than the admin

Admin UI work does not scale past about ten edits and is not reviewable. API
work is a script: it can be dry-run, diffed, re-run, and read by someone else
six months later.

Typical operations, each one a script rather than an afternoon of clicking:

- Audit every product for a missing or truncated meta description, and report by
  severity rather than listing everything.
- Rewrite product titles to a consistent pattern without destroying the ones
  that are already good.
- Find products whose description is thin, duplicated across variants, or
  obviously templated.
- Check image alt text coverage across a catalogue.
- Reconcile a collection against the rules that are supposed to populate it.

The SEO value is boring and real: titles, meta descriptions, alt text, internal
linking and structured data, applied consistently across a whole catalogue
instead of on the twenty products someone remembered.

## The rule that matters most

**Theme changes go to an unpublished draft, never to the live theme, and the
draft is identified by role rather than by name.**

The name is the trap. "Live", "Main" and "Production" are labels a human typed,
and on a store that has been through three agencies there will be two themes
called some variant of main and only one of them is serving traffic. Checking
the role rather than the name is the difference between a safe deploy and
taking a storefront down during business hours.

The cost is one extra step. The cost of being wrong is somebody's revenue, so
the asymmetry decides it.

## Catalogue safety

Two more rules that came out of real incidents rather than theory:

**Compare and swap on inventory, never blind writes.** A sync that reads a
level, computes a new one, and writes it will oversell when a real sale lands
between the read and the write. Conditioning the write on the value you read is
the whole fix.

**Hold large deltas for review.** A feed that suddenly reports a product's stock
dropping from 400 to 2 is more likely a broken export than a real event.
Applying it automatically is how a catalogue gets wiped. Flagging it costs a
human thirty seconds.

A worked version of both, with duplicate webhook handling and retries:
[github.com/1MrHad1/shopify-apparel-sync](https://github.com/1MrHad1/shopify-apparel-sync).

## What is genuinely harder here than on content sites

Commerce has a correctness surface that publishing does not. A wrong word in a
blog post is embarrassing. A wrong price, a wrong inventory level or a published
draft theme costs money the same afternoon. That is why the safety rules above
are rules rather than preferences, and why the automation is deliberately more
conservative than the content pipelines: more dry runs, more staging, more
things held for review.
