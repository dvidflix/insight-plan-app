"""Selectors in manual links, and a scenario's own extra activities (core/prs_links.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.prs_links import is_selector, merge_extras, parse_selector, resolve_relations, select_ids  # noqa: E402


def act(task_id, phase, building="1HDAB", level="L1", pour_type="SLAB", **extra):
    return {"task_id": task_id, "phase": phase, "rec": {"building": building, "level_code": level, "pour_type": pour_type, **extra}}


ACTS = [
    act("A-R", "Rebar"), act("A-C", "Concrete"),
    act("B-R", "Rebar", level="L2"), act("B-C", "Concrete", level="L2"),
    act("W-R", "Rebar", pour_type="WALL"), act("W-C", "Concrete", pour_type="WALL", is_external=True),
    act("X-C", "Concrete", building="1HK"),
]


def test_selector_is_recognised_and_parsed():
    assert is_selector("select:{level=L1}") and not is_selector("PRJ-1-R")
    terms, mode = parse_selector("select:{building=1HDAB; type=SLAB|RAFT; last}")
    assert terms == {"building": ["1hdab"], "type": ["slab", "raft"]} and mode == "last"


def test_picks_by_what_the_activity_is():
    assert select_ids("select:{building=1HDAB; type=SLAB; phase=Concrete}", ACTS) == ["A-C", "B-C"]
    assert select_ids("select:{building=1HDAB; type=SLAB; phase=Concrete; last}", ACTS) == ["B-C"]
    assert select_ids("select:{level=L1; type=slab; first}", ACTS) == ["A-R"]
    assert select_ids("select:{external=true}", ACTS) == ["W-C"]
    assert select_ids("select:{id=^W-}", ACTS) == ["W-R", "W-C"]


def test_extras_are_never_picked():
    acts = ACTS + [{"task_id": "EXTRA", "phase": "Extra", "extra": True, "rec": {}}]
    assert "EXTRA" not in select_ids("select:{phase=extra}", acts)


def test_relations_expand_selectors_and_leave_ids_alone():
    rels = [
        {"ActivityID1": "HLP-1", "ActivityID2": "select:{type=SLAB; level=L1; phase=Rebar}", "Relation": "FS", "Lag": 8},
        {"ActivityID1": "select:{type=SLAB; level=L2; phase=Concrete; last}", "ActivityID2": "HLP-2", "Relation": "SS", "Lag": 0},
        {"ActivityID1": "A-R", "ActivityID2": "A-C", "Relation": "FS", "Lag": 0},
    ]
    out, messages = resolve_relations(rels, ACTS + [act("HLP-1", "Extra"), act("HLP-2", "Extra")])
    assert out == [
        {"ActivityID1": "HLP-1", "ActivityID2": "A-R", "Relation": "FS", "Lag": 8},
        {"ActivityID1": "B-C", "ActivityID2": "HLP-2", "Relation": "SS", "Lag": 0},
        {"ActivityID1": "A-R", "ActivityID2": "A-C", "Relation": "FS", "Lag": 0},
    ]
    assert messages == []


def test_a_selector_that_matches_nothing_is_reported_not_fatal():
    out, messages = resolve_relations([{"ActivityID1": "select:{level=L9}", "ActivityID2": "A-C", "Relation": "FS", "Lag": 0}], ACTS)
    assert out == [] and len(messages) == 1 and "no activity matches" in messages[0]
    out, messages = resolve_relations([{"ActivityID1": "select:{nonsense}", "ActivityID2": "A-C", "Relation": "FS", "Lag": 0}], ACTS)
    assert out == [] and "Unknown word" in messages[0]


def test_scenario_extras_join_and_replace_by_task_id():
    base = {"retired": set(), "extras": [{"taskId": "E1", "name": "from SeaTable", "durationDays": 3}, {"taskId": "E2", "name": "keep"}]}
    merged = merge_extras(base, [{"TaskID": "E1", "Name": "scenario", "DurationDays": "5", "BaselineFinish": "2029-06-29"}, {"TaskID": "E3", "Name": "new"}])
    by_id = {e["taskId"]: e for e in merged["extras"]}
    assert set(by_id) == {"E1", "E2", "E3"}
    assert by_id["E1"]["name"] == "scenario" and by_id["E1"]["durationDays"] == 5.0 and by_id["E1"]["baselineFinish"] == "2029-06-29"
    assert by_id["E3"]["durationDays"] == 0.0
    assert merge_extras(base, []) is base
