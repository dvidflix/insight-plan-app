"""Generate 3's nested work packages (src/prs/workPackages.ts packagesRequest, checked in tests/unit/packageTree.test.ts). A package that holds others
reaches the generator as a group that includes theirs; with it the generator, unchanged, must build: a summary bar over the packages inside, a limit
on how many of them work at once, and a second short sequence for a package that starts after another than the one above it.

Here package A holds A1 and A2 (built one after the other), at most one of them at once, with a summary bar; B starts two working days (16 h) after
the whole of A."""
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


def item(ident, group, level, quantity):
    return {"id": ident, "group": group, "building": "B1", "level": level, "name": group, "quantity": quantity, "quantities": {"count": 1, "area": 0}}


ITEMS = [item("WP|A1", "WP-01.01 A1", "Level 1", 4), item("WP|A2", "WP-01.02 A2", "Level 1", 10), item("WP|B", "WP-02 B", "Level 2", 30)]


def method(group, days):
    return {"id": f"Install for {group}", "group": group, "priority": 1000,
            "tasks": [{"phase": p, "name": p, "formula": str(d), "crew": "STD-INSTALL", "priority": 999} for p, d in zip(("Install", "Finish"), days)]}


RULES = {
    "sequences": [
        {"id": "STEPS", "name": "Work packages", "steps": [{"group": "WP-01.01 A1"}, {"group": "WP-01.02 A2"}]},
        {"id": "STEPS-2", "name": "Work packages: WP-02 B starts after WP-01 A", "steps": [{"group": "WP-01 A"}, {"group": "WP-02 B", "lagHours": 16}]},
    ],
    "groups": [{"id": "WP-01 A", "name": "WP-01 A", "forEach": [], "filters": [], "include": ["WP-01.01 A1", "WP-01.02 A2"]}],
    "levelTasks": [{"id": "WPBAR-WP-01", "name": "WP-01 A", "group": "WP-01 A"}],
    "limits": [{"id": "WPLIM-WP-01-Install", "phase": "Install", "group": "WP-01 A", "max": 1}],
    "recipes": [method("WP-01.01 A1", (2, 1)), method("WP-01.02 A2", (3, 1)), method("WP-02 B", (4, 2))],
    "trades": [{"id": "STD-INSTALL", "name": "Installation crew", "capacity": 0}],
    "crewTemplates": [{"id": "STD-INSTALL", "trades": [{"trade": "STD-INSTALL", "size": 3}]}],
}


def generate(tmp):
    request = work_items.with_groups({"workItems": ITEMS, "rules": RULES})
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    xml = Path(tmp) / "tree.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=datetime(2026, 1, 5))
    links = json.loads((Path(tmp) / "tree.xml.why.json").read_text(encoding="utf-8"))["links"]
    return activities, links, xml.read_text(encoding="utf-8")


def task_ids(activities):
    return {(a["rec"]["element"].GlobalId, a["phase"]): a["task_id"] for a in activities if a.get("rec", {}).get("element") is not None}


def test_a_package_that_starts_after_a_package_holding_others_waits_for_all_of_it(tmp_path):
    activities, links, _xml = generate(tmp_path)
    task = task_ids(activities)
    second = [link for link in links if link[4] == "sequence:STEPS-2"]
    assert second, "the second sequence makes no links"
    # Both packages inside A feed the milestone; the milestone starts B, 16 h later.
    milestone = next(link[1] for link in second if link[0] == task[("WP|A1", "Finish")])
    assert any(link[0] == task[("WP|A2", "Finish")] and link[1] == milestone for link in second)
    into_b = next(link for link in second if link[0] == milestone and link[1] == task[("WP|B", "Install")])
    assert into_b[2] == "FinishToStart" and float(into_b[3]) == 16.0


def test_a_package_that_holds_others_gets_a_summary_bar_and_a_limit(tmp_path):
    _activities, links, xml = generate(tmp_path)
    assert "WP-01 A" in xml and "WPBAR-WP-01" in xml, "no summary bar over the package"
    limit = [link for link in links if str(link[4]).startswith("limit:")]
    task = task_ids(_activities)
    assert any(link[0] == task[("WP|A1", "Install")] and link[1] == task[("WP|A2", "Install")] for link in limit), "the limit does not chain the packages inside"
