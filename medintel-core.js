// medintel-core.js — Pure logic functions extracted from cms-sales-intel.
// No DOM dependencies. Exported for use in tests and loaded via <script src> in the app.

// ─── FIELD ACCESSOR ───
// CMS API may return field names with underscores OR spaces depending on the dataset version.
// Tries the underscore version first, then the space version.
function f(row, fieldName) {
  if (row[fieldName] !== undefined) return row[fieldName];
  const spaced = fieldName.replace(/_/g, ' ');
  if (row[spaced] !== undefined) return row[spaced];
  return undefined;
}

// ─── PAYMENT ACCESSORS ───
// Smart payment accessor: the API may only have Avg (per-service) fields, not Tot (total) fields.
// If Tot_Mdcr_Pymt_Amt is missing or zero, compute total = Avg_Mdcr_Pymt_Amt × Tot_Srvcs
function getPayment(row) {
  const tot = parseFloat(f(row, 'Tot_Mdcr_Pymt_Amt'));
  if (!isNaN(tot) && tot !== 0) return tot;
  const avg = parseFloat(f(row, 'Avg_Mdcr_Pymt_Amt'));
  const srvcs = parseFloat(f(row, 'Tot_Srvcs')) || parseFloat(f(row, 'Tot_Srvcs_Cnt')) || 0;
  if (!isNaN(avg)) return avg * srvcs;
  return 0;
}

function getAvgCharge(row) {
  const v = parseFloat(f(row, 'Avg_Sbmtd_Chrg'));
  if (!isNaN(v)) return v;
  const v2 = parseFloat(f(row, 'Avg_Sbmtd_Chrg_Amt'));
  if (!isNaN(v2)) return v2;
  return 0;
}

function getServices(row) {
  const v = parseFloat(f(row, 'Tot_Srvcs'));
  if (!isNaN(v)) return v;
  const v2 = parseFloat(f(row, 'Tot_Srvcs_Cnt'));
  if (!isNaN(v2)) return v2;
  return 0;
}

function getBenes(row) {
  const v = parseFloat(f(row, 'Tot_Benes'));
  if (!isNaN(v)) return v;
  const v2 = parseFloat(f(row, 'Tot_Bene_Cnt'));
  if (!isNaN(v2)) return v2;
  return 0;
}

// ─── PROVIDER NAME ───
function getProviderName(row) {
  if (f(row, 'Rndrng_Prvdr_Ent_Cd') === 'O') {
    return f(row, 'Rndrng_Prvdr_Org_Name') || f(row, 'Rndrng_Prvdr_Last_Org_Name') || 'Organization';
  }
  const last = f(row, 'Rndrng_Prvdr_Last_Org_Name') || '';
  const first = f(row, 'Rndrng_Prvdr_First_Name') || '';
  const mi = f(row, 'Rndrng_Prvdr_MI') || '';
  const cred = f(row, 'Rndrng_Prvdr_Crdntls') || '';
  let name = last;
  if (first) name = `${first} ${mi ? mi + '. ' : ''}${last}`;
  if (cred) name += `, ${cred}`;
  return name || 'Unknown Provider';
}

// ─── LOCATION ───
function getLocation(row) {
  const parts = [];
  const city = f(row, 'Rndrng_Prvdr_City');
  const state = f(row, 'Rndrng_Prvdr_State_Abrvtn');
  const zip = f(row, 'Rndrng_Prvdr_Zip5');
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);
  return parts.join(', ') || '—';
}

// ─── FORMATTERS ───
function fmtCurrency(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtNumber(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

// ─── NETWORK BACKOFF ───
// Exponential backoff delay (ms) for retry attempt N (0-indexed), capped.
// Pure so the schedule is unit-testable; the caller supplies the actual wait.
function backoffDelay(attempt, baseMs, capMs) {
  const base = baseMs || 500;
  const cap = capMs || 8000;
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
}

// ─── CSV SAFETY ───
// Escapes one CSV field. Two concerns:
//  1. Quoting: wrap in double-quotes and double internal quotes when the value
//     contains a comma, quote, newline, or carriage return.
//  2. Formula injection: a value starting with = + - @ (or tab/CR) is executed
//     as a formula by Excel/Sheets. Prefix such values with a single quote so
//     they render as text. Applied to every exported field via toCsvRow.
function csvField(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsvRow(values) {
  return (values || []).map(csvField).join(',');
}

// ─── XSS PREVENTION ───
// Escapes the five HTML-significant characters. We DO NOT use the
// textContent->innerHTML DOM trick here: it escapes &<> but leaves both quote
// characters intact, so a value interpolated into an attribute (title="...",
// onclick='...') could break out of the attribute. Explicit replacement covers
// element text AND single/double-quoted attribute contexts, and behaves
// identically in the browser and in Node/test environments.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── GROUP BY PROVIDER ───
function groupByProvider(rows) {
  const map = {};
  rows.forEach(row => {
    const npi = f(row, 'Rndrng_NPI') || 'unknown';
    if (!map[npi]) {
      map[npi] = {
        npi,
        name: getProviderName(row),
        specialty: f(row, 'Rndrng_Prvdr_Type') || '',
        location: getLocation(row),
        city: f(row, 'Rndrng_Prvdr_City') || '',
        state: f(row, 'Rndrng_Prvdr_State_Abrvtn') || '',
        zip: f(row, 'Rndrng_Prvdr_Zip5') || '',
        street: f(row, 'Rndrng_Prvdr_St1') || '',
        credentials: f(row, 'Rndrng_Prvdr_Crdntls') || '',
        entityType: f(row, 'Rndrng_Prvdr_Ent_Cd') === 'O' ? 'Organization' : 'Individual',
        totalPayment: 0,
        totalServices: 0,
        totalBeneficiaries: 0,
        procedures: []
      };
    }
    const g = map[npi];
    const pymt = getPayment(row);
    const srvcs = getServices(row);
    const benes = getBenes(row);
    g.totalPayment += pymt;
    g.totalServices += srvcs;
    g.totalBeneficiaries += benes;
    g.procedures.push({
      code: f(row, 'HCPCS_Cd') || '',
      desc: f(row, 'HCPCS_Desc') || '',
      services: srvcs,
      payment: pymt,
      avgCharge: getAvgCharge(row),
      place: f(row, 'Place_Of_Srvc') === 'F' ? 'Facility' : f(row, 'Place_Of_Srvc') === 'O' ? 'Office' : ''
    });
  });
  Object.values(map).forEach(g => g.procedures.sort((a, b) => b.payment - a.payment));
  return Object.values(map).sort((a, b) => b.totalPayment - a.totalPayment);
}

// ─── GROUP BY PROCEDURE ───
// Groups raw CMS rows by HCPCS code (one card per procedure, not per physician).
// Each group aggregates total services, payment, and beneficiaries across all
// providers in the fetched rows, and keeps a provider breakdown sorted by volume.
function groupByProcedure(rows) {
  const map = {};
  rows.forEach(row => {
    const code = (f(row, 'HCPCS_Cd') || 'unknown').toUpperCase();
    if (!map[code]) {
      map[code] = {
        code,
        desc: f(row, 'HCPCS_Desc') || '',
        drugIndicator: f(row, 'HCPCS_Drug_Ind') || '',
        totalServices: 0,
        totalPayment: 0,
        totalBeneficiaries: 0,
        providerMap: {}
      };
    }
    const g = map[code];
    if (!g.desc) g.desc = f(row, 'HCPCS_Desc') || '';
    const pymt = getPayment(row);
    const srvcs = getServices(row);
    const benes = getBenes(row);
    g.totalServices += srvcs;
    g.totalPayment += pymt;
    g.totalBeneficiaries += benes;

    const npi = f(row, 'Rndrng_NPI') || 'unknown';
    if (!g.providerMap[npi]) {
      g.providerMap[npi] = {
        npi,
        name: getProviderName(row),
        specialty: f(row, 'Rndrng_Prvdr_Type') || '',
        location: getLocation(row),
        state: f(row, 'Rndrng_Prvdr_State_Abrvtn') || '',
        services: 0,
        payment: 0
      };
    }
    g.providerMap[npi].services += srvcs;
    g.providerMap[npi].payment += pymt;
  });

  return Object.values(map).map(g => {
    const providers = Object.values(g.providerMap).sort((a, b) => b.services - a.services);
    const { providerMap, ...rest } = g;
    return { ...rest, providers, providerCount: providers.length };
  }).sort((a, b) => b.totalServices - a.totalServices);
}

// ─── TREND / TAM PURE HELPERS ───
// Extracted from the app layer so the market-sizing math is unit-tested rather
// than trapped in the HTML. A "trend" is an array of yearly entries shaped
// { year, services, payment, ok } (ok=false means that year's fetch failed).

// Latest year that actually has data. Returns null if none succeeded.
function latestOkEntry(trend) {
  if (!Array.isArray(trend)) return null;
  for (let i = trend.length - 1; i >= 0; i--) {
    if (trend[i] && trend[i].ok) return trend[i];
  }
  return null;
}

// Combine several per-code trends into one yearly series. Only years where
// EVERY provided trend has ok data are marked complete; years missing one or
// more codes are flagged partial (and which codes were missing) so the caller
// can annotate them instead of charting a fake dip.
function combineTrendsByYear(trends) {
  const valid = (trends || []).filter(t => Array.isArray(t && t.trend) || Array.isArray(t));
  // Accept either [{code, trend:[...]}] or [[...entries]] shapes.
  const series = (trends || []).map(t => Array.isArray(t) ? { code: null, trend: t } : t)
    .filter(t => Array.isArray(t.trend));
  const years = {};
  series.forEach(s => s.trend.forEach(e => {
    if (!e) return;
    if (!years[e.year]) years[e.year] = { year: e.year, services: 0, payment: 0, okCodes: 0, missingCodes: [] };
    if (e.ok) {
      years[e.year].services += (e.services || 0);
      years[e.year].payment += (e.payment || 0);
      years[e.year].okCodes += 1;
    } else {
      years[e.year].missingCodes.push(s.code);
    }
  }));
  const total = series.length;
  return Object.values(years)
    .map(y => ({
      year: y.year,
      services: y.services,
      payment: y.payment,
      ok: y.okCodes > 0,
      complete: total > 0 && y.okCodes === total,
      missingCodes: y.missingCodes.filter(Boolean),
    }))
    .sort((a, b) => a.year - b.year);
}

// The TAM model. All money/volume math in one tested place.
//   estTotal      = FFS volume / (share%)         — all-payer procedures
//   estAddressable = estTotal * (portion%)         — device-addressable cases
//   estTAM        = estAddressable * asp           — annual device TAM ($)
// `perCode` entries: { code, services, payment, year }. Guards div-by-zero and
// returns whether the headline mixes data years (codes' latest years differ).
function computeTamModel(perCode, opts) {
  const share = clampPct(opts && opts.share, 40);
  const portion = clampPct(opts && opts.portion, 100);
  const asp = opts && opts.asp > 0 ? opts.asp : null;
  const withData = (perCode || []).filter(c => c && c.year);
  const totalFFS = withData.reduce((s, c) => s + (c.services || 0), 0);
  const totalProfPay = withData.reduce((s, c) => s + (c.payment || 0), 0);
  const estTotal = totalFFS / (share / 100);
  const estAddressable = estTotal * (portion / 100);
  const estTAM = asp ? estAddressable * asp : null;
  const years = withData.map(c => c.year);
  const baseYear = years.length ? Math.max(...years) : null;
  const mixedYears = years.length > 1 && new Set(years).size > 1;
  return {
    share, portion, asp,
    totalFFS, totalProfPay,
    estTotal, estAddressable, estTAM,
    baseYear, mixedYears,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: baseYear,
  };
}

function clampPct(v, dflt) {
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0 || n > 100) return dflt;
  return n;
}

// Aggregate inpatient (DRG) rows into totals. discharges, plus totals derived
// as discharges × per-stay averages (billed covered charges, total payment,
// Medicare payment). One tested place for the hospital-side math.
function aggregateDrgRows(rows) {
  let discharges = 0, billed = 0, paid = 0, mdcrPaid = 0, desc = '';
  (rows || []).forEach(r => {
    const d = getDischarges(r);
    discharges += d;
    billed += d * getAvgCoveredCharge(r);
    paid += d * getAvgTotalPayment(r);
    mdcrPaid += d * getAvgMedicarePayment(r);
    if (!desc) desc = f(r, 'DRG_Desc') || '';
  });
  return { discharges, billed, paid, mdcrPaid, desc };
}

// Safe average — returns null (render as "—") when the denominator is 0,
// instead of showing the full numerator as if it were an average.
function safeAvg(total, count) {
  return count > 0 ? total / count : null;
}

// ─── BULK CODE PARSING ───
// Parses a pasted list of HCPCS/CPT codes separated by commas, semicolons,
// spaces, or newlines. Codes are 4–5 alphanumerics (CPT "27447", category III
// "0232T", HCPCS Level II "J1885"). Returns { codes, invalid }: valid codes
// uppercased and deduped in input order, everything else kept for error display.
function parseCodes(input) {
  const tokens = String(input || '').split(/[\s,;]+/).filter(Boolean);
  const codes = [];
  const invalid = [];
  const seen = new Set();
  tokens.forEach(t => {
    const c = t.toUpperCase();
    if (/^[A-Z0-9]{4,5}$/.test(c)) {
      if (!seen.has(c)) { seen.add(c); codes.push(c); }
    } else {
      invalid.push(t);
    }
  });
  return { codes, invalid };
}

// ─── MS-DRG PARSING ───
// Parses a pasted list of MS-DRG codes (1–3 digits, e.g. "025, 026, 27").
// DRGs are zero-padded to 3 digits as published by CMS. Returns { codes, invalid }.
function parseDrgs(input) {
  const tokens = String(input || '').split(/[\s,;]+/).filter(Boolean);
  const codes = [];
  const invalid = [];
  const seen = new Set();
  tokens.forEach(t => {
    if (/^\d{1,3}$/.test(t)) {
      const c = t.padStart(3, '0');
      if (!seen.has(c)) { seen.add(c); codes.push(c); }
    } else {
      invalid.push(t);
    }
  });
  return { codes, invalid };
}

// ─── HOSPITAL (INPATIENT) FIELD ACCESSORS ───
// The Medicare Inpatient Hospitals datasets report per-DRG averages; totals are
// derived as discharges × average. Field spellings have varied across dataset
// years, so try the known variants.
function getDischarges(row) {
  const v = parseFloat(f(row, 'Tot_Dschrgs'));
  if (!isNaN(v)) return v;
  const v2 = parseFloat(f(row, 'Tot_Dschrg_Cnt'));
  if (!isNaN(v2)) return v2;
  return 0;
}

function getAvgCoveredCharge(row) {
  for (const name of ['Avg_Submtd_Cvrd_Chrg', 'Avg_Sbmtd_Cvrd_Chrg', 'Avg_Cvrd_Chrg']) {
    const v = parseFloat(f(row, name));
    if (!isNaN(v)) return v;
  }
  return 0;
}

function getAvgTotalPayment(row) {
  const v = parseFloat(f(row, 'Avg_Tot_Pymt_Amt'));
  return isNaN(v) ? 0 : v;
}

function getAvgMedicarePayment(row) {
  const v = parseFloat(f(row, 'Avg_Mdcr_Pymt_Amt'));
  return isNaN(v) ? 0 : v;
}

// ─── CODE LOOKUP / DICTIONARY SEARCH ───
// Keyword search + cross-vocabulary suggestion over code dictionaries
// ({code, desc, ...} items). Used by the Code Lookup tab for CPT/HCPCS and
// MS-DRG dictionaries derived from the CMS national datasets.

const LOOKUP_STOPWORDS = new Set([
  'and', 'or', 'of', 'the', 'with', 'without', 'for', 'to', 'a', 'an',
  'other', 'procedure', 'procedures', 'service', 'services', 'on', 'in',
  'by', 'less', 'more', 'than', 'each', 'per', 'using', 'into', 'from',
  'not', 'at', 'w', 'wo', 'cc', 'mcc', 'w/cc', 'w/mcc', 'cm', 'mm',
  'first', 'any', 'all', 'one', 'via', 'when'
]);

// Lowercase word tokens, stopwords and short tokens removed.
function tokenizeMedical(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !LOOKUP_STOPWORDS.has(t));
}

// True when a token matches text: substring match, with a prefix-stem
// fallback for long tokens so "cranioplasty" matches "craniotomy".
function tokenMatches(token, text) {
  if (text.includes(token)) return true;
  if (token.length > 6 && text.includes(token.slice(0, 6))) return true;
  return false;
}

// Keyword search: every query token must match the item's description (or
// prefix-match its code). Preserves the input ordering of `items` (dictionaries
// are pre-sorted by volume), so results rank by real-world usage.
function searchDict(items, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = tokenizeMedical(q);
  const out = [];
  for (const item of items) {
    const desc = (item.desc || '').toLowerCase();
    const code = (item.code || '').toLowerCase();
    const hit = tokens.length
      ? tokens.every(t => tokenMatches(t, desc) || code.startsWith(t))
      : code.startsWith(q);
    if (hit) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Cross-vocabulary suggestion: score target items by how many tokens of the
// source description they match. Heuristic by design — there is no official
// CPT↔DRG crosswalk (DRGs are assigned from ICD-10-PCS + diagnoses) — so
// callers must label results as suggestions to verify.
function crossSuggest(sourceDesc, targetItems, limit = 10) {
  const tokens = tokenizeMedical(sourceDesc);
  if (!tokens.length) return [];
  const scored = [];
  targetItems.forEach((item, idx) => {
    const desc = (item.desc || '').toLowerCase();
    const score = tokens.reduce((s, t) => s + (tokenMatches(t, desc) ? 1 : 0), 0);
    if (score > 0) scored.push({ item, score, idx });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map(s => ({ ...s.item, matchScore: s.score }));
}

// ─── DATASET VERSION DISCOVERY ───
// data.cms.gov publishes each data year of a dataset as its own version with its
// own UUID. The official machine-readable catalog (https://data.cms.gov/data.json)
// lists them: each matching dataset/distribution carries a `temporal` range
// ("2019-01-01/2019-12-31") and an API URL containing the version UUID.
// This parses that catalog into [{ year, id }] sorted newest-first.
function extractDatasetVersions(catalog, title) {
  const normalize = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const wanted = normalize(title);
  const datasets = (catalog && Array.isArray(catalog.dataset)) ? catalog.dataset : [];
  const uuidFromUrl = url => {
    const m = String(url || '').match(/data-api\/v1\/dataset\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1] : null;
  };
  const yearFrom = (...candidates) => {
    for (const c of candidates) {
      const m = String(c || '').match(/(20\d{2})/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  };

  const byYear = {};
  const record = (year, id) => {
    if (year && id && !byYear[year]) byYear[year] = { year, id };
  };

  datasets.forEach(ds => {
    if (normalize(ds.title) !== wanted) return;
    // Distribution-level entries (one dataset entry, one distribution per year)
    (ds.distribution || []).forEach(dist => {
      const id = uuidFromUrl(dist.accessURL) || uuidFromUrl(dist.downloadURL);
      const year = yearFrom(dist.temporal, dist.title, dist.description);
      record(year, id);
    });
    // Dataset-level entries (one dataset entry per year, same title)
    const dsId = uuidFromUrl(ds.identifier) || uuidFromUrl(ds.accessURL);
    const dsYear = yearFrom(ds.temporal, ds.modified && null); // only temporal is a reliable year signal
    record(dsYear, dsId);
  });

  return Object.values(byYear).sort((a, b) => b.year - a.year);
}

// ─── STATE NAMES ───
// The "by Geography and Service" dataset identifies states by full name
// (Rndrng_Prvdr_Geo_Desc), not abbreviation — this maps between the two.
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico'
};

// ─── CPT CODE BUNDLES ───
// Orthopedic revision procedure codes for the CPT Browser feature.
const CPT_BUNDLES = [
  {
    name: 'Hip Revision',
    codes: [
      { code: '27134', desc: 'Revision total hip arthroplasty — both components with or without autograft or allograft' },
      { code: '27137', desc: 'Revision total hip arthroplasty — acetabular component only, with or without autograft or allograft' },
      { code: '27138', desc: 'Revision total hip arthroplasty — femoral component only, with or without allograft' },
      { code: '27132', desc: 'Conversion of previous hip surgery to total hip arthroplasty' },
    ]
  },
  {
    name: 'Knee Revision',
    codes: [
      { code: '27486', desc: 'Revision of total knee arthroplasty — 1 component' },
      { code: '27487', desc: 'Revision of total knee arthroplasty — femoral and entire tibial component' },
    ]
  },
  {
    name: 'Shoulder Revision',
    codes: [
      { code: '23473', desc: 'Revision of total shoulder arthroplasty — humeral or glenoid component' },
      { code: '23474', desc: 'Revision of total shoulder arthroplasty — both components' },
    ]
  },
  {
    name: 'Ankle Revision',
    codes: [
      { code: '27700', desc: 'Arthroplasty, ankle' },
      { code: '27702', desc: 'Arthroplasty, ankle — with implant (total ankle replacement)' },
      { code: '27703', desc: 'Arthroplasty, ankle — revision of total ankle' },
    ]
  },
  {
    name: 'Complex Reconstruction',
    codes: [
      { code: '27645', desc: 'Radical resection of bone tumor, femur' },
      { code: '27646', desc: 'Radical resection of bone tumor, tibia and fibula' },
      { code: '27097', desc: 'Release of hip flexor, open — iliopsoas, adductor' },
      { code: '23333', desc: 'Removal of foreign body, shoulder; deep' },
    ]
  },
];

// ─── COMPLEXITY SCORE ───
// Composite 0–100 score indicating how likely a provider is to use custom/revision implants.
// Weights: code breadth (40pts) + volume (30pts) + avg payment per service (20pts) + facility ratio (10pts)
function computeComplexityScore(provider) {
  // Breadth: number of distinct procedure codes billed (capped at 5 for max points)
  const breadthScore = Math.min(provider.procedures.length / 5, 1) * 40;

  // Volume: total services, capped at 150 for max points
  const volumeScore = Math.min(provider.totalServices / 150, 1) * 30;

  // Avg payment per service: higher = more complex cases (capped at $5,000)
  const avgPayment = provider.totalPayment / (provider.totalServices || 1);
  const paymentScore = Math.min(avgPayment / 5000, 1) * 20;

  // Facility ratio: procedures done in a facility (hospital/ASC) = higher acuity
  const facilityCount = provider.procedures.filter(p => p.place === 'Facility').length;
  const facilityRatio = provider.procedures.length > 0 ? facilityCount / provider.procedures.length : 0;
  const facilityScore = facilityRatio * 10;

  return Math.round(breadthScore + volumeScore + paymentScore + facilityScore);
}

// ─── TIER ASSIGNMENT ───
// Scores each provider then assigns tiers based on percentile rank within the result set.
// Returns a new array with `score` and `tier` (1/2/3) added to each provider object.
function assignScoresAndTiers(providers) {
  if (!providers.length) return providers;

  // Score everyone
  const scored = providers.map(p => ({ ...p, score: computeComplexityScore(p) }));

  // Sort by score descending so tier cutoffs are percentile-based
  scored.sort((a, b) => b.score - a.score);

  const n = scored.length;
  const tier1Cutoff = Math.ceil(n * 0.2);
  const tier2Cutoff = Math.ceil(n * 0.6);

  return scored.map((p, i) => ({
    ...p,
    tier: i < tier1Cutoff ? 1 : i < tier2Cutoff ? 2 : 3,
  }));
}

// Export for test environments (Node/Vitest). In the browser these are global.
if (typeof module !== 'undefined') {
  module.exports = { f, getPayment, getAvgCharge, getServices, getBenes, getProviderName, getLocation, fmtCurrency, fmtNumber, escapeHtml, groupByProvider, groupByProcedure, parseCodes, parseDrgs, getDischarges, getAvgCoveredCharge, getAvgTotalPayment, getAvgMedicarePayment, tokenizeMedical, searchDict, crossSuggest, latestOkEntry, combineTrendsByYear, computeTamModel, aggregateDrgRows, safeAvg, csvField, toCsvRow, backoffDelay, extractDatasetVersions, STATE_NAMES, CPT_BUNDLES, computeComplexityScore, assignScoresAndTiers };
}
