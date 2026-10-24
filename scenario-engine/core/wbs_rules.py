# core/wbs_rules.py
"""WBS rules: where each activity goes in the programme's WBS, from rules the user sets (Generate > WBS) instead of code.

A rule set is {"rules": [rule, ...]}. The rules are tried in order for each activity and the first whose conditions all hold places it; a rule with no
conditions always holds (put it last, as the fallback). A rule is

  {"id", "name"?, "enabled"?: bool, "when": [{"field", "op", "value"}], "under"?: "level" | "root", "path": [level, ...]}

and each level of its path is {"name": template, "phases"?: [phase, ...], "always"?: bool, "kind"?: "phases" | "each"}:

  name      the WBS node's name, a template: {field} is the activity's value of that field, {field:title} / {field:upper} / {field:lower} formats
            it, {field|yes text|no text} picks a text by whether the value is set (true, a number other than 0, a word other than no / false).
            A level whose template reads an empty field is left out (the activity stays at the level above), unless the field is marked with ?
            ({field?}), which may be empty. {parent} is the name of the node above, {level_node} the name of the node the path starts under.
  phases    the level is only for the activities of these phases (others stay at the level above)
  always    with phases: a node for each of them is made with the level above, used or not
  kind      "phases": a node for each phase the item's own activities have (what its recipe made, in the recipe's order), each activity in its
            phase's node; the name defaults to {phase}. "each": a node per item, named by default by its ID ({item_id}, the ID in its activity IDs).

`under` says where the path starts: under the building's level node (the default; the level node is "<prefix> - <level>", with the building's
Construction node above it) or under the Construction node itself.

The fields are the activity's record (its properties as read: every property of the pour property set or work item, and the generator's own
values) and a few made here: prefix, level, zone, zone_segment, phase, pid (= item_id), pour_type_norm, general_pour_type_norm, insitu_stair, stair_label.
Field names match whatever their case, spaces or underscores ("Pour Type" = pour_type = POURTYPE).

Nothing here knows any kind of object, phase or project: the generator's own WBS for pour models is the rule set in wbs_default_rules.json.
"""
import json
import re
from pathlib import Path

DEFAULT_RULES_FILE = Path(__file__).resolve().parents[1] / "wbs_default_rules.json"
_default_cache = None

PLACEHOLDER = re.compile(r"\{([^{}]+)\}")


def default_rules():
    """The generator's own rule set (the WBS it made before rules existed)."""
    global _default_cache
    if _default_cache is None:
        _default_cache = json.loads(DEFAULT_RULES_FILE.read_text(encoding="utf-8"))
    return _default_cache


def key(name):
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def context(*sources):
    """The fields an activity's rules read, by key(): later sources win over earlier ones."""
    out = {}
    for src in sources:
        for k, v in (src or {}).items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                out[key(k)] = v
    return out


def _text(v):
    if v is None or isinstance(v, bool):
        return "" if v is None else ("true" if v else "")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def truthy(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    t = _text(v).lower()
    return t not in ("", "0", "no", "false", "n", "none")


def _title(text):
    from core.helpers import title_case
    return title_case(text.replace("_", " "))


def fill(template, ctx):
    """The template with the context's values in, or None when it reads a field that is empty (and not marked ?)."""
    empty = False

    def sub(m):
        nonlocal empty
        inner = m.group(1)
        if "|" in inner:
            name, *texts = inner.split("|")
            texts += ["", ""]
            return texts[0] if truthy(ctx.get(key(name.rstrip("?")))) else texts[1]
        name, _, fmt = inner.partition(":")
        optional = name.endswith("?")
        text = _text(ctx.get(key(name.rstrip("?"))))
        if not text:
            if not optional:
                empty = True
            return ""
        fmt = fmt.strip().lower()
        if fmt == "title":
            return _title(text)
        if fmt == "upper":
            return text.upper()
        if fmt == "lower":
            return text.lower()
        return text

    out = PLACEHOLDER.sub(sub, str(template or ""))
    return None if empty or not out.strip() else out


OPS = ("equals", "not equals", "contains", "not contains", "starts with", "in", "not in", "is empty", "is not empty", "is true", "is false")


def holds(cond, ctx):
    """Whether one condition holds for the context (text compared whatever its case)."""
    op = str(cond.get("op") or "equals").strip().lower()
    v = ctx.get(key(cond.get("field")))
    text = _text(v).lower()
    want = _text(cond.get("value")).lower()
    options = [w.strip() for w in want.split(",") if w.strip()]
    if op == "equals":
        return text == want
    if op == "not equals":
        return text != want
    if op == "contains":
        return want in text
    if op == "not contains":
        return want not in text
    if op == "starts with":
        return text.startswith(want)
    if op == "in":
        return text in options
    if op == "not in":
        return text not in options
    if op == "is empty":
        return not text
    if op == "is not empty":
        return bool(text)
    if op == "is true":
        return truthy(v)
    if op == "is false":
        return not truthy(v)
    return False


def usable(rule_set):
    """The enabled rules of a rule set, or None when it has none (then the default applies)."""
    rules = [r for r in (rule_set or {}).get("rules") or [] if isinstance(r, dict) and r.get("enabled") is not False and r.get("path")]
    return rules or None


def first_match(rules, ctx):
    for r in rules:
        if all(holds(c, ctx) for c in r.get("when") or [] if isinstance(c, dict) and str(c.get("field") or "").strip()):
            return r
    return None


class Registry:
    """Registers WBS nodes by their place: a node is its name under its parent, so two packages of the same name under different parents are two
    nodes. A node's key in the WBS manager is its name while the name is free (so the names other code looks up keep working), else the name made
    unique by its parent's key; the manager keeps the name as the node's label."""

    def __init__(self, manager):
        self.m = manager
        self.keys = {}  # (parent key, name) -> key

    def node(self, name, parent):
        at = (parent, name)
        if at in self.keys:
            return self.keys[at]
        taken = name in self.m.map and self.m.parent_map.get(name) != parent
        k = f"{name}␟{parent}" if taken else name
        self.m.register(k, parent)
        if k != name:
            self.m.labels[k] = name
        self.keys[at] = k
        return k


# A step's name when it has none of its own.
DEFAULT_NAMES = {"phases": "{phase}", "each": "{item_id}"}


def place(registry, rule, ctx, start, phase, phases_of=None):
    """Registers the rule's path for one activity under `start` (a node key) and returns the key of the node the activity goes in. `phases_of` is
    the phases of the item's activities in their order (for a "phases" step; the activity's own phase when not given)."""
    parent = start
    label = {start: registry.m.labels.get(start, start)}
    ctx = dict(ctx)
    ctx[key("level_node")] = label[start]
    for level in rule.get("path") or []:
        if not isinstance(level, dict):
            level = {"name": str(level)}
        ctx[key("parent")] = label.get(parent, registry.m.labels.get(parent, parent))
        kind = str(level.get("kind") or "").strip().lower()
        template = level.get("name") or DEFAULT_NAMES.get(kind, "")
        if kind == "phases":
            # A node for each of the item's phases, in its activities' order; the activity goes in its own.
            at = None
            for ph in dict.fromkeys(str(p).strip() for p in (phases_of or [phase]) if str(p).strip()):
                n = fill(template, {**ctx, key("phase"): ph})
                if n:
                    k = registry.node(n, parent)
                    label[k] = n
                    if ph.lower() == str(phase or "").strip().lower():
                        at = k
            if at is None:
                break
            parent = at
            continue
        phases = [str(p).strip() for p in level.get("phases") or [] if str(p).strip()]
        if phases and level.get("always"):
            for ph in phases:
                n = fill(level.get("name"), {**ctx, key("phase"): ph})
                if n:
                    label[registry.node(n, parent)] = n
        if phases and str(phase or "").strip().lower() not in {p.lower() for p in phases}:
            break
        name = fill(template, ctx)
        if name is None:
            if phases:
                break
            continue
        k = registry.node(name, parent)
        label[k] = name
        parent = k
    return parent
