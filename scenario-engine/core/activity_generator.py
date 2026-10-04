# core/activity_generator.py
from config import (
    PROJECT_SHORT,
    PHASE_DEFINITIONS,
    DURATIONS,
    PRECAST_ACTIVITY_DEFINITIONS,
    PRECAST_PROPPING_DEFINITION,
    PRECAST_CURING_DEFINITION,
    PRECAST_PROPPING_REMOVAL_DEFINITION,
)

try:
    from config import ENABLE_WORKS_BEFORE_SLAB
except ImportError:
    ENABLE_WORKS_BEFORE_SLAB = False


def _is_heavy_precast_rec(rec):
    ptype = str(rec.get("pour_type", "") or "").replace(" ", "_").upper()
    gtype = str(rec.get("general_pour_type", "") or "").replace(" ", "_").upper()
    return ptype == "HEAVY_PRECAST" or gtype == "HEAVY_PRECAST"


def _task_zone_prefix(rec):
    if rec.get("is_disconnected", False):
        return "Disconnected - "
    if rec.get("is_connected", False):
        return "Connected - "
    return ""


def determine_duration_key(pour_type, is_external, is_double_height):
    """
    Returns the correct duration key.
    Supports:
    - WALL, EXTERNAL WALL, INTERNAL WALL
    - Double Height detection
    """
    normalized = str(pour_type or "").replace(" ", "_").upper()

    # Check if it's any kind of wall
    if "WALL" not in normalized:
        # Non-wall types
        if normalized in {"SLAB", "MAIN_SLAB", "RAFT", "PITS_&_RAFT", "PIT"}:
            return "Standard Internal Slab"
        return "Other"

    # It's a wall → apply Double Height logic
    prefix = "Double Height " if is_double_height else "Standard "
    suffix = "External Wall" if is_external else "Internal Wall"
    return prefix + suffix


def create_activities(rec, wbs_manager, overrides=None):
    if overrides is None:
        overrides = {}

    activities = []
    guid = rec["element"].GlobalId
    conc_stage = str(rec.get("conc_stage", "")).strip().upper()
    pour_type_raw = str(rec.get("pour_type", "")).strip().upper()
    pour_type_norm = pour_type_raw.replace(" ", "_")

    # Requested exclusion: do not create activities for RAFT stage 2.
    if pour_type_norm == "RAFT" and conc_stage == "2":
        return activities

    # ── PRECAST ──────────────────────────────────────────────────────────────
    if conc_stage == "PRECAST":
        wbs_oid = rec["concrete_wbs_oid"]
        prev_task_id = None

        phase_definitions = PRECAST_ACTIVITY_DEFINITIONS
        if _is_heavy_precast_rec(rec):
            # Propping (erect temp supports) precedes Installation; Curing
            # (walls-under reaching strength) + Propping Removal follow
            # Stitching. Curing's real predecessor is cross-record (the
            # underlying wall's Concrete, not this Stitching task) — see
            # xml_builder._build_heavy_precast_wall_predecessors_from_clashes,
            # which adds that edge alongside these intra-chain ones.
            phase_definitions = (
                [PRECAST_PROPPING_DEFINITION]
                + list(PRECAST_ACTIVITY_DEFINITIONS)
                + [PRECAST_CURING_DEFINITION, PRECAST_PROPPING_REMOVAL_DEFINITION]
            )

        for phase in phase_definitions:
            duration = phase["duration_days"]
            if duration <= 0:
                continue

            suffix = phase["suffix"]
            base_task_id = f"{rec['task_id_base']}{suffix}"

            building = rec.get('building', '??')
            level_code = rec.get('level_code', '??').upper()
            lg1 = rec.get('lg1', '??')
            pour_id = rec.get('task_pour_id', rec.get('pour_id', '??'))
            zone_prefix = _task_zone_prefix(rec)
            task_name_base = f"{building} - {level_code} - {zone_prefix}{lg1} {pour_id}"
            default_task_name = task_name_base + phase["task_name_suffix"]

            phase_key = f"{guid}_{phase['name']}"
            ov = overrides.get(phase_key) or overrides.get(guid, {})

            final_task_id = ov.get("TaskID") or base_task_id
            final_task_name = ov.get("TaskName") or default_task_name

            activity = {
                "rec": rec,
                "phase": phase["name"],
                "suffix": suffix,
                "task_id": final_task_id,
                "task_name": final_task_name,
                "duration_days": duration,
                "resource": phase["resource"],
                "wbs_oid": wbs_oid,
                "volume": None,
                "rebar_weight_tonnes": None,
                "phase_order": len(activities),
                "predecessor": prev_task_id,
            }
            activities.append(activity)
            prev_task_id = final_task_id

        return activities

    # Requested simplification: Pedestal stage 2 has a single combined activity.
    if pour_type_norm == "PEDESTAL" and conc_stage == "2":
        key = determine_duration_key(pour_type_raw, rec.get("is_external", False), rec.get("is_double_height", False))
        durations = DURATIONS.get(key, DURATIONS["Other"])
        duration = (
            durations.get("Rebar", 0)
            + durations.get("Embedments", 0)
            + durations.get("Formwork", 0)
            + durations.get("Concrete", 0)
        )
        if duration <= 0:
            duration = 1.0

        task_name_base = (
            f"{rec.get('building', '??')} - "
            f"{rec.get('level_code', '??').upper()} - "
            f"{_task_zone_prefix(rec)}{rec.get('lg1', '??')} {rec.get('task_pour_id', rec.get('pour_id', '??'))}"
        )
        default_task_name = f"{task_name_base} - Rebar, Formwork and Concrete"

        phase_key = f"{guid}_Rebar, Formwork and Concrete"
        ov = overrides.get(phase_key) or overrides.get(guid, {})

        activities.append({
            "rec": rec,
            "phase": "Rebar, Formwork and Concrete",
            "suffix": "-RFC",
            "task_id": ov.get("TaskID") or f"{rec['task_id_base']}-RFC",
            "task_name": ov.get("TaskName") or default_task_name,
            "duration_days": duration,
            "resource": None,
            "wbs_oid": rec["concrete_wbs_oid"],
            "volume": None,
            "rebar_weight_tonnes": None,
            "phase_order": 0,
            "predecessor": None,
        })
        return activities

    # ── NORMAL IN-SITU CONCRETE ─────────────────────────────────────────────
    is_external = rec.get("is_external", False)
    is_double = rec.get("is_double_height", False)
    is_raft = pour_type_norm == "RAFT"

    # Slab detection
    is_slab = any(keyword in pour_type_raw for keyword in [
        "SLAB", "MAIN_SLAB", "RAFT", "PIT", "PITS & RAFT", "FLOOR", "SLAB ON GRADE"
    ])

    key = determine_duration_key(pour_type_raw, is_external, is_double)
    durations = DURATIONS.get(key, DURATIONS["Other"])

    # ── WBS BASE LOGIC ───────────────────────────────────────────────────────
    wbs_oid = rec["concrete_wbs_oid"]

    if "WALL" in pour_type_raw:
        direction = "External" if is_external else "Internal"
        wall_wbs_base = f"{rec['wbs_prefix']} - {rec['level_display']} - {direction} Walls"
        # Register phase sub-WBS if needed
        if rec.get("phase") in ["Rebar", "Formwork", "Concrete"]:
            sub_wbs_name = f"{wall_wbs_base} - {rec.get('phase')}"
            wbs_oid = wbs_manager.register(sub_wbs_name, parent_name=wall_wbs_base) or wbs_oid

    elif is_slab:
        # === CLEAN SLAB WBS: Group "Slabs" → individual "Slab XXXX" ===
        slab_group_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Slabs"
        
        # Clean name: "Slab 1071" instead of "Slabs - Slab 1071"
        slab_wbs_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Slab {rec.get('task_pour_id', rec.get('pour_id', ''))}"
        
        wbs_oid = wbs_manager.register(slab_wbs_name, parent_name=slab_group_name)

    # ── PHASE SEQUENCE ───────────────────────────────────────────────────────
    if is_slab and is_raft:
        phase_sequence = [
            {"original_name": "Rebar",       "display_name": "Rebar",       "suffix": "-R",  "short_label": "Rebar"},
            {"original_name": "EOP on Slab", "display_name": "EOP on Slab", "suffix": "-E2", "short_label": "EOP on Slab"},
            {"original_name": "FWK",         "display_name": "FWK",         "suffix": "-F",  "short_label": "FWK"},
            {"original_name": "Concrete",    "display_name": "Concrete",    "suffix": "-C",  "short_label": "Concrete"},
        ]
    elif is_slab:
        phase_sequence = [
            {"original_name": "Works before slab", "display_name": "Works before slab", "suffix": "-ALL", "short_label": "Works before slab"},
            {"original_name": "Decking",           "display_name": "Decking",           "suffix": "-DK",  "short_label": "Decking"},
            {"original_name": "Under Slab",         "display_name": "Under Slab",       "suffix": "-D",   "short_label": "Under Slab"},
            {"original_name": "Rebar",              "display_name": "Rebar",            "suffix": "-R",   "short_label": "Rebar"},
            {"original_name": "EOP on Slab",        "display_name": "EOP on Slab",      "suffix": "-E2",  "short_label": "EOP on Slab"},
            {"original_name": "FWK",                "display_name": "FWK",              "suffix": "-F",   "short_label": "FWK"},
            {"original_name": "Concrete",           "display_name": "Concrete",         "suffix": "-C",   "short_label": "Concrete"},
        ]
        if not ENABLE_WORKS_BEFORE_SLAB:
            phase_sequence = [p for p in phase_sequence if p["original_name"] != "Works before slab"]
    else:
        phase_sequence = [
            {"original_name": "Rebar",    "display_name": "Rebar",    "suffix": "-R", "short_label": "Rebar"},
            {"original_name": "Formwork", "display_name": "Formwork", "suffix": "-F", "short_label": "EP+FWK"},
            {"original_name": "Concrete", "display_name": "Concrete", "suffix": "-C", "short_label": "Concrete"},
        ]

    prev_task_id = None
    phase_order_counter = 0

    for seq in phase_sequence:
        phase_def = next(
            (p for p in PHASE_DEFINITIONS if p["name"] == seq["original_name"]),
            None
        ) or {
            "name": seq["original_name"],
            "duration": "Standard Internal Slab",
            "resource": f"{PROJECT_SHORT}-C" if seq["original_name"] == "Concrete" else f"{PROJECT_SHORT}-R" if "Rebar" in seq["original_name"] else None,
            "wbs_sub": None
        }

        # Calculate duration
        if isinstance(phase_def.get("duration"), str):
            duration = durations.get(phase_def["duration"], 1.0)
        else:
            duration = sum(durations.get(k, 0) for k in phase_def.get("duration", []))

        if duration <= 0:
            continue

        # Task naming
        suffix = seq["suffix"]
        base_task_id = f"{rec['task_id_base']}{suffix}"

        task_name_base = (
            f"{rec.get('building', '??')} - "
            f"{rec.get('level_code', '??').upper()} - "
            f"{_task_zone_prefix(rec)}{rec.get('lg1', '??')} {rec.get('task_pour_id', rec.get('pour_id', '??'))}"
        )

        default_task_name = f"{task_name_base} - {seq['short_label']}"

        # Override handling
        phase_key = f"{guid}_{seq['display_name']}"
        ov = overrides.get(phase_key) or overrides.get(guid, {})

        final_task_id = ov.get("TaskID") or base_task_id
        final_task_name = ov.get("TaskName") or default_task_name

        activity = {
            "rec": rec,
            "phase": seq["display_name"],
            "suffix": suffix,
            "task_id": final_task_id,
            "task_name": final_task_name,
            "duration_days": duration,
            "resource": phase_def.get("resource"),
            "wbs_oid": wbs_oid,
            "volume": rec["volume"] if phase_def.get("resource") == f"{PROJECT_SHORT}-C" else None,
            "rebar_weight_tonnes": rec.get("rebar_weight_tonnes", 0) if "Rebar" in seq["original_name"] else None,
            "phase_order": phase_order_counter,
            "predecessor": prev_task_id,
        }

        activities.append(activity)
        prev_task_id = final_task_id
        phase_order_counter += 1

    return activities