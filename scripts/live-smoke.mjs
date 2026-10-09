#!/usr/bin/env node
// Live CMS API smoke check — run MANUALLY from a network-connected machine:
//   node scripts/live-smoke.mjs
//
// The mocked unit/headless tests can't confirm the assumptions the app makes
// about the *live* data.cms.gov API (exact dataset titles, field spellings,
// DRG code padding, catalog shape). This script hits the real API and asserts
// each one, so a field-name drift on CMS's side is caught before it silently
// breaks the deployed app. It has NO effect on the build or deploy. It runs
// weekly via .github/workflows/live-smoke.yml, which turns a failure into a
// GitHub issue. Exit codes: 0 pass, 1 a check failed, 2 data.cms.gov unreachable.

import { createRequire } from 'module';

// Needs Node 18+ (global fetch). Fail with a clear message on older runtimes.
if (typeof fetch !== 'function') {
  console.error('This script needs Node 18 or newer (global fetch). Your version: ' + process.version);
  process.exit(1);
}

const CATALOG_URL = 'https://data.cms.gov/data.json';
const DATA_API_ROOT = 'https://data.cms.gov/data-api/v1/dataset';

// Titles the app resolves in extractDatasetVersions() — must match exactly.
const TITLES = {
  provider:    'Medicare Physician & Other Practitioners - by Provider and Service',
  provSummary: 'Medicare Physician & Other Practitioners - by Provider',
  geography:   'Medicare Physician & Other Practitioners - by Geography and Service',
  inpProvider: 'Medicare Inpatient Hospitals - by Provider and Service',
  inpGeo:      'Medicare Inpatient Hospitals - by Geography and Service',
  dmeGeo:      'Medicare Durable Medical Equipment, Devices & Supplies - by Geography and Service',
  dmeReferring:'Medicare Durable Medical Equipment, Devices & Supplies - by Referring Provider and Service',
};

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failures++; };

// Use the app's real catalog parser, so this checks what the app actually does
// rather than a local copy that can drift from it.
const require = createRequire(import.meta.url);
const { extractDatasetVersions, LATEST_DATASET_IDS, yearFromDataFileName, icd10IndexStaleness } = require('../medintel-core.js');
const { readFileSync } = require('fs');

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Latest version for a dataset title, as the app resolves it.
function latestId(catalog, title) {
  return extractDatasetVersions(catalog, title)[0] || null;
}

async function main() {
  console.log('Live CMS API smoke check\n');

  console.log('1. Catalog (data.json) reachable and has a dataset array');
  let catalog;
  try {
    catalog = await getJson(CATALOG_URL);
    Array.isArray(catalog.dataset) ? ok(`dataset array present (${catalog.dataset.length} entries)`) : bad('no dataset array');
  } catch (e) {
    // A 403/timeout here is a NETWORK/policy problem (blocked egress, proxy),
    // not evidence that the app's assumptions drifted — say so plainly.
    console.log(`  ✗ catalog fetch failed: ${e.message}`);
    console.log('\n⚠ Could not reach data.cms.gov — this is a network/egress problem (blocked host, proxy, or offline), NOT an app data-drift issue. Run this from a machine with plain internet access to CMS.');
    process.exit(2);
  }

  console.log('\n2. Each dataset title resolves to at least one versioned UUID');
  const resolved = {};
  for (const [key, title] of Object.entries(TITLES)) {
    const v = latestId(catalog, title);
    const n = extractDatasetVersions(catalog, title).length;
    if (v) { ok(`${key}: ${n} data years, latest CY ${v.year} → ${v.id}`); resolved[key] = v; }
    else bad(`${key}: title not found or no API distribution — "${title}"`);
  }

  const fieldCheck = async (label, url, fields) => {
    try {
      const rows = await getJson(url);
      if (!rows.length) { bad(`${label}: no rows returned`); return; }
      const row = rows[0];
      const keys = Object.keys(row);
      fields.forEach((variants) => {
        const hit = variants.find((f) => f in row);
        hit ? ok(`${label}: found ${hit}`) : bad(`${label}: none of [${variants.join(', ')}] present (keys: ${keys.slice(0, 8).join(', ')}…)`);
      });
    } catch (e) { bad(`${label}: ${e.message}`); }
  };

  console.log('\n3. Provider & Service — HCPCS + payment fields');
  if (resolved.provider) await fieldCheck('provider', `${DATA_API_ROOT}/${resolved.provider.id}/data?size=1`,
    [['Rndrng_NPI'], ['HCPCS_Cd'], ['Tot_Srvcs', 'Tot_Srvcs_Cnt'], ['Avg_Mdcr_Pymt_Amt']]);

  console.log('\n4. by-Provider SUMMARY — true distinct beneficiary count (Tot_Benes)');
  if (resolved.provSummary) await fieldCheck('provSummary', `${DATA_API_ROOT}/${resolved.provSummary.id}/data?size=1`,
    [['Rndrng_NPI'], ['Tot_Benes', 'Tot_Bene_Cnt']]);

  console.log('\n5. Geography & Service — national row carries HCPCS + Tot_Benes');
  if (resolved.geography) await fieldCheck('geography', `${DATA_API_ROOT}/${resolved.geography.id}/data?size=1&filter[Rndrng_Prvdr_Geo_Lvl]=National`,
    [['HCPCS_Cd'], ['Tot_Srvcs', 'Tot_Srvcs_Cnt'], ['Tot_Benes', 'Tot_Bene_Cnt']]);

  console.log('\n6. Inpatient Geography — DRG code + discharge/payment fields');
  if (resolved.inpGeo) await fieldCheck('inpGeo', `${DATA_API_ROOT}/${resolved.inpGeo.id}/data?size=1&filter[Rndrng_Prvdr_Geo_Lvl]=National`,
    [['DRG_Cd'], ['DRG_Desc'], ['Tot_Dschrgs', 'Tot_Dschrg_Cnt'], ['Avg_Submtd_Cvrd_Chrg', 'Avg_Sbmtd_Cvrd_Chrg', 'Avg_Cvrd_Chrg'], ['Avg_Tot_Pymt_Amt'], ['Avg_Mdcr_Pymt_Amt']]);

  console.log('\n7. Inpatient Provider — hospital identity fields');
  if (resolved.inpProvider) await fieldCheck('inpProvider', `${DATA_API_ROOT}/${resolved.inpProvider.id}/data?size=1`,
    [['DRG_Cd'], ['Rndrng_Prvdr_Org_Name'], ['Rndrng_Prvdr_CCN'], ['Rndrng_Prvdr_State_Abrvtn']]);

  console.log('\n8. DRG code format (is it zero-padded to 3 digits, e.g. "025"?)');
  if (resolved.inpGeo) {
    try {
      const rows = await getJson(`${DATA_API_ROOT}/${resolved.inpGeo.id}/data?size=5&filter[Rndrng_Prvdr_Geo_Lvl]=National`);
      const sample = rows.map((r) => r.DRG_Cd).filter(Boolean).slice(0, 5);
      const padded = sample.some((c) => /^0\d\d$/.test(c));
      console.log(`  sample DRG_Cd values: ${JSON.stringify(sample)}`);
      padded ? ok('zero-padded 3-digit codes seen (app pads to match)')
             : console.log('  ⚠ no zero-padded sample in first 5 — app tries both padded and unpadded, so this is informational');
    } catch (e) { bad(`DRG format check: ${e.message}`); }
  }

  console.log('\n9. Is the CONTAINS filter case-sensitive? (decides whether typing "ortho" matches "Orthopedic Surgery")');
  if (resolved.provider) {
    const containsCount = async (field, value) => {
      const url = `${DATA_API_ROOT}/${resolved.provider.id}/data?size=1` +
        `&filter[${field}][condition][path]=${field}` +
        `&filter[${field}][condition][operator]=CONTAINS` +
        `&filter[${field}][condition][value]=${encodeURIComponent(value)}`;
      try { return (await getJson(url)).length; } catch (e) { return -1; }
    };
    const lower = await containsCount('Rndrng_Prvdr_Type', 'ortho');
    const proper = await containsCount('Rndrng_Prvdr_Type', 'Ortho');
    console.log(`  CONTAINS "ortho" → ${lower} row(s); CONTAINS "Ortho" → ${proper} row(s)`);
    if (lower > 0 && proper > 0) ok('case-INSENSITIVE — any casing works in the Specialty field');
    else if (proper > 0 && lower === 0) {
      console.log('  ⚠ case-SENSITIVE — the Specialty field must match CMS capitalization (e.g. "Orthopedic Surgery", not "ortho").');
      console.log('    Report this and the app can normalize specialty input automatically.');
    } else if (lower === -1 || proper === -1) bad('case check request failed');
    else console.log('  ⚠ inconclusive (no rows either way) — try a different sample term');
  }

  console.log('\n10. Provider-name CONTAINS filter (the app upper-cases names to match CMS storage)');
  if (resolved.provider) {
    try {
      const url = `${DATA_API_ROOT}/${resolved.provider.id}/data?size=1` +
        `&filter[Rndrng_Prvdr_Last_Org_Name][condition][path]=Rndrng_Prvdr_Last_Org_Name` +
        `&filter[Rndrng_Prvdr_Last_Org_Name][condition][operator]=CONTAINS` +
        `&filter[Rndrng_Prvdr_Last_Org_Name][condition][value]=GROSS`;
      const rows = await getJson(url);
      rows.length ? ok(`name filter works (sample: ${rows[0].Rndrng_Prvdr_Last_Org_Name})`)
                  : bad('name CONTAINS filter returned no rows for "GROSS" — the app\'s provider-name search may need a different field/casing');
    } catch (e) { bad(`name filter check: ${e.message}`); }
  }

  console.log('\n11. Do two filter conditions AND or OR? (the app declares an explicit AND group)');
  if (resolved.provider) {
    const base = `${DATA_API_ROOT}/${resolved.provider.id}/data?size=1`;
    const nameCond = (label, memberOf) =>
      `&filter[${label}][condition][path]=Rndrng_Prvdr_Last_Org_Name` +
      `&filter[${label}][condition][operator]=CONTAINS` +
      `&filter[${label}][condition][value]=GROSS` +
      (memberOf ? `&filter[${label}][condition][memberOf]=${memberOf}` : '');
    // A deliberately contradictory pair: a name that exists AND a specialty that
    // cannot co-occur with it in one row would be empty under AND, non-empty under OR.
    const impossible = (label, memberOf) =>
      `&filter[${label}][condition][path]=Rndrng_Prvdr_Type` +
      `&filter[${label}][condition][operator]=CONTAINS` +
      `&filter[${label}][condition][value]=ZZZZNOSUCHSPECIALTY` +
      (memberOf ? `&filter[${label}][condition][memberOf]=${memberOf}` : '');
    try {
      const bare = await getJson(base + nameCond('a') + impossible('b'));
      const grouped = await getJson(base + '&filter[g][group][conjunction]=AND' + nameCond('a', 'g') + impossible('b', 'g'));
      console.log(`  bare conditions → ${bare.length} row(s); explicit AND group → ${grouped.length} row(s)`);
      if (bare.length > 0) console.log('  ⚠ bare conditions behave as OR (a contradictory pair still matched) — the explicit AND group is required. The app sends it.');
      else ok('bare conditions already AND');
      grouped.length === 0
        ? ok('explicit AND group is honored (contradictory pair returns nothing)')
        : bad('explicit AND group did NOT filter — the app also enforces AND client-side, but report this');
    } catch (e) { bad(`conjunction check: ${e.message}`); }
  }

  console.log('\n12. DMEPOS (HCPCS Level II) — supplier volume + referring-provider fields');
  if (resolved.dmeGeo) await fieldCheck('dmeGeo', `${DATA_API_ROOT}/${resolved.dmeGeo.id}/data?size=1`,
    [['HCPCS_Cd'], ['HCPCS_Desc'], ['Tot_Suplr_Srvcs', 'Tot_Suplr_Srvcs_Cnt', 'Tot_Srvcs'], ['Tot_Suplr_Benes', 'Tot_Benes'], ['Avg_Suplr_Mdcr_Pymt_Amt', 'Tot_Suplr_Mdcr_Pymt_Amt', 'Avg_Mdcr_Pymt_Amt']]);
  if (resolved.dmeReferring) await fieldCheck('dmeReferring', `${DATA_API_ROOT}/${resolved.dmeReferring.id}/data?size=1`,
    [['HCPCS_CD', 'HCPCS_Cd'], ['Rfrg_NPI'], ['Rfrg_Prvdr_Last_Name_Org'], ['Tot_Suplr_Srvcs', 'Tot_Srvcs']]);

  // Which column carries the geography level in the DMEPOS file? The physician
  // and inpatient files use Rndrng_Prvdr_Geo_Lvl; DMEPOS geography is the
  // REFERRING provider's, so it should be Rfrg_Prvdr_Geo_Lvl. Filtering on the
  // wrong name returns an empty set that looks exactly like "no data" — the app
  // now scopes client-side instead, but report which name is real.
  console.log('\n12b. DMEPOS geography-level column name');
  if (resolved.dmeGeo) {
    try {
      const rows = await getJson(`${DATA_API_ROOT}/${resolved.dmeGeo.id}/data?size=1`);
      const keys = rows.length ? Object.keys(rows[0]) : [];
      const geoKeys = keys.filter(k => /geo[_ ]?lvl/i.test(k));
      const nationalRows = await getJson(`${DATA_API_ROOT}/${resolved.dmeGeo.id}/data?size=1&filter[Rfrg_Prvdr_Geo_Lvl]=National`);
      console.log(`  geo-level column(s): ${geoKeys.join(', ') || '(none found)'}`);
      if (geoKeys.some(k => /^Rfrg/i.test(k))) ok('DMEPOS uses Rfrg_Prvdr_Geo_Lvl (as the app assumes)');
      else if (geoKeys.length) bad(`DMEPOS geo-level column is "${geoKeys[0]}" — app scopes client-side so this still works, but note the drift`);
      else bad('no geography-level column found in the DMEPOS geography file');
      console.log(`  filter[Rfrg_Prvdr_Geo_Lvl]=National → ${nationalRows.length} row(s)`);
    } catch (e) { bad(`DMEPOS geo-level check: ${e.message}`); }
  }

  // E0601 (CPAP) is supplier-billed and present in every DMEPOS year checked.
  // (L8699 was used here before but has no DMEPOS rows in CY2021-2024 at all.)
  console.log('\n13. Does a real Level II code (E0601) resolve in DMEPOS but not in the physician data?');
  if (resolved.dmeGeo && resolved.provider) {
    const count = async (id, extra) => {
      try { return (await getJson(`${DATA_API_ROOT}/${id}/data?size=5&filter[HCPCS_Cd]=E0601${extra || ''}`)).length; }
      catch (e) { return -1; }
    };
    // Unfiltered by geography — that is exactly what the app now requests.
    const inDme = await count(resolved.dmeGeo.id);
    const inPhys = await count(resolved.geography ? resolved.geography.id : resolved.provider.id, '&filter[Rndrng_Prvdr_Geo_Lvl]=National');
    console.log(`  E0601 → DMEPOS: ${inDme} row(s); physician data: ${inPhys} row(s)`);
    if (inDme > 0) ok('Level II code found in DMEPOS (this is what the panel queries)');
    else bad('E0601 returned no DMEPOS rows even unfiltered — the panel will show "could not check"; verify the dataset title resolved');
  }

  console.log('\n13b. DME Referring filter on HCPCS_CD returns only that code (the app filters on it)');
  if (resolved.dmeReferring) {
    try {
      const rows = await getJson(`${DATA_API_ROOT}/${resolved.dmeReferring.id}/data?size=5&filter[HCPCS_CD]=E0601`);
      const codes = rows.map((r) => r.HCPCS_CD || r.HCPCS_Cd);
      console.log(`  filter[HCPCS_CD]=E0601 → ${JSON.stringify(codes)}`);
      rows.length && codes.every((c) => c === 'E0601') ? ok('referrer filter is honored')
        : bad('referrer filter ignored or empty — the ordering-physicians panel will be empty');
    } catch (e) { bad(`referrer filter check: ${e.message}`); }
  }

  console.log('\n14. A C-code (C1889) should be absent everywhere — the app must explain, not show "0 matches"');
  if (resolved.dmeGeo && resolved.geography) {
    const seen = async (id) => {
      try { return (await getJson(`${DATA_API_ROOT}/${id}/data?size=5&filter[HCPCS_Cd]=C1889`)).length; }
      catch (e) { return -1; }
    };
    const dmeHits = await seen(resolved.dmeGeo.id);
    const physHits = await seen(resolved.geography.id);
    console.log(`  C1889 → DMEPOS: ${dmeHits} row(s); physician data: ${physHits} row(s)`);
    if (dmeHits === 0 && physHits === 0) ok('C-code absent from both, as expected — app shows the OPPS pass-through explanation');
    else console.log('  ⚠ C1889 unexpectedly present — the app skips the DMEPOS query for C-codes, so revisit that assumption');
  }

  // The app falls back to these when the catalog can't be read. They're only a
  // safe fallback if CMS keeps them pointed at the newest year — this is where
  // a stale or retired alias gets caught.
  console.log('\n15. Latest-year fallback IDs (LATEST_DATASET_IDS) still serve the newest data year');
  for (const [key, id] of Object.entries(LATEST_DATASET_IDS)) {
    try {
      const j = await getJson(`${DATA_API_ROOT}/${id}/data-viewer?size=0`);
      const file = j && j.meta && j.meta.data_file_name;
      const year = yearFromDataFileName(file);
      const want = resolved[key] && resolved[key].year;
      if (!year) bad(`${key}: alias ${id} — could not read a data year from "${file}"`);
      else if (want && year !== want) bad(`${key}: alias serves CY ${year} but the catalog's newest is CY ${want} — update LATEST_DATASET_IDS in medintel-core.js from data.json's "latest" API distribution`);
      else ok(`${key}: alias serves CY ${year}${want ? ' (= catalog newest)' : ' (catalog year unknown)'}`);
    } catch (e) { bad(`${key}: alias ${id} — ${e.message}`); }
  }

  // Not a live-API check, but it's a yearly chore that otherwise only gets
  // noticed by a user: MS-DRG versions change every Oct 1.
  console.log('\n16. ICD-10-PCS → MS-DRG crosswalk (data/icd10pcs-drg-index.json) is for the current fiscal year');
  try {
    const idx = JSON.parse(readFileSync(new URL('../data/icd10pcs-drg-index.json', import.meta.url), 'utf8'));
    const st = icd10IndexStaleness(idx.version);
    if (!st) bad(`could not read a fiscal year from the index version "${idx.version}"`);
    else if (st.stale) bad(`index is ${idx.version} (built ${idx.builtAt}), which ended ${st.endsOn} — rebuild for FY${st.fy + 1}: update the source URLs in scripts/build-icd10pcs-drg-index.mjs, then npm run build:icd10pcs`);
    else ok(`${idx.version} — current through ${st.endsOn}`);
  } catch (e) { bad(`could not read the index: ${e.message}`); }

  finish();
}

function finish() {
  console.log(`\n${failures === 0 ? '✅ All live checks passed.' : `❌ ${failures} check(s) failed — see the ✗ lines above for what needs updating.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
