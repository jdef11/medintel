#!/usr/bin/env node
// cms.mjs — zero-dependency CLI for querying CMS public data APIs directly.
// Node 18+ (global fetch). Data goes to stdout; diagnostics go to stderr.
// Run `node cms.mjs help` for usage. See ../SKILL.md for the API rules this
// script enforces and why.

import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (typeof fetch !== 'function') {
  console.error(`cms.mjs needs Node 18+ (global fetch); this is ${process.version}`);
  process.exit(1);
}

const CATALOG_URL = 'https://data.cms.gov/data.json';
const DATA_API = 'https://data.cms.gov/data-api/v1/dataset';
const PD_API = 'https://data.cms.gov/provider-data/api/1';
const NPPES_API = 'https://npiregistry.cms.hhs.gov/api/';
const CACHE_DIR = join(tmpdir(), 'cms-api-skill');
const CATALOG_INDEX = join(CACHE_DIR, 'catalog-index.json');
const CATALOG_TTL_MS = 24 * 3600 * 1000;
const PAGE_SIZE = 1000;      // data-api page size; 5000 also works, but 1000 is reliable
const PD_PAGE_SIZE = 1500;   // provider-data hard max (400 above this)
const TIMEOUT_MS = 90000;    // provider-data queries take ~15s each, flat
// The CMS edge 403s Node's default User-Agent ("node") on provider-data
// (verified 2026-10-26; curl's default passes). Identify the tool honestly.
const USER_AGENT = 'cms-api-skill/1.0 (+https://github.com/jdef11/medintel)';

// Short names for the families most sales/market questions need. Any other
// catalog title (or a dataset UUID) works too.
const FAMILIES = {
  provider:     'Medicare Physician & Other Practitioners - by Provider and Service',
  provSummary:  'Medicare Physician & Other Practitioners - by Provider',
  geography:    'Medicare Physician & Other Practitioners - by Geography and Service',
  inpProvider:  'Medicare Inpatient Hospitals - by Provider and Service',
  inpGeo:       'Medicare Inpatient Hospitals - by Geography and Service',
  dmeGeo:       'Medicare Durable Medical Equipment, Devices & Supplies - by Geography and Service',
  dmeReferring: 'Medicare Durable Medical Equipment, Devices & Supplies - by Referring Provider and Service',
};

// "latest" alias UUIDs (taken from data.json 2026-10-09). Used only when the
// catalog can't be loaded; CMS moves each alias to the newest year.
const LATEST_IDS = {
  provider:     '92396110-2aed-4d63-a6a2-5d6207d46a29',
  provSummary:  '8889d81e-2ee7-448f-8713-f071038289b5',
  geography:    '6fea9d79-0129-4e4c-b1b8-23cd86a4f435',
  inpProvider:  '690ddc6c-2767-4618-b277-420ffb2bf27c',
  inpGeo:       '2941ab09-8cee-49d8-9703-f3c5b854e388',
  dmeGeo:       '27c150fd-8578-43b1-bba5-6388987e32af',
  dmeReferring: '86b4807a-d63a-44be-bfdf-ffd398d5e623',
};

const PD_ALIASES = {
  clinicians: 'mj5m-pzi6',    // Doctors and Clinicians National Downloadable File (org_pac_id)
  facilityAff: '27ea-46a8',   // Facility Affiliation Data (NPI -> facility CCN)
  hospitals: 'xubh-q36u',     // Hospital General Information (CCN -> name, rating)
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const log = (...a) => console.error(...a);
const die = (msg, code = 1) => { log(`error: ${msg}`); process.exit(code); };

// ─── HTTP ───

async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res, text;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
      text = await res.text();
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries) { await sleep(2000 * 2 ** attempt); continue; }
      throw new Error(`${e.name === 'AbortError' ? 'timed out' : e.message} — ${url}`);
    }
    clearTimeout(t);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (/^\s*<html/i.test(text) && /Access Denied/i.test(text)) {
      throw new Error(`HTTP ${res.status} "Access Denied" from the CMS edge (Akamai) — this host is refusing ` +
        `this client/network. Not a data answer and not a bad query. Do not retry in a loop or spoof headers; ` +
        `report it and try another network. URL: ${url}`);
    }
    let body;
    try { body = JSON.parse(text); } catch {
      throw new Error(`HTTP ${res.status}, non-JSON response (${text.slice(0, 160).replace(/\s+/g, ' ')}) — ${url}`);
    }
    if (!res.ok) {
      const m = body && (body.message || body.error || JSON.stringify(body).slice(0, 200));
      throw new Error(`HTTP ${res.status}: ${m} — ${url}`);
    }
    return body;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── CATALOG (data.json → family title → [{year, id}]) ───

// Same rules as MedIntel's extractDatasetVersions(): handles the legacy shape
// and DCAT-US 3.0 (one entry per year titled "<family> : <release date>",
// linked by inSeries, year from temporal.startDate — NOT the title's date),
// and prefers the version-pinned UUID over the moving "latest" alias.
export function buildCatalogIndex(catalog) {
  const datasets = Array.isArray(catalog && catalog.dataset) ? catalog.dataset : [];
  const uuidFromUrl = url => {
    const m = String(url || '').match(/data-api\/v1\/dataset\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  };
  const yearFrom = (...c) => {
    for (const v of c) { const m = String(v || '').match(/(20\d{2})/); if (m) return +m[1]; }
    return null;
  };
  const temporalYear = t => {
    for (const p of (Array.isArray(t) ? t : [t])) {
      const y = (p && typeof p === 'object') ? yearFrom(p.startDate, p.endDate) : yearFrom(p);
      if (y) return y;
    }
    return null;
  };
  const familyOf = ds => {
    const series = Array.isArray(ds.inSeries) ? ds.inSeries : (ds.inSeries ? [ds.inSeries] : []);
    const s = series.find(x => x && x.title);
    if (s) return s.title.trim();
    return String(ds.title || '').replace(/\s*:\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim();
  };

  const families = {};
  for (const ds of datasets) {
    if (!ds || !ds.title) continue;
    const fam = familyOf(ds);
    const dists = Array.isArray(ds.distribution) ? ds.distribution : [];
    const byYear = families[fam] || (families[fam] = {});
    const dsYear = temporalYear(ds.temporal);
    if (dsYear) {
      const ids = dists
        .map(d => ({ id: uuidFromUrl(d.accessURL) || uuidFromUrl(d.downloadURL), latest: /latest/i.test(String(d.description || '')) }))
        .filter(d => d.id);
      const pick = ids.find(d => !d.latest) || ids[0];
      if (pick && !byYear[dsYear]) byYear[dsYear] = pick.id;
      continue;
    }
    for (const d of dists) {
      const id = uuidFromUrl(d.accessURL) || uuidFromUrl(d.downloadURL);
      const y = temporalYear(d.temporal) || yearFrom(d.title, d.description);
      if (id && y && !byYear[y]) byYear[y] = id;
    }
  }
  const out = {};
  for (const [fam, byYear] of Object.entries(families)) {
    const versions = Object.entries(byYear).map(([year, id]) => ({ year: +year, id })).sort((a, b) => b.year - a.year);
    if (versions.length) out[fam] = versions;
  }
  return out;
}

let catalogIndexMemo = null;
async function loadCatalogIndex({ refresh = false } = {}) {
  if (catalogIndexMemo) return catalogIndexMemo;
  if (!refresh) {
    try {
      if (Date.now() - statSync(CATALOG_INDEX).mtimeMs < CATALOG_TTL_MS) {
        return (catalogIndexMemo = JSON.parse(readFileSync(CATALOG_INDEX, 'utf8')));
      }
    } catch { /* no cache */ }
  }
  log('loading data.cms.gov/data.json (~18 MB, cached 24h)…');
  const index = buildCatalogIndex(await getJson(CATALOG_URL));
  if (!Object.keys(index).length) throw new Error('data.json loaded but no dataset families with data-api versions were found — catalog format may have changed');
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(CATALOG_INDEX, JSON.stringify(index)); } catch { /* cache is optional */ }
  return (catalogIndexMemo = index);
}

// ─── DATASET RESOLUTION ───

// Resolve a family alias / catalog title / title fragment / UUID (+ optional
// year) to { id, year, title, note }.
async function resolveDataset(spec, year) {
  if (!spec) die('dataset required (alias like "provider", a catalog title, or a dataset UUID)');
  if (UUID_RE.test(spec)) {
    if (year) log('note: --year is ignored when a UUID is given (a UUID already names one year)');
    return { id: spec, year: null, title: null };
  }
  const title = FAMILIES[spec] || FAMILIES[Object.keys(FAMILIES).find(k => k.toLowerCase() === spec.toLowerCase())] || spec;
  let index;
  try {
    index = await loadCatalogIndex();
  } catch (e) {
    const alias = Object.keys(FAMILIES).find(k => FAMILIES[k] === title);
    if (alias && !year) {
      log(`warning: catalog unavailable (${e.message}); using the "latest" alias for ${alias}. Year unknown until fetched; no history available.`);
      return { id: LATEST_IDS[alias], year: null, title, note: 'latest-alias fallback' };
    }
    throw e;
  }
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  let fam = Object.keys(index).find(t => norm(t) === norm(title));
  if (!fam) {
    const hits = Object.keys(index).filter(t => norm(t).includes(norm(spec)));
    if (hits.length === 1) fam = hits[0];
    else if (hits.length > 1) die(`"${spec}" matches ${hits.length} dataset families — be more specific:\n  ${hits.slice(0, 25).join('\n  ')}`);
    else die(`no dataset family matches "${spec}". Try: node cms.mjs datasets --search <words>`);
  }
  const versions = index[fam];
  const v = year ? versions.find(x => x.year === +year) : versions[0];
  if (!v) die(`"${fam}" has no ${year} version. Available: ${versions.map(x => x.year).join(', ')}`);
  return { id: v.id, year: v.year, title: fam };
}

// Column names + source file for a data-api dataset version (cheap: size=0).
const metaMemo = new Map();
async function datasetMeta(id) {
  if (metaMemo.has(id)) return metaMemo.get(id);
  const j = await getJson(`${DATA_API}/${id}/data-viewer?size=0`);
  const m = (j && j.meta) || {};
  const file = m.data_file_name || '';
  const fy = file.match(/(?:^|_)DY?(\d{2})(?=[_.])/i);
  const meta = { headers: m.headers || [], file, fileYear: fy ? 2000 + +fy[1] : null, totalRows: m.total_rows };
  metaMemo.set(id, meta);
  return meta;
}

// ─── DATA-API FILTERS ───

// --where expressions: Col=val, Col!=val, Col~val (CONTAINS), Col^val
// (STARTS_WITH), Col>n, Col>=n, Col<n, Col<=n. --in Col=a,b,c.
const WHERE_RE = /^([A-Za-z0-9_ ]+?)\s*(!=|>=|<=|=|~|\^|>|<)\s*(.*)$/;
const OP_MAP = { '=': '=', '!=': '<>', '~': 'CONTAINS', '^': 'STARTS_WITH', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

export function parseWhere(expr) {
  const m = String(expr).match(WHERE_RE);
  if (!m) throw new Error(`can't parse --where "${expr}" (use Col=val, Col!=val, Col~text, Col^prefix, Col>n …)`);
  return { path: m[1].trim(), op: OP_MAP[m[2]], value: m[3] };
}

export function parseIn(expr) {
  const i = String(expr).indexOf('=');
  if (i < 1) throw new Error(`can't parse --in "${expr}" (use Col=a,b,c)`);
  const values = expr.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean);
  if (!values.length) throw new Error(`--in "${expr}" has no values`);
  return { path: expr.slice(0, i).trim(), op: 'IN', value: values };
}

// Always an explicit AND group when there are 2+ conditions. CMS has combined a
// bare list of conditions as OR in the past; the explicit group is unambiguous.
export function buildDataApiFilter(conds) {
  const enc = encodeURIComponent;
  const one = (label, c, group) => {
    let p = `filter[${label}][condition][path]=${enc(c.path)}&filter[${label}][condition][operator]=${enc(c.op)}`;
    if (Array.isArray(c.value)) p += c.value.map(v => `&filter[${label}][condition][value][]=${enc(v)}`).join('');
    else p += `&filter[${label}][condition][value]=${enc(c.value)}`;
    if (group) p += `&filter[${label}][condition][memberOf]=${group}`;
    return p;
  };
  if (!conds.length) return '';
  if (conds.length === 1) return one('c0', conds[0]);
  return [`filter[g][group][conjunction]=AND`, ...conds.map((c, i) => one(`c${i}`, c, 'g'))].join('&');
}

// The data-api silently IGNORES a filter/sort on a column that doesn't exist
// and returns unfiltered rows. Check every referenced column against the real
// header list first.
function checkColumns(headers, names, ctx) {
  if (!headers.length) { log('warning: could not read column list; column names are unverified'); return; }
  for (const n of names) {
    if (headers.includes(n)) continue;
    const ci = headers.find(h => h.toLowerCase() === n.toLowerCase());
    const near = headers.filter(h => h.toLowerCase().includes(n.toLowerCase().replace(/^.*_/, ''))).slice(0, 6);
    die(`column "${n}" (${ctx}) does not exist in this dataset. ` +
      (ci ? `Did you mean "${ci}"? (names are case-sensitive in filters) ` : '') +
      (near.length && !ci ? `Similar: ${near.join(', ')}. ` : '') +
      `Run: node cms.mjs columns <dataset>`);
  }
}

// ─── OUTPUT ───

function emit(rows, format) {
  if (format === 'csv') {
    const cols = [...rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())];
    const esc = v => {
      const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    process.stdout.write([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n');
  } else if (format === 'ndjson') {
    process.stdout.write(rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  } else {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  }
}

// ─── ARG PARSING ───

function parseArgs(argv) {
  const out = { _: [], where: [], in: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const takesValue = !['all', 'count', 'refresh', 'url', 'help', 'raw'].includes(k);
    const v = takesValue ? (inline !== undefined ? inline : argv[++i]) : true;
    if (takesValue && v === undefined) die(`--${k} needs a value`);
    if (k === 'where' || k === 'in') out[k].push(v); else out[k] = v;
  }
  return out;
}

const intArg = (v, name, dflt) => {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) die(`--${name} must be a non-negative integer`);
  return n;
};

// ─── COMMANDS ───

async function cmdDatasets(a) {
  const index = await loadCatalogIndex({ refresh: !!a.refresh });
  const q = a.search ? String(a.search).toLowerCase().split(/\s+/) : [];
  const rows = Object.entries(index)
    .filter(([t]) => q.every(w => t.toLowerCase().includes(w)))
    .map(([title, v]) => ({
      alias: Object.keys(FAMILIES).find(k => FAMILIES[k] === title) || '',
      title, years: v.map(x => x.year).join(','), latestId: v[0].id,
    }))
    .sort((x, y) => (y.alias ? 1 : 0) - (x.alias ? 1 : 0) || x.title.localeCompare(y.title));
  emit(rows, a.format || 'json');
  log(`${rows.length} dataset famil${rows.length === 1 ? 'y' : 'ies'}`);
}

async function cmdVersions(a) {
  const spec = a._[0];
  if (UUID_RE.test(spec || '')) die('versions takes a family alias or title, not a UUID');
  const r = await resolveDataset(spec);
  const index = await loadCatalogIndex();
  emit(index[r.title].map(v => ({ year: v.year, id: v.id })), a.format || 'json');
  log(r.title);
}

async function cmdColumns(a) {
  const r = await resolveDataset(a._[0], a.year);
  const m = await datasetMeta(r.id);
  log(`${r.title || r.id} — CY${r.year || m.fileYear || '?'} — ${m.file} — ${m.totalRows} rows`);
  process.stdout.write(m.headers.join('\n') + '\n');
}

async function cmdQuery(a) {
  const r = await resolveDataset(a._[0], a.year);
  const meta = await datasetMeta(r.id);
  const year = r.year || meta.fileYear;
  if (r.year && meta.fileYear && r.year !== meta.fileYear) {
    log(`warning: catalog says CY${r.year} but the data file is ${meta.file} (CY${meta.fileYear})`);
  }
  let conds;
  try { conds = [...a.where.map(parseWhere), ...a.in.map(parseIn)]; } catch (e) { die(e.message); }
  const columns = a.columns ? String(a.columns).split(',').map(s => s.trim()).filter(Boolean) : [];
  const sortCol = a.sort ? String(a.sort).replace(/^-/, '') : null;
  checkColumns(meta.headers, [...conds.map(c => c.path), ...columns, ...(sortCol ? [sortCol] : [])], 'filter/column/sort');

  const filter = buildDataApiFilter(conds);
  const base = `${DATA_API}/${r.id}/data`;
  const statsUrl = `${base}/stats${filter ? '?' + filter : ''}`;
  const stats = await getJson(statsUrl);
  const found = stats.found_rows;
  log(`${r.title || r.id} | CY${year || '?'} | ${r.id}${r.note ? ' | ' + r.note : ''}`);
  log(`matching rows: ${found} of ${stats.total_rows}`);
  if (a.count) { process.stdout.write(JSON.stringify({ dataset: r.title, year, id: r.id, found_rows: found, total_rows: stats.total_rows }) + '\n'); return; }

  const want = a.all ? intArg(a.max, 'max', 50000) : intArg(a.limit, 'limit', 100);
  const start = intArg(a.offset, 'offset', 0);
  const extra = [
    columns.length ? `column=${columns.map(encodeURIComponent).join(',')}` : '',
    a.sort ? `sort=${encodeURIComponent(a.sort)}` : '',
  ].filter(Boolean).join('&');

  const rows = [];
  let offset = start;
  while (rows.length < want) {
    const size = Math.min(PAGE_SIZE, want - rows.length);
    const qs = [filter, extra, `size=${size}`, `offset=${offset}`].filter(Boolean).join('&');
    const url = `${base}?${qs}`;
    if (a.url) log(url);
    const page = await getJson(url);
    if (!Array.isArray(page)) die(`unexpected response shape (not an array) from ${url}`);
    rows.push(...page);
    offset += page.length;
    if (page.length < size) break;
    if (rows.length && rows.length % 5000 === 0) log(`  …${rows.length} rows`);
  }
  emit(rows, a.format || 'json');
  const remaining = found - start - rows.length;
  log(`returned ${rows.length} row(s)` + (remaining > 0 ? ` — ${remaining} more match (raise --limit, or --all [--max N])` : ''));
}

// Query by distribution UUID (/datastore/query/{distId}), resolved from the
// metastore, rather than /datastore/query/{datasetId}/0: the CMS edge 403s the
// latter for mj5m-pzi6 (verified 2026-10-26) while serving the same data via
// the distribution endpoint. The distribution id changes when CMS refreshes a
// dataset, so it's looked up each run.
async function pdQueryBase(id) {
  try {
    const j = await getJson(`${PD_API}/metastore/schemas/dataset/items/${id}?show-reference-ids`);
    const dist = Array.isArray(j.distribution) && j.distribution[0] && j.distribution[0].identifier;
    if (dist) return { base: `${PD_API}/datastore/query/${dist}`, title: j.title };
    log(`warning: no distribution listed for ${id}; using /datastore/query/${id}/0`);
  } catch (e) {
    log(`warning: metastore lookup for ${id} failed (${e.message}); using /datastore/query/${id}/0`);
  }
  return { base: `${PD_API}/datastore/query/${id}/0`, title: null };
}

// Provider Data Catalog: {results, count, schema}. Unknown columns → HTTP 400
// "Column not found" (unlike data-api). `in` values MUST be repeated value[]
// params — a comma-joined string silently returns zero rows.
async function cmdPd(a) {
  const id = PD_ALIASES[a._[0]] || a._[0];
  if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(id || '')) die(`pd needs a provider-data dataset id like xubh-q36u (or alias: ${Object.keys(PD_ALIASES).join(', ')})`);
  const enc = encodeURIComponent;
  const parts = [];
  let i = 0;
  for (const w of a.where) {
    const m = String(w).match(/^([A-Za-z0-9_]+)\s*(!=|>=|<=|=|~|>|<)\s*(.*)$/);
    if (!m) die(`can't parse --where "${w}"`);
    const op = { '=': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=', '~': 'LIKE' }[m[2]];
    const val = m[2] === '~' ? `%${m[3]}%` : m[3];
    parts.push(`conditions[${i}][property]=${enc(m[1])}&conditions[${i}][value]=${enc(val)}&conditions[${i}][operator]=${enc(op)}`);
    i++;
  }
  for (const expr of a.in) {
    let c; try { c = parseIn(expr); } catch (e) { die(e.message); }
    parts.push(`conditions[${i}][property]=${enc(c.path)}` + c.value.map(v => `&conditions[${i}][value][]=${enc(v)}`).join('') + `&conditions[${i}][operator]=in`);
    i++;
  }
  if (a.columns) String(a.columns).split(',').forEach(p => parts.push(`properties[]=${enc(p.trim())}`));
  if (a.sort) {
    const desc = String(a.sort).startsWith('-');
    parts.push(`sorts[0][property]=${enc(String(a.sort).replace(/^-/, ''))}&sorts[0][order]=${desc ? 'desc' : 'asc'}`);
  }
  const want = a.all ? intArg(a.max, 'max', 20000) : intArg(a.limit, 'limit', 100);
  let offset = intArg(a.offset, 'offset', 0);
  const rows = [];
  let count = null;
  const { base, title } = await pdQueryBase(id);
  log(`provider-data ${id}${title ? ` (${title})` : ''} — large datasets take ~15s per request regardless of size; batch NPIs with --in`);
  while (rows.length < want) {
    const limit = Math.min(PD_PAGE_SIZE, want - rows.length);
    const url = `${base}?${[...parts, `limit=${limit}`, `offset=${offset}`].join('&')}`;
    if (a.url) log(url);
    const j = await getJson(url);
    if (!j || !Array.isArray(j.results)) die(`unexpected response shape from ${url}`);
    count = j.count;
    rows.push(...j.results);
    offset += j.results.length;
    if (j.results.length < limit) break;
  }
  emit(rows, a.format || 'json');
  log(`returned ${rows.length} of ${count} matching row(s)`);
}

// NPPES returns HTTP 200 with {"Errors":[...]} for bad input — treat as error.
async function cmdNpi(a) {
  const allowed = ['number', 'enumeration_type', 'taxonomy_description', 'first_name', 'last_name',
    'organization_name', 'city', 'state', 'postal_code', 'country_code', 'address_purpose', 'use_first_name_alias', 'name_purpose'];
  const params = new URLSearchParams({ version: '2.1' });
  for (const k of allowed) if (a[k] !== undefined) params.set(k, a[k]);
  const want = intArg(a.limit, 'limit', 10);
  let skip = intArg(a.skip, 'skip', 0);
  const rows = [];
  while (rows.length < want) {
    const limit = Math.min(200, want - rows.length); // NPPES silently caps limit at 200
    params.set('limit', limit); params.set('skip', skip);
    const url = `${NPPES_API}?${params}`;
    if (a.url) log(url);
    const j = await getJson(url);
    if (j.Errors) die(`NPPES rejected the query: ${j.Errors.map(e => `${e.field}: ${e.description}`).join('; ')}`);
    const page = j.results || [];
    rows.push(...page);
    skip += page.length;
    if (page.length < limit) break;
  }
  const flat = a.raw ? rows : rows.map(r => {
    const b = r.basic || {};
    const loc = (r.addresses || []).find(x => x.address_purpose === 'LOCATION') || {};
    const tax = (r.taxonomies || []).find(t => t.primary) || (r.taxonomies || [])[0] || {};
    return {
      npi: r.number, type: r.enumeration_type,
      name: b.organization_name || [b.first_name, b.middle_name, b.last_name].filter(Boolean).join(' '),
      credential: b.credential || '', status: b.status || '',
      taxonomy: tax.desc || '', taxonomy_code: tax.code || '', license_state: tax.state || '',
      address: [loc.address_1, loc.address_2].filter(Boolean).join(' '), city: loc.city || '',
      state: loc.state || '', zip: (loc.postal_code || '').slice(0, 5), phone: loc.telephone_number || '',
      last_updated: b.last_updated || '',
    };
  });
  emit(flat, a.format || 'json');
  log(`returned ${rows.length} record(s)` + (rows.length === want ? ' (more may exist — NPPES gives no total)' : ''));
}

const HELP = `cms.mjs — query CMS public data APIs (Node 18+, no dependencies)

DATA-API (Medicare claims datasets on data.cms.gov/data-api)
  datasets [--search words] [--refresh]       list dataset families + years (from data.json)
  versions <dataset>                          year → UUID for one family
  columns  <dataset> [--year Y]               exact column names (filters are case-sensitive)
  query    <dataset> [options]                fetch rows
      --year Y            data year (default: newest)
      --where 'Col=val'   repeatable; ops: =  !=  ~ (contains)  ^ (starts with)  > >= < <=
      --in 'Col=a,b,c'    repeatable; IN list
      --columns a,b,c     return only these columns
      --sort [-]Col       sort (numeric columns sort numerically); '-' = descending
      --limit N           rows to return (default 100)   --offset N
      --all [--max N]     page through everything (default max 50000)
      --count             print matching row count only (no rows)
  <dataset> = alias (${Object.keys(FAMILIES).join(', ')}),
              a catalog title or unique fragment of one, or a dataset UUID

PROVIDER DATA CATALOG (data.cms.gov/provider-data)
  pd <id|alias> [--where 'prop=val'] [--in 'npi=1,2,3'] [--columns a,b] [--sort [-]prop] [--limit N] [--all]
      aliases: clinicians=mj5m-pzi6  facilityAff=27ea-46a8  hospitals=xubh-q36u
      ~ means case-insensitive LIKE %text%

NPPES NPI REGISTRY
  npi [--number N] [--first_name X] [--last_name X] [--organization_name X] [--state XX]
      [--city X] [--postal_code X] [--taxonomy_description X] [--enumeration_type NPI-1|NPI-2]
      [--limit N] [--skip N] [--raw]
      Trailing * wildcard allowed after 2+ chars (e.g. --last_name 'smi*').
      --state alone is rejected; pair it with another criterion.

COMMON
  --format json|csv|ndjson   (default json)     --url   print each request URL to stderr
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  if (!cmd || cmd === 'help' || a.help) { process.stdout.write(HELP); return; }
  const cmds = { datasets: cmdDatasets, versions: cmdVersions, columns: cmdColumns, query: cmdQuery, pd: cmdPd, npi: cmdNpi };
  if (!cmds[cmd]) die(`unknown command "${cmd}". Run: node cms.mjs help`);
  await cmds[cmd](a);
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cms.mjs');
if (isMain) main().catch(e => die(e.message));
