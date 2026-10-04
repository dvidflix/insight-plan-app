"""
The wall class and rate assumptions of an element, for the user fields written on its
activities. Reads the local copy of the SeaTable "Insight Plan Rates" base
(seatable_sync.py pull-rates): the file named by the INSIGHT_RATES_FILE environment
variable, else config.RATES_FILE. No file, or an element with no class: no fields.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

try:
    from config import RATES_FILE as _CONFIG_RATES_FILE
except ImportError:  # config without the setting
    _CONFIG_RATES_FILE = r"C:\insight-stack\data\rates.json"

_cache = {"path": None, "mtime": None, "classes": {}, "walls": {}}


def _load():
    path = Path(os.environ.get("INSIGHT_RATES_FILE") or _CONFIG_RATES_FILE)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        _cache.update(path=str(path), mtime=None, classes={}, walls={})
        return
    if _cache["path"] == str(path) and _cache["mtime"] == mtime:
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    _cache.update(
        path=str(path),
        mtime=mtime,
        classes={c["Class"]: c for c in data.get("classes", [])},
        walls={w["guid"]: w for w in data.get("walls", []) if w.get("guid")},
    )


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _g(x, digits=2):
    """1.70 -> '1.7', 6.0 -> '6'."""
    return f"{round(x, digits):g}"


def _rate(c, phase):
    """(productivity, unit, basis text) of a class for an activity phase, or (None, None, None)."""
    rebar_rate = _num(c.get("Rebar (t per m3)"))
    if phase == "Rebar":
        p, crew = _num(c.get("Rebar productivity (t per crew-day)")), _num(c.get("Rebar crew (steel fixers)"))
        if p is None:
            return None, None, None
        basis = f"{_g(p)} t per crew-day" + (f", crew {_g(crew)} steel fixers" if crew else "") + (f", rebar {_g(rebar_rate)} t/m3" if rebar_rate else "")
        return p, "t per crew-day", basis
    if phase == "Formwork":
        p, crew = _num(c.get("Formwork productivity (m2 per crew-day)")), _num(c.get("Formwork crew (carpenters)"))
        emb, emb_crew = _num(c.get("Embedments (days)")), _num(c.get("Embedments crew"))
        if p is None:
            return None, None, None
        basis = f"{_g(p)} m2 per crew-day" + (f", crew {_g(crew)} carpenters" if crew else "")
        if emb is not None:
            basis += f"; embedments {_g(emb)} d" + (f", crew {_g(emb_crew)}" if emb_crew else "")
        return p, "m2 per crew-day", basis
    if phase == "Concrete":
        p, crew, cure = _num(c.get("Concrete productivity (m3 per crew-day)")), _num(c.get("Concrete crew (concrete gang)")), _num(c.get("Curing and striking (days)"))
        if p is None:
            return None, None, None
        basis = f"{_g(p)} m3 per crew-day" + (f", crew {_g(crew)} concrete gang" if crew else "")
        if cure is not None:
            basis += f"; curing and striking {_g(cure)} d"
        return p, "m3 per crew-day", basis
    return None, None, None


def _measured(w):
    parts = []
    for key, label in (("height_m", "h"), ("thickness_m", "t"), ("length_m", "L")):
        v = _num(w.get(key))
        if v is not None:
            parts.append(f"{label} {_g(v)} m")
    openings = _num(w.get("openings"))
    if openings:
        ratio = _num(w.get("opening_ratio")) or 0
        parts.append(f"{int(openings)} openings ({round(ratio * 100)}%)")
    fw = _num(w.get("formwork_m2"))
    if fw is not None:
        parts.append(f"formwork {_g(fw, 0)} m2")
    return " | ".join(parts)


def rate_fields(guid: str, phase: str) -> dict | None:
    """User-field values for an activity of the wall `guid` in `phase`, or None.
    Keys: class, class_name, rate, rate_unit, rate_basis, measured (the last four may be absent)."""
    _load()
    w = _cache["walls"].get(guid)
    if not w or not w.get("class"):
        return None
    c = _cache["classes"].get(w["class"])
    if not c:
        return None
    out = {"class": w["class"], "class_name": str(c.get("Name") or "")}
    if w.get("override"):
        out["class_name"] += " (manual)"
    rate, unit, basis = _rate(c, phase)
    if rate is not None:
        out.update(rate=rate, rate_unit=unit, rate_basis=basis)
    measured = _measured(w)
    if measured:
        out["measured"] = measured
    return out
