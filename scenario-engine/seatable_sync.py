"""
Sync between the measured elements, the SeaTable "Insight Plan Rates" base and a local copy.

  python seatable_sync.py push-walls   [--features <element-features.db>] [--model <stem>]
      Classifies every measured wall with the rules in SeaTable's "Wall Classes" and
      writes the walls to its "Wall Features" table (Auto class). The "Override class"
      you type in SeaTable is kept; "Class" there is the override, else the auto class.
  python seatable_sync.py pull-rates   [--out <rates.json>]
      Copies "Wall Classes" (rules and productivity rates) and the final class of
      every wall into a local JSON file, which the scenario generator reads, so it
      works with SeaTable switched off.

SeaTable's address and the base's API token are read from C:\\insight-stack\\seatable\\.env
(override with --env).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

import requests

from core.element_classes import classify, sort_rules

DEFAULT_ENV = Path(r"C:\insight-stack\seatable\.env")
DEFAULT_FEATURES = Path(r"C:\insight-stack\data\element-features.db")
DEFAULT_RATES = Path(r"C:\insight-stack\data\rates.json")
WALLS = "Wall Features"
CLASSES = "Wall Classes"

WALL_COLUMNS = [  # (SeaTable column, element_feature column)
    ("Pour ID", "pour_id"), ("GUID", "guid"), ("Model", "model"), ("Level", "level"), ("Name", "name"),
    ("Pour type", "pour_type"), ("Shape", "plan_shape"), ("Height (m)", "height_m"), ("Thickness (m)", "thickness_m"),
    ("Length (m)", "length_m"), ("Openings", "opening_count"), ("Opening ratio", "opening_ratio"),
    ("Formwork (m2)", "formwork_area_m2"), ("Volume (m3)", "volume_m3"), ("Plan corners", "plan_corners"),
]


def read_env(path: Path) -> dict:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


class SeaTable:
    def __init__(self, env: dict):
        proto = env.get("SEATABLE_SERVER_PROTOCOL", "http")
        host = env.get("SEATABLE_SERVER_HOSTNAME", "localhost")
        self.root = f"{proto}://{host}"
        api = env["SEATABLE_RATES_API_TOKEN"]
        r = requests.get(f"{self.root}/api/v2.1/dtable/app-access-token/", headers={"Authorization": f"Token {api}"}, timeout=30)
        r.raise_for_status()
        a = r.json()
        self.gw = f"{a['dtable_server']}api/v2/dtables/{a['dtable_uuid']}"
        self.h = {"Authorization": f"Bearer {a['access_token']}"}

    def _call(self, method, path, **kw):
        r = requests.request(method, f"{self.gw}{path}", headers=self.h, timeout=120, **kw)
        if not r.ok:
            raise RuntimeError(f"{method} {path}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    def rows(self, table):
        out, start = [], 0
        while True:
            page = self._call("GET", "/rows/", params={"table_name": table, "convert_keys": "true", "limit": 1000, "start": start})["rows"]
            out += page
            if len(page) < 1000:
                return out
            start += 1000

    def append(self, table, rows):
        for i in range(0, len(rows), 500):
            self._call("POST", "/rows/", json={"table_name": table, "rows": rows[i:i + 500]})

    def update(self, table, updates):  # updates: [{"row_id": ..., "row": {...}}]
        for i in range(0, len(updates), 500):
            self._call("PUT", "/rows/", json={"table_name": table, "updates": updates[i:i + 500]})

    def delete(self, table, row_ids):
        for i in range(0, len(row_ids), 500):
            self._call("DELETE", "/rows/", json={"table_name": table, "row_ids": row_ids[i:i + 500]})


def load_walls(features: Path, model: str | None):
    con = sqlite3.connect(f"file:{features}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    sql = "SELECT * FROM element_feature WHERE ifc_class LIKE 'IfcWall%' AND error IS NULL"
    args = ()
    if model:
        sql += " AND model = ?"
        args = (model,)
    rows = [dict(r) for r in con.execute(sql + " ORDER BY model, level, pour_id", args)]
    con.close()
    return rows


def push_walls(st: SeaTable, features: Path, model: str | None):
    rules = sort_rules(st.rows(CLASSES))
    walls = load_walls(features, model)
    existing = {r.get("GUID"): r for r in st.rows(WALLS)}
    append, update, counts = [], [], {}
    for w in walls:
        auto = classify(w, rules)
        counts[auto or "(unclassified)"] = counts.get(auto or "(unclassified)", 0) + 1
        row = {sc: w.get(fc) for sc, fc in WALL_COLUMNS}
        row["Auto class"] = auto
        old = existing.get(w["guid"])
        if old is None:
            append.append(row)
        else:
            update.append({"row_id": old["_id"], "row": row})  # Override class is not in `row`: kept
    gone = [r["_id"] for g, r in existing.items() if g not in {w["guid"] for w in walls} and (not model or r.get("Model") == model)]
    st.append(WALLS, append)
    st.update(WALLS, update)
    if gone:
        st.delete(WALLS, gone)
    print(f"Wall Features: {len(append)} added, {len(update)} updated, {len(gone)} removed")
    for k in sorted(counts):
        print(f"  {k or '(unclassified)':16s} {counts[k]}")


def pull_rates(st: SeaTable, out: Path):
    classes = st.rows(CLASSES)
    walls = [
        {
            "guid": r.get("GUID"), "class": r.get("Class") or "", "auto": r.get("Auto class") or "", "override": r.get("Override class") or "",
            # what was measured, for the user fields the generator writes on a wall's activities
            "shape": r.get("Shape"), "height_m": r.get("Height (m)"), "thickness_m": r.get("Thickness (m)"), "length_m": r.get("Length (m)"),
            "openings": r.get("Openings"), "opening_ratio": r.get("Opening ratio"), "formwork_m2": r.get("Formwork (m2)"), "volume_m3": r.get("Volume (m3)"),
        }
        for r in st.rows(WALLS)
    ]
    payload = {"classes": [{k: v for k, v in r.items() if not k.startswith("_")} for r in sort_rules(classes)], "walls": walls}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    overridden = sum(1 for w in walls if w["override"])
    print(f"Wrote {out}: {len(payload['classes'])} classes, {len(walls)} walls ({overridden} overridden)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["push-walls", "pull-rates"])
    ap.add_argument("--env", type=Path, default=DEFAULT_ENV)
    ap.add_argument("--features", type=Path, default=DEFAULT_FEATURES)
    ap.add_argument("--model")
    ap.add_argument("--out", type=Path, default=DEFAULT_RATES)
    args = ap.parse_args()
    st = SeaTable(read_env(args.env))
    if args.command == "push-walls":
        push_walls(st, args.features, args.model)
    else:
        pull_rates(st, args.out)


if __name__ == "__main__":
    sys.exit(main())
