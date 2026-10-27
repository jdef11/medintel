# Eval: Georgia total-hip territory brief (all seven skills)

A multi-source task for checking how a model handles the plugin end to end. It touches:
- `cms-claims` (physician, outpatient, inpatient and enrollment data)
- `census` (`popest`)
- `cms-provider-data` (affiliations, star ratings, complications)
- `nppes`
- `open-payments`
- `openfda` (classification, 510(k), recall, enforcement)
- `medtech-market-intel`

Georgia, CPT 27130 and the total-hip product codes don't appear in any skill example, so models can't copy them.

## Prompt

> I'm a hip implant rep taking over the Georgia territory. Build me a territory brief for total hip replacement (CPT 27130), using the most recent full year of Medicare data available:
>
> 1. **Market size.** Medicare fee-for-service total hip replacement volume in Georgia, how it splits between hospital outpatient and inpatient settings, and an estimate that includes Medicare Advantage patients.
> 2. **Penetration.** Procedures per 1,000 Georgia residents aged 65 and over.
> 3. **Top surgeons.** The top 5 hip replacement surgeons in Georgia by Medicare volume, with NPIs, confirmed against the NPI registry (current practice address and specialty).
> 4. **Where they operate.** For each surgeon, their affiliated hospitals with CMS star ratings and hip/knee replacement complication rates.
> 5. **Industry relationships.** For each surgeon, which device and drug companies paid them in the most recent Open Payments year, how much, and whether any of it was royalties or consulting.
> 6. **Competitive landscape.** Which companies hold the most FDA 510(k) clearances for total hip implants, and any recalls of total hip implants initiated in 2025, with their recall class.
>
> Separate what's measured from what's estimated, and cite the source and year for every number.

## Answer key (live data as of 2026-10-27)

Recompute before reusing. CMS, Open Payments and openFDA all revise their data.

| Part | Expected |
|---|---|
| FFS volume, CY2024 | 4,892 (F) + 23 (O) = **4,915 beneficiaries** (8,599 billed lines are not procedures) |
| Hospital outpatient (`outGeo`) | 2,578 beneficiaries |
| Inpatient | DRG 469 + 470 = 876 discharges, **hip and knee mixed**, so it is not a hip count |
| MA-inclusive | `ffs-share --state GA --year 2024` = 0.4515 → **≈10,900 (estimate)** |
| 65+ population | 1,819,401 (Census PEP Vintage 2025, July 1, 2024) |
| Penetration | ≈5.6 per 1,000 FFS beneficiaries (measured), or ≈6.0 per 1,000 residents 65+ (estimated) |
| Top 5 surgeons (by `Tot_Benes`) | DeCook 1386794113 (230), Bradbury 1720019698 (105), Seng 1477674877 (95), Manfredi 1841343027 (89), Hope 1588637870 (85). #6 Hanna 84 |
| Open Payments PY2025 | DeCook $3.24M, of which **$2.96M is DePuy "Acquisitions"** (one payment), plus $125K Zimmer Biomet royalties. Bradbury $555K Zimmer Biomet royalties. Hope $17.2K consulting (Stryker, OMNIlife). Seng and Manfredi under $1K, no royalties or consulting |
| Hospitals | 17 CCNs. For example, Northside Hospital (110161): 3 stars, COMP_HIP_KNEE 2.9% (n=175, window 04/2023–03/2025) |
| 510(k)s | No single code. Top applicants across the total-hip codes: Biomet, Zimmer, DePuy, Smith & Nephew, the Stryker/Howmedica names, Exactech |
| 2025 recalls | About 9–10 events, depending on the code set. **All Class II** |

## Traps (score these)

1. **Surgeon ranking.** The top raw biller is a nurse practitioner (Kanclerz, 362). A physician assistant and two ASCs also outrank real surgeons. Pass: excludes them and says so.
2. **The DeCook "Acquisitions" payment.** Calling the $2.96M DePuy payment royalties or consulting is a serious error for a sales brief. Pass: identifies it as an acquisition payment, and names Zimmer Biomet as his royalty relationship.
3. **Penetration denominator.** FFS procedures ÷ all residents 65+ gives ≈2.7 per 1,000, which is mismatched. Pass: leads with a matched rate (5.6 or 6.0).
4. **Inpatient DRGs.** DRG 469/470 mixes hip and knee. Pass: doesn't present 876 as hip volume.
5. **Product codes.** Pass: finds several total-hip codes via `classification` and says which it used.
6. **Recall class.** Pass: gets the class from `enforcement` (via `recall_number`), not by guessing.
7. **Measured vs estimated.** Pass: the MA-inclusive figure and any derived split are labeled as estimates, with the formula shown, and there are no uncertainty ranges from nowhere.

## Results, 2026-10-27 (skills as of commit f8823df)

| | Haiku | Sonnet |
|---|---|---|
| Traps passed | 6 / 7. Led penetration with the mismatched 2.7, labeled "measured" | 6.5 / 7. Gave 5.6 and 6.0 but listed 2.7 first |
| Numbers vs key | All match | All match |
| Extras | Hip-only inpatient estimate (≈325), labeled; Open Payments ownership/research checked | Practice groups (PAC), ASC share, 2021–25 clearance activity |
| Stray actions | One unrelated `send_message` attempt (rejected) | None |
| Tool calls / time | 33 / 8.8 min | 24 / 7.0 min |
