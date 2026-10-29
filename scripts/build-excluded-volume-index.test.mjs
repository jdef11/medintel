// Offline tests for scripts/build-excluded-volume-index.mjs. The real build
// streams CMS's ~3 GB yearly CSVs; here the parsing, aggregation, validation
// and shard bookkeeping run on small in-memory inputs.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  csvSourcesFromCatalog, parseCsvLine, createRecordSplitter, shardKey, createYearAggregator,
  validateYear, nationalPatientDays, mergeYearIntoShards, removeYearFromShards, planYears,
  REQUIRED_COLUMNS, SENTINEL_CODE,
} from './build-excluded-volume-index.mjs';

const require = createRequire(import.meta.url);
const { VOLUME_EXCLUDED_PROVIDER_TYPES } = require('../medintel-core.js');

const TITLE = 'Medicare Physician & Other Practitioners - by Provider and Service';
const HEADER = 'Rndrng_NPI,Rndrng_Prvdr_State_Abrvtn,Rndrng_Prvdr_Type,HCPCS_Cd,HCPCS_Desc,Tot_Benes,Tot_Srvcs,Tot_Bene_Day_Srvcs,Avg_Mdcr_Pymt_Amt';

describe('csvSourcesFromCatalog()', () => {
  const entry = (title, start, url, extra = {}) => ({
    title, temporal: [{ startDate: start, endDate: '' }],
    distribution: [{ downloadURL: 'https://data.cms.gov/data-api/v1/dataset/x/data' }, { downloadURL: url, mediaType: 'text/csv' }],
    ...extra,
  });
  it('takes the year from temporal, not the release date in the title, newest first', () => {
    const catalog = { dataset: [
      entry(`${TITLE} : 2023-12-31`, '2023-01-01', 'https://x/D23.csv'),
      entry(`${TITLE} : 2024-12-01`, '2024-01-01', 'https://x/D24.csv'),
      entry('Some Other Series', '2024-01-01', 'https://x/other.csv', { inSeries: [{ title: TITLE }] }),
    ] };
    expect(csvSourcesFromCatalog(catalog, TITLE)).toEqual([
      { year: 2024, url: 'https://x/D24.csv' },
      { year: 2023, url: 'https://x/D23.csv' },
    ]);
  });
  it('does not match a longer family title', () => {
    const catalog = { dataset: [entry(`${TITLE} and More : 2024-12-01`, '2024-01-01', 'https://x/no.csv')] };
    expect(csvSourcesFromCatalog(catalog, TITLE)).toEqual([]);
  });
});

describe('parseCsvLine() / createRecordSplitter()', () => {
  it('handles quoted commas, escaped quotes and CRLF', () => {
    expect(parseCsvLine('a,"b, c","say ""hi""",d\r')).toEqual(['a', 'b, c', 'say "hi"', 'd']);
  });
  it('keeps a quoted newline inside its record across chunk boundaries', () => {
    const recs = [];
    const sp = createRecordSplitter((r) => recs.push(r));
    sp.push('h1,h2\nx,"line one');
    sp.push('\nline two"\ny,');
    sp.push('z');
    sp.end();
    expect(recs).toEqual(['h1,h2', 'x,"line one\nline two"', 'y,z']);
  });
});

describe('createYearAggregator()', () => {
  const feed = (lines) => {
    const agg = createYearAggregator();
    lines.forEach((l) => agg.record(l));
    return agg.result();
  };
  it('sums patient-days and payment for excluded types only, nationally and by state', () => {
    const r = feed([
      HEADER,
      '1,TX,Orthopedic Surgery,27447,"Total knee, replacement",50,52,51,1000',
      '2,TX,Physician Assistant,27447,"Total knee, replacement",30,30,30,140',
      '3,CA,Nurse Practitioner,27447,TKA,20,20,20,140',
      '4,CA,Ambulatory Surgical Center,27447,TKA,12,12,12,9000',
      '5,CA,physician assistant,63650,Leads,15,30,15,100',
    ]);
    expect(r.rows).toBe(5);
    expect(r.matched).toBe(4);
    expect(r.codes['27447'].US).toEqual([62, 30 * 140 + 20 * 140 + 12 * 9000]);
    expect(r.codes['27447'].TX).toEqual([30, 4200]);
    expect(r.codes['27447'].CA).toEqual([32, 2800 + 108000]);
    // Patient-days, not billed units; payment stays avg × billed services.
    expect(r.codes['63650'].US).toEqual([15, 3000]);
  });
  it('fails loudly when a required column is missing', () => {
    const agg = createYearAggregator();
    expect(() => agg.record('Rndrng_NPI,HCPCS_Cd')).toThrow(/missing column/);
  });
  it('requires every column the app relies on', () => {
    expect(REQUIRED_COLUMNS).toEqual(expect.arrayContaining(['Rndrng_Prvdr_Type', 'HCPCS_Cd', 'Tot_Bene_Day_Srvcs', 'Tot_Srvcs', 'Avg_Mdcr_Pymt_Amt', 'Rndrng_Prvdr_State_Abrvtn']));
  });
});

describe('validateYear()', () => {
  const codes = { [SENTINEL_CODE]: { US: [1000, 1] }, '99213': { US: [9000, 1] } };
  it('passes a plausible year', () => {
    expect(validateYear(2024, { codes, matched: 20000 }, { year: 2023, nationalPatientDays: 9000 })).toEqual([]);
  });
  it('flags too few matched rows, a missing sentinel and a jump against the neighbor year', () => {
    const problems = validateYear(2024, { codes: { '99213': { US: [100, 1] } }, matched: 5 }, { year: 2023, nationalPatientDays: 10000 });
    expect(problems.join('\n')).toMatch(/only 5/);
    expect(problems.join('\n')).toMatch(/sentinel code 27447/);
    expect(problems.join('\n')).toMatch(/0\.01×/);
  });
  it('nationalPatientDays sums the US entries', () => {
    expect(nationalPatientDays(codes)).toBe(10000);
  });
});

describe('shard bookkeeping', () => {
  it('shards by the first 3 characters, merges years, and removes a year cleanly', () => {
    expect(shardKey('27447')).toBe('274');
    const shards = {};
    mergeYearIntoShards(shards, 2023, { '27447': { US: [1, 2] } });
    mergeYearIntoShards(shards, 2024, { '27447': { US: [3, 4] }, '27446': { US: [5, 6] } });
    expect(shards['274']).toEqual({ '27447': { 2023: { US: [1, 2] }, 2024: { US: [3, 4] } }, '27446': { 2024: { US: [5, 6] } } });
    removeYearFromShards(shards, 2024);
    expect(shards['274']).toEqual({ '27447': { 2023: { US: [1, 2] } } });
  });
});

describe('planYears()', () => {
  const sources = [{ year: 2024, url: 'u24' }, { year: 2023, url: 'u23' }, { year: 2022, url: 'u22' }];
  const manifest = { types: VOLUME_EXCLUDED_PROVIDER_TYPES.slice(), years: { 2023: { source: 'u23' }, 2022: { source: 'old22' } } };
  it('builds missing and re-released years only', () => {
    expect(planYears(sources, manifest, {}).map((s) => s.year)).toEqual([2024, 2022]);
  });
  it('honors --years and --force', () => {
    expect(planYears(sources, manifest, { years: [2023] }).map((s) => s.year)).toEqual([2023]);
    expect(planYears(sources, manifest, { force: true }).map((s) => s.year)).toEqual([2024, 2023, 2022]);
  });
  it('rebuilds everything when the excluded provider types changed', () => {
    expect(planYears(sources, { ...manifest, types: ['Physician Assistant'] }, {}).length).toBe(3);
  });
});
