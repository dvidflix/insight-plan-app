"""Calendars and trades defined by the scenario's rules (core/calendars.py, Rules.trades)."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from core import calendars, resources, rules  # noqa: E402
from core import xml_builder  # noqa: E402
from test_rules import rec  # noqa: E402


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


def written():
    root = ET.Element("APIBusinessObjects")
    xml_builder.add_detailed_calendar(root)
    return root.findall("Calendar")


def test_no_rules_give_one_plain_calendar_and_no_labour():
    cals = written()
    assert [(c.findtext("ObjectId"), c.findtext("Name"), c.findtext("HoursPerWeek"), c.findtext("HoursPerDay")) for c in cals] == [("1", "Standard calendar", "40.0", "8.0")]
    assert calendars.active().for_activity("Concrete", rec("W", "WALL")).oid == "1"
    assert calendars.active().for_activity("Curing", rec("S", "SLAB")).oid == "1"  # curing on 7 days is a calendar rule
    assert calendars.active().cpm_calendars()["1"]["workdays"][5] is None
    assert resources.labour_trades() == {}


def test_the_rules_calendars_replace_the_built_in_ones():
    rules.activate({"calendars": [
        {"id": "MF", "name": "Mon-Fri 10h", "workDays": [0, 1, 2, 3, 4], "start": "07:00", "hoursPerDay": 10, "default": True},
        {"id": "ALL", "name": "Every day", "workDays": [0, 1, 2, 3, 4, 5, 6], "start": "08:00", "hoursPerDay": 8},
    ]})
    cals = written()
    assert [(c.findtext("ObjectId"), c.findtext("Name"), c.findtext("HoursPerWeek"), c.findtext("HoursPerDay")) for c in cals] == [
        ("1", "Mon-Fri 10h", "50.0", "10.0"), ("2", "Every day", "56.0", "8.0")]
    monday = [h for h in cals[0].iter("StandardWorkHours") if h.findtext("DayOfWeek") == "Monday"][0]
    assert (monday.find("WorkTime/Start").text, monday.find("WorkTime/Finish").text) == ("07:00:00", "17:00:00")
    # no calendar rule: everything on the default (curing included: the built-in curing rule goes with the built-in calendars)
    assert calendars.active().for_activity("Curing", rec("S", "SLAB")).oid == "1"


def test_a_calendar_rule_picks_by_group_phase_and_family_the_most_specific_wins():
    rules.activate({
        "groups": [{"id": "BASE", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "slab", "conj": "and"}]}],
        "calendars": [{"id": "A", "name": "A", "default": True}, {"id": "B", "name": "B", "workDays": [0, 1, 2, 3, 4, 5, 6]}, {"id": "C", "name": "C", "workDays": [0, 1, 2]}],
        "calendarRules": [
            {"id": "r1", "when": {"group": "BASE"}, "calendar": "B"},
            {"id": "r2", "when": {"group": "BASE"}, "phase": "Curing", "calendar": "C"},
            {"id": "off", "when": {}, "phase": "Concrete", "calendar": "C", "enabled": False},
        ],
    })
    cals = calendars.active()
    slab, wall = rec("S", "SLAB"), rec("W", "WALL")
    assert cals.for_activity("Rebar", slab).id == "B"
    assert cals.for_activity("Curing", slab).id == "C"      # a rule with a phase is more specific
    assert cals.for_activity("Concrete", slab).id == "B"    # the rule switched off does not apply
    assert cals.for_activity("Rebar", wall).id == "A"       # fits no rule: the default


def test_duration_hours_follow_the_calendar_of_the_activity():
    rules.activate({"calendars": [{"id": "A", "name": "A", "hoursPerDay": 10, "start": "07:00"}]})
    cal = calendars.active().default
    assert cal.hours_per_day == 10 and cal.finish == "17:00:00" and cal.cpm()["hours_per_day"] == 10


def test_trades_are_the_rules_trades_and_a_row_switched_off_is_left_out():
    rules.activate({"trades": [
        {"id": "sf", "name": "Fixers", "capacity": 40},
        {"id": "XX", "name": "New trade", "capacity": 5},
        {"id": "CP", "enabled": False},
    ]})
    assert resources.labour_trades() == {"SF": {"name": "Fixers", "capacity": 40}, "XX": {"name": "New trade", "capacity": 5}}


def test_rules_that_only_hold_trades_or_calendars_are_not_empty():
    assert rules.Rules({"trades": [{"id": "A"}]}).empty is False
    assert rules.Rules({"calendars": [{"id": "A"}]}).empty is False


def test_the_preset_defines_the_two_calendars_and_the_trades():
    import json
    preset = json.loads((Path(__file__).parent / "fixtures" / "preset_1hdab_toc.json").read_text(encoding="utf8"))
    rules.activate(preset)
    cals = written()
    assert [(c.findtext("ObjectId"), c.findtext("Name"), c.findtext("HoursPerWeek")) for c in cals] == [("1", "CWA 6d Calendar", "40.0"), ("2", "CWA 7d Curing Calendar", "56.0")]
    assert calendars.active().for_activity("Curing", rec("S", "SLAB")).oid == "2"
    assert calendars.active().for_activity("Concrete", rec("S", "SLAB")).oid == "1"
    assert sorted(resources.labour_trades()) == ["CG", "CP", "EM", "GO", "PE", "SF"]
    assert resources.labour_trades()["SF"]["capacity"] == 24
