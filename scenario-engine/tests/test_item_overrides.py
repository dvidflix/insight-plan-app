"""Generate 2's work item overrides (src/prs/activityPlan.ts withItemOverrides) reach the generator as recipes for the set: a chosen recipe as a copy
for the set with priority 1000, and a crew and days as a values-only recipe whose tasks have priority 1000 (days as a formula). These check that the
generator, unchanged, lets them win over the set's own recipe."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import activity_generator as gen, resources, rules  # noqa: E402
from test_rules import FakeWbs, days, rec  # noqa: E402


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


GROUPS = [{"id": "SET A", "filters": [{"id": "c1", "field": "family", "op": "equals", "value": "wall", "conj": "and"}]}]
BASE = {
    "groups": GROUPS,
    "trades": [{"id": "T1", "name": "One", "capacity": 0}, {"id": "T2", "name": "Two", "capacity": 0}],
    "crewTemplates": [{"id": "C1", "trades": [{"trade": "T1", "size": 4}]}, {"id": "C2", "trades": [{"trade": "T2", "size": 6}]}],
}
OWN = {"id": "OWN", "group": "SET A", "tasks": [{"phase": "P1", "crew": "C1", "formula": "volume / 10"}, {"phase": "P2", "days": 2}]}
OTHER = {"id": "OTHER", "group": "", "tasks": [{"phase": "Q1", "days": 5}]}


def phases(acts):
    return [a["phase"] for a in acts]


def test_without_overrides_the_sets_own_recipe_applies():
    rules.activate({**BASE, "recipes": [OWN]})
    r = rec("W1", "WALL", volume=40.0)
    acts = gen.create_activities(r, FakeWbs())
    assert phases(acts) == ["P1", "P2"]
    assert days(acts)["P1"] == 4
    assert resources.crews_for("P1", r, {}) == [("T1", 4.0)]


def test_a_crew_and_days_override_beat_the_recipe():
    override = {"id": "Overrides for SET A", "group": "SET A", "chain": False, "tasks": [{"phase": "P1", "crew": "C2", "formula": "3", "priority": 1000}]}
    rules.activate({**BASE, "recipes": [OWN, override]})
    r = rec("W1", "WALL", volume=40.0)
    acts = gen.create_activities(r, FakeWbs())
    assert phases(acts) == ["P1", "P2"]
    assert days(acts)["P1"] == 3
    assert days(acts)["P2"] == 2
    assert resources.crews_for("P1", r, {}) == [("T2", 6.0)]


def test_a_chosen_recipe_replaces_the_activities():
    copy = {**OTHER, "id": "OTHER for SET A", "group": "SET A", "priority": 1000, "tasks": [{"phase": "Q1", "days": 5, "priority": 999}]}
    # As withItemOverrides sends it: the copy first, and the set's own chain recipe left out (one group's recipes make one chain).
    rules.activate({**BASE, "recipes": [copy, OTHER]})
    acts = gen.create_activities(rec("W1", "WALL", volume=40.0), FakeWbs())
    assert phases(acts) == ["Q1"]
    assert days(acts)["Q1"] == 5


def test_two_recipes_of_one_group_join_into_one_chain():
    """Why the set's own recipe must be left out when another is chosen."""
    copy = {**OTHER, "id": "OTHER for SET A", "group": "SET A", "priority": 1000}
    rules.activate({**BASE, "recipes": [copy, OWN]})
    assert phases(gen.create_activities(rec("W1", "WALL", volume=40.0), FakeWbs())) == ["Q1", "P1", "P2"]
