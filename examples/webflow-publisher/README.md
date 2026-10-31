# webflow-publisher

An idempotent publisher for the Webflow Data API v2, plus a hand-written MCP
server so a Webflow site becomes addressable by name inside an agent session,
the same way the rest of the fleet is.

```bash
node --test webflow.test.mjs          # 16 tests, no token needed
node publish.mjs content.sample.json --dry
node publish.mjs content.sample.json  # needs WEBFLOW_TOKEN + WEBFLOW_COLLECTION_ID
```

## What it does

| File | Responsibility |
|---|---|
| `client.mjs` | Data API v2 transport. Rate-limit aware, retries 429 honouring `Retry-After`, errors carry status and body. |
| `publish.mjs` | Upsert by slug, then publish. Runs the content integrity gate **before** anything is written. |
| `mcp-server.mjs` | MCP over stdio, JSON-RPC 2.0, no SDK. Five tools. |

## The three decisions

**Idempotent by slug.** A publishing pipeline gets re-run constantly: after a
crash, after a partial batch, after someone fixes one row upstream. Existing
slug means `PATCH`, new slug means insert. A create-only integration turns every
one of those re-runs into a cleanup job.

**The gate runs before the write, not after.** An entry whose body is about a
different subject than its title is blocked and never reaches the API. A
pipeline that publishes first and validates later needs a retraction process.
The check is the same one in [`../content-integrity`](../content-integrity).

**Item-level publish, not site publish.** Webflow limits site-wide publishing to
one successful call per minute. Publishing the specific item IDs you touched
avoids that ceiling entirely.

## Rate limits, as documented

Webflow's limit depends on the site plan: **Starter and Basic 60 requests per
minute**, CMS and Business 120. A 429 returns `Retry-After`, and every response
carries `X-RateLimit-Remaining`. The client reports that budget to the caller
through `onBudget` so a batch can slow itself down rather than slam into a wall.

`Retry-After: 0` is a valid instruction meaning retry immediately, and is
honoured as such. Treating it as absent and falling through to exponential
backoff is a real bug, and was one here until a test caught it.

## Running it against a real site

1. Create a free Webflow account and a site. The Starter plan appears in
   Webflow's own rate-limit table, so it has Data API access.
2. Add a CMS collection with at least a Name and Slug field.
3. Site settings, Apps and integrations, API access, generate a token with
   `cms:read` and `cms:write`.
4. Export it and find your collection id:

```bash
export WEBFLOW_TOKEN="..."
node -e "import('./client.mjs').then(async m=>{
  const c=m.createClient({token:process.env.WEBFLOW_TOKEN});
  const {sites}=await c.listSites();
  for(const s of sites){
    const {collections}=await c.listCollections(s.id);
    console.log(s.displayName||s.shortName, collections.map(x=>x.slug+' = '+x.id));
  }
})"
```

5. Then:

```bash
export WEBFLOW_COLLECTION_ID="..."
node publish.mjs content.sample.json --dry   # plan only
node publish.mjs content.sample.json         # writes and publishes
```

The sample file contains three entries, one of which is deliberately broken:
its title says one thing and its body is about another. The gate blocks it and
the command exits non-zero, so two entries publish and one does not.

## As an MCP server

```json
{
  "mcpServers": {
    "webflow-marketing": {
      "command": "node",
      "args": ["./examples/webflow-publisher/mcp-server.mjs"],
      "env": { "WEBFLOW_TOKEN": "${WEBFLOW_MARKETING_TOKEN}" }
    }
  }
}
```

Tools: `webflow_list_sites`, `webflow_list_collections`, `webflow_get_collection`,
`webflow_list_items`, `webflow_publish`.

MCP over stdio is newline-delimited JSON-RPC 2.0, and three methods carry a
server like this: `initialize`, `tools/list`, `tools/call`. Writing it by hand
rather than pulling in the SDK keeps this repository dependency-free, and the
protocol stays legible to anyone reading it. A tool failure returns `isError`
on the result rather than a JSON-RPC error, because the call reached the server
fine; it was the work that failed.

Context: [case study 7](../../case-studies/07-webflow-integration.md).
