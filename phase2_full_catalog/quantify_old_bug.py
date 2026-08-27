"""
Quantify, concretely, how many real candidate pairs the OLD (v2, RAAN-binned)
filter would have silently thrown away as false negatives, using the same
synthetic catalog. We compare:
  - TRUE candidates: radius-band overlap only (the proven-safe criterion)
  - OLD FILTER survivors: also requires RAAN to be within the v2 script's
    +/-1 neighbor-bin window (RAAN_BIN_SIZE_DEG=5 -> effectively same or
    adjacent 5deg bin, ~15deg window before wraparound)
Only within the megaconstellation shell (MEGA-A), where this matters most.
"""
import json
from screening import Obj, radius_interval_pairs

with open("synthetic_catalog.json") as f:
    raw = json.load(f)

shell = [o for o in raw if o["name"].startswith("MEGA-A")]
objects = [Obj(idx=i, norad_id=o["norad_id"], name=o["name"],
                perigee_km=o["perigee_km"], apogee_km=o["apogee_km"],
                inclination_deg=o["inclination_deg"], raan_deg=o["raan_deg"])
           for i, o in enumerate(shell)]

BUFFER_KM = 50.0
RAAN_BIN = 5.0

true_pairs = list(radius_interval_pairs(objects, BUFFER_KM))
print(f"MEGA-A shell: {len(objects)} objects, {len(true_pairs):,} TRUE (safe) candidate pairs")

def raan_bin(o): 
    return int(o.raan_deg // RAAN_BIN)

def old_filter_would_keep(oa, ob):
    ba, bb = raan_bin(oa), raan_bin(ob)
    # old code's HALF_NEIGHBOR_OFFSETS covers d_raan in {-1,0,1}
    diff = min(abs(ba-bb), 72-abs(ba-bb))  # 360/5=72 bins, wraparound
    return diff <= 1

kept, dropped = 0, 0
for i, j in true_pairs:
    if old_filter_would_keep(objects[i], objects[j]):
        kept += 1
    else:
        dropped += 1

print(f"old v2 RAAN-binned filter would have KEPT   : {kept:,}")
print(f"old v2 RAAN-binned filter would have DROPPED: {dropped:,}  <-- these are FALSE NEGATIVES")
print(f"fraction silently discarded: {dropped/len(true_pairs)*100:.2f}%")
