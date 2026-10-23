"""
Long-running schedule generator for the app's Scenarios.

A one-shot `main.py --stage schedule` run spends most of its ~15 s starting
Python, opening the enriched IFC, rebuilding every pour record and writing
the Excel report — none of which changes when only the pour order does.
This process stays up (started by vite-plugins/scenarios.ts) and keeps, per
building, the opened model, its pour records and clash results; a request
then only rebuilds activities, relationships, CPM dates and the XML (about a
second). Scenarios come from the app as JSON — no Excel is read or written.

Protocol: one JSON object per line on stdin, one JSON reply per line on
stdout. Request:
  {"id": 1, "op": "generate" | "pours" | "warm",
   "input": "<root>/1-input-ifc/<stem>.ifc", "scenarioDir": "...",
   "startDate": "YYYY-MM-DD" | null,
   "sequence": [{"GUID": "...", "Index": 3, "Phase": ""}, ...],
   "relations": [{"ActivityID1": "...", "ActivityID2": "...", "Relation": "FS", "Lag": 0}],
   "crews": [{"Phase": "Rebar", "PourType": "", "Trade": "SF", "Crew": "6"}]}
Reply: {"id": 1, "ok": true, "xml": "<path>", "log": "...", "seconds": 0.9}
   ("pours": headers, rows, trades, phases, defaultCrews instead of xml)
   or  {"id": 1, "ok": false, "error": "...", "needsFullRun": true|false}
needsFullRun: no enriched IFC / geometry cache for this source model yet (or
they are stale) — the full generator builds them once.
"""
import contextlib
import io
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# Replies go to the real stdout; everything the generator prints goes to a
# per-request log instead (or stderr), so it can never corrupt the protocol.
_reply_stream = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

import ifcopenshell  # noqa: E402
import pandas as pd  # noqa: E402

import config as _config  # noqa: E402
import main as engine  # noqa: E402
from core.excel_exporter import _build_sequence_order_template  # noqa: E402
from core import pours_cache  # noqa: E402
from core import work_items as _work_items  # noqa: E402


class NeedsFullRun(Exception):
    pass


_sessions = {}   # enriched IFC path -> {"key", "records", "clashes"}
MAX_SESSIONS = 4


def _session(input_path: Path, scenario_dir: Path):
    stem = input_path.stem
    ifc_dir = scenario_dir / "2-enriched-ifc"
    ifc_path = ifc_dir / f"{stem}.ifc"
    cache_path = ifc_dir / f"{stem}.geometry_cache.json"
    cache = engine._load_geometry_cache(cache_path)
    if not (cache and ifc_path.is_file() and cache.get("fingerprint") == engine._source_fingerprint(input_path)):
        raise NeedsFullRun(f"No up-to-date enriched IFC / geometry cache for {stem} in {ifc_dir}.")

    key = (ifc_path.stat().st_mtime, cache_path.stat().st_mtime)
    hit = _sessions.get(str(ifc_path))
    if hit and hit["key"] == key:
        return hit

    model = ifcopenshell.open(str(ifc_path))
    property_cache = {}
    for rel in model.by_type("IfcRelDefinesByProperties"):
        pset = rel.RelatingPropertyDefinition
        name = getattr(pset, "Name", None)
        if name:
            first = rel.RelatedObjects[0] if rel.RelatedObjects else None
            property_cache.setdefault(name, {})[getattr(first, "GlobalId", None)] = pset
    records = engine.build_pour_records(model, property_cache, source_stem=stem,
                                        cached_bbox_heights=cache.get("bbox_heights"))
    # A cache without the pours' heights (a run stopped before writing them)
    # makes every load measure all the geometry again (minutes): keep them now.
    if not cache.get("bbox_heights"):
        heights = {r["element"].GlobalId: r.get("bbox_height") for r in records if r.get("element") is not None}
        engine._save_geometry_cache(cache_path, cache.get("fingerprint"), cache.get("clashes") or [], heights)
        key = (ifc_path.stat().st_mtime, cache_path.stat().st_mtime)
    session = {"key": key, "model": model, "records": records, "clashes": cache.get("clashes") or []}
    if len(_sessions) >= MAX_SESSIONS:
        _sessions.pop(next(iter(_sessions)))
    _sessions[str(ifc_path)] = session
    return session


def _start_date(req):
    start = req.get("startDate")
    return (datetime.strptime(start, "%Y-%m-%d") if start
            else datetime.today().replace(hour=0, minute=0, second=0, microsecond=0))


def _cell(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):  # NaN / pandas NA (nullable Index)
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, float):
        if v != v:  # NaN
            return ""
        return str(int(v)) if v.is_integer() else str(round(v, 3))
    return str(v)


def _pours(req, session, input_path: Path, scenario_dir: Path):
    """The building's pours with the SequenceOrder template's columns (plus
    Building, Building Zone, Included) and the generator's own automatic
    order in Index — the app's pour table and its "auto" baseline. Also the
    labour trades and crew phases for the app's crew editor."""
    if "pours" in session:
        return session["pours"]
    records, clashes = session["records"], session["clashes"]
    overrides = engine.overrides_from_scenario({})
    engine.resolve_pour_ids(records, clashes, overrides, False)
    activities = engine.create_all_activities(records, overrides)
    auto_xml = scenario_dir / "3-schedule-xml" / f"{input_path.stem}.auto.xml"
    auto_xml.parent.mkdir(parents=True, exist_ok=True)
    built = engine.build_schedule_xml(records, activities, clashes, overrides, auto_xml, start_date=_start_date(req))
    df = _build_sequence_order_template(records, activities, built["intra_predecessors"], built["task_start_dates"])
    by_guid = {getattr(r.get("element"), "GlobalId", None): r for r in records}
    extra = ["Building", "Building Zone", "Included"]
    headers = [str(c) for c in df.columns] + extra
    rows = []
    for _, row in df.iterrows():
        rec = by_guid.get(row.get("GUID"), {})
        rows.append([_cell(row[c]) for c in df.columns] + [
            str(rec.get("building", "") or ""),
            str(rec.get("building_zone", "") or ""),
            "Yes" if str(rec.get("include", "NO")).upper() == "YES" else "No",
        ])
    phases = sorted({c["phase"] for c in _config.DEFAULT_CHAIN + _config.DEFAULT_PRECAST_CHAIN + _config.DEFAULT_HEAVY_PRECAST_CHAIN})
    session["pours"] = {
        "headers": headers,
        "rows": rows,
        "trades": [],  # the scenario's Trade rules (the panel lists them)
        "phases": phases,
        "defaultCrews": [],
        # What the generator does without rules (the Rules panel shows it next to the scenario's own rows).
        "defaults": {**engine._rules.engine_defaults(), "pourTypes": sorted(engine.CONTEMPLATED_POUR_TYPES)},
    }
    return session["pours"]


def _handle(req):
    """op "warm": load the building's model / records ahead of the first
    request. op "pours": the pour list (see _pours). op "generate" (default):
    the XML for the request's pour order, manual links and crews."""
    input_path = Path(req["input"])
    scenario_dir = Path(req["scenarioDir"])
    stem = input_path.stem
    op = req.get("op") or "generate"
    if op == "pours":
        # The pour list is kept on disk (core/pours_cache.py): while the model and the generator are the same, opening a scenario does not
        # open the IFC, build the pours or generate a programme again.
        ifc_dir = scenario_dir / "2-enriched-ifc"
        key = pours_cache.key_for(input_path, ifc_dir / f"{stem}.ifc", ifc_dir / f"{stem}.geometry_cache.json")
        hit = pours_cache.read(scenario_dir, stem, key)
        if hit is not None:
            return hit
        result = _pours(req, _session(input_path, scenario_dir), input_path, scenario_dir)
        # (a first run may have written the geometry cache the key is made from)
        pours_cache.write(scenario_dir, stem, pours_cache.key_for(input_path, ifc_dir / f"{stem}.ifc", ifc_dir / f"{stem}.geometry_cache.json"), result)
        return result
    if req.get("workItems"):
        # Work items (core/work_items.py): units of work the app made from any objects, with no model behind them.
        req = _work_items.with_groups(req)
        overrides = engine.overrides_from_scenario(req)
        xml_path = scenario_dir / "3-schedule-xml" / f"{stem}.xml"
        xml_path.parent.mkdir(parents=True, exist_ok=True)
        records, clashes = engine.build_work_item_records(req["workItems"]), []
        engine.resolve_pour_ids(records, clashes, overrides, False)
        activities = engine.create_all_activities(records, overrides)
        engine.build_schedule_xml(records, activities, clashes, overrides, xml_path, start_date=_start_date(req))
        return str(xml_path)
    session = _session(input_path, scenario_dir)
    if op == "warm":
        return None

    overrides = engine.overrides_from_scenario(req)
    xml_path = scenario_dir / "3-schedule-xml" / f"{stem}.xml"
    xml_path.parent.mkdir(parents=True, exist_ok=True)
    records, clashes = session["records"], session["clashes"]
    engine.resolve_pour_ids(records, clashes, overrides, False)
    activities = engine.create_all_activities(records, overrides)
    engine.build_schedule_xml(records, activities, clashes, overrides, xml_path, start_date=_start_date(req))
    return str(xml_path)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        reply = {}
        log = io.StringIO()
        t0 = time.perf_counter()
        try:
            req = json.loads(line)
            reply["id"] = req.get("id")
            with contextlib.redirect_stdout(log):
                result = _handle(req)
            if isinstance(result, dict):
                reply.update(ok=True, **result)
            else:
                reply.update(ok=True, xml=result)
        except NeedsFullRun as e:
            reply.update(ok=False, error=str(e), needsFullRun=True)
        except Exception as e:  # noqa: BLE001 — reported to the app, process stays up
            reply.update(ok=False, error=f"{type(e).__name__}: {e}", needsFullRun=False, trace=traceback.format_exc(limit=6))
        reply["log"] = log.getvalue()
        reply["seconds"] = round(time.perf_counter() - t0, 2)
        _reply_stream.write(json.dumps(reply) + "\n")
        _reply_stream.flush()


if __name__ == "__main__":
    main()
