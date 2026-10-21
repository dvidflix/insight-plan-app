"""Rates, crews and assignments (the relational form of the rules): core/rules.py _compile_assignments."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from core import activity_generator as gen, calendars, resources, rules  # noqa: E402
from test_rules import FakeWbs, days, rec  # noqa: E402


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


GROUPS = [
    {"id": "WALLS", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "wall", "conj": "and"}]},
    {"id": "EXT", "filters": [{"id": "c1", "field": "external", "op": "equals", "value": "true", "conj": "and"}]},
]


def test_an_assignment_gives_a_group_its_days_by_phase():
    rules.activate({"groups": GROUPS, "assignments": [
        {"group": "WALLS", "phase": "Rebar", "days": 9},
        {"group": "WALLS", "phase": "Concrete", "rate": "ONE", "crew": ""},
    ], "rates": [{"id": "ONE", "type": "days", "days": 2}]})
    d = days(gen.create_activities(rec("W1", "WALL"), FakeWbs()))
    assert d["Rebar"] == 9 and d["Concrete"] == 2
    assert days(gen.create_activities(rec("S1", "SLAB"), FakeWbs()))["Rebar"] == config.DEFAULT_COMPONENT_DAYS["Rebar"]


def test_a_higher_priority_beats_more_conditions_and_a_tie_goes_to_the_earlier_row():
    rules.activate({"groups": GROUPS, "durations": [{"id": "old", "when": {"family": "wall", "external": "true"}, "phases": {"Rebar": 4}}], "assignments": [
        {"group": "WALLS", "phase": "Rebar", "days": 6},
        {"group": "EXT", "phase": "Rebar", "days": 8, "priority": 5},
        {"group": "EXT", "phase": "Rebar", "days": 99, "priority": 5},
    ]})
    assert days(gen.create_activities(rec("W1", "WALL", is_external=True), FakeWbs()))["Rebar"] == 8
    assert days(gen.create_activities(rec("W2", "WALL", is_external=False), FakeWbs()))["Rebar"] == 6


def test_a_productivity_rate_takes_its_people_from_the_assigned_crew():
    rules.activate({
        "groups": GROUPS,
        "trades": [{"id": "SF", "name": "Steel fixers", "capacity": 30}],
        "crewTemplates": [{"id": "SIX", "trades": [{"trade": "SF", "size": 6}]}],
        "rates": [{"id": "R75", "type": "productivity", "basis": "rebar", "manhoursPerUnit": 75, "people": 0, "shifts": 1, "hoursPerShift": 8, "rounding": "ceil", "minDays": 1}],
        "assignments": [{"group": "WALLS", "phase": "Rebar", "rate": "R75", "crew": "SIX"}],
    })
    r = rec("W1", "WALL", rebar_weight_tonnes=4.0)
    # 4 t x 75 mh/t = 300 mh / (6 people x 8 h) = 6.25 -> 7 days; the labour written is the same 6 people
    assert days(gen.create_activities(r, FakeWbs()))["Rebar"] == 7
    assert resources.crews_for("Rebar", r, {}) == [("SF", 6.0)]


def test_a_rebar_rate_and_a_calendar_assignment():
    rules.activate({
        "groups": GROUPS,
        "calendars": [{"id": "A", "name": "A", "default": True}, {"id": "B", "name": "B", "workDays": [0, 1, 2, 3, 4, 5, 6]}],
        "rates": [{"id": "D", "type": "rebar", "tonnesPerM3": 0.4}],
        "assignments": [{"group": "WALLS", "phase": "Rebar", "rate": "D"}, {"group": "WALLS", "phase": "Concrete", "calendar": "B"}],
    })
    assert resources.rebar_tonnes(rec("W1", "WALL", volume=10)) == pytest.approx(4.0)
    assert calendars.active().for_activity("Concrete", rec("W1", "WALL")).id == "B"
    assert calendars.active().for_activity("Rebar", rec("W1", "WALL")).id == "A"


def test_assignments_switched_off_or_naming_nothing_add_nothing():
    rules.activate({"groups": GROUPS, "assignments": [{"group": "WALLS", "phase": "Rebar", "days": 9, "enabled": False}, {"group": "WALLS", "phase": "Rebar", "rate": "MISSING"}]})
    assert days(gen.create_activities(rec("W1", "WALL"), FakeWbs()))["Rebar"] == config.DEFAULT_COMPONENT_DAYS["Rebar"]


# ---------------------------------------------------------------- chains

CHAIN_GROUPS = [
    {"id": "SLABISH", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "slab", "conj": "and"}]},
    {"id": "EXTW", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "wall", "conj": "and"}, {"id": "c2", "field": "external", "op": "equals", "value": "true", "conj": "and"}]},
]


def phases(r):
    return [a["phase"] for a in gen.create_activities(r, FakeWbs())]


def test_without_a_chain_an_in_situ_pour_has_rebar_formwork_concrete_and_a_precast_one_installation_and_stitching():
    assert phases(rec("W1", "WALL")) == ["Rebar", "Formwork", "Concrete"]
    assert phases(rec("P1", "PRECAST_WALL", conc_stage="PRECAST")) == ["Installation", "Stitching"]


def test_without_a_chain_heavy_precast_is_propped_stitched_cured_and_unpropped():
    acts = gen.create_activities(rec("H1", "HEAVY_PRECAST", conc_stage="PRECAST"), FakeWbs())
    assert [(a["phase"], a["duration_days"]) for a in acts] == [("Propping", 1), ("Installation", 1), ("Stitching", 2), ("Curing", 28), ("Propping Removal", 1)]
    assert [a["task_id"] for a in acts] == ["P-H1-PR", "P-H1-I", "P-H1-S", "P-H1-CU", "P-H1-RP"]


def test_a_rule_still_sets_the_days_of_the_default_precast_phases():
    rules.activate({"assignments": [{"id": "A", "group": "", "phase": "Curing", "days": 14, "priority": 0}]})
    acts = gen.create_activities(rec("H1", "HEAVY_PRECAST", conc_stage="PRECAST"), FakeWbs())
    assert {a["phase"]: a["duration_days"] for a in acts}["Curing"] == 14


def test_a_chain_is_the_phases_of_a_group_in_order_with_its_own_ids_and_names():
    rules.activate({"groups": CHAIN_GROUPS, "chains": [
        {"group": "SLABISH", "order": 2, "phase": "Pour", "suffix": "-PO", "label": "Pour it", "material": "concrete"},
        {"group": "SLABISH", "order": 1, "phase": "Prep", "suffix": "-PP", "label": "Get ready"},
    ]})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    assert [a["phase"] for a in acts] == ["Prep", "Pour"]
    assert [a["task_id"] for a in acts] == ["P-S1-PP", "P-S1-PO"]
    assert acts[1]["task_name"].endswith(" - Pour it") and acts[1]["resource"].endswith("-C") and acts[1]["volume"] == 10.0
    assert acts[1]["predecessor"] == acts[0]["task_id"]
    assert phases(rec("W1", "WALL")) == ["Rebar", "Formwork", "Concrete"]  # no chain fits a wall: the default one


def test_the_group_of_the_highest_priority_decides_and_a_phase_without_a_suffix_gets_initials():
    rules.activate({"groups": CHAIN_GROUPS, "chains": [
        {"group": "", "order": 1, "phase": "Everything", "priority": 0},
        {"group": "EXTW", "order": 1, "phase": "Wall One", "priority": 5},
        {"group": "EXTW", "order": 2, "phase": "Wall Two", "priority": 5},
    ]})
    ext, inner = rec("W1", "WALL", is_external=True), rec("W2", "WALL", is_external=False)
    assert phases(ext) == ["Wall One", "Wall Two"]
    assert [a["task_id"] for a in gen.create_activities(ext, FakeWbs())] == ["P-W1-WO", "P-W1-WT"]
    assert phases(inner) == ["Everything"]


def test_a_precast_chain_and_the_intra_pour_links_follow_the_chain_order():
    from core import xml_builder
    rules.activate({"groups": [{"id": "PC", "filters": [{"id": "c1", "field": "stage", "op": "equals", "value": "PRECAST", "conj": "and"}]}], "chains": [
        {"group": "PC", "order": 1, "phase": "Installation", "suffix": "-I"}, {"group": "PC", "order": 2, "phase": "Grout", "suffix": "-G"}, {"group": "PC", "order": 3, "phase": "Stitching", "suffix": "-S"},
    ]})
    acts = gen.create_activities(rec("P1", "PRECAST_WALL", conc_stage="PRECAST"), FakeWbs())
    assert [a["phase"] for a in acts] == ["Installation", "Grout", "Stitching"]
    edges = xml_builder._build_intra_pour_predecessors(acts)
    assert edges["P-P1-G"] == ["P-P1-I"] and edges["P-P1-S"] == ["P-P1-G"]


def test_a_chain_row_switched_off_is_left_out():
    rules.activate({"chains": [{"group": "", "order": 1, "phase": "A"}, {"group": "", "order": 2, "phase": "B", "enabled": False}]})
    assert phases(rec("W1", "WALL")) == ["A"]


# ---------------------------------------------------------------- overlaps between the phases of a chain

OVERLAP_CHAIN = [
    {"group": "", "order": 1, "phase": "Decking", "suffix": "-DK"},
    {"group": "", "order": 2, "phase": "Under Slab", "suffix": "-D", "follows": "Decking@80"},
    {"group": "", "order": 3, "phase": "Rebar", "suffix": "-R", "follows": "Decking@80, Under Slab@80"},
    {"group": "", "order": 4, "phase": "Formwork", "suffix": "-F", "follows": "Rebar@80", "finishAfter": True},
    {"group": "", "order": 5, "phase": "Concrete", "suffix": "-C", "follows": "Formwork, Under Slab"},
]


def test_a_chain_row_can_follow_other_phases_by_a_share_of_their_duration():
    from core import xml_builder
    rules.activate({"chains": OVERLAP_CHAIN, "assignments": [{"group": "", "phase": "Decking", "days": 10}, {"group": "", "phase": "Rebar", "days": 5}]})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    edges = xml_builder._build_intra_pour_predecessors(acts)
    by = {a["phase"]: a for a in acts}
    assert edges["P-S1-R"] == ["P-S1-DK", "P-S1-D"] and by["Rebar"]["intra_edges"] == {"P-S1-DK": 80.0, "P-S1-D": 80.0}
    assert edges["P-S1-F"] == ["P-S1-R"] and by["Formwork"]["intra_edges"] == {"P-S1-R": 80.0} and by["Formwork"]["finish_after"]
    assert edges["P-S1-C"] == ["P-S1-F", "P-S1-D"]
    assert edges["P-S1-DK"] == [] and "intra_edges" in by["Decking"] and by["Decking"]["intra_edges"] == {}  # the first one follows nothing


def test_the_programme_has_start_to_start_with_a_lag_and_finish_to_finish_for_an_overlap():
    from core import xml_builder
    from core.wbs_manager import WBSManager
    rules.activate({"chains": OVERLAP_CHAIN, "assignments": [{"group": "", "phase": "Decking", "days": 10}, {"group": "", "phase": "Rebar", "days": 5}]})
    acts = gen.create_activities(rec("S1", "SLAB"), FakeWbs())
    edges = xml_builder._build_intra_pour_predecessors(acts)
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    for a in acts:
        a["wbs_oid"] = 1
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    xml_builder.write_activities_and_relationships(root, acts, xml_builder.add_resources(root), wbs, intra_predecessors=edges)
    project = root.find("Project")
    oid = {a.findtext("Id"): a.findtext("ObjectId") for a in project.findall("Activity")}
    rels = {(oid_of(project, r, "PredecessorActivityObjectId"), oid_of(project, r, "SuccessorActivityObjectId"), r.findtext("Type")): r.findtext("Lag") for r in project.findall("Relationship")}
    assert rels[("P-S1-DK", "P-S1-R", "StartToStart")] == "64.0"           # 80 % of 10 days of 8 hours
    assert rels[("P-S1-D", "P-S1-R", "StartToStart")] == "6.4"             # 80 % of its 1 day
    assert rels[("P-S1-R", "P-S1-F", "StartToStart")] == "32.0"            # 80 % of 5 days
    assert ("P-S1-R", "P-S1-F", "FinishToFinish") in rels                   # the formwork cannot finish before the rebar
    assert ("P-S1-F", "P-S1-C", "FinishToStart") in rels and ("P-S1-DK", "P-S1-R", "FinishToStart") not in rels
    # and the dates follow: the rebar starts before the decking is done, the formwork before the rebar is done but does not end before it
    from core.cpm_apply import apply_cpm_to_xml
    apply_cpm_to_xml(root, xml_builder.START_DATE)
    at = {a.findtext("Id"): (a.findtext("PlannedStartDate"), a.findtext("PlannedFinishDate")) for a in project.findall("Activity")}
    assert at["P-S1-R"][0] < at["P-S1-DK"][1] and at["P-S1-F"][0] < at["P-S1-R"][1] and at["P-S1-F"][1] >= at["P-S1-R"][1]
    assert at["P-S1-C"][0][:10] >= at["P-S1-F"][1][:10]  # (concrete is then put on its own clock times)


def oid_of(project, rel, tag):
    wanted = rel.findtext(tag)
    return next(a.findtext("Id") for a in project.findall("Activity") if a.findtext("ObjectId") == wanted)


def test_productivity_from_rebar_without_a_rebar_rate_assumes_a_quarter_tonne_per_m3():
    base = {"groups": GROUPS, "rates": [{"id": "R75", "type": "productivity", "basis": "rebar", "manhoursPerUnit": 75, "people": 12, "shifts": 2, "hoursPerShift": 9.17, "rounding": "ceil", "minDays": 1}],
            "assignments": [{"group": "WALLS", "phase": "Rebar", "rate": "R75"}]}
    wall = rec("W1", "WALL", volume=117.0)
    rules.activate(base)
    wall["rebar_weight_tonnes"] = resources.rebar_tonnes(wall)
    assert wall["rebar_weight_tonnes"] == 29.25 and days(gen.create_activities(wall, FakeWbs()))["Rebar"] == 10  # no density: the 0.25 t/m3 fallback
    rules.activate({**base, "rates": [*base["rates"], {"id": "D", "type": "rebar", "tonnesPerM3": 0.25}], "assignments": [*base["assignments"], {"group": "", "phase": "Rebar", "rate": "D"}]})
    wall["rebar_weight_tonnes"] = resources.rebar_tonnes(wall)
    assert wall["rebar_weight_tonnes"] == 29.25 and days(gen.create_activities(wall, FakeWbs()))["Rebar"] == 10  # 29.25 t x 75 / 220.08 h/day


def test_an_assignment_can_have_a_productivity_rate_and_a_rebar_rate_together():
    rules.activate({"groups": GROUPS, "rates": [
        {"id": "R75", "type": "productivity", "basis": "rebar", "manhoursPerUnit": 75, "people": 12, "shifts": 2, "hoursPerShift": 9.17, "rounding": "ceil", "minDays": 1},
        {"id": "D", "type": "rebar", "tonnesPerM3": 0.25}],
        "assignments": [{"group": "", "phase": "Rebar", "rate": "R75", "density": "D"}]})
    wall = rec("W1", "WALL", volume=117.0)
    wall["rebar_weight_tonnes"] = resources.rebar_tonnes(wall)
    assert wall["rebar_weight_tonnes"] == 29.25
    assert days(gen.create_activities(wall, FakeWbs()))["Rebar"] == 10
