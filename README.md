# MedIntel — CMS Medicare Sales Intelligence

A web application that searches CMS Medicare and NPPES public APIs to help medical device manufacturers identify high-value providers and surgical targets — by procedure code, location, specialty, and procedure volume. No server, no build step, no API key required.

![License](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-157%20passing-brightgreen)

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

### Code Discovery

Don't know the codes in advance? The **Code Lookup** tab searches CPT/HCPCS and MS-DRG by keyword or code, shows each code's national Medicare volume, and one-click-adds codes to the Procedure and Market TAM searches. See [Code Lookup Tab](#code-lookup-tab) below.

### Multi-Code Search

Paste multiple CPT/HCPCS codes into the Procedure tab (or a state + code family into Geography) and search them all at once. The app fetches each code in parallel from the CMS API and aggregates results — so you see, e.g., a surgeon's total revision burden across a whole code family in one result list.

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

### Six Search Modes

| Tab | Data Source | What You Search | What You Get |
|-----|------------|----------------|-------------|
| **Provider** | CMS Medicare | Name, NPI, specialty, state | Payment totals, procedure volumes, beneficiary counts |
| **Procedure** | CMS Medicare | One HCPCS/CPT code, a **bulk-pasted list of codes**, or a keyword | Results grouped **by procedure** — total services, provider count, payment per code, with a per-provider breakdown and a multi-year volume trend |
| **Geography** | CMS Medicare | State, city, specialty, procedure code | Territory-level provider discovery |
| **Market TAM** | CMS Medicare (Physician + Inpatient Hospital datasets) | A CPT code family, MS-DRG codes, payer-mix/ASP assumptions | National FFS volume per year, modeled all-payer volume, modeled total US TAM, hospital billing/payments per DRG, top surgeons & hospitals |
| **Code Lookup** | CMS national datasets (client-side dictionaries) | Keyword, CPT/HCPCS code, or MS-DRG code | Both vocabularies side by side with national volumes, cross-vocabulary suggestions, one-click add to Procedure/TAM searches |
| **NPI Lookup** | NPPES NPI Registry | First name, last name, state, city, taxonomy | NPI number, credentials, address, phone, license, specialty taxonomy |

### Market TAM Tab

Size a device market from its procedure codes. Paste the code family, set three assumptions — Medicare FFS share of all cases (%), the addressable portion of all cases your device can serve (%), and your average device revenue per procedure — and get: national Medicare FFS procedure volume (latest year + full multi-year trend), modeled total US procedures across all payers, modeled addressable case count, modeled total US TAM, and the top surgeons by volume. Assumption changes re-model instantly without refetching. Note: hospitals' implant spend is bundled into inpatient DRG payments and is not itemized in any public CMS dataset — the TAM is modeled from volume × ASP, which is the honest way to do it from public data.

### Code Lookup Tab

One search box, both vocabularies. Keywords (e.g. "cranioplasty") match CPT/HCPCS and MS-DRG descriptions side by side — each hit shows its national Medicare volume so you can tell real-world codes from noise. Enter a code and you get its record plus description-matched suggestions in the other system (with a match-strength chip). Every row has one-click buttons to push the code into the Procedure or Market TAM searches, and a "Browse all MS-DRGs" button lists the full DRG table. Dictionaries are built from the latest CMS national datasets and cached in your browser for a week.

**Why suggestions, not a crosswalk:** there is no official CPT↔DRG mapping — hospitals assign DRGs from ICD-10-PCS procedure codes plus diagnoses via CMS's GROUPER, so cross-vocabulary matches are heuristic leads to verify against a coding guide.

### Hospital Billing View (MS-DRG)

Because physician fees don't represent the money that buys devices, the TAM tab also takes **MS-DRG codes** (from any device coding guide). It pulls the Medicare Inpatient Hospitals datasets and shows, per year: national inpatient discharges, what hospitals **billed** (covered charges), what hospitals were **paid** (total, all sources — device cost bundled in), and Medicare's portion — plus the **top hospitals by discharge volume** for targeting. Caveat shown in-app: a DRG bundles every procedure in its group, so treat DRG dollars as facility-side context/ceiling and use per-CPT volume for procedure-level math.

### Bulk Code Search

Paste a whole list of HCPCS/CPT codes — separated by commas, spaces, semicolons, or new lines — into the Procedure tab's code box (or the Geography tab's HCPCS filter). MedIntel fetches every code in parallel (up to 30 per search), aggregates them into one result set, and flags any tokens that aren't valid codes before searching. Build the list quickly from the **Code Lookup** tab's one-click add buttons.

### Data Year Selector & Yearly Volume Trends

Medicare claims data is published one calendar year at a time. MedIntel grounds every result in its time period:

- A **Data Year** selector (sidebar) lets you run any CMS search against a specific calendar year — the list of available years is discovered live from the official [data.cms.gov catalog](https://data.cms.gov/data.json) and cached in your browser.
- Every CMS results page shows a **year badge** (e.g. `CY 2023 · Medicare FFS`) so you always know which year you're looking at; NPI Lookup results are labeled as a live registry snapshot instead, since NPPES has no historical years.
- On Procedure results, **Volume trend by year** expands a chart of national (or state-level, if a state filter is set) total service volume and Medicare payment for that code across every published data year — ideal for understanding whether a procedure's volume is growing or shrinking.
- Provider and Geography results have the same **Volume trend by year** panel per provider card — the provider's total billed services and Medicare payment per calendar year, across all procedure codes.
- Provider cards stamp their headline metrics with the data year (e.g. `Total Services · CY 2024`).
- CSV and SharePoint exports include a **Data Year** column.

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

**Find all hip revision surgeons in California:**
> Tab: Geography → State: CA → HCPCS Code Filter: `27134, 27137, 27138` → Search

**Find revision knee specialists above 50 procedures/year in Texas:**
> Tab: Procedure → HCPCS: `27486, 27487` → State: TX → Search → set Min services filter to 50

**Not sure of the codes?**
> Tab: Code Lookup → search `knee revision` → click **+ Procedure** on the codes you want → Tab: Procedure → Search

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

Look any of these up (and find related codes and their MS-DRGs) in the **Code Lookup** tab.

---

## Data Sources

| Dataset / API | Endpoint | Used for | Auth |
|-----|----------|----------|:---:|
| **Physician & Other Practitioners — by Provider and Service** | `data.cms.gov/data-api/v1/dataset/{id}/data` | Provider/Procedure/Geography searches | No |
| **Physician & Other Practitioners — by Provider** (summary) | same, different `{id}` | True unique beneficiary counts | No |
| **Physician & Other Practitioners — by Geography and Service** | same, different `{id}` | National/state volume trends, code dictionary | No |
| **Medicare Inpatient Hospitals — by Geography and Service** | same, different `{id}` | Per-DRG hospital billing/payments, DRG dictionary | No |
| **Medicare Inpatient Hospitals — by Provider and Service** | same, different `{id}` | Top hospitals by DRG | No |
| **NPPES NPI Registry** | `npiregistry.cms.hhs.gov/api/?version=2.1` | NPI Lookup tab | No |

All are free, public, and maintained by the Centers for Medicare & Medicaid Services (CMS). Each CMS dataset has one versioned `{id}` per calendar year, discovered at runtime from the [catalog](https://data.cms.gov/data.json).

**Verifying live-API assumptions:** run `npm run smoke` (from any network-connected machine, Node 18+). It hits the real CMS API and checks that all dataset titles resolve and the exact fields the app reads still exist — run it after a CMS data refresh, or once after deploy to confirm the unique-beneficiary dataset is wired correctly. It prints a pass/fail per check and exits non-zero if anything drifted; it makes no changes.

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
- **Test suite:** 157 unit tests via Vitest (`npm test`)
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
