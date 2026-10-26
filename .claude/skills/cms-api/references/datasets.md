# Column reference

Columns as served for CY2024 (verified 2026-10-26 via `/data-viewer?size=0`). Older years occasionally differ, so `node scripts/cms.mjs columns <alias> --year Y` is authoritative.

## provider: Physician & Other Practitioners by Provider and Service (~9.8M rows/yr)

`Rndrng_NPI`, `Rndrng_Prvdr_Last_Org_Name`, `Rndrng_Prvdr_First_Name`, `Rndrng_Prvdr_MI`, `Rndrng_Prvdr_Crdntls`, `Rndrng_Prvdr_Ent_Cd` (I/O), `Rndrng_Prvdr_St1`, `Rndrng_Prvdr_St2`, `Rndrng_Prvdr_City`, `Rndrng_Prvdr_State_Abrvtn`, `Rndrng_Prvdr_State_FIPS`, `Rndrng_Prvdr_Zip5`, `Rndrng_Prvdr_RUCA`, `Rndrng_Prvdr_RUCA_Desc`, `Rndrng_Prvdr_Cntry`, `Rndrng_Prvdr_Type` (specialty), `Rndrng_Prvdr_Mdcr_Prtcptg_Ind`, `HCPCS_Cd`, `HCPCS_Desc`, `HCPCS_Drug_Ind`, `Place_Of_Srvc` (F/O), `Tot_Benes`, `Tot_Srvcs`, `Tot_Bene_Day_Srvcs`, `Avg_Sbmtd_Chrg`, `Avg_Mdcr_Alowd_Amt`, `Avg_Mdcr_Pymt_Amt`, `Avg_Mdcr_Stdzd_Amt`

Last names are stored in mixed case ("Enkeshafi"). `CONTAINS` is case-insensitive, so this doesn't matter for matching.

## provSummary: Physician & Other Practitioners by Provider (~1.3M rows/yr)

The same `Rndrng_*` identity columns as `provider`, plus `Tot_HCPCS_Cds`, `Tot_Benes` (true distinct), `Tot_Srvcs`, `Tot_Sbmtd_Chrg`, `Tot_Mdcr_Alowd_Amt`, `Tot_Mdcr_Pymt_Amt`, `Tot_Mdcr_Stdzd_Amt`. It also has drug/medical splits (`Drug_*`, `Med_*`), beneficiary demographics (`Bene_Avg_Age`, `Bene_Age_*_Cnt`, `Bene_Feml_Cnt`, `Bene_Male_Cnt`, `Bene_Race_*_Cnt`, `Bene_Dual_Cnt`, `Bene_Ndual_Cnt`), chronic-condition prevalence (`Bene_CC_BH_*_Pct`, `Bene_CC_PH_*_Pct`), and `Bene_Avg_Risk_Scre`.

## geography: Physician & Other Practitioners by Geography and Service (~270k rows/yr)

`Rndrng_Prvdr_Geo_Lvl` (National/State), `Rndrng_Prvdr_Geo_Cd`, `Rndrng_Prvdr_Geo_Desc` (full state name), `HCPCS_Cd`, `HCPCS_Desc`, `HCPCS_Drug_Ind`, `Place_Of_Srvc`, `Tot_Rndrng_Prvdrs`, `Tot_Benes`, `Tot_Srvcs`, `Tot_Bene_Day_Srvcs`, `Avg_Sbmtd_Chrg`, `Avg_Mdcr_Alowd_Amt`, `Avg_Mdcr_Pymt_Amt`, `Avg_Mdcr_Stdzd_Amt`

## inpProvider: Inpatient Hospitals by Provider and Service (~146k rows/yr)

`Rndrng_Prvdr_CCN`, `Rndrng_Prvdr_Org_Name`, `Rndrng_Prvdr_City`, `Rndrng_Prvdr_St` (street, not state), `Rndrng_Prvdr_State_FIPS`, `Rndrng_Prvdr_Zip5`, `Rndrng_Prvdr_State_Abrvtn`, `Rndrng_Prvdr_RUCA`, `Rndrng_Prvdr_RUCA_Desc`, `DRG_Cd`, `DRG_Desc`, `Tot_Dschrgs`, `Avg_Submtd_Cvrd_Chrg` (note the spelling: `Submtd`, not the physician files' `Sbmtd`), `Avg_Tot_Pymt_Amt`, `Avg_Mdcr_Pymt_Amt`

## inpGeo: Inpatient Hospitals by Geography and Service (~27k rows/yr)

`Rndrng_Prvdr_Geo_Lvl`, `Rndrng_Prvdr_Geo_Cd`, `Rndrng_Prvdr_Geo_Desc`, `DRG_Cd`, `DRG_Desc`, `Tot_Dschrgs`, `Avg_Submtd_Cvrd_Chrg`, `Avg_Tot_Pymt_Amt`, `Avg_Mdcr_Pymt_Amt`

`DRG_Cd` is a 3-character string. If a DRG below 100 doesn't match, try both the zero-padded form (`"023"`) and the bare form (`"23"`).

## dmeGeo: DMEPOS by Geography and Service (~40k rows/yr)

`Rfrg_Prvdr_Geo_Lvl` (not `Rndrng_`), `Rfrg_Prvdr_Geo_Cd`, `Rfrg_Prvdr_Geo_Desc`, `RBCS_Lvl`, `RBCS_Id`, `RBCS_Desc`, `HCPCS_Cd`, `HCPCS_Desc`, `Suplr_Rentl_Ind`, `Tot_Rfrg_Prvdrs`, `Tot_Suplrs`, `Tot_Suplr_Benes`, `Tot_Suplr_Clms`, `Tot_Suplr_Srvcs`, `Avg_Suplr_Sbmtd_Chrg`, `Avg_Suplr_Mdcr_Alowd_Amt`, `Avg_Suplr_Mdcr_Pymt_Amt`, `Avg_Suplr_Mdcr_Stdzd_Amt`

## dmeReferring: DMEPOS by Referring Provider and Service (~1.35M rows/yr)

`Rfrg_NPI`, `Rfrg_Prvdr_Last_Name_Org`, `Rfrg_Prvdr_First_Name`, `Rfrg_Prvdr_MI`, `Rfrg_Prvdr_Crdntls`, `Rfrg_Prvdr_Ent_Cd`, `Rfrg_Prvdr_St1`, `Rfrg_Prvdr_St2`, `Rfrg_Prvdr_City`, `Rfrg_Prvdr_State_Abrvtn`, `Rfrg_Prvdr_State_FIPS`, `Rfrg_Prvdr_Zip5`, `Rfrg_Prvdr_RUCA_Cat`, `Rfrg_Prvdr_RUCA`, `Rfrg_Prvdr_RUCA_Desc`, `Rfrg_Prvdr_Cntry`, `Rfrg_Prvdr_Spclty_Cd`, `Rfrg_Prvdr_Spclty_Desc`, `Rfrg_Prvdr_Spclty_Srce`, `RBCS_Lvl`, `RBCS_Id`, `RBCS_Desc`, **`HCPCS_CD`** (capital D, unlike every other file), `HCPCS_Desc`, `Suplr_Rentl_Ind`, `Tot_Suplrs`, `Tot_Suplr_Benes`, `Tot_Suplr_Clms`, `Tot_Suplr_Srvcs`, `Avg_Suplr_Sbmtd_Chrg`, `Avg_Suplr_Mdcr_Alowd_Amt`, `Avg_Suplr_Mdcr_Pymt_Amt`, `Avg_Suplr_Mdcr_Stdzd_Amt`

## Provider Data Catalog datasets (`pd` command)

| Alias | Id | Use | Key fields |
|---|---|---|---|
| `clinicians` | `mj5m-pzi6` | Doctors and Clinicians National Downloadable File (PECOS enrollment) | `npi`, `org_pac_id` (billing group), `facility_name`, `num_org_mem`, `citytown`, `state`, `zip_code` |
| `facilityAff` | `27ea-46a8` | Facility Affiliation Data | `npi`, `facility_type` (Hospital, Home health agency, …), `facility_affiliations_certification_number` (CCN) |
| `hospitals` | `xubh-q36u` | Hospital General Information | `facility_id` (CCN), `facility_name`, `citytown`, `state`, `hospital_type`, `hospital_overall_rating` |

- An NPI can have **several** `clinicians` rows (several practices). Disambiguate by matching city, state, and zip to the claims address. Don't take the first row.
- An NPI can be affiliated with **several** hospitals. If you roll up by hospital, the per-hospital totals overlap and can't be summed.

Any other Provider Data Catalog dataset works by id. Browse them at https://data.cms.gov/provider-data/. Unknown fields return a 400 error, so a typo surfaces immediately.
