# core/zones.py
"""Which property of a pour is its zone, and which zones are connected to the rest of the building and which are not.

The generator used to read a property called "Building Zone" (or "Zone") and take any text with "CONNECTED" in it as a connected zone and any text with
"DISCONNECTED" in it as a disconnected one (a disconnected zone is built on its own, not tied to the building's levels). The scenario's rules now say both,
as three settings:

  zoneProperty       the property of the pour data that holds the zone (empty: "Building Zone", then "Zone")
  zoneConnected      the zone values that are connected
  zoneDisconnected   the zone values that are disconnected (a value in both lists is disconnected)

With none of them set, nothing changes. With a list, only the values named in it are connected or disconnected (a value in neither is not a zone of
either kind), and the pour's zone is called "CONNECTED" or "DISCONNECTED" for the ordering of the programme, whatever its text says. With only a property,
the words in its text decide, as before. What is made from the zone (the C / D of the activity ID, the logic group, CWA General Level 3) follows.

This runs after core/levels.py, which puts every text made from the level back to what it was built with each time: the zone is then applied to those.
"""
import re

DEFAULT_PROPERTIES = ("Building Zone", "Zone")
_KEEP = ("building_zone", "is_connected", "is_disconnected")
_TEXTS = ("task_id_base", "lg2", "general_level_3")


def _names(raw):
    if isinstance(raw, str):
        raw = raw.split("|")
    out, seen = [], set()
    for v in raw or []:
        text = str(v).strip()
        if text and text.upper() not in seen:
            seen.add(text.upper())
            out.append(text)
    return out


def definition(settings):
    """(property name or '', connected values, disconnected values) from the rules' settings."""
    settings = settings or {}
    return str(settings.get("zoneProperty") or "").strip(), _names(settings.get("zoneConnected")), _names(settings.get("zoneDisconnected"))


def is_default(prop, connected, disconnected):
    return not prop and not connected and not disconnected


def _raw(rec, prop):
    pset = rec.get("pour_pset") or {}
    value = pset.get(prop) if prop else (pset.get(DEFAULT_PROPERTIES[0]) or pset.get(DEFAULT_PROPERTIES[1]))
    return str(value).strip() if value is not None else ""


def flags(raw, connected, disconnected):
    """(is_connected, is_disconnected) of a zone value."""
    key = raw.upper()
    if connected or disconnected:
        dis = key in {v.upper() for v in disconnected}
        return (key in {v.upper() for v in connected}) and not dis, dis
    dis = "DISCONNECTED" in key
    return ("CONNECTED" in key) and not dis, dis


def _code(connected, disconnected):
    return "D" if disconnected else "C" if connected else ""


def _label(connected, disconnected):
    return "Disconnected - " if disconnected else "Connected - " if connected else ""


def _swap_code(base, level_code, old, new):
    """The zone code of an activity ID base (<project>-<building>-<level>[-C|-D]-<type>-<number>): the old one out, the new one in."""
    match = re.search(rf"-{re.escape(level_code)}(?=-|$)", base or "")
    if not match:
        return base
    rest = base[match.end():]
    if old and (rest == f"-{old}" or rest.startswith(f"-{old}-")):
        rest = rest[len(old) + 1:]
    if new:
        rest = f"-{new}" + rest
    return base[:match.end()] + rest


def apply(records, settings):
    """Puts the zone definition on every record (and the original reading back when there is none)."""
    prop, connected, disconnected = definition(settings)
    for rec in records:
        rec.setdefault("_zone0", {k: rec.get(k) for k in _KEEP})
        # A text this module wrote and nothing has put back since (core/levels.py does, each run) goes back to what it was, so applying twice is the same as once.
        written = rec.get("_zone_out")
        if written:
            for k in _TEXTS:
                if rec.get(k) == written[k]:
                    rec[k] = rec["_zone_in"][k]
        rec["_zone_in"] = {k: rec.get(k) for k in _TEXTS}
    if is_default(prop, connected, disconnected):
        for rec in records:
            rec.update(rec["_zone0"])
            rec.pop("_zone_out", None)
        return
    listed = bool(connected or disconnected)
    for rec in records:
        original = rec["_zone0"]
        raw = _raw(rec, prop)
        con, dis = flags(raw, connected, disconnected)
        rec["building_zone"] = ("DISCONNECTED" if dis else "CONNECTED" if con else raw) if listed else raw
        rec["is_connected"], rec["is_disconnected"] = con, dis
        was_con, was_dis = bool(original.get("is_connected")), bool(original.get("is_disconnected"))
        if (was_con, was_dis) != (con, dis):
            level0 = str((rec.get("_level0") or {}).get("level_code") or rec.get("level_code") or "")
            rec["task_id_base"] = _swap_code(str(rec.get("task_id_base") or ""), level0, _code(was_con, was_dis), _code(con, dis))
            prefix = f"{rec.get('building') or ''}-{rec.get('level_code') or ''} - "
            text = str(rec.get("lg2") or "")
            if text.startswith(prefix):
                rest = text[len(prefix):]
                old_label = _label(was_con, was_dis)
                if old_label and rest.startswith(old_label):
                    rest = rest[len(old_label):]
                rec["lg2"] = f"{prefix}{_label(con, dis)}{rest}".strip(" -")
        parts = str(rec.get("general_level_3") or "").split("/")
        if len(parts) >= 3:
            parts[2] = raw
            rec["general_level_3"] = "/".join(parts)
    for rec in records:
        rec["_zone_out"] = {k: rec.get(k) for k in _TEXTS}
