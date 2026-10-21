"""The level gate (core/xml_builder._build_level_gate_predecessors): a slab's first task waits for the
Concrete of the pours on the level below that physically touch it, not for the whole level.

Geometry is faked (get_plan_footprint is patched), so these run without an IFC file."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import xml_builder  # noqa: E402


def pour(guid, level, pour_type, x0, y0, x1, y1, z0, z1, building="B1"):
    """One pour as the generator sees it: an element, its record, and its footprint."""
    element = SimpleNamespace(GlobalId=guid)
    rec = {"element": element, "building": building, "level_int": level, "pour_type": pour_type, "conc_stage": ""}
    return rec, (box(x0, y0, x1, y1), z0, z1)


def activities_for(pours):
    """Decking + Concrete for a slab, a lone Concrete for anything else; footprints keyed by element."""
    acts, footprints = [], {}
    for rec, footprint in pours:
        guid = rec["element"].GlobalId
        footprints[id(rec["element"])] = footprint
        if rec["pour_type"] == "SLAB":
            acts.append({"rec": rec, "phase": "Decking", "task_id": f"{guid}-DK"})
        acts.append({"rec": rec, "phase": "Concrete", "task_id": f"{guid}-C"})
    return acts, footprints


@pytest.fixture
def gate(monkeypatch):
    def run(pours, max_distance=0.05):
        acts, footprints = activities_for(pours)
        monkeypatch.setattr(xml_builder, "ENABLE_LEVEL_GATE", True)
        monkeypatch.setattr(xml_builder, "LEVEL_GATE_SLABS_ONLY", True)
        monkeypatch.setattr(xml_builder, "LEVEL_GATE_DECKING_CONCRETE_ONLY", True)
        monkeypatch.setattr(xml_builder, "LEVEL_GATE_MAX_DISTANCE_M", max_distance)
        monkeypatch.setattr(xml_builder, "get_plan_footprint", lambda element: footprints.get(id(element)))
        return {k: sorted(v) for k, v in xml_builder._build_level_gate_predecessors(acts).items()}
    return run


def test_slab_waits_only_for_the_pours_touching_it(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    under = pour("W3-under", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)           # top meets the slab's soffit
    beside = pour("W3-beside", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    far = pour("W3-far", 3, "WALL", 40, 40, 40.2, 50, 0.0, 3.0)            # elsewhere in the building
    floating = pour("W3-floating", 3, "WALL", 5, 5, 5.2, 9, 0.0, 2.0)      # 1 m short of the slab
    result = gate([slab, under, beside, far, floating])
    assert result["S4-DK"] == ["W3-beside-C", "W3-under-C"]


def test_a_slab_with_nothing_close_still_gets_the_nearest_pour(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    near = pour("W3-near", 3, "WALL", 12, 0, 12.2, 10, 0.0, 2.0)
    far = pour("W3-far", 3, "WALL", 80, 80, 80.2, 90, 0.0, 2.0)
    assert gate([slab, near, far])["S4-DK"] == ["W3-near-C"]


def test_no_limit_gives_the_old_behaviour(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    a = pour("W3-a", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    b = pour("W3-b", 3, "WALL", 80, 80, 80.2, 90, 0.0, 2.0)
    assert gate([slab, a, b], max_distance=None)["S4-DK"] == ["W3-a-C", "W3-b-C"]


def test_only_the_level_directly_below_counts(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 6.0, 6.3)
    below = pour("W3", 3, "WALL", 0, 0, 0.2, 10, 3.0, 6.0)
    two_down = pour("W2", 2, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    assert gate([slab, below, two_down])["S4-DK"] == ["W3-C"]


def test_buildings_are_gated_separately(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3, building="B1")
    other_building = pour("W3x", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0, building="B2")
    own = pour("W3", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0, building="B1")
    assert gate([slab, other_building, own])["S4-DK"] == ["W3-C"]


def test_only_slabs_are_gated_and_stage_two_pours_are_left_out(gate):
    slab = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    wall_above = pour("W4", 4, "WALL", 0, 0, 0.2, 10, 3.3, 6.3)
    box_out, fp = pour("BO3", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    box_out["conc_stage"] = "2"
    ok = pour("W3", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    result = gate([slab, wall_above, (box_out, fp), ok])
    assert result == {"S4-DK": ["W3-C"]}


def test_a_recipes_slab_waits_at_its_first_activity_not_its_rebar_or_concrete(monkeypatch):
    """A slab built from a recipe with its own activity names (ALL, Mills & Decking, ... Rebar, ... Concrete): what it waits for goes to the first
    activity of its chain (by the chain's order), not to the Rebar, and never to the Concrete."""
    slab, slab_fp = pour("S4", 4, "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    wall, wall_fp = pour("W3", 3, "WALL", 0, 0, 0.2, 10, 0.0, 3.0)
    phases = ["ALL", "Mills & Decking", "E/P Under Slab", "Rebar", "E/P On Slab", "Formwork", "Concrete"]
    acts = [{"rec": slab, "phase": p, "task_id": f"S4-{i}", "phase_order": i} for i, p in enumerate(phases)]
    acts.append({"rec": wall, "phase": "Concrete", "task_id": "W3-C", "phase_order": 0})
    footprints = {id(slab["element"]): slab_fp, id(wall["element"]): wall_fp}
    monkeypatch.setattr(xml_builder, "ENABLE_LEVEL_GATE", True)
    monkeypatch.setattr(xml_builder, "LEVEL_GATE_SLABS_ONLY", True)
    monkeypatch.setattr(xml_builder, "LEVEL_GATE_DECKING_CONCRETE_ONLY", True)
    monkeypatch.setattr(xml_builder, "LEVEL_GATE_MAX_DISTANCE_M", 0.05)
    monkeypatch.setattr(xml_builder, "get_plan_footprint", lambda element: footprints.get(id(element)))
    result = {k: sorted(v) for k, v in xml_builder._build_level_gate_predecessors(acts).items()}
    assert result == {"S4-0": ["W3-C"]}
