import json, random
from screening import Obj, asset_vs_catalog_pairs

random.seed(3)
with open("synthetic_catalog.json") as f:
    raw = json.load(f)

catalog_raw = raw
assets_raw = [o for o in raw if o.get("owner") == "ISRO"]

def mk(o, i):
    return Obj(idx=i, norad_id=o["norad_id"], name=o["name"],
               perigee_km=o["perigee_km"], apogee_km=o["apogee_km"],
               inclination_deg=o["inclination_deg"], raan_deg=o["raan_deg"])

# catalog = [mk(o, i) for i, o in enumerate(catalog_raw)]
# assets = [mk(o, i) for i, o in enumerate(assets_raw)]
catalog = [mk(o, i) for i, o in enumerate(catalog_raw)]
assets = [catalog[i] for i, o in enumerate(catalog_raw) if o.get("owner") == "ISRO"]

BUFFER_KM = 50.0

# def brute(assets, catalog, buf):
#     out = set()
#     for a in assets:
#         a_lo, a_hi = a.perigee_km-buf, a.apogee_km+buf
#         for c in catalog:
#             # An object must never be paired with itself.
#             if a.idx == c.idx:
#                 continue
#             c_lo, c_hi = c.perigee_km-buf, c.apogee_km+buf
#             if not (a_hi < c_lo or c_hi < a_lo):
#                 out.add((a.idx, c.idx))
#     return out
def brute(assets, catalog, buf):
    out = set()
    for a in assets:
        a_lo, a_hi = a.perigee_km - buf, a.apogee_km + buf
        for c in catalog:
            # Never pair an object with itself.
            if a.norad_id == c.norad_id:
                continue
            c_lo, c_hi = c.perigee_km - buf, c.apogee_km + buf
            if not (a_hi < c_lo or c_hi < a_lo):
                # Treat A-B and B-A as the same physical pair.
                pair = tuple(sorted((str(a.norad_id), str(c.norad_id))))
                out.add(pair)
    return out

brute_set = brute(assets, catalog, BUFFER_KM)
# algo_list = list(asset_vs_catalog_pairs(assets, catalog, BUFFER_KM))
# algo_set = set(algo_list)
algo_list = list(asset_vs_catalog_pairs(assets, catalog, BUFFER_KM))
algo_pairs = [
    tuple(sorted((
        str(assets[a_idx].norad_id),
        str(catalog[c_idx].norad_id)
    )))
    for a_idx, c_idx in algo_list
]
algo_set = set(algo_pairs)

print(f"assets: {len(assets)}  catalog: {len(catalog)}")
print(f"brute force pairs: {len(brute_set)}")
print(f"algo pairs        : {len(algo_set)}  (raw len {len(algo_list)}, dup={'YES' if len(algo_list)!=len(algo_set) else 'no'})")
missing = brute_set - algo_set
extra = algo_set - brute_set
print(f"false negatives: {len(missing)}   false positives: {len(extra)}")
# assert not missing and not extra and len(algo_list) == len(algo_set)
assert not missing and not extra and len(algo_pairs) == len(algo_set)
# self_pairs = [
#     (a_idx, c_idx)
#     for a_idx, c_idx in algo_list
#     if assets[a_idx].idx == c_idx
# ]
self_pairs = [
    pair
    for pair in algo_pairs
    if pair[0] == pair[1]
]
assert not self_pairs, f"SELF-PAIRS DETECTED: {self_pairs}"
print("asset_vs_catalog_pairs: EXACT MATCH, no dupes, no self-pairs. PASSED.")
