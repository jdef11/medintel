#!/usr/bin/env node
// Builds data/icd10pcs-drg-index.json — run MANUALLY, roughly annually, whenever
// CMS ships a new MS-DRG grouper version:
//   node scripts/build-icd10pcs-drg-index.mjs
//
// Combines two CMS reference sources that have NO live queryable API (unlike
// data.cms.gov's dataset-api family everything else in this app uses):
//
//  1. ICD-10-CM/PCS MS-DRG Definitions Manual, Appendix E ("Procedure Code/MS-DRG
//     Index") — a real, CMS-published crosswalk. For every ICD-10-PCS code that
//     affects MS-DRG assignment, it lists every {MDC, MS-DRG range, surgical
//     category} combination that code can group into (one-to-many: the same
//     code can land in different MS-DRGs depending on principal diagnosis/CC-MCC
//     severity). Only ~395 sequential HTML pages — walked via each page's
//     "next page" link rather than assuming a URL numbering scheme, since the
//     first page's numbering doesn't match the rest.
//
//  2. ICD-10-PCS Order File (Long and Abbreviated Titles) — a clean fixed-width
//     text file of every ICD-10-PCS code and its description. Appendix E only
//     describes DRG *categories*, not the procedure code itself, so this is a
//     separate, necessary source for the human-readable description.
//
// Output is intentionally scoped to the codes that appear in the crosswalk
// (~30k of the ~80k total ICD-10-PCS codes) rather than the full code set —
// this feature exists to tie a procedure code to a billing estimate, so a code
// with no DRG relevance isn't useful here, and shipping all ~80k descriptions
// would risk exceeding typical per-origin localStorage quotas (5-10MB) for no
// benefit to this feature.
//
// v1 scope: only the main Procedure Code/MS-DRG Index is modeled. Appendix E's
// other sections (Procedure Cluster/MS-DRG Index — multi-code combinations —
// Non-OR Procedure Clusters, and MDC 14-specific logic) are NOT modeled. A
// single code always resolves correctly on its own; codes that only affect
// DRG assignment *in combination with another procedure* resolve to their
// individual-code mapping only.
//
// Has NO effect on the build/deploy and is not run in CI (same reasoning as
// scripts/live-smoke.mjs — the sandbox/CI has no route to cms.gov, and this
// is a slow, ~5-10 minute scrape of a government site that should only run
// when someone is deliberately refreshing the data).

if (typeof fetch !== 'function') {
  console.error('This script needs Node 18 or newer (global fetch). Your version: ' + process.version);
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'icd10pcs-drg-index.json');

// These rotate per CMS release — re-resolve at build time from
// https://www.cms.gov/medicare/coding-billing/icd-10-codes (order file) and
// https://www.cms.gov/medicare-coding-billing/icd-10-codes (definitions manual
// index) if a rebuild reports a 404. Keep both from the SAME fiscal-year
// vintage so codes line up between the two sources.
const MS_DRG_VERSION_LABEL = 'MS-DRG v43.0 / FY2026';
const APPENDIX_E_BASE = 'https://www.cms.gov/icd10m/FY2026-fr-v43-fullcode-cms/fullcode_cms/';
const APPENDIX_E_START_PAGE = 'P0398.html';
const ORDER_FILE_ZIP_URL = 'https://www.cms.gov/files/zip/2026-icd-10-pcs-order-file-long-and-abbreviated-titles.zip';
const ORDER_FILE_ENTRY_NAME = 'icd10pcs_order_2026.txt';

const REQUEST_DELAY_MS = 250; // polite rate limit against a government site
const MAX_PAGES_SAFETY_CAP = 500; // real total is ~395; this is just a runaway guard
const USER_AGENT = 'Mozilla/5.0 (compatible; MedIntel-DataBuild/1.0; one-time reference-data refresh)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(500 * attempt);
    }
  }
}

async function fetchBuffer(url, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(500 * attempt);
    }
  }
}

// ─── MINIMAL ZIP READER ───
// The order file ships as a ZIP; Node has no built-in ZIP-container reader
// (only raw deflate/gzip streams via zlib), and adding a dependency just to
// unzip one build-time file would break this project's zero-dependency ethos.
// The format is simple and well-documented enough to read directly: walk the
// End of Central Directory record backward from EOF, then each central
// directory entry, then inflate the matching local file entry.
function readZipEntry(buf, entryName) {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP (no End of Central Directory record found)');

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  let offset = centralDirOffset;
  const CENTRAL_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('Malformed ZIP central directory entry');
    const compMethod = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (name === entryName) {
      const LOCAL_SIG = 0x04034b50;
      if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_SIG) throw new Error('Malformed ZIP local file header');
      const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressed = buf.subarray(dataStart, dataStart + compSize);
      if (compMethod === 0) return compressed; // stored, no compression
      if (compMethod === 8) return zlib.inflateRawSync(compressed); // deflate
      throw new Error(`Unsupported ZIP compression method ${compMethod} for ${entryName}`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry "${entryName}" not found in ZIP`);
}

// ─── SOURCE 1: ICD-10-PCS Order File → code → description ───
async function buildDescriptionMap() {
  console.log(`Downloading ICD-10-PCS Order File ZIP...\n  ${ORDER_FILE_ZIP_URL}`);
  const zipBuf = await fetchBuffer(ORDER_FILE_ZIP_URL);
  const txtBuf = readZipEntry(zipBuf, ORDER_FILE_ENTRY_NAME);
  const text = txtBuf.toString('utf8');

  // Fixed-width format (confirmed against the real FY2026 file):
  //   cols 0-5   sequence number
  //   cols 6-13  code (7 chars, space-padded on header/category rows)
  //   col  14    valid-code flag: '1' = real billable code, '0' = header row
  //   cols 16-76 abbreviated/short title (60 chars, space-padded)
  //   cols 76+   long title (to end of line)
  const descByCode = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length < 20) continue;
    const flag = line.slice(14, 15);
    if (flag !== '1') continue; // skip category/header rows — not real codes
    const code = line.slice(6, 13).trim();
    const longDesc = line.slice(76).trim();
    if (code && longDesc) descByCode.set(code, longDesc);
  }
  console.log(`  Parsed ${descByCode.size} code descriptions from the order file.\n`);
  return descByCode;
}

// ─── SOURCE 2: Appendix E → code → [{mdc, drgRange, category}] ───
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

// Parses one Appendix E index page's <table class="codelst"> into row tuples.
// A code only appears in the first row of its group; subsequent rows for the
// same code show `&nbsp;` in the code cell, so the parser carries the last
// seen code forward.
function parseIndexPage(html) {
  const tableMatch = html.match(/<table class="codelst"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];
  const rows = [];
  const rowRe = /<tr>\s*<td class="code">([^<]*)<\/td>\s*<td class="clcl">([^<]*)<\/td>\s*<td[^>]*class="clcl">([^<]*)<\/td>\s*<td class="clcl">([^<]*)<\/td>\s*<\/tr>/g;
  let m;
  let currentCode = null;
  while ((m = rowRe.exec(tableMatch[1]))) {
    const rawCode = decodeEntities(m[1]);
    const mdc = decodeEntities(m[2]);
    const drgRange = decodeEntities(m[3]);
    const category = decodeEntities(m[4]);
    // A trailing '*' marks a non-OR procedure per the manual's own legend; a
    // trailing '+' marks membership in a procedure cluster (out of scope, v1).
    let orProcedure = true;
    let code = rawCode;
    if (code.endsWith('*')) { orProcedure = false; code = code.slice(0, -1); }
    if (code.endsWith('+')) { code = code.slice(0, -1); }
    if (code) currentCode = code;
    if (!currentCode || !mdc || !drgRange) continue;
    rows.push({ code: currentCode, mdc: mdc.padStart(2, '0'), drgRange, category, orProcedure });
  }
  return rows;
}

function findNextPageHref(html) {
  const m = html.match(/id="next_page"\s+href="([^"]+)"/);
  return m ? m[1] : null;
}

function findPageCount(html) {
  const m = html.match(/Page\s+\d+\s+of\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function buildCrosswalk() {
  console.log(`Scraping Appendix E (Procedure Code/MS-DRG Index) from:\n  ${APPENDIX_E_BASE}${APPENDIX_E_START_PAGE}\n`);
  const crosswalk = new Map(); // code -> [{mdc, drgRange, category, orProcedure}]
  let page = APPENDIX_E_START_PAGE;
  let pageNum = 0;
  let totalPages = null;

  while (page && pageNum < MAX_PAGES_SAFETY_CAP) {
    pageNum++;
    const html = await fetchText(APPENDIX_E_BASE + page);
    if (totalPages === null) totalPages = findPageCount(html);

    for (const row of parseIndexPage(html)) {
      if (!crosswalk.has(row.code)) crosswalk.set(row.code, []);
      crosswalk.get(row.code).push({ mdc: row.mdc, drgRange: row.drgRange, category: row.category, orProcedure: row.orProcedure });
    }

    if (pageNum % 25 === 0 || pageNum === 1) {
      console.log(`  page ${pageNum}${totalPages ? `/${totalPages}` : ''} — ${crosswalk.size} codes so far (${page})`);
    }

    const next = findNextPageHref(html);
    if (!next || (totalPages && pageNum >= totalPages)) break;
    page = next;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`  Done: ${pageNum} pages, ${crosswalk.size} distinct codes.\n`);
  return crosswalk;
}

// ─── COMBINE + WRITE ───
async function main() {
  const [descByCode, crosswalk] = [await buildDescriptionMap(), await buildCrosswalk()];

  const categories = [];
  const categoryIndex = new Map();
  const codes = {};
  let missingDesc = 0;

  for (const [code, mappings] of crosswalk) {
    const desc = descByCode.get(code) || null;
    if (!desc) missingDesc++;
    const or = mappings.some((m) => m.orProcedure); // OR if any listed mapping treats it as OR
    const drgs = mappings.map((m) => {
      let idx = categoryIndex.get(m.category);
      if (idx === undefined) {
        idx = categories.length;
        categories.push(m.category);
        categoryIndex.set(m.category, idx);
      }
      return [parseInt(m.mdc, 10), m.drgRange, idx];
    });
    codes[code] = { desc, or, drgs };
  }

  if (missingDesc > 0) {
    console.log(`Note: ${missingDesc} crosswalk codes had no matching description in the order file (left as null — likely a vintage mismatch between the two source files; resolveIcd10PcsToDrgs() should still show the DRG mapping without a description).`);
  }

  const output = {
    version: MS_DRG_VERSION_LABEL,
    builtAt: new Date().toISOString().slice(0, 10),
    categories,
    codes,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  const sizeMb = (fs.statSync(OUTPUT_PATH).size / (1024 * 1024)).toFixed(2);
  console.log(`\nWrote ${Object.keys(codes).length} codes, ${categories.length} distinct categories to:\n  ${OUTPUT_PATH} (${sizeMb} MB)`);
}

// Guarded so this file can be imported (e.g. by a throwaway validation
// script) without kicking off the full multi-minute scrape.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Build failed:', e);
    process.exit(1);
  });
}

export { readZipEntry, parseIndexPage, findNextPageHref, findPageCount, decodeEntities };
