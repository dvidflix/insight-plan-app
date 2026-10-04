# core/ifc_writer.py
import ifcopenshell.api

from config import ALT_POUR_ID_PROP


def _iter_property_sets(element):
    for rel in getattr(element, "IsDefinedBy", []) or []:
        pset = getattr(rel, "RelatingPropertyDefinition", None)
        if pset is not None and hasattr(pset, "HasProperties"):
            yield pset


def _extract_nominal_value(prop):
    nominal = getattr(prop, "NominalValue", None)
    if nominal is None:
        return ""
    wrapped = getattr(nominal, "wrappedValue", nominal)
    return str(wrapped or "").strip()


def _replace_model_pour_id(model, element, pour_id_value, alt_pour_id=""):
    properties_to_update = {"Pour ID Number", "PourID"}
    for pset in _iter_property_sets(element):
        updates = {}
        resolved_alt_pour_id = str(alt_pour_id or "").strip()
        has_alt_field = False
        for prop in getattr(pset, "HasProperties", []) or []:
            prop_name = getattr(prop, "Name", None)
            if prop_name == ALT_POUR_ID_PROP:
                has_alt_field = True
            if prop_name in properties_to_update:
                if not resolved_alt_pour_id:
                    resolved_alt_pour_id = _extract_nominal_value(prop)
                updates[prop_name] = pour_id_value
        if resolved_alt_pour_id and (updates or has_alt_field):
            updates[ALT_POUR_ID_PROP] = resolved_alt_pour_id
        if updates:
            ifcopenshell.api.run("pset.edit_pset", model, pset=pset, properties=updates)


def attach_cwa_planning_properties(model, element, full_pour_id, alt_pour_id, lg1, lg2, task_id, task_name, wbs_name, volume, planning_proposed_pour_id=None, replace_model_pour_id=False):
    """Add CWA_Planning property set and optionally promote the proposed pour ID into the source model properties."""
    # Set element Name to PlanningProposedPourID (fallback to Full Pour ID if missing)
    element.Name = planning_proposed_pour_id if planning_proposed_pour_id else full_pour_id

    if replace_model_pour_id and planning_proposed_pour_id:
        _replace_model_pour_id(model, element, planning_proposed_pour_id, alt_pour_id=alt_pour_id)
    
    cwa_planning_properties = {
        "FullPourID": full_pour_id,
        ALT_POUR_ID_PROP: alt_pour_id if alt_pour_id is not None else "",
        "Include": True,
        "LogicGroup1": lg1,
        "LogicGroup2": lg2,
        "PlanningProposedPourID": planning_proposed_pour_id if planning_proposed_pour_id is not None else "",
        "TaskID": task_id,
        "TaskName": task_name,
        "WBS": wbs_name,
        "Volume": volume
    }
    if replace_model_pour_id and planning_proposed_pour_id:
        cwa_planning_properties["Pour ID Number"] = planning_proposed_pour_id

    pset = ifcopenshell.api.run("pset.add_pset", model, product=element, name="CWA_Planning")
    ifcopenshell.api.run("pset.edit_pset", model, pset=pset, properties=cwa_planning_properties)


def attach_clash_relationship_properties(model, element, position_group):
    """Writes a CWA_ClashRelations pset onto element listing, by GlobalId,
    which other clashing pours sit Below/Above/Side of it (per
    core.clash_position.build_position_groups). This is the same channel
    CWA_Planning already uses to hand data to InsightPlan's Blender addon —
    once the IFC is opened there, these are just ordinary object
    properties, so the addon can build a "select pours below/above/beside
    me" UI by reading them straight off the selected object with no
    separate database to load.

    position_group: {"Below": [...GlobalIds...], "Above": [...], "Side": [...],
    "Undetermined": [...]}, as produced per-GUID by build_position_groups().
    No-ops (no pset written) if there are no clashes at all for this element."""
    below = position_group.get("Below", [])
    above = position_group.get("Above", [])
    side = position_group.get("Side", [])
    undetermined = position_group.get("Undetermined", [])

    if not (below or above or side or undetermined):
        return

    properties = {
        "ClashBelowGUIDs": ",".join(below),
        "ClashAboveGUIDs": ",".join(above),
        "ClashSideGUIDs": ",".join(side),
        "ClashUndeterminedGUIDs": ",".join(undetermined),
        "ClashBelowCount": len(below),
        "ClashAboveCount": len(above),
        "ClashSideCount": len(side),
    }

    pset = ifcopenshell.api.run("pset.add_pset", model, product=element, name="CWA_ClashRelations")
    ifcopenshell.api.run("pset.edit_pset", model, pset=pset, properties=properties)


def save_ifc_model(model, filepath):
    model.write(filepath)
    print(f"IFC model with planning info saved: {filepath}")