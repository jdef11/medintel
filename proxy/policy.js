// Pure request policy for the MedIntel CMS proxy: which upstream URLs may be
// fetched, and which browser origins may read the answers. No Workers APIs in
// here, so the "not an open proxy" guarantee is unit-tested in Node
// (proxy/worker.test.mjs) exactly as it runs in production.
//
// The proxy is NOT a generic "?url=" relay. The upstream host is fixed per
// route and only the path below a fixed prefix (plus the query string) comes
// from the request, so there's no way to aim it at an arbitrary host.

const DAY = 24 * 60 * 60;

// Each route: how a request path maps to exactly one upstream origin.
//   prefix: request path must start with this (and have something after it)
//   exact:  request path must equal this
// ttlSeconds: edge-cache lifetime for a 200. CMS claims data is published
//   annually, and the catalog changes rarely, so a day is safe. NPPES is a live
//   registry (new NPIs and address changes daily), so it gets an hour.
// timeoutMs: the Worker gives up on upstream after this and answers 504 JSON.
//   Each is set below the app's own client-side timeout for that call (25s <
//   PROXY_TIMEOUT_MS 30s; 45s < PRACTICE_FETCH_TIMEOUT_MS 60s; 20s <
//   CATALOG_TIMEOUT_MS 45s) so the app gets a readable error, not its own abort.
export const ROUTES = [
  {
    name: 'data-api',
    prefix: '/data-api/v1/dataset/',
    upstreamOrigin: 'https://data.cms.gov',
    ttlSeconds: DAY,
    timeoutMs: 25000,
  },
  {
    name: 'provider-data',
    prefix: '/provider-data/api/1/datastore/query/',
    upstreamOrigin: 'https://data.cms.gov',
    ttlSeconds: DAY,
    timeoutMs: 45000, // this backend takes ~13-15s per query regardless of size
  },
  {
    name: 'catalog',
    exact: '/data.json',
    upstreamOrigin: 'https://data.cms.gov',
    ttlSeconds: DAY,
    timeoutMs: 20000,
  },
  {
    // NPPES sends no CORS headers (verified Oct 2026), so the NPI Look Up
    // utility needs the proxy too. Only its one API endpoint, /api/.
    name: 'nppes',
    exact: '/nppes/api/',
    upstreamOrigin: 'https://npiregistry.cms.hhs.gov',
    upstreamPath: '/api/',
    ttlSeconds: 60 * 60,
    timeoutMs: 15000,
  },
];

// Path characters CMS's dataset ids and segments actually use. Rejecting
// everything else (%, \, @, :, ;, spaces…) closes off encoded traversal and
// parser-confusion tricks instead of trying to enumerate them.
const SAFE_PATH = /^\/[A-Za-z0-9._~\-\/]*$/;
const MAX_QUERY_LENGTH = 16 * 1024; // a 50-NPI provider-data batch is ~2 KB

// Maps an incoming request URL to the single upstream URL it may fetch.
// Returns { ok: true, route, upstreamUrl } or { ok: false, reason }.
// The query string is copied byte-for-byte from the raw request URL (never
// parsed and re-serialized), so provider-data's repeated
// conditions[0][value][]=… params reach CMS exactly as the app built them.
export function resolveUpstream(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch (e) { return { ok: false, reason: 'unparseable URL' }; }
  const path = url.pathname;
  if (!SAFE_PATH.test(path)) return { ok: false, reason: 'path contains disallowed characters' };
  if (path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path)) return { ok: false, reason: 'path contains empty or dot segments' };

  const route = ROUTES.find((r) =>
    r.exact ? path === r.exact : (path.startsWith(r.prefix) && path.length > r.prefix.length));
  if (!route) return { ok: false, reason: 'path is not on the allowlist' };

  const hashAt = rawUrl.indexOf('#');
  const withoutHash = hashAt === -1 ? rawUrl : rawUrl.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const query = queryAt === -1 ? '' : withoutHash.slice(queryAt);
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, reason: 'query string too long' };

  const upstreamPath = route.upstreamPath || path;
  return { ok: true, route, upstreamUrl: route.upstreamOrigin + upstreamPath + query };
}

// Browser origins allowed to read proxy responses. `Origin: null` is what a
// page opened from file:// sends (also sandboxed iframes and data: URLs);
// whether it's accepted is a deploy-time setting, see worker.js.
export const ALLOWED_ORIGINS = ['https://jdef11.github.io'];
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;

export function isAllowedOrigin(origin, { allowNullOrigin = false } = {}) {
  if (origin === 'null') return allowNullOrigin;
  if (typeof origin !== 'string') return false;
  return ALLOWED_ORIGINS.includes(origin) || LOCALHOST_ORIGIN.test(origin);
}

// CORS headers for an allowed origin (empty object otherwise). The allowed
// origin is echoed, never "*", and Vary: Origin keeps any shared cache from
// serving one origin's headers to another.
export function corsHeaders(origin, opts) {
  if (!isAllowedOrigin(origin, opts)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'X-Proxy-Cache',
    Vary: 'Origin',
  };
}
