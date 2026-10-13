# core/prs_links.py
"""Manual links that name activities by what they are (a selector), and extra activities from a scenario.

Programme Rules (docs/programme-rules): a link's end is an activity ID or

    select:{building=1HDAB; level=L1; type=SLAB; phase=Concrete; last}

The terms are joined by ";". `key=value` terms narrow the generated activities (case-insensitive; a value may list
alternatives with "|"); one closing word picks from what is left: each (every one, the default), first, last (by the
programme's order), all (same as each). Keys: building, level, type, general, stage, phase, zone, external, family, group (a
rule group of the scenario's rules), id (a regular expression on the Task ID), name (a regular expression on the name).

A selector that matches nothing makes no link and is reported, so a rule written for a bigger model does not fail on
a smaller one.
"""
import re

from core import rules as _rules

SELECT_PREFIX = "select:"
_MODES = {"each", "all", "first", "last"}


def is_selector(text):
    return str(text or "").strip().lower().startswith(SELECT_PREFIX)


def parse_selector(text):
    """({key: [accepted values, lower case]}, mode) from "select:{...}"; raises ValueError when it cannot be read."""
    body = str(text).strip()[len(SELECT_PREFIX):].strip()
    if body.startswith("{") and body.endswith("}"):
        body = body[1:-1]
    terms, mode = {}, "each"
    for part in body.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            if part.lower() not in _MODES:
                raise ValueError(f"Unknown word '{part}' in selector")
            mode = part.lower()
            continue
        key, value = part.split("=", 1)
        key = key.strip().lower()
        values = [v.strip().lower() for v in value.split("|") if v.strip()]
        if not key or not values:
            raise ValueError(f"Empty term in selector '{part}'")
        terms[key] = values
    return terms, mode


def _norm(value):
    return str(value if value is not None else "").strip().replace(" ", "_").lower()


def _zone(rec):
    if rec.get("is_disconnected"):
        return "disconnected"
    if rec.get("is_connected"):
        return "connected"
    return ""


def _attribute(act, key):
    """What an activity is, for one selector key (a list of lower-case strings; any may match)."""
    rec = act.get("rec") or {}
    if key == "building":
        return [_norm(rec.get("building")), _norm(rec.get("unit_building"))]
    if key == "level":
        return [_norm(rec.get("level_code")), _norm(rec.get("level_display"))]
    if key == "type":
        return [_norm(rec.get("pour_type"))]
    if key == "general":
        return [_norm(rec.get("general_pour_type"))]
    if key == "stage":
        return [_norm(rec.get("conc_stage"))]
    if key == "phase":
        return [_norm(act.get("phase"))]
    if key == "zone":
        return [_zone(rec)]
    if key == "external":
        return ["true" if rec.get("is_external") else "false"]
    if key == "family":
        return [_norm(_rules.family_of(rec))]
    if key == "group":
        return [_norm(g) for g in _rules.active().group_ids(rec)]
    return []


def _matches(act, terms):
    for key, accepted in terms.items():
        if key in ("id", "name"):
            text = str(act.get("task_id" if key == "id" else "task_name") or "")
            if not any(re.search(p, text, re.IGNORECASE) for p in accepted):
                return False
            continue
        wanted = [_norm(a) for a in accepted]
        if not any(h and h in wanted for h in _attribute(act, key)):
            return False
    return True


def select_ids(selector, activities):
    """Task IDs of the activities a selector picks, in the programme's order."""
    terms, mode = parse_selector(selector)
    picked = [a["task_id"] for a in activities if a.get("task_id") and not a.get("extra") and not a.get("loe") and not a.get("rule_milestone") and _matches(a, terms)]
    if mode == "first":
        return picked[:1]
    if mode == "last":
        return picked[-1:]
    return picked


def resolve_relations(relations, activities):
    """The manual links with selector ends turned into links between Task IDs.
    Returns (relations, messages): a selector end gives one link per match (each side may match several); one that
    matches nothing, or cannot be read, gives none and a message."""
    known = {str(a.get("task_id")) for a in activities if a.get("task_id")}
    out, messages = [], []

    def ends(value):
        if not is_selector(value):
            return [str(value).strip()]
        try:
            ids = select_ids(value, activities)
        except (ValueError, re.error) as e:
            messages.append(f"Link end {value}: {e}")
            return []
        if not ids:
            messages.append(f"Link end {value}: no activity matches")
        return ids

    for rel in relations or []:
        a1, a2 = rel.get("ActivityID1", ""), rel.get("ActivityID2", "")
        if not (is_selector(a1) or is_selector(a2)):
            out.append(rel)
            continue
        for p in ends(a1):
            for s in ends(a2):
                if p != s and (p in known or not is_selector(a1)) and (s in known or not is_selector(a2)):
                    out.append({**rel, "ActivityID1": p, "ActivityID2": s})
    return out, messages


def merge_extras(adjustments, scenario_extras):
    """The adjustments (core.adjustments.load_adjustments) with the scenario's own extra activities added. Rows are
    {"TaskID", "Name", "DurationDays", "BaselineStart", "BaselineFinish"}; a Task ID already there is replaced by the
    scenario's row."""
    rows = [r for r in scenario_extras or [] if str(r.get("TaskID") or "").strip()]
    if not rows:
        return adjustments
    mine = {str(r["TaskID"]).strip().upper() for r in rows}
    kept = [e for e in adjustments.get("extras", []) if str(e.get("taskId", "")).strip().upper() not in mine]
    added = []
    for r in rows:
        try:
            days = float(r.get("DurationDays") or 0)
        except (TypeError, ValueError):
            days = 0.0
        added.append({
            "taskId": str(r["TaskID"]).strip(),
            "name": str(r.get("Name") or "").strip(),
            "durationDays": days,
            "baselineStart": str(r.get("BaselineStart") or "").strip(),
            "baselineFinish": str(r.get("BaselineFinish") or "").strip(),
            "predecessors": [],
            "successors": [],
        })
    return {**adjustments, "extras": kept + added}
