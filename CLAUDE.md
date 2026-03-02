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
├── cms-sales-intel (4).html   # The entire application (~1,500 lines)
├── README.md                  # User-facing documentation and example searches
├── LICENSE                    # MIT License
└── CLAUDE.md                  # This file
```

There are no subdirectories, no source maps, no compiled assets, and no configuration files.

---

## Application Architecture

The HTML file is divided into three sections:

### 1. CSS (lines ~8–527)

Embedded in a `<style>` block. Uses CSS custom properties (variables) defined on `:root` for the entire design system:

- **Colors:** Dark theme — `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-2`, `--text-3`
- **Accent:** `--accent: #3D6EF7` (blue)
- **Status colors:** `--green`, `--amber`, `--red` with `-dim` variants (rgba)
- **Typography:** `DM Sans` (UI), `Instrument Serif` (logo/branding)
- **Border radius tokens:** `--radius: 10px`, `--radius-sm: 6px`

CSS class naming: **kebab-case** (`.result-card`, `.procedures-list`, `.empty-state`)

### 2. HTML (lines ~540–691)

Two-pane layout:
- **Sidebar** (350px fixed): search tabs, input fields, search button, error box
- **Main area** (scrollable): empty state → results grid → pagination

HTML element IDs: **camelCase** (`searchBtn`, `resultsArea`, `emptyState`)

### 3. JavaScript (lines ~693–1495)

Embedded in a `<script>` block. No modules, no imports. All functions are global. Key state variables are module-level:

```javascript
let currentTab = 'provider'   // Active search tab
let currentResults = []        // Current page results
let currentPage = 0            // Current page (0-indexed)
let totalFound = 0             // Total API results
let isLoading = false          // Prevent double-submit
let activeProxyIndex = 0       // Last successful CORS proxy
```

JavaScript function naming: **camelCase** (`executeSearch`, `groupByProvider`, `exportCSV`)

Constants are UPPER_CASE (`DATASET_ID`, `BASE_URL`, `PAGE_SIZE`, `CORS_PROXIES`).

---

## Search Modes

The app has four tabs, each with different input fields and API targets:

| Tab | API | Key Inputs | Query Parameter |
|-----|-----|-----------|----------------|
| `provider` | CMS Medicare | Name, NPI, specialty, state | `keyword` or `filter[Rndrng_NPI]` |
| `procedure` | CMS Medicare | HCPCS code, state | `filter[HCPCS_Cd]` |
| `geography` | CMS Medicare | State, city, specialty, code | `filter[Rndrng_Prvdr_State_Abrvtn]` + others |
| `npi` | NPPES Registry | First/last name, state, city, taxonomy | Direct query params |

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
| `buildApiUrl(offset)` | Constructs CMS API query URL for current tab/inputs |
| `corsFetch(url)` | CORS-aware fetch — tries direct then cycles proxies |
| `fetchWithTimeout(url, ms)` | Fetch wrapper with configurable timeout |
| `groupByProvider(rows)` | Aggregates raw rows by NPI, sorts by total payment |
| `renderResults()` | Renders Medicare provider cards to DOM |
| `renderNpiResults()` | Renders NPPES lookup cards to DOM |
| `toggleProcedures(npi)` | Expands/collapses procedure detail table for a card |
| `exportCSV()` | Downloads grouped provider data as CSV |
| `exportNpiCSV()` | Downloads NPI results as CSV |
| `f(row, fieldName)` | Field accessor handling CMS API name variations |
| `getPayment(row)` | Extracts payment (falls back to avg × services) |
| `getProviderName(row)` | Handles individual vs. organization name fields |
| `escapeHtml(str)` | XSS prevention — always use when inserting user-derived data into DOM |

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

1. Add a `.tab` button in the HTML sidebar with `onclick="switchTab('newtab')"`
2. Add a `<div id="newtabFields" class="field-group" style="display:none">` with inputs
3. Add a `case 'newtab':` branch in `switchTab()` to show/hide fields
4. Add a `case 'newtab':` branch in `buildApiUrl()` or a new fetch function
5. Add rendering logic in `executeSearch()` or a dedicated `executeNewtabSearch()` function

### Adding New Result Fields

CMS API fields use a naming pattern like `Rndrng_Prvdr_Last_Org_Name`. Always use the `f(row, fieldName)` helper to access them so both underscore and space variants work:

```javascript
const city = f(row, 'Rndrng_Prvdr_City');
```

### Pagination

Pagination is offset-based. `executeSearch(offset)` is called with:
- `offset = 0` for a new search
- `offset = currentPage * PAGE_SIZE` for page navigation

The `totalFound` variable holds the API's `filteredCount` and is used to show/hide the Next button.

---

## Testing

There is no test suite. Validation is manual:
- Open the file in a browser (or `npx serve .`)
- Test all four search tabs with valid and invalid inputs
- Check CSV export downloads
- Test pagination if a search returns >50 results
- Test with browser devtools network throttling to verify proxy fallback behavior

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
- **Privacy redaction** — provider+procedure combinations with ≤10 beneficiaries are excluded
- **Page-level grouping** — `groupByProvider()` groups within the current 50-row page only; a provider with many procedures across pages will appear split
- **CMS API max** — returns up to 1,000 rows per request; app fetches 50 at a time

---

## Git Workflow

- Branch: `claude/claude-md-mm9pmui0q3dfxmju-Xrefs`
- Remote: `origin`
- Push with: `git push -u origin <branch-name>`

```bash
git add CLAUDE.md
git commit -m "Add CLAUDE.md with codebase documentation"
git push -u origin claude/claude-md-mm9pmui0q3dfxmju-Xrefs
```
