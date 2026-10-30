# mcp-fleet

Generates the MCP server map for a large fleet of sites from a plain list.
Credentials are emitted as environment variable references, never values.

```bash
node generate.mjs sites.example.json
node generate.mjs sites.example.json --env     # the env vars you must set
node generate.mjs sites.example.json --write .mcp.json
node --test generate.test.mjs
```

Context: [case study 5](../../case-studies/05-fleet-operations.md).
