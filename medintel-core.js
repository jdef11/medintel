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

// ─── XSS PREVENTION ───
// DOM-based escaping — safe and spec-compliant.
// In Node/test environments this is shimmed; in browsers it uses the real DOM.
function escapeHtml(str) {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
  // Minimal shim for Node/test environments
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  module.exports = { f, getPayment, getAvgCharge, getServices, getBenes, getProviderName, getLocation, fmtCurrency, fmtNumber, escapeHtml, groupByProvider, CPT_BUNDLES, computeComplexityScore, assignScoresAndTiers };
}
