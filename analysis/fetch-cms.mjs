#!/usr/bin/env node
// Fetch national Medicare Part B (physician/practitioner) volume for a fixed list of
// cartilage-related HCPCS codes, 2016-latest, from the CMS "by Geography and Service" datasets.
// Rate-limited (>=3s between requests); every request is appended to raw/query-log.jsonl.
// Usage: node fetch-cms.mjs   (run from the analysis/ directory)
import fs from 'node:fs';

const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8')).geo;
const YEARS = Object.keys(versions).map(Number).filter((y) => y >= 2016).sort();
// Code list + tiers are defined (and justified) in methods.md; keep in sync.
const CODES = [
  '29866', '29867', '27412', '27415', '27416', '28446', // A: cartilage restoration / osteochondral graft & cell therapy
  '29879', '29885', '29886', '29887',                    // B: marrow stimulation / OCD drilling
  '29877', 'G0289', '29862',                             // C: chondroplasty / debridement
];
const DELAY_MS = 3500;
fs.mkdirSync('raw', { recursive: true });
const logPath = 'raw/query-log.jsonl';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0;
for (const year of YEARS) {
  for (const code of CODES) {
    const base = `https://data.cms.gov/data-api/v1/dataset/${versions[year]}/data`;
    const qs = new URLSearchParams({ 'filter[Rndrng_Prvdr_Geo_Lvl]': 'National', 'filter[HCPCS_Cd]': code, size: '50' });
    const url = `${base}?${qs}`;
    const queryId = `Q${String(++n).padStart(3, '0')}`;
    const entry = { query_id: queryId, year, code, dataset_uuid: versions[year], url, requested_at: new Date().toISOString() };
    try {
      const r = await fetch(url);
      entry.http_status = r.status;
      const rows = r.ok ? await r.json() : null;
      entry.row_count = rows ? rows.length : null;
      if (rows) fs.writeFileSync(`raw/${queryId}.json`, JSON.stringify(rows));
    } catch (e) {
      entry.error = String(e);
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    await sleep(DELAY_MS);
  }
}
console.log(`done: ${n} queries`);
