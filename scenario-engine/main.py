"""
CWA Planning Automation - Option 3 Only (Stage Priority)
Fully cleaned and updated with SequenceOrder + Relations support
"""
import argparse
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp
import traceback
import re
import math
import json
from collections import defaultdict
import time as _time

import ifcopenshell

from config import (
    INPUT_FILE, DEFAULT_OUTPUT_DIR,
    ENRICHED_IFC_DIR, XML_DIR, XLSX_DIR, BLENDER_DIR,
    PROJECT_SHORT, WBS_PREFIX, ALT_POUR_ID_PROP,
    EXCLUDED_POUR_TYPES, USE_PADDED_LEVEL_CODES, LEVEL_CODE_FALLBACK,
    WBS_BUILDING_ROOT_OBJECT_ID,
    GENERATE_NEW_POUR_IDS,
    BUILDING_NAME_MAP,
)

from core.quantities import collect_props
from core.resources import rebar_tonnes, crew_table_with_overrides
from core import rules as _rules
from core import levels as _levels
from core import zones as _zones
from core import work_items as _work_items
from core.helpers import extract_value, title_case, get_element_world_coordinates, get_original_building_name, get_bbox_height
from core.wbs_manager import WBSManager
from core.activity_generator import create_activities
from core.excel_exporter import export_activities_to_excel, merge_excel_files, load_overrides, _safe_int
from core.cpm_apply import apply_cpm_to_xml
from core.prs_links import merge_extras, resolve_relations
from core.rule_logic import (
    place_extras,
    PourTasks, build_level_tasks, build_sequences, build_contact_relations, build_recipe_links, build_limit_links, build_level_links, build_extra_attachments, late_level_relations, drop_builtin,
)
from core.adjustments import load_adjustments, drop_retired, extra_activities, extra_predecessors, apply_baselines, EXTRA_WBS_NAME
from core.xml_builder import (
    create_p6_xml_root,
    add_project_and_calendar,
    add_resources,
    write_activities_and_relationships,
    save_p6_xml,
    _build_intra_pour_predecessors,
    _build_slab_support_predecessors_from_clashes,
    _build_level_gate_predecessors,
    _build_stair_step_predecessors,
    _build_heavy_precast_wall_predecessors_from_clashes,
    _build_heavy_precast_open_end_predecessors,
    _build_xml_wbs_manager_for_activities,
    _build_sequence_order_relationships,
)
from core import xml_builder as _xml_builder
from core.ifc_writer import attach_cwa_planning_properties, attach_clash_relationship_properties, save_ifc_model
from core.clash_detection import run_pour_to_pour_clearance
from core.stair_steps import link_stair_steps
from core.clash_position import build_position_groups
from core.ifc_class_fixer import fix_ifc_classes
from core.ifc_spatial_structure import consolidate_spatial_structure
from core.ifc_color_manager import apply_colors_to_model
from core.ifc_import_optimizer import optimize_ifc_for_import


# ========================== OPTION 3 SORTING ==========================

OPTION3_ORDER_TABLE = [
    ("1", "RAFT", "RAFT", "RAFT", "YES"),
    ("1", "RAFT", "RAFT", "1", "YES"),
    ("1", "RAFT", "RAFT", "DISCONNECTED", "YES"),
    ("2", "RAFT", "RAFT", "DISCONNECTED", "NO"),
    ("2", "RAFT", "RAFT", "CONNECTED", "NO"),
    ("PRECAST", "HEAVY_PRECAST", "HEAVY_PRECAST", "DISCONNECTED", "YES"),
    ("PRECAST", "HEAVY_PRECAST", "HEAVY_PRECAST", "DISCONNECTED", "NO"),
    ("PRECAST", "STRUCTURES", "SLAB", "DISCONNECTED", "NO"),
    ("PRECAST", "STRUCTURES", "STAIR", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "STAIR", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "STAIR", "CONNECTED", "NO"),
    ("2", "STRUCTURES", "STAIR", "DISCONNECTED", "NO"),
    ("PRECAST", "REMOVABLE_ELEMENT", "REMOVABLE_ELEMENT", "DISCONNECTED", "NO"),
    ("PRECAST", "REMOVABLE_ELEMENT", "REMOVABLE_ELEMENT", "CONNECTED", "NO"),
    ("1", "STRUCTURES", "WALL", "DISCONNECTED", "YES"),
    ("2", "STRUCTURES", "WALL", "DISCONNECTED", "YES"),
    ("1", "STRUCTURES", "WALL", "CONNECTED", "YES"),
    ("2", "STRUCTURES", "WALL", "CONNECTED", "YES"),
    ("1", "STRUCTURES", "WALL", "DISCONNECTED", "NO"),
    ("2", "STRUCTURES", "WALL", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "WALL", "CONNECTED", "NO"),
    ("2", "STRUCTURES", "WALL", "CONNECTED", "NO"),
    ("1", "MAIN_SLAB", "MAIN_SLAB", "DISCONNECTED", "YES"),
    ("1", "MAIN_SLAB", "MAIN_SLAB", "DISCONNECTED", "NO"),
    ("2", "MAIN_SLAB", "MAIN_SLAB", "DISCONNECTED", "NO"),
    ("1", "MAIN_SLAB", "MAIN_SLAB", "CONNECTED", "NO"),
    ("1", "STRUCTURES", "SLAB", "DISCONNECTED", "YES"),
    ("1", "STRUCTURES", "SLAB", "DISCONNECTED", "NO"),
    ("2", "STRUCTURES", "SLAB", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "SLAB", "CONNECTED", "NO"),
    ("2", "STRUCTURES", "SLAB", "CONNECTED", "NO"),
    ("1", "STRUCTURES", "SLAB", "CONNECTED", "YES"),
    ("1", "STRUCTURES", "LANDING", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "COLUMN", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "BEAM", "DISCONNECTED", "NO"),
    ("1", "STRUCTURES", "BEAM", "CONNECTED", "NO"),
    ("1", "MAIN_SLAB", "PARAPET", "DISCONNECTED", "YES"),
    ("1", "MAIN_SLAB", "PARAPET", "CONNECTED", "YES"),
    ("2", "STRUCTURES", "PEDESTAL", "DISCONNECTED", "NO"),
    ("2", "STRUCTURES", "PEDESTAL", "CONNECTED", "NO"),
    ("2", "MAIN_SLAB", "GULLIES", "DISCONNECTED", "NO"),
    ("2", "MAIN_SLAB", "GULLIES", "CONNECTED", "NO"),
    ("2", "MAIN_SLAB", "SCREED", "DISCONNECTED", "YES"),
    ("2", "MAIN_SLAB", "SCREED", "DISCONNECTED", "NO"),
    ("2", "MAIN_SLAB", "SCREED", "CONNECTED", "YES"),
    ("2", "MAIN_SLAB", "SCREED", "CONNECTED", "NO"),
    ("2", "MAIN_SLAB", "UPSTAND", "DISCONNECTED", "NO"),
    ("2", "MAIN_SLAB", "UPSTAND", "CONNECTED", "NO"),
]

_OPTION3_RANK = {row: idx + 1 for idx, row in enumerate(OPTION3_ORDER_TABLE)}

# Explicitly supported pour types for this workflow (normalized with underscores).
CONTEMPLATED_POUR_TYPES = {
    "AIRDUCT", "BEAM", "BOSS", "COLUMN", "CORBEL", "GROUT",
    "GULLIES", "HEAVY_PRECAST", "LANDING", "MAIN_SLAB", "PARAPET",
    "PEDESTAL", "PLINTH", "RAFT", "REMOVABLE_ELEMENT", "SCREED",
    "SLAB", "STAIR", "UPSTAND", "WALL",
}

_OPTION3_FALLBACK_TYPE_RANK = {
    "RAFT": 1,
    "HEAVY_PRECAST": 2,
    "REMOVABLE_ELEMENT": 3,
    "WALL": 4,
    "MAIN_SLAB": 5,
    "SLAB": 6,
    "LANDING": 7,
    "COLUMN": 8,
    "BEAM": 9,
    "PARAPET": 10,
    "PEDESTAL": 11,
    "GULLIES": 12,
    "SCREED": 13,
    "UPSTAND": 14,
    "AIRDUCT": 15,
    "BOSS": 16,
    "CORBEL": 17,
    "GROUT": 18,
    "PLINTH": 19,
    "STAIR": 20,
}


def _normalized_pour_type(rec):
    return str(rec.get("pour_type", "") or "").replace(" ", "_").upper()


def _stage_group(rec):
    conc_stage = str(rec.get("conc_stage", "") or "").strip().upper()
    ptype = _normalized_pour_type(rec)
    if conc_stage in {"PRECAST", "PC"} or ptype in {"HEAVY_PRECAST", "REMOVABLE_ELEMENT"}:
        return "PRECAST"
    if conc_stage == "2":
        return "2"
    return "1"


def _logic_group_1_sort_rank(lg1_value):
    normalized = str(lg1_value or "").replace("_", " ").strip().upper()
    normalized = re.sub(r"\s*\(STAGE\s*2\)\s*$", "", normalized)
    priority = {
        "EXTERNAL WALL": 1, "INTERNAL WALL": 2, "SLAB": 3, "LANDING": 4,
        "COLUMN": 5, "BEAM": 6, "PARAPET": 7, "PEDESTAL": 8,
        "GULLIES": 9, "SCREED": 10, "UPSTAND": 11,
        "AIRDUCT": 12, "BOSS": 13, "CORBEL": 14, "GROUT": 15, "PLINTH": 16,
    }
    return priority.get(normalized, 99)


def _building_zone_sort_rank(building_zone_value):
    normalized = str(building_zone_value or "").strip().upper()
    priority = {"DISCONNECTED": 1, "CONNECTED_HK": 2, "CONNECTED_HL": 3, "CONNECTED": 4}
    return priority.get(normalized, 99)


def _option3_key(rec):
    ptype = _normalized_pour_type(rec)
    stage = _stage_group(rec)
    gtype = str(rec.get("general_pour_type", "") or ptype).strip().upper()

    if ptype == "SLAB" and gtype == "MAIN_SLAB":
        gtype = "STRUCTURES"
    if ptype == "MAIN_SLAB" and gtype == "STRUCTURES":
        gtype = "MAIN_SLAB"

    level = int(rec.get("level_int", 0))
    lg1 = str(rec.get("lg1", "") or "").strip().upper()
    lg1_rank = _logic_group_1_sort_rank(lg1)
    zone_rank = _building_zone_sort_rank(rec.get("building_zone", ""))
    stage_rank = {"1": 1, "2": 2, "PRECAST": 3}.get(stage, 99)

    zone = str(rec.get("building_zone", "") or "").strip().upper()
    zone_bucket = "DISCONNECTED" if "DISCONNECTED" in zone else "CONNECTED" if "CONNECTED" in zone else zone or "UNKNOWN"
    ext = "YES" if rec.get("is_external", False) else "NO"

    base_rank = _OPTION3_RANK.get((stage, gtype, ptype, zone_bucket, ext), 10**6)
    if base_rank == 10**6:
        # Keep deterministic sorting for recognized types that do not yet have
        # a dedicated stage/group tuple in OPTION3_ORDER_TABLE.
        fallback_type_rank = _OPTION3_FALLBACK_TYPE_RANK.get(ptype, 99)
        base_rank = 10**5 + fallback_type_rank

    if ptype == "STAIR":
        stage_offset = {"PRECAST": 0, "1": 1, "2": 2}.get(stage, 9)
        stair_anchor = _OPTION3_RANK.get(("PRECAST", "STRUCTURES", "STAIR", "DISCONNECTED", "NO"), 5)
        base_rank = stair_anchor + (stage_offset * 0.01)

    type_prio = 0 if ptype == "MAIN_SLAB" else 1 if ptype == "SLAB" else 2
    manual_order = int(rec.get("_manual_order", 10**9) or 10**9)

    is_precast_structures_slab = (stage == "PRECAST" and gtype == "STRUCTURES" and ptype == "SLAB")
    is_lg1_exception = (lg1_rank < 99) and not is_precast_structures_slab

    if is_lg1_exception:
        return (1, lg1_rank, level, zone_rank, stage_rank, base_rank, type_prio, lg1, manual_order, str(rec.get("full_pour_id", "") or ""))
    return (0, base_rank, level, zone_rank, stage_rank, type_prio, lg1, manual_order, str(rec.get("full_pour_id", "") or ""))


# ========================== HELPERS ==========================

def _safe_float(val):
    try:
        return float(val) if val not in (None, "") else float("inf")
    except:
        return float("inf")


def _proposed_id_sort_key(value):
    text = str(value or "").strip().upper()
    match = re.match(r"^(\d+)([A-Z]*)$", text)
    if match:
        return (0, int(match.group(1)), match.group(2))
    if text.isdigit():
        return (0, int(text), "")
    return (1, text)


def _normalize_proposed_id_for_name(value):
    text = str(value or "").strip().upper()
    if not text:
        return ""
    match = re.match(r"^(\d+)([A-Z]*)$", text)
    if match:
        return f"{int(match.group(1)):04d}{match.group(2)}"
    if text.isdigit():
        return str(int(text)).zfill(4)
    return text


def set_pour_name_for_sorting(element, proposed_id: str):
    if proposed_id:
        element.Name = _normalize_proposed_id_for_name(proposed_id)


def _reorder_ifc_tree_by_name(model):
    def _name_key(obj):
        name = str(getattr(obj, "Name", "") or "")
        return _proposed_id_sort_key(name)

    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        try:
            rel.RelatedElements = tuple(sorted(rel.RelatedElements or [], key=_name_key))
        except:
            pass
    for rel in model.by_type("IfcRelAggregates"):
        try:
            rel.RelatedObjects = tuple(sorted(rel.RelatedObjects or [], key=_name_key))
        except:
            pass


def _parse_level_int(level_value):
    if not level_value:
        return 0
    match = re.search(r"[-+]?\d+", str(level_value).strip())
    return int(match.group(0)) if match else 0


def _activity_type_code(pour_type, is_external=False):
    """Pour type code in the activity ID, per the wiki's Activity ID
    structure standard (Pour type codes)."""
    norm = _normalized_pour_type({"pour_type": pour_type})
    if "WALL" in norm:
        return "EW" if is_external else "IW"
    mapping = {
        "AIRDUCT": "AD",
        "BEAM": "B",
        "BOSS": "BO",
        "COLUMN": "C",
        "CORBEL": "CO",
        "GROUT": "GR",
        "GULLIES": "G",
        "HEAVY_PRECAST": "HP",
        "LANDING": "L",
        "MAIN_SLAB": "S",
        "PARAPET": "PA",
        "PEDESTAL": "P",
        "PLINTH": "PL",
        "RAFT": "R",
        "REMOVABLE_ELEMENT": "RE",
        "SCREED": "SC",
        "SLAB": "S",
        "STAIR": "ST",
        "UPSTAND": "U",
    }
    return mapping.get(norm, norm[:1] or "X")


def _label_type_code(label):
    """The type letter of a work item with a name of its own (Generate's packages): the first letter of its last word, as the pour codes go
    (Main Slab -> S, External Wall -> W, Raft -> R)."""
    words = re.findall(r"[A-Za-z0-9]+", str(label or ""))
    return words[-1][0].upper() if words else "X"


def _standard_building_code(unit_building):
    """The building as the standard writes it in IDs, names and WBS: Unit +
    Building, except unit 9 (site-wide buildings), which is left out:
    9HVD -> HVD, 1HN stays 1HN."""
    code = str(unit_building or "").strip().upper()
    return code[1:] if re.match(r"^9[A-Z]", code) else code


def _activity_zone_code(is_connected=False, is_disconnected=False):
    return "D" if is_disconnected else "C" if is_connected else ""


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


def _phase_sort_rank(phase):
    phase_upper = str(phase or "").strip().upper()
    priority = {"REBAR": 1, "FORMWORK": 2, "DECKING": 2, "EP+FWK": 2, "CONCRETE": 3}
    return priority.get(phase_upper, 99)


def _xml_level_label(rec):
    label = rec.get("level_label")  # a level definition in the rules: the level's own name, not "Level <number>"
    if label:
        return str(label)
    level_int_raw = rec.get("level_int")
    if level_int_raw is None:
        level_int_raw = _parse_level_int(rec.get("level_display", rec.get("level_code", "")))
    try:
        return f"Level {int(level_int_raw)}"
    except:
        level_display = str(rec.get("level_display", rec.get("level_code", "Unknown")) or "Unknown").strip()
        return level_display if level_display.upper().startswith("LEVEL ") else f"Level {level_display}"


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
    if "GULLIES" in ptype: return 13
    if "SCREED" in ptype: return 14
    if "UPSTAND" in ptype: return 15
    if "AIRDUCT" in ptype: return 16
    if "BOSS" in ptype: return 17
    if "CORBEL" in ptype: return 18
    if "GROUT" in ptype: return 19
    if "PLINTH" in ptype: return 20
    return 99


def _resolve_building_root_object_id(building_code):
    building = str(building_code or "").strip().upper()
    candidates = [building]
    base = building.lstrip("0123456789")
    if base and base not in candidates:
        candidates.append(base)
    if "DEFAULT" not in candidates:
        candidates.append("DEFAULT")

    for key in candidates:
        if key in WBS_BUILDING_ROOT_OBJECT_ID:
            return int(WBS_BUILDING_ROOT_OBJECT_ID[key])
    return 1


# ========================== NUMBERING ==========================

def assign_planning_proposed_pour_ids(records, clashes, overrides=None):
    overrides = overrides or {}
    manual_order_map = overrides.get("__pour_order__", {})

    for rec in records:
        guid = getattr(rec.get("element"), "GlobalId", None)
        rec["_manual_order"] = int(manual_order_map.get(guid, 10**9))

    overridden = {}
    for rec in records:
        guid = getattr(rec.get("element"), "GlobalId", None)
        if guid and guid in overrides:
            val = str(overrides[guid].get("PlanningProposedPourID", "")).strip()
            if val.isdigit() and int(val) > 0:
                rec["planning_proposed_pour_id"] = val.zfill(4)
                overridden[guid] = int(val)

    ordered = sorted(records, key=_option3_key)

    group_sizes = {}
    for rec in ordered:
        lg2_key = str(rec.get("lg2", "") or "").strip()
        group_sizes[lg2_key] = group_sizes.get(lg2_key, 0) + 1

    current = 1
    prev_lg2 = None
    for rec in ordered:
        lg2_now = str(rec.get("lg2", "") or "").strip()
        if prev_lg2 is not None and lg2_now != prev_lg2:
            current += _logic_group_2_reserve_count(prev_lg2, group_sizes.get(prev_lg2, 0))

        guid = getattr(rec.get("element"), "GlobalId", None)
        if guid in overridden:
            prev_lg2 = lg2_now
            continue

        while current in overridden.values():
            current += 1
        rec["planning_proposed_pour_id"] = str(current).zfill(4)
        prev_lg2 = lg2_now
        current += 1


def _logic_group_2_reserve_count(lg2_value, group_count):
    normalized = str(lg2_value or "").strip().upper()
    pct = 0.65 if "WALL" in normalized else 0.45
    return int(math.ceil(max(0, int(group_count or 0)) * pct))


def _resolve_existing_model_pour_id(rec, overrides=None):
    overrides = overrides or {}
    element = rec.get("element")
    guid = getattr(element, "GlobalId", None) if element else None

    if guid and guid in overrides:
        override_id = str(overrides[guid].get("PlanningProposedPourID", "") or "").strip()
        if override_id:
            return override_id

    return str(rec.get("pour_id", "") or "").strip()


def _number_missing_pour_ids(records):
    """Pours whose CWA Pour has no Pour ID Number (and no override) get the
    next free four-digit numbers after the building's highest one. Ordered
    by logic group and GlobalId, not by the scenario's order, so the same
    pour keeps the same number when the order changes."""
    missing = [r for r in records if not r.get("planning_proposed_pour_id")]
    if not missing:
        return
    used = {int(r["planning_proposed_pour_id"]) for r in records if str(r.get("planning_proposed_pour_id", "")).isdigit()}
    current = max(used, default=0) + 1
    for rec in sorted(missing, key=lambda r: (str(r.get("lg2", "")), str(getattr(r.get("element"), "GlobalId", "")))):
        while current in used:
            current += 1
        rec["planning_proposed_pour_id"] = str(current).zfill(4)
        rec["pour_id_generated"] = True
        used.add(current)
    print(f"  {len(missing)} pour(s) without a CWA Pour / Pour ID Number were numbered from {min(int(r['planning_proposed_pour_id']) for r in missing):04d}")


# ========================== RECORD BUILDING ==========================

def _resolve_building_name_map(source_stem):
    """Look up the per-file original->final IfcBuilding name mapping, falling
    back to a "DEFAULT" entry (if present) or an empty mapping."""
    file_map = BUILDING_NAME_MAP.get(source_stem)
    if file_map is None:
        file_map = BUILDING_NAME_MAP.get("DEFAULT", {})
    return file_map


# The one property set the generator reads. Everything else it needs is
# derived from it (the CWA Codes "General Level" / "Full Pour ID" strings are
# combinations of these values; CWA_Planning is the generator's own output).
POUR_PSET = "CWA Pour"


def _pad_pour_id(value):
    """Pour numbers as four digits (21 -> 0021), as the generator numbers
    them; anything that isn't a plain number (768J) is kept as it is."""
    text = str(value if value is not None else "").strip()
    return text.zfill(4) if text.isdigit() else text


def _include_pour(rec):
    """Whether a pour gets activities: big enough (stairs always) and not an excluded type. The minimum volume and the
    excluded types are settings of the scenario's rules (Rules > Settings), by default 0.25 m3 and config.EXCLUDED_POUR_TYPES."""
    if rec.get("_work_item"):
        return "YES"  # the smallest-volume and excluded-type rules are for pours; a work item is in
    return "YES" if _rules.active().is_included(rec, _rules.excluded_pour_types(EXCLUDED_POUR_TYPES)) else "NO"


def _refresh_records(records):
    """What the rules can change on a record read from the model: whether the pour is in, and its rebar tonnes. (A long-running
    generator keeps its records between requests, so this runs for every generation.)"""
    active = _rules.active()
    _levels.apply(records, active.settings, LEVEL_CODE_FALLBACK, USE_PADDED_LEVEL_CODES)  # which property is the level, and the order of the levels
    _zones.apply(records, active.settings)  # which property is the zone, and which zones are connected or disconnected (after the levels: it works on what they made)
    active.reset_joins(records)
    for rec in records:
        rec["include"] = _include_pour(rec)
        rec["rebar_weight_tonnes"] = rebar_tonnes(rec)
    joined = active.apply_joins(records)  # after the above: the main object takes its members' volume and rebar
    if joined:
        print(f"  Joined {joined} object(s) into their main object")
    # A duration from rebar tonnes (a productivity rate) with no rebar rate: every pour has 0 t, so every one gets its minimum days.
    from_rebar = [r for r in active.productivity if r.get("enabled") is not False and str(r.get("basis") or "rebar").lower() == "rebar"]
    if from_rebar and records and not any(float(r.get("rebar_weight_tonnes") or 0) > 0 for r in records):
        print("  WARNING: durations are worked out from rebar tonnes, but no Rebar rate gives tonnes per m3 of concrete, so every pour has 0 t and "
              "gets the minimum days. Add a Rebar rate (Rules > Rates, and an assignment for the Rebar phase).")


def _pour_record(element, guid, p, property_cache, building_name_map, cached_bbox_heights, geometry=None, props=None):
    """The record of one pour (or work item) from its properties `p` (the CWA Pour property set, or what a work item stands in for it). `geometry`
    ({coords, bbox_height, original_building_name}) is given for an object that is not in a model (core/work_items.py); `props` are its numbers."""
    level_display = p.get("Level") or "Unknown"
    level_int = _parse_level_int(level_display)
    level_code = LEVEL_CODE_FALLBACK if level_int <= 0 else (f"L{level_int:02d}" if USE_PADDED_LEVEL_CODES else f"L{level_int}")

    pour_type_raw = str(p.get("Pour Type") or p.get("General Pour Type") or "OTHER")
    # A work item with a name of its own (core/work_items.py "label"): names, the WBS and the type letter read it; its group is left for recipes
    # and rules. It is named as typed, without the pour-type wording (walls, double height, stage 2).
    label = str(p.get("Display Type") or "").strip()
    pour_type = pour_type_raw.replace("_", " ").strip().upper()
    pour_type_norm = _normalized_pour_type({"pour_type": pour_type})
    if pour_type_norm not in CONTEMPLATED_POUR_TYPES and geometry is None:
        print(f"  Warning: unrecognized pour type '{pour_type}' on GUID {element.GlobalId}")

    volume = float(p.get("Pour Volume m3", 0.0))

    conc_stage = str(p.get("Concrete Stage", "")).strip()
    conc_stage_norm = conc_stage.upper()

    # Double Height Wall Detection
    max_elevation = extract_value(p.get("Max Elevation"))
    min_elevation = extract_value(p.get("Min Elevation"))
    is_double_height = False
    if "WALL" in pour_type and max_elevation is not None and min_elevation is not None:
        try:
            is_double_height = (float(max_elevation) - float(min_elevation)) > 6
        except:
            is_double_height = False

    is_external = str(p.get("Is External?") or p.get("IsExternal") or "").strip().upper() in ("YES", "Y", "TRUE", "1", "EXT", "EXTERNAL")

    base_building = str(p.get("Building", "UNKNOWN")).strip().upper() or "BLD"
    unit_code = str(p.get("Unit", "") or "").strip().upper()
    if unit_code in {"UNKNOWN", "NONE", "N/A"}:
        unit_code = ""

    # Original IfcBuilding name as authored in the source model (captured
    # before consolidate_spatial_structure deletes/rebuilds IfcBuildings).
    original_building_name = geometry.get("original_building_name", "") if geometry else get_original_building_name(element)
    mapped_building = building_name_map.get(original_building_name.strip().upper(), "") if original_building_name else ""

    if mapped_building:
        unit_building = mapped_building
    else:
        unit_building = f"{unit_code}{base_building}" if unit_code else base_building
    building = _standard_building_code(unit_building)

    building_zone = str(p.get("Building Zone") or p.get("Zone") or "")
    is_disconnected = "DISCONNECTED" in building_zone.upper()
    is_connected = "CONNECTED" in building_zone.upper() and not is_disconnected


    zone_code = _activity_zone_code(is_connected=is_connected, is_disconnected=is_disconnected)
    type_code = _label_type_code(label) if label else _activity_type_code(pour_type, is_external=is_external)

    task_project_prefix = str(PROJECT_SHORT or "").strip().upper()
    base_task_id = f"{task_project_prefix}-{building}-{level_code}" if task_project_prefix else f"{building}-{level_code}"
    if zone_code:
        base_task_id += f"-{zone_code}"
    task_id_prefix = base_task_id + f"-{type_code}"
    base_task_id += f"-{type_code}-{str(p.get('Pour ID Number') or p.get('PourID') or '').strip()}"

    lg1_base = label or title_case(pour_type.replace("_", " "))
    if not label:
        if "WALL" in pour_type:
            lg1_base = f"{'External' if is_external else 'Internal'} {lg1_base}"
        if is_double_height:
            lg1_base = f"Double Height {lg1_base}"
        if conc_stage_norm in {"2", "STAGE 2", "2.0", "STAGE2"}:
            lg1_base += " (stage 2)"

    zone_label = "Disconnected - " if is_disconnected else "Connected - " if is_connected else ""

    current_wbs_prefix = str(WBS_PREFIX or "").replace(f"-{PROJECT_SHORT}", "").replace(f"{PROJECT_SHORT}-", "").format(BUILDING_CODE=building)
    wbs = WBSManager(current_wbs_prefix)
    wbs.register(f"{current_wbs_prefix} - Construction")

    level_wbs_name = f"{current_wbs_prefix} - {level_display}"
    wbs.register(level_wbs_name, f"{current_wbs_prefix} - Construction")

    if "WALL" in pour_type and not label:
        direction = "External" if is_external else "Internal"
        wall_wbs = f"{current_wbs_prefix} - {level_display} - {direction} Walls"
        wbs.register(wall_wbs, level_wbs_name)
        for sub in ["Rebar", "Formwork", "Concrete"]:
            wbs.register(f"{wall_wbs} - {sub}", wall_wbs)
        concrete_wbs_name = wall_wbs
        concrete_wbs_oid = wbs.get_id(concrete_wbs_name)
    else:
        # (One raft per building: "Raft", not "Rafts".)
        type_name = label or (title_case(pour_type.replace("_", " ")) + ("" if "RAFT" in pour_type.upper() or geometry is not None else "s"))
        type_wbs = f"{current_wbs_prefix} - {level_display} - {type_name}"
        wbs.register(type_wbs, level_wbs_name)
        concrete_wbs_name = type_wbs
        concrete_wbs_oid = wbs.get_id(concrete_wbs_name)

    coord_x, coord_y, coord_z = geometry.get("coords", (0.0, 0.0, 0.0)) if geometry else get_element_world_coordinates(element)

    # As CWA Codes / General Level 3: <unit+building>/<level>/<zone>/<general pour type>.
    general_level_3 = "/".join(
        str(v).strip() for v in (
            f"{unit_code}{base_building}",
            p.get("Level") or "",
            p.get("Building Zone") or "",
            p.get("General Pour Type") or "",
        )
    )
    bbox_height = geometry.get("bbox_height", 0.0) if geometry else (cached_bbox_heights[guid] if guid in cached_bbox_heights else get_bbox_height(element))

    pour_id = _pad_pour_id(p.get("Pour ID Number") or p.get("PourID"))

    rec = {
        "element": element,
        "level_int": level_int,
        "level_code": level_code,
        "level_display": level_display,
        "pour_type": pour_type,
        "general_pour_type": str(p.get("General Pour Type") or pour_type).replace(" ", "_").upper(),
        "is_external": is_external,
        "is_double_height": is_double_height,
        "lg1": lg1_base,
        # A work item's own name (Generate's package): its WBS in the XML is named after it (core/xml_builder.py).
        "display_type": label,
        "lg2": f"{building}-{level_code} - {zone_label}{lg1_base}".strip(" -"),
        "lg3": f"{building}-{level_code} - {lg1_base}",
        # As CWA Codes / Full Pour ID: <unit+building>/<alt pour ID>, as authored
        # (the models' own CWA Codes disagree on padding it).
        "full_pour_id": f"{unit_code}{base_building}/{str(p.get(ALT_POUR_ID_PROP) or p.get('Pour ID Number') or '').strip()}".rstrip("/"),
        "pour_id": pour_id,
        "original_pour_id": pour_id,
        "alt_pour_id": pour_id,
        "conc_stage": conc_stage,
        "volume": volume,
        "task_id_base": base_task_id,
        "task_id_prefix": task_id_prefix,
        "building": building,
        # Unit + Building in full (9HVD), for the CWA-Unit / CWA-Building codes.
        "unit_building": unit_building,
        "original_building_name": original_building_name,
        "building_mapped": bool(mapped_building),
        "wbs_prefix": current_wbs_prefix,
        "concrete_wbs_oid": concrete_wbs_oid,
        "concrete_wbs_name": concrete_wbs_name,
        "wbs_manager": wbs,
        "building_zone": building_zone,
        "is_connected": is_connected,
        "is_disconnected": is_disconnected,
        "coord_x": coord_x,
        "coord_y": coord_y,
        "coord_z": coord_z,
        # Small pours are left out, except stairs (a small stair pour is a step of a flight: see core/stair_steps.py).
        "include": "NO",  # set below, once the record exists (_include_pour)
        "min_elevation": min_elevation,
        "max_elevation": max_elevation,
        "general_level_3": general_level_3,
        "bbox_height": bbox_height,
        # The pour's properties as read, so the rules can say which one is its level (core/levels.py) without reading the model again.
        "pour_pset": dict(p),
    }
    rec["props"] = props if props is not None else collect_props(guid, property_cache)  # the model's numbers a rule can take a quantity from
    rec["include"] = _include_pour(rec)
    rec["rebar_weight_tonnes"] = rebar_tonnes(rec)
    return rec


def build_work_item_records(items):
    """The records of a request's work items (core/work_items.py): the record a pour of the same properties would have, with no model behind it."""
    records = []
    for n, item in enumerate(_work_items.clean(items), 1):
        element = _work_items.WorkItemElement(str(item["id"]).strip(), str(item.get("name") or item["group"]))
        p = _work_items.properties_of(item, n)
        rec = _pour_record(element, element.GlobalId, p, {}, {}, {}, geometry=_work_items.geometry_of(item), props=_work_items.numbers_of(item))
        rec["_work_item"] = True
        rec["include"] = "YES"
        records.append(rec)
    return records


def build_pour_records(model, property_cache, source_stem=None, cached_bbox_heights=None):
    records = []
    cached_bbox_heights = cached_bbox_heights or {}
    building_name_map = _resolve_building_name_map(source_stem)
    seen_guids = set()

    for rel in model.by_type("IfcRelDefinesByProperties"):
        pset_name = getattr(rel.RelatingPropertyDefinition, "Name", None)
        if pset_name != POUR_PSET:
            continue

        for element in rel.RelatedObjects:
            guid = getattr(element, "GlobalId", None)
            if not guid or guid in seen_guids:
                continue

            p = {}
            pset = property_cache.get(POUR_PSET, {}).get(element.GlobalId)
            if pset:
                for prop in getattr(pset, "HasProperties", []):
                    value = extract_value(prop)
                    # Exported text can end in a stray carriage return ("INTERNAL" + a CR).
                    p[prop.Name] = value.strip() if isinstance(value, str) else value

            if not p:
                continue

            rec = _pour_record(element, guid, p, property_cache, building_name_map, cached_bbox_heights)
            records.append(rec)
            seen_guids.add(guid)

    return records


# ========================== MAIN PROCESSING (OPTION 3 ONLY) ==========================

def _source_fingerprint(path: Path):
    """(mtime, size) pair used to decide whether a cached fix_ifc_classes/
    clash-detection result is still valid for --fast-reiterate. Cheap and
    good enough: any real edit to the source IFC changes its mtime."""
    stat = path.stat()
    return {"mtime": stat.st_mtime, "size": stat.st_size}


def _load_geometry_cache(cache_path: Path):
    if not cache_path.is_file():
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_geometry_cache(cache_path: Path, fingerprint, clashes, bbox_heights=None):
    try:
        payload = {"fingerprint": fingerprint, "clashes": clashes}
        if bbox_heights is not None:
            payload["bbox_heights"] = bbox_heights
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except Exception as e:
        print(f"  WARNING: could not write geometry cache: {e}")


# ========================== SCHEDULE BUILDING ==========================

def resolve_pour_ids(records, clashes, overrides, generate_new_pour_ids):
    """Gives every pour record its Planning Proposed Pour ID and task ID
    base: newly numbered (generate_new_pour_ids) or the model's / overrides'
    existing ones."""
    if generate_new_pour_ids:
        assign_planning_proposed_pour_ids(records, clashes, overrides)

        for rec in records:
            pid = str(rec.get("planning_proposed_pour_id", "") or "").strip()
            rec["task_pour_id"] = pid if pid else rec.get("pour_id", "")
            if pid and rec.get("task_id_prefix"):
                rec["task_id_base"] = f"{rec['task_id_prefix']}-{pid}"
            # In generation mode, replace working Pour ID with proposed value.
            if pid:
                rec["pour_id"] = pid
    else:
        for rec in records:
            rec["planning_proposed_pour_id"] = _resolve_existing_model_pour_id(rec, overrides=overrides)
        _number_missing_pour_ids(records)
        for rec in records:
            existing_id = rec["planning_proposed_pour_id"]
            rec["task_pour_id"] = existing_id if existing_id else rec.get("pour_id", "")
            if rec.get("task_pour_id") and rec.get("task_id_prefix"):
                rec["task_id_base"] = f"{rec['task_id_prefix']}-{rec['task_pour_id']}"

    # Small in-situ stair pours are steps of a touching stair flight: they go with it.
    linked = link_stair_steps(records, clashes)
    if linked:
        print(f"  Linked {linked} in-situ stair step(s) to the stair they touch")


def create_all_activities(records, overrides):
    """Every pour's activity chain, in the Option 3 build order."""
    _refresh_records(records)
    activities = []
    for rec in records:
        activities.extend(create_activities(rec, rec.get("wbs_manager"), overrides=overrides))

    activities.sort(key=lambda a: _option3_key(a["rec"]))

    # Tasks retired in SeaTable (Settings > Retired and extra activities) are not regenerated.
    activities, retired_count = drop_retired(activities, load_adjustments()["retired"])
    if retired_count:
        print(f"  {retired_count} retired task(s) left out")

    return activities


def build_schedule_xml(records, activities, clashes, overrides, xml_path, start_date=None):
    """Relationships, CPM dates and the P6 XML for the included activities;
    writes xml_path. start_date: the data date (None = config START_DATE /
    today). Returns what the Excel report needs."""
    if start_date is not None:
        _xml_builder.START_DATE = start_date
    data_date = _xml_builder.START_DATE
    clashes = _rules.active().remap_clashes(clashes)  # what touched a joined object touches its main object
    xml_activities = [
        a for a in activities
        if str(a.get("rec", {}).get("include", "NO")).upper() == "YES"
    ]

    pour_activities = list(xml_activities)  # the pours' own activities (before the extras and the rules add theirs)

    raw_sequence_order = overrides.get("__sequence_order__", [])
    sequence_order = []

    for item in raw_sequence_order:
        guid = str(item.get("GUID", "") or item.get("guid", "")).strip()
        if not guid:
            continue

        # Phase is now optional
        phase = str(item.get("Phase", "") or item.get("Activity", "")).strip()

        sequence_order.append({
            "Index": _safe_int(item.get("Index", 9999)),
            "GUID": guid,
            "Phase": phase,           # can be empty → will be auto-resolved later
        })

    custom_relations = overrides.get("__relations__", [])

    sequence_ss_predecessors = _build_sequence_order_relationships(xml_activities, sequence_order)

    intra_predecessors = _build_intra_pour_predecessors(xml_activities)
    slab_support_predecessors = _build_slab_support_predecessors_from_clashes(xml_activities, clashes)
    level_gate_predecessors = _build_level_gate_predecessors(xml_activities)
    stair_step_predecessors = _build_stair_step_predecessors(xml_activities)
    heavy_precast_wall_predecessors = _build_heavy_precast_wall_predecessors_from_clashes(xml_activities, clashes)

    # Heavy Precast chains left with a loose end (Propping with no predecessor,
    # Propping Removal with no successor) get tied to what is under / above them.
    known_edges = defaultdict(list)
    for source in (intra_predecessors, slab_support_predecessors, level_gate_predecessors, stair_step_predecessors, heavy_precast_wall_predecessors):
        for succ, preds in source.items():
            known_edges[succ].extend(preds)
    for pred_id, succ_id, *_rest in sequence_ss_predecessors:
        known_edges[succ_id].append(pred_id)
    heavy_precast_open_end_predecessors = _build_heavy_precast_open_end_predecessors(xml_activities, clashes, known_edges)

    # SequenceOrder is the user's explicit, manual override and must
    # always win over these automatically-inferred (clash-derived/level-
    # gate/Heavy-Precast) edges when they conflict. Rather than trying to
    # pre-filter conflicts here (a previous approach did this by checking
    # each automatic edge against a snapshot of just the sequence+intra
    # graph — which missed conflicts that only became cyclic once
    # combined with ANOTHER automatic edge already merged in), these are
    # now passed to write_activities_and_relationships as separate,
    # lowest-priority sources: it emits SequenceOrder first, so its own
    # cycle guard can only ever reject one of THESE for conflicting with
    # it, against the live, fully evolving graph — never the reverse.
    automatic_predecessor_sources = [
        ("slab_support", slab_support_predecessors),
        ("level_gate", level_gate_predecessors),
        ("stair_step", stair_step_predecessors),
        ("heavy_precast_wall", heavy_precast_wall_predecessors),
        ("heavy_precast_open_end", heavy_precast_open_end_predecessors),
    ]

    xml_wbs_manager = _build_xml_wbs_manager_for_activities(xml_activities)
    # The WBS order set in the app (Programmes > WBS) is written into the schedule.
    if xml_wbs_manager.reorder(overrides.get("__wbs_order__")):
        print("  WBS order from the app applied")

    # Extra activities from SeaTable (with their baseline dates): their own WBS under the building's Construction node.
    adjustments = merge_extras(load_adjustments(), overrides.get("__extras__"))
    extras_acts = []
    if adjustments["extras"] and xml_activities:
        first_rec = xml_activities[0].get("rec", {})
        wbs_prefix = str(first_rec.get("wbs_prefix", "") or "").strip()
        root_name = f"{wbs_prefix} - Construction"
        if xml_wbs_manager.get_id(root_name):
            extras_name = f"{wbs_prefix} - {EXTRA_WBS_NAME}"
            xml_wbs_manager.register(extras_name, root_name)
            extras_acts = extra_activities(adjustments["extras"], [a["task_id"] for a in xml_activities], xml_wbs_manager.get_id(extras_name))
            if extras_acts:
                print(f"  {len(extras_acts)} extra activit{'y' if len(extras_acts) == 1 else 'ies'} added")
                xml_activities = xml_activities + extras_acts
                extra_edges = extra_predecessors(adjustments["extras"], [a["task_id"] for a in xml_activities])
                if extra_edges:
                    automatic_predecessor_sources.append(("extra_activities", extra_edges))

    # The scenario's programme rules (Rules panel): level tasks, sequences, links from the clash results, level links. They
    # add activities and links; the engine's own links they take over (replaceBuiltIn) are dropped here.
    rules = overrides.get("__rules__") or _rules.active()
    if extras_acts and pour_activities:
        # Where each extra activity goes in the WBS (its tag: on the level, in the level's Slabs group, or a folder of its own).
        for msg in place_extras(rules, extras_acts, xml_wbs_manager, pour_activities, str(pour_activities[0].get("rec", {}).get("building", "") or "")):
            print(f"  {msg}")
    rule_relations, late_rule_relations = [], None
    if not rules.empty and pour_activities:
        tasks = PourTasks(pour_activities)
        taken = [a["task_id"] for a in xml_activities]
        level_acts, level_rel, level_msgs = build_level_tasks(rules, tasks, xml_wbs_manager, taken)
        taken += [a["task_id"] for a in level_acts]
        seq_acts, seq_rel, seq_msgs = build_sequences(rules, tasks, xml_wbs_manager, taken)
        contact_rel, builtin, contact_msgs = build_contact_relations(rules, tasks, clashes)
        recipe_rel, recipe_msgs = build_recipe_links(rules, tasks)
        limit_rel, limit_msgs = build_limit_links(rules, tasks)
        recipe_rel, recipe_msgs = recipe_rel + limit_rel, recipe_msgs + limit_msgs + [f"Note: {n}" for n in rules.formula_notes]
        first_building = str(pour_activities[0].get("rec", {}).get("building", "") or "").upper()
        link_early, link_late, link_msgs = build_level_links(rules, tasks, extras_acts, level_acts, xml_activities + level_acts, first_building)
        attach_rel, attach_msgs = build_extra_attachments(rules, extras_acts, xml_activities + level_acts)
        link_early, link_msgs = link_early + attach_rel, link_msgs + attach_msgs
        if level_acts or seq_acts:
            xml_activities = xml_activities + level_acts + seq_acts
        if builtin:
            automatic_predecessor_sources = [(label, drop_builtin(preds, builtin.get(label, set()))) for label, preds in automatic_predecessor_sources]
        # (Pours sharing a Pour ID share their Task IDs, so the same link can come up twice: it is written once.)
        rule_relations, seen_links = [], set()
        for r in seq_rel + contact_rel + recipe_rel + level_rel + link_early:
            key = (r["pred"], r["succ"], r["type"])
            if key not in seen_links:
                seen_links.add(key)
                rule_relations.append(r)
        if link_late:
            programme = list(xml_activities)
            late_rule_relations = lambda open_ids: late_level_relations(link_late, open_ids, level_acts, programme, tasks)  # noqa: E731
        for message in level_msgs + seq_msgs + contact_msgs + recipe_msgs + link_msgs:
            print(f"  {message}")
        if level_acts:
            print(f"  {len(level_acts)} level task(s) added")
        if seq_acts:
            print(f"  {len(seq_acts)} sequence milestone(s) added")

    # Manual links that name activities by a selector (select:{...}) become links between Task IDs, now that every
    # generated activity (and the extras) exists.
    custom_relations, link_messages = resolve_relations(custom_relations, xml_activities)
    for message in link_messages:
        print(f"  {message}")
    project_building_code = (
        str(records[0].get("building", "DEFAULT") or "DEFAULT")
        if records else
        "DEFAULT"
    )
    project_wbs_root_id = str(_resolve_building_root_object_id(project_building_code))

    xml_root = create_p6_xml_root()
    add_project_and_calendar(
        xml_root,
        building_code=project_building_code,
        project_wbs_object_id=project_wbs_root_id,
        project_id=project_wbs_root_id,
    )
    xml_resources = add_resources(xml_root)

    relationship_stats = write_activities_and_relationships(
        xml_root, xml_activities, xml_resources, xml_wbs_manager,
        intra_predecessors=intra_predecessors,
        sequence_ss_predecessors=sequence_ss_predecessors,
        custom_relations=custom_relations,
        automatic_predecessor_sources=automatic_predecessor_sources,
        crew_table=crew_table_with_overrides(overrides),
        rule_relations=rule_relations,
        late_rule_relations=late_rule_relations,
    )
    skipped_edges_by_source = (relationship_stats or {}).get("skipped_edges_by_source", {})

    cpm_stats = apply_cpm_to_xml(xml_root, data_date)
    if cpm_stats:
        print(f"  CPM calculated: {cpm_stats.get('activities_updated', 0)} activities scheduled"
              + (" (cycle detected — some activities anchored at data date)" if cpm_stats.get("cycle_detected") else "")
              + f", project finish {cpm_stats.get('project_finish')}")

    # Real CPM-computed dates, read back off the XML we just calculated —
    # used to order "SequenceOrder Template" by when pours actually
    # happen (see excel_exporter._compute_pour_sequence_layers) rather
    # than an unweighted predecessor-hop count that ignores duration.
    task_start_dates = {}
    xml_project_elem = xml_root.find("Project")
    if xml_project_elem is not None:
        for act in xml_project_elem.findall("Activity"):
            task_id = act.findtext("Id")
            planned_start = act.findtext("PlannedStartDate")
            if task_id and planned_start:
                task_start_dates[task_id] = planned_start

    if extras_acts and xml_project_elem is not None:
        n = apply_baselines(xml_project_elem, extras_acts)
        if n:
            print(f"  {n} extra activit{'y' if n == 1 else 'ies'} given their baseline dates as target dates")

    save_p6_xml(xml_root, str(xml_path))
    # Why each link is there, for the app's inspector (read next to the XML; a failure to write it never fails a run).
    try:
        with open(str(xml_path) + ".why.json", "w", encoding="utf-8") as f:
            json.dump({"version": 1, "links": list(_xml_builder.LINK_SOURCES)}, f)
    except OSError:
        pass
    return {"intra_predecessors": intra_predecessors, "skipped_edges_by_source": skipped_edges_by_source, "task_start_dates": task_start_dates}


def overrides_from_scenario(data):
    """The generator's overrides from an app scenario file (JSON, see
    vite-plugins/scenarios.ts) instead of an Overrides workbook: the pour
    order, manual links and crews. {"sequence": [{"GUID", "Index", "Phase"}],
    "relations": [{"ActivityID1", "ActivityID2", "Relation", "Lag"}],
    "crews": [{"Phase", "PourType", "Trade", "Crew"}],
    "extras": [{"TaskID", "Name", "DurationDays", "BaselineStart", "BaselineFinish"}]}
    A link's ActivityID1 / ActivityID2 may be a selector (core/prs_links.py)."""
    data = data or {}
    sequence = []
    for item in data.get("sequence") or []:
        guid = str(item.get("GUID") or item.get("guid") or "").strip()
        index = item.get("Index", item.get("index"))
        if not guid or index in (None, ""):
            continue
        sequence.append({"Index": _safe_int(index), "GUID": guid, "Phase": str(item.get("Phase") or item.get("phase") or "").strip()})
    relations = []
    for r in data.get("relations") or []:
        a1, a2 = str(r.get("ActivityID1") or "").strip(), str(r.get("ActivityID2") or "").strip()
        if a1 and a2:
            relations.append({"ActivityID1": a1, "ActivityID2": a2,
                              "Relation": str(r.get("Relation") or "FS").strip().upper(),
                              "Lag": float(r.get("Lag") or 0)})
    crews = [{k: str(c.get(k, "") or "").strip() for k in ("Phase", "PourType", "Trade", "Crew")} for c in data.get("crews") or []]
    # The scenario's programme rules (docs/programme-rules) become the active ones, settings included: every lookup in
    # the generator (durations, rebar, crews, links) reads them. Without rules this puts the defaults back.
    rules = _rules.activate(data.get("rules"))
    return {
        "__rules__": rules,
        "__sequence_order__": sorted(sequence, key=lambda x: x["Index"]),
        "__relations__": relations,
        "__crews__": crews,
        "__extras__": [e for e in data.get("extras") or [] if isinstance(e, dict)],
        "__wbs_order__": data.get("wbsOrder") or {},
    }


def process_single_ifc(input_path, ifc_dir, xml_dir, xlsx_dir, create_ifc=True, run_clash=True,
                       generate_new_pour_ids=True, fast_reiterate=False, stage="all",
                       overrides_json=None, write_excel=True):
    """stage: "prepare" (fix classes, clash-detect, assign Pour IDs, write the
    enriched IFC, then stop — no XML/Excel), "schedule" (assumes "prepare"
    already ran: reuses its enriched IFC + cached clash results untouched,
    never re-assigns Pour IDs, generates XML then Excel, never re-writes the
    IFC), or "all" (previous single-pass behavior, respecting whatever
    create_ifc/generate_new_pour_ids/fast_reiterate the caller passed —
    default, for anyone not using --stage)."""
    input_path = Path(input_path)
    original_stem = input_path.stem

    excel_path = xlsx_dir / f"{original_stem}.xlsx"
    xml_path = xml_dir / f"{original_stem}.xml"
    ifc_path = ifc_dir / f"{original_stem}.ifc"

    # An app scenario file (JSON) replaces the legacy Overrides workbook.
    if overrides_json:
        with open(overrides_json, "r", encoding="utf-8") as f:
            overrides = overrides_from_scenario(json.load(f))
    else:
        overrides = load_overrides(str(excel_path))
        _rules.activate(None)

    # "schedule" stage structurally can't do what "prepare" already did:
    # Pour IDs are permanent once assigned (assigning them again would
    # renumber pours a second time), and re-fixing classes/re-clashing would
    # throw away Stage 1's cache for no reason (the source IFC is assumed
    # unchanged between stages 1 and 2 by definition). These are forced
    # regardless of what the caller passed for those flags.
    do_schedule = stage in ("schedule", "all")
    if stage == "prepare":
        create_ifc = True
    elif stage == "schedule":
        create_ifc = False
        generate_new_pour_ids = False
        fast_reiterate = True

    print(f"[{mp.current_process().name}] Processing → {input_path.name} (Option 3 Only, stage={stage})")

    # --fast-reiterate: fix_ifc_classes (IfcBuildingElementProxy -> real IFC
    # classes) and clash detection are both pure functions of the SOURCE IFC
    # geometry — they never depend on Excel overrides (SequenceOrder,
    # Relations, TaskID overrides, ...). So when only overrides changed
    # between runs, both are safe to skip entirely and reuse from the last
    # run, cutting out what's normally the majority of the wall-clock time.
    # Gated on a single fingerprint (source IFC mtime+size): if it still
    # matches what's stored in <ifc_dir>/<stem>.geometry_cache.json, both the
    # previously-fixed IFC (ifc_path itself) and the cached clash list are
    # reused; otherwise both run for real, and the cache is refreshed for
    # next time regardless of whether --fast-reiterate was passed (so a
    # single full run always leaves a fresh cache ready for a later
    # --fast-reiterate one).
    geometry_cache_path = ifc_dir / f"{original_stem}.geometry_cache.json"
    source_fingerprint = _source_fingerprint(input_path)
    cache = _load_geometry_cache(geometry_cache_path) if fast_reiterate else None
    cache_valid = bool(cache) and cache.get("fingerprint") == source_fingerprint

    try:
        _t0 = _time.perf_counter()
        if cache_valid and ifc_path.is_file():
            working_path, fixed = ifc_path, 0
            print(f"  [FAST] Reusing already-fixed IFC (source unchanged): {ifc_path.name}")
        else:
            working_path, fixed = fix_ifc_classes(input_path, output_path=ifc_path)
            if fixed:
                print(f"  Fixed {fixed} IFC classes")
        print(f"  [TIMING] fix_ifc_classes: {_time.perf_counter() - _t0:.1f}s")

        _t1 = _time.perf_counter()
        model = ifcopenshell.open(str(working_path))
        print(f"  [TIMING] ifcopenshell.open: {_time.perf_counter() - _t1:.1f}s")

        _t2 = _time.perf_counter()
        property_cache = {}
        for rel in model.by_type("IfcRelDefinesByProperties"):
            pset = rel.RelatingPropertyDefinition
            name = getattr(pset, "Name", None)
            if name:
                property_cache.setdefault(name, {})[getattr(rel.RelatedObjects[0] if rel.RelatedObjects else None, "GlobalId", None)] = pset
        print(f"  [TIMING] property_cache build: {_time.perf_counter() - _t2:.1f}s")

        # === CLASH DETECTION (now optional) ===
        _t3 = _time.perf_counter()
        clashes = []
        if run_clash:
            if cache_valid and cache.get("clashes") is not None:
                clashes = cache["clashes"]
                print(f"  [FAST] Reusing cached clash results (source unchanged): {len(clashes)} issues")
            else:
                clashes = run_pour_to_pour_clearance(str(working_path))
                print(f"  Clash detection completed: {len(clashes)} issues found")
                _save_geometry_cache(geometry_cache_path, source_fingerprint, clashes)
        else:
            print("  Skipping clash detection (--skip-clash)")
        print(f"  [TIMING] clash detection: {_time.perf_counter() - _t3:.1f}s")

        _t4 = _time.perf_counter()
        cached_bbox_heights = cache.get("bbox_heights") if cache_valid else None
        records = build_pour_records(model, property_cache, source_stem=original_stem,
                                     cached_bbox_heights=cached_bbox_heights)

        # Per-GUID geometry bbox heights are pure functions of the source
        # IFC (like the clash list), so they ride the same
        # <stem>.geometry_cache.json and are reused on a --fast-reiterate
        # run instead of re-running ifcopenshell.geom.create_shape for every
        # pour. Written back only when they were (re)computed this run.
        if cached_bbox_heights is None:
            bbox_heights = {
                r["element"].GlobalId: r.get("bbox_height")
                for r in records
                if "element" in r and hasattr(r["element"], "GlobalId")
            }
            clashes_for_cache = clashes if run_clash else ((cache or {}).get("clashes", []))
            _save_geometry_cache(geometry_cache_path, source_fingerprint, clashes_for_cache, bbox_heights)

        consolidate_spatial_structure(model, [{
            "element": r["element"],
            "building": r.get("building", "BLD"),
            "level_info": r["level_display"],
            "level_int": r.get("level_int", 0),
        } for r in records])
        print(f"  [TIMING] build_pour_records + consolidate_spatial_structure: {_time.perf_counter() - _t4:.1f}s")

        _t5 = _time.perf_counter()
        resolve_pour_ids(records, clashes, overrides, generate_new_pour_ids)

        activities = create_all_activities(records, overrides)

        # ====================== BUILD P6 XML (schedule stage only) ======================
        if do_schedule:
            built = build_schedule_xml(records, activities, clashes, overrides, xml_path)
            intra_predecessors = built["intra_predecessors"]
            skipped_edges_by_source = built["skipped_edges_by_source"]
            task_start_dates = built["task_start_dates"]
            print(f"  XML created: {xml_path.name}")
            print(f"  [TIMING] activities+relationships+CPM+XML (post-clash): {_time.perf_counter() - _t5:.1f}s")
        else:
            print("  Skipping schedule generation (stage=prepare)")

        # ====================== IFC (optional) ======================
        if create_ifc:
            pour_lookup = {r["element"].GlobalId: r for r in records if "element" in r and hasattr(r["element"], "GlobalId")}
            position_groups = build_position_groups(clashes, pour_lookup)

            for rec in records:
                proposed = rec.get("planning_proposed_pour_id")
                element = rec.get("element")
                selected = next((a for a in activities if a["rec"].get("element") == element and a.get("phase") == "Concrete"), None)
                task_id = selected.get("task_id", "") if selected else ""
                task_name = selected.get("task_name", "") if selected else ""

                attach_cwa_planning_properties(
                    model,
                    element,
                    rec.get("full_pour_id"),
                    rec.get("alt_pour_id", rec.get("original_pour_id", "")),
                    rec.get("lg1"),
                    rec.get("lg2", ""),
                    task_id,
                    task_name,
                    rec.get("concrete_wbs_name", ""),
                    rec.get("volume", 0),
                    proposed,
                    replace_model_pour_id=generate_new_pour_ids,
                )
                attach_clash_relationship_properties(
                    model, element, position_groups.get(element.GlobalId, {})
                )
                set_pour_name_for_sorting(element, proposed)

            for rec in sorted(records, key=lambda r: _proposed_id_sort_key(r.get("planning_proposed_pour_id", ""))):
                set_pour_name_for_sorting(rec.get("element"), rec.get("planning_proposed_pour_id"))

            _reorder_ifc_tree_by_name(model)
            apply_colors_to_model(model)
            optimize_ifc_for_import(model, ifc_path)
            save_ifc_model(model, str(ifc_path))

            with open(ifc_path, 'r', encoding='utf-8') as f:
                content = f.read().replace("FILE_SCHEMA (('IFC2X3'));", "FILE_SCHEMA (('IFC4'));")
            with open(ifc_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"  IFC created: {ifc_path.name}")
        else:
            print("  Skipping IFC creation (--skip-ifc)")

        # Excel (schedule stage only — reads back XML-derived predecessors/dates
        # built above, so it can't run for stage=prepare, which skipped those)
        if do_schedule and write_excel:
            _t6 = _time.perf_counter()
            export_activities_to_excel(
                activities, str(excel_path), clashes, records=records, overrides=overrides,
                numbering_mode="stage_priority", task_predecessors=intra_predecessors,
                task_start_dates=task_start_dates, skipped_edges_by_source=skipped_edges_by_source,
            )
            print(f"  [TIMING] activities+XML+Excel (post-clash): {_time.perf_counter() - _t6:.1f}s")

        print(f"[{mp.current_process().name}] SUCCESS → {input_path.name}")
        return (
            True, input_path.name, None,
            str(excel_path) if do_schedule else None,
            str(xml_path) if do_schedule else None,
        )

    except Exception as e:
        err = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc(limit=3)}"
        print(f"[{mp.current_process().name}] FAILED → {input_path.name}\n{err}")
        return False, input_path.name, err, None, None


def _run_blender_stage(ifc_files):
    """stage=blender: for each model, if its per-model .blend already exists,
    just touch "<blend-name>.resync_trigger" next to it — if that .blend is
    open in Blender with Auto-Resync enabled (see tab_4d/op_schedule_import.py
    in insightplan_dev), its own watcher notices within ~1s and does Sync All
    + re-bake + save itself, no new Blender process. If the .blend doesn't
    exist yet, this stage can't build it (that needs a real IFC import,
    Automatch, and bake — a much heavier job than touching a file) — it just
    says so, pointing at the workflow that does."""
    per_model_dir = BLENDER_DIR / "per_model"
    for f in ifc_files:
        blend_path = per_model_dir / f"{f.stem}.blend"
        if blend_path.is_file():
            trigger_path = blend_path.with_suffix(".resync_trigger")
            trigger_path.touch()
            print(f"  Trigger dropped for {blend_path.name} — if it's open in Blender with Auto-Resync on, "
                  f"it will sync + re-bake within ~1s. If not, run resync_existing_blend.py headlessly instead.")
        else:
            print(f"  No existing {blend_path.name} — nothing to trigger. Build it first "
                  f"(run_parallel_pipeline.py / headless_pipeline.py per_model_single, e.g. Workflow 2).")


def main(input_file=None, input_dir=None, output_dir=None, max_workers=None):
    # output_dir (if given) is treated as the root under which the type-based
    # folders live; defaults to the repository root (config.DEFAULT_OUTPUT_DIR).
    output_root = Path(output_dir).resolve() if output_dir else Path(DEFAULT_OUTPUT_DIR)
    ifc_dir = ENRICHED_IFC_DIR if not output_dir else output_root / "2-enriched-ifc"
    xml_dir = XML_DIR if not output_dir else output_root / "3-schedule-xml"
    xlsx_dir = XLSX_DIR if not output_dir else output_root / "4-schedule-xlsx"
    for d in (ifc_dir, xml_dir, xlsx_dir):
        d.mkdir(parents=True, exist_ok=True)

    ifc_files = sorted(Path(input_dir).resolve().glob("*.ifc")) if input_dir else [Path(input_file or INPUT_FILE).resolve()]

    print(f"\n=== OPTION 3 ONLY MODE ===")
    print(f"Files: {len(ifc_files)}")

    if not ifc_files:
        print("No IFC files found.")
        return

    stage = args.stage

    if stage == "blender":
        _run_blender_stage(ifc_files)
        print(f"\n{'═'*80}\nCOMPLETE\n{'═'*80}")
        return

    create_ifc = not args.skip_ifc
    run_clash = not args.skip_clash
    generate_new_pour_ids = bool(args.generate_new_pour_ids)
    fast_reiterate = bool(args.fast_reiterate)

    if stage == "schedule":
        mode_label = "Use Existing Model IDs (forced — stage=schedule never re-assigns Pour IDs)"
    else:
        mode_label = "Generate New Proposed IDs" if generate_new_pour_ids else "Use Existing Model IDs"
    print(f"Stage: {stage} | Pour ID mode: {mode_label}")

    with ProcessPoolExecutor(max_workers=max_workers or max(1, mp.cpu_count() - 1)) as executor:
        futures = {
            executor.submit(process_single_ifc, f, ifc_dir, xml_dir, xlsx_dir, create_ifc, run_clash, generate_new_pour_ids, fast_reiterate, stage,
                            args.overrides_json, not args.skip_excel): f.name
            for f in ifc_files
        }

        success = 0
        excels = []
        for future in as_completed(futures):
            ok, name, err, ex, xp = future.result()
            if ok:
                success += 1
                if ex:
                    excels.append(Path(ex))

    if excels and not args.skip_master_excel:
        merge_excel_files(excels, xlsx_dir / "MASTER_CWA_Planning_Option3.xlsx")
    elif excels:
        print("Skipping master Excel merge (--skip-master-excel)")

    print(f"\n{'═'*80}\nCOMPLETE - {success}/{len(ifc_files)} successful\n{'═'*80}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-f", type=str, default=str(INPUT_FILE))
    parser.add_argument("--input-dir", "-i", type=str)
    parser.add_argument("--output-dir", "-o", type=str, default=None,
                    help="Root folder under which 2-enriched-ifc/3-schedule-xml/4-schedule-xlsx are created (default: project root)")
    parser.add_argument("--workers", "-w", type=int)
    parser.add_argument(
        "--stage", choices=["prepare", "schedule", "blender", "all"], default="all",
        help="prepare: fix classes, clash-detect, assign Pour IDs (if --generate-new-pour-ids), write the "
             "enriched IFC, then stop -- no XML/Excel. Run once per new model version. "
             "schedule: assumes 'prepare' already ran -- reuses its enriched IFC + cached clash results "
             "untouched, never re-assigns Pour IDs, generates XML then Excel, never re-writes the IFC. Run "
             "this every time overrides (SequenceOrder/Relations/...) change. "
             "blender: touches a trigger file next to each model's existing per-model .blend so an "
             "already-open Blender session (with Auto-Resync on) syncs + re-bakes itself; prints instructions "
             "instead if that .blend doesn't exist yet. "
             "all (default): previous single-pass behavior, respecting --skip-ifc/--skip-clash/"
             "--generate-new-pour-ids/--fast-reiterate as before.")
    parser.add_argument("--skip-ifc", action="store_true",
                    help="Skip IFC file creation (only generate XML + Excel)")
    parser.add_argument("--skip-clash", action="store_true",
                    help="Skip clash detection (faster run, no Group Clashes sheet)")
    parser.add_argument("--overrides-json", type=str, default=None,
                    help="App scenario file (JSON: sequence, relations, crews) used instead of the Overrides workbook")
    parser.add_argument("--skip-excel", action="store_true",
                    help="Do not write the Excel report (the XML is all the app needs)")
    parser.add_argument("--skip-master-excel", action="store_true",
                    help="Skip merging per-model Excels into MASTER_CWA_Planning_Option3.xlsx (faster run)")
    parser.add_argument("--fast-reiterate", action="store_true",
                    help="Reuse the fixed IFC + cached clash results from the last run when the source IFC "
                         "is unchanged (mtime+size) — for schedule-only reruns (SequenceOrder/Relations/override "
                         "edits) where the geometry itself hasn't changed. Unsafe if the source IFC HAS changed "
                         "and the cache wasn't invalidated for some other reason; run once without this flag "
                         "after any real model update.")
    parser.add_argument(
        "--generate-new-pour-ids",
        action=argparse.BooleanOptionalAction,
        default=GENERATE_NEW_POUR_IDS,
        help="Generate new proposed pour IDs (use --no-generate-new-pour-ids to keep model IDs)"
    )
    args = parser.parse_args()
    main(args.input, args.input_dir, args.output_dir, args.workers)