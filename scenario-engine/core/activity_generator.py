# core/activity_generator.py
from core.stair_steps import stair_group_label
from core import rules as _rules
from config import (
    PROJECT_SHORT,
    PHASE_DEFINITIONS,
    DEFAULT_COMPONENT_DAYS,
    DEFAULT_CHAIN,
    DEFAULT_HEAVY_PRECAST_CHAIN,
    DEFAULT_PRECAST_CHAIN,
    DEFAULT_PHASE_DAYS,
)


# Duration rows set these by their component: the activity's number is built from them.
_COMPONENT_PHASES = {"Rebar", "Embedments", "Formwork", "Concrete"}


def _durations_for(rec, key):
    """The component days (Rebar, Embedments, Formwork, Concrete): the neutral defaults with the scenario's rules on top."""
    durations = dict(DEFAULT_COMPONENT_DAYS)
    for phase, days in _rules.active().phase_days(rec).items():
        if phase in _COMPONENT_PHASES:
            durations[phase] = days
    return durations


def _default_crew(phase, rec):
    """The people on a phase by the scenario's crews (for a duration worked out from a quantity that names no crew)."""
    from core.resources import crews_for
    return sum(size for _trade, size in crews_for(phase, rec, {}))


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

    # ── PRECAST ──────────────────────────────────────────────────────────────
    if conc_stage == "PRECAST":
        wbs_oid = rec["concrete_wbs_oid"]
        prev_task_id = None

        # The phases are the chain of the rules that fits (Rules > Chains), else the engine's own: Installation and Stitching, and for heavy
        # precast also Propping, Curing and Propping Removal.
        chain = _rules.active().chain_for(rec) or (DEFAULT_HEAVY_PRECAST_CHAIN if _rules.family_of(rec) == "heavyPrecast" else DEFAULT_PRECAST_CHAIN)
        phase_definitions = [
            {"name": c["phase"], "suffix": c["suffix"], "resource": "", "duration_days": c.get("days", DEFAULT_PHASE_DAYS), "task_name_suffix": f" - {c.get('label') or c['phase']}",
             "follows": c.get("follows") or [], "finish_after": bool(c.get("finish_after")), "gates": bool(c.get("gates"))}
            for c in chain
        ]

        ruled = _rules.active().phase_days(rec)
        for phase in phase_definitions:
            duration = ruled.get(phase["name"], phase["duration_days"])
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
                "follows": phase.get("follows") or [],
                "finish_after": bool(phase.get("finish_after")),
            }
            if phase.get("gates"):
                _rules.active().gate_tasks.add(final_task_id)
            activities.append(activity)
            prev_task_id = final_task_id

        return activities

    # ── NORMAL IN-SITU CONCRETE ─────────────────────────────────────────────
    is_external = rec.get("is_external", False)
    is_double = rec.get("is_double_height", False)

    # Slab detection
    is_slab = any(keyword in pour_type_raw for keyword in [
        "SLAB", "MAIN_SLAB", "RAFT", "PIT", "PITS & RAFT", "FLOOR", "SLAB ON GRADE"
    ])
    # Landings are decked like slabs (Decking -> Rebar -> Concrete), and in-situ stairs
    # (precast ones returned above) get their own WBS group with Rebar / Formwork / Concrete.
    is_landing = "LANDING" in pour_type_raw
    is_stair = "STAIR" in pour_type_raw

    key = determine_duration_key(pour_type_raw, is_external, is_double)
    durations = _durations_for(rec, key)
    ruled = _rules.active().phase_days(rec)  # days the scenario's rules set by phase name

    # ── WBS BASE LOGIC ───────────────────────────────────────────────────────
    wbs_oid = rec["concrete_wbs_oid"]

    if "WALL" in pour_type_raw:
        direction = "External" if is_external else "Internal"
        wall_wbs_base = f"{rec['wbs_prefix']} - {rec['level_display']} - {direction} Walls"
        # Register phase sub-WBS if needed
        if rec.get("phase") in ["Rebar", "Formwork", "Concrete"]:
            sub_wbs_name = f"{wall_wbs_base} - {rec.get('phase')}"
            wbs_oid = wbs_manager.register(sub_wbs_name, parent_name=wall_wbs_base) or wbs_oid

    elif is_landing:
        # Like a slab: Group "Landings" → individual "Landing XXXX"
        landing_group_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Landings"
        landing_wbs_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Landing {rec.get('task_pour_id', rec.get('pour_id', ''))}"
        wbs_manager.register(landing_group_name)
        wbs_oid = wbs_manager.register(landing_wbs_name, parent_name=landing_group_name)

    elif is_stair:
        # In-situ stair: its own group, split by Rebar / Formwork / Concrete like the walls.
        # A step (a small stair pour, see core/stair_steps.py) has its own group, on its stair flight's level when it has one.
        wrec = rec.get("stair_parent") or rec
        stair_group_name = f"{wrec['wbs_prefix']} - {wrec['level_display']} - {stair_group_label(rec)}"
        wbs_oid = wbs_manager.register(stair_group_name)
        for sub in ("Rebar", "Formwork", "Concrete"):
            wbs_manager.register(f"{stair_group_name} - {sub}", parent_name=stair_group_name)

    elif is_slab:
        # === CLEAN SLAB WBS: Group "Slabs" → individual "Slab XXXX" ===
        slab_group_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Slabs"
        
        # Clean name: "Slab 1071" instead of "Slabs - Slab 1071"
        slab_wbs_name = f"{rec['wbs_prefix']} - {rec['level_display']} - Slab {rec.get('task_pour_id', rec.get('pour_id', ''))}"
        
        wbs_oid = wbs_manager.register(slab_wbs_name, parent_name=slab_group_name)

    # ── PHASE SEQUENCE ───────────────────────────────────────────────────────
    # The chain of the rules that fits this pour (Rules > Chains), else the engine's Rebar, Formwork and Concrete.
    chain = _rules.active().chain_for(rec) or DEFAULT_CHAIN
    phase_sequence = [
        {"original_name": c["phase"], "display_name": c["phase"], "suffix": c["suffix"], "short_label": c.get("label") or c["phase"], "material": c.get("material", ""),
         "follows": c.get("follows") or [], "finish_after": bool(c.get("finish_after")), "gates": bool(c.get("gates"))}
        for c in chain
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

        if seq.get("material") in ("rebar", "concrete"):
            phase_def = {**phase_def, "resource": f"{PROJECT_SHORT}-{'R' if seq['material'] == 'rebar' else 'C'}"}

        # Calculate duration
        if isinstance(phase_def.get("duration"), str):
            duration = durations.get(phase_def["duration"], 1.0)
        else:
            duration = sum(durations.get(k, 0) for k in phase_def.get("duration", []))
        # The scenario's rules: a phase named in a duration row (Decking, Under Slab, Curing...), or a duration worked out
        # from a quantity (Rules > Durations), replaces the number above.
        if seq["display_name"] not in _COMPONENT_PHASES and seq["display_name"] in ruled:
            duration = ruled[seq["display_name"]]
        computed = _rules.active().computed_days(rec, seq["display_name"], _default_crew(seq["display_name"], rec))
        if computed is not None:
            duration = computed

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
        if is_stair and rec.get("stair_parent_pour_id"):
            default_task_name += f" (part of stair {rec['stair_parent_pour_id']})"

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
            # In-situ stair activities sit in the group's Rebar / Formwork / Concrete sub-WBS.
            "wbs_oid": (
                wbs_manager.get_id(f"{stair_group_name} - {seq['original_name']}") or wbs_oid
                if is_stair and not is_landing else wbs_oid
            ),
            "volume": rec["volume"] if phase_def.get("resource") == f"{PROJECT_SHORT}-C" else None,
            "rebar_weight_tonnes": rec.get("rebar_weight_tonnes", 0) if "Rebar" in seq["original_name"] else None,
            "phase_order": phase_order_counter,
            "predecessor": prev_task_id,
            "follows": seq.get("follows") or [],
            "finish_after": bool(seq.get("finish_after")),
        }
        if seq.get("gates"):
            _rules.active().gate_tasks.add(final_task_id)

        activities.append(activity)
        prev_task_id = final_task_id
        phase_order_counter += 1

    return activities