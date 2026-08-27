import json
import numpy as np
from datetime import datetime, timedelta
from sgp4.api import Satrec, jday


# ============================================================
# CONFIGURATION
# ============================================================

CATALOG_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
OUTPUT_FILE = "../dashboard/orbit_data.json"

DEMO_EPOCH = datetime(2026, 8, 26, 12, 0, 0)

PROPAGATION_HOURS = 72
STEP_MINUTES = 60

# Objects to visualize.
# These are selected from the actual conjunction dataset.
OBJECTS = [
    "24954",   # FAISAT 2V
    "13302",   # SL-8 R/B
    "5680",    # OPS 7898 (P/L 2)
    "30683",   # FENGYUN 1C DEB
    "40054",   # AISAT
    "35023",   # COSMOS 2251 DEB
]


# ============================================================
# LOAD CATALOG
# ============================================================

with open(CATALOG_FILE, "r") as f:
    catalog = json.load(f)


# ============================================================
# CREATE SGP4 SATELLITE OBJECT
# ============================================================

def make_satrec(norad_id):

    rec = catalog.get(str(norad_id)) or catalog.get(norad_id)

    if not rec:
        print(f"WARNING: NORAD {norad_id} not found in catalog")
        return None, None

    if not rec.get("tle_line1") or not rec.get("tle_line2"):
        print(f"WARNING: NORAD {norad_id} has no TLE")
        return None, None

    sat = Satrec.twoline2rv(
        rec["tle_line1"],
        rec["tle_line2"]
    )

    return sat, rec


# ============================================================
# PROPAGATE ONE OBJECT
# ============================================================

def propagate(sat, t):

    jd, fr = jday(
        t.year,
        t.month,
        t.day,
        t.hour,
        t.minute,
        t.second + t.microsecond / 1e6
    )

    error, position, velocity = sat.sgp4(jd, fr)

    if error != 0:
        return None

    return np.asarray(position)


# ============================================================
# MAIN
# ============================================================

orbit_data = []

print("===== ORBIT DATA EXPORT =====")
print(f"Demo epoch : {DEMO_EPOCH.isoformat()}")
print(f"Window     : {PROPAGATION_HOURS} hours")
print(f"Step       : {STEP_MINUTES} minutes")
print()


for norad_id in OBJECTS:

    sat, rec = make_satrec(norad_id)

    if sat is None:
        continue

    positions = []

    total_steps = int(
        PROPAGATION_HOURS * 60 / STEP_MINUTES
    ) + 1

    for i in range(total_steps):

        t = DEMO_EPOCH + timedelta(
            minutes=i * STEP_MINUTES
        )

        position = propagate(sat, t)

        if position is None:
            continue

        positions.append({
            "t": t.isoformat(),

            "x": round(float(position[0]), 3),
            "y": round(float(position[1]), 3),
            "z": round(float(position[2]), 3)
        })

    orbit_data.append({
        "norad": str(norad_id),
        "name": rec.get("name", f"NORAD {norad_id}"),
        "frame": "TEME",
        "positions": positions
    })

    print(
        f"{rec.get('name', 'UNKNOWN'):30s} "
        f"NORAD {norad_id}: "
        f"{len(positions)} positions"
    )


# ============================================================
# FINAL OUTPUT
# ============================================================

output = {
    "metadata": {
        "demo_mode": True,
        "demo_epoch": DEMO_EPOCH.isoformat(),
        "window_hours": PROPAGATION_HOURS,
        "step_minutes": STEP_MINUTES,
        "frame": "TEME",
        "source": "SGP4 propagation from Phase 2 TLE catalog"
    },

    "objects": orbit_data
}


with open(OUTPUT_FILE, "w") as f:
    json.dump(
        output,
        f,
        indent=2
    )


print()
print(f"Objects exported : {len(orbit_data)}")
print(f"Output           : {OUTPUT_FILE}")
print("===== EXPORT COMPLETE =====")
