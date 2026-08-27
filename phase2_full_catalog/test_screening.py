"""
Validates the new screening algorithm against a naive O(n^2) brute force
on a subset small enough to brute-force exhaustively, checking:
  1. Zero false negatives (every brute-force-overlapping pair is found)
  2. Zero duplicates (every pair appears exactly once)
  3. Zero false positives beyond the intended (safe, generous) definition
Also stress-tests with eccentric (GTO) objects mixed in, since that's
exactly the case that broke the old bin-based approach.
"""
import json, random
from screening import Obj, radius_interval_pairs

random.seed(7)

with open("synthetic_catalog.json") as f:
    raw = json.load(f)

# Take a random subset (small enough to brute-force: a few hundred),
# but FORCE-include all the eccentric GTO objects so the stress case
# that broke v2 is actually exercised.
gto = [o for o in raw if o["name"].startswith("GTO")]
others = [o for o in raw if not o["name"].startswith("GTO")]
subset_raw = gto + random.sample(others, 400)
random.shuffle(subset_raw)

objects = [Obj(idx=i, norad_id=o["norad_id"], name=o["name"],
                perigee_km=o["perigee_km"], apogee_km=o["apogee_km"],
                inclination_deg=o["inclination_deg"], raan_deg=o["raan_deg"])
           for i, o in enumerate(subset_raw)]

BUFFER_KM = 50.0

def brute_force_pairs(objs, buffer_km):
    out = set()
    n = len(objs)
    for i in range(n):
        lo_i, hi_i = objs[i].perigee_km - buffer_km, objs[i].apogee_km + buffer_km
        for j in range(i+1, n):
            lo_j, hi_j = objs[j].perigee_km - buffer_km, objs[j].apogee_km + buffer_km
            if not (hi_i < lo_j or hi_j < lo_i):
                out.add((i, j))
    return out

brute = brute_force_pairs(objects, BUFFER_KM)

swept_list = list(radius_interval_pairs(objects, BUFFER_KM))
swept_set = set(swept_list)

print(f"objects in test set: {len(objects)}  (includes {len(gto)} eccentric GTO objects)")
print(f"brute-force pair count : {len(brute)}")
print(f"swept pair count        : {len(swept_set)}")
print(f"swept raw (pre-dedup) len: {len(swept_list)}   <- should equal set size (no duplicates)")

missing = brute - swept_set          # false negatives -- must be empty
extra   = swept_set - brute          # false positives -- fine if empty too (should match exactly here)
dupes   = len(swept_list) != len(swept_set)

print(f"\nFALSE NEGATIVES (missed real candidates): {len(missing)}  {'<-- BUG' if missing else '(none, good)'}")
print(f"FALSE POSITIVES (extra vs brute force)   : {len(extra)}  {'<-- unexpected' if extra else '(none, exact match)'}")
print(f"DUPLICATE PAIRS EMITTED                  : {'YES <-- BUG' if dupes else 'NO (good)'}")

assert not missing, "FALSE NEGATIVE DETECTED -- algorithm is unsafe"
assert not extra, "unexpected extra pairs -- algorithm over-generating incorrectly"
assert not dupes, "duplicate pairs detected"
print("\nALL CORRECTNESS CHECKS PASSED.")
