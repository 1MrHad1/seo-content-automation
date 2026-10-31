/**
 * Webflow Data API v2 client.
 *
 * Deliberately small and dependency-free. The only things it does beyond
 * fetch are the three that actually bite in production:
 *
 *   1. Rate limits are a certainty, not an error. The Starter and Basic plans
 *      allow 60 requests a minute, CMS and Business 120. A seeding run will
 *      hit that. So 429 is retried, honouring the Retry-After header Webflow
 *      sends, rather than treated as a failure.
 *   2. The remaining-request budget is readable before you run out.
 *      X-RateLimit-Remaining is checked on every response so a batch can slow
 *      itself down rather than slam into a wall.
 *   3. Errors carry the status and the body. "Request failed" is useless when
 *      the body says which field was rejected.
 *
 * Docs: https://developers.webflow.com/data/reference
 */

const BASE = 'https://api.webflow.com/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WebflowError extends Error {
  constructor(status, body, path) {
    super(`Webflow ${status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'WebflowError';
    this.status = status;
    this.body = body;
  }
}

export function createClient({ token, fetchImpl = fetch, maxRetries = 4, onBudget,
                               baseDelayMs = 1000 } = {}) {
  if (!token) throw new Error('WEBFLOW_TOKEN is required');

  async function request(method, path, body) {
    let attempt = 0;

    for (;;) {
      const response = await fetchImpl(BASE + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      // Let a caller pace itself before it runs the budget down.
      const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
      if (Number.isFinite(remaining) && onBudget) onBudget(remaining);

      if (response.status === 429) {
        attempt += 1;
        if (attempt > maxRetries) throw new WebflowError(429, 'rate limited, retries exhausted', path);
        // Webflow states the reset is typically 60 seconds and sends Retry-After.
        // Retry-After: 0 is a valid instruction meaning retry immediately, so it
        // has to be honoured rather than treated as absent.
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1000
          : 2 ** attempt * baseDelayMs;
        if (wait > 0) await sleep(wait);
        continue;
      }

      if (response.status === 204) return null;

      const text = await response.text();
      const parsed = text ? safeJson(text) : null;
      if (!response.ok) throw new WebflowError(response.status, parsed ?? text, path);
      return parsed;
    }
  }

  return {
    request,
    listSites: () => request('GET', '/sites'),
    listCollections: (siteId) => request('GET', `/sites/${siteId}/collections`),
    getCollection: (collectionId) => request('GET', `/collections/${collectionId}`),
    listItems: (collectionId, { limit = 100, offset = 0 } = {}) =>
      request('GET', `/collections/${collectionId}/items?limit=${limit}&offset=${offset}`),

    /** Up to 100 items per call. Items are created as drafts unless isDraft is false. */
    createItems: (collectionId, items) =>
      request('POST', `/collections/${collectionId}/items/insert`, { items }),

    updateItem: (collectionId, itemId, fieldData) =>
      request('PATCH', `/collections/${collectionId}/items/${itemId}`, { fieldData }),

    /** Returns { publishedItemIds, errors }. Item-level publish avoids the one-per-minute site publish limit. */
    publishItems: (collectionId, itemIds) =>
      request('POST', `/collections/${collectionId}/items/publish`, { itemIds }),

    listPages: (siteId) => request('GET', `/sites/${siteId}/pages`),

    /**
     * Page title, description and OpenGraph. Note the verb: this is a PUT to
     * /pages/:id, not a PATCH, and PATCH returns a route-not-found rather than
     * a method-not-allowed, which is a confusing way to learn the difference.
     * Needs the pages:write scope, which a token created for CMS work alone
     * will not have.
     */
    updatePage: (pageId, body) => request('PUT', `/pages/${pageId}`, body),

    /** Item-level publish needs the site to have been published at least once. */
    publishSite: (siteId, { toWebflowSubdomain = true, customDomains = [] } = {}) =>
      request('POST', `/sites/${siteId}/publish`,
        customDomains.length ? { customDomains } : { publishToWebflowSubdomain: toWebflowSubdomain }),
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}
