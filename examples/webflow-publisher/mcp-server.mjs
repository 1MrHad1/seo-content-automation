#!/usr/bin/env node
/**
 * Webflow MCP server, stdio transport, no SDK.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0. Three methods carry a
 * server like this: initialize, tools/list, tools/call. Writing it by hand
 * rather than pulling the SDK keeps this repository dependency-free and makes
 * the protocol legible to anyone reading it.
 *
 * Why an MCP server at all, rather than just the script: it makes a Webflow
 * site addressable by name inside an agent session, the same way the rest of
 * the fleet is. "Publish these twelve entries to the marketing site and tell
 * me which ones the gate rejected" becomes one instruction.
 *
 * Wire it up:
 *   {
 *     "mcpServers": {
 *       "webflow-marketing": {
 *         "command": "node",
 *         "args": ["./examples/webflow-publisher/mcp-server.mjs"],
 *         "env": { "WEBFLOW_TOKEN": "${WEBFLOW_MARKETING_TOKEN}" }
 *       }
 *     }
 *   }
 */

import { createInterface } from 'node:readline';
import { createClient } from './client.mjs';
import { run } from './publish.mjs';

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  { name: 'webflow_list_sites',
    description: 'List every Webflow site this token can reach.',
    inputSchema: { type: 'object', properties: {} } },

  { name: 'webflow_list_collections',
    description: 'List the CMS collections on a site.',
    inputSchema: { type: 'object', required: ['siteId'],
      properties: { siteId: { type: 'string', description: 'Webflow site id' } } } },

  { name: 'webflow_get_collection',
    description: 'Get a collection and its field definitions, so you know which fields you may write.',
    inputSchema: { type: 'object', required: ['collectionId'],
      properties: { collectionId: { type: 'string' } } } },

  { name: 'webflow_list_items',
    description: 'List staged items in a collection.',
    inputSchema: { type: 'object', required: ['collectionId'],
      properties: { collectionId: { type: 'string' },
                    limit: { type: 'number', description: 'default 100' },
                    offset: { type: 'number', description: 'default 0' } } } },

  { name: 'webflow_publish',
    description:
      'Idempotently upsert entries by slug and publish them. Runs the content integrity gate first: ' +
      'an entry whose body is about a different subject than its title is blocked and never written. ' +
      'Pass dryRun true to see the plan without writing.',
    inputSchema: { type: 'object', required: ['collectionId', 'entries'],
      properties: {
        collectionId: { type: 'string' },
        dryRun: { type: 'boolean' },
        entries: { type: 'array', description: 'Entries to upsert',
          items: { type: 'object', required: ['slug', 'title'],
            properties: {
              slug: { type: 'string' }, title: { type: 'string' },
              body: { type: 'string', description: 'Checked by the integrity gate' },
              fields: { type: 'object', description: 'Extra Webflow fieldData, by field slug' },
            } } },
      } } },
];

function client() {
  return createClient({ token: process.env.WEBFLOW_TOKEN });
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'webflow_list_sites':       return client().listSites();
    case 'webflow_list_collections': return client().listCollections(args.siteId);
    case 'webflow_get_collection':   return client().getCollection(args.collectionId);
    case 'webflow_list_items':
      return client().listItems(args.collectionId, { limit: args.limit ?? 100, offset: args.offset ?? 0 });
    case 'webflow_publish':
      return run({ client: client(), collectionId: args.collectionId,
                   incoming: args.entries, dryRun: Boolean(args.dryRun), log: () => {} });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- JSON-RPC plumbing -----------------------------------------------------

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

export async function handle(message) {
  const { id, method, params } = message;

  // Notifications have no id and must not be answered.
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'webflow-publisher', version: '1.0.0' },
      } };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const toolName = params?.name;
      try {
        const result = await callTool(toolName, params?.arguments ?? {});
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        } };
      } catch (error) {
        // A tool failure is a result with isError, not a protocol error.
        return { jsonrpc: '2.0', id, result: {
          isError: true,
          content: [{ type: 'text', text: String(error.message ?? error) }],
        } };
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { return fail(null, -32700, 'parse error'); }
    const reply = await handle(message);
    if (reply) send(reply);
  });
}

export { TOOLS };
