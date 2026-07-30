#!/usr/bin/env node
// Live CMS API smoke check — run MANUALLY from a network-connected machine:
//   node scripts/live-smoke.mjs
//
// The mocked unit/headless tests can't confirm the assumptions the app makes
// about the *live* data.cms.gov API (exact dataset titles, field spellings,
// DRG code padding, catalog shape). This script hits the real API and asserts
// each one, so a field-name drift on CMS's side is caught before it silently
// breaks the deployed app. It has NO effect on the build and is not run in CI
// (the sandbox/CI has no route to data.cms.gov).

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

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const uuidFromUrl = (u) => {
  const m = String(u || '').match(/data-api\/v1\/dataset\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
};

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Latest version UUID for a dataset title, from the catalog.
function latestId(catalog, title) {
  const want = norm(title);
  const byYear = {};
  (catalog.dataset || []).forEach((ds) => {
    if (norm(ds.title) !== want) return;
    (ds.distribution || []).forEach((d) => {
      const id = uuidFromUrl(d.accessURL) || uuidFromUrl(d.downloadURL);
      const ym = String(d.temporal || '').match(/(20\d{2})/);
      if (id && ym) byYear[+ym[1]] = id;
    });
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  return years.length ? { year: years[0], id: byYear[years[0]] } : null;
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
    if (v) { ok(`${key}: CY ${v.year} → ${v.id}`); resolved[key] = v; }
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
  if (resolved.dmeGeo) await fieldCheck('dmeGeo', `${DATA_API_ROOT}/${resolved.dmeGeo.id}/data?size=1&filter[Rndrng_Prvdr_Geo_Lvl]=National`,
    [['HCPCS_Cd'], ['HCPCS_Desc'], ['Tot_Suplr_Srvcs', 'Tot_Suplr_Srvcs_Cnt', 'Tot_Srvcs'], ['Tot_Suplr_Benes', 'Tot_Benes'], ['Avg_Suplr_Mdcr_Pymt_Amt', 'Tot_Suplr_Mdcr_Pymt_Amt', 'Avg_Mdcr_Pymt_Amt']]);
  if (resolved.dmeReferring) await fieldCheck('dmeReferring', `${DATA_API_ROOT}/${resolved.dmeReferring.id}/data?size=1`,
    [['HCPCS_Cd'], ['Rfrg_NPI'], ['Rfrg_Prvdr_Last_Name_Org'], ['Tot_Suplr_Srvcs', 'Tot_Srvcs']]);

  console.log('\n13. Does a real Level II code (L8699) resolve in DMEPOS but not in the physician data?');
  if (resolved.dmeGeo && resolved.provider) {
    const count = async (id, extra) => {
      try { return (await getJson(`${DATA_API_ROOT}/${id}/data?size=1&filter[HCPCS_Cd]=L8699${extra || ''}`)).length; }
      catch (e) { return -1; }
    };
    const inDme = await count(resolved.dmeGeo.id, '&filter[Rndrng_Prvdr_Geo_Lvl]=National');
    const inPhys = await count(resolved.geography ? resolved.geography.id : resolved.provider.id, '&filter[Rndrng_Prvdr_Geo_Lvl]=National');
    console.log(`  L8699 → DMEPOS: ${inDme} row(s); physician data: ${inPhys} row(s)`);
    if (inDme > 0) ok('Level II code found in DMEPOS (this is what the new panel queries)');
    else console.log('  ⚠ L8699 not found in DMEPOS national rows — try another Level II code (e.g. L1832, E0143) to confirm the dataset works');
  }

  finish();
}

function finish() {
  console.log(`\n${failures === 0 ? '✅ All live checks passed.' : `❌ ${failures} check(s) failed — the deployed app may need a field/title fix.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
