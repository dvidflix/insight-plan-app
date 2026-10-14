"""The IfcOpenShell clean-up tools behind the app's "Apply changes permanently to IFC" buttons (ifc_tools.py)."""
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.util.element as ue
import ifcopenshell.util.placement as up
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ifc_tools  # noqa: E402


def _model(path, dx=0.0):
    m = api.run("project.create_file", version="IFC4")
    project = api.run("root.create_entity", m, ifc_class="IfcProject", name="P")
    api.run("unit.assign_unit", m, length={"is_metric": True, "raw": "METERS"})
    api.run("context.add_context", m, context_type="Model")
    site = api.run("root.create_entity", m, ifc_class="IfcSite", name="S")
    building = api.run("root.create_entity", m, ifc_class="IfcBuilding", name="B")
    api.run("aggregate.assign_object", m, products=[site], relating_object=project)
    api.run("aggregate.assign_object", m, products=[building], relating_object=site)
    for i in range(2):
        storey = api.run("root.create_entity", m, ifc_class="IfcBuildingStorey", name=f"L{i}")
        api.run("aggregate.assign_object", m, products=[storey], relating_object=building)
        wall = api.run("root.create_entity", m, ifc_class="IfcWall", name=f"W{i}")
        api.run("spatial.assign_container", m, products=[wall], relating_structure=storey)
        matrix = np.eye(4)
        matrix[0, 3], matrix[2, 3] = dx, 3 * i
        api.run("geometry.edit_object_placement", m, product=wall, matrix=matrix)
        keep = api.run("pset.add_pset", m, product=wall, name="Pset_Keep")
        api.run("pset.edit_pset", m, pset=keep, properties={"A": "1", "B": "2"})
        junk = api.run("pset.add_pset", m, product=wall, name="Junk")
        api.run("pset.edit_pset", m, pset=junk, properties={"X": "1"})
    m.write(str(path))
    return path


def test_strip_removes_hidden_sets_and_properties(tmp_path):
    src = _model(tmp_path / "a.ifc")
    out = tmp_path / "out.ifc"
    r = ifc_tools.strip({"input": str(src), "output": str(out), "hiddenPsets": ["Junk", "Attributes"], "hiddenProps": ["Pset_Keep.B"]})
    assert r["removedSets"] == 2 and r["removedProps"] == 2
    for wall in ifcopenshell.open(str(out)).by_type("IfcWall"):
        psets = ue.get_psets(wall)
        assert set(psets) == {"Pset_Keep"}
        assert set(psets["Pset_Keep"]) - {"id"} == {"A"}


def test_translate_moves_every_object(tmp_path):
    src = _model(tmp_path / "a.ifc")
    out = tmp_path / "out.ifc"
    ifc_tools.translate({"input": str(src), "output": str(out), "x": 5, "y": 0, "z": 1})
    m = ifcopenshell.open(str(out))
    xs = sorted(float(up.get_local_placement(w.ObjectPlacement)[0, 3]) for w in m.by_type("IfcWall"))
    zs = sorted(float(up.get_local_placement(w.ObjectPlacement)[2, 3]) for w in m.by_type("IfcWall"))
    assert xs == pytest.approx([5, 5]) and zs == pytest.approx([1, 4])


def test_translate_turns_about_a_pivot(tmp_path):
    src = _model(tmp_path / "a.ifc", dx=2.0)
    out = tmp_path / "out.ifc"
    # A quarter turn about (1, 0): a wall at x=2 ends at (1, 1).
    ifc_tools.translate({"input": str(src), "output": str(out), "rot": {"deg": 90, "px": 1, "py": 0, "pz": 0}})
    m = ifcopenshell.open(str(out))
    wall = sorted(m.by_type("IfcWall"), key=lambda w: w.Name)[0]
    xyz = up.get_local_placement(wall.ObjectPlacement)[:3, 3]
    assert xyz[0] == pytest.approx(1) and xyz[1] == pytest.approx(1)


def test_merge_keeps_one_project_and_all_objects(tmp_path):
    a, b = _model(tmp_path / "a.ifc"), _model(tmp_path / "b.ifc")
    out = tmp_path / "out.ifc"
    r = ifc_tools.merge({"inputs": [{"path": str(a)}, {"path": str(b), "x": 100}], "output": str(out)})
    m = ifcopenshell.open(str(out))
    assert r["merged"] == 2 and len(m.by_type("IfcProject")) == 1 and len(m.by_type("IfcWall")) == 4
    assert max(float(up.get_local_placement(w.ObjectPlacement)[0, 3]) for w in m.by_type("IfcWall")) == pytest.approx(100)
    assert "Pset_Keep" in ue.get_psets(m.by_type("IfcWall")[0])


def test_split_by_storey_and_class(tmp_path):
    src = _model(tmp_path / "a.ifc")
    r = ifc_tools.split({"input": str(src), "outputDir": str(tmp_path / "s"), "by": "storey", "name": "a.ifc"})
    assert [f["elements"] for f in r["files"]] == [1, 1]
    r = ifc_tools.split({"input": str(src), "outputDir": str(tmp_path / "c"), "by": "class", "name": "a.ifc"})
    assert [(f["name"], f["elements"]) for f in r["files"]] == [("a_IfcWall.ifc", 2)]
