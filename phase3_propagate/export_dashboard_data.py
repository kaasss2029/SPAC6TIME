import json
import csv
import os


CATALOG_FILE = "../phase2_full_catalog/leo_catalog_cache.json"
EVENTS_FILE = "conjunction_events_20s_FINAL.csv"
OUTPUT_FILE = "../dashboard/dashboard_data.json"


def risk_badge(pc):
    """
    Simple demo classification based on Pc.

    These thresholds are project/demo thresholds,
    not operational agency standards.
    """
    if pc >= 1e-5:
        return "HIGH"
    elif pc >= 1e-6:
        return "MEDIUM"
    else:
        return "LOW"


# --------------------------------------------------
# Load catalog
# --------------------------------------------------

with open(CATALOG_FILE, "r") as f:
    catalog = json.load(f)


# --------------------------------------------------
# Load final Phase 3 events
# --------------------------------------------------

with open(EVENTS_FILE, "r") as f:
    events = list(csv.DictReader(f))


# --------------------------------------------------
# Convert events into dashboard format
# --------------------------------------------------

out_events = []

for e in events:

    pc = float(e["pc"])

    out_events.append({
        "norad_a": e["norad_a"],
        "name_a": e["name_a"],

        "norad_b": e["norad_b"],
        "name_b": e["name_b"],

        "tca": e["tca"],

        "miss_km": float(e["miss_km"]),
        "rel_vel_kms": float(e["rel_vel_kms"]),
        "combined_sigma_km": float(e["combined_sigma_km"]),

        "pc": pc,

        "risk": risk_badge(pc)
    })


# Highest Pc first
out_events.sort(
    key=lambda event: event["pc"],
    reverse=True
)


# --------------------------------------------------
# Summary
# --------------------------------------------------

summary = {
    "tracked_objects": len(catalog),

    "conjunctions_flagged": len(out_events),

    "high_risk_count": sum(
        1
        for e in out_events
        if e["risk"] == "HIGH"
    ),

    "top_event": out_events[0] if out_events else None
}


# --------------------------------------------------
# Metadata
# --------------------------------------------------

metadata = {
    "demo_mode": True,

    "demo_epoch": "2026-08-26T12:00:00",

    "window_hours": 72,

    "tle_source": "Space-Track",

    "event_source": EVENTS_FILE
}


# --------------------------------------------------
# Final dashboard JSON
# --------------------------------------------------

dashboard_data = {
    "metadata": metadata,

    "summary": summary,

    "events": out_events
}


# --------------------------------------------------
# Write JSON
# --------------------------------------------------

os.makedirs(
    os.path.dirname(OUTPUT_FILE),
    exist_ok=True
)

with open(OUTPUT_FILE, "w") as f:
    json.dump(
        dashboard_data,
        f,
        indent=2
    )


print("===== DASHBOARD DATA EXPORT =====")
print(f"Tracked objects      : {summary['tracked_objects']}")
print(f"Conjunctions flagged : {summary['conjunctions_flagged']}")
print(f"High-risk events     : {summary['high_risk_count']}")

if summary["top_event"]:
    top = summary["top_event"]

    print("\nTop event:")
    print(
        f"{top['name_a']} <-> {top['name_b']}"
    )

    print(
        f"Miss distance        : {top['miss_km']} km"
    )

    print(
        f"Relative velocity    : {top['rel_vel_kms']} km/s"
    )

    print(
        f"Combined sigma       : {top['combined_sigma_km']} km"
    )

    print(
        f"Pc                   : {top['pc']:.6e}"
    )

    print(
        f"Risk                 : {top['risk']}"
    )

print(
    f"\nOutput: {OUTPUT_FILE}"
)
