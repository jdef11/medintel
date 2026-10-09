# MedIntel CMS proxy (Cloudflare Worker)

A small Worker that relays the handful of CMS endpoints MedIntel reads from the
browser. It replaces the free public CORS relays the app used before
(allorigins.win, corsproxy.io, codetabs.com).

## Why the app needs it

Checked from a real browser on `https://jdef11.github.io` (Oct 2026):

| CMS endpoint | Direct from the browser? | Used by |
|---|---|---|
| `data.cms.gov/data-api/v1/dataset/…` | Yes (sends CORS headers) | most searches; the proxy is only a fallback |
| `data.cms.gov/data.json` | Yes | Data Year discovery; the proxy is only a fallback |
| `data.cms.gov/provider-data/api/1/datastore/query/…` | **No** (CMS allows `localhost` but not github.io) | Group by practice / Group by hospital |
| `npiregistry.cms.hhs.gov/api/` | **No** (no CORS headers at all) | NPI Look Up |

So Group by practice, Group by hospital and NPI Look Up only work with the
proxy deployed. Everything else works without it.

## What it will and won't do

- **GET only** (plus `OPTIONS` preflight). Every other method gets a 403.
- **Fixed upstreams, not a `?url=` relay.** The path picks the route and the
  route fixes the upstream host:

  | Worker path | Upstream |
  |---|---|
  | `/data-api/v1/dataset/…` | `https://data.cms.gov/data-api/v1/dataset/…` |
  | `/provider-data/api/1/datastore/query/…` | `https://data.cms.gov/provider-data/api/1/datastore/query/…` |
  | `/data.json` | `https://data.cms.gov/data.json` |
  | `/nppes/api/` | `https://npiregistry.cms.hhs.gov/api/` |

  Anything else gets a 403 without contacting upstream. That includes other
  paths, `..`, encoded characters in the path, and full URLs in the path or
  query. `policy.js` holds the rules; `worker.test.mjs` tests them (`npm test`
  from the repo root).
- **The query string passes through byte-for-byte.** The provider-data `in`
  filter's repeated `conditions[0][value][]=` params reach CMS unchanged.
- **CORS:** `Access-Control-Allow-Origin` (the origin echoed back, never `*`)
  only for `https://jdef11.github.io`, `http://localhost:<any port>`, and
  `null` (see below). A browser request from any other site gets a 403 before
  the Worker fetches anything, so other sites can't spend your daily quota
  through their visitors' browsers.
- **Status codes pass through unchanged.** If CMS doesn't answer, the Worker
  sends its own JSON error: `504 {"error":"upstream_timeout",…}` or
  `502 {"error":"upstream_unreachable",…}`. Timeouts: data-api 25 s,
  provider-data 45 s, data.json 20 s, NPPES 15 s. Each is below the app's own
  client-side timeout, so the app shows the Worker's message instead of a bare
  abort.
- **Caching:** successful (200) responses are cached at the edge for 24 h
  (NPPES: 1 h, since it's a live registry). Errors are never cached. CMS sends
  `Cache-Control: no-store`, so the Worker substitutes its own max-age.
  Responses carry `X-Proxy-Cache: HIT|MISS`.

### Opening the app from `file://` (`Origin: null`)

`ALLOW_NULL_ORIGIN = "true"` in `wrangler.toml` (the default) lets a copy of
the app opened by double-clicking the HTML file use the proxy.

- **Cost:** `null` isn't unique to file://. Sandboxed iframes and `data:` URLs
  on any website also send it. A third-party page could therefore use your
  Worker from its visitors' browsers, and that counts against your 100k/day
  free requests.
- **Why the cost is small:** anyone can already call the Worker from a server
  or with curl (no Origin header at all), and CORS can't stop that. What
  actually limits misuse is that the Worker only serves these public CMS
  endpoints.

Set it to `"false"` if you only ever use the hosted app or `npx serve`.
data-api and data.json keep working from file:// either way (CMS sends
`Access-Control-Allow-Origin: null` itself); only Group by and NPI Look Up
would stop.

## Deploy (about 10 minutes, free)

1. **Create a Cloudflare account** at https://dash.cloudflare.com/sign-up. The
   free plan is enough; no card needed. The first time you open
   **Workers & Pages** it asks you to pick a `*.workers.dev` subdomain (e.g.
   `jdef11`); that becomes part of the URL.
2. **Install and log in** (Node 18+):
   ```bash
   cd proxy
   npm install            # installs the pinned wrangler CLI locally
   npx wrangler login     # opens a browser to authorize wrangler for your account
   ```
3. **Optional: try it locally first.**
   ```bash
   npx wrangler dev       # serves the Worker on http://localhost:8787
   curl -i 'http://localhost:8787/data.json' -o /dev/null           # expect 200
   curl -i 'http://localhost:8787/https://example.com/'             # expect 403
   ```
4. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   It prints the URL, in the form
   `https://medintel-cms-proxy.<your-subdomain>.workers.dev`.
5. **Check the deployed Worker:**
   ```bash
   W=https://medintel-cms-proxy.<your-subdomain>.workers.dev
   curl -sI -H 'Origin: https://jdef11.github.io' "$W/data-api/v1/dataset/92396110-2aed-4d63-a6a2-5d6207d46a29/data?size=1" | grep -iE '^HTTP|access-control-allow-origin|x-proxy-cache'
   curl -s "$W/https://example.com/"     # {"error":"not_allowlisted",...} with HTTP 403
   ```
6. **Point the app at it:** in `cms-sales-intel (4).html`, set
   ```js
   const CMS_PROXY_BASE = 'https://medintel-cms-proxy.<your-subdomain>.workers.dev';
   ```
   (search for `CMS_PROXY_BASE`; no trailing slash needed). Commit that on the
   proxy branch, then merge. **Don't merge the app change with
   `CMS_PROXY_BASE` empty**: today's live site gets Group by and NPI Look Up
   through the free relays, and with the relays removed and no Worker URL,
   those features show a "proxy not configured" error until it's set.

To update the Worker later: edit, then `npx wrangler deploy` again (the URL
doesn't change). To see live requests: `npx wrangler tail`.

## Cloudflare free-tier limits that matter here

Read from Cloudflare's Workers limits documentation (source, Oct 2026):

| Limit (Workers Free) | Value | What it means for MedIntel |
|---|---|---|
| Requests | **100,000 / day**, resets 00:00 UTC | Every proxied call counts, cache hits included. A Group by search costs about one request per 50 providers; a large Size a Market search only uses the proxy if a direct call fails. Over the limit, Cloudflare answers **Error 1027** for the rest of the UTC day, and Group by / NPI Look Up fail until the reset. |
| CPU time | **10 ms / request** | Waiting on CMS doesn't count; only the Worker's own code does, which is tiny because it streams bodies rather than parsing them. |
| Memory | 128 MB / isolate | Bodies are streamed, never buffered, including the ~18 MB data.json. |
| Subrequests | 50 / request | The Worker makes one. |
| Response body size | no enforced limit; 512 MB cache-object limit | data.json (~18 MB) fits. |
| Duration | none for HTTP requests | The 15 s provider-data queries are fine. |

**Caching on `*.workers.dev`: not verified.** Cloudflare's Cache API docs only
promise working cache operations for Workers on a *custom domain*. Community
reports say `cache.put` doesn't produce hits on `*.workers.dev`. The Worker
therefore also asks for fetch-level edge caching (`cf.cacheTtlByStatus`),
which is Cloudflare's recommended way for a Worker proxying another site.
Locally (`wrangler dev`), a repeat provider-data batch dropped from ~14 s to
~6 ms.

After deploying, run the same Group by search twice and check `X-Proxy-Cache`
in the browser's network panel. If the second run still shows `MISS` and takes
~15 s, adding a custom domain fixes it (Workers & Pages → your Worker →
Settings → Domains & Routes). That needs a domain on your Cloudflare account,
and the domain itself isn't free.
