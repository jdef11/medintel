# MedIntel — CMS Medicare Sales Intelligence

A web application that searches CMS Medicare and NPPES public APIs to help medical device manufacturers identify high-value providers and surgical targets — by procedure code, location, specialty, and procedure volume. No server, no build step, no API key required.

![License](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-80%20passing-brightgreen)

---

## What It Does

MedIntel connects directly to two free, public CMS government APIs and lets you search for Medicare providers, procedures, and payment data — then groups, scores, and ranks results so the highest-value targets surface first.

**Built for orthopedic and medical device sales teams** who need to answer questions like:

- *Which surgeons in Texas perform the most hip revision procedures?*
- *Who are the highest-scoring revision surgeons in the Boston metro area?*
- *Find all surgeons billing hip AND knee revision codes in California — ranked by complexity score.*
- *What's the NPI, credentials, and contact info for Dr. Jane Smith in Florida?*

---

## Features

### CPT Code Browser

A built-in, searchable code library so you never need to know procedure codes in advance. Pre-loaded orthopedic revision bundles:

| Bundle | Codes |
|--------|-------|
| Hip Revision | 27134, 27137, 27138, 27132 |
| Knee Revision | 27486, 27487 |
| Shoulder Revision | 23473, 23474 |
| Ankle Revision | 27700, 27702, 27703 |
| Complex Reconstruction | 27645, 27646, 27097, 23333 |

Click a bundle to browse its codes; click individual codes to select or deselect them.

### Multi-Code Bundle Search

Select multiple CPT codes and search all of them simultaneously. The app fetches each code in parallel from the CMS API and aggregates results per surgeon NPI — so you see a surgeon's total revision burden across all selected codes in a single result list.

### Revision Complexity Score (0–100)

Every provider is scored on four factors that signal likelihood of needing custom implants:

| Factor | Weight | What it measures |
|--------|--------|-----------------|
| Code breadth | 40 pts | Number of distinct procedure codes billed — more codes = more complex practice |
| Volume | 30 pts | Total procedures (capped at 150 for full score) |
| Avg payment/service | 20 pts | Higher reimbursement = more complex cases |
| Facility ratio | 10 pts | Hospital/ASC procedures vs office — facility = higher acuity |

Results sort by score by default. Toggle to sort by total payment instead.

### Priority Tier Badges

Providers are automatically tiered within each result set:

- **Tier 1** (gold) — top 20% by complexity score — primary call targets
- **Tier 2** (silver) — next 40%
- **Tier 3** (grey) — bottom 40%

### Minimum Volume Filter

Filter results to providers above a minimum annual procedure threshold — cut the noise and focus on high-volume revision specialists.

### Four Search Modes

| Tab | Data Source | What You Search | What You Get |
|-----|------------|----------------|-------------|
| **Provider** | CMS Medicare | Name, NPI, specialty, state | Payment totals, procedure volumes, beneficiary counts |
| **Procedure** | CMS Medicare | HCPCS/CPT code or keyword | All providers billing that code, ranked by score |
| **Geography** | CMS Medicare | State, city, specialty, procedure code | Territory-level provider discovery |
| **NPI Lookup** | NPPES NPI Registry | First name, last name, state, city, taxonomy | NPI number, credentials, address, phone, license, specialty taxonomy |

### SharePoint Export

Configure once, export forever. A field-mapping modal lets you map MedIntel fields to your SharePoint column names — saved in your browser. Export includes:

- All provider fields (NPI, name, credentials, specialty, address)
- Priority Tier and Complexity Score
- Revision Procedure Types (codes billed)
- Date Added

### Standard CSV Export

One-click CSV download for any search mode, for use in Excel, Salesforce, or other CRM tools.

---

## Getting Started

### Option 1: Just Open It

1. Download or clone this repository
2. Open `cms-sales-intel (4).html` in any modern browser (Chrome, Edge, Firefox, Safari)
3. Search

The app routes API requests through CORS proxies automatically so it works from a local file with no server needed.

### Option 2: Serve Locally (Faster)

Serving locally avoids CORS proxy overhead:

```bash
npm install   # installs dev dependencies (Vitest for tests)
npx serve .
```

Then open `http://localhost:3000/cms-sales-intel (4).html`.

### Option 3: Host It

Deploy the HTML file and `medintel-core.js` to any static host (GitHub Pages, Netlify, Vercel, S3, Azure Static Web Apps, SharePoint document library, etc.). No build step required.

---

## Example Searches

**Find all hip revision surgeons in California using the CPT browser:**
> Open CPT Code Browser → click "Hip Revision" bundle → select codes 27134, 27137, 27138 → Tab: Geography → State: CA → Search

**Find revision knee specialists above 50 procedures/year in Texas:**
> CPT Browser → "Knee Revision" → Tab: Geography → State: TX → Search → set Min procedures filter to 50

**Look up a specific provider's Medicare billing:**
> Tab: Provider → NPI: `1234567890` → Search

**Prospect orthopedic surgeons in Houston:**
> Tab: Geography → State: TX → City: Houston → Specialty: Orthopedic Surgery → Search

**Get contact info for a surgeon:**
> Tab: NPI Lookup → Last Name: Smith → State: FL → Taxonomy: Orthopedic Surgery → Search

---

## Orthopedic Revision CPT Code Reference

| Code | Description |
|------|-------------|
| **27134** | Revision total hip arthroplasty — acetabular and femoral components |
| **27137** | Revision total hip arthroplasty — acetabular component only |
| **27138** | Revision total hip arthroplasty — femoral component only |
| **27132** | Conversion of previous hip surgery to total hip arthroplasty |
| **27486** | Revision total knee arthroplasty — 1 component |
| **27487** | Revision total knee arthroplasty — femoral and entire tibial component |
| **23473** | Revision total shoulder arthroplasty — humeral or glenoid component |
| **23474** | Revision total shoulder arthroplasty — both components |
| **27700** | Arthroplasty, ankle |
| **27703** | Arthroplasty, ankle — revision of total ankle |
| **27645** | Radical resection of bone tumor, femur |
| **27646** | Radical resection of bone tumor, tibia and fibula |

All of these are pre-loaded in the CPT Code Browser — no manual entry required.

---

## Data Sources

| API | Endpoint | Auth Required |
|-----|----------|:---:|
| **CMS Medicare Physician & Other Practitioners** | `data.cms.gov/data-api/v1/dataset/{id}/data` | No |
| **NPPES NPI Registry** | `npiregistry.cms.hhs.gov/api/?version=2.1` | No |

Both APIs are free, public, and maintained by the Centers for Medicare & Medicaid Services (CMS).

---

## Data Limitations

- **Medicare Fee-for-Service only.** Does not include Medicare Advantage, Medicaid, private insurance, or uninsured patients. A provider's actual procedure volume is likely higher than what's shown.
- **Privacy redaction.** Any provider/procedure combination with 10 or fewer Medicare beneficiaries is excluded from the dataset by CMS.
- **CMS API cap.** The API returns a maximum of 1,000 rows per request; this app fetches up to 3,000 rows per search (3 paginated calls). Use state or city filters to narrow large searches.
- **Not a quality indicator.** Payment and volume data do not reflect quality of care.

---

## Technical Details

- **Architecture:** `cms-sales-intel (4).html` (UI + app logic) + `medintel-core.js` (pure logic functions)
- **No framework, no build step** — vanilla HTML, CSS, and JavaScript
- **Test suite:** 80 unit tests via Vitest (`npm test`)
- **CORS handling:** tries direct fetch first, then cycles through three CORS proxy fallbacks (`allorigins.win`, `corsproxy.io`, `codetabs.com`)
- **NPPES API** supports CORS natively — NPI Lookup connects directly without a proxy
- **Responsive** — works on desktop and mobile

### Running Tests

```bash
npm install
npm test
```

---

## License

MIT — use it however you want.

---

## Disclaimer

This tool is for sales prospecting and market research purposes only. Data is sourced from publicly available U.S. government datasets. This tool is not affiliated with or endorsed by CMS, HHS, or any government agency. The data does not indicate quality of care and should not be used for clinical decision-making.
