"""Recipes (core/recipes.py) compile into the chains and assignments the generator reads: the 1HDAB_TOC preset written as recipes
(fixtures/preset_recipes.json, kept equal to src/prs/recipes.ts's output by tests/unit/recipes.test.ts) must generate exactly what the preset
generates with its chains and assignments."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import PROJECT_SHORT  # noqa: E402
from core import rules  # noqa: E402
from core.recipes import compile_recipes  # noqa: E402
from test_preset_parity import PRESET, snapshot  # noqa: E402
from test_rules import rec  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "preset_recipes.json").read_text(encoding="utf8"))


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


def test_the_preset_as_recipes_generates_what_the_preset_does():
    with_recipes = {**FIXTURE["rules"], "recipes": FIXTURE["recipes"]["recipes"]}
    assert not with_recipes["chains"] and not with_recipes["assignments"]
    before, after = snapshot(PRESET), snapshot(with_recipes)
    differing = [(b, a) for b, a in zip(before, after) if b != a]
    assert len(before) == len(after) > 1000
    assert not differing, f"{len(differing)} of {len(before)} pours differ, first: {differing[0]}"
    assert any(row[4] for row in before)


def test_the_recipes_compile_to_the_presets_rows():
    out = compile_recipes({"recipes": FIXTURE["recipes"]["recipes"]})
    assert [c["id"] for c in out["chains"]] == [c["id"] for c in PRESET["chains"]]
    assert sorted(a["id"] for a in out["assignments"]) == sorted(a["id"] for a in PRESET["assignments"])
    slab = next(c for c in out["chains"] if c["id"] == "C-SLAB|REBAR")
    assert slab["follows"] == "Decking@80, Under Slab@80" and slab["finishAfter"] is True and slab["material"] == "rebar"


def test_every_chain_row_names_the_recipe_that_made_it():
    recipes = FIXTURE["recipes"]["recipes"]
    out = compile_recipes({"recipes": recipes})
    ids = {r["id"] for r in recipes}
    assert out["chains"] and all(c["recipe"] in ids for c in out["chains"])


def test_a_recipe_switched_off_gives_nothing():
    recipes = [{**r, "enabled": False} for r in FIXTURE["recipes"]["recipes"]]
    assert compile_recipes({"recipes": recipes}) == {"chains": [], "assignments": [], "uses": [], "links": []}


def test_no_recipes_change_nothing():
    assert compile_recipes({}) == {"chains": [], "assignments": [], "uses": [], "links": []}
    assert compile_recipes({"recipes": "nonsense"}) == {"chains": [], "assignments": [], "uses": [], "links": []}
    assert rules.Rules({"recipes": []}).empty


def test_a_recipe_alone_gives_a_group_its_activities_and_days():
    recipes = [{"id": "WALLS-R", "group": "", "priority": 0, "tasks": [{"phase": "Rebar", "suffix": "-R", "name": "Rebar", "days": 3},
                                                                        {"phase": "Concrete", "suffix": "-C", "name": "Concrete", "days": 1}],
                "edges": [{"from": "Rebar", "to": "Concrete", "sharePct": 50}]}]
    r = rules.Rules({"recipes": recipes})
    assert [c["phase"] for c in r.chains] == ["Rebar", "Concrete"] and r.chains[1]["follows"] == "Rebar@50"
    rec = {"pour_type": "WALL"}
    assert r.chain_for(rec)[1]["follows"] == [("Rebar", 50.0)]
    assert r.phase_days(rec) == {"Rebar": 3.0, "Concrete": 1.0}


def test_a_values_recipe_may_give_a_calendar_to_every_phase_of_a_group():
    out = compile_recipes({"recipes": [{"id": "G", "group": "G", "chain": False, "tasks": [{"phase": "", "calendar": "7D", "priority": 5}]}]})
    assert out["chains"] == [] and out["assignments"] == [{"id": "G|", "group": "G", "phase": "", "priority": 5, "calendar": "7D"}]


# ---------------------------------------------------------------- equipment, cranes and materials

POOLS = [{"id": "TC1", "kind": "crane", "name": "Tower crane 1", "quantity": 2}, {"id": "PUMP", "kind": "equipment", "name": "Concrete pump", "quantity": 1},
         {"id": "FWSET", "kind": "material", "name": "Slab formwork sets", "quantity": 3}]
RECIPES = [{"id": "SLAB", "group": "", "tasks": [
    {"phase": "Formwork", "days": 2, "cranes": [{"type": "TC1", "count": 1}], "materials": [{"type": "FWSET"}]},
    {"phase": "Concrete", "days": 1, "equipment": [{"type": "PUMP", "count": 1}, {"type": "NOPOOL", "count": 1}]}]}]


def test_the_tasks_equipment_cranes_and_materials_are_compiled_as_uses():
    out = compile_recipes({"recipes": RECIPES})
    assert [(u["phase"], [(x["kind"], x["type"], x["count"]) for x in u["uses"]]) for u in out["uses"]] == [
        ("Formwork", [("crane", "TC1", 1.0), ("material", "FWSET", 1.0)]), ("Concrete", [("equipment", "PUMP", 1.0), ("equipment", "NOPOOL", 1.0)])]


def test_a_pour_gets_the_resources_of_its_recipe_that_the_scenario_has_a_pool_for():
    from core import resources
    rules.activate({"recipes": RECIPES, "resourcePools": POOLS})
    r = rec("W1", "WALL")
    assert resources.uses_for("Formwork", r) == [(f"{PROJECT_SHORT}-K-TC1", 1.0), (f"{PROJECT_SHORT}-M-FWSET", 1.0)]
    assert resources.uses_for("Concrete", r) == [(f"{PROJECT_SHORT}-E-PUMP", 1.0)]  # NOPOOL has no pool: nothing is assigned
    assert resources.uses_for("Rebar", r) == []


def test_the_pools_become_p6_resources_with_their_count_as_max_units():
    import xml.etree.ElementTree as ET
    from core import xml_builder
    rules.activate({"recipes": RECIPES, "resourcePools": POOLS})
    root = ET.Element("APIBusinessObjects")
    ids = xml_builder.add_resources(root)
    kinds = {r.find("Id").text: r.find("ResourceType").text for r in root.findall("Resource")}
    assert kinds[f"{PROJECT_SHORT}-K-TC1"] == "Nonlabor" and kinds[f"{PROJECT_SHORT}-E-PUMP"] == "Nonlabor" and kinds[f"{PROJECT_SHORT}-M-FWSET"] == "Material"
    rates = {rate.find("ResourceObjectId").text: rate.find("MaxUnitsPerTime").text for rate in root.findall("ResourceRate")}
    assert float(rates[ids[f"{PROJECT_SHORT}-K-TC1"]]) == 2.0 and float(rates[ids[f"{PROJECT_SHORT}-E-PUMP"]]) == 1.0


def test_without_pools_there_are_no_equipment_resources():
    import xml.etree.ElementTree as ET
    from core import xml_builder
    rules.activate({"recipes": RECIPES})
    root = ET.Element("APIBusinessObjects")
    xml_builder.add_resources(root)
    assert not [r for r in root.findall("Resource") if "-K-" in r.find("Id").text or "-E-" in r.find("Id").text]


def test_a_tasks_crane_is_assigned_to_its_activity_in_the_programme():
    """The recipe's crane on the Rebar task becomes a P6 resource assignment on that activity: units = count x its days, units per time = count."""
    from core import activity_generator as gen, xml_builder
    from core.wbs_manager import WBSManager
    from test_rules import FakeWbs
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Rebar", "suffix": "-R", "name": "Rebar", "days": 4, "cranes": [{"type": "TC1", "count": 2}]},
                                                      {"phase": "Concrete", "suffix": "-C", "name": "Concrete", "days": 1}]}]
    rules.activate({"recipes": recipes, "resourcePools": POOLS})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    for a in acts:
        a["wbs_oid"] = 1
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    ids = xml_builder.add_resources(root)
    xml_builder.write_activities_and_relationships(root, acts, ids, wbs, intra_predecessors=xml_builder._build_intra_pour_predecessors(acts))
    project = root.find("Project")
    rebar = next(a for a in project.findall("Activity") if a.findtext("Id").endswith("-R"))
    mine = [ra for ra in root.findall("ResourceAssignment") if ra.findtext("ActivityObjectId") == rebar.findtext("ObjectId") and ra.findtext("ResourceObjectId") == ids[f"{PROJECT_SHORT}-K-TC1"]]
    assert len(mine) == 1
    assert float(mine[0].findtext("PlannedUnits")) == 8.0 and float(mine[0].findtext("PlannedUnitsPerTime")) == 2.0
    concrete = next(a for a in project.findall("Activity") if a.findtext("Id").endswith("-C"))
    assert not [ra for ra in root.findall("ResourceAssignment") if ra.findtext("ActivityObjectId") == concrete.findtext("ObjectId") and ra.findtext("ResourceObjectId") == ids[f"{PROJECT_SHORT}-K-TC1"]]


# ---------------------------------------------------------------- maximize resource availability

def test_maximize_resource_availability_leaves_every_pool_and_trade_without_a_limit():
    trades = [{"id": "SF", "name": "Steel fixers", "capacity": 24}]
    rules.activate({"resourcePools": POOLS, "trades": trades})
    assert [p["quantity"] for p in rules.active().pools()] == [2, 1, 3] and rules.active().trades()["SF"]["capacity"] == 24
    rules.activate({"resourcePools": POOLS, "trades": trades, "settings": {"maximizeResources": True}})
    assert [p["quantity"] for p in rules.active().pools()] == [0, 0, 0] and rules.active().trades()["SF"]["capacity"] == 0
    # switched off again (the next run): the scenario's own counts are back, nothing was lost
    rules.activate({"resourcePools": POOLS, "trades": trades})
    assert [p["quantity"] for p in rules.active().pools()] == [2, 1, 3] and rules.active().trades()["SF"]["capacity"] == 24


# ---------------------------------------------------------------- recipe links

def test_a_recipe_link_ties_a_task_of_one_recipe_to_a_task_of_another_on_the_same_level():
    from core import activity_generator as gen
    from core.rule_logic import PourTasks, build_recipe_links
    from test_rules import FakeWbs
    groups = [{"id": "WALLS", "forEach": [], "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "wall", "conj": "and"}]},
              {"id": "SLABS", "forEach": [], "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "slab", "conj": "and"}]}]
    recipes = [
        {"id": "WALL", "group": "WALLS", "tasks": [{"phase": "Rebar", "suffix": "-R"}, {"phase": "Concrete", "suffix": "-C",
                                                     "links": [{"recipe": "SLAB", "phase": "Rebar", "direction": "after", "type": "SS", "lagHours": 8}]}]},
        {"id": "SLAB", "group": "SLABS", "tasks": [{"phase": "Rebar", "suffix": "-R"}, {"phase": "Concrete", "suffix": "-C"}]},
    ]
    r = rules.activate({"groups": groups, "recipes": recipes})
    assert [link["targetPhase"] for link in r.recipe_links] == ["Rebar"]
    pours = [rec("W1", "WALL", level=1), rec("S1", "SLAB", level=1), rec("S2", "SLAB", level=2)]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    relations, messages = build_recipe_links(r, PourTasks(acts))
    by = lambda guid, phase: next(a["task_id"] for a in acts if a["rec"]["element"].GlobalId == guid and a["phase"] == phase)  # noqa: E731
    assert [(x["pred"], x["succ"], x["type"], x["lag"]) for x in relations] == [(by("W1", "Concrete"), by("S1", "Rebar"), "SS", 8.0)]  # level 2 is not tied
    assert messages and "1 link" in messages[0]


def test_a_recipe_link_to_a_recipe_that_is_not_there_is_ignored_and_before_reverses_it():
    from core import activity_generator as gen
    from core.rule_logic import PourTasks, build_recipe_links
    from test_rules import FakeWbs
    recipes = [{"id": "A", "group": "", "tasks": [{"phase": "Rebar", "links": [{"recipe": "NOPE", "phase": "Rebar"}]}]}]
    assert rules.activate({"recipes": recipes}).recipe_links == []
    recipes = [{"id": "A", "group": "", "tasks": [{"phase": "Rebar", "suffix": "-R", "links": [{"recipe": "B", "phase": "Rebar", "direction": "before", "scope": "all"}]}]},
               {"id": "B", "group": "", "tasks": [{"phase": "Rebar", "suffix": "-R"}]}]
    r = rules.activate({"recipes": recipes})
    acts = [a for p in [rec("S1", "SLAB", level=1)] for a in gen.create_activities(p, FakeWbs())]
    relations, _ = build_recipe_links(r, PourTasks(acts))
    assert relations == []  # the only pour is its own target: a task is never tied to itself


# ---------------------------------------------------------------- crews per subcontractor

CREWS = [{"id": "CARP", "subcontractor": "Concrete Sub", "available": 3, "trades": [{"trade": "CP", "size": 4}]},
         {"id": "STEEL", "trades": [{"trade": "SF", "size": 3}]}]


def test_a_named_crew_with_crews_available_is_a_pool_named_by_its_subcontractor():
    r = rules.activate({"crewTemplates": CREWS, "assignments": [{"group": "", "phase": "Formwork", "crew": "CARP"}, {"group": "", "phase": "Rebar", "crew": "STEEL"}]})
    assert r.crew_pools() == [{"id": "CARP", "name": "Concrete Sub · CARP", "quantity": 3.0}]  # STEEL has no number of crews: no pool
    assert r.crew_pool_for("Formwork", rec("S1", "SLAB"))["id"] == "CARP"
    assert r.crew_pool_for("Rebar", rec("S1", "SLAB")) is None and r.crew_pool_for("Concrete", rec("S1", "SLAB")) is None
    rules.activate({"crewTemplates": CREWS, "settings": {"maximizeResources": True}})
    assert rules.active().crew_pools()[0]["quantity"] == 0.0


def test_a_crew_pool_is_a_resource_and_each_activity_of_that_crew_holds_one_crew():
    import xml.etree.ElementTree as ET
    from core import activity_generator as gen, xml_builder
    from core.wbs_manager import WBSManager
    from test_rules import FakeWbs
    rules.activate({"crewTemplates": CREWS, "assignments": [{"group": "", "phase": "Formwork", "crew": "CARP", "days": 2}]})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    for a in acts:
        a["wbs_oid"] = 1
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    ids = xml_builder.add_resources(root)
    pool_id = ids[f"{PROJECT_SHORT}-G-CARP"]
    named = {r.findtext("ObjectId"): (r.findtext("Name"), r.findtext("ResourceType")) for r in root.findall("Resource")}
    assert named[pool_id] == ("Concrete Sub · CARP", "Nonlabor")
    xml_builder.write_activities_and_relationships(root, acts, ids, wbs, intra_predecessors=xml_builder._build_intra_pour_predecessors(acts))
    held = [ra for ra in root.findall("ResourceAssignment") if ra.findtext("ResourceObjectId") == pool_id]
    assert len(held) == 1 and float(held[0].findtext("PlannedUnitsPerTime")) == 1.0 and float(held[0].findtext("PlannedUnits")) == 2.0


# ---------------------------------------------------------------- links with a type and a lag

def test_a_task_can_follow_another_with_a_type_and_a_lag_and_two_links_between_the_same_pair():
    """Formwork starts 32 hours after the rebar starts (SS, an overlap) and cannot finish before it (FF); the concrete follows the formwork,
    finished, but 8 hours early (FS with a negative lag)."""
    from core import activity_generator as gen, xml_builder
    from core.wbs_manager import WBSManager
    from test_rules import FakeWbs
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Rebar", "suffix": "-R", "days": 5}, {"phase": "Formwork", "suffix": "-F", "days": 3}, {"phase": "Concrete", "suffix": "-C", "days": 1}],
                "edges": [{"from": "Rebar", "to": "Formwork", "type": "SS", "lagHours": 32}, {"from": "Rebar", "to": "Formwork", "type": "FF"},
                          {"from": "Formwork", "to": "Concrete", "type": "FS", "lagHours": -8}]}]
    chain = {c["phase"]: c for c in rules.activate({"recipes": recipes}).chains}
    assert chain["Formwork"]["follows"] == "Rebar:SS+32, Rebar:FF+0" and chain["Concrete"]["follows"] == "Formwork:FS-8"
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    edges = xml_builder._build_intra_pour_predecessors(acts)
    for a in acts:
        a["wbs_oid"] = 1
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    xml_builder.write_activities_and_relationships(root, acts, xml_builder.add_resources(root), wbs, intra_predecessors=edges)
    project = root.find("Project")
    ids = {a.findtext("ObjectId"): a.findtext("Id").rsplit("-", 1)[-1] for a in project.findall("Activity")}
    rels = {(ids[r.findtext("PredecessorActivityObjectId")], ids[r.findtext("SuccessorActivityObjectId")], r.findtext("Type")): float(r.findtext("Lag") or 0) for r in project.findall("Relationship")}
    assert rels[("R", "F", "StartToStart")] == 32.0 and ("R", "F", "FinishToFinish") in rels and ("R", "F", "FinishToStart") not in rels
    assert rels[("F", "C", "FinishToStart")] == -8.0


# ---------------------------------------------------------------- parameters, formulas and limits

def test_a_formula_reads_the_pours_quantities_and_the_scenarios_parameters():
    from core import formula
    values = {"Concrete_m3": 150, "Rebar_kg": 3500, "Rebar_Rate": 500, "Concrete_Rate": 40}
    assert formula.evaluate("Rebar_kg / Rebar_Rate", values) == 7
    assert formula.evaluate("max(1, ceil(concrete_m3 / Concrete_Rate))", values) == 4
    assert formula.evaluate("2 ^ 3 - -1", values) == 9
    for bad in ("", "Nope * 2", "1 +", "1 / 0", "import os", "(1"):
        with pytest.raises(formula.FormulaError):
            formula.evaluate(bad, values)


def test_a_recipe_tasks_formula_sets_its_days_from_the_quantity_and_the_rate():
    from core import activity_generator as gen
    from test_rules import FakeWbs
    recipes = [{"id": "SLAB", "group": "", "tasks": [
        {"phase": "Rebar", "suffix": "-R", "formula": "Rebar_kg / Rebar_Rate"},
        {"phase": "Concrete", "suffix": "-C", "formula": "max(1, Concrete_m3 / Concrete_Rate)"}]}]
    parameters = [{"name": "Rebar_Rate", "value": 500}, {"name": "Concrete_Rate", "value": 40}]
    rules.activate({"recipes": recipes, "parameters": parameters})
    r = rec("S1", "SLAB")
    r["volume"], r["rebar_weight_tonnes"] = 150.0, 3.5
    days = {a["phase"]: a["duration_days"] for a in gen.create_activities(r, FakeWbs())}
    assert days == {"Rebar": 7.0, "Concrete": 3.75}
    # change a rate and regenerate: the days follow
    rules.activate({"recipes": recipes, "parameters": [{"name": "Rebar_Rate", "value": 1000}, {"name": "Concrete_Rate", "value": 150}]})
    days = {a["phase"]: a["duration_days"] for a in gen.create_activities(r, FakeWbs())}
    assert days == {"Rebar": 3.5, "Concrete": 1.0}


def test_a_formula_with_a_name_that_has_no_value_is_noted_and_the_task_keeps_its_other_days():
    from core import activity_generator as gen
    from test_rules import FakeWbs
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Rebar", "suffix": "-R", "days": 4, "formula": "Rebar_kg / Missing_Rate"}]}]
    r = rules.activate({"recipes": recipes})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    assert [a["duration_days"] for a in acts] == [4.0]
    assert any("Missing_Rate" in n for n in r.formula_notes)


def _limit_acts(count):
    from core import activity_generator as gen
    from test_rules import FakeWbs
    return [a for i in range(count) for a in gen.create_activities(rec(f"S{i}", "SLAB", level=i + 1), FakeWbs())]


def test_a_limit_keeps_at_most_n_activities_of_a_kind_running_at_once():
    from core.rule_logic import PourTasks, build_limit_links
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Formwork", "suffix": "-F", "days": 2}, {"phase": "Concrete", "suffix": "-C", "days": 1}]}]
    r = rules.activate({"recipes": recipes, "parameters": [{"name": "Formwork_Sets_Available", "value": 2}],
                        "limits": [{"id": "FW", "phase": "Formwork", "max": "Formwork_Sets_Available"}]})
    acts = _limit_acts(5)
    relations, messages = build_limit_links(r, PourTasks(acts))
    forms = [a["task_id"] for a in acts if a["phase"] == "Formwork"]
    assert [(x["pred"], x["succ"], x["type"]) for x in relations] == [(forms[0], forms[2], "FS"), (forms[1], forms[3], "FS"), (forms[2], forms[4], "FS")]
    assert messages and "at most 2 at once" in messages[0]


def test_a_limit_of_none_or_with_maximize_resources_adds_no_links():
    from core.rule_logic import PourTasks, build_limit_links
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Formwork", "suffix": "-F", "days": 2}]}]
    acts = _limit_acts(4)
    r = rules.activate({"recipes": recipes, "limits": [{"phase": "Formwork", "max": 0}]})
    assert build_limit_links(r, PourTasks(acts))[0] == []
    r = rules.activate({"recipes": recipes, "limits": [{"phase": "Formwork", "max": 2}], "settings": {"maximizeResources": True}})
    assert build_limit_links(r, PourTasks(acts))[0] == []


def test_the_limit_follows_the_order_of_the_steps():
    from core.rule_logic import PourTasks, build_limit_links
    groups = [{"id": "TOP", "forEach": [], "filters": [{"id": "c1", "field": "levelNumber", "op": "atLeast", "value": "3", "conj": "and"}]},
              {"id": "LOW", "forEach": [], "filters": [{"id": "c1", "field": "levelNumber", "op": "lessThan", "value": "3", "conj": "and"}]}]
    recipes = [{"id": "SLAB", "group": "", "tasks": [{"phase": "Formwork", "suffix": "-F", "days": 2}]}]
    r = rules.activate({"recipes": recipes, "groups": groups, "limits": [{"phase": "Formwork", "max": 1}],
                        "sequences": [{"id": "STEPS", "steps": [{"group": "TOP"}, {"group": "LOW"}]}]})
    acts = _limit_acts(4)  # levels 1..4: the steps put levels 3 and 4 first
    relations, _ = build_limit_links(r, PourTasks(acts))
    level_of = {a["task_id"]: a["rec"]["level_code"] if "level_code" in a["rec"] else a["task_id"] for a in acts}
    first = relations[0]["pred"]
    top = {a["task_id"] for a in acts if a["rec"]["element"].GlobalId in ("S2", "S3")}
    assert first in top and len(relations) == 3


def test_a_share_lag_reaches_the_generator():
    """Rebar:SS@80 / a lag as a share of a duration is kept in the follows text and read back as a share, not hours."""
    from core.recipes import _follows_text
    from core.rules import _parse_follows
    edges = [{"from": "Rebar", "to": "E/P On Slab", "type": "SS", "lagPct": 80, "lagOf": "pred"}, {"from": "Rebar", "to": "E/P On Slab", "type": "FF"}]
    assert _follows_text(edges, "E/P On Slab") == "Rebar:SS+80%, Rebar:FF+0"
    assert _parse_follows("Rebar:SS+80%, Rebar:FF+0") == [("Rebar", 100.0, "SS", 80.0, "pred"), ("Rebar", 100.0, "FF", 0.0, "h")]
    assert _parse_follows("Rebar:SS@80") == [("Rebar", 100.0, "SS", 80.0, "pred")]
    assert _parse_follows("Rebar:FF-20%s") == [("Rebar", 100.0, "FF", -20.0, "succ")]


def test_the_main_slab_chain_writes_an_ss_and_an_ff_for_every_overlap_at_80_percent():
    """ALL, Mills & Decking, E/P Under Slab, Rebar, E/P On Slab, Formwork, Concrete: each overlap is an SS at 80 % of the task before and an FF with it;
    Formwork and Concrete follow finish to start."""
    from core import activity_generator as gen, xml_builder
    from core.wbs_manager import WBSManager
    from test_rules import FakeWbs
    tasks = [("ALL", "-ALL", 20), ("Mills & Decking", "-D", 20), ("E/P Under Slab", "-E", 15), ("Rebar", "-R", 25), ("E/P On Slab", "-E2", 15), ("Formwork", "-F", 6), ("Concrete", "-C", 1)]
    edges = []
    for (a, _, _), (b, _, _) in zip(tasks[:4], tasks[1:5]):
        edges += [{"from": a, "to": b, "type": "SS", "lagPct": 80, "lagOf": "pred"}, {"from": a, "to": b, "type": "FF"}]
    edges += [{"from": "E/P On Slab", "to": "Formwork"}, {"from": "Formwork", "to": "Concrete"}]
    recipes = [{"id": "MAIN SLAB", "group": "", "tasks": [{"phase": p, "suffix": s, "days": d} for p, s, d in tasks], "edges": edges}]
    rules.activate({"recipes": recipes})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    intra = xml_builder._build_intra_pour_predecessors(acts)
    for a in acts:
        a["wbs_oid"] = 1
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    xml_builder.write_activities_and_relationships(root, acts, xml_builder.add_resources(root), wbs, intra_predecessors=intra)
    project = root.find("Project")
    ids = {a.findtext("ObjectId"): a.findtext("Id").rsplit("-", 1)[-1] for a in project.findall("Activity")}
    rels = {(ids[r.findtext("PredecessorActivityObjectId")], ids[r.findtext("SuccessorActivityObjectId")], r.findtext("Type")): float(r.findtext("Lag") or 0) for r in project.findall("Relationship")}
    for pred, succ, days in [("ALL", "D", 20), ("D", "E", 20), ("E", "R", 15), ("R", "E2", 25)]:
        assert (pred, succ, "FinishToFinish") in rels, (pred, succ)
        assert abs(rels[(pred, succ, "StartToStart")] - days * 8 * 0.8) < 0.5, (pred, succ, rels.get((pred, succ, "StartToStart")))
    assert ("E2", "F", "FinishToStart") in rels and ("F", "C", "FinishToStart") in rels


def test_a_summary_bar_for_a_folder_is_one_bar_per_building_and_level_over_its_sets():
    from core import activity_generator as gen
    from core.rule_logic import PourTasks, build_level_tasks
    from test_rules import FakeWbs
    pt = lambda i, v: {"id": i, "forEach": [], "filters": [{"id": "c1", "field": "type", "op": "equals", "value": v, "conj": "and"}]}  # noqa: E731
    groups = [pt("WALLS", "WALL"), pt("SLABS", "SLAB"), pt("OTHER", "COLUMN"),
              {"id": "Folder (per level)", "forEach": ["building", "level"], "filters": [], "include": ["WALLS", "SLABS"]}]
    r = rules.activate({"groups": groups, "levelTasks": [{"id": "LT-1", "name": "Bar", "group": "Folder (per level)"}]})
    pours = [rec("W1", "WALL", level=1), rec("S1", "SLAB", level=1), rec("S2", "SLAB", level=2), rec("C1", "COLUMN", level=3)]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    bars, relations, _ = build_level_tasks(r, PourTasks(acts), FakeWbs(), [])
    assert sorted(b["level_key"] for b in bars) == [("B1", "L1"), ("B1", "L2")]  # level 3 holds only a column, which is in no set of the folder
    assert {len(b["members"]) for b in bars} == {1, 2}
