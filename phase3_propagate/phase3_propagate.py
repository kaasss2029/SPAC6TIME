"""
ORBITGUARD Phase 3 — SGP4 propagation + closest-approach + Pc scoring
"""
import json
import csv
import numpy as np
from datetime import datetime, timedelta
from sgp4.api import Satrec, jday

CACHE_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
PAIRS_FILE = "../phase2_full_catalog/candidate_pairs.csv"

WINDOW_HOURS = 72          # how far forward to look
# COARSE_STEP_SEC = 60       # coarse scan resolution
COARSE_STEP_SEC = 20
REFINE_STEP_SEC = 1        # fine scan resolution near minimum

# Reproducibility / demo mode
DEMO_MODE = True
DEMO_EPOCH = datetime(2026, 8, 26, 12, 0, 0)

RISK_MISS_KM = 5.0         # only keep events with miss distance under this


def load_catalog():
    with open(CACHE_FILE) as f:
        return json.load(f)


def load_pairs():
    with open(PAIRS_FILE) as f:
        r = csv.reader(f)
        next(r)
        return list(r)


def make_satrec(catalog, norad_id):
    rec = catalog.get(str(norad_id)) or catalog.get(norad_id)
    if not rec or not rec.get("tle_line1") or not rec.get("tle_line2"):
        return None
    return Satrec.twoline2rv(rec["tle_line1"], rec["tle_line2"]), rec


def propagate(sat, t: datetime):
    jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond / 1e6)
    e, r, v = sat.sgp4(jd, fr)
    if e != 0:
        return None, None
    return np.array(r), np.array(v)   # km, km/s, TEME frame
 
    
def propagate_array(sat, times):
    jd = []
    fr = []
    for t in times:
        jdi, fri = jday(
            t.year,
            t.month,
            t.day,
            t.hour,
            t.minute,
            t.second + t.microsecond / 1e6
        )
        jd.append(jdi)
        fr.append(fri)
    jd = np.array(jd)
    fr = np.array(fr)
    e, r, v = sat.sgp4_array(jd, fr)
    valid = (e == 0)
    return (
        np.asarray(r),
        np.asarray(v),
        valid
    )


# def closest_approach(sat_a, sat_b, start: datetime, window_hours: int):
#     # Coarse scan
#     best_t, best_d = None, float("inf")
#     n_steps = int(window_hours * 3600 / COARSE_STEP_SEC)
#     for i in range(n_steps):
#         t = start + timedelta(seconds=i * COARSE_STEP_SEC)
#         ra, _ = propagate(sat_a, t)
#         rb, _ = propagate(sat_b, t)
#         if ra is None or rb is None:
#             continue
#         d = np.linalg.norm(ra - rb)
#         if d < best_d:
#             best_d, best_t = d, t

#     if best_t is None:
#         return None

#     # Refine around best_t with a finer step
#     refine_window = COARSE_STEP_SEC
#     t0 = best_t - timedelta(seconds=refine_window)
#     n_fine = int(2 * refine_window / REFINE_STEP_SEC)
#     best_t2, best_d2, best_ra, best_rb, best_va, best_vb = best_t, best_d, None, None, None, None
#     for i in range(n_fine):
#         t = t0 + timedelta(seconds=i * REFINE_STEP_SEC)
#         ra, va = propagate(sat_a, t)
#         rb, vb = propagate(sat_b, t)
#         if ra is None or rb is None:
#             continue
#         d = np.linalg.norm(ra - rb)
#         if d < best_d2:
#             best_d2, best_t2 = d, t
#             best_ra, best_rb, best_va, best_vb = ra, rb, va, vb

#     if best_ra is None:
#         return None

#     rel_vel = np.linalg.norm(best_va - best_vb)
#     return {
#         "tca": best_t2,
#         "miss_km": best_d2,
#         "rel_vel_kms": rel_vel,
#     }

def closest_approach(sat_a, sat_b, start: datetime, window_hours: int):
    # ---------------------------------------------------------
    # Coarse scan — vectorized SGP4 propagation
    # ---------------------------------------------------------
    n_steps = int(window_hours * 3600 / COARSE_STEP_SEC)
    times = [
        start + timedelta(seconds=i * COARSE_STEP_SEC)
        for i in range(n_steps)
    ]
    ra, va, valid_a = propagate_array(sat_a, times)
    rb, vb, valid_b = propagate_array(sat_b, times)
    valid = valid_a & valid_b
    if not np.any(valid):
        return None
    distances = np.linalg.norm(ra - rb, axis=1)
    distances[~valid] = np.inf
    best_idx = np.argmin(distances)
    if not np.isfinite(distances[best_idx]):
        return None
    best_t = times[best_idx]
    best_d = distances[best_idx]
    # ---------------------------------------------------------
    # Fine refinement around coarse minimum
    # ---------------------------------------------------------
    refine_window = COARSE_STEP_SEC
    t0 = best_t - timedelta(seconds=refine_window)
    n_fine = int(
        2 * refine_window / REFINE_STEP_SEC
    ) + 1
    fine_times = [
        t0 + timedelta(seconds=i * REFINE_STEP_SEC)
        for i in range(n_fine)
    ]
    ra2, va2, valid_a2 = propagate_array(sat_a, fine_times)
    rb2, vb2, valid_b2 = propagate_array(sat_b, fine_times)
    valid2 = valid_a2 & valid_b2
    if not np.any(valid2):
        return None
    distances2 = np.linalg.norm(ra2 - rb2, axis=1)
    distances2[~valid2] = np.inf
    best_idx2 = np.argmin(distances2)
    if not np.isfinite(distances2[best_idx2]):
        return None
    best_t2 = fine_times[best_idx2]
    best_d2 = distances2[best_idx2]
    best_va = va2[best_idx2]
    best_vb = vb2[best_idx2]
    rel_vel = np.linalg.norm(best_va - best_vb)
    return {
        "tca": best_t2,
        "miss_km": best_d2,
        "rel_vel_kms": rel_vel,
    }


def tle_age_days(epoch_str, now: datetime):
    epoch = datetime.fromisoformat(epoch_str.replace("Z", ""))
    return (now - epoch).total_seconds() / 86400.0


def estimate_sigma_km(age_days: float) -> float:
    """
    Very simplified TLE-age-to-uncertainty growth model for LEO objects.
    Real agencies use full covariance propagation; this is a coarse,
    honestly-labeled approximation: sigma grows roughly linearly with
    age due to unmodeled drag, ~0.5-1 km/day is a commonly cited rough
    order of magnitude for LEO TLEs early in their validity window.
    """
    base_sigma_km = 0.5          # baseline uncertainty at epoch
    growth_km_per_day = 0.75     # rough LEO drag-driven growth rate
    return base_sigma_km + growth_km_per_day * max(age_days, 0)


def pc_2d_approx(miss_km: float, combined_sigma_km: float) -> float:
    """
    Simplified 2D Pc approximation (Foster-style): treat combined position
    uncertainty as an isotropic Gaussian in the encounter plane and the
    hard-body radius as small relative to miss distance/sigma. This is a
    coarse approximation for a hackathon demo, not a full 3x3 covariance
    projection -- label it as such in the UI/pitch.
    """
    HBR_KM = 0.02   # combined hard-body radius, ~20m generic estimate
    sigma = max(combined_sigma_km, 1e-6)
    from scipy import integrate
    # Rough closed-form-ish approx: Pc ~ (HBR/sigma)^2 * exp(-miss^2 / (2*sigma^2)) / 2
    # (simplified small-HBR Gaussian approx, NOT the full Foster integral)
    pc = 0.5 * (HBR_KM / sigma) ** 2 * np.exp(-(miss_km ** 2) / (2 * sigma ** 2))
    return min(pc, 1.0)


def main():
    catalog = load_catalog()
    pairs = load_pairs()
#    pairs = load_pairs()[:2000]
#    now = datetime.utcnow()
    now = DEMO_EPOCH if DEMO_MODE else datetime.utcnow()
#    now = datetime(2026, 8, 27, 0, 0, 0)

    results = []
    for idx, (a, b) in enumerate(pairs):
        sat_a_data = make_satrec(catalog, a)
        sat_b_data = make_satrec(catalog, b)
        if not sat_a_data or not sat_b_data:
            continue
        sat_a, rec_a = sat_a_data
        sat_b, rec_b = sat_b_data

        ca = closest_approach(sat_a, sat_b, now, WINDOW_HOURS)
        if ca is None or ca["miss_km"] > RISK_MISS_KM:
            continue

        age_a = tle_age_days(rec_a["epoch"], now)
        age_b = tle_age_days(rec_b["epoch"], now)
        sigma_a = estimate_sigma_km(age_a)
        sigma_b = estimate_sigma_km(age_b)
        combined_sigma = np.sqrt(sigma_a ** 2 + sigma_b ** 2)

        pc = pc_2d_approx(ca["miss_km"], combined_sigma)

        results.append({
            "norad_a": a, "name_a": rec_a.get("name"),
            "norad_b": b, "name_b": rec_b.get("name"),
            "tca": ca["tca"].isoformat(),
            "miss_km": round(ca["miss_km"], 3),
            "rel_vel_kms": round(ca["rel_vel_kms"], 3),
            "combined_sigma_km": round(combined_sigma, 3),
            "pc": pc,
        })
        if (idx + 1) % 500 == 0:
            print(f"  ...{idx+1}/{len(pairs)} pairs screened, {len(results)} flagged so far")

    results.sort(key=lambda r: -r["pc"])

    with open("conjunction_events.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=results[0].keys() if results else
                            ["norad_a","name_a","norad_b","name_b","tca","miss_km","rel_vel_kms","combined_sigma_km","pc"])
        w.writeheader()
        w.writerows(results)

    print(f"\nDone. {len(results)} conjunction events (miss < {RISK_MISS_KM}km) written to conjunction_events.csv")
    for r in results[:10]:
        print(f"  {r['name_a']} <-> {r['name_b']}  miss={r['miss_km']}km  Pc={r['pc']:.2e}  TCA={r['tca']}")


if __name__ == "__main__":
    main()
