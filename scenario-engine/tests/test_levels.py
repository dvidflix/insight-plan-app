"""The level definition: which property is the level, and the order of the levels (core/levels.py)."""
import copy

from core import levels


def rec(level, building="B1", **extra):
    """A record as build_pour_records makes it, for a pour whose level property is `level`."""
    value = level or "Unknown"
    n = levels.parse_level_int(value)
    code = "L0" if n <= 0 else f"L{n}"
    return {
        "building": building, "level_int": n, "level_code": code, "level_display": value,
        "lg2": f"{building}-{code} - ZONE X", "lg3": f"{building}-{code} - X",
        "task_id_base": f"PRJ-{building}-{code}", "general_level_3": f"{building}/{level or ''}/Z/W",
        "concrete_wbs_name": f"B - {value} - Walls",
        "pour_pset": {"Level": level, "Floor": extra.get("floor", "")},
    }


def values(records, key="level_int"):
    return [r[key] for r in records]


def test_with_no_setting_nothing_changes():
    records = [rec("L2"), rec("Roof"), rec("Level 03")]
    before = copy.deepcopy(records)
    levels.apply(records, {})
    levels.apply(records, {"levelProperty": "Level"})
    assert [{k: v for k, v in r.items() if k != "_level0"} for r in records] == before
    assert values(records) == [2, 0, 3]


def test_an_order_replaces_the_number_in_the_text():
    records = [rec("Roof"), rec("L1"), rec("Podium"), rec("L2")]
    levels.apply(records, {"levelOrder": ["Podium", "L1", "L2", "Roof"]})
    assert values(records) == [4, 2, 1, 3]
    assert values(records, "level_code") == ["L4", "L2", "L1", "L3"]
    assert values(records, "level_display") == ["Roof", "L1", "Podium", "L2"]
    assert values(records, "level_label") == ["Roof", "L1", "Podium", "L2"]


def test_what_is_made_from_the_level_follows_it():
    r = rec("Roof")
    levels.apply([r], {"levelOrder": ["Podium", "Roof"]})
    assert r["level_code"] == "L2"
    assert r["lg2"] == "B1-L2 - ZONE X" and r["lg3"] == "B1-L2 - X"
    assert r["task_id_base"] == "PRJ-B1-L2"
    assert r["general_level_3"] == "B1/Roof/Z/W"
    assert r["concrete_wbs_name"] == "B - Roof - Walls"


def test_a_level_the_list_does_not_name_comes_after_it_alphabetically():
    records = [rec("Zeta"), rec("Alpha"), rec("L1")]
    levels.apply(records, {"levelOrder": ["L1"]})
    assert values(records) == [3, 2, 1]


def test_the_order_is_case_and_space_blind_and_a_repeat_counts_once():
    records = [rec(" l1 "), rec("L2")]
    levels.apply(records, {"levelOrder": ["L2", "L1", "l2"]})
    assert values(records) == [2, 1]


def test_another_property_is_the_level():
    records = [rec("L1", floor="Basement"), rec("L2", floor="Ground")]
    levels.apply(records, {"levelProperty": "Floor", "levelOrder": ["Basement", "Ground"]})
    assert values(records, "level_display") == ["Basement", "Ground"]
    assert values(records) == [1, 2]
    # no order: its first whole number, as the level always was (none here: all are level 0)
    levels.apply(records, {"levelProperty": "Floor"})
    assert values(records) == [0, 0]


def test_taking_the_setting_off_puts_the_original_reading_back():
    records = [rec("L2"), rec("Roof")]
    before = copy.deepcopy(records)
    levels.apply(records, {"levelOrder": ["Roof", "L2"]})
    assert values(records) == [2, 1]
    levels.apply(records, {})
    assert [{k: v for k, v in r.items() if k not in ("_level0", "level_label")} for r in records] == [{k: v for k, v in r.items() if k != "_level0"} for r in before]
    assert "level_label" not in records[0]


def test_a_pour_with_no_value_is_unknown():
    r = rec(None)
    levels.apply([r], {"levelProperty": "Floor", "levelOrder": ["A"]})
    assert r["level_display"] == "Unknown" and r["level_int"] == 2
