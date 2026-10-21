# core/rule_logic.py
"""The logic the scenario's programme rules add to a generated programme (docs/programme-rules):

  level tasks   per building and level, a task such as "Walls" or "Slabs" whose start and finish come from its rule group
                (a level of effort: it starts with its earliest pour and finishes with its latest)
  sequences     rule groups put in order: what finishes in one step starts the next, level by level
  contacts      links from what the clash detection found touching a pour: all objects in contact below a slab precede it
  level links   activities (the extras, the open-ended ones, a selection) tied to the level tasks, FF by default

Each returns relations as dicts {"pred", "succ", "type" (FS SS FF SF), "lag" (working hours), "source", "replaces"} that
xml_builder.write_activities_and_relationships writes, ahead of the engine's own automatic links (so a cycle drops
the automatic link, never the rule's). Nothing here runs without rules.
"""
from collections import defaultdict

from config import PROJECT_SHORT
from core import rules as _rules
from core.clash_position import (
    classify_vertical_position, invert_position,
    DEFINITELY_BELOW, MAJORITY_BELOW, SIDE, MAJORITY_ABOVE, DEFINITELY_ABOVE, UNDETERMINED,
)
from core.prs_links import _matches, is_selector, parse_selector, select_ids
from core import xml_builder as _xml_builder

LEVEL_TASKS_WBS = "Level tasks"
RULE_LINKS_WBS = "Rule links"
_TYPES = {"FS", "SS", "FF", "SF"}

_POSITIONS = {
    "below": {DEFINITELY_BELOW, MAJORITY_BELOW},
    "above": {DEFINITELY_ABOVE, MAJORITY_ABOVE},
    "side": {SIDE},
    "any": {DEFINITELY_BELOW, MAJORITY_BELOW, SIDE, MAJORITY_ABOVE, DEFINITELY_ABOVE, UNDETERMINED},
}
_STRICT = {"below": {DEFINITELY_BELOW}, "above": {DEFINITELY_ABOVE}}


def _on(row):
    return isinstance(row, dict) and row.get("enabled") is not False


def _lag(row):
    try:
        return float(row.get("lagHours") or 0)
    except (TypeError, ValueError):
        return 0.0


def _type(row, default="FS"):
    t = str(row.get("type") or default).strip().upper()
    return t if t in _TYPES else default


def _relation(pred, succ, rel_type, lag, source, replaces=False, track=True):
    return {"pred": pred, "succ": succ, "type": rel_type, "lag": lag, "source": source, "replaces": replaces, "track": track}


class PourTasks:
    """The generated activities of each pour, by the pour's GlobalId, in the programme's build order."""

    def __init__(self, activities):
        self.rec = {}
        self._acts = defaultdict(list)
        for a in activities:
            rec = a.get("rec") or {}
            guid = str(getattr(rec.get("element"), "GlobalId", "") or "").strip()
            if guid and a.get("task_id") and not a.get("loe") and not a.get("rule_milestone"):
                self.rec[guid] = rec
                self._acts[guid].append(a)
        self.order = list(self.rec)

    def phases(self, guid):
        return {str(a.get("phase") or "").strip(): a["task_id"] for a in self._acts.get(guid, []) if a.get("phase")}

    def first(self, guid):
        """The pour's first activity (what its predecessors lead into)."""
        acts = self._acts.get(guid)
        return min(acts, key=lambda a: a.get("phase_order", 0))["task_id"] if acts else None

    def last(self, guid):
        """The pour's last activity, curing included."""
        acts = self._acts.get(guid)
        return max(acts, key=lambda a: a.get("phase_order", 0))["task_id"] if acts else None

    def final(self, guid):
        """What the pour's successors wait for: its Concrete (or Curing), as the slab-support links take it."""
        task_map = self.phases(guid)
        return (
            _xml_builder._concrete_done_task(task_map)
            or task_map.get("Rebar, Formwork and Concrete")
            or task_map.get("Stitching")
            or task_map.get("Installation")
            or self.last(guid)
        )

    def end(self, guid, which):
        return {"first": self.first, "start": self.first, "last": self.last, "final": self.final}.get(which, self.final)(guid)


def _value(rec, key):
    if key == "building":
        return str(rec.get("building") or "")
    if key == "level":
        return str(rec.get("level_code") or "")
    if key == "zone":
        return _rules.rec_attr(rec, "zone")[0].upper()
    if key == "stage":
        return str(rec.get("conc_stage") or "").upper()
    return _rules.rec_attr(rec, key)[0] if _rules.rec_attr(rec, key) else ""


def group_instances(rules, tasks, group):
    """(forEach keys, {values: [GlobalIds]}) for a rule group: one instance per combination of its forEach values."""
    keys = [k for k in (group.get("forEach") or []) if k in ("building", "level", "zone", "type", "family", "stage")]
    out = {}
    for guid in tasks.order:
        rec = tasks.rec[guid]
        if group["id"] in rules.group_ids(rec):
            out.setdefault(tuple(_value(rec, k) for k in keys), []).append(guid)
    return keys, out


def _parts(keys, values, tasks, guids):
    parts = dict(zip(keys, values))
    first = tasks.rec[guids[0]]
    parts.setdefault("building", str(first.get("building") or ""))
    return parts, first


def _join(*bits):
    return "-".join(str(b) for b in bits if str(b or "").strip())


def _wbs_oid(wbs_manager, rec, name, level_name=True):
    """A WBS node for rule-made activities under the building's level (or its Construction node)."""
    prefix = str(rec.get("wbs_prefix") or "").strip()
    root = f"{prefix} - Construction"
    parent = root
    if level_name:
        level_label = _xml_builder._xml_level_label(rec)
        candidate = f"{prefix} - {level_label}"
        if wbs_manager.get_id(candidate):
            parent = candidate
    full = f"{parent} - {name}" if parent != root else f"{prefix} - {name}"
    if wbs_manager.get_id(root):
        wbs_manager.register(full, parent)
        return wbs_manager.get_id(full)
    return None


def _rec_lite(rec, level_rec=None):
    src = level_rec or rec
    return {
        "building": rec.get("building"), "unit_building": rec.get("unit_building"), "wbs_prefix": rec.get("wbs_prefix"),
        "level_code": src.get("level_code"), "level_display": src.get("level_display"), "level_int": src.get("level_int"),
    }


# ------------------------------------------------------------------ level tasks

def build_level_tasks(rules, tasks, wbs_manager, taken_ids):
    """The level-of-effort tasks of the rules: (activities, relations, messages). The relations tie each task to its pours
    (SS from each one's first activity, FF from its last), so P6 and the app date it from them. They are not counted as
    successors, so the open-end sequencing of the pours is not changed by them."""
    acts, relations, messages = [], [], []
    taken = {str(t).upper() for t in taken_ids}
    for lt in rules.level_tasks:
        if not _on(lt) or not str(lt.get("id", "")).strip():
            continue
        group = rules.group(str(lt.get("group", "")).strip())
        if group is None:
            messages.append(f"Level task {lt['id']}: rule group '{lt.get('group', '')}' does not exist")
            continue
        keys, instances = group_instances(rules, tasks, group)
        if not instances:
            messages.append(f"Level task {lt['id']}: rule group '{group['id']}' has no pours in this model")
            continue
        for values, guids in sorted(instances.items(), key=lambda kv: (kv[0], )):
            parts, rec = _parts(keys, values, tasks, guids)
            building, level = parts.get("building", ""), parts.get("level", "")
            task_id = _join(PROJECT_SHORT, building, level, lt["id"])
            if task_id.upper() in taken:
                messages.append(f"Level task {task_id} skipped: that Task ID is already in the programme")
                continue
            taken.add(task_id.upper())
            level_rec = rec if "level" in keys else {}
            name_bits = [b for b in (building, level, str(lt.get("name") or lt["id"])) if b]
            act = {
                "rec": _rec_lite(rec, level_rec or None),
                "phase": "Level task",
                "task_id": task_id,
                "task_name": " - ".join(name_bits),
                "duration_days": 0,
                "resource": None,
                "wbs_oid": _wbs_oid(wbs_manager, rec, LEVEL_TASKS_WBS, level_name=bool(level)) or 1,
                "loe": True,
                "level_task": lt["id"],
                "level_key": (building.upper(), level.upper()),
                "members": list(guids),
            }
            acts.append(act)
            for guid in guids:
                first, last = tasks.first(guid), tasks.last(guid)
                if first:
                    relations.append(_relation(first, task_id, "SS", 0.0, f"level-task:{lt['id']}", track=False))
                if last:
                    relations.append(_relation(last, task_id, "FF", 0.0, f"level-task:{lt['id']}", track=False))
    return acts, relations, messages


# ------------------------------------------------------------------ sequences

def _ordered_levels(tasks, guids_by_step):
    levels = {}
    for guids in guids_by_step:
        for g in guids:
            rec = tasks.rec[g]
            levels[str(rec.get("level_code") or "")] = rec.get("level_int") or 0
    return [lv for lv, _n in sorted(levels.items(), key=lambda kv: (kv[1], kv[0]))]


def build_sequences(rules, tasks, wbs_manager, taken_ids):
    """Rule groups put in order. Between two steps goes one finish milestone: every pour of the first step feeds it and it
    feeds every pour of the next, so the next step starts when the whole previous one is done. (activities, relations, messages)"""
    acts, relations, messages = [], [], []
    taken = {str(t).upper() for t in taken_ids}
    for seq in rules.sequences:
        if not _on(seq) or not str(seq.get("id", "")).strip():
            continue
        steps = [s for s in seq.get("steps") or [] if isinstance(s, dict) and str(s.get("group", "")).strip()]
        if len(steps) < 2:
            continue
        infos = {}
        for s in steps:
            g = rules.group(str(s["group"]).strip())
            if g is None:
                messages.append(f"Sequence {seq['id']}: rule group '{s['group']}' does not exist")
                infos = None
                break
            infos[s["group"]] = (g, *group_instances(rules, tasks, g)[::-1])  # (group, instances, keys)
        if infos is None:
            continue
        found = set()
        for s_ in steps:
            _group, instances, keys = infos[s_["group"]]
            for values, guids in instances.items():
                found.add(dict(zip(keys, values)).get("building") or str(tasks.rec[guids[0]].get("building") or ""))
        buildings = sorted(b for b in found if b)

        def members(step, building, level):
            group, instances, keys = infos[step["group"]]
            out = []
            for values, guids in instances.items():
                parts = dict(zip(keys, values))
                b = parts.get("building") or str(tasks.rec[guids[0]].get("building") or "")
                if b != building:
                    continue
                if level is not None and "level" in keys and parts.get("level") != level:
                    continue
                out.extend(guids)
            return out

        for building in buildings:
            items = []  # (label, [guids], the step) in order
            i = 0
            while i < len(steps):
                if not steps[i].get("perLevel"):
                    items.append((steps[i]["group"], members(steps[i], building, None), steps[i]))
                    i += 1
                    continue
                j = i
                while j < len(steps) and steps[j].get("perLevel"):
                    j += 1
                block = steps[i:j]
                levels = _ordered_levels(tasks, [members(s, building, None) for s in block])
                for level in levels:
                    for s in block:
                        items.append((f"{s['group']} {level}", members(s, building, level), s))
                i = j
            items = [item for item in items if item[1]]
            wbs = None
            for n, ((label_a, a, _step_a), (label_b, b, step_b)) in enumerate(zip(items, items[1:]), start=1):
                rec = tasks.rec[a[0]]
                milestone = _join(PROJECT_SHORT, building, "SEQ", seq["id"], f"{n:03d}")
                if milestone.upper() in taken:
                    continue
                taken.add(milestone.upper())
                if wbs is None:
                    wbs = _wbs_oid(wbs_manager, rec, RULE_LINKS_WBS, level_name=False) or 1
                acts.append({
                    "rec": _rec_lite(rec), "phase": "Sequence", "task_id": milestone,
                    "task_name": f"{building} - {seq.get('name') or seq['id']}: {label_a} done",
                    "duration_days": 0, "resource": None, "wbs_oid": wbs,
                    "milestone": True, "milestone_type": "Finish", "rule_milestone": True,
                })
                source = f"sequence:{seq['id']}"
                for g in a:
                    final = tasks.final(g)
                    if final:
                        relations.append(_relation(final, milestone, "FS", 0.0, source))
                # A step may set its own link into it (its type and lag in hours); otherwise the sequence's.
                kind, lag = (_type(step_b, _type(seq)), _lag(step_b)) if (step_b.get("type") or step_b.get("lagHours")) else (_type(seq), _lag(seq))
                for g in b:
                    first = tasks.first(g)
                    if first:
                        relations.append(_relation(milestone, first, kind, lag, source))
    return acts, relations, messages


# ------------------------------------------------------------------ contacts (clash detection results)

def _contacts(tasks, clashes):
    """{GlobalId: [(other GlobalId, where the other sits relative to it)]} from the clash detection results."""
    found = defaultdict(list)
    for c in clashes or []:
        a = str(c.get("Pour A GUID") or c.get("a_global_id", "") or "").strip()
        b = str(c.get("Pour B GUID") or c.get("b_global_id", "") or "").strip()
        if not a or not b or a == b or a not in tasks.rec or b not in tasks.rec:
            continue
        position = classify_vertical_position(tasks.rec[a], tasks.rec[b])  # b relative to a
        found[a].append((b, position))
        found[b].append((a, invert_position(position)))
    return found


def build_contact_relations(rules, tasks, clashes):
    """Links from the pours the clash detection found in contact with each subject pour (a slab, say): every object in
    contact below it (or above, beside, any) precedes it. Returns (relations, builtin, messages); `builtin` is
    {"slab_support" / "level_gate": {Task IDs}} the rule takes over from the engine's own links (replaceBuiltIn)."""
    relations, messages = [], []
    builtin = defaultdict(set)
    rows = [r for r in rules.contacts if _on(r)]
    if not rows:
        return relations, {}, messages
    if not clashes:
        messages.append("Contact rules: there are no clash detection results (clash detection was skipped), so they add no links")
        return relations, {}, messages
    contacts = _contacts(tasks, clashes)
    for rule in rows:
        label = str(rule.get("id") or rule.get("name") or "contact")
        kind = str(rule.get("contact") or "below").lower()
        accepted = _POSITIONS.get(kind, _POSITIONS["below"])
        if str(rule.get("position") or "any").lower() == "definite" and kind in _STRICT:
            accepted = _STRICT[kind]
        pred_end, succ_end = str(rule.get("predEnd") or "final"), str(rule.get("succEnd") or "start")
        subject_is_succ = str(rule.get("direction") or "subjectIsSuccessor") != "subjectIsPredecessor"
        rel_type, lag = _type(rule), _lag(rule)
        try:
            max_gap = int(rule.get("maxLevelGap")) if str(rule.get("maxLevelGap", "")).strip() != "" else None
        except (TypeError, ValueError):
            max_gap = None
        ignore_stage2 = bool(rule.get("ignoreStage2"))
        source = f"contact:{label}"
        added, subjects = 0, 0
        for s in tasks.order:
            s_rec = tasks.rec[s]
            if not rules.matches(rule.get("subject"), s_rec):
                continue
            subjects += 1
            s_building = str(s_rec.get("building") or "").strip().upper()
            seen = set()
            for o, position in contacts.get(s, []):
                o_rec = tasks.rec[o]
                if position not in accepted or o in seen or str(o_rec.get("building") or "").strip().upper() != s_building:
                    continue
                if not rules.matches(rule.get("with"), o_rec):
                    continue
                if ignore_stage2 and _xml_builder._is_stage2(o_rec):
                    continue
                if max_gap is not None:
                    try:
                        if abs(int(o_rec.get("level_int") or 0) - int(s_rec.get("level_int") or 0)) > max_gap:
                            continue
                    except (TypeError, ValueError):
                        pass
                seen.add(o)
                pred_guid, succ_guid = (o, s) if subject_is_succ else (s, o)
                pred = tasks.end(pred_guid, pred_end)
                succ = tasks.end(succ_guid, succ_end)
                if pred and succ and pred != succ:
                    relations.append(_relation(pred, succ, rel_type, lag, source))
                    added += 1
            if rule.get("replaceBuiltIn"):
                start = tasks.first(s)
                if start:
                    for which in rule.get("replaceBuiltIn") if isinstance(rule.get("replaceBuiltIn"), list) else ["slabSupport"]:
                        builtin["slab_support" if which == "slabSupport" else "level_gate"].add(start)
        messages.append(f"Contact rule {label}: {subjects} pour(s) matched, {added} link(s) from the clash results")
    return relations, {k: v for k, v in builtin.items()}, messages


_MAX_RECIPE_LINKS = 50000


def _task_in(tasks, guid, phase):
    """The Task ID of a pour's activity of this phase (names compared without case), or None."""
    want = str(phase or "").strip().upper()
    return next((tid for name, tid in tasks.phases(guid).items() if name.strip().upper() == want), None)


def _scope_key(rec, scope):
    building = str(rec.get("building") or "").strip().upper()
    if scope == "all":
        return ""
    if scope == "building":
        return building
    return f"{building}|{str(rec.get('level_code') or '').strip().upper()}"


def build_recipe_links(rules, tasks):
    """Links between the pours of two recipes (a recipe task that calls a task of another recipe): the task of the objects of this recipe's group
    and the target task of the objects of the target recipe's group, for the pairs in the same level (or building, or anywhere). 'after': the target
    task follows this one; 'before': it precedes it. Returns (relations, messages)."""
    relations, messages = [], []
    for link in getattr(rules, "recipe_links", []):
        subject_when = {"group": link["group"]} if link["group"] else {}
        target_when = {"group": link["targetGroup"]} if link["targetGroup"] else {}
        scope = link["scope"]
        subjects = [g for g in tasks.order if rules.matches(subject_when, tasks.rec[g])]
        by_scope = defaultdict(list)
        for g in tasks.order:
            if rules.matches(target_when, tasks.rec[g]):
                by_scope[_scope_key(tasks.rec[g], scope)].append(g)
        added = 0
        for s in subjects:
            mine = _task_in(tasks, s, link["phase"])
            if not mine:
                continue
            for o in by_scope.get(_scope_key(tasks.rec[s], scope), []):
                other = _task_in(tasks, o, link["targetPhase"]) if o != s else None
                if not other or other == mine:
                    continue
                pred, succ = (mine, other) if link["direction"] == "after" else (other, mine)
                relations.append(_relation(pred, succ, link["type"] if link["type"] in _TYPES else "FS", link["lagHours"], f"recipe:{link['id']}"))
                added += 1
                if added >= _MAX_RECIPE_LINKS:
                    break
            if added >= _MAX_RECIPE_LINKS:
                messages.append(f"Recipe link {link['id']}: stopped at {_MAX_RECIPE_LINKS} links (use a narrower scope)")
                break
        messages.append(f"Recipe link {link['id']}: {len(subjects)} pour(s), {added} link(s)")
    return relations, messages


def _build_order(rules, tasks):
    """The pours in the order the scenario builds them: the steps of the first sequence that has some (each step's pours, in the programme's order),
    then every pour the steps do not name; with no steps, the programme's own order."""
    order, seen = [], set()
    for seq in rules.sequences:
        if not _on(seq):
            continue
        steps = [s for s in seq.get("steps") or [] if isinstance(s, dict) and str(s.get("group", "")).strip()]
        if not steps:
            continue
        for step in steps:
            when = {"group": str(step["group"]).strip()}
            for g in tasks.order:
                if g not in seen and rules.matches(when, tasks.rec[g]):
                    seen.add(g)
                    order.append(g)
        break
    return order + [g for g in tasks.order if g not in seen]


def build_limit_links(rules, tasks):
    """Limits on how many activities of one kind run at once (Formwork_Sets_Available = 4: no more than 4 formwork activities at the same time).
    The activities of that phase (of the pours of the limit's group, if it names one), taken in the order the scenario builds them, go to N lanes in
    turn; each waits for the one before it in its lane (finish to start), so never more than N run together. Returns (relations, messages)."""
    relations, messages = [], []
    order = None
    for limit in getattr(rules, "limits", []):
        size = rules.limit_size(limit)
        phase = str(limit.get("phase") or "").strip()
        if size < 1:
            continue
        if order is None:
            order = _build_order(rules, tasks)
        when = {"group": str(limit.get("group") or "").strip()} if str(limit.get("group") or "").strip() else {}
        queue, seen = [], set()
        for g in order:
            if not rules.matches(when, tasks.rec[g]):
                continue
            tid = _task_in(tasks, g, phase)
            if tid and tid not in seen:
                seen.add(tid)
                queue.append(tid)
        added = 0
        for i in range(size, len(queue)):
            relations.append(_relation(queue[i - size], queue[i], "FS", 0.0, f"limit:{limit.get('id') or phase}"))
            added += 1
        messages.append(f"Limit {limit.get('id') or phase}: {len(queue)} {phase} activit{'y' if len(queue) == 1 else 'ies'}, at most {size} at once, {added} link(s)")
    return relations, messages


def drop_builtin(predecessors, task_ids):
    """The engine's own predecessor dict without the links into these tasks (taken over by a contact rule)."""
    if not task_ids:
        return predecessors
    return {succ: preds for succ, preds in predecessors.items() if succ not in task_ids}


# ------------------------------------------------------------------ level links

def _level_task_index(level_task_acts):
    index = {}
    for a in level_task_acts:
        index[(a["level_task"].upper(), *a["level_key"])] = a["task_id"]
    return index


def _full_tag(extra_id, rules):
    return rules.extra_tags.get(extra_id) or rules.extra_tags.get(str(extra_id).upper()) or {}


def _tag(extra_id, rules):
    tag = _full_tag(extra_id, rules)
    return str(tag.get("building") or "").strip().upper(), str(tag.get("level") or "").strip().upper()


# What an extra activity is, from its tag: a task, a start or finish milestone, a WBS summary (dated from what is under its WBS node), or a
# level of effort (dated from the activities it is linked to). Without a kind a 0-day extra is a finish milestone, as it always was.
_KINDS = ("task", "start", "finish", "summary", "loe")


def _set_extra_kind(act, kind):
    kind = kind.strip().lower()
    if kind not in _KINDS:
        return
    for key in ("milestone", "milestone_type", "summary", "loe"):
        act.pop(key, None)
    if kind in ("start", "finish"):
        act.update({"milestone": True, "milestone_type": kind.capitalize(), "duration_days": 0})
    elif kind == "summary":
        act["summary"] = True
    elif kind == "loe":
        act["loe"] = True


def place_extras(rules, extras_acts, wbs_manager, programme_acts, first_building=""):
    """Puts each extra activity where its tag says in the WBS (the default is the "Extra activities" folder):
      wbs "level"   - on the building's level (right under it, beside the External / Internal Walls and Slabs groups)
      wbs "slabs"   - in the level's Slabs group
      wbs "path:A / B" - a folder of its own under the building's Construction node
    The level is the tag's building and level. Returns messages."""
    messages = []
    recs = {}
    for a in programme_acts:
        r = a.get("rec") or {}
        if r and not a.get("extra") and not a.get("loe"):
            recs.setdefault((str(r.get("building") or "").upper(), str(r.get("level_code") or "").upper()), r)
    first = (first_building or "").upper()
    for act in extras_acts:
        tag = _full_tag(act["task_id"], rules)
        _set_extra_kind(act, str(tag.get("kind") or ""))
        where = str(tag.get("wbs") or "").strip()
        if not where:
            continue
        building, level = _tag(act["task_id"], rules)
        rec = recs.get((building or first, level))
        if where.lower().startswith("path:"):
            path = [seg.strip() for seg in where[5:].split("/") if seg.strip()]
            anchor = rec or next((r for (b, _l), r in recs.items() if b == first), None) or next(iter(recs.values()), None)
            if not path or anchor is None:
                continue
            parent = f"{str(anchor.get('wbs_prefix') or '').strip()} - Construction"
            for seg in path:
                wbs_manager.register(seg, parent)
                parent = seg
            act["wbs_oid"] = wbs_manager.get_id(parent)
            continue
        if rec is None:
            messages.append(f"Extra activity {act['task_id']}: no pours on {building or first} {level}, so it stays in the Extra activities folder")
            continue
        prefix = str(rec.get("wbs_prefix") or "").strip()
        label = _xml_builder._xml_level_label(rec)
        level_name = f"{prefix} - {label}"
        if not wbs_manager.get_id(level_name):  # a building with two zones has its levels under the zones
            level_name = next((n for n in wbs_manager.order if n.startswith(f"{prefix} - ") and n.endswith(f" - {label}")), level_name)
        if not wbs_manager.get_id(level_name):
            messages.append(f"Extra activity {act['task_id']}: the WBS has no {label} for {prefix}, so it stays in the Extra activities folder")
            continue
        if where.lower() == "slabs":
            slabs = f"{level_name} - Slabs"
            wbs_manager.register(slabs, level_name)
            act["wbs_oid"] = wbs_manager.get_id(slabs)
        else:
            act["wbs_oid"] = wbs_manager.get_id(level_name)
    return messages


def build_level_links(rules, tasks, extras_acts, level_task_acts, programme_acts, first_building):
    """Links between activities and the level tasks of their own level. Returns (early relations, late rules, messages): the
    late ones are for the open-ended activities, known only once the other links are written (see late_level_relations)."""
    index = _level_task_index(level_task_acts)
    early, late, messages = [], [], []
    for rule in rules.level_links:
        if not _on(rule):
            continue
        kinds = rule.get("tasks") if isinstance(rule.get("tasks"), list) else [rule.get("tasks")]
        kinds = [str(k).strip().upper() for k in kinds if str(k or "").strip()]
        which = str(rule.get("activities") or "extras").lower()
        if which == "open":
            late.append(rule)
            continue
        if which == "select":
            selector = str(rule.get("select") or "").strip()
            if not is_selector(selector):
                messages.append(f"Level link {rule.get('id', '')}: the selection is not a select:{{...}}")
                continue
            try:
                ids = select_ids(selector, programme_acts)
            except ValueError as e:
                messages.append(f"Level link {rule.get('id', '')}: {e}")
                continue
            by_id = {a["task_id"]: a for a in programme_acts if a.get("task_id")}
            ends = [(i, (str((by_id[i].get("rec") or {}).get("building") or "").upper(), str((by_id[i].get("rec") or {}).get("level_code") or "").upper())) for i in ids]
        else:
            ends = [(a["task_id"], _tag(a["task_id"], rules)) for a in extras_acts]
            ends = [(i, (b or first_building, lv)) for i, (b, lv) in ends if lv]
        made = 0
        pours = str(rule.get("pours") or "").strip() if which == "extras" else ""
        if pours:
            # the extras' own building and level: each is tied to the pours the selection picks there (Concrete of the slabs, of the walls ...)
            try:
                terms, _mode = parse_selector(pours)
            except ValueError as e:
                messages.append(f"Level link {rule.get('id', '')}: {e}")
                continue
            by_place = {}
            for a in programme_acts:
                r = a.get("rec") or {}
                if a.get("task_id") and r and not a.get("extra") and not a.get("loe") and not a.get("rule_milestone") and _matches(a, terms):
                    by_place.setdefault((str(r.get("building") or "").upper(), str(r.get("level_code") or "").upper()), []).append(a["task_id"])
            for task_id, (building, level) in ends:
                only_task = str(_full_tag(task_id, rules).get("task") or "").strip().upper()
                if only_task and kinds and only_task not in kinds:
                    continue
                for target in by_place.get((building, level), []):
                    if target != task_id:
                        early.append(_level_relation(rule, task_id, target))
                        made += 1
            messages.append(f"Level link {rule.get('id', '')}: {made} link(s) to pours")
            continue
        for task_id, (building, level) in ends:
            # an extra tagged with one level task (Walls, Slabs ...) is tied to that one only
            only_task = str(_full_tag(task_id, rules).get("task") or "").strip().upper() if which == "extras" else ""
            for kind in ([only_task] if only_task in kinds else kinds):
                target = index.get((kind, building, level))
                if target and target != task_id:
                    early.append(_level_relation(rule, task_id, target))
                    made += 1
        messages.append(f"Level link {rule.get('id', '')}: {made} link(s)")
    return early, late, messages


def _level_relation(rule, task_id, level_task, replaces=False):
    to_task = str(rule.get("direction") or "toTask") != "fromTask"
    pred, succ = (task_id, level_task) if to_task else (level_task, task_id)
    return _relation(pred, succ, _type(rule, "FF"), _lag(rule), f"level-link:{rule.get('id', '')}", replaces)


def late_level_relations(late_rules, open_task_ids, level_task_acts, programme_acts, tasks, taken_ids=()):
    """The level links of open-ended activities (no successor once every other link is written): each one to the level task of
    its own building and level."""
    out = []
    if not late_rules or not open_task_ids:
        return out
    index = _level_task_index(level_task_acts)
    by_id = {a["task_id"]: a for a in programme_acts if a.get("task_id")}
    for rule in late_rules:
        kinds = rule.get("tasks") if isinstance(rule.get("tasks"), list) else [rule.get("tasks")]
        kinds = [str(k).strip().upper() for k in kinds if str(k or "").strip()]
        selector = str(rule.get("select") or "").strip()
        only = None
        if is_selector(selector):
            try:
                only = set(select_ids(selector, programme_acts))
            except ValueError:
                only = None
        for task_id in sorted(open_task_ids):
            act = by_id.get(task_id)
            if act is None or act.get("loe") or act.get("rule_milestone") or act.get("extra"):
                continue
            if only is not None and task_id not in only:
                continue
            rec = act.get("rec") or {}
            building, level = str(rec.get("building") or "").upper(), str(rec.get("level_code") or "").upper()
            for kind in kinds:
                target = index.get((kind, building, level))
                if target and target != task_id:
                    out.append(_level_relation(rule, task_id, target))
    return out
