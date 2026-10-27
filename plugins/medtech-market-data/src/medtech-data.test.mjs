// Offline tests for the pure parts of medtech-data.mjs. Live API behavior is
// checked by running the CLI (see the plugin README's "Checking it works").
import { describe, it, expect } from 'vitest';
import { buildCatalogIndex, buildDataApiFilter, nationalFromSingleAge, parseCsv, parseIn, parseWhere, popestYearCode, stripFdaBulk, sumPopestCounties, truncateLongStrings } from './medtech-data.mjs';

describe('parseWhere', () => {
  it.each([
    ['HCPCS_Cd=27447', { path: 'HCPCS_Cd', op: '=', value: '27447' }],
    ['Rndrng_Prvdr_Ent_Cd!=O', { path: 'Rndrng_Prvdr_Ent_Cd', op: '<>', value: 'O' }],
    ['Rndrng_Prvdr_Type~ortho', { path: 'Rndrng_Prvdr_Type', op: 'CONTAINS', value: 'ortho' }],
    ['HCPCS_Cd^274', { path: 'HCPCS_Cd', op: 'STARTS_WITH', value: '274' }],
    ['Tot_Srvcs>=500', { path: 'Tot_Srvcs', op: '>=', value: '500' }],
    ['Tot_Srvcs<10', { path: 'Tot_Srvcs', op: '<', value: '10' }],
  ])('%s', (expr, want) => expect(parseWhere(expr)).toEqual(want));

  it('keeps "=" inside the value', () => {
    expect(parseWhere('Col=a=b')).toEqual({ path: 'Col', op: '=', value: 'a=b' });
  });

  it('rejects an expression with no operator', () => {
    expect(() => parseWhere('HCPCS_Cd')).toThrow(/can't parse/);
  });
});

describe('parseIn', () => {
  it('splits and trims values', () => {
    expect(parseIn('HCPCS_Cd=27447, 27130 ,')).toEqual({ path: 'HCPCS_Cd', op: 'IN', value: ['27447', '27130'] });
  });
  it('rejects a list with no values', () => {
    expect(() => parseIn('HCPCS_Cd=')).toThrow(/no values/);
  });
});

describe('buildDataApiFilter', () => {
  it('emits a single condition without a group', () => {
    expect(buildDataApiFilter([{ path: 'HCPCS_Cd', op: '=', value: '27447' }]))
      .toBe('filter[c0][condition][path]=HCPCS_Cd&filter[c0][condition][operator]=%3D&filter[c0][condition][value]=27447');
  });

  it('ANDs 2+ conditions through an explicit group (a bare list has been OR-ed by CMS)', () => {
    const f = buildDataApiFilter([
      { path: 'HCPCS_Cd', op: '=', value: '27447' },
      { path: 'Rndrng_Prvdr_State_Abrvtn', op: '=', value: 'TX' },
    ]);
    expect(f).toContain('filter[g][group][conjunction]=AND');
    expect(f).toContain('filter[c0][condition][memberOf]=g');
    expect(f).toContain('filter[c1][condition][memberOf]=g');
  });

  it('repeats value[] for IN', () => {
    const f = buildDataApiFilter([{ path: 'HCPCS_Cd', op: 'IN', value: ['27447', '27130'] }]);
    expect(f).toContain('filter[c0][condition][value][]=27447&filter[c0][condition][value][]=27130');
  });

  it('URL-encodes values', () => {
    expect(buildDataApiFilter([{ path: 'X', op: 'CONTAINS', value: 'a&b c' }])).toContain('value]=a%26b%20c');
  });
});

describe('buildCatalogIndex', () => {
  const api = id => ({ accessURL: `https://data.cms.gov/data-api/v1/dataset/${id}/data` });
  const ID = n => `00000000-0000-0000-0000-00000000000${n}`;

  it('reads the DCAT-US 3.0 shape: year from temporal, not the title date; pinned UUID over "latest"', () => {
    const idx = buildCatalogIndex({ dataset: [
      { title: 'Fam : 2026-05-01', inSeries: [{ title: 'Fam' }], temporal: [{ startDate: '2024-01-01', endDate: '2024-12-31' }],
        distribution: [{ ...api(ID(1)), description: 'latest' }, api(ID(2))] },
      { title: 'Fam : 2025-05-01', inSeries: [{ title: 'Fam' }], temporal: [{ startDate: '2023-01-01' }], distribution: [api(ID(3))] },
    ] });
    expect(idx.Fam).toEqual([{ year: 2024, id: ID(2) }, { year: 2023, id: ID(3) }]);
  });

  it('keeps "by Provider" and "by Provider and Service" apart', () => {
    const idx = buildCatalogIndex({ dataset: [
      { title: 'X - by Provider : 2026-01-01', temporal: [{ startDate: '2024-01-01' }], distribution: [api(ID(4))] },
      { title: 'X - by Provider and Service : 2026-01-01', temporal: [{ startDate: '2024-01-01' }], distribution: [api(ID(5))] },
    ] });
    expect(idx['X - by Provider'][0].id).toBe(ID(4));
    expect(idx['X - by Provider and Service'][0].id).toBe(ID(5));
  });

  it('still reads the legacy one-entry-per-family shape', () => {
    const idx = buildCatalogIndex({ dataset: [
      { title: 'Legacy', distribution: [{ ...api(ID(6)), temporal: '2022-01-01/2022-12-31' }, { ...api(ID(7)), temporal: '2021-01-01/2021-12-31' }] },
    ] });
    expect(idx.Legacy.map(v => v.year)).toEqual([2022, 2021]);
  });

  it('drops families with no data-api distribution', () => {
    expect(buildCatalogIndex({ dataset: [{ title: 'Download only', temporal: [{ startDate: '2024-01-01' }], distribution: [{ downloadURL: 'https://x/y.csv' }] }] })).toEqual({});
  });
});

describe('stripFdaBulk', () => {
  it('replaces bulky arrays inside openfda blocks with counts, and leaves the record itself alone', () => {
    const rec = { k_number: 'K1', k_numbers: ['K2'], openfda: { device_name: 'Knee', registration_number: ['1', '2'], fei_number: ['3'], k_number: ['K1', 'K9'] },
      device: [{ openfda: { device_name: 'Hip', pma_number: ['P1'] } }], registration_number: 'kept' };
    expect(stripFdaBulk(rec)).toEqual({ k_number: 'K1', k_numbers: ['K2'],
      openfda: { device_name: 'Knee', registration_number_count: 2, fei_number_count: 1, k_number_count: 2 },
      device: [{ openfda: { device_name: 'Hip', pma_number_count: 1 } }], registration_number: 'kept' });
  });
});

describe('truncateLongStrings', () => {
  it('truncates long strings visibly and leaves short ones and non-strings alone', () => {
    const out = truncateLongStrings({ code_info: 'x'.repeat(30), short: 'ok', n: 5, list: ['y'.repeat(12)] }, 10);
    expect(out.code_info).toBe('x'.repeat(10) + '… [truncated 20 more chars; use --full]');
    expect(out.list[0]).toBe('y'.repeat(10) + '… [truncated 2 more chars; use --full]');
    expect(out.short).toBe('ok');
    expect(out.n).toBe(5);
  });
});

describe('Census population estimates (popest)', () => {
  it('parseCsv handles CRLF, quoted fields with commas and escaped quotes, and a trailing newline', () => {
    const csv = 'A,B\r\n1,"x, ""y"""\r\n2,z\n';
    expect(parseCsv(csv)).toEqual([{ A: '1', B: 'x, "y"' }, { A: '2', B: 'z' }]);
  });

  it('maps years to county-file YEAR codes (1 = April 2020 base, 2 = July 2020 ...)', () => {
    expect(popestYearCode('base', 2025)).toBe(1);
    expect(popestYearCode(2020, 2025)).toBe(2);
    expect(popestYearCode('2025', 2025)).toBe(7);
    expect(popestYearCode(2026, 2025)).toBeNull();
    expect(popestYearCode(2019, 2025)).toBeNull();
  });

  it('sums county rows into a state total', () => {
    const rows = [{ POPESTIMATE: '100', AGE65PLUS_TOT: '20', AGE85PLUS_TOT: '3' }, { POPESTIMATE: '50', AGE65PLUS_TOT: '10', AGE85PLUS_TOT: '1' }];
    expect(sumPopestCounties(rows)).toEqual({ total_pop: 150, pop_65_plus: 30, pop_85_plus: 4 });
  });

  it('builds national 65+/85+ from single-year-of-age rows: total sex only, 100 = 100+, 999 row excluded from sums', () => {
    const rows = [
      { SEX: '0', AGE: '64', P: '10' }, { SEX: '0', AGE: '65', P: '5' }, { SEX: '0', AGE: '85', P: '2' },
      { SEX: '0', AGE: '100', P: '1' }, { SEX: '0', AGE: '999', P: '18' }, { SEX: '1', AGE: '65', P: '99' },
    ];
    expect(nationalFromSingleAge(rows, 'P')).toEqual({ total_pop: 18, pop_65_plus: 8, pop_85_plus: 3 });
  });
});

describe('plugin build', () => {
  it('every skill carries an up-to-date CLI copy and ground rules, with valid frontmatter', async () => {
    const { plan } = await import('../build.mjs');
    const { problems, writes, skills } = plan();
    expect(problems).toEqual([]);
    expect(writes.map(w => w.path)).toEqual([]); // non-empty → run `node plugins/medtech-market-data/build.mjs`
    expect(skills.length).toBeGreaterThanOrEqual(7);
  });
});
