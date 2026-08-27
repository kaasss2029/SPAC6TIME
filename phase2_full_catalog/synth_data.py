"""
Generate synthetic catalog data that mimics REAL LEO population structure,
so we can validate correctness and benchmark performance honestly:

  - ~500 scattered debris/rocket-body objects at random LEO altitudes/inclinations
  - a dense megaconstellation shell: ~5,000 objects clustered tightly in
    altitude + inclination (like a real Starlink shell), spread across RAAN
  - a second smaller shell (~1,500 objects) at a different altitude
  - ~15 eccentric GTO-transfer rocket bodies (perigee ~200km, apogee ~35,000km)
  - ~12 "ISRO assets" at assorted LEO altitudes (the asset-of-interest set)
"""
import numpy as np
import json

rng = np.random.default_rng(42)

def make_catalog():
    objs = []
    nid = 10000

    # scattered background debris
    n_bg = 500
    for i in range(n_bg):
        perigee = rng.uniform(300, 1900)
        apogee = perigee + rng.uniform(0, 50)   # near-circular
        incl = rng.uniform(0, 100)
        raan = rng.uniform(0, 360)
        objs.append(dict(norad_id=nid, name=f"DEBRIS-{i}", object_type="DEBRIS",
                          rcs_size="SMALL", perigee_km=perigee, apogee_km=apogee,
                          inclination_deg=incl, raan_deg=raan)); nid += 1

    # dense megaconstellation shell A (Starlink-like): 5000 sats, alt ~550km, incl ~53deg
    n_shell_a = 5000
    for i in range(n_shell_a):
        perigee = 550 + rng.normal(0, 2)
        apogee = perigee + abs(rng.normal(0, 1))
        incl = 53.0 + rng.normal(0, 0.3)
        raan = rng.uniform(0, 360)
        objs.append(dict(norad_id=nid, name=f"MEGA-A-{i}", object_type="PAYLOAD",
                          rcs_size="SMALL", perigee_km=perigee, apogee_km=apogee,
                          inclination_deg=incl, raan_deg=raan)); nid += 1

    # dense shell B: 1500 sats, alt ~540km, incl ~97deg (polar/sun-sync-like)
    n_shell_b = 1500
    for i in range(n_shell_b):
        perigee = 540 + rng.normal(0, 3)
        apogee = perigee + abs(rng.normal(0, 1))
        incl = 97.4 + rng.normal(0, 0.2)
        raan = rng.uniform(0, 360)
        objs.append(dict(norad_id=nid, name=f"MEGA-B-{i}", object_type="PAYLOAD",
                          rcs_size="SMALL", perigee_km=perigee, apogee_km=apogee,
                          inclination_deg=incl, raan_deg=raan)); nid += 1

    # eccentric GTO transfer rocket bodies
    for i in range(15):
        perigee = rng.uniform(180, 400)
        apogee = rng.uniform(30000, 36000)
        incl = rng.uniform(0, 30)
        raan = rng.uniform(0, 360)
        objs.append(dict(norad_id=nid, name=f"GTO-RB-{i}", object_type="ROCKET BODY",
                          rcs_size="LARGE", perigee_km=perigee, apogee_km=apogee,
                          inclination_deg=incl, raan_deg=raan)); nid += 1

    # ISRO assets (assets-of-interest set) scattered at various LEO altitudes,
    # deliberately including one right inside the Starlink shell A altitude band
    isro_alts = [505, 555, 620, 780, 817, 550, 1336, 549, 505, 615, 555, 725]
    isro_names = ["CARTOSAT-2F","CARTOSAT-3","RISAT-2B","RISAT-2BR1","EOS-01",
                  "EOS-04","OCEANSAT-3","EOS-06","RESOURCESAT-2A","EOS-07",
                  "GISAT-1","EOS-02"]
    for name, alt in zip(isro_names, isro_alts):
        perigee = alt - rng.uniform(0,3)
        apogee = alt + rng.uniform(0,3)
        incl = rng.choice([97.5, 98.2, 45.0, 20.7])
        raan = rng.uniform(0,360)
        objs.append(dict(norad_id=nid, name=name, object_type="PAYLOAD",
                          rcs_size="MEDIUM", perigee_km=perigee, apogee_km=apogee,
                          inclination_deg=incl, raan_deg=raan, owner="ISRO")); nid += 1

    return objs

if __name__ == "__main__":
    catalog = make_catalog()
    with open("synthetic_catalog.json", "w") as f:
        json.dump(catalog, f)
    print(f"Generated {len(catalog)} synthetic objects -> synthetic_catalog.json")
    from collections import Counter
    print(Counter(o['name'].split('-')[0] for o in catalog))
