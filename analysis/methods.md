# Methods — Medicare cartilage-procedure proxy (CY2016–CY2024)

**This is NOT the analysis originally requested.** The brief asked for ICD-10-CM diagnosis encounters from AHRQ HCUPnet. That was not achievable (see "Why HCUPnet was not used"); on instruction ("Start with Medicare only" → "CMS public Medicare data") this run uses CMS public Medicare data instead. Those data contain **procedure codes, not diagnoses**, so every number here is a **procedure-volume proxy for treated cartilage defects in Medicare FFS**, not a count of encounters with a cartilage-defect diagnosis.

## 1. Why HCUPnet was not used (findings reported before this pivot)
- No documented API or bulk export found (only an Excel "Download Data" button on visualizations). Based on fetched page summaries, not exhaustive review — confirm with hcup@ahrq.gov.
- robots.txt (`hcup-us.ahrq.gov`, `datatools.ahrq.gov`) disallows only `/_archive/`, `/permission_test/`, `/wp-admin/`, `/wp-includes/`. The HCUPnet DUA covers re-identification, linkage, contact, and "small numbers of observations ≤10"; it is **silent** on automated access → classed "unclear"; nothing was automated against HCUPnet.
- HCUPnet states individual ICD-9-CM / ICD-10-CM/PCS code queries "are no longer offered" (code-level data require purchase via the HCUP Central Distributor). NASS was not listed among HCUPnet databases (NIS, KID, NEDS, NRD were). Supported years not confirmed.
- Not run: HCUPnet queries, CCSR mapping, principal vs. all-listed diagnosis, age/sex/payer breakdowns. **None of the diagnosis-code families in the brief (M93.2-, M94.2-, M22.4-, M94.8X-, M94.9, M24.1-, S83.3-; expanded M23.4-/M24.0-/M87.-) are represented in this deliverable.**

## 2. Access method used (CMS)
- Source: CMS "Medicare Physician & Other Practitioners – by Geography and Service", public data.cms.gov data-api, no authentication. Per-year dataset UUIDs were taken from the CMS catalog (`https://data.cms.gov/data.json`, saved in `versions.json`); years 2016–2024 (2024 = latest version in the catalog on 2026-10-09). 2015 excluded as instructed.
- Public API use; no terms or robots restriction was reviewed beyond CMS's open-data publication (**not separately reviewed — I did not read data.cms.gov's terms/robots.txt for this run; flag if you need that for compliance**).
- Script `fetch-cms.mjs`: one request per (year × HCPCS code), filter `Rndrng_Prvdr_Geo_Lvl=National` and `HCPCS_Cd=<code>`, ≥3.5 s between requests, 117 requests, all HTTP 200. Every request is in `raw/query-log.jsonl` (also sheet `query_log`); raw responses are `raw/Q###.json`. `query_id` in the results table keys to these.
- `build_results.py` turns raw files into `results.xlsx`. No values are computed, imputed or interpolated.

## 3. Code list and tiers (judgment call — needs clinical/coding review)
I chose 13 HCPCS codes by searching CMS descriptors for "cartilage" and by my own recall of knee/ankle/hip cartilage-restoration and chondroplasty codes. **I did not verify codes or descriptors against the AMA CPT code book.** My recall was wrong in places (see below), so the table carries only CMS's own descriptor text (`cms_descriptor`); the sheet `code_list` shows my unverified working labels beside CMS's text. Tiers are descriptor-based groupings:
- **Tier A — cartilage graft/implant codes (closest proxy for resurfacing candidates):** 29866, 29867, 27412, 27415, 27416, 28446.
  - 27412 returned **no row in any year** (not found, or suppressed — indistinguishable).
  - CMS descriptors for 27415/27416/28446 say "cartilage cells" implantation; this differs from my recalled CPT meanings, so treat these descriptors as authoritative for this table and verify against CPT before relying on them.
- **Tier B — arthroscopic knee repair by drilling/scraping/bone graft:** 29879, 29885, 29886, 29887.
- **Tier C — cartilage shaving/debridement:** 29877, G0289, 29862 (hip). These are mostly degenerative/meniscal-adjacent work and will overstate focal-defect treatment.
- Excluded: meniscectomy/meniscus repair (e.g., 29880–29883, 27403), by judgment, even though CMS descriptors say "cartilage"; shoulder/wrist/other-joint and nasal/airway cartilage codes.
- **Tiers must not be summed into one "core" figure** without a decision on which tiers belong in the market definition.

## 4. Measures and fields
- `measure` = services (`Tot_Srvcs`), beneficiaries (`Tot_Benes`, distinct per code × place row), rendering_providers (`Tot_Rndrng_Prvdrs`). Beneficiaries and providers **must not be summed across place of service or codes** (overlap).
- `breakdown_var` = place_of_service: **F** (facility: hospital outpatient, ASC, inpatient, other facility POS) and **O** (office / non-facility). This is the only breakdown the source supports at national level in my pulls; **age, sex, and expected payer are not available**; state-level exists in the dataset but was not pulled (outside the requested breakdowns).
- `setting` column holds the data source label, not NASS/NIS/NEDS. Place of service is the closest analog to ambulatory-vs-inpatient, but F combines hospital outpatient departments, ASCs and inpatient professional services and cannot be split.
- `dx_position` = n/a. `std_error` = n/a: the source is complete FFS claims (no sampling variance published).
- Columns beyond the brief's list: `measure`, `hcpcs_code`, `cms_descriptor`, `source_dataset_uuid` (needed so each estimate is unambiguous and traceable).

## 5. Suppression
CMS withholds cells with ≤10 beneficiaries. A missing row is recorded as `estimate="suppressed"`, `suppressed_flag=TRUE` — **never zero**. The source cannot distinguish a suppressed cell from truly zero claims, so "suppressed" here means "not reported (suppressed or absent)". 285 of 702 rows are suppressed. Totals across codes that include suppressed cells are **lower bounds**; I did not back-calculate or bound suppressed cells.
- Tier A office (O) rows are suppressed for every code and year.

## 6. Coverage limits and caveats
1. **Medicare fee-for-service only.** Excludes Medicare Advantage, Medicaid, commercial, self-pay. Cartilage-defect treatment is concentrated in patients under 65, so Medicare FFS is a small, age-skewed slice of the market; **these figures cannot be scaled to a national market without an external ratio** (not supplied here; I did not invent one).
2. **Professional claims, services not patients.** Counts are billed professional services by physicians/practitioners (and some facility-based POS). Not hospital facility claims, not unique patients.
3. **Procedure proxy, not diagnosis.** Procedures reflect treated, coded cases, not prevalence or encounters with the diagnosis; chondroplasty may be billed for non-cartilage-defect indications.
4. **CPT-to-descriptor uncertainty** (section 3); code list unvalidated.
5. **COVID years:** 2020–2021 volumes are depressed in all tiers; do not read the decline as pure trend.
6. **Data-year labeling:** each dataset is one calendar year (CY) of claims as published by CMS (2024 version). I did not check CMS revisions after the catalog snapshot.
7. Values are CMS-published and unmodified except cast to numbers.

## 7. Files
`results.xlsx` (sheets: results, query_log, code_list), `raw/`, `versions.json`, `fetch-cms.mjs`, `build_results.py`, `summary.md`.
