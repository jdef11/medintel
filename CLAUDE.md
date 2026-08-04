# CLAUDE.md — MedIntel Codebase Guide

## Project Overview

**MedIntel** is a single-file, zero-dependency web application for medical device sales intelligence. It searches two free, public CMS government APIs to help sales teams identify high-value Medicare providers by procedure volume and payment data.

- **Architecture:** Client-side only — pure vanilla HTML, CSS, and JavaScript
- **Entry point:** `cms-sales-intel (4).html` (the entire application lives in this one file)
- **No build step, no package manager, no framework**

---

## Repository Structure

```
/
├── cms-sales-intel (4).html      # The entire UI (HTML/CSS + inline app script) — the deployed app
├── medintel-core.js              # Pure, framework-free logic — unit-tested; loaded by the HTML via <script src>
├── medintel-core.test.js         # Vitest suite for medintel-core.js (231 tests)
├── scripts/live-smoke.mjs        # Manual live-CMS verification script (npm run smoke)
├── package.json                  # Dev-only tooling: vitest. Not a runtime dependency of the app itself
├── .github/workflows/deploy.yml  # Runs `npm test`, then publishes the HTML to GitHub Pages
├── README.md                      # User-facing documentation and example searches
├── LICENSE                        # MIT License
└── CLAUDE.md                      # This file
```

The app itself ships as a single static file with zero runtime dependencies — `package.json`/`vitest` exist only to test the pure logic extracted into `medintel-core.js`, not to build or bundle anything.

---

## Commands

```bash
npm install          # one-time — installs vitest only, nothing runtime-related
npm test              # run the full medintel-core.test.js suite once (vitest run)
npm run test:watch    # vitest in watch mode while iterating
npm run smoke          # node scripts/live-smoke.mjs — hits the REAL CMS API (network + Node 18+ required)
npx serve .            # serve the repo locally, then open http://localhost:3000/cms-sales-intel%20(4).html
```

To run a single test or file with Vitest directly: `npx vitest run -t "test name substring"` or `npx vitest run medintel-core.test.js`.

There is no lint/typecheck/build script — the HTML file is edited directly and the browser is the only "build".

---

## Application Architecture

The HTML file is divided into three sections:

### 1. CSS (the `<style>` block in the `<head>`)

Embedded in a `<style>` block. Uses CSS custom properties (variables) defined on `:root` for the entire design system:

- **Colors:** Dark theme — `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-2`, `--text-3`
- **Accent:** `--accent: #3D6EF7` (blue)
- **Status colors:** `--green`, `--amber`, `--red` with `-dim` variants (rgba)
- **Typography:** `DM Sans` (UI), `Instrument Serif` (logo/branding)
- **Border radius tokens:** `--radius: 10px`, `--radius-sm: 6px`

CSS class naming: **kebab-case** (`.result-card`, `.procedures-list`, `.empty-state`)

### 2. HTML (the `<body>` markup)

Two-pane layout:
- **Sidebar** (350px fixed): search tabs, input fields, search button, error box
- **Main area** (scrollable): empty state → results grid → pagination

HTML element IDs: **camelCase** (`searchBtn`, `resultsArea`, `emptyState`)

### 3. JavaScript (the inline `<script>` after `medintel-core.js`)

Embedded in a `<script>` block. No modules, no imports. All functions are global. Key state variables are module-level:

```javascript
let currentTab = 'provider'      // Active search tab
let currentResults = []          // Raw rows for the NPI tab
let allGroupedResults = []       // Grouped+scored providers (CMS tabs)
let procedureGroups = []         // Procedure-grouped results (Procedure tab)
let tamResults = null            // Market TAM tab results
let tamDrgTrendArgs = null       // Deferred DRG trend chart args (see toggleTamDrgDetail)
let displayPage = 0              // Client-side results page (CMS tabs)
let npiPage = 0                  // NPI results page
let isLoading = false            // Prevent double-submit
let searchGen = 0                // Generation token — discards superseded searches
let activeProxyIndex = 0         // Last successful CORS proxy
let selectedYear = ''            // '' = latest; else a specific data year
```

Pagination is client-side (`displayPage` + `prevPage`/`nextPage`) for the CMS tabs; the NPI tab paginates server-side via `executeNpiSearch(offset)` (guarded by `gotoNpiPage`). There is no `currentPage`/`totalFound` — results are grouped in memory and sliced per page.

JavaScript function naming: **camelCase** (`executeSearch`, `groupByProvider`, `exportCSV`)

Constants are UPPER_CASE (`DATASET_ID`, `BASE_URL`, `FETCH_SIZE`, `CORS_PROXIES`).

---

## Search Modes

The nav is three peer destinations plus a demoted utility strip — **not** around the CMS/NPPES data sources underneath, though the `currentTab` values (`provider`/`procedure`/`tam`/`lookup`/`npi`) map directly to them (see "Navigation vs. internal tab ids" below). `provider` and `geography` used to be separate modes (By Name / By Location) hidden behind a picker on "Find Customers," but both queried the same dataset with the same filters and rendered through the same `groupByProvider()`/`renderResults()` path — genuinely redundant, not distinct — so they're merged into one form and the `geography` tab id no longer exists:

- **Find Customers** (`data-tab="provider"`) — CMS Medicare | Last name **or** organization name (separate fields), NPI, specialty, state, city — fill in whichever apply | `Rndrng_Prvdr_Last_Org_Name` CONTAINS + entity-type disambiguation (`Rndrng_Prvdr_Ent_Cd`): last name excludes `'O'` client-side, organization requires `'O'`, mutually exclusive and validated up front; `Rndrng_Prvdr_Type` CONTAINS for specialty; `Rndrng_Prvdr_State_Abrvtn`/`Rndrng_Prvdr_City` for state/city.
- **Find by Procedure** (`data-tab="procedure"`) — CMS Medicare | HCPCS code(s) — bulk paste supported (`parseCodes`, max 30), state | `filter[HCPCS_Cd]` — results grouped **by procedure** (`groupByProcedure`), with per-code multi-year volume trends. The "top providers for this code" sub-table carries Tier 1/2/3 badges via a second `assignScoresAndTiers(groupByProvider(allRows))` pass in `executeSearch()`, so ranking reads the same as Find Customers regardless of entry point. Stays a separate destination from Find Customers because it returns a genuinely different view (one card per *procedure*, not per person) — this is the one true code-search destination; Find Customers has no code field.
- **Size a Market** (`id="navSizeMarket"`, `data-tab="tam"`) — CMS Medicare (Physician Geography/Provider + Inpatient Hospital Geography/Provider datasets) | HCPCS code family (bulk), MS-DRG codes (`parseDrgs`), FFS-share %, addressable %, device ASP | Per-code `fetchTrend` volume, per-DRG `fetchDrgTrend` hospital billing/payments, `fetchDrgHospitals` top hospitals, `groupByProvider` top surgeons; TAM modeled client-side.
- **Utility strip** (`.utility-strip`, always visible, demoted below the nav row) — two helpers, reachable directly or via inline "Look it up" links next to the HCPCS field in Find by Procedure and Size a Market:
  | Utility (`currentTab`) | API | Key Inputs | Query Parameter |
  |-----|-----|-----------|----------------|
  | `lookup` (Look up a code) | CMS national datasets (cached dictionaries) + DMEPOS datasets | Keyword / CPT / HCPCS / MS-DRG | `loadCptDict`/`loadDrgDict` + `searchDict`/`crossSuggest`; Level II codes resolve via `lookupDmeCode`/`lookupDmeReferrers`; rows push codes into other destinations via `addToField` |
  | `npi` (Verify a provider) | NPPES Registry | First/last name, state, city, taxonomy | Direct query params |

### Navigation vs. internal tab ids

- **The nav is three plain, identically-styled buttons sharing one class (`.nav-btn`)** — Find Customers / Find by Procedure / Size a Market — plus the separately-classed utility strip. This is safe specifically because all three are now genuinely *the same kind of thing* (peer destinations); the earlier bugs (three rounds of them) all came from mixing genuinely different tiers — destination, mode, utility — under one shared class or picker. Once Provider+Geography merged, there was no more "mode" tier left to mix in, so three peers sharing a class stopped being a trap.
- `updateDestActive(tab)` is one generic loop over `.nav-btn` — `t.dataset.tab === tab` decides `.active`/`aria-pressed`, no special-casing for any of the three. `updateUtilityActive(tab)` independently handles the two `.tab-utility` links — no shared class with `.nav-btn`.
- **Compatibility**: `provider` survives as Find Customers' tab id (unchanged from before the merge — `TAB_FIELDS.provider` just gained `'cityInput'`), so old `#tab=provider&...` share-links still restore correctly with no compatibility shim. `geography` is gone from `SHAREABLE_TABS` (medintel-core.js) and `TAB_FIELDS` — an old `#tab=geography&...` link fails closed (doesn't restore, no crash) rather than being migrated, since `decodeSearchState` already whitelist-rejects unknown tab ids by design.
- `procedure`'s fields/dispatch/rendering are completely unchanged — it was only ever hidden behind the old mode-picker at the nav level, never altered internally; promoting it to its own nav button required zero changes to `getSearchCriteria()`, `executeSearch()`, or `groupByProcedure()`.
- When merging or splitting a destination in the future, remember to check `fetchAllRows()`'s multi-code state-select branch, `getTypedCodes()`'s per-tab field lookup, and `validateInput()`'s per-tab required-field check — all three have their own `currentTab === '...'` branches independent of `getSearchCriteria()` and are easy to miss.

---

## External APIs

### CMS Medicare Physician & Other Practitioners

```
GET https://data.cms.gov/data-api/v1/dataset/92396110-2aed-4d63-a6a2-5d6207d46a29/data
```

- No authentication required
- Key params: `size`, `offset`, `keyword`, `filter[FIELD_NAME][value]`, `filter[FIELD_NAME][condition]`
- Returns Medicare billing rows: one row per provider+procedure combination
- Results are grouped client-side by `Rndrng_NPI`

**Important:** CMS field names include both underscore-spaced and space-spaced variants in different API responses. The `f(row, fieldName)` helper handles this by trying both `fieldName` and `fieldName.replace(/_/g, ' ')`.

### CMS Medicare Physician & Other Practitioners — by Geography and Service

Pre-aggregated national/state totals per HCPCS code — used by the procedure **volume trend** panel (one small request per data year). States are identified by full name (`Rndrng_Prvdr_Geo_Desc`); use the `STATE_NAMES` map to convert abbreviations.

### CMS Medicare Physician & Other Practitioners — by Provider (summary)

One row per NPI per year with a **true distinct-beneficiary count** (`Tot_Benes`) across all of a provider's services. Used to show accurate "Unique Beneficiaries" on provider cards: `fetchProviderBenes()` fetches the summary row for each provider on the current results page (bounded to ~20/page, cached per NPI/year via `benesCache`) and `patchProviderBenes()` replaces the placeholder. Falls back to the per-procedure sum (footnoted) if the dataset is unreachable. Note: the procedure tab still shows a per-procedure *sum* — no public dataset gives a clean distinct-per-code count for a filtered view.

### Dataset versions / Data Year selector

CMS publishes each calendar year of a dataset as its own version with its own UUID. The app discovers the year→UUID mapping at runtime from the official catalog (`https://data.cms.gov/data.json`) via `extractDatasetVersions()` for seven dataset families (`provider`, `provSummary`, `geography`, `inpProvider`, `inpGeo`, `dmeGeo`, `dmeReferring`), caches it in `localStorage` (`medintel_dataset_versions_v4`, 7-day TTL, shape-validated by `sanitizeVersions()`), and routes searches through `getDatasetBase()`. If the catalog is unreachable, searches fall back to the hardcoded latest-year `DATASET_ID`.

### NPPES NPI Registry

```
GET https://npiregistry.cms.hhs.gov/api/?version=2.1
```

- No authentication required
- Supports CORS natively — no proxy needed in most cases
- Returns provider records with addresses, taxonomies, and credentials

### CORS Proxy Fallback Chain

When running as a local file (`file://`), the app cycles through three proxies:

1. `https://api.allorigins.win/raw?url={encoded_url}`
2. `https://corsproxy.io/?{encoded_url}`
3. `https://api.codetabs.com/v1/proxy?quest={encoded_url}`

The `activeProxyIndex` variable remembers the last successful proxy to avoid re-trying failed ones.

---

## Key Functions Reference

| Function | Purpose |
|----------|---------|
| `init()` | Page load setup — populates state dropdowns, adds Enter key listeners |
| `switchTab(tab)` | Shows/hides field groups, updates tab styling |
| `executeSearch(offset)` | Main search orchestrator — validates, fetches, renders |
| `executeNpiSearch(offset)` | NPI-specific search via NPPES API |
| `getSearchCriteria()` | Declarative `[{path, op, value}]` for the active tab — single source of truth for both the API filter and client-side enforcement |
| `buildApiUrl(offset)` | Constructs CMS API query URL from `getSearchCriteria()` via `buildFilterParams` |
| `buildFilterParams(criteria)` | Emits CMS filter params. **2+ conditions get an explicit `group][conjunction]=AND` with `memberOf`** — a bare condition list is combined as OR by the API |
| `rowMatchesCriteria(row, criteria)` | Client-side AND enforcement (case-insensitive), so displayed rows always satisfy every criterion regardless of API conjunction behavior. Ops: `CONTAINS`, `=`, `!=`. Criterion flags: `clientOnly` (never sent to the API), `lenient` (passes when the column is absent in that dataset year) |
| `corsFetch(url)` | CORS-aware fetch — tries direct then cycles proxies |
| `fetchWithTimeout(url, ms)` | Fetch wrapper with configurable timeout |
| `groupByProvider(rows)` | Aggregates raw rows by NPI, sorts by total payment |
| `groupByProcedure(rows)` | Aggregates raw rows by HCPCS code (procedure tab), sorts by total services |
| `parseCodes(input)` | Parses bulk-pasted HCPCS/CPT code lists → `{codes, invalid}` (4–5 alphanumerics, deduped, uppercased) |
| `extractDatasetVersions(catalog, title)` | Parses data.json catalog into `[{year, id}]` version list |
| `loadDatasetVersions()` | Fetches/caches the catalog, populates the Data Year selector |
| `getDatasetBase()` | Data-API base URL for the selected data year |
| `fetchTrend(code)` / `renderTrend(...)` | Multi-year procedure volume trend via the Geography & Service dataset |
| `fetchProviderTrend(npi)` / `toggleProviderTrend(npi)` | Multi-year per-NPI totals via the Provider & Service dataset versions |
| `renderTrendChart(box, captionHtml, trend)` | **Real SVG line/area chart** (not a bar-in-a-table-row) — one implementation shared by the Procedure tab's per-code trend, the per-provider volume trend, and both Market TAM trend panels. Coordinate/path math is `trendSvgPath()` (pure, in medintel-core.js); the growth callout ("Grew X% since CY——") is `pctChangeAcrossYears()` (same file). Measures `box.clientWidth` to size the chart, so the box must already be visible (`display` other than `none`) when called — see `toggleTamDrgDetail()` for the deferred-render pattern this requires when a chart lives inside a collapsed section |
| `renderProcedureResults()` | Renders procedure-grouped cards (procedure tab); the top-providers sub-table's Tier badges come from `executeSearch()`'s second `assignScoresAndTiers(groupByProvider(allRows))` pass, not from `groupByProcedure` itself |
| `executeTamSearch(codes)` / `renderTamResults()` | Market TAM tab. Renders a hero card first (`.tam-hero` — thesis line, TAM $ figure, trend chart into `#tam-hero-trend`) since that figure is the one thing a rep screenshots into a business case; supporting detail (hospital billing, top hospitals, per-code breakdown, top surgeons) renders as collapsed-by-default sections via `toggleDetail(id)`/`toggleTamDrgDetail()`. Assumptions re-render live |
| `toggleDetail(id)` / `toggleTamDrgDetail()` | Generic collapse/expand for Market TAM's page-level (not per-row) detail sections — `id` matching `detail-btn-${id}`/`detail-${id}`. The DRG variant additionally lazy-renders `#tam-drg-trend` on first open (via the module-level `tamDrgTrendArgs`, set at the end of `renderTamResults()`) since that chart's container starts `display:none` |
| `parseDrgs(input)` / `fetchDrgTrend(drg)` / `fetchDrgHospitals(drgs)` | MS-DRG parsing + inpatient hospital billing/payment totals and top hospitals (Inpatient Hospitals datasets) |
| `tokenizeMedical` / `searchDict` / `crossSuggest` | Code Lookup search core (pure, in medintel-core.js) — keyword AND-match with prefix-stem fallback; heuristic cross-vocabulary suggestions |
| `loadCptDict()` / `loadDrgDict()` / `executeLookupSearch()` | Code Lookup tab — dictionaries from national dataset rows, localStorage-cached (`medintel_cpt_dict_v1`/`medintel_drg_dict_v1`). Page-capped builds set `cptDictTruncated`/`drgDictTruncated` |
| `lookupCptCodeDirect` / `lookupDrgCodeDirect` / `lookupCptKeywordDirect` | **Truncation workaround** — the dictionaries are a capped local index, so a miss triggers a targeted direct-API query for that code/keyword. Each verifies the returned rows actually match (filter-bypass safety net) before trusting them |
| `hcpcsLevelBadge(code)` | Labels a code CPT (Level I) / CPT III / Level II from its shape |
| `lookupDmeCode` / `lookupDmeKeyword` / `lookupDmeReferrers` / `dmePanelHtml` | **DMEPOS lookup** — supplier-billed Level II codes are absent from physician data, so Code Lookup also queries the DME Geography & Service dataset (volume/payments/benes/supplier count) and the DME Referring Provider dataset (`groupByReferrer` → ranked ordering physicians), rendered in its own panel. Each returns a `{status: 'ok'\|'none'\|'unavailable'\|'not-applicable'}` object — `unavailable` renders as an explicit amber "could not check", never as an empty result |
| `fetchDmeGeoRows(base, filterParam, size)` | Requests DMEPOS geography rows scoped to National. **The DMEPOS geo column is `Rfrg_Prvdr_Geo_Lvl`** (geography is the *referring* provider's), not the `Rndrng_Prvdr_Geo_Lvl` used by the physician/inpatient files. Tries the documented filter, then retries unfiltered and scopes via `pickNationalRows` — a renamed column costs a request, never a wrong answer |
| `getGeoLevel` / `pickNationalRows` | Name-tolerant geo-level accessor + National-row scoping (pure). Returns `scope: 'national'\|'state-sum'\|'unscoped'\|'none'`; `state-sum` is surfaced in the UI as approximate |
| `hcpcsLevelIIFamily(code)` / `HCPCS_LEVEL_II_FAMILIES` / `dmeFamilyPanelHtml` | **Level II is not one set** — the leading letter says who bills the code and therefore which dataset holds it. `A/B/E/K/L/J/Q/V` → DMEPOS; `C` → hospital outpatient OPPS pass-through (no per-code public data — the outpatient files aggregate to APC); `G/M/P/R` → practitioner Part B (already in the CPT panel); `S/T/H` → not Medicare. Non-DMEPOS families skip the supplier query and render a family-specific explanation |
| `getSupplierServices` / `getSupplierBenes` / `getSupplierPayment` / `getSupplierCount` / `getReferringName` / `groupByReferrer` | DMEPOS field accessors + referrer aggregation (pure, in medintel-core.js). DMEPOS uses `Tot_Suplr_*` / `Rfrg_Prvdr_*` column prefixes, not `Rndrng_*` |
| `renderResults()` | Renders Medicare provider cards to DOM |
| `renderNpiResults()` | Renders NPPES lookup cards to DOM |
| `toggleProcedures(npi)` | Expands/collapses procedure detail table for a card |
| `exportCSV()` | Downloads grouped provider data as CSV |
| `exportNpiCSV()` | Downloads NPI results as CSV |
| `f(row, fieldName)` | Field accessor handling CMS API name variations |
| `getPayment(row)` | Extracts payment (falls back to avg × services) |
| `getProviderName(row)` | Handles individual vs. organization name fields |
| `escapeHtml(str)` | XSS prevention — always use when inserting user-derived data into DOM |
| `encodeSearchState` / `decodeSearchState` | Share-link serialization (pure, in medintel-core.js). Decode treats the URL as untrusted: tab must be in `SHAREABLE_TABS`, year must be 4 digits, field keys must be alphanumeric, values capped at 300 chars |
| `captureSearchState()` / `buildShareUrl()` / `copyShareLink(btn)` | Capture the current tab's fields (`TAB_FIELDS`) into a `#fragment` URL and copy it (clipboard API with an execCommand fallback for `file://`) |
| `restoreSharedSearch()` | On load and on `hashchange`: restores tab/fields/year from the fragment (via `.value`, never HTML) and auto-runs the search |
| `openFilterDrawer()` / `closeFilterDrawer()` / `onDrawerKeydown(e)` / `drawerActive()` | **Mobile filter drawer** (≤900px) — `#sidebar` becomes an off-canvas bottom sheet toggled by `#filterFab`. `drawerActive()` gates every viewport-dependent behavior (matches the same `900px` breakpoint as the CSS) so desktop, where the FAB is never shown, is unaffected. `onDrawerKeydown` closes on Escape and wraps Tab within the open drawer (minimal focus trap). `executeSearch()` calls `closeFilterDrawer()` once validation passes (not before, so `#errorBox` — inside the drawer — stays visible on a validation failure) |
| `updateFilterFabBadge()` | Counts filled fields for the active tab from `TAB_FIELDS` (the same map share-links use) and shows the count on the FAB; called from `switchTab()`, `clearSearch()`, and `closeFilterDrawer()` |

---

## Development Conventions

### Making Changes

1. **No build required.** Edit the HTML file and refresh the browser.
2. **Serve locally for faster API calls** (avoids CORS proxy overhead):
   ```bash
   npx serve .
   # Then open http://localhost:3000/cms-sales-intel (4).html
   ```

### Code Style

- No linter or formatter is configured — maintain the existing style
- Use `const`/`let`, arrow functions, template literals (ES6+ is fine; no IE support needed)
- CSS: add new variables to `:root` before using magic values
- All DOM manipulation via `innerHTML` + `escapeHtml()` — never insert raw user input
- Error messages go in `#errorBox` via `showError(message)`; clear with `clearError()`

### Adding a New Search Tab

First decide where it belongs in the nav: a new **primary destination** (add to `.nav-row`, own `data-tab`) or a new **utility** (add to `.utility-strip`) — this determines which class it gets, but the wiring below is the same regardless. Before adding a new destination, check whether it would actually be redundant with an existing one (same dataset, same filters, same output shape) — that redundancy is exactly what caused Provider/Geography to need merging.

1. Add a button (`.nav-btn` for a destination, `.tab-utility` for a utility) with `onclick="switchTab('newtab')"` and a `data-tab="newtab"` attribute (`updateDestActive()`/`updateUtilityActive()` pick it up automatically via `document.querySelectorAll('.nav-btn'|'.tab-utility')` — no extra plumbing needed there)
2. Add a `<div id="newtabFields" style="display:none">` with inputs
3. Add a `document.getElementById('newtabFields').style.display = tab === 'newtab' ? 'block' : 'none';` line in `switchTab()`
4. Add a branch in `getSearchCriteria()`/`buildApiUrl()` (if it fits the declarative CMS-filter model) or a dedicated `executeNewtabSearch()` function otherwise
5. Add rendering logic in `executeSearch()`'s dispatch or the dedicated function
6. Add `newtab: [...]` to `TAB_FIELDS` and (if the tab should be shareable) to `SHAREABLE_TABS` in medintel-core.js
7. Check `fetchAllRows()`'s multi-code state-select branch, `getTypedCodes()`, and `validateInput()` — each has its own `currentTab === '...'` branches independent of `getSearchCriteria()` and is easy to miss

### Adding New Result Fields

CMS API fields use a naming pattern like `Rndrng_Prvdr_Last_Org_Name`. Always use the `f(row, fieldName)` helper to access them so both underscore and space variants work:

```javascript
const city = f(row, 'Rndrng_Prvdr_City');
```

### Pagination

CMS tabs paginate **client-side**: `executeSearch()` fetches and groups all rows in memory, then `renderResults()`/`renderProcedureResults()` slice `displayPage * DISPLAY_PAGE_SIZE`; `prevPage`/`nextPage` re-render. The NPI tab paginates **server-side** — `executeNpiSearch(offset)`, driven by `gotoNpiPage(offset)` (which enforces the loading guard and error handling). NPPES exposes no grand total, so the UI shows "more available →" rather than a page count.

---

## Testing

Pure logic lives in `medintel-core.js` and is unit-tested with Vitest (`npm test` → `medintel-core.test.js`, 231 tests). The GitHub Pages deploy runs the suite before publishing. Additionally:

- **`npm run smoke`** (`node scripts/live-smoke.mjs`; run manually, network + Node 18+ required) verifies the live-CMS assumptions the mocked tests can't — dataset titles, field spellings (`Tot_Benes`, `Avg_Submtd_Cvrd_Chrg`, `Tot_Dschrgs`), DRG code padding, and catalog shape.
- Manual UI validation: open in a browser (or `npx serve .`), exercise Find Customers, Find by Procedure, Size a Market, and both utilities with valid/invalid input, check CSV exports, and use devtools network throttling to verify proxy fallback.

---

## Deployment

The app is a single static file. Deploy by copying `cms-sales-intel (4).html` to any host:

```bash
# GitHub Pages, Netlify, Vercel — just drop the file
# S3
aws s3 cp "cms-sales-intel (4).html" s3://your-bucket/

# Local
npx serve .
```

No environment variables, no server-side configuration, no database.

---

## Data Limitations (Important for Accurate Feature Work)

- **Medicare Fee-for-Service only** — excludes Medicare Advantage, Medicaid, private insurance
- **Privacy redaction** — provider+procedure combinations with ≤10 beneficiaries are excluded from the *by-Provider* datasets. **Workaround:** the *by-Geography-and-Service* rows are pre-aggregated per code and are NOT subject to that floor, so `fetchGeoTotal()` supplies each procedure card's true headline volume; `patchProcedureTotals()` also reports what share the named providers cover, and `probeSuppressedVolume()` reports real volume when zero providers are nameable
- **Beneficiary counts** — `Tot_Benes` is distinct patients *per row* (provider+HCPCS+POS). Summing rows overstates unique patients, so provider cards show the true per-provider count from the by-Provider *summary* dataset; the procedure tab shows an explicit *sum* (labeled as such) because no dataset yields a clean distinct-per-code count for a filtered view
- **Fetch-cap grouping** — `groupByProvider()`/`groupByProcedure()` aggregate over the rows actually fetched (up to 3,000); a genuine cap sets a per-fetch `capped` flag (not a row-count guess) and the UI shows a partial-totals warning
- **Annual data** — CMS claims datasets are per calendar year; the Data Year selector switches dataset versions, and NPPES (NPI tab) is a live snapshot with no history
- **CMS API max** — returns up to 1,000 rows per request; app fetches 50 at a time

---

## Git Workflow

- Work on a feature branch; push with `git push -u origin <branch-name>`, open a PR against `main`.
- The GitHub Pages deploy (`.github/workflows/deploy.yml`) runs `npm test` and, on success, publishes `main` — so keep the suite green.
- Run `npm test` before pushing; for changes that touch live-CMS assumptions, also run `npm run smoke` from a networked machine.
