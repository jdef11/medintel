import { describe, it, expect } from 'vitest';
const {
  f, getPayment, getAvgCharge, getServices, getBenes,
  getProviderName, getLocation, fmtCurrency, fmtNumber,
  escapeHtml, groupByProvider, groupByProcedure, parseCodes, parseDrgs,
  getDischarges, getAvgCoveredCharge, getAvgTotalPayment, getAvgMedicarePayment,
  extractDatasetVersions, STATE_NAMES, CPT_BUNDLES, computeComplexityScore, assignScoresAndTiers
} = require('./medintel-core.js');

// ─── f() — field accessor ───────────────────────────────────────────────────

describe('f()', () => {
  it('returns value for an underscore-keyed field', () => {
    expect(f({ Rndrng_NPI: '1234567890' }, 'Rndrng_NPI')).toBe('1234567890');
  });

  it('falls back to space-separated field name', () => {
    expect(f({ 'Rndrng NPI': '1234567890' }, 'Rndrng_NPI')).toBe('1234567890');
  });

  it('prefers the underscore key when both exist', () => {
    expect(f({ Rndrng_NPI: 'underscore', 'Rndrng NPI': 'space' }, 'Rndrng_NPI')).toBe('underscore');
  });

  it('returns undefined when neither variant exists', () => {
    expect(f({ other_field: 'x' }, 'Rndrng_NPI')).toBeUndefined();
  });

  it('returns falsy values correctly (empty string, 0)', () => {
    expect(f({ Tot_Srvcs: 0 }, 'Tot_Srvcs')).toBe(0);
    expect(f({ HCPCS_Cd: '' }, 'HCPCS_Cd')).toBe('');
  });
});

// ─── getPayment() ────────────────────────────────────────────────────────────

describe('getPayment()', () => {
  it('uses Tot_Mdcr_Pymt_Amt when present and non-zero', () => {
    expect(getPayment({ Tot_Mdcr_Pymt_Amt: '5000', Avg_Mdcr_Pymt_Amt: '100', Tot_Srvcs: '10' })).toBe(5000);
  });

  it('falls back to avg × services when total field is absent', () => {
    expect(getPayment({ Avg_Mdcr_Pymt_Amt: '100', Tot_Srvcs: '10' })).toBe(1000);
  });

  it('falls back to avg × services when total field is zero', () => {
    // A $0 total triggers the fallback — this is the documented edge case
    expect(getPayment({ Tot_Mdcr_Pymt_Amt: '0', Avg_Mdcr_Pymt_Amt: '200', Tot_Srvcs: '5' })).toBe(1000);
  });

  it('uses Tot_Srvcs_Cnt as alternate services field', () => {
    expect(getPayment({ Avg_Mdcr_Pymt_Amt: '50', Tot_Srvcs_Cnt: '4' })).toBe(200);
  });

  it('returns 0 when no usable fields are present', () => {
    expect(getPayment({})).toBe(0);
  });

  it('returns 0 when avg is present but services is absent', () => {
    expect(getPayment({ Avg_Mdcr_Pymt_Amt: '100' })).toBe(0);
  });

  it('works with space-keyed field names', () => {
    expect(getPayment({ 'Tot Mdcr Pymt Amt': '7500' })).toBe(7500);
  });
});

// ─── getAvgCharge() ──────────────────────────────────────────────────────────

describe('getAvgCharge()', () => {
  it('returns Avg_Sbmtd_Chrg when present', () => {
    expect(getAvgCharge({ Avg_Sbmtd_Chrg: '300' })).toBe(300);
  });

  it('falls back to Avg_Sbmtd_Chrg_Amt', () => {
    expect(getAvgCharge({ Avg_Sbmtd_Chrg_Amt: '250' })).toBe(250);
  });

  it('returns 0 when neither field is present', () => {
    expect(getAvgCharge({})).toBe(0);
  });
});

// ─── getServices() ───────────────────────────────────────────────────────────

describe('getServices()', () => {
  it('returns Tot_Srvcs when present', () => {
    expect(getServices({ Tot_Srvcs: '42' })).toBe(42);
  });

  it('falls back to Tot_Srvcs_Cnt', () => {
    expect(getServices({ Tot_Srvcs_Cnt: '17' })).toBe(17);
  });

  it('returns 0 when neither field is present', () => {
    expect(getServices({})).toBe(0);
  });
});

// ─── getBenes() ──────────────────────────────────────────────────────────────

describe('getBenes()', () => {
  it('returns Tot_Benes when present', () => {
    expect(getBenes({ Tot_Benes: '100' })).toBe(100);
  });

  it('falls back to Tot_Bene_Cnt', () => {
    expect(getBenes({ Tot_Bene_Cnt: '88' })).toBe(88);
  });

  it('returns 0 when neither field is present', () => {
    expect(getBenes({})).toBe(0);
  });
});

// ─── getProviderName() ───────────────────────────────────────────────────────

describe('getProviderName()', () => {
  it('returns org name for entity code O', () => {
    expect(getProviderName({
      Rndrng_Prvdr_Ent_Cd: 'O',
      Rndrng_Prvdr_Org_Name: 'General Hospital'
    })).toBe('General Hospital');
  });

  it('falls back to Last_Org_Name for org when Org_Name absent', () => {
    expect(getProviderName({
      Rndrng_Prvdr_Ent_Cd: 'O',
      Rndrng_Prvdr_Last_Org_Name: 'City Clinic'
    })).toBe('City Clinic');
  });

  it('returns "Organization" when org has no name fields', () => {
    expect(getProviderName({ Rndrng_Prvdr_Ent_Cd: 'O' })).toBe('Organization');
  });

  it('assembles first + last name for individuals', () => {
    expect(getProviderName({
      Rndrng_Prvdr_First_Name: 'Jane',
      Rndrng_Prvdr_Last_Org_Name: 'Smith'
    })).toBe('Jane Smith');
  });

  it('includes middle initial when present', () => {
    expect(getProviderName({
      Rndrng_Prvdr_First_Name: 'Jane',
      Rndrng_Prvdr_MI: 'A',
      Rndrng_Prvdr_Last_Org_Name: 'Smith'
    })).toBe('Jane A. Smith');
  });

  it('appends credentials when present', () => {
    expect(getProviderName({
      Rndrng_Prvdr_First_Name: 'Jane',
      Rndrng_Prvdr_Last_Org_Name: 'Smith',
      Rndrng_Prvdr_Crdntls: 'MD'
    })).toBe('Jane Smith, MD');
  });

  it('returns last name only when no first name', () => {
    expect(getProviderName({ Rndrng_Prvdr_Last_Org_Name: 'Smith' })).toBe('Smith');
  });

  it('returns "Unknown Provider" when all name fields are absent', () => {
    expect(getProviderName({})).toBe('Unknown Provider');
  });
});

// ─── getLocation() ───────────────────────────────────────────────────────────

describe('getLocation()', () => {
  it('returns city, state, zip joined', () => {
    expect(getLocation({
      Rndrng_Prvdr_City: 'BOSTON',
      Rndrng_Prvdr_State_Abrvtn: 'MA',
      Rndrng_Prvdr_Zip5: '02101'
    })).toBe('BOSTON, MA, 02101');
  });

  it('skips missing parts — state only', () => {
    expect(getLocation({ Rndrng_Prvdr_State_Abrvtn: 'CA' })).toBe('CA');
  });

  it('skips missing parts — city and state', () => {
    expect(getLocation({ Rndrng_Prvdr_City: 'AUSTIN', Rndrng_Prvdr_State_Abrvtn: 'TX' })).toBe('AUSTIN, TX');
  });

  it('returns em-dash when all location fields are absent', () => {
    expect(getLocation({})).toBe('—');
  });
});

// ─── fmtCurrency() ───────────────────────────────────────────────────────────

describe('fmtCurrency()', () => {
  it('formats a positive integer', () => {
    expect(fmtCurrency(1000)).toBe('$1,000');
  });

  it('formats a float (rounds to 0 decimal places)', () => {
    expect(fmtCurrency(1234.56)).toBe('$1,235');
  });

  it('formats zero', () => {
    expect(fmtCurrency(0)).toBe('$0');
  });

  it('formats negative values', () => {
    expect(fmtCurrency(-500)).toBe('-$500');
  });

  it('returns em-dash for NaN', () => {
    expect(fmtCurrency('not a number')).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(fmtCurrency(undefined)).toBe('—');
  });
});

// ─── fmtNumber() ─────────────────────────────────────────────────────────────

describe('fmtNumber()', () => {
  it('formats an integer with commas', () => {
    expect(fmtNumber(1000000)).toBe('1,000,000');
  });

  it('formats zero', () => {
    expect(fmtNumber(0)).toBe('0');
  });

  it('returns em-dash for NaN', () => {
    expect(fmtNumber('abc')).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(fmtNumber(undefined)).toBe('—');
  });
});

// ─── escapeHtml() ────────────────────────────────────────────────────────────

describe('escapeHtml()', () => {
  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('handles null without throwing', () => {
    expect(() => escapeHtml(null)).not.toThrow();
    expect(escapeHtml(null)).toBe('');
  });

  it('handles undefined without throwing', () => {
    expect(() => escapeHtml(undefined)).not.toThrow();
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('neutralises a basic XSS payload', () => {
    const result = escapeHtml('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });
});

// ─── groupByProvider() ───────────────────────────────────────────────────────

describe('groupByProvider()', () => {
  const row1 = {
    Rndrng_NPI: '1111111111',
    Rndrng_Prvdr_First_Name: 'Alice',
    Rndrng_Prvdr_Last_Org_Name: 'Jones',
    Rndrng_Prvdr_Type: 'Cardiology',
    Rndrng_Prvdr_City: 'BOSTON',
    Rndrng_Prvdr_State_Abrvtn: 'MA',
    Rndrng_Prvdr_Zip5: '02101',
    Tot_Mdcr_Pymt_Amt: '3000',
    Tot_Srvcs: '30',
    Tot_Benes: '25',
    HCPCS_Cd: '93000',
    HCPCS_Desc: 'ECG',
    Avg_Sbmtd_Chrg: '150',
    Place_Of_Srvc: 'O'
  };

  const row2 = {
    Rndrng_NPI: '1111111111',  // same NPI as row1
    Rndrng_Prvdr_First_Name: 'Alice',
    Rndrng_Prvdr_Last_Org_Name: 'Jones',
    Rndrng_Prvdr_Type: 'Cardiology',
    Rndrng_Prvdr_City: 'BOSTON',
    Rndrng_Prvdr_State_Abrvtn: 'MA',
    Rndrng_Prvdr_Zip5: '02101',
    Tot_Mdcr_Pymt_Amt: '7000',
    Tot_Srvcs: '70',
    Tot_Benes: '60',
    HCPCS_Cd: '93306',
    HCPCS_Desc: 'Echo',
    Avg_Sbmtd_Chrg: '400',
    Place_Of_Srvc: 'F'
  };

  const row3 = {
    Rndrng_NPI: '2222222222',  // different provider
    Rndrng_Prvdr_First_Name: 'Bob',
    Rndrng_Prvdr_Last_Org_Name: 'Smith',
    Rndrng_Prvdr_Type: 'Neurology',
    Rndrng_Prvdr_City: 'DALLAS',
    Rndrng_Prvdr_State_Abrvtn: 'TX',
    Rndrng_Prvdr_Zip5: '75201',
    Tot_Mdcr_Pymt_Amt: '15000',
    Tot_Srvcs: '100',
    Tot_Benes: '90',
    HCPCS_Cd: '95910',
    HCPCS_Desc: 'Nerve study',
    Avg_Sbmtd_Chrg: '500',
    Place_Of_Srvc: 'O'
  };

  it('returns one entry per unique NPI', () => {
    const result = groupByProvider([row1, row2, row3]);
    expect(result).toHaveLength(2);
  });

  it('sums payments across rows for the same NPI', () => {
    const result = groupByProvider([row1, row2]);
    expect(result[0].totalPayment).toBe(10000);
  });

  it('sums services across rows for the same NPI', () => {
    const result = groupByProvider([row1, row2]);
    expect(result[0].totalServices).toBe(100);
  });

  it('sums beneficiaries across rows for the same NPI', () => {
    const result = groupByProvider([row1, row2]);
    expect(result[0].totalBeneficiaries).toBe(85);
  });

  it('sorts providers by totalPayment descending', () => {
    const result = groupByProvider([row1, row2, row3]);
    // row3 (Bob, $15k) should come before Alice ($10k)
    expect(result[0].npi).toBe('2222222222');
    expect(result[1].npi).toBe('1111111111');
  });

  it('sorts each provider\'s procedures by payment descending', () => {
    const result = groupByProvider([row1, row2]);
    const procs = result[0].procedures;
    expect(procs[0].payment).toBeGreaterThanOrEqual(procs[1].payment);
  });

  it('maps Place_Of_Srvc F → Facility and O → Office', () => {
    const result = groupByProvider([row1, row2]);
    const procs = result[0].procedures;
    const ecg = procs.find(p => p.code === '93000');
    const echo = procs.find(p => p.code === '93306');
    expect(ecg.place).toBe('Office');
    expect(echo.place).toBe('Facility');
  });

  it('returns empty array for empty input', () => {
    expect(groupByProvider([])).toEqual([]);
  });

  it('handles rows with missing NPI using "unknown" key', () => {
    const result = groupByProvider([{ Tot_Mdcr_Pymt_Amt: '100' }]);
    expect(result[0].npi).toBe('unknown');
  });

  it('correctly identifies organization entity type', () => {
    const orgRow = { ...row1, Rndrng_Prvdr_Ent_Cd: 'O', Rndrng_Prvdr_Org_Name: 'Acme Hospital' };
    const result = groupByProvider([orgRow]);
    expect(result[0].entityType).toBe('Organization');
  });

  it('correctly identifies individual entity type', () => {
    const result = groupByProvider([row1]);
    expect(result[0].entityType).toBe('Individual');
  });
});

// ─── CPT_BUNDLES ─────────────────────────────────────────────────────────────

describe('CPT_BUNDLES', () => {
  it('contains at least 4 bundles', () => {
    expect(CPT_BUNDLES.length).toBeGreaterThanOrEqual(4);
  });

  it('every bundle has a name and non-empty codes array', () => {
    CPT_BUNDLES.forEach(b => {
      expect(typeof b.name).toBe('string');
      expect(b.codes.length).toBeGreaterThan(0);
    });
  });

  it('every code entry has a code string and desc string', () => {
    CPT_BUNDLES.flatMap(b => b.codes).forEach(c => {
      expect(typeof c.code).toBe('string');
      expect(c.code.length).toBeGreaterThan(0);
      expect(typeof c.desc).toBe('string');
      expect(c.desc.length).toBeGreaterThan(0);
    });
  });

  it('Hip Revision bundle includes 27134, 27137, 27138', () => {
    const hip = CPT_BUNDLES.find(b => b.name === 'Hip Revision');
    const codes = hip.codes.map(c => c.code);
    expect(codes).toContain('27134');
    expect(codes).toContain('27137');
    expect(codes).toContain('27138');
  });

  it('Knee Revision bundle includes 27486 and 27487', () => {
    const knee = CPT_BUNDLES.find(b => b.name === 'Knee Revision');
    const codes = knee.codes.map(c => c.code);
    expect(codes).toContain('27486');
    expect(codes).toContain('27487');
  });

  it('has no duplicate codes within a single bundle', () => {
    CPT_BUNDLES.forEach(b => {
      const codes = b.codes.map(c => c.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });
  });
});

// ─── computeComplexityScore() ────────────────────────────────────────────────

describe('computeComplexityScore()', () => {
  const makeProvider = (overrides) => ({
    procedures: [{ place: 'Facility' }, { place: 'Facility' }],
    totalServices: 100,
    totalPayment: 50000,
    totalBeneficiaries: 80,
    ...overrides
  });

  it('returns a number between 0 and 100', () => {
    const score = computeComplexityScore(makeProvider());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('a provider with more procedure codes scores higher than one with fewer', () => {
    const fewer = makeProvider({ procedures: [{ place: 'Facility' }] });
    const more = makeProvider({ procedures: [
      { place: 'Facility' }, { place: 'Facility' }, { place: 'Facility' },
      { place: 'Facility' }, { place: 'Facility' }
    ]});
    expect(computeComplexityScore(more)).toBeGreaterThan(computeComplexityScore(fewer));
  });

  it('a higher-volume provider scores higher than a lower-volume one (all else equal)', () => {
    const low  = makeProvider({ totalServices: 10,  totalPayment: 5000 });
    const high = makeProvider({ totalServices: 150, totalPayment: 75000 });
    expect(computeComplexityScore(high)).toBeGreaterThan(computeComplexityScore(low));
  });

  it('all-facility provider scores higher than all-office provider', () => {
    const allFacility = makeProvider({ procedures: [{ place: 'Facility' }, { place: 'Facility' }] });
    const allOffice   = makeProvider({ procedures: [{ place: 'Office' },   { place: 'Office' }] });
    expect(computeComplexityScore(allFacility)).toBeGreaterThan(computeComplexityScore(allOffice));
  });

  it('returns 0 for a provider with no data', () => {
    expect(computeComplexityScore({ procedures: [], totalServices: 0, totalPayment: 0, totalBeneficiaries: 0 })).toBe(0);
  });

  it('returns an integer (rounded)', () => {
    const score = computeComplexityScore(makeProvider());
    expect(score).toBe(Math.round(score));
  });
});

// ─── assignScoresAndTiers() ──────────────────────────────────────────────────

describe('assignScoresAndTiers()', () => {
  const makeProvider = (npi, services, payment, procs) => ({
    npi,
    procedures: procs || [{ place: 'Facility' }, { place: 'Facility' }],
    totalServices: services,
    totalPayment: payment,
    totalBeneficiaries: Math.floor(services * 0.8),
  });

  it('returns the same number of providers', () => {
    const providers = [makeProvider('A', 100, 50000), makeProvider('B', 50, 20000)];
    expect(assignScoresAndTiers(providers)).toHaveLength(2);
  });

  it('adds a score property to every provider', () => {
    const result = assignScoresAndTiers([makeProvider('A', 100, 50000)]);
    expect(typeof result[0].score).toBe('number');
  });

  it('adds a tier property (1, 2, or 3) to every provider', () => {
    const providers = Array.from({ length: 10 }, (_, i) =>
      makeProvider(String(i), (i + 1) * 10, (i + 1) * 5000)
    );
    const result = assignScoresAndTiers(providers);
    result.forEach(p => {
      expect([1, 2, 3]).toContain(p.tier);
    });
  });

  it('assigns Tier 1 to the top 20% of providers by score', () => {
    const providers = Array.from({ length: 10 }, (_, i) =>
      makeProvider(String(i), (i + 1) * 15, (i + 1) * 7500)
    );
    const result = assignScoresAndTiers(providers);
    const tier1 = result.filter(p => p.tier === 1);
    expect(tier1.length).toBe(Math.ceil(10 * 0.2));
  });

  it('the highest-scoring provider is Tier 1', () => {
    const providers = [
      makeProvider('low',  10,  5000,  [{ place: 'Office' }]),
      makeProvider('high', 150, 80000, [{ place: 'Facility' }, { place: 'Facility' }, { place: 'Facility' }, { place: 'Facility' }, { place: 'Facility' }]),
    ];
    const result = assignScoresAndTiers(providers);
    const highProvider = result.find(p => p.npi === 'high');
    expect(highProvider.tier).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(assignScoresAndTiers([])).toEqual([]);
  });

  it('single provider is Tier 1', () => {
    const result = assignScoresAndTiers([makeProvider('A', 100, 50000)]);
    expect(result[0].tier).toBe(1);
  });
});

// ─── groupByProcedure() ──────────────────────────────────────────────────────

describe('groupByProcedure()', () => {
  const makeRow = (npi, code, services, avgPayment, extra = {}) => ({
    Rndrng_NPI: npi,
    Rndrng_Prvdr_Last_Org_Name: `Provider${npi}`,
    Rndrng_Prvdr_Type: 'Orthopedic Surgery',
    Rndrng_Prvdr_State_Abrvtn: 'TX',
    HCPCS_Cd: code,
    HCPCS_Desc: `Description for ${code}`,
    Tot_Srvcs: String(services),
    Avg_Mdcr_Pymt_Amt: String(avgPayment),
    Tot_Benes: '20',
    ...extra,
  });

  it('groups rows by HCPCS code, not provider', () => {
    const rows = [
      makeRow('1', '27447', 10, 100),
      makeRow('2', '27447', 5, 100),
      makeRow('1', '27130', 3, 200),
    ];
    const groups = groupByProcedure(rows);
    expect(groups.length).toBe(2);
    const knee = groups.find(g => g.code === '27447');
    expect(knee.totalServices).toBe(15);
    expect(knee.providerCount).toBe(2);
  });

  it('sums payment across providers within a code', () => {
    const rows = [
      makeRow('1', '27447', 10, 100), // 1000
      makeRow('2', '27447', 5, 100),  // 500
    ];
    const groups = groupByProcedure(rows);
    expect(groups[0].totalPayment).toBe(1500);
  });

  it('sorts groups by total services descending', () => {
    const rows = [
      makeRow('1', 'LOW', 2, 100),
      makeRow('1', 'HIGH', 50, 100),
      makeRow('1', 'MID', 10, 100),
    ];
    const codes = groupByProcedure(rows).map(g => g.code);
    expect(codes).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('sorts providers within a group by services descending', () => {
    const rows = [
      makeRow('small', '27447', 2, 100),
      makeRow('big', '27447', 40, 100),
    ];
    const providers = groupByProcedure(rows)[0].providers;
    expect(providers[0].npi).toBe('big');
    expect(providers[1].npi).toBe('small');
  });

  it('merges duplicate provider+code rows (e.g. facility vs office place of service)', () => {
    const rows = [
      makeRow('1', '27447', 10, 100, { Place_Of_Srvc: 'F' }),
      makeRow('1', '27447', 4, 100, { Place_Of_Srvc: 'O' }),
    ];
    const g = groupByProcedure(rows)[0];
    expect(g.providerCount).toBe(1);
    expect(g.providers[0].services).toBe(14);
    expect(g.totalServices).toBe(14);
  });

  it('normalizes codes to uppercase', () => {
    const rows = [makeRow('1', 'g0447', 5, 10), makeRow('2', 'G0447', 5, 10)];
    const groups = groupByProcedure(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].code).toBe('G0447');
  });

  it('handles space-separated field names (CMS variant)', () => {
    const rows = [{
      'Rndrng NPI': '1', 'HCPCS Cd': '27447', 'HCPCS Desc': 'Knee',
      'Tot Srvcs': '7', 'Avg Mdcr Pymt Amt': '100', 'Tot Benes': '12',
      'Rndrng Prvdr Last Org Name': 'Smith',
    }];
    const g = groupByProcedure(rows)[0];
    expect(g.code).toBe('27447');
    expect(g.totalServices).toBe(7);
  });

  it('returns empty array for empty input', () => {
    expect(groupByProcedure([])).toEqual([]);
  });
});

// ─── extractDatasetVersions() ────────────────────────────────────────────────

describe('extractDatasetVersions()', () => {
  const TITLE = 'Medicare Physician & Other Practitioners - by Provider and Service';
  const uuid = n => `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`;

  it('extracts year/UUID pairs from distribution temporal ranges', () => {
    const catalog = { dataset: [{
      title: TITLE,
      distribution: [
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(1)}/data`, temporal: '2021-01-01/2021-12-31' },
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(2)}/data`, temporal: '2022-01-01/2022-12-31' },
      ],
    }]};
    const versions = extractDatasetVersions(catalog, TITLE);
    expect(versions).toEqual([
      { year: 2022, id: uuid(2) },
      { year: 2021, id: uuid(1) },
    ]);
  });

  it('matches titles case-insensitively with collapsed whitespace', () => {
    const catalog = { dataset: [{
      title: '  medicare physician & other practitioners - BY provider AND service ',
      distribution: [
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(3)}/data`, temporal: '2020-01-01/2020-12-31' },
      ],
    }]};
    expect(extractDatasetVersions(catalog, TITLE).length).toBe(1);
  });

  it('ignores datasets with other titles', () => {
    const catalog = { dataset: [{
      title: 'Some Other Dataset',
      distribution: [
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(4)}/data`, temporal: '2020-01-01/2020-12-31' },
      ],
    }]};
    expect(extractDatasetVersions(catalog, TITLE)).toEqual([]);
  });

  it('skips distributions without an API UUID (e.g. CSV downloads)', () => {
    const catalog = { dataset: [{
      title: TITLE,
      distribution: [
        { downloadURL: 'https://data.cms.gov/sites/default/files/file.csv', temporal: '2019-01-01/2019-12-31' },
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(5)}/data`, temporal: '2019-01-01/2019-12-31' },
      ],
    }]};
    expect(extractDatasetVersions(catalog, TITLE)).toEqual([{ year: 2019, id: uuid(5) }]);
  });

  it('supports one-dataset-entry-per-year catalogs via dataset-level identifier', () => {
    const catalog = { dataset: [
      { title: TITLE, temporal: '2018-01-01/2018-12-31', identifier: `https://data.cms.gov/data-api/v1/dataset/${uuid(6)}/data-viewer` },
      { title: TITLE, temporal: '2017-01-01/2017-12-31', identifier: `https://data.cms.gov/data-api/v1/dataset/${uuid(7)}/data-viewer` },
    ]};
    const versions = extractDatasetVersions(catalog, TITLE);
    expect(versions.map(v => v.year)).toEqual([2018, 2017]);
  });

  it('dedupes multiple entries for the same year', () => {
    const catalog = { dataset: [{
      title: TITLE,
      distribution: [
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(8)}/data`, temporal: '2023-01-01/2023-12-31' },
        { accessURL: `https://data.cms.gov/data-api/v1/dataset/${uuid(9)}/data`, description: 'Also 2023', temporal: '2023-01-01/2023-12-31' },
      ],
    }]};
    expect(extractDatasetVersions(catalog, TITLE).length).toBe(1);
  });

  it('returns empty array for a missing or malformed catalog', () => {
    expect(extractDatasetVersions(null, TITLE)).toEqual([]);
    expect(extractDatasetVersions({}, TITLE)).toEqual([]);
    expect(extractDatasetVersions({ dataset: 'nope' }, TITLE)).toEqual([]);
  });
});

// ─── STATE_NAMES ─────────────────────────────────────────────────────────────

describe('STATE_NAMES', () => {
  it('maps every state abbreviation used by the app, plus DC and PR', () => {
    expect(Object.keys(STATE_NAMES).length).toBe(52);
    expect(STATE_NAMES.TX).toBe('Texas');
    expect(STATE_NAMES.DC).toBe('District of Columbia');
  });
});

// ─── parseCodes() ────────────────────────────────────────────────────────────

describe('parseCodes()', () => {
  it('parses comma-separated codes', () => {
    expect(parseCodes('27447, 27130, 22551').codes).toEqual(['27447', '27130', '22551']);
  });

  it('parses space- and newline-separated codes', () => {
    expect(parseCodes('27447 27130\n22551\r\nJ1885').codes).toEqual(['27447', '27130', '22551', 'J1885']);
  });

  it('parses semicolon-separated codes and mixed delimiters', () => {
    expect(parseCodes('27447;27130, 22551').codes).toEqual(['27447', '27130', '22551']);
  });

  it('uppercases codes (HCPCS Level II, category III)', () => {
    expect(parseCodes('j1885 0232t').codes).toEqual(['J1885', '0232T']);
  });

  it('dedupes while preserving input order', () => {
    expect(parseCodes('27447, 27130, 27447').codes).toEqual(['27447', '27130']);
  });

  it('collects invalid tokens without dropping valid ones', () => {
    const r = parseCodes('27447, knee-replacement, 271309999, 27130');
    expect(r.codes).toEqual(['27447', '27130']);
    expect(r.invalid).toEqual(['knee-replacement', '271309999']);
  });

  it('accepts 4-character codes', () => {
    expect(parseCodes('0232').codes).toEqual(['0232']);
  });

  it('rejects tokens shorter than 4 or longer than 5 characters', () => {
    const r = parseCodes('271 274471');
    expect(r.codes).toEqual([]);
    expect(r.invalid).toEqual(['271', '274471']);
  });

  it('returns empty results for empty/undefined input', () => {
    expect(parseCodes('').codes).toEqual([]);
    expect(parseCodes('').invalid).toEqual([]);
    expect(parseCodes(undefined).codes).toEqual([]);
    expect(parseCodes('  \n ,, ').codes).toEqual([]);
  });
});

// ─── parseDrgs() ─────────────────────────────────────────────────────────────

describe('parseDrgs()', () => {
  it('parses comma/space-separated DRG codes and zero-pads to 3 digits', () => {
    expect(parseDrgs('025, 026 27').codes).toEqual(['025', '026', '027']);
  });

  it('dedupes equivalent padded/unpadded codes', () => {
    expect(parseDrgs('25, 025').codes).toEqual(['025']);
  });

  it('collects invalid tokens', () => {
    const r = parseDrgs('025, DRG25, 1234');
    expect(r.codes).toEqual(['025']);
    expect(r.invalid).toEqual(['DRG25', '1234']);
  });

  it('returns empty results for empty input', () => {
    expect(parseDrgs('')).toEqual({ codes: [], invalid: [] });
  });
});

// ─── Hospital (inpatient) field accessors ────────────────────────────────────

describe('hospital accessors', () => {
  it('getDischarges reads Tot_Dschrgs and space variant', () => {
    expect(getDischarges({ Tot_Dschrgs: '42' })).toBe(42);
    expect(getDischarges({ 'Tot Dschrgs': '17' })).toBe(17);
    expect(getDischarges({})).toBe(0);
  });

  it('getAvgCoveredCharge tries known spelling variants', () => {
    expect(getAvgCoveredCharge({ Avg_Submtd_Cvrd_Chrg: '120000.5' })).toBe(120000.5);
    expect(getAvgCoveredCharge({ Avg_Sbmtd_Cvrd_Chrg: '99000' })).toBe(99000);
    expect(getAvgCoveredCharge({})).toBe(0);
  });

  it('getAvgTotalPayment / getAvgMedicarePayment read their fields', () => {
    expect(getAvgTotalPayment({ Avg_Tot_Pymt_Amt: '30000' })).toBe(30000);
    expect(getAvgMedicarePayment({ Avg_Mdcr_Pymt_Amt: '25000' })).toBe(25000);
    expect(getAvgTotalPayment({})).toBe(0);
    expect(getAvgMedicarePayment({})).toBe(0);
  });
});
