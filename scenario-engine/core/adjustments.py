# core/adjustments.py
"""Retired and extra activities, from the SeaTable tables "Retired", "Extra activities" and "Baselines".

The app pulls those three tables into a local JSON file (Settings > Retired and extra activities > Pull), so the
generator works with SeaTable switched off, like the rates file:

  retired   Task IDs left out of every generated programme (they are not regenerated)
  extras    activities added to every generated programme: Task ID, name, duration, the baseline they link to (its
            dates become the activity's target dates), predecessors / successors (Task IDs) and an optional WBS name
  baselines the named baselines with their start / finish dates (already resolved onto each extra)

The file is the one named by the INSIGHT_ADJUSTMENTS_FILE environment variable (the app sets it). No file, or an unreadable one: no adjustments.
"""
import json
import os
from xml.etree import ElementTree as ET

EXTRA_WBS_NAME = "Extra activities"


def load_adjustments(path=None):
    """{'retired': set of Task IDs, 'extras': [dict]} (both empty when there is no file)."""
    path = path or os.environ.get("INSIGHT_ADJUSTMENTS_FILE")
    empty = {"retired": set(), "extras": []}
    if not path or not os.path.isfile(path):
        return empty
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  Adjustments file not read ({path}): {e}")
        return empty
    retired = {str(r.get("taskId", "")).strip().upper() for r in data.get("retired", []) if str(r.get("taskId", "")).strip()}
    extras = [e for e in data.get("extras", []) if str(e.get("taskId", "")).strip()]
    return {"retired": retired, "extras": extras}


def drop_retired(activities, retired):
    """The activities without the retired Task IDs, and how many were left out. A pour's chain closes up around a
    removed phase (the intra-pour links follow the phases that are left)."""
    if not retired:
        return activities, 0
    kept = [a for a in activities if str(a.get("task_id", "")).strip().upper() not in retired]
    return kept, len(activities) - len(kept)


def extra_activities(extras, existing_ids, wbs_oid):
    """The extra activities as generator activities (no pour record), skipping a Task ID that already exists.
    A duration of 0 makes a finish milestone."""
    taken = {str(t).strip().upper() for t in existing_ids}
    out = []
    for e in extras:
        task_id = str(e["taskId"]).strip()
        if task_id.upper() in taken:
            print(f"  Extra activity {task_id} skipped: that Task ID is already in the programme")
            continue
        taken.add(task_id.upper())
        days = float(e.get("durationDays") or 0)
        act = {
            "rec": {},
            "phase": "Extra",
            "task_id": task_id,
            "task_name": str(e.get("name") or task_id),
            "duration_days": days,
            "resource": None,
            "wbs_oid": wbs_oid,
            "extra": True,
            "baseline_start": str(e.get("baselineStart") or ""),
            "baseline_finish": str(e.get("baselineFinish") or ""),
        }
        if days <= 0:
            act.update({"milestone": True, "milestone_type": "Finish", "duration_days": 0})
        out.append(act)
    return out


def extra_predecessors(extras, valid_ids):
    """{successor Task ID: [predecessor Task IDs]} from the extras' Predecessors and Successors columns (Task IDs that
    are not in the programme are ignored)."""
    valid = set(valid_ids)
    edges = {}

    def add(pred, succ):
        if pred in valid and succ in valid and pred != succ and pred not in edges.setdefault(succ, []):
            edges[succ].append(pred)

    for e in extras:
        me = str(e["taskId"]).strip()
        for p in e.get("predecessors", []):
            add(str(p).strip(), me)
        for s in e.get("successors", []):
            add(me, str(s).strip())
    return {k: v for k, v in edges.items() if v}


def apply_baselines(project_elem, extras_acts):
    """After the CPM: an extra activity linked to a baseline keeps the CPM dates as its current ones (StartDate /
    FinishDate) and gets the baseline's dates as its target (planned) dates, which the app draws as its baseline bar."""
    done = 0
    wanted = {a["task_id"]: a for a in extras_acts if a.get("baseline_start") or a.get("baseline_finish")}
    if not wanted:
        return 0
    for act in project_elem.findall("Activity"):
        task = wanted.get(act.findtext("Id"))
        if task is None:
            continue
        start_el, finish_el = act.find("PlannedStartDate"), act.find("PlannedFinishDate")
        if start_el is None or finish_el is None:
            continue
        current_start, current_finish = start_el.text, finish_el.text
        # The current dates go in right after the planned ones (the schema's order), as <StartDate> / <FinishDate>.
        children = list(act)
        at = children.index(finish_el) + 1
        sd, fd = ET.Element("StartDate"), ET.Element("FinishDate")
        sd.text, fd.text = current_start, current_finish
        act.insert(at, sd)
        act.insert(at + 1, fd)
        for el, key, current in ((start_el, "baseline_start", current_start), (finish_el, "baseline_finish", current_finish)):
            day = task.get(key)
            if day:
                el.text = f"{day}T{(current or 'T07:00:00').split('T')[-1]}"
        done += 1
    return done
