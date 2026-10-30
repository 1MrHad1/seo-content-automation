# 6. Pre-launch footprint audit

Before any of the six automated news sites were allowed to go public, they were
audited as a group rather than individually. The question was not "is each site
good". It was "what does this set of sites give away about itself".

This is the part of automated publishing that gets skipped, and it is the part
that decides whether the work survives contact with a search engine.

## What was measured

| Signal | Finding |
|---|---|
| Hosting | All on one provider |
| IP range | Five of six shared a `/24` |
| Registration timing | All registered inside a six-minute window |
| Theme | One theme across all six |
| Admin contact | A single shared address |
| **Interlinking** | **Zero links between the sites** |
| **Authors** | **Unique per site** |
| **Favicons and identity** | **Unique per site** |
| **Index status** | **All six `noindex`** |

The first five rows are footprint. The last four are the mitigations, and they
were deliberate rather than lucky.

## The one that matters most

**Zero interlinking.** A group of similar sites that do not link to each other
is a group of similar sites. The same group with links between them is a link
scheme, and the difference is the entire difference.

Keeping that at zero was a rule from the start, not a cleanup. It is also the
cheapest rule to break by accident: one "related reading" widget pulling from a
shared feed, one footer partner list, and the network is wired together.

## What the audit changed

Registering six domains inside a six-minute window cannot be undone. Shared
hosting and a shared `/24` can be, at a cost. The useful output of the audit was
not a score, it was a decision list:

- Which footprint signals are fixable and worth fixing.
- Which are already baked in and have to be compensated for elsewhere.
- What has to be true before any site flips to indexable.

The go-live gate that came out of it was not purely technical. It required a
real accountable editor on each site, completed trust pages with real entity
details, and a minimum volume of seeded content. Until then the sites stayed
`noindex`.

## Why this is in a portfolio

Anyone can build a pipeline that publishes at volume. The interesting question
for anyone hiring for automated content work is whether the person building it
thinks about the footprint before launch or after a penalty.

Running the audit first, writing down which signals were unfixable, and holding
the sites at `noindex` behind a non-technical gate is the answer to that
question. The restraint is the skill, not the throughput.
