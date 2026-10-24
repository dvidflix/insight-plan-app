"""The WBS the generator made before WBS rules (core/xml_builder.py _build_xml_wbs_manager_for_activities as it was, kept unchanged as a reference:
test_wbs_rules.py checks that the default rules, wbs_default_rules.json, give exactly this WBS)."""
from collections import defaultdict

from config import PROJECT_SHORT
from core.helpers import title_case
from core.stair_steps import stair_group_label
from core.xml_builder import (WBS_PREFIX, _is_insitu_stair, _normalized_pour_type, _phase_sort_rank, _resolve_building_root_object_id,
                              _wbs_type_sort_rank, _xml_level_label, _xml_zone_label, _xml_zone_sort_rank)


def legacy_wbs_manager(activities):
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

        # A work item with a name of its own (Generate's packages): one WBS under the level, named after it (building + level + package),
        # whatever words its group has.
        own = str(rec.get("display_type", "") or "").strip()
        if own:
            own_name = f"{wbs_prefix} - {zone_segment}{level_display} - {own}"
            xml_wbs.register(own_name, level_name)
            act["wbs_oid"] = xml_wbs.get_id(own_name)
            continue

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
