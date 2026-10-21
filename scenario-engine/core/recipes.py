# core/recipes.py
"""Recipes (docs/design/recipes.md, src/prs/recipes.ts): how a kind of object is built, in their own file apart from the scenario's sequence.

A recipe belongs to a rule group and holds tasks (the activities of the object, in order, with edges between them) and the days, rate, crew
and calendar of each. They are compiled here into the `chains` and `assignments` rows that core/rules.py already reads, so the generator has
no second path. Keep this in step with compileRecipes in src/prs/recipes.ts: tests/unit/recipes.test.ts and tests/test_recipes.py check both
against the same preset.

A recipe is {id, group, priority, chain, tasks: [{phase, name, suffix, material, days, formula, rate, density, crew, calendar, priority, finishAfter,
gates, enabled, note}], edges: [{from, to, sharePct}], enabled}. `chain` false (default true): the recipe only sets the values of its tasks.
"""


def _text(value):
    return str(value if value is not None else "").strip()


def _follows_text(edges, phase):
    """What a task follows, as the chain reads it: "Decking@80, Under Slab"."""
    parts = []
    for e in edges:
        if _text(e.get("to")).upper() != phase.upper():
            continue
        name = _text(e.get("from"))
        kind = _text(e.get("type")).upper()
        lag = _number(e.get("lagHours"))
        if (kind and kind != "FS") or lag:  # an explicit type and lag: "Rebar:SS+16" (hours)
            parts.append(f"{name}:{kind or 'FS'}{'+' if lag >= 0 else '-'}{abs(lag):g}")
            continue
        try:
            pct = float(e.get("sharePct"))
        except (TypeError, ValueError):
            pct = 100.0
        parts.append(f"{name}@{pct:g}" if pct < 100 else name)
    return ", ".join(parts)


def _row_id(group, phase):
    return f"{group}|{phase}".upper()


def _has_values(task):
    return task.get("days") is not None or any(_text(task.get(k)) for k in ("rate", "density", "crew", "calendar", "formula"))


# A task's equipment, cranes and materials: [{type, count}] each, kept apart as resources of that kind.
_USE_KEYS = (("equipment", "equipment"), ("cranes", "crane"), ("materials", "material"))


def _number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _uses_of(task):
    out = []
    for key, kind in _USE_KEYS:
        for item in task.get(key) or []:
            if not isinstance(item, dict) or not _text(item.get("type")):
                continue
            count = _number(item.get("count")) if item.get("count") is not None else 1.0
            if count > 0:
                out.append({"kind": kind, "type": _text(item.get("type")), "count": count})
    return out


def compile_recipes(data):
    """({"chains": [...], "assignments": [...], "uses": [...], "links": [...]}) the rows a recipes file stands for; `uses` are the equipment, cranes
    and materials of each task (rows with `when`, `phase`, `priority`), `links` the recipe links of its tasks (to a task of another recipe, which must
    be there). A recipe switched off gives nothing."""
    chains, assignments, uses, links = [], [], [], []
    recipes = data.get("recipes") if isinstance(data, dict) else None
    by_id = {_text(r.get("id")).upper(): r for r in recipes or [] if isinstance(r, dict) and r.get("enabled") is not False}
    for recipe in recipes or []:
        if not isinstance(recipe, dict) or recipe.get("enabled") is False:
            continue
        group = _text(recipe.get("group"))
        edges = [e for e in recipe.get("edges") or [] if isinstance(e, dict)]
        in_chain = recipe.get("chain") is not False
        # (a values-only recipe may have a task with no phase: its values are for every phase of the group, a calendar for instance)
        tasks = [t for t in recipe.get("tasks") or [] if isinstance(t, dict) and (_text(t.get("phase")) or not in_chain)]
        try:
            priority = float(recipe.get("priority") or 0)
        except (TypeError, ValueError):
            priority = 0.0
        if in_chain:
            for order, t in enumerate(tasks, 1):
                phase = _text(t.get("phase"))
                row = {"id": _row_id(group, phase), "group": group, "order": order, "phase": phase, "priority": priority, "recipe": _text(recipe.get("id"))}
                if t.get("suffix") is not None:
                    row["suffix"] = t["suffix"]
                if t.get("name") is not None:
                    row["label"] = t["name"]
                if _text(t.get("material")):
                    row["material"] = t["material"]
                follows = _follows_text(edges, phase)
                if follows:
                    row["follows"] = follows
                if t.get("finishAfter"):
                    row["finishAfter"] = True
                if t.get("gates"):
                    row["gates"] = True
                if t.get("enabled") is False:
                    row["enabled"] = False
                chains.append(row)
        for t in tasks:
            if not _has_values(t):
                continue
            phase = _text(t.get("phase"))
            row = {"id": _row_id(group, phase), "group": group, "phase": phase, "priority": t.get("priority") or 0}
            for key in ("rate", "days", "density", "crew", "calendar", "formula"):
                if t.get(key) is not None and _text(t.get(key)) != "":
                    row[key] = t[key]
            if not in_chain and t.get("enabled") is False:
                row["enabled"] = False
            assignments.append(row)
        for t in tasks:
            wanted = _uses_of(t)
            if wanted and t.get("enabled") is not False:
                phase = _text(t.get("phase"))
                uses.append({"id": _row_id(group, phase), "when": {"group": group} if group else {}, "phase": phase,
                             "priority": _number(t.get("priority")), "uses": wanted})
        for t in tasks:
            if t.get("enabled") is False:
                continue
            for link in t.get("links") or []:
                target = by_id.get(_text(link.get("recipe")).upper()) if isinstance(link, dict) else None
                if target is None or link.get("enabled") is False or not _text(link.get("phase")) or not _text(t.get("phase")):
                    continue
                links.append({
                    "id": f"{recipe.get('id')}.{_text(t.get('phase'))}>{target.get('id')}.{_text(link.get('phase'))}",
                    "group": group, "phase": _text(t.get("phase")), "targetGroup": _text(target.get("group")), "targetPhase": _text(link.get("phase")),
                    "direction": "before" if _text(link.get("direction")).lower() == "before" else "after",
                    "type": _text(link.get("type")).upper() or "FS", "lagHours": _number(link.get("lagHours")),
                    "scope": _text(link.get("scope")).lower() if _text(link.get("scope")).lower() in ("level", "building", "all") else "level",
                })
    return {"chains": chains, "assignments": assignments, "uses": uses, "links": links}
