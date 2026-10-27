# medtech-market-data

A Claude plugin that gives Claude live access to free public healthcare data for medical-device market intelligence. Claude queries the source and cites it, instead of guessing or web-searching.

## Skills

| Skill | Answers questions like | Source |
|---|---|---|
| `cms-claims` | How many 27447s in Medicare last year? Top surgeons for a code in Ohio? DRG 470 volume by hospital? Medicare Advantage share in Texas? | data.cms.gov claims datasets + Medicare enrollment |
| `cms-provider-data` | Which hospitals is Dr. X affiliated with? Which billing group? Hospital star ratings, hip/knee complication rates, ASC lists | CMS Provider Data Catalog (Care Compare) |
| `nppes` | What's Dr. X's NPI, specialty and address? | NPPES NPI Registry |
| `open-payments` | Which manufacturers pay this surgeon, and how much? Who does Stryker pay in Texas? | CMS Open Payments |
| `openfda` | Who holds 510(k)s for knee implants? Recent hip recalls? Adverse-event reports by manufacturer? | openFDA device APIs |
| `census` | 65+ population by county, for per-capita rates | Census ACS (**needs a free key; not yet verified live**) |
| `medtech-market-intel` | Market sizing with a Medicare Advantage adjustment, site-of-care splits, surgeon targeting, competitor mapping | combines the above |

Claude picks the right skill from your question. You don't need to name one.

## Installing (personal)

**claude.ai / Claude desktop** (syncs to Claude Code when you're signed in to the same account):
1. Build the zip (see "Making changes") or use the one you were sent. Then go to **Customize → Plugins → Add → Upload plugin**.
2. Or use **Add → Add marketplace** with `jdef11/medintel`, giving the Claude GitHub App access to the repo, then install `medtech-market-data`.
3. Remove the older standalone `cms-api` skill if you uploaded it. It overlaps with `cms-claims` and has outdated instructions.

**Claude Code only:**
```
/plugin marketplace add jdef11/medintel
/plugin install medtech-market-data@medintel-plugins
```

**Network:** these hosts must be reachable. On claude.ai, an organization owner may need to add them to the code-execution allowed domains:
- `data.cms.gov`
- `npiregistry.cms.hhs.gov`
- `openpaymentsdata.cms.gov`
- `api.fda.gov`
- `api.census.gov`

**Keys (environment variables):**
- `CENSUS_API_KEY`: required for the census skill (free at api.census.gov/data/key_signup.html). I don't know whether claude.ai's code sandbox lets you set environment variables, so the census skill may only work in Claude Code.
- `FDA_API_KEY`: optional; raises openFDA's rate limits.

## How it behaves

**Rules every skill follows:**
- **Numbers come only from live queries.** Every number Claude reports must come from a query it ran in that conversation, with the dataset and year cited. If a source is blocked, it says so and stops; it doesn't fall back on remembered figures.
- **Measured vs estimated.** Market-sizing answers keep measured figures and estimates (for example, a Medicare Advantage scale-up) separate, and show the formula and assumption behind each estimate.
- **Caveats.** Each skill tells Claude the traps for its source. Examples:
  - Billed "services" overcount surgeries.
  - Small providers are redacted from Medicare files.
  - Adverse-event report counts are not failure rates.
  - Manufacturer names differ between Open Payments and FDA.

**What the shared command-line tool (`medtech-data.mjs`) handles:**
- **Silent API failures:** an unknown column is ignored by data.cms.gov rather than rejected, and openFDA returns "not found" for an empty result. The tool turns these into clear errors.
- **Data years:** it maps each year to CMS's per-year dataset ID.
- **Paging and retries:** it pages through results and retries brief outages.
- **Corporate proxies:** it uses an `HTTPS_PROXY` setting when one is present.

## Making changes

```
plugins/medtech-market-data/
├── src/medtech-data.mjs        # THE CLI — edit this one
├── src/ground-rules.md         # rules inserted into every SKILL.md
├── src/medtech-data.test.mjs   # offline tests (run by npm test)
├── build.mjs                   # copies the CLI into each skill, inserts the rules, validates, zips
└── skills/<name>/              # SKILL.md (edit the body, not the ground-rules block) + generated scripts/
```

1. Edit `src/medtech-data.mjs`, `src/ground-rules.md`, or a skill's `SKILL.md` body.
2. Run `node plugins/medtech-market-data/build.mjs`. Every skill carries its own copy of the CLI, because claude.ai chat can't share a file across skills.
3. Run `npm test`. It fails if any copy is out of date.
4. Run `node plugins/medtech-market-data/build.mjs --zip` → `plugins/medtech-market-data/dist/medtech-market-data.zip`, then re-upload it on claude.ai.
5. Optionally run `claude plugin validate plugins/medtech-market-data`.

## Checking it works

The offline tests cover the tool's internal logic, not the live APIs. To check the live side, run each skill's example commands, from its SKILL.md "Commands" block, through `node skills/<skill>/scripts/medtech-data.mjs`. Every example returned data on 2026-10-27 except Census, which has no key.

## Maintenance

Every API rule was verified live on 2026-10-26/27. These sources change without notice: in 2026 alone, CMS changed its catalog format, began blocking Node's default User-Agent, and blocked one URL form for the clinicians dataset. When something breaks, check these first:
- The dataset titles and fallback IDs at the top of `src/medtech-data.mjs` (`FAMILIES`, `LATEST_IDS`, `PD_ALIASES`, `OP_TYPES`).
- The User-Agent and the distribution-ID lookup (see the `cms-provider-data` skill). Never change the tool to imitate a browser.
