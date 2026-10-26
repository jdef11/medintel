# cms-api skill

A Claude Code skill that lets an agent pull real Medicare data straight from CMS's free public APIs. The agent queries the source instead of guessing or web-searching. The skill has two parts:

- **Instructions for the agent** (`SKILL.md`): which dataset answers which question, the API traps, and how to interpret the numbers.
- **A command-line tool** (`scripts/cms.mjs`): handles the mechanics and turns the APIs' silent failures into errors. People can run it directly too.

No API key, account, or install is needed beyond Node 18 or newer.

## What it can answer

| Question | Source |
|---|---|
| How many times was CPT/HCPCS X performed nationally or in a state, by year? | Physician & Other Practitioners, by Geography and Service |
| Who are the top billers of code X in a state or city? | Physician & Other Practitioners, by Provider and Service |
| What are a provider's total Medicare patients and payments? | Physician & Other Practitioners, by Provider |
| How many hospital discharges and payments were there for MS-DRG X, and which hospitals lead? | Inpatient Hospitals (Geography / Provider and Service) |
| How large is a DME code, and which physicians order it? | DMEPOS, by Geography / by Referring Provider |
| What is this provider's NPI, specialty, and address? | NPPES NPI Registry |
| Which practice (billing group) or hospitals is a provider affiliated with? | Provider Data Catalog |
| Anything else in the data.cms.gov catalog (Part D, hospice, post-acute care, …) | Any data-api dataset, by title |

Claims data runs about two years behind. In late 2026 the newest year is CY2024, and most datasets go back to CY2013.

## Installing

- **In this repo:** nothing to do. Claude Code loads skills from `.claude/skills/` automatically.
- **Everywhere else:** copy the folder to `~/.claude/skills/cms-api/`. The skill has no dependencies on the rest of this repo.

## Using it through Claude

Ask in plain language; the agent loads the skill when a question needs CMS data. You can also call it explicitly with `/cms-api`. Example prompts:

- "How many procedures per year were there for CPT 27437, 27438, and 27447?"
- "Top 20 knee-replacement surgeons in Ohio in 2023, with their Medicare payments."
- "Which hospitals had the most DRG 470 discharges in Florida?"
- "Find the NPI for Dr. Paul Cooper in DC and list his hospital affiliations."

The agent should always state the dataset and data year with every number. If it doesn't, ask.

## Using the CLI directly

```bash
CMS="node .claude/skills/cms-api/scripts/cms.mjs"
$CMS help

$CMS datasets --search inpatient            # what's available, and which years
$CMS columns provider                       # exact column names
$CMS query provider --where HCPCS_Cd=27447 --where Rndrng_Prvdr_State_Abrvtn=TX --count
$CMS query provider --year 2023 --where HCPCS_Cd=27447 --where Rndrng_Prvdr_State_Abrvtn=TX \
  --columns Rndrng_NPI,Rndrng_Prvdr_Last_Org_Name,Tot_Srvcs --sort -Tot_Srvcs --limit 10 --format csv
$CMS query geography --where Rndrng_Prvdr_Geo_Lvl=National --in HCPCS_Cd=27447,27130
$CMS npi --last_name 'coop*' --first_name paul --state DC
$CMS pd facilityAff --in npi=1548269731 --where facility_type=Hospital
```

Filter operators for `--where`:

| Write | Means |
|---|---|
| `=` | equals |
| `!=` | does not equal |
| `~` | contains |
| `^` | starts with |
| `>` `>=` `<` `<=` | numeric comparison |

`--in Col=a,b,c` matches any value in a list.

Results go to stdout as `json` (default), `csv`, or `ndjson`. Progress, row counts, the dataset/year/ID used, and warnings go to stderr. `--url` prints every request so you can see exactly what was queried.

## How it works

Each `query` runs in five steps:

1. **Find the dataset version.** CMS publishes each calendar year as a separate dataset with its own ID. The tool reads CMS's catalog (`data.json`, ~18 MB, cached in your temp folder for 24 h) and maps your `--year` to that year's ID. If the catalog is down, it falls back to each dataset's "latest" ID and says so.
2. **Validate column names.** The claims API silently ignores a misspelled column and returns unfiltered data with no error. The tool checks every column you name against the dataset's real column list first and stops with a suggestion if one is wrong.
3. **Build the filter.** Multiple `--where` conditions are explicitly combined with AND.
4. **Count, then fetch.** It gets the total number of matching rows in one cheap request, then fetches 1,000 rows per page up to `--limit` (or everything with `--all`). It tells you how many matching rows it didn't return.
5. **Retry and report errors.** It retries brief CMS outages and reports errors in plain language. Two examples: NPPES returns errors as "success" responses with an error list, and CMS's network front end sometimes returns an "Access Denied" page.

`pd` queries (practice and hospital affiliations) also look up the dataset's current distribution ID on each run. They expect roughly 15 s per request, so batch NPIs with `--in` rather than querying one at a time.

## Reading the numbers correctly

These are the mistakes the skill tells agents to avoid. They apply to anyone using this data.

- **Medicare fee-for-service only.** No Medicare Advantage (now more than half of Medicare patients), Medicaid, or commercial insurance. Real-world volume is materially higher.
- **"Services" are not procedures for surgical codes.** Assistant surgeons (often physician assistants) and ambulatory surgery centers bill the same CPT code. For knee replacement (27447) in CY2024 there were 571,587 billed services but about 296,000 patients. Use patient counts (`Tot_Benes`) or surgeon-only rows to estimate procedures.
- **Small providers are hidden.** Provider-level rows with 10 or fewer patients are suppressed, so adding them up undercounts. National and state totals come from the Geography datasets, which aren't suppressed.
- **Patient counts don't add up across rows.** One patient can appear in several rows (different codes or settings). Use the by-Provider summary dataset for a provider's true patient count.
- **Average payment varies by who billed.** An assistant's claim pays a fraction of the surgeon's, so one provider's average isn't the fee-schedule rate.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `column "X" does not exist` | Typo or wrong case. Run `$CMS columns <dataset>`. Names differ between datasets (e.g. DME Referring uses `HCPCS_CD`). |
| `"X" matches N dataset families` | Your dataset name is ambiguous. Use an alias or the full title from `datasets`. |
| `has no 2025 version` | That year isn't published yet. The error lists the available years. |
| `NPPES rejected the query` | NPPES needs more than a state. Add a name, city, or taxonomy. |
| `"Access Denied" from the CMS edge` | CMS's network refused the request. It's not a data answer. Try again later or from another network; don't retry in a loop. |
| Slow `pd` queries | Normal: about 15 s per request regardless of size. |

## Maintenance

Every rule in `SKILL.md` was verified against the live APIs on **2026-10-26**. CMS changes things without notice. Since 2026 it has changed the catalog format, gated the affiliations API by client type, and blocked one URL form for the clinicians dataset. Re-check these when something breaks:

- **Built-in dataset IDs:** `FAMILIES` and `LATEST_IDS` at the top of `scripts/cms.mjs` hold the seven dataset titles and their "latest" IDs.
- **Column names:** `references/datasets.md` lists them, but `$CMS columns <alias>` is always authoritative.
- **Request header and endpoint:** the `User-Agent` the tool sends, and the distribution-ID endpoint for `pd` queries (see `SKILL.md`). Never change the tool to imitate a browser.

There are no automated tests for the CLI yet. The fastest end-to-end check is to run every example under "Using the CLI directly" and confirm each one returns rows.

## Files

```
cms-api/
├── README.md               this file (for people)
├── SKILL.md                instructions the agent loads
├── references/datasets.md  column reference for the seven main datasets + affiliation datasets
└── scripts/cms.mjs         the CLI (Node 18+, no dependencies)
```
