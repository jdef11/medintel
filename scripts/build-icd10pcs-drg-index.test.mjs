// Offline tests for scripts/build-icd10pcs-drg-index.mjs. The real build scrapes
// www.cms.gov; here a mocked fetch (scripts/test-fixtures/mock-fetch.mjs) serves a
// tiny fake manual + order-file ZIP so URL derivation, discovery fallbacks,
// validation and exit codes are all exercised without network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readZipEntry, listZipEntries, fiscalYearOf, msDrgVersionFor, sourcesForFy,
  pickOrderFileEntry, findOrderZipLink, validateIndex, SENTINEL_CODES,
} from './build-icd10pcs-drg-index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'build-icd10pcs-drg-index.mjs');
const MOCK = path.join(here, 'test-fixtures', 'mock-fetch.mjs');

// Minimal stored (uncompressed) ZIP writer — enough for readZipEntry.
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name), data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// One fixed-width order-file line (layout documented in buildDescriptionMap).
const orderLine = (seq, code, desc) =>
  `${String(seq).padStart(5, '0')} ${code.padEnd(7)} 1 ${desc.slice(0, 60).padEnd(60)}${desc}`;

const indexPage = (rows, pageNo, total, next) => `<html><body><div>Page ${pageNo} of ${total}</div>
<table class="codelst">${rows.map(([c, mdc, drg, cat]) =>
  `<tr><td class="code">${c}</td><td class="clcl">${mdc}</td><td class="clcl">${drg}</td><td class="clcl">${cat}</td></tr>`).join('\n')}</table>
${next ? `<a id="next_page" href="${next}">next</a>` : ''}</body></html>`;

describe('fiscal-year helpers', () => {
  it('maps dates to the federal fiscal year (Oct 1 starts the next FY)', () => {
    expect(fiscalYearOf(new Date('2026-09-30T23:00:00Z'))).toBe(2026);
    expect(fiscalYearOf(new Date('2026-10-01T00:00:00Z'))).toBe(2027);
  });
  it('maps FY to MS-DRG version (FY2026 → v43, FY2027 → v44)', () => {
    expect(msDrgVersionFor(2026)).toBe(43);
    expect(msDrgVersionFor(2027)).toBe(44);
  });
  it('derives the FY2026 URLs the original build used, and the FY2027 equivalents', () => {
    const s26 = sourcesForFy(2026);
    expect(s26.appendixEBases[0]).toBe('https://www.cms.gov/icd10m/FY2026-fr-v43-fullcode-cms/fullcode_cms/');
    expect(s26.orderZipUrls[0]).toBe('https://www.cms.gov/files/zip/2026-icd-10-pcs-order-file-long-and-abbreviated-titles.zip');
    expect(s26.label).toBe('MS-DRG v43.0 / FY2026');
    expect(sourcesForFy(2027).appendixEBases[0]).toBe('https://www.cms.gov/icd10m/FY2027-fr-v44-fullcode-cms/fullcode_cms/');
  });
  it('lets env overrides replace the derived URLs', () => {
    const s = sourcesForFy(2027, { ICD10PCS_APPENDIX_E_BASE: 'https://x/', ICD10PCS_START_PAGE: 'P0500.html', ICD10PCS_ORDER_ZIP_URL: 'https://x/o.zip' });
    expect(s.appendixEBases).toEqual(['https://x/']);
    expect(s.startPage).toBe('P0500.html');
    expect(s.orderZipUrls).toEqual(['https://x/o.zip']);
  });
});

describe('order-file ZIP handling', () => {
  it('lists and reads entries', () => {
    const zip = makeZip({ 'a.txt': 'hello', 'b.txt': 'world' });
    expect(listZipEntries(zip)).toEqual(['a.txt', 'b.txt']);
    expect(readZipEntry(zip, 'b.txt').toString()).toBe('world');
    expect(() => readZipEntry(zip, 'c.txt')).toThrow(/not found/);
  });
  it('picks the full order file, never the addenda (changes-only) file', () => {
    expect(pickOrderFileEntry(['order_addenda_2027.txt', 'icd10pcs_order_2027.txt', 'readme.pdf'], 2027)).toBe('icd10pcs_order_2027.txt');
    expect(pickOrderFileEntry(['order_addenda_2027.txt', 'Zip File 2 2027 ICD-10-PCS order_2027.txt'], 2027)).toBe('Zip File 2 2027 ICD-10-PCS order_2027.txt');
    expect(pickOrderFileEntry(['order_addenda_2027.txt', 'readme.pdf'], 2027)).toBeNull();
  });
  it("finds the FY's order-file link on the ICD-10 codes page", () => {
    const html = '<a href="/files/zip/2026-icd-10-pcs-order-file-long-and-abbreviated-titles.zip">2026</a>' +
      '<a href="/files/zip/2027-icd-10-pcs-order-file-long-and-abbreviated-titles-updated.zip">2027</a>';
    expect(findOrderZipLink(html, 2027)).toBe('https://www.cms.gov/files/zip/2027-icd-10-pcs-order-file-long-and-abbreviated-titles-updated.zip');
    expect(findOrderZipLink(html, 2028)).toBeNull();
  });
});

describe('validateIndex()', () => {
  const entry = { desc: 'x', or: true, drgs: [[8, '461-462', 0]] };
  const make = (n, extra = {}) => {
    const codes = {};
    SENTINEL_CODES.forEach((c) => { codes[c] = entry; });
    for (let i = 0; codes && Object.keys(codes).length < n; i++) codes[`0SR${String(i).padStart(4, '0')}`] = entry;
    return { codes: { ...codes, ...extra } };
  };
  it('accepts an index comparable to the previous one', () => {
    expect(validateIndex(make(1000), make(1000))).toEqual([]);
  });
  it('rejects a large drop in code count (e.g. a truncated crawl)', () => {
    expect(validateIndex(make(500), make(1000)).join()).toMatch(/code count/);
  });
  it('rejects missing descriptions (order file and manual from different years)', () => {
    const next = make(1000);
    Object.keys(next.codes).slice(0, 100).forEach((c) => { next.codes[c] = { ...entry, desc: null }; });
    expect(validateIndex(next, make(1000)).join()).toMatch(/no description/);
  });
  it('rejects malformed MS-DRG ranges and missing sentinels', () => {
    const next = { codes: { '0ABCDEF': { desc: 'x', drgs: [[1, 'abc', 0]] } } };
    const problems = validateIndex(next, null).join();
    expect(problems).toMatch(/malformed/);
    expect(problems).toMatch(/sentinel/);
  });
});

describe('end-to-end build against a mocked CMS (no network)', () => {
  let tmp;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icd10pcs-build-')); });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const BASE = 'https://www.cms.gov/icd10m/FY2027-fr-v44-fullcode-cms/fullcode_cms/';
  const ZIP_URL = 'https://www.cms.gov/files/zip/2027-icd-10-pcs-order-file-long-and-abbreviated-titles.zip';
  const codes = [...SENTINEL_CODES, '0SRC0JA', '0SRC0JZ'];
  const zip = makeZip({
    'order_addenda_2027.txt': orderLine(1, '0SRC0J9', 'ADDENDA ONLY - must not be used'),
    'icd10pcs_order_2027.txt': codes.map((c, i) => orderLine(i + 1, c, `Description of ${c}`)).join('\r\n'),
  });
  const rows = codes.map((c) => [c, '08', '461-462', 'Major Joint Replacement']);
  const happyRoutes = () => ({
    [ZIP_URL]: { body64: zip.toString('base64') },
    [`${BASE}P0033.html`]: { body: '<a href="P0001.html">TOC</a> <a href="P0400.html">Procedure Code/MS-DRG Index</a>' },
    [`${BASE}P0001.html`]: { body: '<html>table of contents</html>' },
    [`${BASE}P0400.html`]: { body: indexPage(rows.slice(0, 7), 1, 2, 'P0401.html') },
    [`${BASE}P0401.html`]: { body: indexPage(rows.slice(7), 2, 2, null) },
  });

  function run(routes, args = ['--fy', '2027'], extraEnv = {}) {
    const fixture = path.join(tmp, `routes-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(fixture, JSON.stringify(routes));
    const out = path.join(tmp, `out-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, ['--import', MOCK, SCRIPT, ...args], {
      env: { ...process.env, MOCK_FETCH_ROUTES: fixture, ICD10PCS_OUTPUT_PATH: out, ...extraEnv },
      encoding: 'utf8', timeout: 60000,
    });
    return { code: r.status, log: r.stdout + r.stderr, out: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
  }

  it('builds FY2027 from derived URLs, discovering the start page and skipping the addenda file', () => {
    const r = run(happyRoutes());
    expect(r.code, r.log).toBe(0);
    expect(r.out.version).toBe('MS-DRG v44.0 / FY2027');
    expect(r.out.sources).toMatchObject({ appendixEBase: BASE, appendixEStartPage: 'P0400.html', orderEntry: 'icd10pcs_order_2027.txt' });
    expect(Object.keys(r.out.codes).sort()).toEqual([...codes].sort());
    expect(r.out.codes['0SRC0J9'].desc).toBe('Description of 0SRC0J9');
  });

  it('falls back to the ICD-10 codes page when the ZIP URL pattern changes', () => {
    const routes = happyRoutes();
    const moved = 'https://www.cms.gov/files/zip/2027-icd-10-pcs-order-file-long-and-abbreviated-titles-v2.zip';
    routes[moved] = routes[ZIP_URL]; delete routes[ZIP_URL];
    routes['https://www.cms.gov/medicare/coding-billing/icd-10-codes'] = { body: `<a href="/files/zip/2027-icd-10-pcs-order-file-long-and-abbreviated-titles-v2.zip">2027 order file</a>` };
    const r = run(routes);
    expect(r.code, r.log).toBe(0);
    expect(r.out.sources.orderZipUrl).toBe(moved);
  });

  it('exits 3 (not published yet) when the FY files 404, and writes nothing', () => {
    const r = run({ 'https://www.cms.gov/medicare/coding-billing/icd-10-codes': { body: '<html>no 2028 yet</html>' } }, ['--fy', '2028']);
    expect(r.code, r.log).toBe(3);
    expect(r.out).toBeNull();
  });

  it('exits 5 with instructions when the index start page cannot be found', () => {
    const routes = happyRoutes();
    routes[`${BASE}P0033.html`] = { body: '<a href="P0001.html">TOC</a>' };
    const r = run(routes);
    expect(r.code, r.log).toBe(5);
    expect(r.log).toMatch(/ICD10PCS_START_PAGE/);
    expect(r.out).toBeNull();
  });

  it('does nothing when the existing index is already for that FY', () => {
    const r = run({}, ['--fy', '2026'], { ICD10PCS_OUTPUT_PATH: path.join(here, '..', 'data', 'icd10pcs-drg-index.json') });
    expect(r.code, r.log).toBe(0);
    expect(r.log).toMatch(/already MS-DRG v\d+\.0 \/ FY\d{4}/); // whatever year is committed
  });
});
