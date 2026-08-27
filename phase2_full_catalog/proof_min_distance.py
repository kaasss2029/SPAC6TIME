"""
Sanity check (numerical) of the closed-form claim used to redesign Phase 2:

For two CIRCULAR orbits of radius r1, r2 whose planes are inclined at
relative angle gamma to each other, the minimum possible 3D distance
between a point on orbit 1 and a point on orbit 2 is EXACTLY |r1 - r2|,
independent of gamma (as long as the planes are not literally identical
in a degenerate way -- doesn't matter here).

This means: for same-altitude circular orbits (r1 ~= r2), the minimum
possible distance is ~0 NO MATTER what the relative inclination/RAAN is.
=> A static (time-independent) RAAN/inclination threshold filter CANNOT
   safely eliminate candidate pairs without risking false negatives.
=> The only safe hard filter, geometrically, is the radius/altitude band.

We check this by brute-force numerical minimization over (phi1, phi2)
for a grid of gamma values and r1,r2 choices.
"""
import numpy as np

def min_distance_two_circular_orbits(r1, r2, gamma_deg, n=2000):
    gamma = np.radians(gamma_deg)
    phi = np.linspace(0, 2*np.pi, n, endpoint=False)
    # orbit 2 in reference xy-plane
    x2 = r2*np.cos(phi); y2 = r2*np.sin(phi); z2 = np.zeros_like(phi)
    # orbit 1 tilted by gamma about the line of nodes (x-axis)
    x1 = r1*np.cos(phi); y1 = r1*np.sin(phi)*np.cos(gamma); z1 = r1*np.sin(phi)*np.sin(gamma)

    P1 = np.stack([x1,y1,z1], axis=1)   # (n,3)
    P2 = np.stack([x2,y2,z2], axis=1)   # (n,3)

    # pairwise distances (n x n) -- fine for n=2000
    d = np.sqrt(((P1[:,None,:]-P2[None,:,:])**2).sum(-1))
    return d.min()

print(f"{'gamma(deg)':>10} {'r1':>6} {'r2':>6} {'min_dist':>10} {'|r1-r2|':>10}")
for gamma_deg in [0, 5, 15, 30, 53, 90, 120, 179]:
    for r1, r2 in [(7000,7000), (7000,7005), (7000,7050), (6800, 7200)]:
        md = min_distance_two_circular_orbits(r1, r2, gamma_deg, n=1500)
        print(f"{gamma_deg:>10} {r1:>6} {r2:>6} {md:>10.3f} {abs(r1-r2):>10.3f}")
