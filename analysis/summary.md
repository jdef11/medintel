# Summary — Medicare FFS cartilage-procedure proxy, CY2016–2024

**Not diagnosis counts.** CMS public Medicare data (Part B, national, "by Geography and Service") has no ICD-10-CM field, so this is billed **professional services** for 13 cartilage-related HCPCS codes, grouped into three tiers by CMS descriptor (see `methods.md` §3; code list is unvalidated against the AMA CPT book). Setting = place of service (F = facility, O = office), not NASS/NIS/NEDS. `*` = total is a lower bound because at least one code-cell was suppressed (≤10 beneficiaries); "suppressed" ≠ zero.

Total billed services per year:

| Year | Tier A (F) | Tier B (F) | Tier C (F) | Tier A (O) | Tier B (O) | Tier C (O) |
|---|---|---|---|---|---|---|
| 2016 | 221* | 13,796 | 12,105 | suppressed | 178* | 335 |
| 2017 | 207* | 12,643 | 11,578 | suppressed | 187* | 293 |
| 2018 | 228* | 12,044 | 10,848 | suppressed | 146* | 239 |
| 2019 | 227* | 11,387 | 10,267 | suppressed | 94* | 247 |
| 2020 | 254* | 8,915 | 7,751 | suppressed | 111* | 218 |
| 2021 | 251* | 8,538 | 7,180 | suppressed | 144* | 158* |
| 2022 | 172* | 7,603 | 6,473 | suppressed | 126* | 178 |
| 2023 | 127* | 6,720 | 5,723 | suppressed | 108* | 137* |
| 2024 | 155* | 6,101 | 4,933 | suppressed | 116* | 98 |

## Three biggest caveats
1. **Procedures, not diagnoses, and Medicare FFS only.** None of the requested ICD-10-CM families (M93.2-, M94.2-, etc.) are counted. Cartilage-defect treatment skews under 65, so Medicare FFS is a small slice; these numbers cannot be scaled to a national market without an external ratio I have not supplied.
2. **Tier A (the graft/implant codes closest to resurfacing) is tiny and heavily suppressed.** 155–254 services/yr in facilities; office is fully suppressed; code 27412 never appears in any year. Tier B/C are large but mostly arthroscopic repair/shaving and include non-focal-defect indications, so they overstate the addressable pool. Tiers are not summed.
3. **Code list is my judgment, partly recalled from memory and not CPT-verified.** CMS descriptors for 27415/27416/28446 ("cartilage cells") differ from what I expected; the table uses CMS's text only. 2020–2021 are COVID-depressed. Age/sex/payer breakdowns and standard errors do not exist in this source.
