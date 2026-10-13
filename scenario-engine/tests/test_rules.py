"""Programme rules (core/rules.py, core/rule_logic.py): what the Rules panel changes in a generated programme.
Geometry and the IFC are faked, so these run without a model."""
import sys
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from core import activity_generator as gen  # noqa: E402
from core import resources, rules, rule_logic, xml_builder  # noqa: E402
from core.cpm_apply import apply_cpm_to_xml  # noqa: E402
from core.wbs_manager import WBSManager  # noqa: E402


@pytest.fixture(autouse=True)
def no_rules():
    """Every test starts and ends on the defaults (settings are global)."""
    rules.activate(None)
    yield
    rules.activate(None)


class FakeWbs:
    def register(self, name, parent_name=None):
        return 1

    def get_id(self, name):
        return 1


def rec(guid="G1", pour_type="SLAB", level=4, building="B1", **over):
    base = {
        "element": SimpleNamespace(GlobalId=guid), "conc_stage": "1", "pour_type": pour_type, "task_id_base": f"P-{guid}",
        "building": building, "unit_building": building, "level_code": f"L{level}", "level_int": level, "level_display": f"Level {level}",
        "wbs_prefix": building, "lg1": "Slab", "pour_id": guid, "task_pour_id": guid, "concrete_wbs_oid": 1, "volume": 10.0,
        "is_external": False, "is_double_height": False, "min_elevation": level * 3.0, "max_elevation": level * 3.0 + 0.3,
        "planning_proposed_pour_id": guid,
    }
    return {**base, **over}


SLAB_CHAIN = {
    "groups": [{"id": "SLABISH", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "slab", "conj": "and"}]}],
    "chains": [{"group": "SLABISH", "order": i, "phase": p, "suffix": s, "label": p, "priority": 10}
               for i, (p, s) in enumerate([("Decking", "-DK"), ("Rebar", "-R"), ("Concrete", "-C"), ("Curing", "-CU")], 1)],
    "assignments": [{"group": "SLABISH", "phase": "Curing", "days": 7}],
}


def with_slab_chain(data):
    """Rules with a slab chain (Decking, Rebar, Concrete, Curing) added: the engine has no slab chain of its own."""
    return {**data, "groups": [*SLAB_CHAIN["groups"], *data.get("groups", [])], "chains": SLAB_CHAIN["chains"],
            "assignments": [*SLAB_CHAIN["assignments"], *data.get("assignments", [])]}


def days(acts):
    return {a["phase"]: a["duration_days"] for a in acts}


# ---------------------------------------------------------------- the defaults are today's behaviour

def test_no_rules_change_nothing():
    wall = rec("W1", "WALL", is_external=True)
    before = days(gen.create_activities(wall, FakeWbs()))
    rules.activate({})
    assert days(gen.create_activities(wall, FakeWbs())) == before
    assert rules.active().empty


# ---------------------------------------------------------------- durations, rebar, crews

def test_a_duration_row_by_type_and_level_range_wins_over_the_table():
    rules.activate({"durations": [
        {"id": "a", "when": {"family": "wall"}, "phases": {"Rebar": 9}},
        {"id": "b", "when": {"family": "wall", "levelFrom": "L0", "levelTo": "L2"}, "phases": {"Rebar": 15}},
    ]})
    low = days(gen.create_activities(rec("W1", "WALL", level=1), FakeWbs()))
    high = days(gen.create_activities(rec("W2", "WALL", level=5), FakeWbs()))
    assert low["Rebar"] == 15 and high["Rebar"] == 9  # the row with more terms wins; the other rows still apply
    assert days(gen.create_activities(rec("S1", "SLAB"), FakeWbs()))["Rebar"] == config.DEFAULT_COMPONENT_DAYS["Rebar"]


def test_a_tie_goes_to_the_first_row():
    rules.activate({"durations": [
        {"when": {"family": "wall"}, "phases": {"Concrete": 3}},
        {"when": {"family": "wall"}, "phases": {"Concrete": 5}},
    ]})
    assert days(gen.create_activities(rec("W1", "WALL"), FakeWbs()))["Concrete"] == 3


def test_a_phase_named_in_a_row_replaces_its_number():
    rules.activate(with_slab_chain({"durations": [{"when": {"family": "slab"}, "phases": {"Decking": 6, "Curing": 14}}]}))
    got = days(gen.create_activities(rec("S1", "SLAB"), FakeWbs()))
    assert got["Decking"] == 6 and got["Curing"] == 14


def test_rows_can_use_a_rule_group():
    rules.activate({
        "groups": [{"id": "SLOW", "select": {"family": "slab", "building": "B1", "level": "L4"}}],
        "durations": [{"when": {"group": "SLOW"}, "phases": {"Concrete": 4}}],
    })
    assert days(gen.create_activities(rec("S4", "SLAB", level=4), FakeWbs()))["Concrete"] == 4
    assert days(gen.create_activities(rec("S5", "SLAB", level=5), FakeWbs()))["Concrete"] == 1


def test_a_duration_can_come_from_a_quantity():
    rules.activate({"productivity": [{
        "when": {"family": "slab"}, "phase": "Rebar", "basis": "rebar", "manhoursPerUnit": 85, "crew": 8, "shifts": 2,
        "hoursPerShift": 9.17, "rounding": "ceil", "minDays": 1,
    }]})
    big = rec("S1", "SLAB", volume=100.0, rebar_weight_tonnes=25.0)
    # 25 t x 85 Mh/t / (8 x 2 x 9.17) = 14.49 -> 15 days
    assert days(gen.create_activities(big, FakeWbs()))["Rebar"] == 15
    tiny = rec("S2", "SLAB", volume=0.1, rebar_weight_tonnes=0.02)
    assert days(gen.create_activities(tiny, FakeWbs()))["Rebar"] == 1  # never under the minimum


def test_a_duration_can_come_from_a_property_of_the_model():
    from core import quantities
    row = {"when": {"family": "slab"}, "phase": "Rebar", "basis": "property", "pset": "Qto_SlabBaseQuantities", "property": "RebarWeightKg",
           "factor": 0.001, "manhoursPerUnit": 85, "crew": 8, "shifts": 2, "hoursPerShift": 9.17, "rounding": "ceil", "minDays": 1}
    rules.activate({"productivity": [row]})
    # 25 000 kg x 0.001 = 25 t, the same as the rebar-rate example above: 15 days (names are matched without case)
    with_prop = rec("S1", "SLAB", volume=100.0, rebar_weight_tonnes=1.0, props={"qto_slabbasequantities": {"rebarweightkg": 25000.0}})
    assert quantities.property_value(with_prop, "Qto_SlabBaseQuantities", "RebarWeightKg") == 25000.0
    assert days(gen.create_activities(with_prop, FakeWbs()))["Rebar"] == 15
    # a pour without the property falls back to the rebar tonnes (default) ...
    without = rec("S2", "SLAB", volume=100.0, rebar_weight_tonnes=25.0)
    assert days(gen.create_activities(without, FakeWbs()))["Rebar"] == 15
    # ... or to the concrete volume, or leaves the row out (the table's days apply)
    rules.activate({"productivity": [{**row, "fallback": "concrete", "manhoursPerUnit": 1.0, "crew": 4, "shifts": 1, "hoursPerShift": 8}]})
    assert days(gen.create_activities(without, FakeWbs()))["Rebar"] == 4  # 100 m3 / 32 h = 3.1 -> 4
    rules.activate({"productivity": [{**row, "fallback": "none"}]})
    assert days(gen.create_activities(without, FakeWbs()))["Rebar"] == config.DEFAULT_COMPONENT_DAYS["Rebar"]


def test_the_numbers_of_an_element_are_collected_from_its_property_sets():
    from core import quantities
    prop = SimpleNamespace(Name="Rebar Weight", NominalValue=SimpleNamespace(wrappedValue=12.5))
    text = SimpleNamespace(Name="Unit", NominalValue=SimpleNamespace(wrappedValue="n/a"))
    qto = SimpleNamespace(Name="NetVolume", VolumeValue=3.0)
    cache = {
        "CWA Pour": {"G1": SimpleNamespace(HasProperties=[prop, text])},
        "Qto_Base": {"G1": SimpleNamespace(Quantities=[qto])},
        "Other": {"G2": SimpleNamespace(HasProperties=[prop])},
    }
    assert quantities.collect_props("G1", cache) == {"CWA Pour": {"Rebar Weight": 12.5, "Unit": "n/a"}, "Qto_Base": {"NetVolume": 3.0}}
    assert quantities.property_value({"props": quantities.collect_props("G1", cache)}, "CWA Pour", "Unit") is None  # text is not a quantity
    assert quantities.collect_props("G9", cache) == {}


def test_rebar_tonnes_follow_a_rate_row():
    rules.activate({"rebar": [{"when": {"family": "raft"}, "tonnesPerM3": 0.4}]})
    assert resources.rebar_tonnes(rec("R1", "RAFT", volume=10)) == pytest.approx(4.0)
    assert resources.rebar_tonnes(rec("S1", "SLAB", volume=10)) == 0.0  # no rate row fits: no rebar quantity (the engine has no rates of its own)


def test_a_crew_row_replaces_the_crew_of_that_phase():
    rules.activate({"crews": [{"when": {"family": "slab", "level": "L4"}, "phase": "Rebar", "trades": [{"trade": "sf", "size": 12}]}]})
    assert resources.crews_for("Rebar", rec("S4", "SLAB", level=4), {}) == [("SF", 12)]
    assert resources.crews_for("Rebar", rec("S5", "SLAB", level=5), {}) == []  # the engine has no crew table: no row fits, no labour


# ---------------------------------------------------------------- settings

def test_settings_replace_the_constants_and_are_put_back():
    original = xml_builder.ENABLE_LEVEL_GATE
    rules.activate({"settings": {"levelGate": False, "openEndMaxDistanceM": 0.9, "excludedPourTypes": ["BOSS", "PLINTH"]}})
    assert xml_builder.ENABLE_LEVEL_GATE is False
    assert xml_builder.OPEN_END_MAX_DISTANCE_M == 0.9
    rules.activate({})
    assert xml_builder.ENABLE_LEVEL_GATE == original
    assert xml_builder.OPEN_END_MAX_DISTANCE_M == config.OPEN_END_MAX_DISTANCE_M


def test_the_minimum_volume_and_excluded_types_decide_which_pours_are_in():
    excluded = rules.excluded_pour_types(config.EXCLUDED_POUR_TYPES)
    small = rec("S1", "SLAB", volume=0.5)
    assert rules.active().is_included(small, excluded)
    rules.activate({"settings": {"minPourVolumeM3": 1}})
    assert not rules.active().is_included(small, excluded)
    assert rules.active().is_included(rec("ST1", "STAIR", volume=0.1), excluded)  # stairs are always in


# ---------------------------------------------------------------- groups, level tasks, sequences

def model():
    """B1: a raft, then on levels 1 and 2 a wall and a slab each; every pour with its generated activities."""
    pours = [rec("R0", "RAFT", level=0)]
    for lv in (1, 2):
        pours += [rec(f"W{lv}", "WALL", level=lv), rec(f"S{lv}", "SLAB", level=lv)]
    acts = []
    for r in pours:
        acts += gen.create_activities(r, FakeWbs())
    return pours, acts


GROUPS = [
    {"id": "WALLS", "forEach": ["building", "level"], "select": {"family": "wall"}},
    {"id": "SLABS", "forEach": ["building", "level"], "select": {"family": "slab"}},
    {"id": "RAFTS", "forEach": ["building"], "select": {"family": "raft"}},
    {"id": "STRUCT", "forEach": ["building"], "include": ["WALLS", "SLABS"]},
]


def test_a_group_can_include_other_groups():
    r = rules.activate({"groups": GROUPS})
    assert r.group_ids(rec("W1", "WALL")) == {"WALLS", "STRUCT"}
    assert r.group_ids(rec("R0", "RAFT", level=0)) == {"RAFTS"}


def wbs_for(acts):
    wbs = WBSManager("B1")
    wbs.register("B1 - Construction")
    wbs.register("B1 - Level 1", "B1 - Construction")
    wbs.register("B1 - Level 2", "B1 - Construction")
    return wbs


def test_level_tasks_one_per_building_and_level():
    r = rules.activate({"groups": GROUPS, "levelTasks": [{"id": "WALLS", "name": "Walls", "group": "WALLS"}, {"id": "SLABS", "name": "Slabs", "group": "SLABS"}]})
    pours, acts = model()
    tasks = rule_logic.PourTasks(acts)
    new, relations, messages = rule_logic.build_level_tasks(r, tasks, wbs_for(acts), [a["task_id"] for a in acts])
    ids = sorted(a["task_id"] for a in new)
    assert ids == [f"{config.PROJECT_SHORT}-B1-L{lv}-{k}" for lv in (1, 2) for k in ("SLABS", "WALLS")]
    walls1 = next(a for a in new if a["task_id"].endswith("L1-WALLS"))
    assert walls1["loe"] and walls1["task_name"] == "B1 - L1 - Walls" and walls1["members"] == ["W1"]
    # SS from the pour's first activity, FF from its last
    mine = [x for x in relations if x["succ"] == walls1["task_id"]]
    assert {(x["type"], x["pred"]) for x in mine} == {("SS", tasks.first("W1")), ("FF", tasks.last("W1"))}
    assert all(x["track"] is False for x in relations)


def test_a_sequence_steps_through_the_levels():
    r = rules.activate({"groups": GROUPS, "sequences": [{
        "id": "UP", "name": "Build up",
        "steps": [{"group": "RAFTS"}, {"group": "WALLS", "perLevel": True}, {"group": "SLABS", "perLevel": True}],
    }]})
    pours, acts = model()
    tasks = rule_logic.PourTasks(acts)
    new, relations, messages = rule_logic.build_sequences(r, tasks, wbs_for(acts), [a["task_id"] for a in acts])
    # raft, walls L1, slabs L1, walls L2, slabs L2 -> four milestones between five steps
    assert [a["task_id"] for a in new] == [f"{config.PROJECT_SHORT}-B1-SEQ-UP-{n:03d}" for n in (1, 2, 3, 4)]
    first = new[0]["task_id"]
    assert {(x["pred"], x["succ"]) for x in relations if x["succ"] == first} == {(tasks.final("R0"), first)}
    assert {x["succ"] for x in relations if x["pred"] == first} == {tasks.first("W1")}
    last = new[-1]["task_id"]
    assert {x["succ"] for x in relations if x["pred"] == last} == {tasks.first("S2")}
    assert all(a["rule_milestone"] and a["milestone"] for a in new)


# ---------------------------------------------------------------- contacts from the clash results

def clash(a, b):
    return {"Pour A GUID": a, "Pour B GUID": b}


def test_a_slab_waits_for_every_object_in_contact_below():
    r = rules.activate({"contacts": [{
        "id": "slabs-on-below", "subject": {"family": "slab"}, "contact": "below", "with": {}, "predEnd": "final", "succEnd": "start",
    }]})
    pours = [
        rec("S2", "SLAB", level=2),
        rec("W1", "WALL", level=1, min_elevation=3.0, max_elevation=6.0),       # under the slab
        rec("C1", "COLUMN", level=1, min_elevation=3.0, max_elevation=6.0),
        rec("W2", "WALL", level=2, min_elevation=6.0, max_elevation=9.0),       # beside / above: not below
    ]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    tasks = rule_logic.PourTasks(acts)
    relations, builtin, messages = rule_logic.build_contact_relations(r, tasks, [clash("S2", "W1"), clash("S2", "C1"), clash("S2", "W2")])
    assert {(x["pred"], x["succ"]) for x in relations} == {(tasks.final("W1"), tasks.first("S2")), (tasks.final("C1"), tasks.first("S2"))}
    assert all(x["type"] == "FS" and x["source"] == "contact:slabs-on-below" for x in relations)


def test_a_contact_rule_can_filter_by_what_touches_and_take_over_the_built_in_links():
    r = rules.activate({"contacts": [{
        "id": "c", "subject": {"family": "slab"}, "contact": "below", "with": {"family": "wall"}, "replaceBuiltIn": ["slabSupport"],
        "type": "SS", "lagHours": 8, "maxLevelGap": 1,
    }]})
    pours = [rec("S2", "SLAB", level=2), rec("W1", "WALL", level=1, min_elevation=3.0, max_elevation=6.0), rec("C1", "COLUMN", level=1, min_elevation=3.0, max_elevation=6.0)]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    tasks = rule_logic.PourTasks(acts)
    relations, builtin, _ = rule_logic.build_contact_relations(r, tasks, [clash("S2", "W1"), clash("S2", "C1")])
    assert [(x["pred"], x["type"], x["lag"]) for x in relations] == [(tasks.final("W1"), "SS", 8.0)]
    assert builtin == {"slab_support": {tasks.first("S2")}}
    kept = rule_logic.drop_builtin({tasks.first("S2"): ["x"], "other": ["y"]}, builtin["slab_support"])
    assert kept == {"other": ["y"]}


# ---------------------------------------------------------------- level links

def test_extras_link_to_the_level_task_of_their_level():
    r = rules.activate({
        "groups": GROUPS,
        "levelTasks": [{"id": "WALLS", "group": "WALLS"}, {"id": "SLABS", "group": "SLABS"}],
        "levelLinks": [{"id": "ll", "activities": "extras", "tasks": ["WALLS", "SLABS"], "type": "FF"}],
        "extraTags": {"HLP-1": {"building": "B1", "level": "L2"}, "HLP-2": {"level": "L9"}},
    })
    pours, acts = model()
    tasks = rule_logic.PourTasks(acts)
    level_acts, _rel, _m = rule_logic.build_level_tasks(r, tasks, wbs_for(acts), [])
    extras = [{"task_id": "HLP-1", "extra": True}, {"task_id": "HLP-2", "extra": True}]
    early, late, msgs = rule_logic.build_level_links(r, tasks, extras, level_acts, acts + extras, "B1")
    assert {(x["pred"], x["succ"], x["type"]) for x in early} == {
        ("HLP-1", f"{config.PROJECT_SHORT}-B1-L2-WALLS", "FF"), ("HLP-1", f"{config.PROJECT_SHORT}-B1-L2-SLABS", "FF"),
    }


def test_open_ended_activities_link_to_their_level_task():
    r = rules.activate({
        "groups": GROUPS, "levelTasks": [{"id": "WALLS", "group": "WALLS"}],
        "levelLinks": [{"id": "ll", "activities": "open", "tasks": ["WALLS"], "type": "FF"}],
    })
    pours, acts = model()
    tasks = rule_logic.PourTasks(acts)
    level_acts, _rel, _m = rule_logic.build_level_tasks(r, tasks, wbs_for(acts), [])
    early, late, _ = rule_logic.build_level_links(r, tasks, [], level_acts, acts + level_acts, "B1")
    assert early == [] and len(late) == 1
    open_ids = {tasks.last("W1"), tasks.last("S1"), "unknown"}
    made = rule_logic.late_level_relations(late, open_ids, level_acts, acts + level_acts, tasks)
    assert {(x["pred"], x["succ"]) for x in made} == {(tasks.last("W1"), f"{config.PROJECT_SHORT}-B1-L1-WALLS"), (tasks.last("S1"), f"{config.PROJECT_SHORT}-B1-L1-WALLS")}


# ---------------------------------------------------------------- the whole XML: level tasks are dated from their pours

def test_a_level_task_spans_its_pours_in_the_written_programme(monkeypatch):
    monkeypatch.setattr(xml_builder, "get_plan_footprint", lambda element: None)
    r = rules.activate(with_slab_chain({"groups": GROUPS, "levelTasks": [{"id": "SLABS", "group": "SLABS"}], "sequences": [{
        "id": "UP", "steps": [{"group": "SLABS", "perLevel": True}],
    }]}))
    pours, acts = model()
    # level 1 slab then level 2 slab, by a rule link between their activities
    tasks = rule_logic.PourTasks(acts)
    wbs = WBSManager("XML", start_counter=0)
    wbs.register("B1 - Construction")
    wbs.register("B1 - Level 1", "B1 - Construction")
    wbs.register("B1 - Level 2", "B1 - Construction")
    for a in acts:
        a["wbs_oid"] = 1
    level_acts, level_rel, _ = rule_logic.build_level_tasks(r, tasks, wbs, [a["task_id"] for a in acts])
    chain = xml_builder._build_intra_pour_predecessors(acts)
    rule_rel = level_rel + [{"pred": tasks.final("S1"), "succ": tasks.first("S2"), "type": "FS", "lag": 0.0, "source": "t", "replaces": False, "track": True}]
    root = xml_builder.create_p6_xml_root()
    xml_builder.add_project_and_calendar(root, building_code="B1", project_wbs_object_id="1", project_id="1")
    resources_ = xml_builder.add_resources(root)
    xml_builder.write_activities_and_relationships(root, acts + level_acts, resources_, wbs, intra_predecessors=chain, rule_relations=rule_rel)
    apply_cpm_to_xml(root, xml_builder.START_DATE)
    project = root.find("Project")
    by_id = {a.findtext("Id"): a for a in project.findall("Activity")}
    slabs2 = by_id[f"{config.PROJECT_SHORT}-B1-L2-SLABS"]
    slabs1 = by_id[f"{config.PROJECT_SHORT}-B1-L1-SLABS"]
    assert slabs1.findtext("Type") == "Level of Effort"
    s1_first, s1_last = by_id[tasks.first("S1")], by_id[tasks.last("S1")]
    assert slabs1.findtext("PlannedStartDate") == s1_first.findtext("PlannedStartDate")
    assert slabs1.findtext("PlannedFinishDate") == s1_last.findtext("PlannedFinishDate")
    # level 2 starts after level 1's concrete (its curing runs alongside, so the level task of level 1 ends later)
    assert slabs2.findtext("PlannedStartDate") > by_id[tasks.final("S1")].findtext("PlannedFinishDate")
    assert slabs1.findtext("PlannedFinishDate") > by_id[tasks.final("S1")].findtext("PlannedFinishDate")
    assert int(slabs1.findtext("PlannedDuration")) > 0
    # the pours were not held back by their level task, and the level-task links are not "successors"
    assert by_id[tasks.first("S1")].findtext("PlannedStartDate") <= slabs1.findtext("PlannedStartDate")


# ---------------------------------------------------------------- groups that leave pours out

def _scope():
    return {"groups": [
        {"id": "NOT-SCHEDULED", "treatAs": "exclude", "select": {"type": "BOSS|SCREED|GROUT|SPECIAL"}},
        {"id": "SMALL", "treatAs": "exclude", "select": {"volumeBelow": 0.25, "typeNot": "STAIR"}},
        {"id": "STAIR-STEPS", "treatAs": "stairStep", "select": {"type": "STAIR", "volumeBelow": 0.09}},
    ]}


def test_pours_in_a_group_treated_as_exclude_get_no_activities():
    excluded = config.EXCLUDED_POUR_TYPES
    rules.activate(_scope())
    active = rules.active()
    assert active.is_included(rec("S1", "SLAB", volume=10.0), excluded)
    assert not active.is_included(rec("B1", "BOSS", volume=10.0), excluded)  # by pour type
    assert not active.is_included(rec("S2", "SLAB", volume=0.1), excluded)  # by volume
    assert active.is_included(rec("S3", "SLAB", volume=0.25), excluded)  # 0.25 is not below 0.25
    assert active.is_included(rec("ST", "STAIR", volume=0.2), excluded)  # a small stair is not "small": the group says not a stair
    assert active.is_included(rec("STEP", "STAIR", volume=0.05), excluded)  # a stair step is always in


def test_the_groups_replace_the_smallest_pour_and_excluded_type_settings():
    excluded = config.EXCLUDED_POUR_TYPES
    rules.activate({"settings": {"minPourVolumeM3": 5, "excludedPourTypes": ["SLAB"]}, "groups": [{"id": "TINY", "treatAs": "exclude", "select": {"volumeBelow": 0.01}}]})
    assert rules.active().is_included(rec("S1", "SLAB", volume=1.0), excluded)  # the settings no longer apply
    assert not rules.active().is_included(rec("S2", "SLAB", volume=0.005), excluded)
    rules.activate({"settings": {"minPourVolumeM3": 5}})
    assert not rules.active().is_included(rec("S1", "SLAB", volume=1.0), excluded)  # without such groups they do


def test_a_switched_off_group_is_not_applied():
    rules.activate({"groups": [{"id": "SMALL", "enabled": False, "treatAs": "exclude", "select": {"volumeBelow": 0.25}}]})
    assert rules.active().is_included(rec("S2", "SLAB", volume=0.1), config.EXCLUDED_POUR_TYPES) is False  # the generator's own 0.25 applies


def test_a_group_decides_which_stair_pours_are_steps():
    rules.activate(_scope())
    assert rules.active().is_stair_step(rec("STEP", "STAIR", volume=0.05)) is True
    assert rules.active().is_stair_step(rec("FLIGHT", "STAIR", volume=1.5)) is False
    rules.activate(None)
    assert rules.active().is_stair_step(rec("STEP", "STAIR", volume=0.05)) is None  # no such group: the stair step volume setting decides


# ---------------------------------------------------------------- where an extra activity goes in the WBS

class _Wbs:
    def __init__(self, names):
        self.map, self.order, self.parent_map = {n: i + 1 for i, n in enumerate(names)}, list(names), {}

    def get_id(self, name):
        return self.map.get(name)

    def register(self, name, parent_name=None):
        if name not in self.map:
            self.map[name] = len(self.map) + 1
            self.order.append(name)
            self.parent_map[name] = parent_name
        return self.map[name]


def test_an_extra_goes_where_its_tag_says():
    pour = {"rec": rec("W1", "WALL", level=1, building="1HDAB", wbs_prefix="1HDAB"), "task_id": "T1"}
    wbs = _Wbs(["1HDAB - Construction", "1HDAB - Level 1", "1HDAB - Level 1 - External Walls"])
    extras = [{"task_id": "E-WALLS", "wbs_oid": 99, "extra": True}, {"task_id": "E-SLABS", "wbs_oid": 99, "extra": True},
              {"task_id": "E-OWN", "wbs_oid": 99, "extra": True}, {"task_id": "E-DEFAULT", "wbs_oid": 99, "extra": True}, {"task_id": "E-NOLEVEL", "wbs_oid": 99, "extra": True}]
    tag = lambda wbs_, level="L1": {"building": "1HDAB", "level": level, "wbs": wbs_}  # noqa: E731
    r = rules.activate({"extraTags": {"E-WALLS": tag("level"), "E-SLABS": tag("slabs"), "E-OWN": tag("path:High level / Facade"), "E-NOLEVEL": tag("level", "L9")}})
    messages = rule_logic.place_extras(r, extras, wbs, [pour], "1HDAB")
    oid = {e["task_id"]: e["wbs_oid"] for e in extras}
    assert oid["E-WALLS"] == wbs.get_id("1HDAB - Level 1")  # on the level, beside the walls groups
    assert oid["E-SLABS"] == wbs.get_id("1HDAB - Level 1 - Slabs")  # the level's Slabs group, made when it is not there
    assert oid["E-OWN"] == wbs.get_id("Facade") and wbs.parent_map["Facade"] == "High level"
    assert oid["E-DEFAULT"] == 99  # no tag: stays in the Extra activities folder
    assert oid["E-NOLEVEL"] == 99 and any("E-NOLEVEL" in m for m in messages)


def test_an_extra_tied_to_one_level_task_links_to_that_one_only():
    tasks_ = {("WALLS", "1HDAB", "L1"): "LT-W", ("SLABS", "1HDAB", "L1"): "LT-S"}
    level_acts = [{"task_id": "LT-W", "level_task": "WALLS", "level_key": ("1HDAB", "L1")}, {"task_id": "LT-S", "level_task": "SLABS", "level_key": ("1HDAB", "L1")}]
    assert set(rule_logic._level_task_index(level_acts)) == {("WALLS", "1HDAB", "L1"), ("SLABS", "1HDAB", "L1")} and tasks_
    r = rules.activate({"levelLinks": [{"id": "LL", "activities": "extras", "tasks": ["WALLS", "SLABS"], "type": "FF"}],
                        "extraTags": {"E1": {"building": "1HDAB", "level": "L1", "task": "SLABS"}, "E2": {"building": "1HDAB", "level": "L1"}}})
    early, _late, _msgs = rule_logic.build_level_links(r, None, [{"task_id": "E1"}, {"task_id": "E2"}], level_acts, [], "1HDAB")
    pairs = sorted((x["pred"], x["succ"]) for x in early) if early and "pred" in early[0] else sorted((x[0], x[1]) for x in early)
    assert pairs == [("E1", "LT-S"), ("E2", "LT-S"), ("E2", "LT-W")]


def test_an_extra_is_the_kind_its_tag_says():
    def kind_of(tag_kind, days=5):
        act = {"task_id": "E1", "duration_days": days, "extra": True}
        if days <= 0:
            act.update({"milestone": True, "milestone_type": "Finish"})
        r = rules.activate({"extraTags": {"E1": {"kind": tag_kind}}})
        rule_logic.place_extras(r, [act], _Wbs([]), [], "")
        return act

    assert kind_of("start", 5)["milestone_type"] == "Start" and kind_of("start", 5)["duration_days"] == 0
    assert kind_of("finish", 5)["milestone"] is True
    assert kind_of("summary").get("summary") is True and "milestone" not in kind_of("summary", 0)
    assert kind_of("loe").get("loe") is True
    assert "milestone" not in kind_of("task", 0) and kind_of("task", 7)["duration_days"] == 7
    assert kind_of("", 0).get("milestone") is True  # no kind: a 0-day extra stays a finish milestone


# ---------------------------------------------------------------- groups made of conditions (the 4D group's rows)

def _flt(field, op, value, conj="and", **more):
    return {"field": field, "op": op, "value": value, "conj": conj, **more}


def _in(group_filters, record):
    rules.activate({"groups": [{"id": "G", "filters": group_filters}]})
    return "G" in rules.active().group_ids(record)


def test_a_group_is_a_list_of_conditions_like_a_4d_group():
    slab, small_slab = rec("S1", "SLAB", volume=10.0), rec("S2", "SLAB", volume=0.1)
    assert _in([_flt("type", "equals", "SLAB")], slab)
    assert _in([_flt("type", "equals", "WALL|SLAB")], slab)  # one of several
    assert not _in([_flt("type", "notEquals", "SLAB")], slab)
    assert _in([_flt("type", "contains", "LA")], slab) and _in([_flt("type", "startsWith", "SL")], slab) and _in([_flt("type", "endsWith", "AB")], slab)
    assert not _in([_flt("type", "notContains", "LA")], slab)
    assert _in([_flt("volume", "lessThan", "0.25")], small_slab) and not _in([_flt("volume", "lessThan", "0.25")], slab)
    assert _in([_flt("volume", "atLeast", "10")], slab) and not _in([_flt("volume", "greaterThan", "10")], slab)


def test_conditions_join_left_to_right_by_and_or_and_the_ignored_ones_do_not_count():
    wall = rec("W1", "WALL", volume=5.0)
    both = [_flt("type", "equals", "WALL"), _flt("volume", "lessThan", "1")]
    assert not _in(both, wall)  # and
    assert _in([both[0], {**both[1], "conj": "or"}], wall)  # or
    assert _in([both[0], {**both[1], "ignore": True}], wall)  # Ign: switched off
    assert _in([both[0], _flt("type", "equals", "")], wall)  # no value: left out, as in the 4D groups
    assert not _in([_flt("type", "equals", "")], wall)  # nothing that counts: not a group of everything


def test_a_condition_can_read_a_model_property():
    r = rec("S1", "SLAB", props={"CWA Pour": {"Pour ID Number": "0042", "Rebar Weight": 12.5}})
    assert _in([_flt("prop:CWA Pour/Pour ID Number", "startsWith", "00")], r)
    assert _in([_flt("prop:CWA Pour/Rebar Weight", "atLeast", "10")], r)
    assert not _in([_flt("prop:CWA Pour/Missing", "equals", "x")], r)


# ---------------------------------------------------------------- objects joined into one activity

def _join_records():
    return [rec("A", volume=10.0), rec("B", volume=4.0), rec("C", volume=2.0), rec("D", volume=7.0)]


def test_joined_objects_get_one_set_of_activities_the_mains():
    from main import _refresh_records
    rules.activate({"joins": [{"id": "J1", "main": "A", "members": ["B", "C"]}]})
    records = _join_records()
    _refresh_records(records)
    by = {r["element"].GlobalId: r for r in records}
    assert [by[g]["include"] for g in "ABCD"] == ["YES", "NO", "NO", "YES"]
    assert by["A"]["volume"] == 16.0  # the members' volume is the main's
    assert by["B"]["joined_into"] is by["A"] and by["A"]["joined"] == [by["B"], by["C"]]
    assert by["D"]["volume"] == 7.0


def test_joining_is_undone_when_the_join_is_taken_out_and_never_counted_twice():
    from main import _refresh_records
    rules.activate({"joins": [{"main": "A", "members": ["B"]}]})
    records = _join_records()
    _refresh_records(records)
    _refresh_records(records)  # a long-running generator refreshes the same records for every request
    assert records[0]["volume"] == 14.0
    rules.activate({})
    _refresh_records(records)
    assert [r["volume"] for r in records] == [10.0, 4.0, 2.0, 7.0]
    assert all(r["include"] == "YES" and "joined" not in r for r in records)


def test_a_switched_off_join_or_a_missing_main_changes_nothing():
    from main import _refresh_records
    rules.activate({"joins": [{"main": "A", "members": ["B"], "enabled": False}, {"main": "ZZ", "members": ["C"]}]})
    records = _join_records()
    _refresh_records(records)
    assert [r["include"] for r in records] == ["YES"] * 4


def test_what_touched_a_joined_object_touches_its_main_object():
    rules.activate({"joins": [{"main": "A", "members": ["B"]}]})
    clashes = [{"Pour A GUID": "B", "Pour B GUID": "D", "Distance (mm)": 1}, {"Pour A GUID": "A", "Pour B GUID": "B"}, {"Pour A GUID": "C", "Pour B GUID": "D"}]
    out = rules.active().remap_clashes(clashes)
    assert out == [{"Pour A GUID": "A", "Pour B GUID": "D", "Distance (mm)": 1}, {"Pour A GUID": "C", "Pour B GUID": "D"}]  # A-B is inside the join
    assert clashes[0]["Pour A GUID"] == "B"  # the generator's own list is untouched
    rules.activate({})
    assert rules.active().remap_clashes(clashes) is clashes
