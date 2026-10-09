// Tests for the MedIntel CMS proxy. The point of these is the guarantee the
// Worker exists to keep: it only ever fetches the fixed CMS endpoints, never an
// arbitrary URL, and only the app's own origins can read its responses.
import { describe, it, expect, vi } from 'vitest';
import { resolveUpstream, isAllowedOrigin, corsHeaders, ROUTES } from './policy.js';
import { handleRequest } from './worker.js';

const W = 'https://medintel-cms-proxy.example.workers.dev';
const GH = 'https://jdef11.github.io';

describe('resolveUpstream(): the allowlist', () => {
  it.each([
    ['/data-api/v1/dataset/92396110-2aed-4d63-a6a2-5d6207d46a29/data?size=1',
      'https://data.cms.gov/data-api/v1/dataset/92396110-2aed-4d63-a6a2-5d6207d46a29/data?size=1'],
    ['/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data-viewer?size=0',
      'https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data-viewer?size=0'],
    ['/provider-data/api/1/datastore/query/mj5m-pzi6/0?limit=1',
      'https://data.cms.gov/provider-data/api/1/datastore/query/mj5m-pzi6/0?limit=1'],
    ['/data.json', 'https://data.cms.gov/data.json'],
    ['/nppes/api/?version=2.1&number=1548269731', 'https://npiregistry.cms.hhs.gov/api/?version=2.1&number=1548269731'],
  ])('allows %s', (path, upstream) => {
    const r = resolveUpstream(W + path);
    expect(r.ok).toBe(true);
    expect(r.upstreamUrl).toBe(upstream);
  });

  it.each([
    ['/', 'root'],
    ['/https://evil.example/x', 'a full URL in the path'],
    ['/?url=https://evil.example/', 'a ?url= relay attempt'],
    ['//evil.example/data.json', 'protocol-relative path'],
    ['/data.json/x', 'extra segment after an exact route'],
    ['/data.jsonx', 'prefix-of-exact'],
    ['/data-api/v1/dataset/', 'bare prefix with nothing after it'],
    ['/data-api/v1/datasetX/abc/data', 'look-alike prefix'],
    ['/data-api/v1/dataset/../../../etc/passwd', 'dot-dot traversal'],
    ['/data-api/v1/dataset/%2e%2e/%2e%2e/admin', 'percent-encoded traversal'],
    ['/data-api/v1/dataset/abc%2F..%2Fx/data', 'encoded slash'],
    ['/data-api/v1/dataset/..\\..\\..\\x', 'backslash traversal out of the prefix'],
    ['/data-api/v1/dataset//x/data', 'empty segment'],
    ['/provider-data/api/1/datastore/query', 'provider-data without the trailing slash'],
    ['/provider-data/api/1/metastore/schemas/dataset/items', 'other provider-data APIs'],
    ['/nppes/api/x', 'beyond the one NPPES endpoint'],
    ['/nppes/', 'NPPES root'],
    ['/api/?version=2.1', "NPPES's path without the /nppes route"],
  ])('rejects %s (%s)', (path) => {
    expect(resolveUpstream(W + path).ok).toBe(false);
  });

  it('whatever URL normalization does to a tricky path, an accepted one stays inside an allowlisted path', () => {
    const tricky = ['/data-api/v1/dataset/abc\\..\\x/data', '/data-api/v1/dataset/a/./b', '/data-api/v1/dataset/a/%2e/b',
      '/provider-data/api/1/datastore/query/x/../../../../data.json', '/nppes/api/../api/', '/data.json/.', '/./data.json'];
    const allowed = /^https:\/\/data\.cms\.gov\/(data-api\/v1\/dataset\/[^?]+|provider-data\/api\/1\/datastore\/query\/[^?]+|data\.json)(\?|$)|^https:\/\/npiregistry\.cms\.hhs\.gov\/api\/(\?|$)/;
    for (const path of tricky) {
      const r = resolveUpstream(W + path);
      if (r.ok) expect(r.upstreamUrl, path).toMatch(allowed);
    }
  });

  it('never lets the request choose the upstream host', () => {
    for (const r of ROUTES) {
      expect(['https://data.cms.gov', 'https://npiregistry.cms.hhs.gov']).toContain(r.upstreamOrigin);
    }
    // Userinfo / host tricks in the request URL only change the Worker's own
    // URL; the upstream origin still comes from the route.
    const r = resolveUpstream('https://evil.example@medintel.example/data.json');
    expect(r.ok && new URL(r.upstreamUrl).host).toBe('data.cms.gov');
  });

  it('passes the query string through byte-for-byte (repeated array params, encoded brackets)', () => {
    const q = '?conditions%5B0%5D%5Bproperty%5D=npi&conditions%5B0%5D%5Bvalue%5D%5B%5D=1548269731' +
      '&conditions%5B0%5D%5Bvalue%5D%5B%5D=1003000126&conditions[0][value][]=1234567890&conditions%5B0%5D%5Boperator%5D=in';
    const r = resolveUpstream(`${W}/provider-data/api/1/datastore/query/mj5m-pzi6/0${q}`);
    expect(r.upstreamUrl).toBe(`https://data.cms.gov/provider-data/api/1/datastore/query/mj5m-pzi6/0${q}`);
  });

  it('drops a #fragment and rejects an oversized query', () => {
    expect(resolveUpstream(`${W}/data.json?a=1#frag`).upstreamUrl).toBe('https://data.cms.gov/data.json?a=1');
    expect(resolveUpstream(`${W}/data.json?x=${'a'.repeat(17000)}`).ok).toBe(false);
  });
});

describe('CORS origin policy', () => {
  it.each([
    [GH, true],
    ['http://localhost:3000', true],
    ['http://localhost', true],
    ['http://localhost:65535', true],
    ['http://jdef11.github.io', false],
    ['https://jdef11.github.io.evil.example', false],
    ['https://evil.example', false],
    ['https://localhost:3000', false],
    ['http://localhost.evil.example', false],
    ['http://127.0.0.1:3000', false],
    ['', false],
    [null, false],
  ])('%s → %s', (origin, allowed) => {
    expect(isAllowedOrigin(origin)).toBe(allowed);
  });

  it('treats Origin: null (file://) per the ALLOW_NULL_ORIGIN setting', () => {
    expect(isAllowedOrigin('null', { allowNullOrigin: true })).toBe(true);
    expect(isAllowedOrigin('null', { allowNullOrigin: false })).toBe(false);
  });

  it('echoes the origin (never *) with Vary: Origin, and sends nothing for others', () => {
    expect(corsHeaders(GH)).toMatchObject({ 'Access-Control-Allow-Origin': GH, Vary: 'Origin' });
    expect(corsHeaders('https://evil.example')).toEqual({});
  });
});

// ─── The handler, with upstream and the edge cache mocked ───

function makeDeps(upstreamImpl) {
  const store = new Map();
  const waits = [];
  const deps = {
    fetch: vi.fn(upstreamImpl || (async () => new Response('[{"a":1}]', {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'x=1', Vary: 'Cookie' },
    }))),
    cache: {
      match: vi.fn(async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }),
      put: vi.fn(async (req, res) => { store.set(req.url, new Response(await res.text(), res)); }),
    },
    waitUntil: (p) => waits.push(p),
    settle: () => Promise.all(waits),
    store,
  };
  return deps;
}
const req = (path, { method = 'GET', origin = GH } = {}) =>
  new Request(W + path, { method, headers: origin === undefined ? {} : (origin === null ? {} : { Origin: origin }) });
const env = { ALLOW_NULL_ORIGIN: 'true' };

describe('handleRequest()', () => {
  it('rejects a non-allowlisted path with 403 JSON and never contacts upstream', async () => {
    const deps = makeDeps();
    const res = await handleRequest(req('/https://evil.example/'), env, deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'not_allowlisted' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('rejects other methods with 403 without contacting upstream', async () => {
    const deps = makeDeps();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await handleRequest(req('/data.json', { method }), env, deps);
      expect(res.status).toBe(403);
    }
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('rejects a browser on another site with 403 before any upstream work', async () => {
    const deps = makeDeps();
    const res = await handleRequest(req('/data.json', { origin: 'https://evil.example' }), env, deps);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('refuses Origin: null when ALLOW_NULL_ORIGIN is "false"', async () => {
    const deps = makeDeps();
    expect((await handleRequest(req('/data.json', { origin: 'null' }), { ALLOW_NULL_ORIGIN: 'false' }, deps)).status).toBe(403);
    expect((await handleRequest(req('/data.json', { origin: 'null' }), env, deps)).status).toBe(200);
  });

  it('answers a preflight for an allowed origin', async () => {
    const res = await handleRequest(req('/data.json', { method: 'OPTIONS' }), env, makeDeps());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GH);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('proxies a GET, adds CORS, strips cookies, and makes the 200 cacheable', async () => {
    const deps = makeDeps();
    const res = await handleRequest(req('/data-api/v1/dataset/abc/data?size=1'), env, deps);
    expect(res.status).toBe(200);
    expect(deps.fetch).toHaveBeenCalledWith('https://data.cms.gov/data-api/v1/dataset/abc/data?size=1', expect.anything());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GH);
    expect(res.headers.get('X-Proxy-Cache')).toBe('MISS');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await res.text()).toBe('[{"a":1}]');
  });

  it('serves a repeat request from the cache without a second upstream fetch', async () => {
    const deps = makeDeps();
    await (await handleRequest(req('/data.json'), env, deps)).text();
    await deps.settle();
    const second = await handleRequest(req('/data.json', { origin: 'http://localhost:3000' }), env, deps);
    expect(second.headers.get('X-Proxy-Cache')).toBe('HIT');
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000'); // CORS is per request, not cached
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('passes upstream error statuses through unchanged and never caches them', async () => {
    const deps = makeDeps(async () => new Response('{"message":"bad filter"}', { status: 400, headers: { 'Content-Type': 'application/json' } }));
    const res = await handleRequest(req('/data-api/v1/dataset/abc/data?filter=x'), env, deps);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"message":"bad filter"}');
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it('answers 504 JSON when upstream times out', async () => {
    const deps = makeDeps(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
    const res = await handleRequest(req('/provider-data/api/1/datastore/query/mj5m-pzi6/0'), env, deps);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'upstream_timeout', upstream: 'provider-data', timeoutMs: 45000 });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(GH); // the app can read the error
  });

  it('answers 502 JSON when upstream is unreachable', async () => {
    const deps = makeDeps(async () => { throw new TypeError('network down'); });
    const res = await handleRequest(req('/nppes/api/?version=2.1'), env, deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_unreachable', upstream: 'nppes' });
  });

  it('serves a request with no Origin header (non-browser client) but without CORS headers', async () => {
    const res = await handleRequest(req('/data.json', { origin: null }), env, makeDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
