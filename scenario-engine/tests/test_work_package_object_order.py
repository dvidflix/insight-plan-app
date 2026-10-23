"""Generate 3's fine-tuned object order (src/prs/objectOrder.ts, tests/unit/objectOrder.test.ts). A package with an object order reaches the generator
as a work item per object, each in a group of its own, a sequence of those groups in the order (objects of the same rank in one group that includes
theirs), and the package's group including them all, which the build order uses. The generator, unchanged, must chain the objects in that order and
make the next package wait for all of them.

Here package A has objects 1, 2 and 3 with 2 and 3 together after 1; package B follows A."""
import json
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


def item(ident, group, quantity):
    return {"id": ident, "group": group, "building": "B1", "level": "L00", "name": group, "quantity": quantity, "quantities": {"count": 1, "area": 0}}


ITEMS = [item("WP|A|G1", "WP-01 A #1", 5), item("WP|A|G2", "WP-01 A #2", 5), item("WP|A|G3", "WP-01 A #3", 5), item("WP|B", "WP-02 B", 10)]


def method(group, days):
    return {"id": f"Install for {group}", "group": group, "priority": 1000, "tasks": [{"phase": "Install", "name": "Install", "formula": str(days), "crew": "STD-INSTALL", "priority": 999}]}


RULES = {
    "sequences": [
        {"id": "STEPS", "name": "Work packages", "steps": [{"group": "WP-01 A"}, {"group": "WP-02 B"}]},
        {"id": "WPO-WP-01", "name": "Object order: WP-01 A", "steps": [{"group": "WP-01 A #1"}, {"group": "WP-01 A step 2"}]},
    ],
    "groups": [
        {"id": "WP-01 A step 2", "name": "WP-01 A step 2", "forEach": [], "filters": [], "include": ["WP-01 A #2", "WP-01 A #3"]},
        {"id": "WP-01 A", "name": "WP-01 A", "forEach": [], "filters": [], "include": ["WP-01 A #1", "WP-01 A #2", "WP-01 A #3"]},
    ],
    "recipes": [method("WP-01 A #1", 2), method("WP-01 A #2", 3), method("WP-01 A #3", 1), method("WP-02 B", 4)],
    "trades": [{"id": "STD-INSTALL", "name": "Installation crew", "capacity": 0}],
    "crewTemplates": [{"id": "STD-INSTALL", "trades": [{"trade": "STD-INSTALL", "size": 3}]}],
}


def test_the_objects_follow_their_order_and_the_next_package_waits_for_all(tmp_path):
    request = work_items.with_groups({"workItems": ITEMS, "rules": RULES})
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    xml = Path(tmp_path) / "order.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=datetime(2026, 1, 5))
    links = json.loads((Path(tmp_path) / "order.xml.why.json").read_text(encoding="utf-8"))["links"]
    task = {a["rec"]["element"].GlobalId: a["task_id"] for a in activities if a.get("rec", {}).get("element") is not None}
    days = {a["rec"]["element"].GlobalId: a["duration_days"] for a in activities if a.get("rec", {}).get("element") is not None}
    assert days == {"WP|A|G1": 2.0, "WP|A|G2": 3.0, "WP|A|G3": 1.0, "WP|B": 4.0}

    def after(seq, pred_guids, succ_guid):
        mine = [link for link in links if link[4] == f"sequence:{seq}"]
        into = {link[0] for link in mine if link[1] == task[succ_guid]}
        return all(any(link[0] == task[p] and link[1] in into for link in mine) for p in pred_guids)

    # Object 1, then objects 2 and 3 together.
    assert after("WPO-WP-01", ["WP|A|G1"], "WP|A|G2") and after("WPO-WP-01", ["WP|A|G1"], "WP|A|G3")
    # Package B waits for every object of A.
    assert after("STEPS", ["WP|A|G1", "WP|A|G2", "WP|A|G3"], "WP|B")
