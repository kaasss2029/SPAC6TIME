import json
from datetime import datetime

import phase3_propagate as vec
import phase3_propagate_BEFORE_VECTOR as old

NORAD_A = "24954"
NORAD_B = "5680"

with open("../phase2_full_catalog/leo_catalog_cache.json") as f:
    catalog = json.load(f)

sat_a_data = vec.make_satrec(catalog, NORAD_A)
sat_b_data = vec.make_satrec(catalog, NORAD_B)

assert sat_a_data is not None, "Could not build satellite A"
assert sat_b_data is not None, "Could not build satellite B"

sat_a, rec_a = sat_a_data
sat_b, rec_b = sat_b_data


start = datetime.utcnow()

old_ca = old.closest_approach(
    sat_a, sat_b,
    start,
    old.WINDOW_HOURS
)

vec_ca = vec.closest_approach(
    sat_a, sat_b,
    start,
    vec.WINDOW_HOURS
)
print("\n===== KNOWN PAIR COMPARISON =====")
print(f"{rec_a.get('name')} ({NORAD_A})")
print(f"{rec_b.get('name')} ({NORAD_B})")

print("\nOLD SCALAR:")
print(old_ca)

print("\nVECTORIZED:")
print(vec_ca)

assert old_ca is not None
assert vec_ca is not None

miss_diff = abs(old_ca["miss_km"] - vec_ca["miss_km"])
vel_diff = abs(old_ca["rel_vel_kms"] - vec_ca["rel_vel_kms"])

print("\n===== DIFFERENCES =====")
print(f"Miss distance difference: {miss_diff:.9f} km")
print(f"Relative velocity difference: {vel_diff:.9f} km/s")
print(f"TCA difference: {abs((old_ca['tca'] - vec_ca['tca']).total_seconds()):.6f} seconds")

assert miss_diff < 0.01, "Miss distance mismatch is too large"
assert vel_diff < 0.01, "Relative velocity mismatch is too large"

print("\nPASS: Vectorized and scalar implementations agree.")

assert vel_diff < 0.01, "Relative velocity mismatch is too large"
print("\nPASS: Vectorized and scalar implementations agree.")
