"""Names in a programme made from Generate's work packages: short, like the pours' (src/prs/workPackages.ts sends each item a label, its package's
name, and the model's building code). The group (the key recipes and rules match) is not in any name.

    WBS        N3-1HDAB - Level 1 - Main Slab
    ID         SZC-1HDAB-L1-S-0001-I
    Name       1HDAB - L1 - Main Slab 0001 - Install"""
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
    {"id": "WP|A", "group": "WP-01.02 L01 Main Slab", "label": "Main Slab", "building": "1HDAB", "level": "Level 1", "name": "WP-01.02 L01 Main Slab", "quantity": 30},
    {"id": "WP|B", "group": "WP-02 Raft", "label": "Raft", "building": "1HDAB", "level": "Level 1", "name": "WP-02 Raft", "quantity": 10},
]
RULES = {"recipes": [
    {"id": "m1", "group": "WP-01.02 L01 Main Slab", "priority": 1000, "tasks": [{"phase": "Install", "name": "Install", "formula": "2", "priority": 999}]},
    {"id": "m2", "group": "WP-02 Raft", "priority": 1000, "tasks": [{"phase": "Install", "name": "Install", "formula": "1", "priority": 999}]},
]}


def test_package_activities_and_wbs_have_short_names(tmp_path):
    request = work_items.with_groups({"workItems": ITEMS, "rules": RULES})
    overrides = engine.overrides_from_scenario(request)
    records = engine.build_work_item_records(request["workItems"])
    engine.resolve_pour_ids(records, [], overrides, False)
    activities = engine.create_all_activities(records, overrides)
    by = {a["rec"]["element"].GlobalId: a for a in activities if a.get("rec", {}).get("element") is not None}
    slab = by["WP|A"]
    assert re.fullmatch(r"[A-Z]+-1HDAB-L1-S-0001-I", slab["task_id"]), slab["task_id"]
    assert slab["task_name"] == "1HDAB - L1 - Main Slab 0001 - Install"
    assert re.fullmatch(r"[A-Z]+-1HDAB-L1-R-0002-I", by["WP|B"]["task_id"])
    xml = Path(tmp_path) / "names.xml"
    engine.build_schedule_xml(records, activities, [], overrides, xml, start_date=datetime(2026, 1, 5))
    wbs = re.findall(r"<WBS>.*?<Name>([^<]*)</Name>", xml.read_text(encoding="utf-8"), re.S)
    assert any(re.fullmatch(r".*1HDAB - Level 1 - Main Slab", w) for w in wbs), wbs
    assert not any("WP-" in w or "Wp-" in w for w in wbs), wbs
