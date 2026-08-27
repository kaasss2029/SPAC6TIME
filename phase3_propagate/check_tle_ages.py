import json
import csv
from datetime import datetime

CATALOG_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
EVENTS_FILE = "conjunction_events_20s.csv"

with open(CATALOG_FILE) as f:
    catalog = json.load(f)

now = datetime.utcnow()

with open(EVENTS_FILE) as f:
    events = list(csv.DictReader(f))

print("===== TLE AGE CHECK =====\n")

for event in events:
    for key in ["norad_a", "norad_b"]:
        norad = event[key]
        rec = catalog.get(str(norad))

        if not rec:
            print(norad, "NOT FOUND")
            continue

        epoch_str = rec.get("epoch")

        if not epoch_str:
            print(norad, rec.get("name"), "NO EPOCH")
            continue

        epoch = datetime.fromisoformat(epoch_str.replace("Z", ""))
        age_days = (now - epoch).total_seconds() / 86400.0

        print(
            f"{norad:>6} | "
            f"{rec.get('name', ''):<30} | "
            f"epoch={epoch_str:<25} | "
            f"age={age_days:8.2f} days"
        )
