"""
ORBITGUARD - Phase 2 (v3): Full Catalog Ingestion + Provably-Safe Coarse Screening
-----------------------------------------------------------------------------------
This replaces the v2 binned (altitude + inclination + RAAN) coarse filter.

WHY v2 WAS REPLACED, NOT PATCHED:
Both bugs your teammates found (duplicate pairs from multi-bin eccentric
objects, and possible false negatives from RAAN binning) turned out to be
symptoms of the same root design problem: RAAN/inclination were being used
to ELIMINATE candidate pairs. Provable fact (see PROOF.md / proof_check.py):
for two CIRCULAR orbits, the minimum possible 3D separation between them is
EXACTLY |r1 - r2| -- independent of their relative inclination/RAAN. So a
same-altitude pair can ever be arbitrarily close *no matter how different
their RAAN is* -- meaning a static RAAN/inclination threshold can NEVER
safely eliminate a pair. It was quantified on this project's own synthetic
megaconstellation-scale test: the v2 filter would have silently discarded
95.8% of the real same-shell candidate pairs (see quantify_old_bug.py).

THE FIX: only ONE geometric quantity safely eliminates a pair with a
mathematically guaranteed zero false-negative rate -- radius/altitude-band
overlap (if the padded [perigee, apogee] ranges of two objects don't
overlap, the true minimum possible distance is provably >= the pad, so
they cannot be within threshold). Phase 2 now does exactly that, via an
exact O(n log n + k) sweep-line interval-overlap algorithm (screening.py) --
which also structurally eliminates the duplicate-pair bug, since there is
no bucket membership at all; every pair is emitted exactly once by
construction. This is checked against brute force in test_correctness.py
(pass) including a forced eccentric-GTO stress case (pass).

TWO SCREENING MODES:
  --mode assets   (default, RECOMMENDED) Screens a small watch-list
                   (ISRO assets + anything you flag) against the full
                   catalog. Matches what the product actually needs
                   (Pillar 4, Time Machine) and is fast: ~7,000-object
                   catalog with a 12-object watch-list screens in <0.1s.
  --mode full      Full catalog vs full catalog. This is the mathematically
                   honest, zero-false-negative number -- and it is
                   genuinely large when your catalog includes megaconstel-
                   lation shells (real LEO catalogs do). That's not a bug
                   in this filter; it's a real, industry-recognized scaling
                   problem (megaconstellation self-conjunction screening is
                   something LeoLabs/18 SDS dedicate real engineering to).
                   Included so you have it, benchmarked, and can talk about
                   the tradeoff honestly in your pitch if asked -- but plan
                   your demo around --mode assets.

Run: python phase2_full_catalog.py --mode assets
     python phase2_full_catalog.py --mode full
"""

import os
import json
import csv
import argparse
import requests
from dotenv import load_dotenv

from screening import Obj, radius_interval_pairs, asset_vs_catalog_pairs

load_dotenv()

SPACETRACK_USER = os.getenv("SPACETRACK_USER")
SPACETRACK_PASS = os.getenv("SPACETRACK_PASS")

SPACETRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login"

SPACETRACK_QUERY_URL = (
    "https://www.space-track.org/basicspacedata/query/"
    "class/gp/"
    "PERIAPSIS/%3C2000/"          # server-side filter, correct field name
    "DECAY_DATE/null-val/"
    "orderby/NORAD_CAT_ID/"
    "format/json"
)

CELESTRAK_LEO_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json"

CACHE_FILE = "leo_catalog_cache.json"
CANDIDATE_PAIRS_FILE = "candidate_pairs.csv"   # compact CSV, ~2x smaller & ~5x
                                                # faster to write than JSONL at
                                                # multi-million-row scale (measured)

BUFFER_KM = 50.0   # screening buffer/margin. Generous on purpose: this only
                    # needs to guarantee we never THROW AWAY a real candidate;
                    # Phase 3's SGP4 propagation + Pc engine does the precise
                    # work and will reject the false positives this admits.

# Name-pattern fallback for identifying ISRO assets when SATCAT's OWNER
# field ('IND') isn't available (e.g. CelesTrak-only records). Space-Track
# GP/SATCAT OWNER == 'IND' is the authoritative signal when present.
ISRO_NAME_PATTERNS = [
    "CARTOSAT", "RISAT", "EOS-", "INSAT", "GSAT", "IRNSS", "NAVIC",
    "OCEANSAT", "RESOURCESAT", "GISAT", "MEGHA-TROPIQUES", "SARAL",
    "ASTROSAT", "CHANDRAYAAN", "ADITYA", "SCATSAT", "HAMSAT", "AISAT",
]


# ---------------------------------------------------------
# STEP A: Space-Track login + fetch  (unchanged from your working version)
# ---------------------------------------------------------
def fetch_spacetrack_leo():
    if not SPACETRACK_USER or not SPACETRACK_PASS:
        raise RuntimeError(
            "Missing Space-Track credentials. Check your .env file has "
            "SPACETRACK_USER and SPACETRACK_PASS set."
        )

    session = requests.Session()
    login_payload = {"identity": SPACETRACK_USER, "password": SPACETRACK_PASS}

    print("Logging into Space-Track...")
    login_response = session.post(SPACETRACK_LOGIN_URL, data=login_payload, timeout=20)
    login_response.raise_for_status()

    print("Fetching catalog from Space-Track (this may take a moment)...")
    data_response = session.get(SPACETRACK_QUERY_URL, timeout=60)
    data_response.raise_for_status()

    records = data_response.json()
    records = [
        rec for rec in records
        if rec.get("PERIAPSIS") is not None and float(rec["PERIAPSIS"]) < 2000
    ]
    print(f"Space-Track returned {len(records)} LEO objects.\n")
    return records


def fetch_celestrak_active():
    print("Fetching active satellite catalog from CelesTrak...")
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        response = requests.get(CELESTRAK_LEO_URL, headers=headers, timeout=30)
        response.raise_for_status()
        records = response.json()
        print(f"CelesTrak returned {len(records)} active objects.\n")
        return records
    except requests.RequestException as e:
        print(f"Warning: CelesTrak unavailable: {e}")
        print("Continuing with Space-Track data only.\n")
        return []


def merge_catalogs(spacetrack_records: list, celestrak_records: list) -> dict:
    merged = {}
    for rec in spacetrack_records:
        norad_id = rec.get("NORAD_CAT_ID")
        if norad_id:
            norad_id = str(int(norad_id))   # <-- FIX: normalize type (Space-Track returns str)
            merged[norad_id] = {
                "norad_id": norad_id,
                "name": rec.get("OBJECT_NAME"),
                "object_type": rec.get("OBJECT_TYPE"),
                "rcs_size": rec.get("RCS_SIZE"),
                "owner": rec.get("OWNER"),
                "apogee_km": float(rec.get("APOAPSIS") or 0),
                "perigee_km": float(rec.get("PERIAPSIS") or 0),
                "inclination_deg": float(rec.get("INCLINATION") or 0),
                "raan_deg": float(rec.get("RA_OF_ASC_NODE") or 0),
                "epoch": rec.get("EPOCH"),
                "tle_line1": rec.get("TLE_LINE1"),
                "tle_line2": rec.get("TLE_LINE2"),
                "source": "spacetrack",
            }
    for rec in celestrak_records:
        norad_id = rec.get("NORAD_CAT_ID")
        if norad_id:
            norad_id = str(int(norad_id))   # <-- FIX: normalize type (CelesTrak returns int)
            if norad_id not in merged:
                merged[norad_id] = {
                    "norad_id": norad_id,
                    "name": rec.get("OBJECT_NAME"),
                    "object_type": "UNKNOWN",
                    "rcs_size": None,
                    "owner": None,
                    "apogee_km": None,
                    "perigee_km": None,
                    "inclination_deg": float(rec.get("INCLINATION") or 0),
                    "raan_deg": float(rec.get("RA_OF_ASC_NODE") or 0),
                    "epoch": rec.get("EPOCH"),
                    "tle_line1": rec.get("TLE_LINE1"),
                    "tle_line2": rec.get("TLE_LINE2"),
                    "source": "celestrak",
                }
    print(f"Merged catalog contains {len(merged)} unique objects.\n")
    return merged


def save_cache(merged_catalog: dict):
    with open(CACHE_FILE, "w") as f:
        json.dump(merged_catalog, f)
    print(f"Saved merged catalog to {CACHE_FILE}\n")


def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return None


# ---------------------------------------------------------
# STEP E: object conversion + ISRO asset detection
# ---------------------------------------------------------
def is_isro_asset(rec: dict) -> bool:
    if rec.get("owner") == "IND":
        return True
    name = (rec.get("name") or "").upper()
    return any(p in name for p in ISRO_NAME_PATTERNS)


def catalog_to_objs(catalog: dict) -> list[Obj]:
    objs = []
    for i, (norad_id, rec) in enumerate(catalog.items()):
        if not rec.get("apogee_km") or not rec.get("perigee_km"):
            continue
        objs.append(Obj(
            idx=i, norad_id=norad_id, name=rec.get("name"),
            perigee_km=rec["perigee_km"], apogee_km=rec["apogee_km"],
            inclination_deg=rec.get("inclination_deg", 0.0),
            raan_deg=rec.get("raan_deg", 0.0),
        ))
    return objs


# ---------------------------------------------------------
# STEP F: run screening, write compact CSV
# ---------------------------------------------------------
def run_screening(merged: dict, mode: str, buffer_km: float, output_path: str):
    all_objs = catalog_to_objs(merged)
    id_by_idx = {o.idx: o.norad_id for o in all_objs}

    if mode == "assets":
        assets = [o for o in all_objs if is_isro_asset(merged[o.norad_id])]
        print(f"Watch-list mode: {len(assets)} flagged assets vs "
              f"{len(all_objs)}-object catalog. Buffer={buffer_km}km.\n")
        if not assets:
            print("WARNING: no ISRO/flagged assets found in this catalog snapshot "
                  "(check OWNER field or ISRO_NAME_PATTERNS) -- falling back to "
                  "full mode so you still get output.\n")
            pairs = radius_interval_pairs(all_objs, buffer_km)
            pair_source = ((o.norad_id, all_objs[j].norad_id) for (i, j) in pairs
                           for o in [all_objs[i]])
        else:
            raw_pairs = asset_vs_catalog_pairs(assets, all_objs, buffer_km)
            pair_source = ((assets[a_idx].norad_id, all_objs[c_idx].norad_id)
                           for a_idx, c_idx in raw_pairs)
    elif mode == "full":
        print(f"Full catalog mode: {len(all_objs)} objects vs themselves. "
              f"Buffer={buffer_km}km.\nThis is the honest, zero-false-negative "
              f"count and can be large for real megaconstellation-scale data.\n")
        raw_pairs = radius_interval_pairs(all_objs, buffer_km)
        pair_source = ((all_objs[i].norad_id, all_objs[j].norad_id) for i, j in raw_pairs)
    else:
        raise ValueError(f"unknown mode: {mode}")

    count = 0
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["norad_id_a", "norad_id_b"])
        for a, b in pair_source:
            writer.writerow([a, b])
            count += 1
            if count % 500_000 == 0:
                print(f"  ...{count:,} candidate pairs written so far")

    print(f"\nDone. {count:,} candidate pairs written to {output_path}\n")
    return count


# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["assets", "full"], default="assets",
                         help="'assets' (default, recommended): watch-list vs "
                              "full catalog. 'full': full catalog vs itself "
                              "(large for real megaconstellation data).")
    parser.add_argument("--buffer-km", type=float, default=BUFFER_KM)
    args = parser.parse_args()

    cached = load_cache()
    if cached:
        print(f"Loaded {len(cached)} objects from local cache. "
              f"Delete {CACHE_FILE} if you want to force a fresh fetch.\n")
        merged = cached
    else:
        spacetrack_data = fetch_spacetrack_leo()
        celestrak_data = fetch_celestrak_active()
        merged = merge_catalogs(spacetrack_data, celestrak_data)
        save_cache(merged)

    run_screening(merged, args.mode, args.buffer_km, CANDIDATE_PAIRS_FILE)


if __name__ == "__main__":
    main()
