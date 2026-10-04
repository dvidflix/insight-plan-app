"""
Measure every wall and slab of an IFC model (see core/element_features.py) and write
the results as a table, one row per element, keyed by GUID.

  python features.py "<model.ifc>" --out "<folder>"

writes <folder>/element-features.db (table element_feature, this model's rows replaced)
and <folder>/element-features-<model>.csv. Nothing in the model or the project
database is touched.
"""
import argparse
import csv
import sqlite3
import sys
import time
from pathlib import Path

import ifcopenshell

from core.element_features import measure_model

COLUMNS = [
    "model", "guid", "name", "ifc_class", "pour_id", "pour_type", "level",
    "pour_volume_m3", "volume_m3", "height_m", "z_min", "z_max",
    "plan_shape", "plan_corners", "plan_curve_points", "plan_fill", "plan_parts",
    "obb_length_m", "obb_width_m", "plan_area_m2", "plan_perimeter_m",
    "thickness_m", "length_m",
    "opening_count", "opening_area_m2", "opening_ratio",
    "formwork_area_m2", "side_area_m2", "soffit_area_m2", "top_area_m2",
    "slab_hole_count", "slab_hole_area_m2", "slab_top_levels", "edge_length_m",
    "error",
]
REAL = {"pour_volume_m3", "volume_m3", "height_m", "z_min", "z_max", "plan_fill", "obb_length_m", "obb_width_m",
        "plan_area_m2", "plan_perimeter_m", "thickness_m", "length_m", "opening_area_m2", "opening_ratio",
        "formwork_area_m2", "side_area_m2", "soffit_area_m2", "top_area_m2", "slab_hole_area_m2", "edge_length_m"}
INTEGER = {"plan_corners", "plan_curve_points", "plan_parts", "opening_count", "slab_hole_count", "slab_top_levels"}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ifc")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = Path(args.ifc)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print(f"Opening {src.name} ...", flush=True)
    model = ifcopenshell.open(str(src))

    last = [0.0]

    def progress(i, n):
        if time.time() - last[0] > 5 or i == n:
            last[0] = time.time()
            print(f"  {i}/{n} elements ({time.time() - t0:.0f}s)", flush=True)

    rows = measure_model(model, progress=progress)
    for r in rows:
        r["model"] = src.stem
        if r.get("pour_volume_m3") is not None:
            r["pour_volume_m3"] = _num(r["pour_volume_m3"])

    csv_path = out / f"element-features-{src.stem}.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    db_path = out / "element-features.db"
    con = sqlite3.connect(db_path)
    cols = ", ".join(f"{c} {'REAL' if c in REAL else 'INTEGER' if c in INTEGER else 'TEXT'}" for c in COLUMNS)
    con.execute(f"CREATE TABLE IF NOT EXISTS element_feature ({cols}, PRIMARY KEY (model, guid))")
    con.execute("DELETE FROM element_feature WHERE model = ?", (src.stem,))
    con.executemany(
        f"INSERT OR REPLACE INTO element_feature ({', '.join(COLUMNS)}) VALUES ({', '.join('?' for _ in COLUMNS)})",
        [[r.get(c) for c in COLUMNS] for r in rows],
    )
    con.commit()
    con.close()

    errors = sum(1 for r in rows if r.get("error"))
    print(f"Done: {len(rows)} elements ({errors} with errors) in {time.time() - t0:.0f}s")
    print(f"  {db_path}\n  {csv_path}")


if __name__ == "__main__":
    sys.exit(main())
