# MedIntel — CMS Medicare Sales Intelligence

A single-file web application that searches CMS Medicare and NPPES public APIs to help medical device manufacturers identify high-value providers and surgical targets. No server, no build step, no API key — just open the HTML file in a browser and start prospecting.

![License](https://img.shields.io/badge/license-MIT-blue)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-green)
![Single File](https://img.shields.io/badge/single%20file-HTML-orange)

---

## What It Does

MedIntel connects directly to two free, public CMS government APIs and lets you search for Medicare providers, procedures, and payment data — then groups and ranks results so the highest-value targets surface first.

**Built for medical device sales teams** who need to answer questions like:

- *Which orthopedic surgeons in Texas perform the most total knee replacements?*
- *What's the Medicare payment volume for a specific provider?*
- *Who are the top-billing cardiac surgeons in the Boston metro area?*
- *What's the NPI, credentials, and contact info for Dr. Jane Smith in Florida?*

## Features

### Four Search Modes

| Tab | Data Source | What You Search | What You Get |
|-----|-----------|----------------|-------------|
| **Provider** | CMS Medicare Physician & Other Practitioners | Name, NPI, specialty, state | Payment totals, procedure volumes, beneficiary counts |
| **Procedure** | CMS Medicare Physician & Other Practitioners | HCPCS/CPT code or keyword | All providers billing that code, ranked by payment |
| **Geography** | CMS Medicare Physician & Other Practitioners | State, city, specialty, procedure code | Territory-level provider discovery |
| **NPI Lookup** | NPPES NPI Registry | First name, last name, state, city, taxonomy | NPI number, credentials, address, phone, license, specialty taxonomy |

### Grouped Provider View

Results from the Provider, Procedure, and Geography tabs are **grouped by provider (NPI)** with aggregated totals. Each provider card shows:

- Total Medicare payment (sorted highest first)
- Total services performed
- Number of Medicare beneficiaries
- Count of distinct procedure codes billed
- Average payment per service
- **Expandable procedure detail table** — click to see every HCPCS code the provider billed with per-code service counts, payments, and average charges

### CSV Export

Every search mode includes a one-click CSV export for importing into your CRM, Excel, or sales pipeline tools. Provider/Procedure/Geography exports are grouped by provider. NPI Lookup exports include full contact details.

## Getting Started

### Option 1: Just Open It

1. Download `cms-sales-intel.html`
2. Open it in any modern browser (Chrome, Edge, Firefox, Safari)
3. Search

That's it. The app routes API requests through CORS proxies automatically so it works from a local file.

### Option 2: Serve Locally (Faster)

If you have Node.js installed, serving locally avoids CORS proxies and is faster:

```bash
npx serve .
```

Then open `http://localhost:3000/cms-sales-intel.html`.

### Option 3: Host It

Deploy the single HTML file to any static hosting (GitHub Pages, Netlify, Vercel, S3, Azure Static Web Apps, etc.). No build step required.

## Example Searches

**Find top knee replacement surgeons in Massachusetts:**
> Tab: Procedure → HCPCS Code: `27447` → State: `MA` → Search

**Look up a specific provider's Medicare billing:**
> Tab: Provider → NPI: `1234567890` → Search

**Prospect orthopedic surgeons in Houston:**
> Tab: Geography → State: `TX` → City: `Houston` → Specialty: `Orthopedic Surgery` → Search

**Get contact info for a surgeon:**
> Tab: NPI Lookup → Last Name: `Smith` → State: `FL` → Taxonomy: `Orthopedic Surgery` → Search

## Data Sources

| API | Endpoint | Auth Required |
|-----|----------|:---:|
| **CMS Medicare Physician & Other Practitioners** | `data.cms.gov/data-api/v1/dataset/{id}/data` | No |
| **NPPES NPI Registry** | `npiregistry.cms.hhs.gov/api/?version=2.1` | No |

Both APIs are free, public, and maintained by the Centers for Medicare & Medicaid Services (CMS) under the U.S. Department of Health and Human Services.

## Data Limitations

- **Medicare Fee-for-Service only.** This data does not include Medicare Advantage, Medicaid, private insurance, or uninsured patients. A provider's actual procedure volume is likely higher than what's shown.
- **Privacy redaction.** Any provider/procedure combination with 10 or fewer Medicare beneficiaries is excluded from the dataset.
- **Not a quality indicator.** Payment and volume data do not reflect quality of care.
- **Page-level grouping.** Provider grouping happens within each page of 50 API results. A provider with many procedure codes may span multiple pages.
- **API page size.** The CMS data API returns a maximum of 1,000 rows per request. This app fetches 50 at a time for performance.

## Technical Details

- **Zero dependencies** — vanilla HTML, CSS, and JavaScript in a single file
- **No build step** — no npm, no webpack, no framework
- **CORS handling** — tries a direct fetch first, then cycles through three CORS proxy services as fallbacks (`allorigins.win`, `corsproxy.io`, `codetabs.com`)
- **NPPES API** — supports CORS natively, so NPI Lookup typically connects directly without a proxy
- **Responsive** — works on desktop and mobile
- **~1,400 lines** — small enough to read, understand, and modify

## Common HCPCS Codes for Device Sales

| Code | Description |
|------|-------------|
| 27447 | Total knee arthroplasty |
| 27130 | Total hip arthroplasty |
| 22551 | Anterior cervical fusion |
| 22630 | Posterior lumbar fusion |
| 33361 | Transcatheter aortic valve replacement (TAVR) |
| 27236 | Open treatment femoral fracture |
| 23472 | Total shoulder arthroplasty |
| 63047 | Lumbar laminectomy |
| 33533 | Coronary artery bypass graft (CABG) |
| 28296 | Bunionectomy with osteotomy |

## License

MIT — use it however you want.

## Disclaimer

This tool is for sales prospecting and market research purposes only. The data is sourced from publicly available U.S. government datasets. This tool is not affiliated with or endorsed by CMS, HHS, or any government agency. The data does not indicate quality of care and should not be used for clinical decision-making.
