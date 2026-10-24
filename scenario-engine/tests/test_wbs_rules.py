"""WBS rules (core/wbs_rules.py): the templates and conditions agree with the app's evaluator (the shared cases), the default rule set
(wbs_default_rules.json) gives exactly the WBS the generator made before rules existed (tests/wbs_legacy_reference.py), and a scenario's own rules
place activities by its own fields: a package tree under the Construction node, with two packages of the same name under different parents."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core import rules as _rules  # noqa: E402
from core import wbs_rules  # noqa: E402
from core.xml_builder import _build_xml_wbs_manager_for_activities  # noqa: E402
from wbs_legacy_reference import legacy_wbs_manager  # noqa: E402

CASES = json.loads((Path(__file__).parent / "fixtures" / "wbs_rule_cases.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def reset():
    _rules.activate(None)
    yield
    _rules.activate(None)


@pytest.mark.parametrize("case", CASES["fill"], ids=lambda c: c["template"])
def test_templates(case):
    assert wbs_rules.fill(case["template"], wbs_rules.context(case["ctx"])) == case["out"]


@pytest.mark.parametrize("case", CASES["holds"], ids=lambda c: f'{c["cond"]["op"]} {c["cond"].get("value", "")}')
def test_conditions(case):
    assert wbs_rules.holds(case["cond"], wbs_rules.context(case["ctx"])) is case["out"]


def rec(pour_type, level=1, **more):
    return {"building": "B1", "wbs_prefix": "B1", "level_int": level, "level_display": f"L{level}", "pour_type": pour_type, **more}


def acts(*specs):
    return [{"rec": r, "phase": ph} for r, phases in specs for ph in phases]


R_F_C = ("Rebar", "Formwork", "Concrete")
STAIR_FLIGHT = rec("STAIR", 2, planning_proposed_pour_id="ST1")


def every_branch(zones=False):
    """Activities of every kind the old WBS code told apart."""
    z = (lambda r, zone: {**r, "building_zone": zone}) if zones else (lambda r, zone: r)
    return acts(
        (z(rec("WALL", 1, is_external=True), "Connected"), R_F_C + ("Curing",)),
        (z(rec("WALL", 1, is_external=False), "Disconnected"), ("Rebar",)),
        (z(rec("MAIN_SLAB", 1, planning_proposed_pour_id="S12"), "Connected"), ("Decking", "Concrete")),
        (z(rec("SLAB", 2), "Connected"), ("Concrete",)),
        (z(rec("LANDING", 2, planning_proposed_pour_id="LD3"), "Connected"), ("Concrete",)),
        (z(rec("LANDING", 3), "Connected"), ("Concrete",)),
        (z(STAIR_FLIGHT, "Connected"), R_F_C),
        (z(rec("STAIR", 2, is_stair_step=True, stair_parent=STAIR_FLIGHT), "Connected"), ("Concrete",)),
        (z(rec("STAIR", 3, conc_stage="Precast"), "Connected"), ("Install",)),
        (z(rec("HEAVY_PRECAST", 3, planning_proposed_pour_id="HP1"), "Connected"), ("Install",)),
        (z(rec("PRECAST_UNIT", 3, general_pour_type="Heavy Precast"), "Connected"), ("Install",)),
        (z(rec("RAFT", 0), "Connected"), ("Concrete",)),
        (z(rec("column", 2), "Connected"), ("Concrete",)),
        (z(rec("", 2), "Connected"), ("Work",)),
        (z(rec("WP-01 Walls", 1, display_type="Walls"), "Connected"), ("Work",)),
    )


def snapshot(manager, activities):
    nodes = [(manager.get_id(n), manager.label(n), manager.label(manager.parent_map[n]) if n in manager.parent_map else None) for n in manager.order]
    return nodes, [a["wbs_oid"] for a in activities]


@pytest.mark.parametrize("zones", [False, True], ids=["one zone", "split zones"])
def test_the_default_rules_give_the_old_wbs_exactly(zones):
    old_acts, new_acts = every_branch(zones), every_branch(zones)
    old = snapshot(legacy_wbs_manager(old_acts), old_acts)
    new = snapshot(_build_xml_wbs_manager_for_activities(new_acts), new_acts)
    assert new == old
    assert len(old[0]) > 20  # (every branch made nodes)


def test_a_scenarios_rules_place_activities_by_its_own_fields():
    _rules.activate({"wbs": {"rules": [
        {"id": "tree", "under": "root", "when": [{"field": "Package level 1", "op": "is not empty"}],
         "path": [{"name": "{Package level 1}"}, {"name": "{Package level 2}"}, {"name": "{parent} - {phase}", "phases": ["Install"]}]},
    ]}})
    items = acts(
        (rec("A", 1, display_type="Columns", pour_pset={"Package level 1": "Ground floor", "Package level 2": "Columns"}), ("Install", "Check")),
        (rec("B", 2, display_type="Columns", pour_pset={"Package level 1": "Level 1", "Package level 2": "Columns"}), ("Install",)),
        (rec("C", 2, display_type="Roof", pour_pset={"Package level 1": "Roof"}), ("Install",)),
    )
    m = _build_xml_wbs_manager_for_activities(items)
    names = [(m.label(n), m.label(m.parent_map[n]) if n in m.parent_map else None) for n in m.order]
    assert names == [
        ("B1 - Construction", None),
        ("Ground floor", "B1 - Construction"), ("Columns", "Ground floor"), ("Columns - Install", "Columns"),
        ("Level 1", "B1 - Construction"), ("Columns", "Level 1"), ("Columns - Install", "Columns"),
        ("Roof", "B1 - Construction"), ("Roof - Install", "Roof"),
    ]
    # Two "Columns" nodes, one under each storey; the Check activity stays at its package's node (Install only has a node of its own).
    by_label = lambda label, parent: next(m.get_id(n) for n in m.order if m.label(n) == label and m.label(m.parent_map.get(n, "")) == parent)  # noqa: E731
    assert items[0]["wbs_oid"] == by_label("Columns - Install", "Columns") and items[1]["wbs_oid"] == by_label("Columns", "Ground floor")
    assert items[2]["wbs_oid"] != items[0]["wbs_oid"]


def test_generates_packages_as_a_tree_in_the_xml(tmp_path):
    """Work items as Generate sends them (their package fields as properties, the package-tree rules): the programme's WBS is the packages' tree."""
    import xml.etree.ElementTree as ET
    import main as engine
    from core import work_items

    def item(ident, pkg, *chain):
        return {"id": ident, "group": f"WP {pkg}", "label": pkg, "building": "B1", "level": "Level 1", "name": pkg, "quantity": 1,
                "properties": {**{f"Package level {i + 1}": n for i, n in enumerate(chain)}, "Package": pkg}}

    request = work_items.with_groups({
        "workItems": [item("WP|C", "Roof", "Roof"), item("WP|A", "Columns", "Ground floor", "Columns"), item("WP|B", "Columns", "Level 1", "Columns")],
        "rules": {"wbs": {"rules": [{"id": "package-tree", "under": "root", "when": [], "path": [{"name": "{Package level 1}"}, {"name": "{Package level 2}"}]}]}},
    })
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    xml = tmp_path / "tree.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=None)
    root = ET.parse(xml).getroot()
    wbs = root.findall(".//{*}WBS")
    by_id = {w.findtext("{*}ObjectId"): w for w in wbs}
    path = lambda w: ([*path(by_id[w.findtext("{*}ParentObjectId")]), w.findtext("{*}Name")] if w.findtext("{*}ParentObjectId") in by_id else [w.findtext("{*}Name")])  # noqa: E731
    paths = [" / ".join(path(w)[1:]) for w in wbs if len(path(w)) > 1 and "Rule links" not in w.findtext("{*}Name")]
    # In the items' order (the build order), not sorted by level or name.
    assert paths == ["Roof", "Ground floor", "Ground floor / Columns", "Level 1", "Level 1 / Columns"]
    # Each activity sits in its own package's node: the two "Columns" are different nodes.
    act_wbs = {a.findtext("{*}WBSObjectId") for a in root.findall(".//{*}Activity") if a.findtext("{*}Type") != "WBS Summary"}
    columns = [w.findtext("{*}ObjectId") for w in wbs if w.findtext("{*}Name") == "Columns"]
    assert len(columns) == 2 and set(columns) <= act_wbs


def test_an_activity_no_rule_fits_goes_under_its_level():
    _rules.activate({"wbs": {"rules": [{"id": "only", "when": [{"field": "pour_type", "op": "equals", "value": "X"}], "path": [{"name": "{level_node} - X"}]}]}})
    items = acts((rec("Y", 4), ("Work",)))
    m = _build_xml_wbs_manager_for_activities(items)
    assert m.label(next(n for n in m.order if m.get_id(n) == items[0]["wbs_oid"])) == "B1 - Level 4"


@pytest.mark.parametrize("case", CASES["path"], ids=lambda c: c["about"])
def test_paths(case):
    from core.wbs_manager import WBSManager
    m = WBSManager("T")
    m.register("START")
    at = wbs_rules.place(wbs_rules.Registry(m), {"path": case["path"]}, wbs_rules.context(case["ctx"]), "START", case["phase"], case["phases"])
    names = []
    while at != "START":
        names.insert(0, m.label(at))
        at = m.parent_map[at]
    assert names == case["out"]


def test_phases_from_recipe_and_per_item_from_rules_alone():
    """The example rules (all data): walls by level, internal or external, then a node per phase their recipe made; slabs and landings by level,
    type and item, then phases; anything else by level and type."""
    _rules.activate({"wbs": {"rules": [
        {"id": "walls", "under": "root", "when": [{"field": "Pour Type", "op": "equals", "value": "WALL"}],
         "path": [{"name": "{level}"}, {"name": "{is_external|External|Internal}"}, {"kind": "phases"}]},
        {"id": "flat", "under": "root", "when": [{"field": "Pour Type", "op": "in", "value": "SLAB, LANDING"}],
         "path": [{"name": "{level}"}, {"name": "{Pour Type}"}, {"kind": "each"}, {"kind": "phases"}]},
        {"id": "fallback", "under": "root", "when": [], "path": [{"name": "{level}"}, {"name": "{Pour Type}"}]},
    ]}})
    items = acts(
        (rec("WALL", 1, is_external=True, pour_pset={"Pour Type": "WALL"}), ("Rebar", "Formwork", "Concrete")),
        (rec("SLAB", 1, planning_proposed_pour_id="0003", pour_pset={"Pour Type": "SLAB"}), ("Decking", "Concrete")),
        (rec("BEAM", 1, pour_pset={"Pour Type": "BEAM"}), ("Concrete",)),
    )
    m = _build_xml_wbs_manager_for_activities(items)
    path = lambda k: ([*path(m.parent_map[k]), m.label(k)] if k in m.parent_map else [])  # noqa: E731 (below the Construction node)
    placed = [path(next(n for n in m.order if m.get_id(n) == a["wbs_oid"])) for a in items]
    assert placed == [
        ["Level 1", "External", "Rebar"], ["Level 1", "External", "Formwork"], ["Level 1", "External", "Concrete"],
        ["Level 1", "SLAB", "0003", "Decking"], ["Level 1", "SLAB", "0003", "Concrete"],
        ["Level 1", "BEAM"],
    ]
    # The phase nodes come in the recipe's order, whatever order the activities are sorted in.
    ext = next(n for n in m.order if m.label(n) == "External")
    assert [m.label(n) for n in m.order if m.parent_map.get(n) == ext] == ["Rebar", "Formwork", "Concrete"]
