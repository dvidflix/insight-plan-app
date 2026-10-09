"""Open-ended pours precede the slab above them instead of all feeding the completion milestone
(core/xml_builder._build_open_end_successors). Geometry is faked, so these run without an IFC file."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import xml_builder  # noqa: E402


def pour(guid, pour_type, x0, y0, x1, y1, z0, z1, building="B1"):
    element = SimpleNamespace(GlobalId=guid)
    return {"element": element, "building": building, "level_int": 1, "pour_type": pour_type, "conc_stage": ""}, (box(x0, y0, x1, y1), z0, z1)


@pytest.fixture
def run(monkeypatch):
    def go(pours, open_tasks):
        acts, fps = [], {}
        for rec, fp in pours:
            guid = rec["element"].GlobalId
            fps[id(rec["element"])] = fp
            if rec["pour_type"] == "SLAB":
                acts.append({"rec": rec, "phase": "Decking", "task_id": f"{guid}-DK"})
            acts.append({"rec": rec, "phase": "Concrete", "task_id": f"{guid}-C"})
        monkeypatch.setattr(xml_builder, "ENABLE_OPEN_END_SEQUENCING", True)
        monkeypatch.setattr(xml_builder, "OPEN_END_MAX_DISTANCE_M", 0.3)
        monkeypatch.setattr(xml_builder, "get_plan_footprint", lambda e: fps.get(id(e)))
        return dict(xml_builder._build_open_end_successors(acts, set(open_tasks)))
    return go


def test_a_column_precedes_the_slab_on_top_of_it(run):
    slab = pour("S8", "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    column = pour("C7", "COLUMN", 4, 4, 4.4, 4.4, 0.0, 3.0)
    assert run([slab, column], ["C7-C"]) == {"C7-C": ["S8-DK"]}


def test_a_pour_with_no_slab_above_stays_open(run):
    slab = pour("S1", "SLAB", 0, 0, 10, 10, 0.0, 0.3)          # below it
    roof_column = pour("C9", "COLUMN", 4, 4, 4.4, 4.4, 3.0, 6.0)  # nothing above
    assert run([slab, roof_column], ["C9-C"]) == {}


def test_a_column_far_from_every_slab_edge_still_precedes_the_nearest_slab_above(run):
    roof = pour("S8", "SLAB", 0, 0, 10, 10, 6.0, 6.3)
    far = pour("C8", "COLUMN", 40, 40, 40.4, 40.4, 0.0, 3.0)
    assert run([roof, far], ["C8-C"]) == {"C8-C": ["S8-DK"]}


def test_slabs_and_other_buildings_are_left_alone(run):
    slab = pour("S4", "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    upper = pour("S5", "SLAB", 0, 0, 10, 10, 6.0, 6.3)
    other = pour("C1", "COLUMN", 4, 4, 4.4, 4.4, 0.0, 3.0, building="B2")
    assert run([slab, upper, other], ["S4-C", "C1-C"]) == {}


def test_a_pour_short_of_every_slab_precedes_the_nearest_one_above(run, monkeypatch):
    slab4 = pour("S4", "SLAB", 0, 0, 10, 10, 3.0, 3.3)
    slab5 = pour("S5", "SLAB", 0, 0, 10, 10, 6.0, 6.3)
    wall = pour("W3", "WALL", 14, 4, 14.2, 8, 0.0, 2.5)    # beside the slab's edge, top below the soffit
    assert run([slab4, slab5, wall], ["W3-C"]) == {"W3-C": ["S4-DK"]}
    monkeypatch.setattr(xml_builder, "OPEN_END_NEAREST_SLAB_FALLBACK", False)
    acts = [{"rec": r, "phase": "Concrete", "task_id": f"{r['element'].GlobalId}-C"} for r, _ in [wall]]
    assert xml_builder._build_open_end_successors(acts, {"W3-C"}) == {}
