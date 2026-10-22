# core/levels.py
"""Which property of a pour is its level, and in what order the levels are built.

The generator used to read a property called exactly "Level" and take the first whole number in its text as the level's place in the order
("L2", "2" and "Level 02" are level 2; text with no number is level 0). The scenario's rules now say both, as two settings:

  levelProperty   the property of the pour data that holds the level (empty: "Level")
  levelOrder      the level values, lowest first (empty: the first whole number of each value, as before)

With neither set, nothing changes: the records keep exactly what they were built with. With a property, the level is that property's value (its text
is the level's name everywhere). With an order, a level's place is its position in the list (1, 2, 3 ...), so "Podium, L1, L2, Roof" build in that order
whatever the text; a value that is not in the list comes after the listed ones, alphabetically. Everything downstream (the level gate, the per-level
steps of a sequence, the activity IDs, the WBS) reads the level through the same record fields, so it follows.
"""
import re

DEFAULT_PROPERTY = "Level"
_KEEP = ("level_int", "level_code", "level_display", "lg2", "lg3", "task_id_base", "general_level_3", "concrete_wbs_name")


def definition(settings):
    """(property name, ordered level values) from the rules' settings."""
    settings = settings or {}
    prop = str(settings.get("levelProperty") or "").strip() or DEFAULT_PROPERTY
    raw = settings.get("levelOrder") or []
    if isinstance(raw, str):
        raw = raw.split("|")
    order, seen = [], set()
    for v in raw:
        text = str(v).strip()
        if text and text.upper() not in seen:
            seen.add(text.upper())
            order.append(text)
    return prop, order


def is_default(prop, order):
    return prop == DEFAULT_PROPERTY and not order


def parse_level_int(value):
    """The first whole number in the text, 0 when there is none (the generator's original reading of a level)."""
    if not value:
        return 0
    match = re.search(r"[-+]?\d+", str(value).strip())
    return int(match.group(0)) if match else 0


def _code(level_int, fallback, padded):
    return fallback if level_int <= 0 else (f"L{level_int:02d}" if padded else f"L{level_int}")


def apply(records, settings, fallback_code="L0", padded=False):
    """Puts the level definition on every record (and puts the original reading back when there is none)."""
    prop, order = definition(settings)
    for rec in records:
        rec.setdefault("_level0", {k: rec.get(k) for k in _KEEP})
    if is_default(prop, order):
        for rec in records:
            original = rec.get("_level0")
            if original:
                rec.update(original)
                rec.pop("level_label", None)
        return

    def raw(rec):
        value = (rec.get("pour_pset") or {}).get(prop)
        return str(value).strip() if value is not None else ""

    ranks = {name.upper(): i + 1 for i, name in enumerate(order)}
    if order:
        # values the list does not name come after it, alphabetically, so every level has a place of its own
        unlisted = sorted({(raw(r) or "Unknown").upper() for r in records} - set(ranks))
        for i, name in enumerate(unlisted):
            ranks[name] = len(order) + 1 + i
    for rec in records:
        original = rec["_level0"]
        display = raw(rec) or "Unknown"
        level_int = ranks[display.upper()] if order else parse_level_int(display)
        code = _code(level_int, fallback_code, padded)
        building = str(rec.get("building") or "")
        was_code, was_display = str(original.get("level_code") or ""), str(original.get("level_display") or "")
        rec["level_int"], rec["level_code"], rec["level_display"], rec["level_label"] = level_int, code, display, display
        # what was built from the level at the start: logic groups, the task ID base, the CWA General Level 3 and the WBS name
        for key in ("lg2", "lg3"):
            text, prefix = str(original.get(key) or ""), f"{building}-{was_code}"
            rec[key] = f"{building}-{code}{text[len(prefix):]}" if text.startswith(prefix) else text
        base = str(original.get("task_id_base") or "")
        rec["task_id_base"] = base[: -len(was_code)] + code if was_code and base.endswith(was_code) else base
        parts = str(original.get("general_level_3") or "").split("/")
        if len(parts) >= 2:
            parts[1] = raw(rec)
        rec["general_level_3"] = "/".join(parts)
        wbs = str(original.get("concrete_wbs_name") or "")
        rec["concrete_wbs_name"] = wbs.replace(f" - {was_display} - ", f" - {display} - ") if was_display else wbs
