"""
ORBITGUARD Phase 2 (v3) - core screening algorithms.

Design goal: ZERO false negatives, ZERO duplicate pairs, by construction --
not by tuned thresholds that happen to work on a synthetic test set.

Why the previous (bin-based, RAAN-filtered) approach was unsound, proven:
    For two CIRCULAR orbits of radius r1, r2 whose orbital planes are
    inclined at ANY relative angle gamma (a function of inclination +
    RAAN), the minimum possible 3D separation between a point on orbit 1
    and a point on orbit 2 is EXACTLY |r1 - r2| -- independent of gamma.
    (Verified numerically in proof_check.py; also derivable in closed form.)

    Consequence: for same-altitude circular orbits, that minimum is ~0
    NO MATTER what the RAAN/inclination difference is. A static
    (time-independent) RAAN or inclination threshold therefore cannot
    safely eliminate a pair -- doing so risks discarding a real
    close-approach candidate. This is exactly the false-negative failure
    mode a collision-screening tool must never have.

    The ONLY geometric quantity that safely eliminates a pair with zero
    false-negative risk is radius/altitude-band overlap: if two orbits'
    possible-radius ranges (perigee-buffer .. apogee+buffer) don't
    overlap, the true minimum possible distance is provably >= buffer,
    so they cannot be within `buffer` of each other, period.

So Phase 2 here does exactly one hard elimination step -- exact radius-band
interval overlap -- via a sort + sweep-line algorithm (no binning, so the
"multi-bin duplicate" bug class is structurally impossible: every pair is
emitted exactly once, proven below and unit-tested against brute force).
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Obj:
    idx: int
    norad_id: int
    name: str
    perigee_km: float
    apogee_km: float
    inclination_deg: float = 0.0
    raan_deg: float = 0.0


def _bounds(o: Obj, buffer_km: float):
    return o.perigee_km - buffer_km, o.apogee_km + buffer_km


def radius_interval_pairs(objects: list[Obj], buffer_km: float):
    """
    Exact interval-overlap sweep (classic "sweep line" / interval
    scheduling algorithm), implemented with a plain list rather than a
    heap -- easier to prove correct, and fast in practice because the
    per-step cost is bounded by the number of genuinely-overlapping
    "active" objects at that point in the sweep, i.e. it scales with the
    real output size, not the catalog size.

    Returns an iterator of (i, j) index pairs (i < j) such that the
    radius-bands [perigee-buffer, apogee+buffer] of objects[i] and
    objects[j] overlap. Every qualifying pair is yielded EXACTLY ONCE --
    there is no bucket/bin membership, so there is no possible source of
    duplicates (unlike multi-bin schemes where an eccentric object living
    in many bins can be paired with the same neighbor more than once).

    Safety: overlap of these padded intervals is a NECESSARY condition
    for the two orbits to ever come within `buffer_km` of each other
    (see module docstring), so this step alone cannot cause a false
    negative -- it can only ever be too permissive, never too strict,
    as long as buffer_km already includes your true screening threshold.
    """
    order = sorted(range(len(objects)), key=lambda i: _bounds(objects[i], buffer_km)[0])
    active: list[tuple[float, int]] = []  # (hi, idx)

    for idx in order:
        lo, hi = _bounds(objects[idx], buffer_km)
        active = [(h, i) for (h, i) in active if h >= lo]
        for _, other_idx in active:
            a, b = (other_idx, idx) if other_idx < idx else (idx, other_idx)
            yield (a, b)
        active.append((hi, idx))


def asset_vs_catalog_pairs(assets: list[Obj], catalog: list[Obj], buffer_km: float):
    """
    O(m log n) style screening of a small "watch list" (assets) against
    the full catalog, using the same exact-overlap safety guarantee, but
    without needing the whole catalog to be mutually close-packed. This
    is the recommended mode for the hackathon: it matches the actual
    product (Pillar 4: protect ISRO assets; Pillar 3: Time Machine on a
    handful of historical objects) rather than exhaustively screening the
    full catalog against itself, which for real megaconstellations is a
    genuinely hard, open scaling problem in industry (LeoLabs, 18 SDS all
    invest heavily in this specifically) -- not something to solve by
    accident inside a hackathon coarse filter.

    Returns (asset_idx, catalog_idx) pairs, each emitted once.
    """
    cat_sorted = sorted(range(len(catalog)), key=lambda i: _bounds(catalog[i], buffer_km)[0])
    los = [_bounds(catalog[i], buffer_km)[0] for i in cat_sorted]
    his = [_bounds(catalog[i], buffer_km)[1] for i in cat_sorted]

    import bisect
    # for a_idx, asset in enumerate(assets):
    #     a_lo, a_hi = _bounds(asset, buffer_km)
    #     end = bisect.bisect_right(los, a_hi)
    #     for pos in range(end):
    #         c_idx = cat_sorted[pos]
    #         # Never pair an object with itself.
    #         if assets[a_idx].idx == c_idx:
    #             continue
    #         if his[pos] >= a_lo:
    #             yield (a_idx, c_idx)
    seen_pairs = set()
    for a_idx, asset in enumerate(assets):
        a_lo, a_hi = _bounds(asset, buffer_km)
        end = bisect.bisect_right(los, a_hi)
        for pos in range(end):
            c_idx = cat_sorted[pos]
            candidate = catalog[c_idx]
            # Never pair an object with itself.
            if asset.norad_id == candidate.norad_id:
                continue
            if his[pos] >= a_lo:
                # Canonical unordered pair.
                pair_key = tuple(sorted((str(asset.norad_id), str(candidate.norad_id))))
                # Prevent A-B and B-A duplicates.
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                yield (a_idx, c_idx)
