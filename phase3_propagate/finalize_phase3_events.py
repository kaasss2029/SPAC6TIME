import json
import csv
import math
from datetime import datetime

CATALOG_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
INPUT_FILE = "conjunction_events_20s_RAW.csv"
OUTPUT_FILE = "conjunction_events_20s_FINAL.csv"

MAX_TLE_AGE_DAYS = 14
def tle_age_days(epoch_str, now):
    epoch = datetime.fromisoformat(epoch_str.replace("Z", ""))
    return (now - epoch).total_seconds() / 86400.0
def estimate_sigma_km(age_days):
    """
    Simplified TLE-age uncertainty model.
    Used only for fresh-enough TLEs.
    """
    base_sigma_km = 0.5
    growth_km_per_day = 0.75

    return base_sigma_km + growth_km_per_day * max(age_days, 0)
def pc_2d_approx(miss_km, combined_sigma_km):
    """
    Simplified encounter-plane Pc approximation.
    Hackathon/demo approximation, not an operational covariance solution.
    """
    HBR_KM = 0.02
    sigma = max(combined_sigma_km, 1e-6)
    pc = (
        0.5
        * (HBR_KM / sigma) ** 2
        * math.exp(-(miss_km ** 2) / (2 * sigma ** 2))
    )
    return min(pc, 1.0)
with open(CATALOG_FILE) as f:
    catalog = json.load(f)

with open(INPUT_FILE) as f:
    events = list(csv.DictReader(f))

now = datetime.utcnow()

final_events = []
rejected_events = []
for event in events:

    norad_a = event["norad_a"]
    norad_b = event["norad_b"]

    rec_a = catalog.get(str(norad_a))
    rec_b = catalog.get(str(norad_b))

    if not rec_a or not rec_b:
        print(
            f"REJECTED {norad_a} <-> {norad_b}: "
            "missing catalog record"
        )
        rejected_events.append(event)
        continue
    age_a = tle_age_days(rec_a["epoch"], now)
    age_b = tle_age_days(rec_b["epoch"], now)

    if age_a > MAX_TLE_AGE_DAYS or age_b > MAX_TLE_AGE_DAYS:

        print(
            f"REJECTED {event['name_a']} <-> {event['name_b']}"
        )
        print(
            f"  TLE ages: "
            f"{age_a:.2f} days, {age_b:.2f} days"
        )

        rejected_events.append(event)
        continue
    sigma_a = estimate_sigma_km(age_a)
    sigma_b = estimate_sigma_km(age_b)

    combined_sigma = math.sqrt(
        sigma_a ** 2 + sigma_b ** 2
    )

    miss_km = float(event["miss_km"])

    pc = pc_2d_approx(
        miss_km,
        combined_sigma
    )

    event["combined_sigma_km"] = round(
        combined_sigma,
        3
    )

    event["pc"] = pc

    final_events.append(event)
final_events.sort(
    key=lambda r: -float(r["pc"])
)

fieldnames = [
    "norad_a",
    "name_a",
    "norad_b",
    "name_b",
    "tca",
    "miss_km",
    "rel_vel_kms",
    "combined_sigma_km",
    "pc",
]
with open(
    OUTPUT_FILE,
    "w",
    newline=""
) as f:

    writer = csv.DictWriter(
        f,
        fieldnames=fieldnames
    )

    writer.writeheader()

    writer.writerows(final_events)
print()
print("===== PHASE 3 FINALIZATION =====")
print(f"Input events:     {len(events)}")
print(f"Accepted events:  {len(final_events)}")
print(f"Rejected events:  {len(rejected_events)}")
print(
    f"TLE age limit:    "
    f"{MAX_TLE_AGE_DAYS} days"
)
print(f"Output file:      {OUTPUT_FILE}")
