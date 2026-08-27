"""
ORBITGUARD - Phase 1: TLE Ingestion + SGP4 Propagation
--------------------------------------------------------
What this does:
1. Fetches live TLE data from CelesTrak for a chosen object group
2. Parses each TLE into a Satellite object using sgp4
3. Propagates each object to a given future timestamp
4. Prints resulting position (km) and velocity (km/s) in the TEME frame

Run: python phase1_tle_ingestion.py
"""

import requests
from sgp4.api import Satrec, jday
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------
# STEP A: Fetch TLE data from CelesTrak
# ---------------------------------------------------------
# CelesTrak groups: "stations" (ISS etc), "active" (all active sats),
# "debris" style groups also exist. Start small with "stations" to test.
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"


def fetch_tle_data(url: str) -> list[dict]:
    """
    Downloads raw TLE text and splits it into structured records.
    Each record = { name, line1, line2 }
    """
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    lines = response.text.strip().splitlines()

    objects = []
    # TLE data comes in blocks of 3 lines: Name, Line1, Line2
    for i in range(0, len(lines), 3):
        name = lines[i].strip()
        line1 = lines[i + 1].strip()
        line2 = lines[i + 2].strip()
        objects.append({"name": name, "line1": line1, "line2": line2})
    return objects


# ---------------------------------------------------------
# STEP B: Build a propagatable Satellite object
# ---------------------------------------------------------
def build_satellite(tle_record: dict) -> Satrec:
    """
    Converts raw TLE lines into an sgp4 Satrec object,
    which can then be propagated to any future time.
    """
    return Satrec.twoline2rv(tle_record["line1"], tle_record["line2"])


# ---------------------------------------------------------
# STEP C: Propagate to a specific future time
# ---------------------------------------------------------
def propagate(satellite: Satrec, target_time: datetime):
    """
    Calculates position (km) and velocity (km/s) of the object
    at target_time, in the TEME reference frame.

    Returns: (error_code, position_xyz, velocity_xyz)
    error_code == 0 means success. Non-zero means propagation failed
    (e.g. decayed orbit, bad TLE, etc.)
    """
    jd, fr = jday(
        target_time.year, target_time.month, target_time.day,
        target_time.hour, target_time.minute, target_time.second
    )
    error_code, position, velocity = satellite.sgp4(jd, fr)
    return error_code, position, velocity


# ---------------------------------------------------------
# MAIN - test the full pipeline end to end
# ---------------------------------------------------------
def main():
    print("Fetching TLE data from CelesTrak...")
    tle_objects = fetch_tle_data(CELESTRAK_URL)
    print(f"Fetched {len(tle_objects)} objects.\n")

    # Propagate every object to "1 hour from now" as a test
    target_time = datetime.now(timezone.utc) + timedelta(hours=1)
    print(f"Propagating all objects to: {target_time.isoformat()}\n")

    for obj in tle_objects:
        sat = build_satellite(obj)
        error_code, position, velocity = propagate(sat, target_time)

        if error_code != 0:
            print(f"[ERROR] {obj['name']}: SGP4 error code {error_code}")
            continue

        x, y, z = position
        vx, vy, vz = velocity
        print(f"{obj['name']}")
        print(f"  Position (km): x={x:.2f}, y={y:.2f}, z={z:.2f}")
        print(f"  Velocity (km/s): vx={vx:.4f}, vy={vy:.4f}, vz={vz:.4f}\n")


if __name__ == "__main__":
    main()
