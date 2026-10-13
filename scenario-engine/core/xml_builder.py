"""
core/xml_builder.py
Complete corrected version with improved WBS and milestone handling
"""
import xml.etree.ElementTree as ET
import uuid
import math
import re
from datetime import datetime
from collections import defaultdict
from copy import deepcopy

from core.helpers import title_case, get_plan_footprint
from core.clash_position import classify_vertical_position, DEFINITELY_BELOW, MAJORITY_BELOW, DEFINITELY_ABOVE, MAJORITY_ABOVE
from core.resources import crews_for, labour_resource_id, labour_trades, rebar_tonnes
from core import calendars as _calendars
from core import rules as _rules_module
from core.rates_info import rate_fields
from config import PROJECT_SHORT, ALT_POUR_ID_PROP

def _rules_active():
    return _rules_module.active()


try:
    import config as _config
except ImportError:
    _config = None

WBS_PREFIX = getattr(_config, "WBS_PREFIX", "")
# datetime.today() carries the exact wall-clock moment the script ran (e.g.
# 12:42:11) as the fallback data date, which then propagates into every
# CPM-computed Start/Finish time when config.py doesn't set START_DATE
# explicitly. Strip to midnight so an unset START_DATE still anchors on a
# clean date.
START_DATE = getattr(_config, "START_DATE", None) or datetime.today().replace(
    hour=0, minute=0, second=0, microsecond=0
)
ENABLE_GROUP_MILESTONES = getattr(_config, "ENABLE_GROUP_MILESTONES", False)
ENABLE_BUILDING_COMPLETION = getattr(_config, "ENABLE_BUILDING_COMPLETION", False)
ENABLE_COMPLETION_CLOSEOUT = getattr(_config, "ENABLE_COMPLETION_CLOSEOUT", False)
# Level gate scope: when True, only SLAB pours on a level are tied back to the
# level below — walls/columns/stairs then follow their own slab through the
# clash-derived slab-support edges (a wall bears on the slab it sits on),
# instead of every Rebar/Installation task on the level carrying the whole
# lower level's finals as predecessors. Set False to restore the old
# every-start-task-to-every-lower-final behaviour.
LEVEL_GATE_SLABS_ONLY = getattr(_config, "LEVEL_GATE_SLABS_ONLY", True)
ENABLE_LEVEL_GATE = getattr(_config, "ENABLE_LEVEL_GATE", True)
# How the user's sequence steps follow each other (Rules > Settings > Sequence): False = each step starts when the previous one is finished;
# True = a step starts SEQUENCE_LEAD_DAYS working days after the previous one starts, and the concrete is poured in step order.
SEQUENCE_FLOW = getattr(_config, "SEQUENCE_FLOW", False)
SEQUENCE_LEAD_DAYS = getattr(_config, "SEQUENCE_LEAD_DAYS", 3.0)
_HOURS_PER_DAY = 8.0
# Feeding a slab's first task (Decking): count only the lower level's pure
# "Concrete" phase tasks, and drop stage-2 pours entirely.
LEVEL_GATE_DECKING_CONCRETE_ONLY = getattr(_config, "LEVEL_GATE_DECKING_CONCRETE_ONLY", True)
LEVEL_GATE_MAX_DISTANCE_M = getattr(_config, "LEVEL_GATE_MAX_DISTANCE_M", None)
SLAB_CURING_GATES_SUCCESSORS = getattr(_config, "SLAB_CURING_GATES_SUCCESSORS", False)
# Activities left with no successor precede the slab above them before falling back to the completion milestone.
ENABLE_OPEN_END_SEQUENCING = getattr(_config, "ENABLE_OPEN_END_SEQUENCING", True)
OPEN_END_MAX_DISTANCE_M = getattr(_config, "OPEN_END_MAX_DISTANCE_M", 0.3)
# No slab within that reach (a wall whose top stops short of the soffit, or beside the slab's edge): precede the
# nearest slab above it instead, so only pours with no slab above them at all (the roof) end on the completion milestone.
OPEN_END_NEAREST_SLAB_FALLBACK = getattr(_config, "OPEN_END_NEAREST_SLAB_FALLBACK", True)


def _concrete_done_task(task_map):
    """The task a pour's successors wait for: the activity its chain marks as gating, else its Concrete, or (a slab with curing, when
    SLAB_CURING_GATES_SUCCESSORS is on) the Curing that follows it. Heavy Precast has a Curing but no Concrete, so it is not affected."""
    # A chain row marked "gates" (Rules > Chains) is what the pour's successors wait for, whatever it is called: a raft's Curing, say.
    gates = _rules_active().gate_tasks
    for task_id in task_map.values():
        if task_id in gates:
            return task_id
    concrete = task_map.get("Concrete")
    if concrete and SLAB_CURING_GATES_SUCCESSORS and task_map.get("Curing"):
        return task_map["Curing"]
    return concrete


USE_ACTIVITY_BASED_ACTIVITY_CODES = getattr(_config, "USE_ACTIVITY_BASED_ACTIVITY_CODES", False)
WBS_BUILDING_ROOT_OBJECT_ID = getattr(_config, "WBS_BUILDING_ROOT_OBJECT_ID", {"DEFAULT": 1})


# ====================== HELPER FUNCTIONS ======================

def _safe_int(value, default=999999):
    try:
        return int(float(str(value).strip() or 0))
    except:
        return default

def _normalized_pour_type(rec):
    return str(rec.get("pour_type", "") or "").replace(" ", "_").upper()


from core.stair_steps import stair_group_label  # noqa: E402


def _is_insitu_stair(rec):
    """A stair cast in place (Rebar / Formwork / Concrete): any stair that is not precast."""
    return "STAIR" in _normalized_pour_type(rec) and str(rec.get("conc_stage", "") or "").strip().upper() != "PRECAST"


def _is_stage2_pedestal(rec):
    # Stage-2 pedestals are later-pass box-outs — the same "unless stated
    # otherwise in the drawing (e.g. 2nd stage box-outs)" carve-out already
    # applied to stage-2 Heavy Precast walls. They shouldn't gate anything
    # above them (slab support, level-gate) just because they're
    # geometrically/level-wise underneath it — their (often much later,
    # separately sequenced) finish date would otherwise drag the whole
    # level above down with them.
    if _normalized_pour_type(rec) != "PEDESTAL":
        return False
    return _is_stage2(rec)


def _is_stage2(rec):
    """Any stage-2 pour (box-outs / later-pass work), not just pedestals —
    used where a stage-2 finish shouldn't drag a following activity's start."""
    return str((rec or {}).get("conc_stage", "") or "").strip().upper() in {"2", "STAGE 2", "2.0", "STAGE2"}


def _safe_float(value, default=None):
    try:
        text = str(value).strip()
        if text == "":
            return default
        return float(text)
    except:
        return default


def _resolve_building_root_object_id(building_code):
    building = str(building_code or "").strip().upper()
    candidates = [building]

    # Also allow lookup by base building code without unit prefix (e.g. 1HQB -> HQB).
    base = building.lstrip("0123456789")
    if base and base not in candidates:
        candidates.append(base)
    if "DEFAULT" not in candidates:
        candidates.append("DEFAULT")

    for key in candidates:
        if key in WBS_BUILDING_ROOT_OBJECT_ID:
            return int(WBS_BUILDING_ROOT_OBJECT_ID[key])
    return 1


_CWA_BUILDING_VALUES = [
    "CRX", "HDAB", "HDCD", "HHI", "HK", "HL1", "HL23", "HL4",
    "HN", "HQA", "HQB", "HQC", "HR", "HVD", "HVL", "HW", "HXA",
]
_CWA_UNIT_VALUES = ["1", "2", "0", "9"]
# Buildings written differently in a model (HNX) -> their CWA-Building value (HN); config.py.
_CWA_BUILDING_ALIASES = {
    str(k).strip().upper(): str(v).strip().upper()
    for k, v in (getattr(_config, "CWA_BUILDING_CODE_ALIASES", {}) or {}).items()
} if _config else {}


def _split_cwa_building_code(value):
    text = str(value or "").strip().upper()
    if not text:
        return "", ""

    match = re.match(r"^(\d+)?(.+)$", text)
    if not match:
        return "", text

    unit_code = str(match.group(1) or "")
    building_code = str(match.group(2) or "").strip().upper()
    return unit_code, building_code


def _task_id_building(task_id):
    """The Unit + Building part of an activity ID, after any project prefix
    (<project>-1HN-L4-… -> 1HN). Unit 9 is not in IDs, so prefer the
    record's unit_building."""
    parts = [p for p in str(task_id or "").strip().upper().split("-") if p]
    project = str(getattr(_config, "PROJECT_SHORT", "") or "").strip().upper()
    if project and len(parts) > 1 and parts[0] == project:
        parts = parts[1:]
    return parts[0] if parts else ""


def _extract_activity_code_source(rec, act_data):
    # Unit + Building in full (9HVD), as main.py records it.
    unit_building = str(rec.get("unit_building", "") or "").strip().upper()
    if unit_building:
        return unit_building

    if USE_ACTIVITY_BASED_ACTIVITY_CODES:
        task_id = str(act_data.get("task_id", "") or "").strip().upper()
        if task_id:
            return _task_id_building(task_id)

        task_name = str(act_data.get("task_name", "") or "").strip().upper()
        if task_name and " - " in task_name:
            return task_name.split(" - ", 1)[0]

    rec_building = str(rec.get("building", "") or "").strip().upper()
    if rec_building:
        return rec_building

    task_id = str(act_data.get("task_id", "") or "").strip().upper()
    if task_id and "-" in task_id:
        return _task_id_building(task_id)

    task_name = str(act_data.get("task_name", "") or "").strip().upper()
    if task_name and " - " in task_name:
        return task_name.split(" - ", 1)[0]

    return ""


def _build_intra_pour_predecessors(activities, sequence_order=None):
    """Builds intra-pour predecessor relationships (Rebar → Formwork → Concrete, etc.)"""
    sequence_order = sequence_order or []
    pour_groups = defaultdict(list)
    
    for act in activities:
        rec = act.get("rec", {})
        key = (
            str(rec.get("building", "")),
            str(rec.get("planning_proposed_pour_id", "")).zfill(4)
        )
        pour_groups[key].append(act)

    predecessors = defaultdict(list)

    for acts in pour_groups.values():
        if len(acts) < 2:
            continue
            
        # The pour's activities in the order of its chain (Rules > Chains). Each follows the one before, or the phases its chain row names
        # ("Decking@80, Under Slab": 80 % of Decking done, and Under Slab finished); the edges that are not finish-to-start are in `intra_edges`.
        ordered = [a for a in sorted(acts, key=lambda a: a.get("phase_order", 0)) if a.get("task_id")]
        by_phase = {str(a.get("phase", "")).strip().upper(): a for a in ordered}
        for index, act in enumerate(ordered):
            curr = act["task_id"]
            edges = {}
            for name, pct in act.get("follows") or []:
                pred = by_phase.get(name.strip().upper())
                if pred is not None and pred["task_id"] != curr:
                    edges[pred["task_id"]] = pct
            if not edges and index > 0 and ordered[index - 1]["task_id"] != curr:
                edges[ordered[index - 1]["task_id"]] = 100.0
            for pred_id, pct in edges.items():
                predecessors[curr].append(pred_id)
            act["intra_edges"] = edges

    return predecessors


def _build_slab_support_predecessors_from_clashes(activities, clash_results):
    if not activities or not clash_results:
        return {}

    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)
    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id

    def _final_task_for_guid(guid):
        task_map = guid_to_tasks.get(guid, {})
        return (
            _concrete_done_task(task_map)
            or task_map.get("Rebar, Formwork and Concrete")
            or task_map.get("Stitching")
            or task_map.get("Installation")
            or next(iter(task_map.values()), None)
        )

    def _slab_start_task_for_guid(guid):
        task_map = guid_to_tasks.get(guid, {})
        return (
            task_map.get("Decking")
            or task_map.get("Under Slab")
            or task_map.get("Works before slab")
            or task_map.get("Concrete")
        )

    def _start_task_for_guid(guid):
        task_map = guid_to_tasks.get(guid, {})
        rec = guid_to_rec.get(guid, {})
        ptype = _normalized_pour_type(rec)

        if ptype in {"REMOVABLE_ELEMENT", "HEAVY_PRECAST", "STAIR"} and not _is_insitu_stair(rec):
            return (
                task_map.get("Propping")
                or task_map.get("Installation")
                or task_map.get("Stitching")
                or _final_task_for_guid(guid)
            )

        if ptype in {"SLAB", "MAIN_SLAB", "LANDING"}:
            return _slab_start_task_for_guid(guid) or _final_task_for_guid(guid)

        return (
            task_map.get("Rebar")
            or task_map.get("Formwork")
            or task_map.get("EP+FWK")
            or task_map.get("Concrete")
            or task_map.get("Installation")
            or task_map.get("Stitching")
            or next(iter(task_map.values()), None)
        )

    def _is_supported_slab(rec):
        ptype = _normalized_pour_type(rec)
        return ptype in {"SLAB", "MAIN_SLAB", "LANDING"}

    def _is_heavy_precast(rec):
        ptype = _normalized_pour_type(rec)
        gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
        return ptype == "HEAVY_PRECAST" or gtype == "HEAVY_PRECAST"

    def _is_removable(rec):
        ptype = _normalized_pour_type(rec)
        gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
        return ptype == "REMOVABLE_ELEMENT" or "REMOVABLE" in ptype or "REMOVABLE" in gtype

    def _is_supporting_type(rec):
        ptype = _normalized_pour_type(rec)
        supporting_keywords = {"WALL", "COLUMN", "BEAM", "PEDESTAL", "RAFT", "LANDING", "HEAVY_PRECAST"}
        return any(keyword in ptype for keyword in supporting_keywords)

    def _is_underneath(lower_rec, upper_rec):
        # Consider clear vertical separation first, then allow near-touching support cases
        # for structural elements that typically bear slabs.
        lower_z = _safe_float(lower_rec.get("coord_z"), None)
        upper_z = _safe_float(upper_rec.get("coord_z"), None)
        if lower_z is not None and upper_z is not None:
            if lower_z + 0.5 < upper_z:
                return True

        upper_min = _safe_float(upper_rec.get("min_elevation"), None)
        lower_max = _safe_float(lower_rec.get("max_elevation"), None)
        if upper_min is not None and lower_max is not None:
            separation = upper_min - lower_max

            if separation > 0.10:
                return True

            if -0.30 <= separation <= 0.10 and _is_supporting_type(lower_rec):
                return True

        return False

    def _vertical_relation(rec_a, rec_b):
        """
        Returns:
          -1 if A is below B
           1 if A is above B
           0 if undetermined/overlapping
        """
        a_min = _safe_float(rec_a.get("min_elevation"), None)
        a_max = _safe_float(rec_a.get("max_elevation"), None)
        b_min = _safe_float(rec_b.get("min_elevation"), None)
        b_max = _safe_float(rec_b.get("max_elevation"), None)

        if a_max is not None and b_min is not None and a_max <= b_min - 0.05:
            return -1
        if b_max is not None and a_min is not None and b_max <= a_min - 0.05:
            return 1

        a_z = _safe_float(rec_a.get("coord_z"), None)
        b_z = _safe_float(rec_b.get("coord_z"), None)
        if a_z is not None and b_z is not None:
            if a_z <= b_z - 0.25:
                return -1
            if b_z <= a_z - 0.25:
                return 1

        return 0

    def _level_int(rec):
        try:
            return int(rec.get("level_int", 0) or 0)
        except:
            return 0

    def _same_building(rec_a, rec_b):
        return str(rec_a.get("building", "") or "").strip().upper() == str(rec_b.get("building", "") or "").strip().upper()

    def _plausible_vertical_pair(lower_rec, upper_rec):
        lower_lvl = _level_int(lower_rec)
        upper_lvl = _level_int(upper_rec)

        # Prevent unrealistic links spanning multiple levels (e.g. L0 -> L4).
        if lower_lvl and upper_lvl:
            if upper_lvl < lower_lvl:
                return False
            if (upper_lvl - lower_lvl) > 1:
                return False

        # Fallback geometric sanity check if level info is weak or absent.
        lower_z = _safe_float(lower_rec.get("coord_z"), None)
        upper_z = _safe_float(upper_rec.get("coord_z"), None)
        if lower_z is not None and upper_z is not None:
            if upper_z < lower_z:
                return False
            if (upper_z - lower_z) > 7.5:
                return False

        return True

    predecessors = defaultdict(list)
    seen_pairs = set()

    for clash in clash_results:
        a_guid = str(clash.get("Pour A GUID") or clash.get("a_global_id", "") or "").strip()
        b_guid = str(clash.get("Pour B GUID") or clash.get("b_global_id", "") or "").strip()
        if not a_guid or not b_guid:
            continue

        a_rec = guid_to_rec.get(a_guid)
        b_rec = guid_to_rec.get(b_guid)
        if not a_rec or not b_rec:
            continue

        # Never sequence pours across different buildings.
        if not _same_building(a_rec, b_rec):
            continue

        candidates = []

        # Removable elements should be installed last relative to clashing pours.
        if _is_removable(a_rec) and not _is_removable(b_rec):
            candidates.append((b_guid, a_guid))
        elif _is_removable(b_rec) and not _is_removable(a_rec):
            candidates.append((a_guid, b_guid))

        # General rule: except for heavy precast, lower pours must finish before upper pours start.
        if not _is_heavy_precast(a_rec) and not _is_heavy_precast(b_rec):
            relation = _vertical_relation(a_rec, b_rec)
            if relation == -1:
                if _plausible_vertical_pair(a_rec, b_rec) and not _is_stage2_pedestal(a_rec):
                    candidates.append((a_guid, b_guid))
            elif relation == 1:
                if _plausible_vertical_pair(b_rec, a_rec) and not _is_stage2_pedestal(b_rec):
                    candidates.append((b_guid, a_guid))

        # Keep existing slab support behavior for near-touching structural supports.
        if _is_supported_slab(a_rec) and _is_underneath(b_rec, a_rec) and not _is_stage2_pedestal(b_rec):
            candidates.append((b_guid, a_guid))
        if _is_supported_slab(b_rec) and _is_underneath(a_rec, b_rec) and not _is_stage2_pedestal(a_rec):
            candidates.append((a_guid, b_guid))

        # A landing is cast before the stair flights that meet it (a stair follows its landing, as it
        # follows its slab). Elevations of a landing and its flights overlap, so the vertical rules above
        # cannot order them: this pair rule replaces them.
        a_ptype, b_ptype = _normalized_pour_type(a_rec), _normalized_pour_type(b_rec)
        if "LANDING" in a_ptype and "STAIR" in b_ptype:
            candidates = [(a_guid, b_guid)]
        elif "LANDING" in b_ptype and "STAIR" in a_ptype:
            candidates = [(b_guid, a_guid)]

        for pred_guid, slab_guid in candidates:
            pred_rec = guid_to_rec.get(pred_guid, {})
            succ_rec = guid_to_rec.get(slab_guid, {})

            # Heavy precast should not drive general pour sequencing,
            # except when forcing removable elements to the end.
            if _is_heavy_precast(pred_rec) and not _is_removable(succ_rec):
                continue

            pred_task = _final_task_for_guid(pred_guid)
            succ_task = _start_task_for_guid(slab_guid)
            if not pred_task or not succ_task or pred_task == succ_task:
                continue
            pair = (pred_task, succ_task)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            predecessors[succ_task].append(pred_task)

    return predecessors


def _build_stair_step_predecessors(activities):
    """Stair steps (small in-situ stair pours linked by core/stair_steps.py to the flight they touch) are
    cast after that flight: the flight's Concrete precedes the step's first task."""
    tasks = defaultdict(dict)
    recs = {}
    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        recs[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        if phase and act.get("task_id"):
            tasks[guid][phase] = act["task_id"]

    predecessors = defaultdict(list)
    for guid, rec in recs.items():
        parent = rec.get("stair_parent")
        if not parent:
            continue
        parent_guid = str(getattr(parent.get("element"), "GlobalId", "") or "").strip()
        if not parent_guid or parent_guid == guid or parent_guid not in tasks:
            continue
        flight = tasks[parent_guid]
        step = tasks.get(guid, {})
        pred = flight.get("Concrete") or flight.get("Stitching") or (list(flight.values())[-1] if flight else None)
        succ = step.get("Rebar") or (next(iter(step.values())) if step else None)
        if pred and succ and pred != succ:
            predecessors[succ].append(pred)
    return predecessors


def _build_level_gate_predecessors(activities):
    """
    Enforce level progression per building: start tasks in an upper level
    depend on final tasks from the nearest lower level.

    With LEVEL_GATE_SLABS_ONLY (default), only the upper level's SLAB pours
    are gated this way — every other pour type follows its own slab via the
    clash-derived slab-support edges, so Rebar/Precast-Installation tasks no
    longer each carry the entire lower level's finals as predecessors.
    """
    if not activities or not ENABLE_LEVEL_GATE:
        return {}

    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)

    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id

    def _final_task_for_guid(guid):
        task_map = guid_to_tasks.get(guid, {})
        return (
            _concrete_done_task(task_map)
            or task_map.get("Rebar, Formwork and Concrete")
            or task_map.get("Stitching")
            or task_map.get("Installation")
            or next(iter(task_map.values()), None)
        )

    def _start_task_for_guid(guid):
        task_map = guid_to_tasks.get(guid, {})
        rec = guid_to_rec.get(guid, {})
        ptype = _normalized_pour_type(rec)

        if ptype in {"SLAB", "MAIN_SLAB", "LANDING"}:
            return (
                task_map.get("Decking")
                or task_map.get("Under Slab")
                or task_map.get("Works before slab")
                or task_map.get("Rebar")
                or task_map.get("Concrete")
                or next(iter(task_map.values()), None)
            )

        return (
            task_map.get("Rebar")
            or task_map.get("Propping")
            or task_map.get("Installation")
            or task_map.get("Formwork")
            or task_map.get("EP+FWK")
            or task_map.get("Concrete")
            or task_map.get("Stitching")
            or next(iter(task_map.values()), None)
        )

    by_building_level = defaultdict(lambda: defaultdict(set))
    for guid, rec in guid_to_rec.items():
        building = str(rec.get("building", "") or "").strip().upper()
        if not building:
            continue
        try:
            level = int(rec.get("level_int", 0) or 0)
        except:
            level = 0
        by_building_level[building][level].add(guid)

    predecessors = defaultdict(list)
    seen_pairs = set()

    for building, level_map in by_building_level.items():
        levels = sorted(level_map.keys())
        for idx in range(1, len(levels)):
            upper_level = levels[idx]
            lower_level = levels[idx - 1]

            if LEVEL_GATE_DECKING_CONCRETE_ONLY:
                # Decking only needs the level below actually cast: its pure
                # "Concrete" phase tasks, and nothing from a stage-2 pour
                # (box-outs etc. are sequenced separately and would otherwise
                # drag the slab above down to their late finish).
                lower_finals = [
                    (guid, _concrete_done_task(guid_to_tasks.get(guid, {})))
                    for guid in level_map.get(lower_level, set())
                    if not _is_stage2(guid_to_rec.get(guid, {}))
                ]
            else:
                lower_finals = [
                    (guid, _final_task_for_guid(guid)) for guid in level_map.get(lower_level, set())
                    if not _is_stage2_pedestal(guid_to_rec.get(guid, {}))
                ]
            lower_finals = [(g, t) for g, t in lower_finals if t]
            if not lower_finals:
                continue

            upper_guids = level_map.get(upper_level, set())
            if LEVEL_GATE_SLABS_ONLY:
                upper_guids = [
                    guid for guid in upper_guids
                    if _normalized_pour_type(guid_to_rec.get(guid, {})) in {"SLAB", "MAIN_SLAB"}
                ]

            upper_starts = [(guid, _start_task_for_guid(guid)) for guid in upper_guids]
            upper_starts = [(g, t) for g, t in upper_starts if t]

            def _footprint(guid):
                element = guid_to_rec.get(guid, {}).get("element")
                return get_plan_footprint(element) if element is not None else None

            for succ_guid, succ_task in upper_starts:
                slab_fp = _footprint(succ_guid) if LEVEL_GATE_MAX_DISTANCE_M else None
                if slab_fp is None:
                    near = [t for _g, t in lower_finals]
                else:
                    near, measured = [], []
                    for g, t in lower_finals:
                        fp = _footprint(g)
                        if fp is None:
                            near.append(t)  # can't measure: keep it
                            continue
                        # 3D gap between the two: plan gap and vertical gap (0 when they overlap in height).
                        plan_gap = slab_fp[0].distance(fp[0])
                        z_gap = max(0.0, fp[1] - slab_fp[2], slab_fp[1] - fp[2])
                        gap = math.hypot(plan_gap, z_gap)
                        measured.append((gap, t))
                        if gap <= LEVEL_GATE_MAX_DISTANCE_M:
                            near.append(t)
                    # Nothing close enough: fall back to the nearest lower pour so the slab is still gated.
                    if not near and measured:
                        near = [min(measured, key=lambda m: m[0])[1]]
                for pred_task in near:
                    if pred_task == succ_task:
                        continue
                    pair = (pred_task, succ_task)
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    predecessors[succ_task].append(pred_task)

    return predecessors


def _build_heavy_precast_wall_predecessors_from_clashes(activities, clash_results):
    """Sequences a Heavy Precast pour against the wall(s) it lands on, per
    the CWA rule:
      A) the wall(s) under the precast get their Rebar in first, THEN the
         precast lands on its temporary Propping;
      B) those walls' concrete is part of the SAME stitching stage (unless
         a drawing says otherwise, e.g. 2nd-stage box-outs — those are the
         conc_stage=="2" walls this same clash identifies as "under" too,
         handled separately below rather than excluded, since real data
         shows them clashing/classifying as under the precast exactly like
         stage-1 walls do);
      C) once that wall concrete reaches strength, Propping can come down —
         modeled as a fixed-duration Curing activity on the precast's own
         chain (see PRECAST_CURING_DEFINITION), gated by the wall's
         Concrete finishing, that Propping Removal then follows;
      D) conc_stage=="2" walls under the precast (box-outs etc.) are NOT
         part of the Installation/Stitching sequence at all — they're an
         independent Rebar->Concrete pour that only starts once Propping
         Removal is done (the props are physically in the way until then).

    "Under" is decided by core.clash_position.classify_vertical_position
    (Definitely/Majority Below), reusing the same clash pairs already
    computed for the Group Clashes/Clash Relations Excel sheets — no new
    geometry pass.

    Returns {successor_task_id: [predecessor_task_id, ...]} — same shape as
    the other _build_*_predecessors_from_clashes helpers, to be merged into
    intra_predecessors alongside them.
    """
    if not activities or not clash_results:
        return {}

    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)
    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id

    def _is_heavy_precast(rec):
        ptype = _normalized_pour_type(rec)
        gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
        return ptype == "HEAVY_PRECAST" or gtype == "HEAVY_PRECAST"

    def _is_wall(rec):
        return "WALL" in _normalized_pour_type(rec)

    def _same_building(rec_a, rec_b):
        return str(rec_a.get("building", "") or "").strip().upper() == str(rec_b.get("building", "") or "").strip().upper()

    predecessors = defaultdict(list)
    seen_pairs = set()

    for clash in clash_results:
        a_guid = str(clash.get("Pour A GUID") or clash.get("a_global_id", "") or "").strip()
        b_guid = str(clash.get("Pour B GUID") or clash.get("b_global_id", "") or "").strip()
        if not a_guid or not b_guid:
            continue

        a_rec = guid_to_rec.get(a_guid)
        b_rec = guid_to_rec.get(b_guid)
        if not a_rec or not b_rec:
            continue

        if _is_heavy_precast(a_rec) and _is_wall(b_rec):
            precast_guid, wall_guid = a_guid, b_guid
            precast_rec, wall_rec = a_rec, b_rec
        elif _is_heavy_precast(b_rec) and _is_wall(a_rec):
            precast_guid, wall_guid = b_guid, a_guid
            precast_rec, wall_rec = b_rec, a_rec
        else:
            continue

        if not _same_building(precast_rec, wall_rec):
            continue

        position = classify_vertical_position(precast_rec, wall_rec)
        if position not in (DEFINITELY_BELOW, MAJORITY_BELOW):
            continue

        pair = (precast_guid, wall_guid)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        precast_tasks = guid_to_tasks.get(precast_guid, {})
        wall_tasks = guid_to_tasks.get(wall_guid, {})
        wall_stage = str(wall_rec.get("conc_stage", "") or "").strip()

        if wall_stage == "2":
            # D) stage-2 walls (box-outs etc.) sit outside the
            # Installation/Stitching sequence entirely — they just can't
            # start until the props physically holding the precast are gone.
            propping_removal_task = precast_tasks.get("Propping Removal")
            wall_rebar_task = wall_tasks.get("Rebar")
            if propping_removal_task and wall_rebar_task:
                predecessors[wall_rebar_task].append(propping_removal_task)
            continue

        installation_task = precast_tasks.get("Installation")
        stitching_task = precast_tasks.get("Stitching")
        curing_task = precast_tasks.get("Curing")
        wall_rebar_task = wall_tasks.get("Rebar") or wall_tasks.get("Formwork")
        wall_concrete_task = wall_tasks.get("Concrete")

        # A) wall rebar must be in before the precast lands.
        if wall_rebar_task and installation_task:
            predecessors[installation_task].append(wall_rebar_task)

        # B) wall concrete only after stitching (same stage as the precast's own).
        if stitching_task and wall_concrete_task:
            predecessors[wall_concrete_task].append(stitching_task)

        # C) Propping (Curing's own successor) only after the wall concrete cures.
        if wall_concrete_task and curing_task:
            predecessors[curing_task].append(wall_concrete_task)

    return predecessors


def _open_ended_tasks(activities, adjacency):
    """The task ids with no successor yet. A Curing that does not hold back what follows (SLAB_CURING_GATES_SUCCESSORS off, and not a chain row
    marked "gates") is looked through: it is the Concrete before it that is open-ended when nothing but that Curing follows it, so a pour
    with a Curing is tied to the slab above (and the rest of the open-end logic) as it was without one."""
    open_tasks = {a.get("task_id") for a in activities if a.get("task_id") and not adjacency.get(a.get("task_id"))}
    if SLAB_CURING_GATES_SUCCESSORS:
        return open_tasks
    gates = _rules_active().gate_tasks
    by_pour = defaultdict(dict)
    for act in activities:
        element = (act.get("rec") or {}).get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        phase = str(act.get("phase", "") or "").strip()
        if guid and phase and act.get("task_id"):
            by_pour[guid][phase] = act["task_id"]
    for tasks in by_pour.values():
        curing, concrete = tasks.get("Curing"), tasks.get("Concrete")
        if not curing or not concrete or curing in gates or curing not in open_tasks:
            continue
        open_tasks.discard(curing)
        if set(adjacency.get(concrete) or ()) <= {curing}:
            open_tasks.add(concrete)
    return open_tasks


def _build_open_end_successors(activities, open_tasks):
    """Finds the next thing in the sequence for activities left with no successor, so they are not all
    dumped on the building's completion milestone.

    An open-ended pour (e.g. a Removable Element's Stitching, a double-height wall's Concrete) precedes
    the start of the SLAB sitting on it: the slab in the same building whose soffit is at or above the
    pour's top and within OPEN_END_MAX_DISTANCE_M of it (plan gap and vertical gap, as in the level gate).
    A pour with no slab above it (the roof, a pit) stays open for the close-out.

    `open_tasks` is the set of task ids with no successor yet. Returns {pred_task_id: [succ_task_id, ...]}."""
    if not activities or not open_tasks or not ENABLE_OPEN_END_SEQUENCING:
        return {}

    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)
    task_guid = {}
    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id
            task_guid[task_id] = guid

    def _building(rec):
        return str(rec.get("building", "") or "").strip().upper()

    def _start_task(guid):
        tasks = guid_to_tasks.get(guid, {})
        return (
            tasks.get("Decking")
            or tasks.get("Under Slab")
            or tasks.get("Works before slab")
            or tasks.get("Rebar")
            or tasks.get("Concrete")
            or next(iter(tasks.values()), None)
        )

    footprints = {}

    def _footprint(guid):
        if guid not in footprints:
            element = guid_to_rec.get(guid, {}).get("element")
            footprints[guid] = get_plan_footprint(element) if element is not None else None
        return footprints[guid]

    slabs_by_building = defaultdict(list)
    for guid, rec in guid_to_rec.items():
        if _normalized_pour_type(rec) in {"SLAB", "MAIN_SLAB"} and not _is_stage2(rec):
            slabs_by_building[_building(rec)].append(guid)

    successors = defaultdict(list)
    for task_id in open_tasks:
        guid = task_guid.get(task_id)
        rec = guid_to_rec.get(guid) if guid else None
        if rec is None or _normalized_pour_type(rec) in {"SLAB", "MAIN_SLAB"}:
            continue  # slabs are sequenced by the level gate; the roof slab really is the end
        fp = _footprint(guid)
        if fp is None:
            continue
        above = []  # (gap, start task) of the slabs above this pour
        for slab_guid in slabs_by_building.get(_building(rec), []):
            slab_fp = _footprint(slab_guid)
            if slab_fp is None or slab_fp[1] < fp[2] - 0.05:
                continue  # not above this pour
            start = _start_task(slab_guid)
            if start:
                above.append((math.hypot(fp[0].distance(slab_fp[0]), max(0.0, slab_fp[1] - fp[2])), start))
        near = [start for gap, start in above if gap <= OPEN_END_MAX_DISTANCE_M]
        if near:
            successors[task_id].extend(near)
        elif above and OPEN_END_NEAREST_SLAB_FALLBACK:
            successors[task_id].append(min(above, key=lambda a: a[0])[1])
    return successors


def _build_heavy_precast_open_end_predecessors(activities, clash_results, existing_edges):
    """Ties off the loose ends a Heavy Precast's chain can be left with once
    every other rule has run:

      * Propping (the chain's start) with NO predecessor — the props stand on
        what is under the precast, so it follows the supporting structure
        found by the clash check (same "under" test as the wall rule): a wall's
        Rebar (the props go in once the wall is reinforced, like Installation),
        any other pour's final task (e.g. a slab's Concrete).
      * Propping Removal (the chain's end) with NO successor — it precedes the
        start of the pour(s) found sitting above the precast.

    Only a task that really has nothing is touched, so every link another rule
    (or the user's SequenceOrder / Relations) gives is kept. `existing_edges` is
    {successor_task_id: [predecessor_task_id, ...]} merged from those rules.
    Anything that would close a logic loop is dropped later by the cycle guard.

    Returns {successor_task_id: [predecessor_task_id, ...]}."""
    if not activities or not clash_results:
        return {}

    has_pred = {succ for succ, preds in existing_edges.items() if preds}
    has_succ = {pred for preds in existing_edges.values() for pred in preds}

    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)
    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "") or "").strip() if element else ""
        if not guid:
            continue
        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "") or "").strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id

    def _is_heavy_precast(rec):
        ptype = _normalized_pour_type(rec)
        gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
        return ptype == "HEAVY_PRECAST" or gtype == "HEAVY_PRECAST"

    def _building(rec):
        return str(rec.get("building", "") or "").strip().upper()

    def _final_task(guid):
        tasks = guid_to_tasks.get(guid, {})
        return (
            tasks.get("Concrete")
            or tasks.get("Rebar, Formwork and Concrete")
            or tasks.get("Stitching")
            or tasks.get("Installation")
            or next(iter(tasks.values()), None)
        )

    def _start_task(guid):
        tasks = guid_to_tasks.get(guid, {})
        return (
            tasks.get("Rebar")
            or tasks.get("Decking")
            or tasks.get("Under Slab")
            or tasks.get("Works before slab")
            or tasks.get("Propping")
            or tasks.get("Installation")
            or tasks.get("Formwork")
            or tasks.get("EP+FWK")
            or tasks.get("Concrete")
            or tasks.get("Stitching")
            or next(iter(tasks.values()), None)
        )

    predecessors = defaultdict(list)
    seen_pairs = set()

    def _add(pred_task, succ_task):
        if not pred_task or not succ_task or pred_task == succ_task or (pred_task, succ_task) in seen_pairs:
            return
        seen_pairs.add((pred_task, succ_task))
        predecessors[succ_task].append(pred_task)

    for clash in clash_results:
        a_guid = str(clash.get("Pour A GUID") or clash.get("a_global_id", "") or "").strip()
        b_guid = str(clash.get("Pour B GUID") or clash.get("b_global_id", "") or "").strip()
        a_rec = guid_to_rec.get(a_guid)
        b_rec = guid_to_rec.get(b_guid)
        if not a_rec or not b_rec or _building(a_rec) != _building(b_rec):
            continue

        for precast_guid, precast_rec, other_guid, other_rec in (
            (a_guid, a_rec, b_guid, b_rec),
            (b_guid, b_rec, a_guid, a_rec),
        ):
            if not _is_heavy_precast(precast_rec) or _is_heavy_precast(other_rec):
                continue
            precast_tasks = guid_to_tasks.get(precast_guid, {})
            propping = precast_tasks.get("Propping")
            removal = precast_tasks.get("Propping Removal")
            position = classify_vertical_position(precast_rec, other_rec)  # where the OTHER pour sits

            if position in (DEFINITELY_BELOW, MAJORITY_BELOW) and propping and propping not in has_pred:
                other_tasks = guid_to_tasks.get(other_guid, {})
                if "WALL" in _normalized_pour_type(other_rec):
                    _add(other_tasks.get("Rebar") or other_tasks.get("Formwork") or _final_task(other_guid), propping)
                else:
                    _add(_final_task(other_guid), propping)
            elif position in (DEFINITELY_ABOVE, MAJORITY_ABOVE) and removal and removal not in has_succ:
                _add(removal, _start_task(other_guid))

    return predecessors


def _xml_zone_label(rec):
    if rec.get("is_disconnected", False):
        return "Disconnected Zone"
    if rec.get("is_connected", False):
        return "Connected Zone"
    zone_text = str(rec.get("building_zone", "") or "").strip().upper()
    if "DISCONNECTED" in zone_text:
        return "Disconnected Zone"
    if "CONNECTED" in zone_text:
        return "Connected Zone"
    return "Unzoned"


def _xml_zone_sort_rank(rec):
    if rec.get("is_disconnected", False):
        return 0
    if rec.get("is_connected", False):
        return 1
    zone_text = str(rec.get("building_zone", "") or "").strip().upper()
    if "DISCONNECTED" in zone_text:
        return 0
    if "CONNECTED" in zone_text:
        return 1
    return 2


def _zone_bucket(rec):
    zone_text = str(rec.get("building_zone", "") or "").strip().upper()
    if "DISCONNECTED" in zone_text or rec.get("is_disconnected", False):
        return "DISCONNECTED"
    if "CONNECTED" in zone_text or rec.get("is_connected", False):
        return "CONNECTED"
    return "OTHER"


def _is_cross_zone_link(rec_a, rec_b):
    zone_a = _zone_bucket(rec_a or {})
    zone_b = _zone_bucket(rec_b or {})
    if zone_a not in {"DISCONNECTED", "CONNECTED"}:
        return False
    if zone_b not in {"DISCONNECTED", "CONNECTED"}:
        return False
    return zone_a != zone_b


def _wbs_type_sort_rank(rec):
    ptype = _normalized_pour_type(rec)
    if "WALL" in ptype:
        return 1 if rec.get("is_external", False) else 2
    if "SLAB" in ptype or "MAIN_SLAB" in ptype:
        return 3
    if "LANDING" in ptype: return 4
    if "PEDESTAL" in ptype: return 5
    if "HEAVY_PRECAST" in ptype: return 6
    if "STAIR" in ptype: return 7
    if "REMOVABLE" in ptype: return 8
    if "BEAM" in ptype: return 9
    if "PARAPET" in ptype: return 10
    if "RAFT" in ptype: return 11
    if "COLUMN" in ptype: return 12
    return 99


def _phase_sort_rank(phase):
    phase_upper = str(phase or "").strip().upper()
    priority = {"REBAR": 1, "FORMWORK": 2, "DECKING": 2, "EP+FWK": 2, "CONCRETE": 3, "REBAR, FORMWORK AND CONCRETE": 3}
    return priority.get(phase_upper, 99)


def _xml_level_label(rec):
    level_int_raw = rec.get("level_int")
    if level_int_raw is None:
        level_int_raw = _parse_level_int(rec.get("level_display", rec.get("level_code", "")))
    try:
        return f"Level {int(level_int_raw)}"
    except:
        level_display = str(rec.get("level_display", rec.get("level_code", "Unknown")) or "Unknown").strip()
        return level_display if level_display.upper().startswith("LEVEL ") else f"Level {level_display}"


def _activity_level_code(rec):
    level_int_raw = rec.get("level_int")
    if level_int_raw is None:
        level_int_raw = _parse_level_int(rec.get("level_display", rec.get("level_code", "")))

    try:
        return f"L{int(level_int_raw)}"
    except:
        pass

    level_code = str(rec.get("level_code", "") or "").strip().upper()
    if level_code:
        match = re.match(r"^L0*(\d+)$", level_code)
        if match:
            return f"L{int(match.group(1))}"
        return level_code

    parsed_level = _parse_level_int(rec.get("level_display", ""))
    return f"L{parsed_level}"


def _parse_level_int(level_value):
    if not level_value:
        return 0
    import re
    match = re.search(r"[-+]?\d+", str(level_value).strip())
    return int(match.group(0)) if match else 0


def _phase_to_wall_sub_wbs_name(phase_value):
    phase = str(phase_value or "").strip().upper()
    if phase == "REBAR": return "Rebar"
    if phase in {"FORMWORK", "DECKING", "EP+FWK"}: return "Formwork"
    if phase == "CONCRETE": return "Concrete"
    return ""


# ====================== MAIN FUNCTIONS ======================

def create_p6_xml_root():
    root = ET.Element("APIBusinessObjects", {
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xmlns": "http://xmlns.oracle.com/Primavera/P6/V7/API/BusinessObjects",
        "xsi:schemaLocation": "http://xmlns.oracle.com/Primavera/P6/V7/API/BusinessObjects http://xmlns.oracle.com/Primavera/P6/V7/API/p6apibo.xsd"
    })
    return root


def add_currency(root):
    currency = ET.SubElement(root, "Currency")
    for k, v in [("DecimalPlaces", "2"), ("DecimalSymbol", "Period"), ("DigitGroupingSymbol", "Comma"),
                 ("ExchangeRate", "1"), ("Id", "USD"), ("Name", "US Dollar"),
                 ("NegativeSymbol", "(#1.1)"), ("ObjectId", "1"), ("PositiveSymbol", "#1.1"), ("Symbol", "$")]:
        ET.SubElement(currency, k).text = v


def _add_calendar(root, object_id, name, hours_per_week, weekday_windows, hours_per_day=8.0):
    cal = ET.SubElement(root, "Calendar")
    ET.SubElement(cal, "BaseCalendarObjectId").set("xsi:nil", "true")
    for k, v in [("HoursPerDay", str(float(hours_per_day))), ("HoursPerMonth", str(hours_per_week * 52.0 / 12.0)),
                 ("HoursPerWeek", str(hours_per_week)), ("HoursPerYear", str(hours_per_week * 52.0)),
                 ("Name", name), ("ObjectId", object_id),
                 ("ProjectObjectId", None), ("Type", "Global")]:
        if v is None:
            ET.SubElement(cal, k).set("xsi:nil", "true")
        else:
            ET.SubElement(cal, k).text = v

    sww = ET.SubElement(cal, "StandardWorkWeek")
    for day, start, finish in weekday_windows:
        wh = ET.SubElement(sww, "StandardWorkHours")
        ET.SubElement(wh, "DayOfWeek").text = day
        if start and finish:
            wt = ET.SubElement(wh, "WorkTime")
            ET.SubElement(wt, "Start").text = start
            ET.SubElement(wt, "Finish").text = finish
        else:
            ET.SubElement(wh, "WorkTime").set("xsi:nil", "true")


def add_detailed_calendar(root):
    """Writes the programme's calendars: the scenario's (Rules > Calendars), or the generator's own two (core/calendars.py:
    "CWA 6d Calendar", Mon-Fri 09:00-17:00 for every activity, and "CWA 7d Curing Calendar", every day, for Curing, so a 28-day
    cure elapses 28 actual days). A window is a true hours-per-day span (09:00-17:00 for 8 h), matching how duration_hours is
    derived from duration_days (days x hours per day) in write_activities_and_relationships; a window a minute short of a
    full day made every whole-day-multiple duration overflow a minute into the next calendar day when CPM-scheduled."""
    for calendar in _calendars.active().items:
        _add_calendar(root, calendar.oid, calendar.name, calendar.hours_per_week, calendar.xml_windows(), calendar.hours_per_day)


def add_udf_types(root):
    for oid, title, data_type in [
        ("1", "FullPourID", "Text"),
        ("2", "CWA-Element ID", "Text"),
        ("3", "CWA-Quantity", "Double"),
        ("4", "CWA-Unit and Building", "Text"),
        ("5", "CWA-Unit", "Text"),
        ("6", "CWA-Building", "Text"),
        ("7", ALT_POUR_ID_PROP, "Text"),
        ("8", "CWA-Class", "Text"),
        ("9", "CWA-Class Name", "Text"),
        ("10", "CWA-Rate", "Double"),
        ("11", "CWA-Rate Unit", "Text"),
        ("12", "CWA-Rate Basis", "Text"),
        ("13", "CWA-Measured", "Text"),
    ]:
        udf = ET.SubElement(root, "UDFType")
        ET.SubElement(udf, "ObjectId").text = oid
        ET.SubElement(udf, "Title").text = title
        ET.SubElement(udf, "DataType").text = data_type
        ET.SubElement(udf, "IsSecureCode").text = "0"
        ET.SubElement(udf, "SubjectArea").text = "Activity"


def add_activity_code_types(root):
    for seq, (oid, title) in enumerate([("1", "CWA-Unit"), ("2", "CWA-Building"), ("3", "CWA-Level")]):
        code_type = ET.SubElement(root, "ActivityCodeType")
        eps_oid = ET.SubElement(code_type, "EPSObjectId")
        eps_oid.set("xsi:nil", "true")
        ET.SubElement(code_type, "IsSecureCode").text = "0"
        ET.SubElement(code_type, "Length").text = "40"
        ET.SubElement(code_type, "Name").text = title
        ET.SubElement(code_type, "ObjectId").text = oid
        ET.SubElement(code_type, "ProjectObjectId").text = "1"
        ET.SubElement(code_type, "RefProjectObjectIds")
        ET.SubElement(code_type, "Scope").text = "Project"
        ET.SubElement(code_type, "SequenceNumber").text = str(seq)


def add_project_and_calendar(root, building_code="DEFAULT", project_wbs_object_id=None, project_id=None):
    add_currency(root)
    add_detailed_calendar(root)
    add_udf_types(root)
    add_activity_code_types(root)

    resolved_root_oid = _resolve_building_root_object_id(building_code) if project_wbs_object_id is None else int(project_wbs_object_id)
    resolved_project_id = str(project_id) if project_id is not None else str(resolved_root_oid)

    try:
        project_prefix = str(WBS_PREFIX or "{BUILDING_CODE}").format(BUILDING_CODE=str(building_code or "DEFAULT"))
    except Exception:
        project_prefix = str(WBS_PREFIX or "{BUILDING_CODE}")

    project = ET.SubElement(root, "Project")
    for k, v in [("ObjectId", "1"), ("Id", resolved_project_id), ("Name", f"{project_prefix} - Construction"),
                 ("Status", "Active"), ("PlannedStartDate", START_DATE.strftime("%Y-%m-%dT00:00:00")),
                 ("DataDate", START_DATE.strftime("%Y-%m-%dT00:00:00")),
                 ("ActivityDefaultCalendarObjectId", _calendars.active().default.oid), ("WBSObjectId", str(resolved_root_oid))]:
        ET.SubElement(project, k).text = v
    ET.SubElement(project, "GUID").text = str(uuid.uuid4()).upper()


def add_resources(root):
    """Materials <project>-C (concrete, m³) and <project>-R (rebar, t), plus one Labor
    resource per Trade rule (<project>-L-<code>), whose max
    units/time is the trade's site capacity in people (P6 stores labour
    units/time as hours per hour, so 1 person = 1). Returns {Id: ObjectId}."""
    specs = [(f"{PROJECT_SHORT}-C", "Concrete (m3)", "Material", 0.125), (f"{PROJECT_SHORT}-R", "Rebar (t)", "Material", 0.125)]
    for code, trade in labour_trades().items():
        specs.append((labour_resource_id(code), trade["name"], "Labor", float(trade.get("capacity") or 0)))

    ids = {}
    for oid, (rid, name, rtype, max_units) in enumerate(specs, start=1):
        r = ET.SubElement(root, "Resource")
        for k, v in [("ObjectId", str(oid)), ("Id", rid), ("Name", name), ("ResourceType", rtype),
                     ("CalendarObjectId", _calendars.active().default.oid), ("CurrencyObjectId", "1"), ("IsActive", "1"),
                     ("GUID", str(uuid.uuid4()).upper())]:
            ET.SubElement(r, k).text = v

        rate = ET.SubElement(root, "ResourceRate")
        ET.SubElement(rate, "EffectiveDate").text = "1970-01-02T00:00:00"
        ET.SubElement(rate, "MaxUnitsPerTime").text = str(max_units)
        ET.SubElement(rate, "ObjectId").text = str(oid)
        ET.SubElement(rate, "PricePerUnit").text = "0"
        ET.SubElement(rate, "ResourceObjectId").text = str(oid)
        ids[rid] = str(oid)
    return ids


def _build_group_milestones_and_summary(activities, wbs_manager):
    groups = defaultdict(lambda: {
        "concrete": [],
        "wbs_oid": None,
        "ptype": "",
        "is_disconnected": False,
        "is_connected": False,
        "building": "",
        "level_display": "",
        "zone_label": ""
    })

    for act in activities:
        rec = act.get("rec", {})
        ptype_raw = str(rec.get("pour_type", "")).upper().replace(" ", "_")
        group_ptype = "WALL" if "WALL" in ptype_raw else ("SLAB" if "SLAB" in ptype_raw or "MAIN_SLAB" in ptype_raw else ptype_raw)

        group_key = (
            str(rec.get("building", "")),
            str(rec.get("building_zone", "")).upper().replace("CONNECTED_HK", "CONNECTED").replace("CONNECTED_HL", "CONNECTED"),
            str(rec.get("level_display", "")),
            group_ptype
        )

        if act.get("phase") == "Concrete":
            groups[group_key]["concrete"].append(act.get("task_id"))

        if not groups[group_key]["wbs_oid"]:
            groups[group_key]["wbs_oid"] = act.get("wbs_oid")
            groups[group_key]["ptype"] = group_ptype
            groups[group_key]["is_disconnected"] = bool(rec.get("is_disconnected", False))
            groups[group_key]["is_connected"] = bool(rec.get("is_connected", False))
            groups[group_key]["building"] = str(rec.get("building", ""))
            groups[group_key]["level_display"] = str(rec.get("level_display", ""))
            groups[group_key]["zone_label"] = _xml_zone_label(rec)

    extra = []
    give_preds = defaultdict(list)

    for key, data in groups.items():
        if not data["concrete"]:
            continue

        ptype = data["ptype"]
        zone_label = data["zone_label"]

        if ptype == "WALL":
            display_type, prefix_type = "Walls", "WALL"
        elif ptype == "SLAB":
            display_type, prefix_type = "Slabs", "SLAB"
        else:
            display_type = str(ptype).title() + "s"
            prefix_type = str(ptype)[:4].upper() if ptype else "OTHER"

        zone_code = "D" if data["is_disconnected"] else "C" if data["is_connected"] else ""
        level_short = data["level_display"].replace("Level ", "L").replace("L0", "L")
        base_name = f"{data['building']} - {level_short} - {zone_label} - {display_type}"
        prefix = f"{data['building']}-{level_short}-{zone_code}-{prefix_type}"

        # === KEY CHANGE: Place GET/GIVE/Summary at Level level (one level up) ===
        level_wbs_name = f"{data['building']}_{zone_label}_{level_short}"   # or use actual level WBS name
        target_oid = data["wbs_oid"]  # fallback

        # Try to find Level WBS (more reliable)
        if hasattr(wbs_manager, 'get_parent_id_by_oid'):
            parent = wbs_manager.get_parent_id_by_oid(str(data["wbs_oid"]))
            if parent:
                target_oid = parent

        # GET
        extra.append({
            "task_id": f"{prefix}-GET",
            "task_name": f"{base_name} - GET",
            "wbs_oid": target_oid,
            "duration_days": 0,
            "milestone": True,
            "milestone_type": "Start",
            "rec": {}
        })

        # Summary
        extra.append({
            "task_id": f"{prefix}-SUM",
            "task_name": f"{base_name} - Summary",
            "wbs_oid": target_oid,
            "duration_days": 0,
            "summary": True,
            "rec": {}
        })

        # GIVE
        give_id = f"{prefix}-GIVE"
        extra.append({
            "task_id": give_id,
            "task_name": f"{base_name} - GIVE",
            "wbs_oid": target_oid,
            "duration_days": 0,
            "milestone": True,
            "milestone_type": "Finish",
            "rec": {}
        })

        give_preds[give_id] = data["concrete"]

    return extra, give_preds


def _get_sequence_phase_for_rec(rec):
    """Auto-select phase when not provided in SequenceOrder sheet."""
    if not rec:
        return "Rebar"

    ptype = _normalized_pour_type(rec)
    gtype = str(rec.get("general_pour_type", "") or "").upper()
    conc_stage = str(rec.get("conc_stage", "") or "").strip().upper()

    chain = _rules_active().chain_for(rec)
    if chain:
        return chain[0]["phase"]  # the first activity of the pour's chain (Rules > Chains)
    if "SLAB" in ptype or "MAIN_SLAB" in ptype:
        # For slabs, blank Phase should target the first executable slab task.
        return "Decking"
    elif "LANDING" in ptype:
        return "Decking"
    elif (
        (ptype in {"HEAVY_PRECAST", "REMOVABLE_ELEMENT"} or (ptype == "STAIR" and conc_stage == "PRECAST"))
        or "HEAVY_PRECAST" in gtype
        or "REMOVABLE" in ptype
        or "PRECAST" in ptype
    ):
        return "Installation"
    else:
        return "Rebar"


def _build_sequence_order_relationships(activities, sequence_order_list):
    if not sequence_order_list:
        return {}

    # Build lookup: GUID → rec + tasks by phase
    guid_to_rec = {}
    guid_to_tasks = defaultdict(dict)
    guid_last = {}

    for act in activities:
        rec = act.get("rec", {})
        element = rec.get("element")
        guid = str(getattr(element, "GlobalId", "")).strip() if element else ""
        if not guid:
            continue

        guid_to_rec[guid] = rec
        phase = str(act.get("phase", "")).strip()
        task_id = act.get("task_id")
        if phase and task_id:
            guid_to_tasks[guid][phase] = task_id
            order = act.get("phase_order", 0)
            if guid not in guid_last or order >= guid_last[guid][0]:
                guid_last[guid] = (order, task_id)

    def _final_task(guid):
        """What a pour's successors wait for: the activity its chain marks as gating, else its Concrete (or Curing when that holds back what
        follows), else its last activity (the same as the slab-support and contact links take it)."""
        task_map = guid_to_tasks.get(guid, {})
        return (
            _concrete_done_task(task_map)
            or task_map.get("Rebar, Formwork and Concrete")
            or task_map.get("Stitching")
            or task_map.get("Installation")
            or (guid_last.get(guid) or (0, None))[1]
        )

    def _task_for_named_phase(task_map, phase_value):
        phase_value = str(phase_value or "").strip()
        if not task_map:
            return None
        if phase_value and phase_value in task_map:
            return task_map[phase_value]

        combined_task = task_map.get("Rebar, Formwork and Concrete")

        normalized = phase_value.upper()
        if normalized in {"FORMWORK", "EP+FWK", "FWK", "F"}:
            return task_map.get("Formwork") or task_map.get("EP+FWK") or combined_task
        if normalized in {"WORKS BEFORE SLAB", "WORKS_BEFORE_SLAB", "ALL"}:
            return task_map.get("Works before slab")
        if normalized in {"UNDER SLAB", "UNDER_SLAB"}:
            return task_map.get("Under Slab")
        if normalized in {"EOP ON SLAB", "EOP_ON_SLAB", "E2"}:
            return task_map.get("EOP on Slab")
        if normalized == "DECKING":
            return task_map.get("Decking")
        if normalized == "CONCRETE":
            return task_map.get("Concrete") or combined_task
        if normalized == "REBAR":
            return task_map.get("Rebar") or combined_task
        if normalized == "INSTALLATION":
            return task_map.get("Installation")
        if normalized in {"PRECAST INSTALLATION", "INSTALL", "INSTALLATION PHASE", "I"}:
            return task_map.get("Installation")
        if normalized in {"STITCHING", "PRECAST STITCHING"}:
            return task_map.get("Stitching")

        return None

    def _resolve_task_for_phase(task_map, phase_value):
        """The pour's activity a sequence row points at: the phase it names, else (a precast pour has only its Installation, a phase the rows
        do not name is not in the chain) the pour's first one. A pour is never left out of the sequence for lack of the phase."""
        if not task_map:
            return None
        return (
            _task_for_named_phase(task_map, phase_value)
            or task_map.get("Rebar, Formwork and Concrete") or task_map.get("Rebar") or task_map.get("Works before slab")
            or task_map.get("Installation") or task_map.get("Stitching") or next(iter(task_map.values()), None)
        )

    # Rows sharing the same Index value are one group, meant to start
    # together — every row after the group's first links to that first row
    # as StartToStart. Moving to the NEXT Index value (a new group) is a
    # real one-after-another step: FinishToStart from the previous group's
    # first row to the new group's first row, so the new group only starts
    # once the previous one has actually finished. (Previously this treated
    # every row as its own link in one flat chain regardless of repeated
    # Index values, which — combined with FS between every consecutive
    # pair — serialized the ENTIRE sequence end-to-end with no parallelism
    # at all; grouping by Index restores same-group simultaneity while
    # still gating group-to-group progression on real completion.)
    edges = []
    added_edges = set()
    added_ss = 0
    added_fs = 0

    ordered_items = []
    for pos, item in enumerate(sequence_order_list or []):
        idx = _safe_int(item.get("Index"))
        guid = str(item.get("GUID", "") or "").strip()
        if idx == 999999 or not guid:
            continue
        ordered_items.append((idx, pos, item))

    ordered_items.sort(key=lambda x: (x[0], x[1]))

    # Contiguous runs of equal Index (safe since already sorted by Index).
    groups = []
    current_idx = None
    current_group = []
    for idx, _pos, item in ordered_items:
        if idx != current_idx:
            if current_group:
                groups.append(current_group)
            current_group = []
            current_idx = idx
        current_group.append(item)
    if current_group:
        groups.append(current_group)

    def _resolve(item):
        guid = str(item.get("GUID", "") or "").strip()
        if guid not in guid_to_tasks:
            return None, guid, "missing_guid"
        phase = str(item.get("Phase", "") or "").strip()
        if not phase:
            phase = _get_sequence_phase_for_rec(guid_to_rec.get(guid))
        task_id = _resolve_task_for_phase(guid_to_tasks.get(guid, {}), phase)
        if not task_id:
            return None, guid, "unresolved_phase"
        return task_id, guid, None

    skipped_missing_guid = 0
    skipped_unresolved_phase = 0

    prev_group_first_task = None
    prev_group_first_guid = None
    prev_group_ends = []  # what the previous step's pours finish with: every one of them, not just the first
    prev_group_first_concrete = None
    lead_hours = max(0.0, float(SEQUENCE_LEAD_DAYS or 0)) * _HOURS_PER_DAY

    for group in groups:
        group_first_task = None
        group_first_guid = None
        rest_of_group = []  # (task_id, guid) for every OTHER distinct task in this group
        group_ends = []
        group_concretes = []

        for item in group:
            task_id, guid, err = _resolve(item)
            if err == "missing_guid":
                skipped_missing_guid += 1
                continue
            if err == "unresolved_phase":
                skipped_unresolved_phase += 1
                continue
            # A pour in the sequence ends with its final activity (concrete, or the curing that gates what follows) unless the row names a
            # phase: then the step is over when that activity is.
            end = task_id if str(item.get("Phase", "") or "").strip() else (_final_task(guid) or task_id)
            if end not in group_ends:
                group_ends.append(end)
            concrete = _resolve_task_for_phase(guid_to_tasks.get(guid, {}), "Concrete")
            if concrete and concrete not in group_concretes:
                group_concretes.append(concrete)
            if group_first_task is None:
                group_first_task, group_first_guid = task_id, guid
            elif task_id != group_first_task:
                rest_of_group.append((task_id, guid))

        if group_first_task is None:
            continue  # nothing usable in this group

        def _edge(pred, succ, kind, lag=0.0):
            if pred == succ:
                return False
            if (pred, succ, kind) in added_edges:
                return False
            edges.append((pred, succ, kind, lag) if lag else (pred, succ, kind))
            added_edges.add((pred, succ, kind))
            return True

        for task_id, _guid in rest_of_group:
            if _edge(group_first_task, task_id, "StartToStart"):
                added_ss += 1

        if SEQUENCE_FLOW:
            # The sequence is the order the work starts and the concrete is poured, not a relay: a step starts a set number of days after the
            # previous one starts, and its concrete waits for the previous step's. Each pour's own chain is not held back by the other steps.
            if prev_group_first_task is not None and _edge(prev_group_first_task, group_first_task, "StartToStart", lead_hours):
                added_ss += 1
            if group_concretes:
                first_concrete = group_concretes[0]
                for end in prev_group_ends:
                    if _edge(end, first_concrete, "FinishToStart"):
                        added_fs += 1
                for other in group_concretes[1:]:
                    if _edge(first_concrete, other, "StartToStart"):
                        added_ss += 1
        else:
            # Each step starts when the one before it is over: every pour of the previous step finished (finish-to-start into the step's
            # first activity; the others of the step start together with it, above). The user's sequence is deliberate, so no level check
            # here: a contradiction with an automatic link is settled on the automatic side (main.py's merge) and by _emit_relationship's
            # cycle guard.
            for end in prev_group_ends:
                if _edge(end, group_first_task, "FinishToStart"):
                    added_fs += 1

        prev_group_first_task, prev_group_first_guid = group_first_task, group_first_guid
        prev_group_ends = group_ends

    print(f"✅ Created {added_ss} SequenceOrder Start-to-Start + {added_fs} Finish-to-Start relationships")
    if skipped_missing_guid or skipped_unresolved_phase:
        print(
            f"⚠️ SequenceOrder rows skipped: missing GUID in activities={skipped_missing_guid}, "
            f"unresolved phase mapping={skipped_unresolved_phase}"
        )
    return edges

def _build_xml_wbs_manager_for_activities(activities):
    from core.wbs_manager import WBSManager

    primary_building = str(activities[0].get("rec", {}).get("building", "DEFAULT") or "DEFAULT") if activities else "DEFAULT"
    root_obj_id = _resolve_building_root_object_id(primary_building)
    # WBSManager increments before assign, so start one lower to make first WBS exactly root_obj_id.
    xml_wbs = WBSManager("XML", start_counter=root_obj_id - 1)

    ordered_activities = sorted(
        activities,
        key=lambda a: (
            str(a.get("rec", {}).get("building", "BLD")),
            _xml_zone_sort_rank(a.get("rec", {})),
            int(a.get("rec", {}).get("level_int", 0)),
            str(a.get("rec", {}).get("level_display", "")),
            _wbs_type_sort_rank(a.get("rec", {})),
            str(a.get("rec", {}).get("planning_proposed_pour_id", "")),
            _phase_sort_rank(a.get("phase", "")),
        )
    )

    building_zone_modes = defaultdict(set)
    for act in ordered_activities:
        rec = act.get("rec", {})
        building = str(rec.get("building", "BLD") or "BLD")
        zone_label = _xml_zone_label(rec)
        if zone_label in {"Connected Zone", "Disconnected Zone"}:
            building_zone_modes[building].add(zone_label)

    for act in ordered_activities:
        rec = act.get("rec", {})
        # A step cast with a stair flight is placed where that flight is (core/stair_steps.py).
        wrec = rec.get("stair_parent") if (_is_insitu_stair(rec) and rec.get("stair_parent")) else rec
        building = str(wrec.get("building", "BLD"))
        level_display = _xml_level_label(wrec)
        zone_label = _xml_zone_label(wrec)
        pour_type = _normalized_pour_type(rec)

        wbs_prefix = str(wrec.get("wbs_prefix", "") or "").strip()
        if not wbs_prefix:
            wbs_prefix = str(WBS_PREFIX or "").replace(f"-{PROJECT_SHORT}", "").replace(f"{PROJECT_SHORT}-", "").format(BUILDING_CODE=building)

        root_name = f"{wbs_prefix} - Construction"
        xml_wbs.register(root_name)

        has_split_zones = building_zone_modes.get(building, set()) == {"Connected Zone", "Disconnected Zone"}
        zone_segment = f"{zone_label} - " if has_split_zones else ""

        if has_split_zones:
            zone_name = f"{wbs_prefix} - {zone_label}"
            xml_wbs.register(zone_name, root_name)
            level_parent = zone_name
            level_name = f"{wbs_prefix} - {zone_label} - {level_display}"
        else:
            level_parent = root_name
            level_name = f"{wbs_prefix} - {level_display}"
        xml_wbs.register(level_name, level_parent)

        if "WALL" in pour_type:
            direction = "External" if rec.get("is_external", False) else "Internal"
            wall_group = f"{wbs_prefix} - {zone_segment}{level_display} - {direction} Walls"
            xml_wbs.register(wall_group, level_name)
            for sub in ["Rebar", "Formwork", "Concrete"]:
                xml_wbs.register(f"{wall_group} - {sub}", wall_group)

            phase = act.get("phase", "")
            if phase in ["Rebar", "Formwork", "Concrete"]:
                act["wbs_oid"] = xml_wbs.get_id(f"{wall_group} - {phase}")
            else:
                act["wbs_oid"] = xml_wbs.get_id(wall_group)
            continue

        if "LANDING" in pour_type:
            # Like a slab: Landings -> Landing <pour id>
            landing_group = f"{wbs_prefix} - {zone_segment}{level_display} - Landings"
            xml_wbs.register(landing_group, level_name)
            pid = str(rec.get("planning_proposed_pour_id", "") or "").strip()
            if pid:
                landing_leaf = f"{wbs_prefix} - {zone_segment}{level_display} - Landing {pid}"
                xml_wbs.register(landing_leaf, landing_group)
                act["wbs_oid"] = xml_wbs.get_id(landing_leaf)
            else:
                act["wbs_oid"] = xml_wbs.get_id(landing_group)
            continue

        if _is_insitu_stair(rec):
            # Its own group, split by phase like the walls: In-situ Stairs (or In-situ Stair Steps) -> Rebar / Formwork / Concrete
            stair_group = f"{wbs_prefix} - {zone_segment}{level_display} - {stair_group_label(rec)}"
            xml_wbs.register(stair_group, level_name)
            for sub in ["Rebar", "Formwork", "Concrete"]:
                xml_wbs.register(f"{stair_group} - {sub}", stair_group)
            phase = act.get("phase", "")
            if phase in ["Rebar", "Formwork", "Concrete"]:
                act["wbs_oid"] = xml_wbs.get_id(f"{stair_group} - {phase}")
            else:
                act["wbs_oid"] = xml_wbs.get_id(stair_group)
            continue

        if "SLAB" in pour_type or "MAIN_SLAB" in pour_type:
            slab_group = f"{wbs_prefix} - {zone_segment}{level_display} - Slabs"
            xml_wbs.register(slab_group, level_name)
            pid = str(rec.get("planning_proposed_pour_id", "") or "").strip()
            if pid:
                slab_leaf = f"{wbs_prefix} - {zone_segment}{level_display} - Slab {pid}"
                xml_wbs.register(slab_leaf, slab_group)
                act["wbs_oid"] = xml_wbs.get_id(slab_leaf)
            else:
                act["wbs_oid"] = xml_wbs.get_id(slab_group)
            continue

        if pour_type == "HEAVY_PRECAST" or str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper() == "HEAVY_PRECAST":
            # Its own group, one WBS per pour like the slabs: Heavy Precast -> Heavy Precast <pour id>
            # (Propping / Installation / Stitching / Curing / Propping Removal all sit in the pour's own WBS)
            precast_group = f"{wbs_prefix} - {zone_segment}{level_display} - Heavy Precast"
            xml_wbs.register(precast_group, level_name)
            pid = str(rec.get("planning_proposed_pour_id", "") or "").strip()
            if pid:
                precast_leaf = f"{wbs_prefix} - {zone_segment}{level_display} - Heavy Precast {pid}"
                xml_wbs.register(precast_leaf, precast_group)
                act["wbs_oid"] = xml_wbs.get_id(precast_leaf)
            else:
                act["wbs_oid"] = xml_wbs.get_id(precast_group)
            continue

        # (One raft per building: "Raft", not "Rafts".)
        raw_type = str(rec.get("pour_type", "") or "")
        type_name = title_case(raw_type.replace("_", " ")) + ("" if "RAFT" in raw_type.upper() else "s")
        group_name = f"{wbs_prefix} - {zone_segment}{level_display} - {type_name}"
        xml_wbs.register(group_name, level_name)
        act["wbs_oid"] = xml_wbs.get_id(group_name)

    return xml_wbs


def write_activities_and_relationships(root, activity_list, resources, wbs_manager,
                                       intra_predecessors=None,
                                       sequence_ss_predecessors=None,
                                       custom_relations=None,
                                       automatic_predecessor_sources=None,
                                       crew_table=None,
                                       rule_relations=None,
                                       late_rule_relations=None):
    """automatic_predecessor_sources: optional list of (label, predecessors_dict)
    pairs — e.g. [("level_gate", level_gate_predecessors), ("slab_support", ...),
    ("heavy_precast_wall", ...)] — for cross-pour edges inferred from
    geometry/clashes rather than stated explicitly (by the user, via
    SequenceOrder/Relations) or structurally (a pour's own intra-pour phase
    chain). These are emitted LAST and ARE the ones dropped whenever they'd
    conflict with anything emitted earlier — see the priority-order comment
    at RELATIONSHIPS below."""
    intra_predecessors = intra_predecessors or {}
    sequence_ss_predecessors = sequence_ss_predecessors or []
    custom_relations = custom_relations or []
    automatic_predecessor_sources = automatic_predecessor_sources or []
    crew_table = crew_table or {}
    rule_relations = rule_relations or []

    if ENABLE_GROUP_MILESTONES:
        group_milestones, group_give_preds = _build_group_milestones_and_summary(activity_list, wbs_manager)
    else:
        group_milestones, group_give_preds = [], {}

    building_completion = None
    if ENABLE_BUILDING_COMPLETION:
        # Building completion is intentionally optional and currently disabled by config.
        root_wbs_oid = 1
        if hasattr(wbs_manager, 'order') and wbs_manager.order:
            root_name = wbs_manager.order[0]
            root_wbs_oid = wbs_manager.get_id(root_name)

        building_completion = {
            "task_id": "BUILDING-COMPLETION",
            "task_name": "Building Completion",
            "wbs_oid": root_wbs_oid,
            "duration_days": 0,
            "milestone": True,
            "milestone_type": "Finish",
            "rec": {}
        }

    # Close-out milestone per building: every activity still without a successor after all the
    # relationships are written feeds it (step 7 below).
    closeout_by_building = {}
    closeout_milestones = []
    if ENABLE_COMPLETION_CLOSEOUT:
        for act in activity_list:
            if act.get("loe") or act.get("rule_milestone"):
                continue
            rec = act.get("rec") or {}
            building = str(rec.get("building", "") or "").strip()
            if not building or building in closeout_by_building:
                continue
            wbs_prefix = str(rec.get("wbs_prefix", "") or building).strip()
            milestone_id = f"{PROJECT_SHORT}-{building}-COMPLETION"
            closeout_by_building[building] = milestone_id
            closeout_milestones.append({
                "task_id": milestone_id,
                "task_name": f"{building} - Building Completion",
                "wbs_oid": wbs_manager.get_id(f"{wbs_prefix} - Construction") or 1,
                "duration_days": 0,
                "milestone": True,
                "milestone_type": "Finish",
                "rec": {},
            })

    activity_by_task = {a.get("task_id"): a for a in activity_list if a.get("task_id")}
    all_activities = activity_list + group_milestones + closeout_milestones + ([building_completion] if building_completion else [])

    act_counter = 1000
    rel_counter = 1000
    act_code_counter = 0
    act_code_assignment_counter = 1000
    rsrc_assign_counter = 1000
    project_elem = root.find("Project")

    activity_code_types = {
        "CWA-Unit": "1",
        "CWA-Building": "2",
        "CWA-Level": "3",
    }
    activity_code_registry = {}

    task_object_id_map = {}
    seen = set()

    relation_type_map = {
        "FS": "FinishToStart",
        "SS": "StartToStart",
        "FF": "FinishToFinish",
        "SF": "StartToFinish",
        "FINISHTOSTART": "FinishToStart",
        "STARTTOSTART": "StartToStart",
        "FINISHTOFINISH": "FinishToFinish",
        "STARTTOFINISH": "StartToFinish",
    }

    # Track the effective precedence graph while writing links so we can
    # reject any edge that would close a directed loop.
    adjacency = defaultdict(set)
    skipped_edges_by_source = defaultdict(list)
    not_written = defaultdict(int)  # why links were not written (missing activity, already there, would close a loop)

    # Successors listed in Relations sheet are treated as overrides:
    # generated links to those successors are suppressed and replaced.
    custom_overrides_by_successor = defaultdict(list)
    for row in custom_relations:
        pred_id = str(row.get("ActivityID1", "") or "").strip()
        succ_id = str(row.get("ActivityID2", "") or "").strip()
        if not pred_id or not succ_id:
            continue

        rel_raw = str(row.get("Relation", "FS") or "FS").strip().upper()
        rel_type = relation_type_map.get(rel_raw, "FinishToStart")
        custom_overrides_by_successor[succ_id].append({
            "pred_id": pred_id,
            "succ_id": succ_id,
            "rel_type": rel_type,
            "lag": row.get("Lag", 0),
        })

    override_successors = set(custom_overrides_by_successor.keys())
    manual_successors = set(override_successors)  # the user's manual links: they win over a rule's
    # A rule that replaces what leads into its successor (a contact rule's replaceBuiltIn is handled before this) says so.
    override_successors |= {r["succ"] for r in (rule_relations or []) if r.get("replaces")}

    def _creates_cycle(pred_task_id, succ_task_id):
        if pred_task_id == succ_task_id:
            return True

        stack = [succ_task_id]
        visited = set()
        while stack:
            node = stack.pop()
            if node == pred_task_id:
                return True
            if node in visited:
                continue
            visited.add(node)
            for nxt in adjacency.get(node, set()):
                if nxt not in visited:
                    stack.append(nxt)
        return False

    def _emit_relationship(pred_task_id, succ_task_id, rel_type, lag_days=0, source="generated", track=True):
        """track=False writes the link without counting it in the precedence graph (no cycle check, and the predecessor
        still counts as having no successor): the level-of-effort links of a rule's level task."""
        nonlocal rel_counter
        p_oid = task_object_id_map.get(pred_task_id)
        s_oid = task_object_id_map.get(succ_task_id)
        if not p_oid or not s_oid:
            not_written["missing"] += 1
            return False

        dedupe_key = (p_oid, s_oid, rel_type)
        if dedupe_key in seen:
            not_written["already there"] += 1
            return False

        if not track:
            seen.add(dedupe_key)
        elif _creates_cycle(pred_task_id, succ_task_id):
            # Named per source, not just counted: SequenceOrder is the
            # user's explicit, manual override and is emitted before every
            # automatic source below, so a rejection here almost always
            # means an automatic (level-gate/clash/Heavy Precast) edge lost
            # to it — worth naming exactly which pair on both sides, since
            # silently dropping just a count leaves no way to find (or
            # explain) which rows are in conflict.
            skipped_edges_by_source[source].append((pred_task_id, succ_task_id))
            not_written["would close a loop"] += 1
            return False

        seen.add(dedupe_key)
        if track:
            adjacency[pred_task_id].add(succ_task_id)
        rel_counter += 1
        rel = ET.SubElement(project_elem, "Relationship")
        ET.SubElement(rel, "ObjectId").text = str(rel_counter)
        ET.SubElement(rel, "PredecessorActivityObjectId").text = str(p_oid)
        ET.SubElement(rel, "SuccessorActivityObjectId").text = str(s_oid)
        ET.SubElement(rel, "Type").text = rel_type
        lag_value = _safe_float(lag_days, 0)
        if lag_value:
            ET.SubElement(rel, "Lag").text = str(lag_value)
        return True

    def _get_or_create_activity_code(code_type_name, code_value):
        nonlocal act_code_counter
        code_value = str(code_value or "").strip()
        if not code_value:
            return None

        registry_key = (code_type_name, code_value)
        if registry_key in activity_code_registry:
            return activity_code_registry[registry_key]

        code_type_oid = activity_code_types.get(code_type_name)
        if not code_type_oid:
            return None

        act_code_counter += 1
        code = ET.SubElement(root, "ActivityCode")
        ET.SubElement(code, "ObjectId").text = str(act_code_counter)
        ET.SubElement(code, "CodeTypeObjectId").text = str(code_type_oid)
        ET.SubElement(code, "CodeValue").text = code_value
        ET.SubElement(code, "Color").text = "#ffffff"
        ET.SubElement(code, "Description").text = ""
        parent_oid = ET.SubElement(code, "ParentObjectId")
        parent_oid.set("xsi:nil", "true")
        ET.SubElement(code, "SequenceNumber").text = str(act_code_counter - 1)
        ET.SubElement(code, "ProjectObjectId").text = "1"

        activity_code_registry[registry_key] = str(act_code_counter)
        return str(act_code_counter)

    def _assign_activity_code(activity_object_id, code_type_name, code_value, activity_element=None):
        nonlocal act_code_assignment_counter
        code_object_id = _get_or_create_activity_code(code_type_name, code_value)
        if not code_object_id:
            return

        # In activity-based mode, emit code assignments directly under each Activity node.
        if USE_ACTIVITY_BASED_ACTIVITY_CODES and activity_element is not None:
            code = ET.SubElement(activity_element, "Code")
            ET.SubElement(code, "TypeObjectId").text = str(activity_code_types[code_type_name])
            ET.SubElement(code, "ValueObjectId").text = str(code_object_id)
            return

        act_code_assignment_counter += 1
        assignment = ET.SubElement(root, "ActivityCodeAssignment")
        ET.SubElement(assignment, "ObjectId").text = str(act_code_assignment_counter)
        ET.SubElement(assignment, "ActivityObjectId").text = str(activity_object_id)
        ET.SubElement(assignment, "ActivityCodeTypeObjectId").text = str(activity_code_types[code_type_name])
        ET.SubElement(assignment, "ActivityCodeObjectId").text = str(code_object_id)
        ET.SubElement(assignment, "ProjectObjectId").text = "1"

    def _extract_building_from_activity(rec, act_data):
        rec_building = str(rec.get("building", "") or "").strip().upper()
        if rec_building:
            return rec_building

        task_id = str(act_data.get("task_id", "") or "").strip().upper()
        if task_id and "-" in task_id:
            return task_id.split("-", 1)[0]

        task_name = str(act_data.get("task_name", "") or "").strip().upper()
        if task_name and " - " in task_name:
            return task_name.split(" - ", 1)[0]

        return ""

    def _is_concrete_phase(act_data):
        phase = str(act_data.get("phase", "") or "").strip().upper()
        return "CONCRETE" in phase

    def _is_rebar_phase(act_data):
        phase = str(act_data.get("phase", "") or "").strip().upper()
        return phase == "REBAR"

    def _assign_resource_to_activity(activity_object_id, resource_id, planned_qty, units_per_time=None):
        """units_per_time: labour only — the crew size (people working every
        day of the activity); planned_qty is then its man-hours."""
        nonlocal rsrc_assign_counter
        if planned_qty is None:
            return
        qty = _safe_float(planned_qty, None)
        if qty is None or qty <= 0:
            return

        resource_obj_id = str((resources or {}).get(resource_id, "") or "")
        if not resource_obj_id:
            return

        rsrc_assign_counter += 1
        ra = ET.SubElement(root, "ResourceAssignment")
        ET.SubElement(ra, "ObjectId").text = str(rsrc_assign_counter)
        ET.SubElement(ra, "ActivityObjectId").text = str(activity_object_id)
        ET.SubElement(ra, "ResourceObjectId").text = resource_obj_id
        ET.SubElement(ra, "ProjectObjectId").text = "1"
        ET.SubElement(ra, "PlannedUnits").text = str(round(qty, 3))
        ET.SubElement(ra, "RemainingUnits").text = str(round(qty, 3))
        ET.SubElement(ra, "AtCompletionUnits").text = str(round(qty, 3))
        if units_per_time:
            ET.SubElement(ra, "PlannedUnitsPerTime").text = str(units_per_time)
            ET.SubElement(ra, "RemainingUnitsPerTime").text = str(units_per_time)

    allowed_buildings = set(_CWA_BUILDING_VALUES)
    allowed_units = set(_CWA_UNIT_VALUES)

    # Pre-create configured code values so they exist even if a particular run has no matching activities.
    for unit_value in _CWA_UNIT_VALUES:
        _get_or_create_activity_code("CWA-Unit", unit_value)
    for building_value in _CWA_BUILDING_VALUES:
        _get_or_create_activity_code("CWA-Building", building_value)
    for level_value in ("L0", "L1", "L2"):
        _get_or_create_activity_code("CWA-Level", level_value)

    # ====================== CREATE ALL ACTIVITIES ======================
    for act_data in all_activities:
        rec = act_data.get("rec", {})
        task_id = act_data.get("task_id")
        duration_days = float(act_data.get("duration_days", 1.0))
        calendar = _calendars.active().for_activity(act_data.get("phase"), rec)
        duration_hours = max(0, int(duration_days * calendar.hours_per_day))

        act_counter += 1
        act = ET.SubElement(project_elem, "Activity")
        ET.SubElement(act, "ObjectId").text = str(act_counter)
        ET.SubElement(act, "Id").text = task_id
        ET.SubElement(act, "Name").text = act_data.get("task_name", task_id)
        ET.SubElement(act, "WBSObjectId").text = str(act_data["wbs_oid"])
        ET.SubElement(act, "GUID").text = str(uuid.uuid4()).upper()
        # The activity's calendar: the first rule of Rules > Calendars that fits it, else the default (the generator's own: Curing on
        # the 7-day calendar, so a 28-day cure elapses 28 actual days, weekends included). See add_detailed_calendar / cpm_apply.py.
        ET.SubElement(act, "CalendarObjectId").text = calendar.oid
        ET.SubElement(act, "PlannedDuration").text = str(duration_hours)
        ET.SubElement(act, "AtCompletionDuration").text = str(duration_hours)
        ET.SubElement(act, "RemainingDuration").text = str(duration_hours)
        ET.SubElement(act, "ActualDuration").text = "0"

        for tag in ("ActualStartDate", "ActualFinishDate", "ExpectedFinishDate"):
            ET.SubElement(act, tag).set("xsi:nil", "true")

        start_date = START_DATE.replace(hour=7, minute=0, second=0, microsecond=0)
        ET.SubElement(act, "PlannedStartDate").text = start_date.strftime("%Y-%m-%dT%H:%M:%S")
        ET.SubElement(act, "PlannedFinishDate").text = start_date.strftime("%Y-%m-%dT%H:%M:%S")

        ET.SubElement(act, "PercentComplete").text = "0"
        ET.SubElement(act, "PercentCompleteType").text = "Duration"
        ET.SubElement(act, "Status").text = "Not Started"
        ET.SubElement(act, "ProjectObjectId").text = "1"

        if act_data.get("milestone"):
            mtype = act_data.get("milestone_type", "Start")
            ET.SubElement(act, "Type").text = "Start Milestone" if mtype == "Start" else "Finish Milestone"
        elif act_data.get("summary"):
            ET.SubElement(act, "Type").text = "WBS Summary"
        elif act_data.get("loe"):
            # A rule's level task: dated from its pours by the CPM (core/cpm_schedule.py) and in P6 by its SS / FF links.
            ET.SubElement(act, "Type").text = "Level of Effort"
        else:
            ET.SubElement(act, "Type").text = "Task Dependent"

        task_object_id_map[task_id] = act_counter

        source_building_code = _extract_activity_code_source(rec, act_data)
        unit_code, building_code = _split_cwa_building_code(source_building_code)
        building_code = _CWA_BUILDING_ALIASES.get(building_code, building_code)
        level_code = _activity_level_code(rec)
        if unit_code not in allowed_units:
            unit_code = "0"
        if building_code not in allowed_buildings:
            building_code = ""
        _assign_activity_code(act_counter, "CWA-Unit", unit_code, activity_element=act)
        _assign_activity_code(act_counter, "CWA-Building", building_code, activity_element=act)
        _assign_activity_code(act_counter, "CWA-Level", level_code, activity_element=act)

        # UDFs
        if rec.get("full_pour_id"):
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "1"
            ET.SubElement(u, "TextValue").text = rec["full_pour_id"]
        if rec.get("planning_proposed_pour_id"):
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "2"
            ET.SubElement(u, "TextValue").text = str(rec.get("planning_proposed_pour_id", ""))
        # Unit + Building in full (9HVD), though IDs leave unit 9 out (HVD).
        unit_building = rec.get("unit_building") or rec.get("building")
        if unit_building:
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "4"
            ET.SubElement(u, "TextValue").text = str(unit_building)

        alt_pour_id = str(rec.get("alt_pour_id") or rec.get("original_pour_id") or "").strip()
        if alt_pour_id:
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "7"
            ET.SubElement(u, "TextValue").text = alt_pour_id

        if unit_code:
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "5"
            ET.SubElement(u, "TextValue").text = unit_code

        if building_code:
            u = ET.SubElement(act, "UDF")
            ET.SubElement(u, "TypeObjectId").text = "6"
            ET.SubElement(u, "TextValue").text = building_code

        # Wall class and rate assumptions (SeaTable "Wall Classes", see core/rates_info.py).
        element_for_rates = rec.get("element") if rec else None
        class_info = None
        if element_for_rates is not None:
            class_info = rate_fields(str(getattr(element_for_rates, "GlobalId", "") or ""), str(act_data.get("phase", "")).strip())
        if class_info:
            for type_id, tag, key in (
                ("8", "TextValue", "class"),
                ("9", "TextValue", "class_name"),
                ("10", "NumberValue", "rate"),
                ("11", "TextValue", "rate_unit"),
                ("12", "TextValue", "rate_basis"),
                ("13", "TextValue", "measured"),
            ):
                if class_info.get(key) not in (None, ""):
                    u = ET.SubElement(act, "UDF")
                    ET.SubElement(u, "TypeObjectId").text = type_id
                    ET.SubElement(u, tag).text = str(class_info[key])

        # Quantity user field by phase; concrete also carries concrete material quantity.
        pour_volume = _safe_float(rec.get("volume", 0), None)
        if pour_volume is not None and pour_volume > 0:
            quantity_value = None
            if _is_concrete_phase(act_data):
                quantity_value = pour_volume
            elif _is_rebar_phase(act_data):
                quantity_value = rebar_tonnes(rec)
            elif str(act_data.get("phase", "")).strip() == "Installation":
                # Precast concrete volume: the app reads it as Precast (m3)
                # (an app-only resource, so nothing extra goes into the P6 resources).
                quantity_value = pour_volume

            if quantity_value is not None:
                q = ET.SubElement(act, "UDF")
                ET.SubElement(q, "TypeObjectId").text = "3"
                ET.SubElement(q, "NumberValue").text = str(quantity_value)

            if _is_concrete_phase(act_data):
                _assign_resource_to_activity(act_counter, f"{PROJECT_SHORT}-C", pour_volume)
            # Rebar tonnes on the Rebar activity (or a stage-2 pedestal's combined one).
            if _is_rebar_phase(act_data) or str(act_data.get("phase", "")).strip() == "Rebar, Formwork and Concrete":
                _assign_resource_to_activity(act_counter, f"{PROJECT_SHORT}-R", rebar_tonnes(rec))

        # Labour: each trade's crew works every day of the activity.
        if rec:
            for trade_code, crew in crews_for(act_data.get("phase", ""), rec, crew_table):
                _assign_resource_to_activity(act_counter, labour_resource_id(trade_code), crew * duration_hours, units_per_time=crew)

    # ====================== RELATIONSHIPS ======================
    # Priority (highest first): Relations sheet overrides (skip generated
    # links for their own successors, see override_successors below) >
    # SequenceOrder (the user's explicit, manual override) > intra-pour
    # chain (a pour's own Rebar->Formwork->Concrete) > automatic/clash-
    # derived edges (level-gate, slab support, Heavy Precast <-> wall).
    #
    # SequenceOrder is emitted before every automatic source specifically so
    # _emit_relationship's cycle guard can only ever reject an AUTOMATIC
    # edge for conflicting with it — never the reverse — no matter how many
    # hops (or how many DIFFERENT automatic sources) the conflict actually
    # runs through. A narrower pre-filter used to live in main.py, checking
    # automatic edges against just a snapshot of the sequence+intra graph
    # before merging everything together — that missed conflicts which only
    # became cyclic once combined with ANOTHER automatic edge already added
    # (the real case this was built to fix: a Heavy Precast's own Stitching
    # depended on its supporting wall's concrete, which — via level-gate,
    # cascading through the SAME wall column up two more levels — was also
    # what the user's own SequenceOrder chain ran through on its way to a
    # later wall the user wanted sequenced before that same Heavy Precast).
    # Ordering-based priority against the live, evolving adjacency graph
    # catches all of them, not just the directly detectable ones.

    # 1. SequenceOrder relationships — a (pred_id, succ_id, rel_type) triple
    # per edge now, not a single uniform type: rows sharing the same Index
    # are StartToStart (start together), while moving to the next Index
    # value is FinishToStart (the next group only starts once the previous
    # one has actually finished) — see _build_sequence_order_relationships.
    for pred_id, succ_id, rel_type, *lag in sequence_ss_predecessors:
        if succ_id in override_successors:
            continue
        _emit_relationship(pred_id, succ_id, rel_type, lag[0] if lag else 0, source="sequence")

    # 2. Intra-pour relationships (a pour's own phase chain)
    for succ_id, pred_list in intra_predecessors.items():
        if succ_id in override_successors:
            continue
        succ_act = activity_by_task.get(succ_id) or {}
        for p_id in pred_list:
            pct = (succ_act.get("intra_edges") or {}).get(p_id, 100.0)
            pred_act = activity_by_task.get(p_id)
            if pct < 100.0 and pred_act is not None:
                # An overlap: starts when the predecessor is `pct` % done (start-to-start, lagged by that share of its hours), and, when the
                # chain row says so, cannot finish before it does (finish-to-finish).
                pred_hours = float(pred_act.get("duration_days", 0) or 0) * _calendars.active().for_activity(pred_act.get("phase"), pred_act.get("rec", {})).hours_per_day
                _emit_relationship(p_id, succ_id, "StartToStart", round(pred_hours * pct / 100.0, 2), source="intra")
                if succ_act.get("finish_after"):
                    _emit_relationship(p_id, succ_id, "FinishToFinish", 0, source="intra")
            else:
                _emit_relationship(p_id, succ_id, "FinishToStart", source="intra")

    # 2b. The scenario's programme rules (sequences, contacts, level tasks and links: core/rule_logic.py). Ahead of the
    # automatic sources, so a cycle drops the automatic link; after SequenceOrder and the pours' own chains, which win.
    rule_emitted = 0
    not_written.clear()
    for r in rule_relations:
        if r.get("succ") in manual_successors:
            continue
        rel = relation_type_map.get(str(r.get("type") or "FS").upper(), "FinishToStart")
        if _emit_relationship(r["pred"], r["succ"], rel, r.get("lag", 0), source=str(r.get("source") or "rule"), track=r.get("track", True)):
            rule_emitted += 1
    if rule_relations:
        why = ", ".join(f"{n} {reason}" for reason, n in not_written.items() if n)
        print(f"  Rules: {rule_emitted} of {len(rule_relations)} rule link(s) written" + (f" (not written: {why})" if why else ""))

    # 3. Automatic/clash-derived cross-pour edges (level gating, slab
    # support, Heavy Precast <-> wall linking, ...). Each source keeps its
    # own label (see automatic_predecessor_sources) so a rejected edge's
    # origin stays visible in the diagnostics below, and each is only ever
    # dropped in favor of what's emitted above — never the reverse.
    for source_label, predecessors in automatic_predecessor_sources:
        for succ_id, pred_list in predecessors.items():
            if succ_id in override_successors:
                continue
            for p_id in pred_list:
                _emit_relationship(p_id, succ_id, "FinishToStart", source=source_label)

    # 4. Concrete → GIVE relationships
    for give_id, concrete_ids in group_give_preds.items():
        if give_id in override_successors:
            continue
        for c_id in concrete_ids:
            _emit_relationship(c_id, give_id, "FinishToStart", source="group")

    # 5. GIVEs → Building Completion (Predecessors)
    completion_oid = task_object_id_map.get("BUILDING-COMPLETION")
    if completion_oid and "BUILDING-COMPLETION" not in override_successors:
        for give_id in group_give_preds.keys():
            _emit_relationship(give_id, "BUILDING-COMPLETION", "FinishToStart", source="completion")

    # 6. Relations sheet overrides (written last, replacing generated links by successor)
    for succ_id, specs in custom_overrides_by_successor.items():
        for spec in specs:
            _emit_relationship(spec["pred_id"], spec["succ_id"], spec["rel_type"], spec.get("lag", 0), source="custom")

    # 6b. Rule links for the open ends: what still has no successor once every other link is written.
    if late_rule_relations is not None:
        open_now = {a.get("task_id") for a in activity_list if a.get("task_id") and not adjacency.get(a.get("task_id"))}
        late_made = 0
        for r in late_rule_relations(open_now) or []:
            rel = relation_type_map.get(str(r.get("type") or "FS").upper(), "FinishToStart")
            if _emit_relationship(r["pred"], r["succ"], rel, r.get("lag", 0), source=str(r.get("source") or "rule"), track=r.get("track", True)):
                late_made += 1
        if late_made:
            print(f"  Rules: {late_made} link(s) of open-ended activities to their level task")

    # 7. Close-out: activities with no successor feed their building's completion milestone
    # Before that, an open-ended pour precedes the slab above it (part of the sequence, not of the close-out).
    open_ended = _open_ended_tasks(activity_list, adjacency)
    sequenced = 0
    for pred_id, succ_ids in _build_open_end_successors(activity_list, open_ended).items():
        if pred_id in override_successors:
            continue
        for succ_id in succ_ids:
            if succ_id not in override_successors and _emit_relationship(pred_id, succ_id, "FinishToStart", source="open-end"):
                sequenced += 1
    if sequenced:
        print(f"  Open ends: {sequenced} open-ended pour link{'s' if sequenced != 1 else ''} added to the slab above")

    if closeout_by_building:
        closed = 0
        for act in activity_list:
            task_id = act.get("task_id")
            milestone_id = closeout_by_building.get(str((act.get("rec") or {}).get("building", "") or "").strip())
            if not task_id or not milestone_id or adjacency.get(task_id):
                continue
            if _emit_relationship(task_id, milestone_id, "FinishToStart", source="closeout"):
                closed += 1
        print(f"  Close-out: {closed} open-ended activit{'y' if closed == 1 else 'ies'} linked to the building completion milestone")

    total_skipped = sum(len(edges) for edges in skipped_edges_by_source.values())
    if total_skipped:
        breakdown = ", ".join(
            f"{source}={len(edges)}" for source, edges in sorted(skipped_edges_by_source.items())
        )
        print(f"  Skipped {total_skipped} relationship(s) to prevent logic cycles ({breakdown})")

    automatic_source_labels = {label for label, _ in automatic_predecessor_sources}
    dropped_for_priority = [
        (source, pred_id, succ_id)
        for source, edges in skipped_edges_by_source.items()
        if source in automatic_source_labels or source == "intra"
        for pred_id, succ_id in edges
    ]
    if dropped_for_priority:
        print(
            f"  ⚠️ {len(dropped_for_priority)} automatic link(s) dropped because they conflicted with "
            f"SequenceOrder — SequenceOrder wins by design, this is expected whenever your manual priority "
            f"genuinely contradicts an automatic rule (level-gate/clash/Heavy Precast), not a bug:"
        )
        for source, pred_id, succ_id in dropped_for_priority:
            print(f"     [{source}] {pred_id} -> {succ_id}")

    if skipped_edges_by_source.get("sequence"):
        print(
            f"  ⚠️ {len(skipped_edges_by_source['sequence'])} SequenceOrder link(s) themselves could not be "
            f"applied — two SequenceOrder rows directly contradict each other (or contradict a pour's own "
            f"phase chain):"
        )
        for pred_id, succ_id in skipped_edges_by_source["sequence"]:
            print(f"     {pred_id} -> {succ_id}")

    # Building Completion should only collect predecessors (GIVE milestones).
    # No outgoing successors are added from Building Completion.

    # ====================== WBS ======================
    for seq, name in enumerate(wbs_manager.order):
        w = ET.SubElement(project_elem, "WBS")
        wid = str(wbs_manager.get_id(name))
        ET.SubElement(w, "ObjectId").text = wid
        # With a user-set WBS order the code follows it too, so a reader that sorts the WBS by code (the app) shows the same order.
        ET.SubElement(w, "Code").text = str(seq + 1) if getattr(wbs_manager, "reordered", False) else wid
        ET.SubElement(w, "Name").text = name
        ET.SubElement(w, "ProjectObjectId").text = "1"
        ET.SubElement(w, "SequenceNumber").text = str(seq)
        ET.SubElement(w, "Status").text = "Active"

        pid = wbs_manager.get_parent_id(name) if hasattr(wbs_manager, 'get_parent_id') else None
        if pid:
            ET.SubElement(w, "ParentObjectId").text = str(pid)
        else:
            p = ET.SubElement(w, "ParentObjectId")
            p.set("xsi:nil", "true")

    return {"skipped_edges_by_source": dict(skipped_edges_by_source)}


def save_p6_xml(root, filepath):
    from core.helpers import indent
    indent(root)
    ET.ElementTree(root).write(filepath, encoding="utf-8", xml_declaration=True)
    print(f"P6 XML saved: {filepath}")


def merge_p6_xml_files(source_xmls, master_xml_path):
    """Merge multiple generated P6 XML schedules into one master XML file."""
    source_paths = [p for p in (source_xmls or []) if p and str(p)]
    if not source_paths:
        print("No XML files to merge")
        return

    parsed = []
    for path in source_paths:
        try:
            tree = ET.parse(str(path))
            parsed.append((path, tree))
        except Exception as exc:
            print(f"Warning: could not parse XML {path}: {exc}")

    if not parsed:
        print("No valid XML files to merge")
        return

    _, base_tree = parsed[0]
    base_root = base_tree.getroot()

    ns_match = re.match(r"^\{(.+)\}", base_root.tag)
    ns_uri = ns_match.group(1) if ns_match else ""

    def q(tag_name):
        return f"{{{ns_uri}}}{tag_name}" if ns_uri else tag_name

    def get_text(elem, tag_name, default=""):
        node = elem.find(q(tag_name))
        if node is None or node.text is None:
            return default
        return str(node.text)

    def set_text(elem, tag_name, value):
        node = elem.find(q(tag_name))
        if node is None:
            node = ET.SubElement(elem, q(tag_name))
        node.text = str(value)

    projects = base_root.findall(q("Project"))
    if not projects:
        print("No Project node found in base XML; skipping master XML merge")
        return
    base_project = projects[0]

    existing_wbs_oids = {
        int(get_text(w, "ObjectId", "0") or 0)
        for w in base_project.findall(q("WBS"))
        if str(get_text(w, "ObjectId", "")).strip().isdigit()
    }
    existing_act_oids = {
        int(get_text(a, "ObjectId", "0") or 0)
        for a in base_project.findall(q("Activity"))
        if str(get_text(a, "ObjectId", "")).strip().isdigit()
    }
    existing_rel_oids = {
        int(get_text(r, "ObjectId", "0") or 0)
        for r in base_project.findall(q("Relationship"))
        if str(get_text(r, "ObjectId", "")).strip().isdigit()
    }

    max_wbs_oid = max(existing_wbs_oids) if existing_wbs_oids else 1000
    max_act_oid = max(existing_act_oids) if existing_act_oids else 1000
    max_rel_oid = max(existing_rel_oids) if existing_rel_oids else 1000

    existing_activity_ids = {
        str(get_text(a, "Id", "") or "").strip()
        for a in base_project.findall(q("Activity"))
    }

    merged_projects = 1
    for src_path, src_tree in parsed[1:]:
        src_root = src_tree.getroot()
        src_projects = src_root.findall(q("Project"))
        if not src_projects:
            print(f"Warning: no Project node in {src_path}; skipping")
            continue

        src_project = src_projects[0]

        src_wbs = src_project.findall(q("WBS"))
        src_acts = src_project.findall(q("Activity"))
        src_rels = src_project.findall(q("Relationship"))

        if not src_acts:
            print(f"Warning: no activities in {src_path}; skipping")
            continue

        wbs_oid_map = {}
        for w in src_wbs:
            old_oid_text = get_text(w, "ObjectId", "").strip()
            if not old_oid_text.isdigit():
                continue
            max_wbs_oid += 1
            wbs_oid_map[old_oid_text] = str(max_wbs_oid)

        act_oid_map = {}
        for a in src_acts:
            old_oid_text = get_text(a, "ObjectId", "").strip()
            if not old_oid_text.isdigit():
                continue
            max_act_oid += 1
            act_oid_map[old_oid_text] = str(max_act_oid)

        for w in src_wbs:
            w_copy = deepcopy(w)
            old_oid = get_text(w_copy, "ObjectId", "").strip()
            if old_oid in wbs_oid_map:
                set_text(w_copy, "ObjectId", wbs_oid_map[old_oid])
                set_text(w_copy, "Code", wbs_oid_map[old_oid])

            parent_node = w_copy.find(q("ParentObjectId"))
            if parent_node is not None and parent_node.text is not None:
                parent_old = str(parent_node.text).strip()
                if parent_old in wbs_oid_map:
                    parent_node.text = wbs_oid_map[parent_old]

            base_project.append(w_copy)

        for a in src_acts:
            a_copy = deepcopy(a)

            old_oid = get_text(a_copy, "ObjectId", "").strip()
            if old_oid in act_oid_map:
                set_text(a_copy, "ObjectId", act_oid_map[old_oid])

            wbs_old = get_text(a_copy, "WBSObjectId", "").strip()
            if wbs_old in wbs_oid_map:
                set_text(a_copy, "WBSObjectId", wbs_oid_map[wbs_old])

            raw_task_id = str(get_text(a_copy, "Id", "") or "").strip()
            if raw_task_id:
                unique_task_id = raw_task_id
                suffix = 2
                while unique_task_id in existing_activity_ids:
                    unique_task_id = f"{raw_task_id}-{suffix}"
                    suffix += 1
                if unique_task_id != raw_task_id:
                    set_text(a_copy, "Id", unique_task_id)
                existing_activity_ids.add(unique_task_id)

            set_text(a_copy, "ProjectObjectId", "1")
            base_project.append(a_copy)

        for r in src_rels:
            r_copy = deepcopy(r)

            max_rel_oid += 1
            set_text(r_copy, "ObjectId", str(max_rel_oid))

            pred_old = get_text(r_copy, "PredecessorActivityObjectId", "").strip()
            succ_old = get_text(r_copy, "SuccessorActivityObjectId", "").strip()
            pred_new = act_oid_map.get(pred_old)
            succ_new = act_oid_map.get(succ_old)
            if not pred_new or not succ_new:
                continue

            set_text(r_copy, "PredecessorActivityObjectId", pred_new)
            set_text(r_copy, "SuccessorActivityObjectId", succ_new)
            base_project.append(r_copy)

        merged_projects += 1

    save_p6_xml(base_root, str(master_xml_path))
    print(f"MASTER XML CREATED: {master_xml_path} ({merged_projects} project files merged)")