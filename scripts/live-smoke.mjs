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

  finish();
}

function finish() {
  console.log(`\n${failures === 0 ? '✅ All live checks passed.' : `❌ ${failures} check(s) failed — the deployed app may need a field/title fix.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
