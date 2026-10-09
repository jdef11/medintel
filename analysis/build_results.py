#!/usr/bin/env python3
"""Build results.xlsx (tidy table + query log + code list) from raw/*.json written by fetch-cms.mjs.

Never imputes: a (year, code, place) with no returned row is emitted as 'suppressed'
(CMS does not distinguish a suppressed cell from a true zero in this dataset).
"""
import json, os, sys
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))
SETTING = "Medicare Part B FFS - physician/practitioner services (CMS Geography & Service)"
DX_POS = "n/a (procedure-based proxy; source has no diagnosis field)"
STD_ERR = "n/a (complete FFS claims, not a sample)"

# code -> (tier, family label). Tiers are defined in methods.md.
CODES = {
    "29866": ("A", "Osteochondral autograft, knee, arthroscopic"),
    "29867": ("A", "Osteochondral allograft, knee, arthroscopic"),
    "27412": ("A", "Autologous chondrocyte implantation, knee"),
    "27415": ("A", "Osteochondral allograft, knee, open"),
    "27416": ("A", "Osteochondral autograft, knee, open"),
    "28446": ("A", "Osteochondral talus graft (OATS/allograft)"),
    "29879": ("B", "Abrasion arthroplasty / microfracture, knee"),
    "29885": ("B", "Drilling for OCD with debridement, knee"),
    "29886": ("B", "Drilling for intact OCD, knee"),
    "29887": ("B", "Drilling for OCD with fixation, knee"),
    "29877": ("C", "Chondroplasty / debridement, knee (arthroscopic)"),
    "G0289": ("C", "Chondroplasty/loose body at time of other knee arthroscopy"),
    "29862": ("C", "Hip arthroscopy chondroplasty/debridement"),
}
PLACES = {"F": "facility (hospital outpatient/ASC/inpatient)", "O": "office/non-facility"}
MEASURES = [("Tot_Srvcs", "services"), ("Tot_Benes", "beneficiaries"), ("Tot_Rndrng_Prvdrs", "rendering_providers")]

log = [json.loads(l) for l in open(os.path.join(HERE, "raw", "query-log.jsonl"))]
rows, desc = [], {}
for q in log:
    if q.get("http_status") != 200:
        print("WARN query failed:", q["query_id"], q.get("http_status"), q.get("error"), file=sys.stderr)
        continue
    data = json.load(open(os.path.join(HERE, "raw", q["query_id"] + ".json")))
    data = [d for d in data if d.get("HCPCS_Cd") == q["code"] and d.get("Rndrng_Prvdr_Geo_Lvl") == "National"]
    by_place = {d["Place_Of_Srvc"]: d for d in data}
    for d in data:
        desc[(q["code"], q["year"])] = d.get("HCPCS_Desc")
    tier, label = CODES[q["code"]]
    for pl in PLACES:
        d = by_place.get(pl)
        for field, measure in MEASURES:
            supp = d is None
            rows.append([
                q["year"], SETTING, f"Tier {tier}: {q['code']} {label}", DX_POS,
                "place_of_service", f"{pl} - {PLACES[pl]}",
                "suppressed" if supp else float(d[field]), STD_ERR,
                supp, q["query_id"], measure, q["code"],
                (desc.get((q["code"], q["year"])) or ""), q["dataset_uuid"],
            ])

hdr = ["year", "setting", "code_family", "dx_position", "breakdown_var", "breakdown_value",
       "estimate", "std_error", "suppressed_flag", "query_id",
       "measure", "hcpcs_code", "cms_descriptor", "source_dataset_uuid"]
wb = Workbook()
ws = wb.active; ws.title = "results"
ws.append(hdr)
for r in sorted(rows, key=lambda r: (r[0], r[11], r[5], r[10])):
    ws.append(r)
ws2 = wb.create_sheet("query_log")
ws2.append(["query_id", "year", "hcpcs_code", "dataset_uuid", "url", "requested_at_utc", "http_status", "row_count"])
for q in log:
    ws2.append([q["query_id"], q["year"], q["code"], q["dataset_uuid"], q["url"], q["requested_at"], q.get("http_status"), q.get("row_count")])
ws3 = wb.create_sheet("code_list")
ws3.append(["hcpcs_code", "tier", "label_used_here", "cms_descriptor_latest_year_found"])
for c, (t, l) in CODES.items():
    latest = max([y for (cc, y) in desc if cc == c], default=None)
    ws3.append([c, t, l, desc.get((c, latest), "NOT FOUND IN ANY YEAR") if latest else "NOT FOUND IN ANY YEAR"])
wb.save(os.path.join(HERE, "results.xlsx"))
print("wrote", len(rows), "rows")
