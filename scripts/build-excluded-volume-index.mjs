#!/usr/bin/env node
// Builds data/excluded-volume/: per HCPCS code, data year and state, the
// patient-days and Medicare payment billed by the provider types MedIntel
// excludes from procedure volume (VOLUME_EXCLUDED_PROVIDER_TYPES in
// medintel-core.js: physician assistants, nurse practitioners, ASCs).
//
//   node scripts/build-excluded-volume-index.mjs               # years missing or re-released
//   node scripts/build-excluded-volume-index.mjs --years 2024  # specific year(s)
//   node scripts/build-excluded-volume-index.mjs --force       # every year
//
// Why precompute: the app's surgeon-only totals subtract these lines from the
// Geography & Service totals. Asking the data-api for them per code and year
// takes 8-55 s per uncached query, and a 2-code Size a Market search took
// 5½ minutes. The yearly "by Provider and Service" CSV (~3.3 GB) streams
// in about a minute, and the claims years never change once published.
//
// Output, sharded so the browser fetches only what a search needs:
//   data/excluded-volume/manifest.json  { types, years: { "2024": { source, ... } } }
//   data/excluded-volume/<PFX>.json     { "<code>": { "<year>": { "US": [days, pay], "TX": [...] } } }
// where <PFX> is shardKey(code) — the code's first 3 characters. "US" is the
// national sum over every row (including territories), matching the
// Geography & Service "National" row.
//
// Rows below CMS's ≤10-beneficiary floor are absent from the source file, so
// the same small overstatement as the live query applies.
//
// Exit codes: 0 built (or nothing to do), 1 unexpected error, 4 validation failed.

if (typeof fetch !== 'function') {
  console.error('This script needs Node 18 or newer (global fetch). Your version: ' + process.version);
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { getProcedureCount, getPayment, VOLUME_EXCLUDED_PROVIDER_TYPES, excludedShardKey } = require('../medintel-core.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.EXCLUDED_VOLUME_DIR || path.join(here, '..', 'data', 'excluded-volume');
const CATALOG_URL = process.env.CMS_CATALOG_URL || 'https://data.cms.gov/data.json';
const DATASET_TITLE = 'Medicare Physician & Other Practitioners - by Provider and Service';
const REQUIRED_COLUMNS = ['Rndrng_Prvdr_Type', 'HCPCS_Cd', 'Rndrng_Prvdr_State_Abrvtn', 'Tot_Bene_Day_Srvcs', 'Tot_Srvcs', 'Avg_Mdcr_Pymt_Amt'];
// Billed by PAs every year since CMS began publishing (2013) — a year without
// it means the parse or the type spellings broke.
const SENTINEL_CODE = '27447';
const MIN_MATCHED_ROWS = 10000;

class ValidationError extends Error {}

// The yearly CSV download for each data year of the dataset, newest first.
// data.json (DCAT-US 3.0) has one entry per year titled "<title> : <date>";
// the year comes from temporal[0].startDate, not the date in the title.
function csvSourcesFromCatalog(catalog, title) {
  const out = new Map();
  for (const d of (catalog && catalog.dataset) || []) {
    const t = String(d.title || '');
    const matches = t === title || t.replace(/ : \d{4}-\d{2}-\d{2}$/, '') === title ||
      (d.inSeries || []).some((s) => s && s.title === title);
    if (!matches) continue;
    const temporal = Array.isArray(d.temporal) ? d.temporal[0] : null;
    const year = parseInt(String((temporal && temporal.startDate) || '').slice(0, 4), 10);
    if (!year) continue;
    const csv = (d.distribution || []).find((x) => /\.csv(\?|$)/i.test(String(x.downloadURL || '')));
    if (csv && !out.has(year)) out.set(year, csv.downloadURL);
  }
  return [...out.entries()].sort((a, b) => b[0] - a[0]).map(([year, url]) => ({ year, url }));
}

// One CSV record → fields. Handles quoted fields with commas and "" escapes.
function parseCsvLine(line) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out.map((v) => (v.endsWith('\r') ? v.slice(0, -1) : v));
}

// Splits streamed text into CSV records, keeping a newline inside quotes
// within its record. Feed chunks, then call end().
function createRecordSplitter(onRecord) {
  let buf = '';
  let pending = '';
  const quotes = (s) => { let n = 0; for (let i = s.indexOf('"'); i !== -1; i = s.indexOf('"', i + 1)) n++; return n; };
  const emit = (line) => {
    const rec = pending ? pending + '\n' + line : line;
    if (quotes(rec) % 2) { pending = rec; return; } // a quoted field continues on the next line
    pending = '';
    if (rec) onRecord(rec);
  };
  return {
    push(text) {
      buf += text;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { emit(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    },
    end() { if (buf) emit(buf); buf = ''; if (pending) { onRecord(pending); pending = ''; } },
  };
}

// Shared with the app so a code's shard file name can't drift.
const shardKey = excludedShardKey;

// Accumulates excluded-type rows for one data year:
//   code → state → [patientDays, payment]  (plus a "US" national sum)
function createYearAggregator(types = VOLUME_EXCLUDED_PROVIDER_TYPES) {
  const wanted = new Set(types.map((t) => t.toUpperCase()));
  const prefilter = new RegExp(types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const byCode = new Map();
  let header = null;
  let idx = null;
  let rows = 0;
  let matched = 0;
  const add = (code, st, days, pay) => {
    let states = byCode.get(code);
    if (!states) byCode.set(code, (states = new Map()));
    const cur = states.get(st) || [0, 0];
    cur[0] += days; cur[1] += pay;
    states.set(st, cur);
  };
  return {
    record(line) {
      if (!header) {
        header = parseCsvLine(line.replace(/^﻿/, ''));
        const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
        if (missing.length) throw new ValidationError(`CSV is missing column(s): ${missing.join(', ')}`);
        idx = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, header.indexOf(c)]));
        return;
      }
      rows++;
      // Cheap pre-filter: skip the ~90% of rows that can't be an excluded type.
      if (!prefilter.test(line)) return;
      const v = parseCsvLine(line);
      if (!wanted.has(String(v[idx.Rndrng_Prvdr_Type] || '').toUpperCase())) return;
      const code = String(v[idx.HCPCS_Cd] || '').trim().toUpperCase();
      if (!code) return;
      matched++;
      const row = {
        Tot_Bene_Day_Srvcs: v[idx.Tot_Bene_Day_Srvcs],
        Tot_Srvcs: v[idx.Tot_Srvcs],
        Avg_Mdcr_Pymt_Amt: v[idx.Avg_Mdcr_Pymt_Amt],
      };
      const days = getProcedureCount(row);
      const pay = getPayment(row);
      const st = String(v[idx.Rndrng_Prvdr_State_Abrvtn] || '').trim().toUpperCase() || 'XX';
      add(code, 'US', days, pay);
      if (st !== 'US') add(code, st, days, pay);
    },
    result() {
      const codes = {};
      for (const [code, states] of byCode) {
        codes[code] = {};
        for (const [st, [d, p]] of states) codes[code][st] = [Math.round(d), Math.round(p)];
      }
      return { codes, rows, matched };
    },
  };
}

// Sanity checks before a year is written. `neighbor` is an adjacent year's
// manifest summary (or null for the first year built).
function validateYear(year, agg, neighbor) {
  const problems = [];
  if (agg.matched < MIN_MATCHED_ROWS) problems.push(`only ${agg.matched} PA/NP/ASC rows matched (expected ≥ ${MIN_MATCHED_ROWS}) — check the provider type spellings`);
  const s = agg.codes[SENTINEL_CODE];
  if (!s || !s.US || !(s.US[0] > 0)) problems.push(`sentinel code ${SENTINEL_CODE} has no PA/NP/ASC volume in CY${year}`);
  const total = nationalPatientDays(agg.codes);
  if (neighbor && neighbor.nationalPatientDays > 0) {
    const ratio = total / neighbor.nationalPatientDays;
    if (ratio < 0.5 || ratio > 2) problems.push(`national PA/NP/ASC patient-days ${total} is ${ratio.toFixed(2)}× CY${neighbor.year}'s ${neighbor.nationalPatientDays} (allowed 0.5–2×)`);
  }
  return problems;
}

function nationalPatientDays(codes) {
  let t = 0;
  for (const c of Object.values(codes)) if (c.US) t += c.US[0];
  return t;
}

// Merges one year's codes into the shard map (shardKey → { code → { year → states } }).
function mergeYearIntoShards(shards, year, codes) {
  for (const [code, states] of Object.entries(codes)) {
    const key = shardKey(code);
    const shard = shards[key] || (shards[key] = {});
    (shard[code] || (shard[code] = {}))[year] = states;
  }
  return shards;
}

// Drops one year from every shard (before rebuilding it).
function removeYearFromShards(shards, year) {
  for (const shard of Object.values(shards)) {
    for (const [code, years] of Object.entries(shard)) {
      delete years[year];
      if (!Object.keys(years).length) delete shard[code];
    }
  }
  return shards;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function readShards(dir) {
  const shards = {};
  if (!fs.existsSync(dir)) return shards;
  for (const f of fs.readdirSync(dir)) {
    if (f === 'manifest.json' || !f.endsWith('.json')) continue;
    shards[f.slice(0, -5)] = readJson(path.join(dir, f), {});
  }
  return shards;
}

function writeShards(dir, shards) {
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set();
  for (const [key, shard] of Object.entries(shards)) {
    if (!Object.keys(shard).length) continue;
    const file = `${key}.json`;
    keep.add(file);
    // Sorted keys so a rebuild with unchanged data produces no diff.
    const sorted = {};
    for (const code of Object.keys(shard).sort()) {
      sorted[code] = {};
      for (const y of Object.keys(shard[code]).sort()) {
        sorted[code][y] = {};
        for (const st of Object.keys(shard[code][y]).sort()) sorted[code][y][st] = shard[code][y][st];
      }
    }
    fs.writeFileSync(path.join(dir, file), JSON.stringify(sorted));
  }
  for (const f of fs.readdirSync(dir)) {
    if (f !== 'manifest.json' && f.endsWith('.json') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
  }
}

async function streamYear(url, aggregator, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'medintel-build (+https://github.com/jdef11/medintel)' } });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const splitter = createRecordSplitter((rec) => aggregator.record(rec));
  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let lastLog = Date.now();
  for await (const chunk of res.body) {
    bytes += chunk.length;
    splitter.push(decoder.decode(chunk, { stream: true }));
    if (Date.now() - lastLog > 15000) { console.log(`  ${label}: ${(bytes / 1e9).toFixed(2)} GB read`); lastLog = Date.now(); }
  }
  splitter.push(decoder.decode());
  splitter.end();
  return bytes;
}

function parseArgs(argv) {
  const args = { years: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--years') args.years = String(argv[++i] || '').split(',').map((y) => parseInt(y, 10)).filter(Boolean);
  }
  return args;
}

// Years to (re)build: requested ones, or every catalog year that is missing,
// was built from a different file (CMS re-released it), or was built for a
// different set of excluded provider types.
function planYears(sources, manifest, args) {
  const typesChanged = JSON.stringify((manifest && manifest.types) || []) !== JSON.stringify(VOLUME_EXCLUDED_PROVIDER_TYPES);
  return sources.filter(({ year, url }) => {
    if (args.years) return args.years.includes(year);
    if (args.force || typesChanged) return true;
    const have = manifest && manifest.years && manifest.years[year];
    return !have || have.source !== url;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = await (await fetch(CATALOG_URL)).json();
  const sources = csvSourcesFromCatalog(catalog, DATASET_TITLE);
  if (!sources.length) throw new Error(`No CSV downloads found in ${CATALOG_URL} for "${DATASET_TITLE}"`);

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  const todo = planYears(sources, manifest, args);
  if (!todo.length) { console.log('Excluded-volume index is current — nothing to build.'); return; }

  const typesChanged = !manifest || JSON.stringify(manifest.types) !== JSON.stringify(VOLUME_EXCLUDED_PROVIDER_TYPES);
  const shards = typesChanged ? {} : readShards(OUTPUT_DIR);
  const years = typesChanged ? {} : { ...((manifest && manifest.years) || {}) };

  for (const { year, url } of todo) {
    console.log(`CY${year}: ${url}`);
    const agg = createYearAggregator();
    const t0 = Date.now();
    const bytes = await streamYear(url, agg, `CY${year}`);
    const result = agg.result();
    const neighborYear = [year - 1, year + 1].find((y) => years[y]);
    const neighbor = neighborYear ? { year: neighborYear, ...years[neighborYear] } : null;
    const problems = validateYear(year, result, neighbor);
    if (problems.length) throw new ValidationError(`CY${year} failed validation:\n  - ${problems.join('\n  - ')}`);
    removeYearFromShards(shards, year);
    mergeYearIntoShards(shards, year, result.codes);
    years[year] = {
      source: url,
      rows: result.rows,
      matchedRows: result.matched,
      codes: Object.keys(result.codes).length,
      nationalPatientDays: nationalPatientDays(result.codes),
      builtAt: new Date().toISOString().slice(0, 10),
    };
    console.log(`  CY${year}: ${result.rows.toLocaleString()} rows (${(bytes / 1e9).toFixed(2)} GB) in ${Math.round((Date.now() - t0) / 1000)} s; ` +
      `${result.matched.toLocaleString()} PA/NP/ASC rows across ${years[year].codes.toLocaleString()} codes`);
  }

  writeShards(OUTPUT_DIR, shards);
  fs.writeFileSync(manifestPath, JSON.stringify({
    description: 'Patient-days (Tot_Bene_Day_Srvcs) and Medicare payment billed by these provider types, per HCPCS code, data year and state ("US" = national). Built by scripts/build-excluded-volume-index.mjs from CMS\'s "' + DATASET_TITLE + '" CSV files.',
    types: VOLUME_EXCLUDED_PROVIDER_TYPES,
    shardKeyLength: 3,
    years,
  }, null, 2) + '\n');
  const size = fs.readdirSync(OUTPUT_DIR).reduce((s, f) => s + fs.statSync(path.join(OUTPUT_DIR, f)).size, 0);
  console.log(`\nWrote ${Object.keys(shards).length} shards + manifest to ${OUTPUT_DIR} (${(size / 1e6).toFixed(1)} MB); years: ${Object.keys(years).sort().join(', ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Build failed:', e.message || e);
    process.exit(e instanceof ValidationError ? 4 : 1);
  });
}

export {
  csvSourcesFromCatalog, parseCsvLine, createRecordSplitter, shardKey, createYearAggregator,
  validateYear, nationalPatientDays, mergeYearIntoShards, removeYearFromShards, planYears,
  REQUIRED_COLUMNS, SENTINEL_CODE,
};
