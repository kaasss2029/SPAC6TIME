import json
import csv
import numpy as np
from datetime import datetime, timedelta
from sgp4.api import Satrec, jday

CACHE_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
PAIRS_FILE = "../phase2_full_catalog/candidate_pairs.csv"

WINDOW_HOURS = 72
COARSE_STEP_SEC = 60

def propagate(sat, t):
    jd, fr = jday(
        t.year, t.month, t.day,
        t.hour, t.minute,
        t.second + t.microsecond / 1e6
    )
    e, r, v = sat.sgp4(jd, fr)
    if e != 0:
        return None
    return np.array(r)

with open(CACHE_FILE) as f:
    catalog = json.load(f)

with open(PAIRS_FILE) as f:
    r = csv.reader(f)
    next(r)
    pairs = list(r)[:2000]

now = datetime.utcnow()

results = []

for pair_num, (a, b) in enumerate(pairs, 1):
    rec_a = catalog.get(str(a))
    rec_b = catalog.get(str(b))

    sat_a = Satrec.twoline2rv(
        rec_a["tle_line1"],
        rec_a["tle_line2"]
    )
    sat_b = Satrec.twoline2rv(
        rec_b["tle_line1"],
        rec_b["tle_line2"]
    )

    best_d = float("inf")
    best_t = None

    n_steps = int(WINDOW_HOURS * 3600 / COARSE_STEP_SEC)

    for i in range(n_steps):
        t = now + timedelta(seconds=i * COARSE_STEP_SEC)

        ra = propagate(sat_a, t)
        rb = propagate(sat_b, t)

        if ra is None or rb is None:
            continue

        d = np.linalg.norm(ra - rb)

        if d < best_d:
            best_d = d
            best_t = t

    results.append((best_d, a, b, best_t))

results.sort()

print()
print("===== CLOSEST 20 PAIRS =====")

for d, a, b, t in results[:20]:
    print(
        f"{a} <-> {b}   "
        f"min distance = {d:.3f} km   "
        f"time = {t}"
    )

print()
print("Minimum distance among 200 pairs:", results[0][0], "km")
