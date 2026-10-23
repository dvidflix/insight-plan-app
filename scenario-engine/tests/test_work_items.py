"""Work items: units of work that are not concrete pours (core/work_items.py), generated through the same path a pour takes."""
import re
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as engine  # noqa: E402
from core import rules, work_items  # noqa: E402


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


ITEMS = [
    {"id": "WI-1", "group": "Chiller", "building": "H1", "level": "L1", "quantity": 4, "quantities": {"count": 4, "kw": 800}},
    {"id": "WI-2", "group": "Chiller", "building": "H1", "level": "L2", "quantity": 2},
    {"id": "WI-3", "group": "Cable tray", "building": "H1", "level": "L1", "quantity": 120.5},
    {"id": "WI-1", "group": "Duplicate id is left out", "building": "H1", "level": "L1"},
    {"id": "", "group": "No id is left out"},
    {"group": "No id at all is left out"},
]

RECIPES = [
    {"id": "R-CHILLER", "group": "Chiller", "tasks": [{"phase": "Place", "days": 2}, {"phase": "Connect", "days": 3}, {"phase": "Test", "days": 1}],
     "edges": [{"from": "Place", "to": "Connect"}, {"from": "Connect", "to": "Test"}]},
]


def generate(items, data=None, tmp=None):
    request = work_items.with_groups({"workItems": items, "rules": data or {}})
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    xml = Path(tmp) / "wi.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=datetime(2026, 1, 5))
    return records, activities, xml.read_text(encoding="utf-8")


def test_only_usable_items_make_records_and_they_are_always_in():
    records = engine.build_work_item_records(ITEMS)
    assert [r["element"].GlobalId for r in records] == ["WI-1", "WI-2", "WI-3"]
    assert all(r["include"] == "YES" for r in records)  # the smallest-volume rule is for pours
    assert records[0]["building"] == "H1" and records[0]["level_code"] == "L1" and records[1]["level_code"] == "L2"
    assert records[0]["volume"] == 4 and records[2]["volume"] == 120.5
    assert records[0]["props"]["Work item"] == {"count": 4.0, "kw": 800.0, "quantity": 4.0}


def test_an_item_with_no_recipe_is_one_activity(tmp_path):
    records, activities, xml = generate(ITEMS, tmp=tmp_path)
    assert [a["phase"] for a in activities] == ["Work", "Work", "Work"]
    assert all(a["duration_days"] > 0 for a in activities)
    assert len({a["task_id"] for a in activities}) == 3
    assert "Chiller" in xml


def test_a_recipe_of_the_group_gives_the_items_its_activities(tmp_path):
    records, activities, _ = generate(ITEMS, {"recipes": RECIPES}, tmp_path)
    chillers = [a for a in activities if a["rec"]["element"].GlobalId in ("WI-1", "WI-2")]
    assert [(a["phase"], a["duration_days"]) for a in chillers if a["rec"]["element"].GlobalId == "WI-1"] == [("Place", 2.0), ("Connect", 3.0), ("Test", 1.0)]
    cable = [a for a in activities if a["rec"]["element"].GlobalId == "WI-3"]
    assert [a["phase"] for a in cable] == ["Work"]  # no recipe for that group


def test_a_group_name_with_pour_words_is_not_a_pour(tmp_path):
    items = [{"id": "W1", "group": "Retaining wall", "building": "B", "level": "L1"}, {"id": "S1", "group": "Slab on grade", "building": "B", "level": "L1"}]
    records, activities, _ = generate(items, tmp=tmp_path)
    assert [a["phase"] for a in activities] == ["Work", "Work"]  # not Rebar / Formwork / Concrete


def test_the_requests_rules_find_the_items_by_their_group():
    request = work_items.with_groups({"workItems": ITEMS, "rules": {"groups": [{"id": "Chiller", "filters": []}]}})
    ids = [g["id"] for g in request["rules"]["groups"]]
    assert ids == ["Chiller", "Cable tray"]  # a group the rules have is kept as it is
    assert work_items.with_groups({"workItems": []}) == {"workItems": []}


def test_the_sequence_of_the_request_orders_items_by_their_id(tmp_path):
    request = work_items.with_groups({"workItems": ITEMS[:3], "rules": {}, "sequence": [{"GUID": "WI-3", "Index": 1}, {"GUID": "WI-1", "Index": 2}, {"GUID": "WI-2", "Index": 3}]})
    overrides = engine.overrides_from_scenario(request)
    assert [s["GUID"] for s in overrides["__sequence_order__"]] == ["WI-3", "WI-1", "WI-2"]


def test_the_reason_for_every_link_is_written_next_to_the_xml(tmp_path):
    import json
    records, activities, xml = generate(ITEMS, {"recipes": RECIPES}, tmp_path)
    why = json.loads((tmp_path / "wi.xml.why.json").read_text(encoding="utf-8"))
    links = why["links"]
    assert links and all(len(link) == 5 for link in links)
    written = len(re.findall(r"<Relationship>", xml))
    assert len(links) == written  # one reason per link written
    assert {link[4] for link in links} >= {"intra"}  # the recipe's own steps
