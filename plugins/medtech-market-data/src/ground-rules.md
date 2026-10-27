## Ground rules (shared by every medtech-market-data skill)

**Running the tool.** Every skill in this plugin ships the same zero-dependency Node 18+ CLI at `scripts/medtech-data.mjs` inside its own folder:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/medtech-data.mjs help
```

If `${CLAUDE_SKILL_DIR}` appears literally instead of as a path (claude.ai chat doesn't substitute it), use the path to this skill's folder, i.e. the directory holding this SKILL.md. Data goes to stdout (`--format json|csv|ndjson`). Progress, row counts, the dataset/year/ID used, and warnings go to stderr. `--url` prints every request.

**Only report numbers you queried.** Every figure you give must come from a query you ran in this conversation. Nothing in this plugin's files is data: any number in them illustrates a pitfall and may be stale. Never present a documented, remembered or estimated figure as a result.

**When a source can't be reached, say so and stop.** Name the host that needs allowing:
- `data.cms.gov`
- `npiregistry.cms.hhs.gov`
- `openpaymentsdata.cms.gov`
- `api.fda.gov`
- `api.census.gov`

An HTML "Access Denied" page from a CMS host is a block on the client or network, not an empty answer. Don't retry in a loop. Never disguise the client (for example, a browser User-Agent) or route around a block.

**Cite every number.** Give its source dataset, its data year or period, and what it measures (for example, "Medicare fee-for-service beneficiaries, CY2024"). For questions that combine sources (market sizing, linking surgeons to payments or devices), also load the `medtech-market-intel` skill.
