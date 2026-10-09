// MedIntel CMS proxy: a Cloudflare Worker that lets the browser app read CMS
// endpoints that send no CORS headers (Provider Data Catalog, NPPES), and acts
// as the fallback for the ones that do. It replaces the free public CORS relays
// the app used before. Deploy steps: proxy/README.md.
//
// Request shape: https://<worker>/<cms path>?<cms query>
//   /data-api/v1/dataset/…                 → https://data.cms.gov/data-api/v1/dataset/…
//   /provider-data/api/1/datastore/query/… → https://data.cms.gov/provider-data/api/1/datastore/query/…
//   /data.json                             → https://data.cms.gov/data.json
//   /nppes/api/                            → https://npiregistry.cms.hhs.gov/api/
// Anything else, any method but GET/OPTIONS, and any browser Origin not on the
// list in policy.js gets a 403 without contacting upstream.

import { resolveUpstream, isAllowedOrigin, corsHeaders } from './policy.js';

const USER_AGENT = 'medintel-cms-proxy (+https://github.com/jdef11/medintel)';

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// deps: { fetch, cache, waitUntil } — injected so tests can run this in Node.
export async function handleRequest(request, env, deps) {
  // ALLOW_NULL_ORIGIN (wrangler.toml [vars]) decides whether a page opened from
  // file:// may read responses. On by default: see proxy/README.md.
  const corsOpts = { allowNullOrigin: String(env && env.ALLOW_NULL_ORIGIN) !== 'false' };
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, corsOpts);

  // A browser page on some other site: refuse before doing any work, so it
  // can't spend this Worker's daily request quota on upstream fetches. (A
  // non-browser client sends no Origin and is allowed; CORS can't stop curl,
  // the path allowlist is what limits what it can reach.)
  if (origin !== null && !isAllowedOrigin(origin, corsOpts)) {
    return json(403, { error: 'origin_not_allowed', origin });
  }

  if (request.method === 'OPTIONS') {
    const requested = request.headers.get('Access-Control-Request-Headers');
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        ...(requested ? { 'Access-Control-Allow-Headers': requested } : {}),
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'GET') {
    return json(403, { error: 'method_not_allowed', method: request.method, allowed: ['GET', 'OPTIONS'] }, { ...cors, Allow: 'GET, OPTIONS' });
  }

  const target = resolveUpstream(request.url);
  if (!target.ok) {
    return json(403, { error: 'not_allowlisted', reason: target.reason }, cors);
  }
  const { route, upstreamUrl } = target;

  // Cache key is the upstream URL, so every allowed origin shares one entry;
  // CORS headers are added per response below, never stored.
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  const cached = await deps.cache.match(cacheKey);
  if (cached) return withHeaders(cached, { ...cors, 'X-Proxy-Cache': 'HIT' });

  let upstream;
  try {
    upstream = await deps.fetch(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(route.timeoutMs),
      // Fetch-level edge caching too, as recommended for Workers that proxy
      // another site. A second layer next to the Cache API: on a *.workers.dev
      // URL Cloudflare only guarantees the Cache API on custom domains, so
      // this keeps caching useful there. 200s only, errors are never cached.
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': route.ttlSeconds, '300-599': 0 } },
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return json(timedOut ? 504 : 502, {
      error: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
      upstream: route.name,
      ...(timedOut ? { timeoutMs: route.timeoutMs } : { message: String((e && e.message) || e) }),
    }, cors);
  }

  // Upstream status codes pass through as-is. Only the headers the app needs
  // are kept (no Set-Cookie, no upstream Vary/Cache-Control). CMS marks these
  // responses no-store, and cache.put() refuses those, so a 200 gets an
  // explicit max-age here.
  const headers = new Headers();
  const type = upstream.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  const cacheable = upstream.status === 200;
  headers.set('Cache-Control', cacheable ? `public, max-age=${route.ttlSeconds}` : 'no-store');
  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });

  if (cacheable) {
    // Streams to both the cache and the client; never buffered in full
    // (data.json is ~18 MB against a 128 MB isolate memory limit).
    deps.waitUntil(deps.cache.put(cacheKey, response.clone()).catch(() => {}));
  }
  return withHeaders(response, { ...cors, 'X-Proxy-Cache': 'MISS' });
}

function withHeaders(response, extra) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, {
      fetch: (url, init) => fetch(url, init),
      cache: caches.default,
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};
