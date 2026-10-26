---
name: cms-api
description: Query CMS public healthcare data APIs directly — Medicare claims datasets on data.cms.gov (physician/practitioner procedure volume and payments by NPI or geography, inpatient hospital MS-DRG discharges and payments, DMEPOS supplier and referring-provider data), the data.json catalog (dataset year→UUID), the Provider Data Catalog (clinician practice/PAC affiliations, hospital affiliations, hospital info and star ratings), and the NPPES NPI Registry. Use whenever a task needs real CMS/Medicare numbers, a provider's NPI or specialty, procedure (HCPCS/CPT) or DRG volume, top billers for a code, or hospital/practice affiliations, instead of guessing or web-searching. Includes a zero-dependency Node CLI that enforces the API's silent-failure traps.
---

# CMS API

All four sources are free, public, and need no key. Use the bundled CLI unless you have a reason not to: it resolves the data year to the right dataset UUID, validates column names before querying, ANDs multiple filters explicitly, paginates, and turns the APIs' silent failures into errors.

```bash
CMS="node <this-skill-dir>/scripts/cms.mjs"   # Node 18+
$CMS help
```

Data goes to stdout (`--format json|csv|ndjson`); progress, row counts, dataset/year/UUID, and warnings go to stderr. Always report the dataset title and data year (CY) alongside any number you give the user.

## Workflow

1. **Pick the dataset.** Use the alias table below, or `$CMS datasets --search <words>` for anything else in the catalog (~100 families: Part D prescribers, post-acute care, hospice, etc.).
2. **Get exact column names.** Run `$CMS columns <dataset>`, or read [references/datasets.md](references/datasets.md) for the common ones. Names are case-sensitive in filters and differ between datasets.
3. **Count first.** Run `$CMS query <dataset> --where ... --count` before pulling rows. It's one cheap request and tells you whether to page.
4. **Pull rows.** Use `--columns` to keep output small and `--sort -Col` to get top-N server-side.

```bash
# Top 10 knee-replacement (CPT 27447) surgeons in Texas, CY2023
$CMS query provider --year 2023 --where HCPCS_Cd=27447 --where Rndrng_Prvdr_State_Abrvtn=TX \
  --columns Rndrng_NPI,Rndrng_Prvdr_Last_Org_Name,Rndrng_Prvdr_First_Name,Rndrng_Prvdr_City,Tot_Srvcs,Avg_Mdcr_Pymt_Amt \
  --sort -Tot_Srvcs --limit 10 --format csv

# National procedure volume for a code family (not subject to the ≤10-beneficiary redaction)
$CMS query geography --where Rndrng_Prvdr_Geo_Lvl=National --in HCPCS_Cd=27447,27130 --format csv

# MS-DRG 470 national discharges and payments
$CMS query inpGeo --where Rndrng_Prvdr_Geo_Lvl=National --where DRG_Cd=470

# A provider's true distinct-beneficiary count and totals
$CMS query provSummary --where Rndrng_NPI=1548269731

# Who orders a DME code (DMEPOS referring providers): note HCPCS_CD, capital D
$CMS query dmeReferring --where HCPCS_CD=E0601 --sort -Tot_Suplr_Srvcs --limit 25

# NPI lookup
$CMS npi --last_name 'coop*' --first_name paul --state DC

# Hospital affiliations for a batch of NPIs, then hospital names
$CMS pd facilityAff --in npi=1548269731,1003000126 --where facility_type=Hospital
$CMS pd hospitals --in facility_id=090004,010001 --columns facility_id,facility_name,hospital_overall_rating
```

## Dataset aliases (data-api)

| Alias | Catalog title | One row per |
|---|---|---|
| `provider` | Medicare Physician & Other Practitioners - by Provider and Service | NPI × HCPCS × place of service |
| `provSummary` | Medicare Physician & Other Practitioners - by Provider | NPI (true distinct `Tot_Benes`) |
| `geography` | Medicare Physician & Other Practitioners - by Geography and Service | geo level × HCPCS × place of service |
| `inpProvider` | Medicare Inpatient Hospitals - by Provider and Service | hospital CCN × MS-DRG |
| `inpGeo` | Medicare Inpatient Hospitals - by Geography and Service | geo level × MS-DRG |
| `dmeGeo` | Medicare Durable Medical Equipment, Devices & Supplies - by Geography and Service | geo level × HCPCS |
| `dmeReferring` | Medicare Durable Medical Equipment, Devices & Supplies - by Referring Provider and Service | referring NPI × HCPCS |

Each calendar year is a separate dataset with its own UUID. `--year` picks one (the default is the newest). Data lags about two years: in late 2026 the newest year is CY2024.

## Rules the CLI enforces, and that you must follow if you hand-build URLs

These were verified against the live APIs on 2026-10-26.

**data-api** (`https://data.cms.gov/data-api/v1/dataset/{uuid}/data`)
- **An unknown column in `filter`, `sort`, or `column` is silently ignored.** You get unfiltered rows, or the full 9.7M-row count, with HTTP 200. This is the most dangerous trap. Check names against `/data-viewer?size=0` → `meta.headers` first.
- Filters match column names case-sensitively (`HCPCS_Cd`, but DME Referring uses `HCPCS_CD`). Values are case-insensitive (`CONTAINS ortho` matches "Orthopedic Surgery").
- For 2+ conditions, declare an explicit AND group: `filter[g][group][conjunction]=AND` plus `filter[cN][condition][memberOf]=g` on each condition. MedIntel observed bare condition lists being combined as OR. A 2026-10-26 test came back AND, but don't rely on it.
- Condition syntax: `filter[c0][condition][path]=Col&filter[c0][condition][operator]=OP&filter[c0][condition][value]=V`. Verified operators: `=`, `<>`, `CONTAINS`, `STARTS_WITH`, `IN` (repeat `value[]=`), and `>` `>=` `<` `<=`, which compare numerically. The shorthand `filter[Col]=V` also works for equality.
- `keyword=` is a full-text search across all columns, not a code filter. `keyword=27447` returned one more row than `HCPCS_Cd=27447`. Use filters.
- `/data/stats?<same filters>` returns `{found_rows, total_rows}` for counting.
- `size` up to 5000 works reliably, and the CLI pages at 1000 with `offset`. A `size=8000` request returned 6500 rows with no error, so don't trust oversized pages.
- `sort=-Col` sorts descending, numerically for numeric columns. `column=a,b` projects.
- Numbers come back as strings (`"12624"`). Convert them before doing math.
- With curl, pass `-g`. Otherwise curl treats the `[ ]` in filter params as glob ranges and fails with "bad range in URL".

**data.json catalog** (`https://data.cms.gov/data.json`, ~18 MB, DCAT-US 3.0)
- There is one dataset entry per data year, titled `"<family> : <release date>"` and linked by `inSeries[].title`. **The date in the title is the release date, not the data year.** The data year is in `temporal[0].startDate`.
- The newest year has two API distributions: a moving `latest` alias and a pinned UUID. Use the pinned one if you'll store the UUID.
- To confirm which year a UUID serves, read `/data-viewer?size=0` → `meta.data_file_name`. `_D24_` or `_DY24_` means CY2024.

**Provider Data Catalog** (`https://data.cms.gov/provider-data/api/1/datastore/query/{distributionId}`)
- **Send a `User-Agent` that names your client.** The CMS edge (Akamai) answers Node's default `User-Agent` ("node") with an HTML 403 "Access Denied". curl's default passes. The CLI sends `cms-api-skill/1.0 (+repo URL)`. Never imitate a browser.
- **Query by distribution UUID, not `/{datasetId}/0`.** On 2026-10-26 the edge 403'd `/datastore/query/mj5m-pzi6/0` for every client, while `/datastore/query/{distributionId}` served the same rows with the same parameters. Get the distribution id from `/provider-data/api/1/metastore/schemas/dataset/items/{datasetId}?show-reference-ids` → `distribution[0].identifier`. It changes when CMS refreshes the data, so look it up each run; the CLI does this. Don't hardcode one.
- Responses are wrapped: `{results:[...], count, schema}`.
- Conditions use `conditions[i][property]`, `conditions[i][value]`, and `conditions[i][operator]`. Operators include `=`, `<>`, `<`, `>`, `LIKE` (use `%text%`; case-insensitive), and `in`.
- **`in` values must be repeated `conditions[i][value][]=` params.** A comma-joined string returns `{"results":[],"count":0}` silently.
- An unknown column returns HTTP 400 "Column not found". This host fails loudly, unlike data-api.
- `limit` max is 1500 (400 above that). Paginate with `offset`. Select fields with `properties[]=`. Sort with `sorts[0][property]` and `sorts[0][order]=asc|desc`.
- **Each query takes about 13-15 s, regardless of how many rows you ask for.** Batch 50-100 NPIs per `in` query. Many small queries are slower and get throttled.
- **Any other HTML "Access Denied" 403** is a block on the client or network, not a data answer. The CLI reports it as such. Check the two points above, then stop: don't loop on retries or disguise the client; tell the user.

**NPPES** (`https://npiregistry.cms.hhs.gov/api/?version=2.1`)
- **Errors come back as HTTP 200 with `{"Errors":[...]}`**, for example for `state` alone or a non-10-digit NPI. Always check for the `Errors` key.
- `limit` is capped at 200 silently. Paginate with `skip`. There is no grand total.
- A trailing `*` wildcard works after 2+ characters. `enumeration_type` is `NPI-1` (individual) or `NPI-2` (organization).
- This is a live snapshot with no history, unlike the claims datasets.

## Interpreting the data correctly

Flag these to the user whenever they affect an answer:

- **Medicare fee-for-service only.** No Medicare Advantage (now more than half of beneficiaries), Medicaid, or commercial claims. Real-world procedure volume is materially higher.
- **Privacy redaction.** By-Provider rows are suppressed when they have ≤10 beneficiaries. Summing provider rows undercounts. For true totals, use the `geography` or `inpGeo` National/State rows, which are not subject to that floor.
- **`Tot_Benes` is distinct per row.** Summing it across a provider's codes or places of service overcounts unique patients. Use `provSummary` for a provider's distinct count.
- **Place of service:** `Place_Of_Srvc` `F` = facility, `O` = office. A code usually has both rows, so filter or sum deliberately.
- **Per-row averages vary for the same code.** In CY2023 Texas, one 27447 row averaged $961 per service and another $123. That's likely assistant-surgeon or modifier billing, though not verified. Don't treat one provider's `Avg_Mdcr_Pymt_Amt` as the fee-schedule rate.
- **Payment math:** total paid ≈ `Avg_Mdcr_Pymt_Amt × Tot_Srvcs` (physician) or `Avg_Mdcr_Pymt_Amt × Tot_Dschrgs` (inpatient).
- **Geography levels:** `Rndrng_Prvdr_Geo_Lvl` is `National` or `State`, and states use full names in `Rndrng_Prvdr_Geo_Desc`. The DMEPOS geography file uses `Rfrg_Prvdr_Geo_Lvl` instead.
- **Entity type:** `Rndrng_Prvdr_Ent_Cd` is `I` for individuals and `O` for organizations. Add `--where Rndrng_Prvdr_Ent_Cd!=O` when you want people only.
- **Level II HCPCS** codes (`A/B/E/K/L` and similar) billed by DME suppliers are absent from the physician files. Use `dmeGeo` and `dmeReferring` for them. `C` codes (OPPS pass-through) have no per-code public data.

## Without the CLI

If you can't run Node, build the same URLs with curl (`curl -gsS`) and follow the rules above. The CLI's `--url` flag prints every request URL it makes, which is useful for showing a user exactly what was queried.
