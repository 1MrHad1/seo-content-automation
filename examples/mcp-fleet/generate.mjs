#!/usr/bin/env node
/**
 * Fleet config generator.
 *
 * Driving one site from an agent is easy. Driving a hundred is a config
 * problem: every site needs its own server entry, its own credential, a
 * predictable name you can address in a prompt, and no secrets in the file
 * you commit.
 *
 * This generates the server map from a plain list of sites. Credentials are
 * emitted as environment variable references, never values, so the output is
 * safe to commit and the secrets live in the environment.
 *
 *   node generate.mjs sites.example.json            # print
 *   node generate.mjs sites.example.json --write .mcp.json
 *   node generate.mjs sites.example.json --env      # the env var names to set
 */

import { readFile, writeFile } from 'node:fs/promises';

/** A name you can type in a prompt: stable, lowercase, no dots. */
export function serverName(site) {
  const base = site.name ?? site.host.replace(/^www\./, '').replace(/\./g, '-');
  return `${site.platform}-${base}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 42);
}

export function envVar(site, suffix) {
  return `${serverName(site).toUpperCase().replace(/-/g, '_')}_${suffix}`;
}

const BUILDERS = {
  wordpress: (site) => ({
    command: 'npx',
    args: ['-y', '@automattic/mcp-wordpress-remote@latest'],
    env: {
      WP_API_URL: `https://${site.host}/`,
      WP_API_USERNAME: `\${${envVar(site, 'USER')}}`,
      WP_API_PASSWORD: `\${${envVar(site, 'APP_PASSWORD')}}`,
    },
  }),
  webflow: (site) => ({
    command: 'node',
    args: ['./examples/webflow-publisher/mcp-server.mjs'],
    env: { WEBFLOW_TOKEN: `\${${envVar(site, 'TOKEN')}}` },
  }),
  shopify: (site) => ({
    command: 'node',
    args: ['./mcp-servers/shopify-admin/dist/index.js'],
    env: {
      SHOPIFY_SHOP_DOMAIN: site.host,
      SHOPIFY_ACCESS_TOKEN: `\${${envVar(site, 'TOKEN')}}`,
    },
  }),
};

export function buildFleet(sites) {
  const mcpServers = {};
  const seen = new Set();

  for (const site of sites) {
    const builder = BUILDERS[site.platform];
    if (!builder) throw new Error(`unknown platform "${site.platform}" for ${site.host}`);

    const name = serverName(site);
    if (seen.has(name)) throw new Error(`duplicate server name "${name}" (${site.host})`);
    seen.add(name);

    mcpServers[name] = builder(site);
  }

  return { mcpServers };
}

export function requiredEnv(sites) {
  const names = [];
  for (const site of sites) {
    if (site.platform === 'wordpress') names.push(envVar(site, 'USER'), envVar(site, 'APP_PASSWORD'));
    if (site.platform === 'shopify') names.push(envVar(site, 'TOKEN'));
    if (site.platform === 'webflow') names.push(envVar(site, 'TOKEN'));
  }
  return names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node generate.mjs <sites.json> [--write <path>] [--env]');
    process.exit(2);
  }
  const sites = JSON.parse(await readFile(file, 'utf8'));

  if (process.argv.includes('--env')) {
    for (const name of requiredEnv(sites)) console.log(`${name}=`);
    process.exit(0);
  }

  const config = buildFleet(sites);
  const json = JSON.stringify(config, null, 2);

  const writeIndex = process.argv.indexOf('--write');
  if (writeIndex !== -1 && process.argv[writeIndex + 1]) {
    await writeFile(process.argv[writeIndex + 1], json + '\n');
    console.error(`wrote ${Object.keys(config.mcpServers).length} servers`);
  } else {
    console.log(json);
  }
}
