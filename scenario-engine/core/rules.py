# core/rules.py
"""Programme rules from the app's Rules panel (docs/programme-rules), applied to the generator.

A scenario carries a `rules` object (JSON; see src/prs/rules.ts for its shape). Empty rules change nothing: every
lookup here falls back to today's constants in config.py, so a run without rules is the same run as before.

  settings      switches and distances of the engine (config.py constants), restored after every run
  durations     days per phase, by a `when` condition (building, level range, type, family, rule group ...)
  productivity  a duration worked out from a quantity: quantity x man-hours per unit / (crew x shifts x hours)
  rebar         tonnes of rebar per m3 of concrete
  crews         the crew of a phase, by a `when` condition
  trades        the labour trades (code, name, site capacity) the crews are made of (none: no labour resources)
  calendars     working calendars, and calendarRules which activities run on which (core/calendars.py)
  chains        the phases of a pour, in order: rows of group, order, phase, suffix and label (the activity chain of a group)
  rates / crewTemplates / assignments
                the relational form: a named Rate (fixed days, productivity, or a rebar density), a named Crew (trades and sizes), and
                Assignments that link a Group x Phase to a rate, a crew and a calendar, with a priority. They are turned into the
                rows above (with `when: {group}`) when the rules load; a higher priority beats a lower one, then the earlier row.
  groups        named selections of pours (rule groups: not the 4D Link Groups), used by name in every `when`

A `when` is a dict of optional terms, all of which must hold (the more terms, the more specific the row): building,
level, levelFrom, levelTo, type, general, stage, zone, external, doubleHeight, family, group. A value may list alternatives with "|".
For one pour the matching row with the highest `priority` wins (default 0), then the most terms; a tie goes to the first in the list.

Links, level tasks and sequences built from the rules are in core/rule_logic.py.
"""
import math
import sys

from core import quantities
from core.recipes import compile_recipes
from core import formula as _formula

# Tonnes of rebar per m3 of concrete when no Rebar rate rule and no Rebar_kg_per_m3_* parameter says otherwise.
DEFAULT_REBAR_T_PER_M3 = 0.25

# JSON setting -> (module global it replaces, how the value is read)
_BOOL, _NUM, _NUM_OR_NONE, _LIST = "bool", "num", "num_or_none", "list"
SETTINGS = {
    "levelGate": ("ENABLE_LEVEL_GATE", _BOOL),
    "levelGateSlabsOnly": ("LEVEL_GATE_SLABS_ONLY", _BOOL),
    "levelGateDeckingConcreteOnly": ("LEVEL_GATE_DECKING_CONCRETE_ONLY", _BOOL),
    "levelGateMaxDistanceM": ("LEVEL_GATE_MAX_DISTANCE_M", _NUM_OR_NONE),
    "supportLinkFinishToFinish": ("SUPPORT_LINK_FF", _BOOL),
    "supportLagPct": ("SUPPORT_LAG_PCT", _NUM),
    "completionCloseout": ("ENABLE_COMPLETION_CLOSEOUT", _BOOL),
    "openEndSequencing": ("ENABLE_OPEN_END_SEQUENCING", _BOOL),
    "openEndMaxDistanceM": ("OPEN_END_MAX_DISTANCE_M", _NUM),
    "openEndNearestSlabFallback": ("OPEN_END_NEAREST_SLAB_FALLBACK", _BOOL),
    "slabCuringGatesSuccessors": ("SLAB_CURING_GATES_SUCCESSORS", _BOOL),
    "maximizeResources": ("MAXIMIZE_RESOURCES", _BOOL),
    "stairStepMaxVolumeM3": ("STAIR_STEP_MAX_VOLUME_M3", _NUM),
    "sideOverlapThreshold": ("CLASH_POSITION_SIDE_OVERLAP_THRESHOLD", _NUM),
    "groupMilestones": ("ENABLE_GROUP_MILESTONES", _BOOL),
    "buildingCompletion": ("ENABLE_BUILDING_COMPLETION", _BOOL),
    "excludedPourTypes": ("EXCLUDED_POUR_TYPES", _LIST),
    "sequenceFlow": ("SEQUENCE_FLOW", _BOOL),
    "sequenceLeadDays": ("SEQUENCE_LEAD_DAYS", _NUM),
    "sequenceConcreteFollows": ("SEQUENCE_CONCRETE_FOLLOWS", _BOOL),
}
DEFAULT_MIN_POUR_VOLUME_M3 = 0.25

_ORIGINALS = {}  # (module name, global) -> the value it had before any rules were applied


def norm(value):
    """A comparison form: lower case, spaces as underscores."""
    return str(value if value is not None else "").strip().replace(" ", "_").lower()


def _number(value, default=None):
    try:
        if value is None or str(value).strip() == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _engine_modules():
    for name, module in list(sys.modules.items()):
        if module is not None and (name in ("config", "main", "__main__") or name.startswith("core.")):
            yield name, module


def _restore_settings():
    for (name, attr), value in _ORIGINALS.items():
        module = sys.modules.get(name)
        if module is not None:
            setattr(module, attr, value)


def _coerce(kind, value):
    if kind == _BOOL:
        return value if isinstance(value, bool) else str(value).strip().lower() in ("1", "true", "yes", "on")
    if kind == _NUM:
        return _number(value)
    if kind == _NUM_OR_NONE:
        n = _number(value)
        return n if n and n > 0 else None
    if kind == _LIST:
        items = value if isinstance(value, (list, tuple, set)) else str(value).replace(";", ",").split(",")
        return {str(i).strip() for i in items if str(i).strip()}
    return value


def apply_settings(settings):
    """Puts the rules' engine settings in place of the config constants (every engine module that holds one by name),
    after putting back what an earlier run changed. Returns the names changed."""
    for name, module in _engine_modules():  # remember the defaults the first time a name is seen
        for key, (attr, _kind) in SETTINGS.items():
            if hasattr(module, attr) and (name, attr) not in _ORIGINALS:
                _ORIGINALS[(name, attr)] = getattr(module, attr)
    _restore_settings()
    changed = []
    for key, value in (settings or {}).items():
        if key not in SETTINGS or value is None or value == "":
            continue
        attr, kind = SETTINGS[key]
        coerced = _coerce(kind, value)
        if coerced is None and kind != _NUM_OR_NONE:
            continue
        for name, module in _engine_modules():
            if hasattr(module, attr):
                setattr(module, attr, coerced)
        changed.append(key)
    return changed


# ---------------------------------------------------------------- what a pour is

_SLAB_WORDS = ("SLAB", "PIT", "FLOOR")


def family_of(rec):
    """The family the rules talk about: wall, slab, raft, heavyPrecast, precast, pedestal, landing, stair, column,
    beam, insitu (anything else cast in place)."""
    ptype = str(rec.get("pour_type", "") or "").replace(" ", "_").upper()
    gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
    if ptype == "HEAVY_PRECAST" or gtype == "HEAVY_PRECAST":
        return "heavyPrecast"
    if str(rec.get("conc_stage", "") or "").strip().upper() == "PRECAST":
        return "precast"
    if "WALL" in ptype:
        return "wall"
    if ptype == "RAFT":
        return "raft"
    if "LANDING" in ptype:
        return "landing"
    if "STAIR" in ptype:
        return "stair"
    if any(w in ptype for w in _SLAB_WORDS):
        return "slab"
    for word, family in (("PEDESTAL", "pedestal"), ("COLUMN", "column"), ("BEAM", "beam")):
        if word in ptype:
            return family
    return "insitu"


def _zone(rec):
    if rec.get("is_disconnected"):
        return "disconnected"
    if rec.get("is_connected"):
        return "connected"
    return ""


def rec_attr(rec, key):
    """What a pour record is for one rule term: a list of normalised strings, any of which may match."""
    if key == "building":
        return [norm(rec.get("building")), norm(rec.get("unit_building"))]
    if key == "level":
        return [norm(rec.get("level_code")), norm(rec.get("level_display"))]
    if key == "type":
        return [norm(rec.get("pour_type"))]
    if key == "general":
        return [norm(rec.get("general_pour_type"))]
    if key == "stage":
        return [norm(rec.get("conc_stage"))]
    if key == "zone":
        return [_zone(rec)]
    if key == "external":
        return ["true" if rec.get("is_external") else "false"]
    if key == "doubleHeight":
        return ["true" if rec.get("is_double_height") else "false"]
    if key == "family":
        return [norm(family_of(rec))]
    return []


def level_number(value):
    """The level as a whole number from "L2", "2" or "Level 02" (None when there is no number)."""
    import re
    m = re.search(r"-?\d+", str(value if value is not None else ""))
    return int(m.group(0)) if m else None


def _alternatives(value):
    if isinstance(value, (list, tuple)):
        items = value
    else:
        items = str(value).split("|")
    return [norm(v) for v in items if str(v).strip()]


# A pour's concrete volume (m3): volumeFrom = at least, volumeBelow = less than.
_VOLUME_TERMS = ("volumeFrom", "volumeBelow", "typeNot")  # typeNot: the pour type is none of these (A|B)
_TERMS = ("building", "level", "type", "general", "stage", "zone", "external", "doubleHeight", "family")


def when_terms(when):
    """How many conditions a `when` has (its specificity)."""
    when = when or {}
    n = sum(1 for k in _TERMS if str(when.get(k, "") or "").strip())
    if str(when.get("levelFrom", "") or "").strip() or str(when.get("levelTo", "") or "").strip():
        n += 1
    if str(when.get("group", "") or "").strip():
        n += 1
    n += sum(1 for k in _VOLUME_TERMS if str(when.get(k, "") or "").strip())
    return n


# ---------------------------------------------------------------- group conditions (the 4D group's rows: field, is, value, and / or)

_TEXT_OPS = ("equals", "notEquals", "contains", "notContains", "startsWith", "endsWith")
_NUMBER_OPS = ("lessThan", "atMost", "greaterThan", "atLeast")
_NUMBER_FIELDS = ("volume", "levelNumber")


def _field_values(rec, field):
    """What a pour is for one group condition's field: a list of normalised texts (any may match), or for the numeric fields a number.
    A field is one of the pour's own (building, level, type, family, stage, zone, external, doubleHeight, general, volume, levelNumber),
    or a model property written prop:<set>/<name>. Returns None when the pour has no value for it."""
    if field == "volume":
        return _number(rec.get("volume"))
    if field == "levelNumber":
        n = rec.get("level_int")
        return float(n) if n is not None else (float(level_number(rec.get("level_code"))) if level_number(rec.get("level_code")) is not None else None)
    if field.startswith("prop:"):
        pset, _, name = field[5:].partition("/")
        value = quantities.raw_property(rec, pset, name)
        return None if value is None else value
    return [h for h in rec_attr(rec, field) if h != ""] or None


def _filter_holds(rec, f):
    field, op, value = str(f.get("field") or ""), str(f.get("op") or "equals"), str(f.get("value") or "")
    have = _field_values(rec, field)
    if op in _NUMBER_OPS:
        a = _number(have if not isinstance(have, list) else (have[0] if have else None))
        b = _number(value)
        if a is None or b is None:
            return False
        return {"lessThan": a < b, "atMost": a <= b, "greaterThan": a > b, "atLeast": a >= b}[op]
    if have is None:
        texts = []
    elif isinstance(have, list):
        texts = have
    else:
        texts = [str(have)]
    case = bool(f.get("caseSensitive")) and field.startswith("prop:")
    texts = [t if case else norm(t) for t in texts]
    wanted = [w if case else norm(w) for w in (value.split("|") if op in ("equals", "notEquals") else [value]) if w.strip() != ""]
    if not wanted:
        return True
    if op == "equals":
        return any(t == w for t in texts for w in wanted)
    if op == "notEquals":
        return not any(t == w for t in texts for w in wanted)
    if op == "contains":
        return any(w in t for t in texts for w in wanted)
    if op == "notContains":
        return not any(w in t for t in texts for w in wanted)
    if op == "startsWith":
        return any(t.startswith(w) for t in texts for w in wanted)
    if op == "endsWith":
        return any(t.endswith(w) for t in texts for w in wanted)
    return False


def active_filters(group):
    """The conditions of a group that count: not switched off with Ign, and with a value (as in the 4D groups)."""
    return [f for f in (group.get("filters") or []) if isinstance(f, dict) and not f.get("ignore") and str(f.get("value") or "").strip() != ""]


def filters_hold(rec, filters):
    """The conditions in a row, left to right, each joined to the result so far by its And / Or (the first one's is not used)."""
    result = None
    for f in filters:
        holds = _filter_holds(rec, f)
        result = holds if result is None else (result or holds if f.get("conj") == "or" else result and holds)
    return True if result is None else result


class Rules:
    def __init__(self, data=None):
        data = data if isinstance(data, dict) else {}
        self.data = data
        self.settings = data.get("settings") or {}
        self.durations = [r for r in data.get("durations") or [] if isinstance(r, dict)]
        self.productivity = [r for r in data.get("productivity") or [] if isinstance(r, dict)]
        self.rebar = [r for r in data.get("rebar") or [] if isinstance(r, dict)]
        self.crews = [r for r in data.get("crews") or [] if isinstance(r, dict)]
        self.chains = [r for r in data.get("chains") or [] if isinstance(r, dict) and str(r.get("phase", "")).strip()]
        self.rate_rows = [r for r in data.get("rates") or [] if isinstance(r, dict) and str(r.get("id", "")).strip()]
        self.crew_templates = [r for r in data.get("crewTemplates") or [] if isinstance(r, dict) and str(r.get("id", "")).strip()]
        self.assignments = [r for r in data.get("assignments") or [] if isinstance(r, dict)]
        self.trade_rows = [r for r in data.get("trades") or [] if isinstance(r, dict) and str(r.get("id", "")).strip()]
        self.calendars = [r for r in data.get("calendars") or [] if isinstance(r, dict)]
        self.calendar_rules = [r for r in data.get("calendarRules") or [] if isinstance(r, dict)]
        self.groups = [g for g in data.get("groups") or [] if isinstance(g, dict) and str(g.get("id", "")).strip()]
        self.level_tasks = [t for t in data.get("levelTasks") or [] if isinstance(t, dict)]
        self.sequences = [s for s in data.get("sequences") or [] if isinstance(s, dict)]
        self.contacts = [c for c in data.get("contacts") or [] if isinstance(c, dict)]
        self.level_links = [c for c in data.get("levelLinks") or [] if isinstance(c, dict)]
        # What a rule group is for: pours in a group with treatAs "exclude" are left out of the schedule, "stairStep" are steps cast with
        # their stair flight. (A switched-off group has no role.)
        self.roles = {}
        for g in self.groups:
            role = str(g.get("treatAs") or "").strip()
            if role and g.get("enabled") is not False:
                self.roles.setdefault(role, []).append(g["id"])
        self.extra_tags = data.get("extraTags") if isinstance(data.get("extraTags"), dict) else {}
        # Objects joined into one: {member GlobalId: main GlobalId}, from the rows {main, members: [GlobalId]} (Alt+J in the 3D view).
        self.joins = [j for j in data.get("joins") or [] if isinstance(j, dict) and str(j.get("main", "")).strip() and j.get("enabled") is not False]
        self.join_map = {}
        for j in self.joins:
            main = str(j["main"]).strip()
            for member in j.get("members") or []:
                member = str(member).strip()
                if member and member != main:
                    self.join_map.setdefault(member, main)
        # Recipes (their own file, handed over with the scenario) are compiled into the chains and assignments above.
        compiled = compile_recipes(data)
        self.chains += [r for r in compiled["chains"] if str(r.get("phase", "")).strip()]
        self.assignments += compiled["assignments"]
        # Equipment, cranes and materials the recipes' tasks use, and the scenario's pool of each type (its count).
        self.uses = compiled["uses"]
        self.recipe_links = compiled["links"]
        # Named values the formulas read (Rebar_Rate, Concrete_Rate, Curing_Days ...), and the limits on how many activities of a kind run at once.
        self.parameters = {}
        for r in data.get("parameters") or []:
            if isinstance(r, dict) and r.get("enabled") is not False:
                name = str(r.get("name") or r.get("id") or "").strip()
                value = _number(r.get("value"))
                if name and value is not None:
                    self.parameters[name.lower()] = value
        self.limits = [r for r in data.get("limits") or [] if isinstance(r, dict) and str(r.get("phase", "")).strip() and r.get("enabled") is not False]
        self.formulas = []
        self.formula_notes = []
        self.pool_rows = [r for r in data.get("resourcePools") or [] if isinstance(r, dict) and str(r.get("id", "")).strip() and r.get("enabled") is not False]
        self._group_cache = {}
        self._phase_cache = {}
        # The activities (task ids) that what follows a pour waits for, set by the chain rows marked "gates" as the activities are made.
        self.gate_tasks = set()
        self._compile_assignments()

    @property
    def empty(self):
        return not any((self.pool_rows, self.parameters, self.limits, self.formulas, self.settings, self.durations, self.productivity, self.rebar, self.crews, self.groups,
                        self.level_tasks, self.sequences, self.contacts, self.level_links, self.trade_rows, self.calendars,
                        self.calendar_rules, self.rate_rows, self.crew_templates, self.assignments, self.chains, self.joins))

    def chain_for(self, rec):
        """[{phase, suffix, label, material}] the rules give this pour's activities, in order, or None (the engine's default chain).
        Chain rows belong to a group (empty = every pour); the group of the highest priority (its rows' largest) wins, a tie goes to
        the group that comes first. Within a group the rows follow their `order`, then their place in the list."""
        key = id(rec)
        cache = self.__dict__.setdefault("_chain_cache", {})
        if key in cache:
            return cache[key][1]
        by_group, first = {}, {}
        for index, row in enumerate(self.chains):
            if row.get("enabled") is False:
                continue
            group = str(row.get("group", "") or "").strip()
            by_group.setdefault(group, []).append((_number(row.get("order"), 0.0) or 0.0, index, row))
            first.setdefault(group, index)
        best, best_key = None, None
        for group, rows in by_group.items():
            if group and not self.matches({"group": group}, rec):
                continue
            rank = (max(_number(r.get("priority"), 0.0) or 0.0 for _o, _i, r in rows), -first[group])
            if best_key is None or rank > best_key:
                best, best_key = rows, rank
        result = None
        if best:
            result = []
            for _o, _i, r in sorted(best, key=lambda t: (t[0], t[1])):
                phase = str(r.get("phase")).strip()
                result.append({"follows": _parse_follows(r.get("follows")), "finish_after": bool(r.get("finishAfter")), "gates": bool(r.get("gates")), "phase": phase, "suffix": str(r.get("suffix") or "").strip() or "-" + "".join(w[0] for w in phase.replace(",", " ").split()).upper(),
                               "label": str(r.get("label") or "").strip() or phase, "material": str(r.get("material") or "").strip().lower(), "recipe": str(r.get("recipe") or "").strip()})
        cache[key] = (rec, result)
        return result

    def _compile_assignments(self):
        """Turns the Assignments (group x phase -> rate, crew, calendar) into the rows the lookups read, each with `when: {group}` and the
        assignment's priority. An assignment whose rate, crew or calendar is not defined adds nothing for that part."""
        rates = {str(r["id"]).strip().upper(): r for r in self.rate_rows if r.get("enabled") is not False}
        crews = {str(r["id"]).strip().upper(): r for r in self.crew_templates if r.get("enabled") is not False}
        for index, a in enumerate(self.assignments):
            if a.get("enabled") is False:
                continue
            group, phase = str(a.get("group", "") or "").strip(), str(a.get("phase", "") or "").strip()
            base = {"id": f"ASSIGN-{index + 1}", "when": {"group": group} if group else {}, "priority": _number(a.get("priority"), 0.0) or 0.0}
            rate = rates.get(str(a.get("rate", "") or "").strip().upper())
            kind = str((rate or {}).get("type") or "days").strip().lower()
            days = _number(a.get("days"))
            if rate is not None and kind == "days" and days is None:
                days = _number(rate.get("days"))
            if phase and days is not None and days >= 0:
                self.durations.append({**base, "phases": {phase: days}})
            formula = str(a.get("formula", "") or "").strip()
            if formula and phase:
                self.formulas.append({**base, "phase": phase, "formula": formula})
            if rate is not None and kind == "productivity" and phase:
                self.productivity.append({
                    **base, "phase": phase, "basis": rate.get("basis") or "rebar", "pset": rate.get("pset"), "property": rate.get("property"),
                    "factor": rate.get("factor"), "fallback": rate.get("fallback"), "manhoursPerUnit": rate.get("manhoursPerUnit"),
                    "crew": rate.get("people") or 0, "shifts": rate.get("shifts") or 1, "hoursPerShift": rate.get("hoursPerShift") or 8,
                    "rounding": rate.get("rounding") or "ceil", "minDays": rate.get("minDays") or 0,
                })
            if rate is not None and kind == "rebar":
                self.rebar.append({**base, "tonnesPerM3": rate.get("tonnesPerM3")})
            density = rates.get(str(a.get("density", "") or "").strip().upper())
            if density is not None and str(density.get("type") or "").strip().lower() == "rebar":
                self.rebar.append({**base, "tonnesPerM3": density.get("tonnesPerM3")})
            crew = crews.get(str(a.get("crew", "") or "").strip().upper())
            if crew is not None and phase:
                self.crews.append({**base, "phase": phase, "crewId": str(crew.get("id", "")).strip(), "trades": [t for t in crew.get("trades") or [] if isinstance(t, dict)]})
            calendar = str(a.get("calendar", "") or "").strip()
            if calendar:
                self.calendar_rules.append({**base, "phase": phase or None, "calendar": calendar})

    # ---- rule groups
    def group_ids(self, rec):
        """The ids of the rule groups a pour belongs to (a group's own terms, or any group it includes)."""
        key = id(rec)
        if key in self._group_cache:
            return self._group_cache[key][1]  # (the record is kept with its answer so its id cannot be reused)
        direct = {}
        for g in self.groups:
            select = g.get("select") or {}  # (older rules: the conditions as key = value terms)
            legacy = bool(when_terms({k: v for k, v in select.items() if k != "group"}))
            filters = active_filters(g)
            direct[g["id"]] = (legacy or bool(filters)) and (not legacy or self._matches_terms(select, rec)) and filters_hold(rec, filters)
        # groups made of other groups (a few passes settle chains of them)
        for _ in range(len(self.groups)):
            moved = False
            for g in self.groups:
                if direct[g["id"]]:
                    continue
                if any(direct.get(str(i)) for i in g.get("include") or []):
                    direct[g["id"]] = moved = True
            if not moved:
                break
        ids = {gid for gid, inside in direct.items() if inside}
        self._group_cache[key] = (rec, ids)
        return ids

    def group(self, group_id):
        return next((g for g in self.groups if g["id"] == group_id), None)

    def _matches_terms(self, when, rec):
        """Every term except `group` (see matches)."""
        for key in _TERMS:
            raw = when.get(key)
            if raw is None or str(raw).strip() == "":
                continue
            wanted = _alternatives(raw)
            if not wanted or not any(h and h in wanted for h in rec_attr(rec, key)):
                return False
        not_types = _alternatives(when.get("typeNot")) if str(when.get("typeNot", "") or "").strip() else []
        if not_types and any(h and h in not_types for h in rec_attr(rec, "type")):
            return False
        at_least, below = _number(when.get("volumeFrom")), _number(when.get("volumeBelow"))
        if at_least is not None or below is not None:
            volume = _number(rec.get("volume"), 0.0)
            if (at_least is not None and volume < at_least) or (below is not None and volume >= below):
                return False
        lo, hi = level_number(when.get("levelFrom")), level_number(when.get("levelTo"))
        if lo is not None or hi is not None:
            n = rec.get("level_int")
            if n is None:
                n = level_number(rec.get("level_code"))
            if n is None or (lo is not None and n < lo) or (hi is not None and n > hi):
                return False
        return True

    def matches(self, when, rec):
        """Whether a pour record meets every term of a `when` (an empty `when` meets every pour)."""
        when = when or {}
        if not self._matches_terms(when, rec):
            return False
        group = str(when.get("group", "") or "").strip()
        if group and not any(g in self.group_ids(rec) for g in _alternatives_raw(group)):
            return False
        return True

    def best(self, rows, rec, wanted=None):
        """The row whose `when` fits the pour best (most terms; a tie goes to the earlier row), or None."""
        found, found_key = None, None
        for index, row in enumerate(rows):
            if wanted is not None and not wanted(row):
                continue
            if row.get("enabled") is False:
                continue
            when = row.get("when") or {}
            if not self.matches(when, rec):
                continue
            key = (_number(row.get("priority"), 0.0) or 0.0, when_terms(when), -index)
            if found_key is None or key > found_key:
                found, found_key = row, key
        return found

    # ---- durations
    def phase_days(self, rec):
        """{phase: days} the rules set for this pour: per phase the best matching row's value."""
        key = id(rec)
        if key in self._phase_cache:
            return self._phase_cache[key][1]
        out, ranks = {}, {}
        for index, row in enumerate(self.durations):
            if row.get("enabled") is False or not self.matches(row.get("when"), rec):
                continue
            rank = (_number(row.get("priority"), 0.0) or 0.0, when_terms(row.get("when")), -index)
            for phase, value in (row.get("phases") or {}).items():
                days = _number(value)
                if days is None or days < 0:
                    continue
                if phase not in ranks or rank > ranks[phase]:
                    out[phase], ranks[phase] = days, rank
        self._phase_cache[key] = (rec, out)
        return out

    def quantity_for(self, row, rec):
        """The quantity a productivity row works from, for this pour: tonnes of rebar (concrete volume x the rebar rate), m3 of
        concrete, or a number the model carries (basis "property": a property or quantity set and a name, times `factor`, which
        turns kg into t, say). A property the pour lacks falls back to `fallback` (rebar, concrete or none = the row does not apply)."""
        def number(v):
            try:
                return float(v or 0)
            except (TypeError, ValueError):
                return 0.0
        basis = str(row.get("basis") or "rebar").strip().lower()
        if basis in ("footprint", "sides"):
            # Measured from the geometry, summed over the objects joined into this one.
            from core.helpers import get_measured_area
            total, found = 0.0, False
            for r in [rec, *(rec.get("joined") or [])]:
                element = r.get("element")
                area = get_measured_area(element, basis) if element is not None else None
                if area is not None:
                    total, found = total + area, True
            return total if found else None
        if basis == "property":
            value = quantities.property_value(rec, row.get("pset"), row.get("property"))
            if value is not None:
                factor = _number(row.get("factor"), 1.0)
                return value * (1.0 if factor is None else factor)
            basis = str(row.get("fallback") or "rebar").strip().lower()
            if basis not in ("rebar", "concrete"):
                return None
        return number(rec.get("rebar_weight_tonnes")) if basis == "rebar" else number(rec.get("volume"))

    def formula_values(self, rec, text):
        """The names a duration formula can use for this pour: the scenario's parameters, and the pour's own quantities (Concrete_m3, Rebar_t, Rebar_kg,
        Footprint_m2, Sides_m2), with the crews (1) a task has."""
        used = _formula.names_in(text)
        values = dict(self.parameters)
        values.setdefault("crews", 1.0)
        volume = _number(rec.get("volume"), 0.0) or 0.0
        tonnes = _number(rec.get("rebar_weight_tonnes"), 0.0) or 0.0
        values.update({"concrete_m3": volume, "volume": volume, "rebar_t": tonnes, "rebar_kg": tonnes * 1000.0})
        for name, basis in (("footprint_m2", "footprint"), ("sides_m2", "sides")):
            if name in used:
                values[name] = self.quantity_for({"basis": basis}, rec)
        return values

    def formula_days(self, rec, phase):
        """Days from the best matching formula for this phase (a recipe task's Duration formula), or None; a formula that cannot be worked out
        for this pour (a name it has no value for) is noted once and gives None, so the phase keeps its other days."""
        row = self.best(self.formulas, rec, lambda r: str(r.get("phase", "")).strip() == phase)
        if row is None:
            return None
        try:
            days = _formula.evaluate(row["formula"], self.formula_values(rec, row["formula"]))
        except _formula.FormulaError as e:
            note = f"Duration formula of {phase} ({row['formula']}): {e}"
            if note not in self.formula_notes:
                self.formula_notes.append(note)
            return None
        return max(days, 0.0)

    def limit_size(self, row):
        """How many may run at once under a limit row: a number, or the name of a parameter (Formwork_Sets_Available); 0 or none: no limit.
        "Maximize resource availability" lifts every limit."""
        if _maximize():
            return 0
        raw = row.get("max")
        size = _number(raw)
        if size is None:
            name = str(raw or "").strip().lower()
            # An equipment or crane of Resources (its ID or name): its quantity is the number, so it is typed in one place.
            pool = next((p for p in self.pools() if p["kind"] != "material" and name in (p["id"].lower(), p["name"].lower())), None) if name else None
            size = pool["quantity"] if pool else self.parameters.get(name)
        return int(size) if size and size >= 1 else 0

    def computed_days(self, rec, phase, default_crew=0.0):
        """Days worked out from a quantity for this phase, or None: a formula first; else quantity x man-hours per unit
        / (crew x shifts x hours per shift), rounded as the row says, never under its minimum."""
        from_formula = self.formula_days(rec, phase)
        if from_formula is not None:
            return from_formula
        row = self.best(self.productivity, rec, lambda r: str(r.get("phase", "")).strip() == phase)
        if row is None:
            return None
        quantity = self.quantity_for(row, rec)
        if quantity is None:
            return None
        per_unit = _number(row.get("manhoursPerUnit"), 0.0)
        crew = _number(row.get("crew"), 0.0) or default_crew
        shifts = _number(row.get("shifts"), 1.0) or 1.0
        hours = _number(row.get("hoursPerShift"), 8.0) or 8.0
        if per_unit <= 0 or crew <= 0:
            return None
        days = quantity * per_unit / (crew * shifts * hours)
        rounding = str(row.get("rounding") or "ceil").strip().lower()
        if rounding == "ceil":
            days = math.ceil(days - 1e-9)
        elif rounding == "round":
            days = float(round(days))
        return max(days, _number(row.get("minDays"), 0.0) or 0.0)

    # ---- resources
    def rebar_rate(self, rec):
        """Tonnes of rebar per m3 for this pour from the rules, or None (no rebar quantity)."""
        row = self.best(self.rebar, rec)
        if row:
            return _number(row.get("tonnesPerM3"))
        # No Rebar rate rule: the density the Rebar task's duration formula reads (a Rebar_kg_per_m3_* parameter, kg per m3), else 0.25 t per m3.
        formula = self.best(self.formulas, rec, lambda r: str(r.get("phase", "")).strip().lower() == "rebar")
        if formula:
            for name in sorted(_formula.names_in(formula["formula"])):
                if name.startswith("rebar_kg_per_m3") and self.parameters.get(name):
                    return self.parameters[name] / 1000.0
        return DEFAULT_REBAR_T_PER_M3

    def crew_for(self, phase, rec):
        """[(trade, size)] the rules give this phase of this pour, or None to use the crew table."""
        phase = str(phase or "").strip()
        row = self.best(self.crews, rec, lambda r: str(r.get("phase", "")).strip() == phase)
        if row is None:
            return None
        crew = []
        for t in row.get("trades") or []:
            trade, size = str(t.get("trade", "")).strip().upper(), _number(t.get("size"), 0.0)
            if trade and size and size > 0:
                crew.append((trade, size))
        return crew

    def crew_pool_for(self, phase, rec):
        """{id, name, quantity} of the crew pool of the named crew this activity of this pour gets (a Crew with crews available), or None."""
        phase = str(phase or "").strip()
        row = self.best(self.crews, rec, lambda r: str(r.get("phase", "")).strip() == phase)
        crew_id = str((row or {}).get("crewId") or "").strip().upper()
        return next((p for p in self.crew_pools() if p["id"].upper() == crew_id), None) if crew_id else None

    def crew_pools(self):
        """[{id, name, quantity}] the named crews that have a number of crews available (the scenario's pool of that crew, by its subcontractor):
        one resource each. "Maximize resource availability": no limit (0)."""
        out = []
        for c in self.crew_templates:
            if c.get("enabled") is False:
                continue
            available = _number(c.get("available"), 0.0) or 0.0
            if available <= 0:
                continue
            code = str(c["id"]).strip()
            sub = str(c.get("subcontractor") or "").strip()
            out.append({"id": code, "name": f"{sub} \u00b7 {code}" if sub else code, "quantity": 0.0 if _maximize() else available})
        return out

    def trades(self):
        """{code: {name, capacity}} of the rules' Trade rows (a row switched off is left out). The capacity is the site's people per
        day, written to P6 as the resource's max units per time. No rows: no trades, so no labour resources."""
        out = {}
        for row in self.trade_rows:
            code = str(row.get("id", "")).strip().upper()
            if row.get("enabled") is False:
                continue
            capacity = _number(row.get("capacity"), 0.0)
            out[code] = {"name": str(row.get("name") or code).strip() or code, "capacity": 0 if _maximize() else (capacity if capacity and capacity > 0 else 0)}
        return out

    # ---- equipment, cranes and materials
    def pools(self):
        """[{kind, id, name, quantity}] the scenario's pools: a type of equipment, crane or material and how many there are (0: not limited)."""
        out = []
        for r in self.pool_rows:
            kind = str(r.get("kind") or "equipment").strip().lower()
            if kind not in ("equipment", "crane", "material"):
                continue
            code = str(r.get("id")).strip()
            quantity = 0.0 if _maximize() else _number(r.get("quantity"), 0.0) or 0.0
            out.append({"kind": kind, "id": code, "name": str(r.get("name") or code).strip() or code, "quantity": quantity})
        return out

    def resource_uses(self, phase, rec):
        """[{kind, type, count}] the recipes give this activity of this pour (the best fitting recipe task), or []."""
        phase = str(phase or "").strip()
        row = self.best(self.uses, rec, lambda r: str(r.get("phase", "")).strip().upper() == phase.upper())
        return row["uses"] if row else []

    # ---- joined objects
    @staticmethod
    def reset_joins(records):
        """Puts back what joining changed on the records (a long-running generator keeps them between requests): the own volume."""
        for rec in records:
            if "_own_volume" in rec:
                rec["volume"] = rec["_own_volume"]
            else:
                rec["_own_volume"] = rec.get("volume")
            rec.pop("joined", None)
            rec.pop("joined_into", None)

    def apply_joins(self, records):
        """Objects joined into one get one set of activities, the main object's: the others are left out (like an excluded pour) and their
        volume and rebar are added to the main's. The main's own type, level, crews and rates decide. Returns how many objects were joined."""
        if not self.joins:
            return 0
        by_guid = {str(getattr(r.get("element"), "GlobalId", "") or "").strip(): r for r in records}
        joined = 0
        for j in self.joins:
            main = by_guid.get(str(j["main"]).strip())
            if main is None:
                continue
            members = [by_guid[g] for g in dict.fromkeys(str(m).strip() for m in j.get("members") or []) if g in by_guid and by_guid[g] is not main and self.join_map.get(g) == str(j["main"]).strip()]
            for m in members:
                main["volume"] = (_number(main.get("volume"), 0.0) or 0.0) + (_number(m.get("_own_volume"), 0.0) or 0.0)
                main["rebar_weight_tonnes"] = (_number(main.get("rebar_weight_tonnes"), 0.0) or 0.0) + (_number(m.get("rebar_weight_tonnes"), 0.0) or 0.0)
                m["include"] = "NO"
                m["joined_into"] = main
                main.setdefault("joined", []).append(m)
                joined += 1
        return joined

    def remap_clashes(self, clashes):
        """The clash results with every joined object taken as its main object (what touched a member now touches the main one), and the
        pairs inside one join dropped. A new list: the generator's own is not changed."""
        if not self.join_map or not clashes:
            return clashes
        out = []
        for c in clashes:
            a_key = next((k for k in ("Pour A GUID", "a_global_id") if c.get(k)), None)
            b_key = next((k for k in ("Pour B GUID", "b_global_id") if c.get(k)), None)
            if not a_key or not b_key:
                out.append(c)
                continue
            a, b = str(c[a_key]).strip(), str(c[b_key]).strip()
            na, nb = self.join_map.get(a, a), self.join_map.get(b, b)
            if na == nb:
                continue
            out.append({**c, a_key: na, b_key: nb} if (na, nb) != (a, b) else c)
        return out

    # ---- which pours are in
    def min_pour_volume(self):
        n = _number(self.settings.get("minPourVolumeM3"))
        return DEFAULT_MIN_POUR_VOLUME_M3 if n is None else n

    def in_role(self, rec, role):
        """Whether the pour is in a group that is treated as `role` ("exclude", "stairStep")."""
        ids = self.group_ids(rec)
        return any(g in ids for g in self.roles.get(role, []))

    def is_stair_step(self, rec):
        """Whether a stair pour is a step cast with its flight by the groups (treatAs "stairStep"), or None when the rules have no such
        group (the stair step volume setting then decides)."""
        return self.in_role(rec, "stairStep") if self.roles.get("stairStep") else None

    def is_included(self, rec, excluded_types):
        """Whether a pour gets activities. With groups treated as "exclude" they decide (a stair step is always in), and the smallest
        pour and excluded types settings are not used. Without them it is the generator's own test (build_pour_records): big enough
        (stairs always) and not an excluded type, both settings of the scenario's rules."""
        if self.roles.get("exclude"):
            return self.in_role(rec, "stairStep") or not self.in_role(rec, "exclude")
        pour_type = str(rec.get("pour_type", "") or "")
        try:
            volume = float(rec.get("volume") or 0)
        except (TypeError, ValueError):
            volume = 0.0
        return (volume >= self.min_pour_volume() or "STAIR" in pour_type) and pour_type not in excluded_types


def _maximize():
    """Whether the scenario has "Maximize resource availability": no pool and no trade has a limit."""
    import config
    return bool(getattr(config, "MAXIMIZE_RESOURCES", False))


_FOLLOW_EXPLICIT = None


def _parse_follows(value):
    """"Decking@80, Under Slab" -> [("Decking", 80.0), ("Under Slab", 100.0)]: the phases an activity follows and how far along each must be
    (100 = it has finished). Empty: the activity before it in the chain, at 100."""
    out = []
    import re
    global _FOLLOW_EXPLICIT
    if _FOLLOW_EXPLICIT is None:
        _FOLLOW_EXPLICIT = re.compile(r"^(.*?)\s*:\s*(FS|SS|FF|SF)\s*([+-]\s*\d+(?:\.\d+)?)?\s*(h|d|%\s*s?)?$", re.IGNORECASE)
    for part in str(value or "").replace(";", ",").split(","):
        shared = re.match(r"^(.*?)\s*:\s*(FS|SS|FF|SF)\s*@\s*(\d+(?:\.\d+)?)\s*%?$", part.strip(), re.IGNORECASE)
        if shared and shared.group(1).strip() and float(shared.group(3)) > 0:
            # "Rebar:SS@80": the type with a share of the task it follows (80 % of its duration)
            out.append((shared.group(1).strip(), 100.0, shared.group(2).upper(), float(shared.group(3)), "pred"))
            continue
        explicit = _FOLLOW_EXPLICIT.match(part.strip())
        if explicit and explicit.group(1).strip():
            # "Rebar:SS+16" = start-to-start, 16 hours after; "Rebar:FS-8" = finish-to-start, 8 hours before (an overlap); "Rebar:FF"
            # "Rebar:SS+30%" = 30 % of Rebar's duration after its start; "Rebar:FF-20%s" = 20 % of this activity's own duration before (s: of the successor)
            lag = float((explicit.group(3) or "0").replace(" ", ""))
            unit = (explicit.group(4) or "h").replace(" ", "").lower()
            basis = "h" if unit == "h" else "d" if unit == "d" else ("succ" if unit.endswith("s") else "pred")  # d: days of the activity's calendar
            out.append((explicit.group(1).strip(), 100.0, explicit.group(2).upper(), lag, basis))
            continue
        name, _, pct = part.partition("@")
        name = name.strip()
        if name:
            number = _number(pct.strip().rstrip("%"), 100.0)
            out.append((name, min(100.0, max(0.0, 100.0 if number is None else number))))
    return out


def _alternatives_raw(value):
    return [str(v).strip() for v in str(value).split("|") if str(v).strip()]


ACTIVE = Rules({})


def activate(data):
    """Makes the scenario's rules the ones every lookup uses (and puts its engine settings in place). Returns them."""
    global ACTIVE
    ACTIVE = Rules(data)
    apply_settings(ACTIVE.settings)
    return ACTIVE


def active():
    return ACTIVE


def excluded_pour_types(configured):
    """EXCLUDED_POUR_TYPES as the inclusion test compares them (upper case, spaces for underscores)."""
    return {str(t).replace("_", " ").strip().upper() for t in (configured or [])}


def engine_defaults():
    """What the generator does without rules, for the Rules panel to show: its settings (config.py). Durations and rebar rates are rules."""
    import config
    settings = {}
    for key, (attr, kind) in SETTINGS.items():
        value = getattr(config, attr, None)
        settings[key] = sorted(value) if kind == _LIST and value is not None else value
    settings["minPourVolumeM3"] = DEFAULT_MIN_POUR_VOLUME_M3
    return {
        "settings": settings,
    }
