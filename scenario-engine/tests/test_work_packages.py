"""Generate 3's work packages (src/prs/workPackages.ts packagesRequest) reach the generator as work items, steps and recipes. This request is the one
tests/unit/workPackages.test.ts checks the app makes; here the generator, unchanged, must build it: each package gets its method's activities with
the days the app worked out and the method's crew, the second package starts two working days (16 h) after the first has finished, and the third
starts with the second."""
import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as engine  # noqa: E402
from core import resources, rules, work_items  # noqa: E402


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


ITEMS = [
    {"id": "WP|A", "group": "WP-01 First", "building": "B1", "level": "Level 1", "name": "WP-01 First", "quantity": 4, "quantities": {"count": 1, "area": 0}},
    {"id": "WP|B", "group": "WP-02 Second", "building": "B1", "level": "Level 1", "name": "WP-02 Second", "quantity": 30, "quantities": {"count": 2, "area": 0}},
    {"id": "WP|C", "group": "WP-03 Third", "building": "B1", "level": "Level 2", "name": "WP-03 Third", "quantity": 30, "quantities": {"count": 1, "area": 0}},
]


def method(group, days):
    return {"id": f"In-situ concrete for {group}", "group": group, "priority": 1000,
            "tasks": [{"phase": p, "name": p, "formula": str(d), "crew": "STD-CONCRETE", "priority": 999} for p, d in zip(("Rebar", "Formwork", "Concrete"), days)]}


RULES = {
    "sequences": [{"id": "STEPS", "name": "Work packages", "steps": [{"group": "WP-01 First"}, {"group": "WP-02 Second + together", "lagHours": 16}]}],
    "groups": [{"id": "WP-02 Second + together", "name": "WP-02 Second + together", "forEach": [], "filters": [], "include": ["WP-02 Second", "WP-03 Third"]}],
    "recipes": [method("WP-01 First", (1, 1, 1)), method("WP-02 Second", (2, 3, 1)), method("WP-03 Third", (2, 3, 1))],
    "trades": [{"id": "STD-CONCRETE", "name": "Concrete gang", "capacity": 0}],
    "crewTemplates": [{"id": "STD-CONCRETE", "trades": [{"trade": "STD-CONCRETE", "size": 6}]}],
}


def generate(tmp):
    request = work_items.with_groups({"workItems": ITEMS, "rules": RULES})
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    xml = Path(tmp) / "wp.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=datetime(2026, 1, 5))
    return records, activities, json.loads((Path(tmp) / "wp.xml.why.json").read_text(encoding="utf-8"))["links"]


def test_each_package_gets_its_methods_activities_days_and_crew(tmp_path):
    records, activities, _ = generate(tmp_path)
    of = lambda guid: [(a["phase"], a["duration_days"]) for a in activities if a["rec"]["element"].GlobalId == guid]  # noqa: E731
    assert of("WP|A") == [("Rebar", 1.0), ("Formwork", 1.0), ("Concrete", 1.0)]
    assert of("WP|B") == [("Rebar", 2.0), ("Formwork", 3.0), ("Concrete", 1.0)]
    rec = next(r for r in records if r["element"].GlobalId == "WP|B")
    assert resources.crews_for("Rebar", rec, {}) == [("STD-CONCRETE", 6.0)]


def test_the_steps_link_the_packages_with_the_lag_and_the_together_run(tmp_path):
    _records, activities, links = generate(tmp_path)
    task = {(a["rec"]["element"].GlobalId if a.get("rec", {}).get("element") is not None else "", a["phase"]): a["task_id"] for a in activities}
    steps = [link for link in links if str(link[4]).startswith("sequence:")]
    assert steps, "the steps make no links"
    # The first package's last activity feeds the step's milestone; the milestone starts both the second and the third package, 16 h later.
    milestone = next(link[1] for link in steps if link[0] == task[("WP|A", "Concrete")])
    into = {link[1]: link for link in steps if link[0] == milestone}
    assert task[("WP|B", "Rebar")] in into and task[("WP|C", "Rebar")] in into
    assert into[task[("WP|B", "Rebar")]][2] == "FinishToStart" and float(into[task[("WP|B", "Rebar")]][3]) == 16.0
