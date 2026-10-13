"""Concrete curing of slabs: a "Curing" activity after the slab's Concrete, a phase of the slab chain (Rules > Chains, here the 1HDAB_TOC preset),
chained after it (xml_builder._build_intra_pour_predecessors), optionally gating what follows (SLAB_CURING_GATES_SUCCESSORS)."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json  # noqa: E402

from core import activity_generator as gen  # noqa: E402
from core import rules, xml_builder  # noqa: E402


class FakeWbs:
    def register(self, name, parent_name=None):
        return 1

    def get_id(self, name):
        return 1


PRESET = json.loads((Path(__file__).parent / "fixtures" / "preset_1hdab_toc.json").read_text(encoding="utf8"))


@pytest.fixture(autouse=True)
def preset():
    rules.activate(PRESET)
    yield
    rules.activate(None)


def rec(pour_type="SLAB", **over):
    base = {
        "element": SimpleNamespace(GlobalId="G1"), "conc_stage": "1", "pour_type": pour_type, "task_id_base": "P1",
        "building": "B1", "level_code": "l4", "level_display": "Level 4", "wbs_prefix": "B1", "lg1": "Main Slab", "pour_id": "0313",
        "task_pour_id": "0313", "concrete_wbs_oid": 1, "volume": 10.0, "is_external": False, "is_double_height": False,
    }
    return {**base, **over}


def phases(activities):
    return [a["phase"] for a in activities]


def test_a_slab_gets_a_curing_activity_after_its_concrete():
    acts = gen.create_activities(rec("SLAB"), FakeWbs())
    assert phases(acts)[-2:] == ["Concrete", "Curing"]
    curing = acts[-1]
    assert curing["duration_days"] == 20  # slabs cure longer than the 7 days of other pours
    assert curing["task_id"] == "P1-CU"
    assert curing["task_name"].endswith(" - Curing")
    assert curing["resource"] is None and curing["volume"] is None
    assert curing["predecessor"] == acts[-2]["task_id"]


def test_a_raft_is_cured_too():
    assert phases(gen.create_activities(rec("RAFT"), FakeWbs()))[-1] == "Curing"


@pytest.mark.parametrize("pour_type", ["WALL", "LANDING", "COLUMN"])
def test_other_in_situ_pours_are_cured_for_seven_days(pour_type):
    acts = gen.create_activities(rec(pour_type), FakeWbs())
    assert phases(acts)[-1] == "Curing" and acts[-1]["duration_days"] == 7


def test_a_raft_is_cured_for_as_long_as_a_slab():
    assert gen.create_activities(rec("RAFT"), FakeWbs())[-1]["duration_days"] == 20


def test_precast_is_not_cured_on_site():
    assert "Curing" not in phases(gen.create_activities(rec("WALL", conc_stage="PRECAST"), FakeWbs()))


def test_it_is_a_row_of_the_chain_so_a_chain_without_it_has_none():
    chains = [c for c in PRESET["chains"] if not (c["group"] == "C-SLAB" and c["phase"] == "Curing")]
    rules.activate({**PRESET, "chains": chains})
    assert "Curing" not in phases(gen.create_activities(rec("SLAB"), FakeWbs()))


def test_the_days_come_from_the_assignment():
    assignments = [{**a, "days": 14} if (a["group"], a["phase"]) == ("C-SLAB", "Curing") else a for a in PRESET["assignments"]]
    rules.activate({**PRESET, "assignments": assignments})
    assert gen.create_activities(rec("SLAB"), FakeWbs())[-1]["duration_days"] == 14


def test_curing_follows_concrete_in_the_intra_pour_chain():
    acts = gen.create_activities(rec("SLAB"), FakeWbs())
    edges = xml_builder._build_intra_pour_predecessors(acts)
    assert edges["P1-CU"] == ["P1-C"]


@pytest.mark.parametrize("gates, expected", [(False, "P1-C"), (True, "P1-CU")])
def test_successors_wait_for_concrete_or_for_curing(monkeypatch, gates, expected):
    monkeypatch.setattr(xml_builder, "SLAB_CURING_GATES_SUCCESSORS", gates)
    task_map = {"Rebar": "P1-R", "Concrete": "P1-C", "Curing": "P1-CU"}
    assert xml_builder._concrete_done_task(task_map) == expected


def test_heavy_precast_curing_is_not_a_slab_curing(monkeypatch):
    monkeypatch.setattr(xml_builder, "SLAB_CURING_GATES_SUCCESSORS", True)
    # A Heavy Precast pour has a Curing but no Concrete: nothing changes for it.
    assert xml_builder._concrete_done_task({"Stitching": "H-S", "Curing": "H-CU"}) is None


def test_a_landing_is_decking_rebar_concrete_chained_in_order():
    acts = gen.create_activities(rec("LANDING", lg1="Landing"), FakeWbs())
    assert phases(acts) == ["Decking", "Rebar", "Concrete", "Curing"]
    assert [a["task_name"].rsplit(" - ", 1)[1] for a in acts] == ["Decking", "Rebar and EP/AP", "Concrete", "Curing"]
    edges = xml_builder._build_intra_pour_predecessors(acts)
    assert edges["P1-R"] == ["P1-DK"] and edges["P1-C"] == ["P1-R"]


def test_a_slab_starts_with_decking_and_without_rules_has_the_default_chain():
    assert phases(gen.create_activities(rec("SLAB"), FakeWbs()))[0] == "Decking"
    rules.activate(None)
    assert phases(gen.create_activities(rec("SLAB"), FakeWbs())) == ["Rebar", "Formwork", "Concrete"]


def test_a_curing_is_looked_through_when_finding_the_open_ended_pours(monkeypatch):
    """A wall's Concrete is open-ended when only its own Curing follows it (the Curing is then not what the slab above waits for), but not when
    something else follows it; and the Curing is the open end when it holds back what follows."""
    acts = gen.create_activities(rec("WALL", lg1="Wall"), FakeWbs())
    by = {a["phase"]: a["task_id"] for a in acts}
    monkeypatch.setattr(xml_builder, "SLAB_CURING_GATES_SUCCESSORS", False)
    only_curing = {by["Rebar"]: {by["Formwork"]}, by["Formwork"]: {by["Concrete"]}, by["Concrete"]: {by["Curing"]}}
    assert xml_builder._open_ended_tasks(acts, only_curing) == {by["Concrete"]}
    with_other = {**only_curing, by["Concrete"]: {by["Curing"], "SOMETHING-ELSE"}}
    assert xml_builder._open_ended_tasks(acts, with_other) == set()  # the pour is not open: the Curing just runs alongside
    monkeypatch.setattr(xml_builder, "SLAB_CURING_GATES_SUCCESSORS", True)
    assert xml_builder._open_ended_tasks(acts, only_curing) == {by["Curing"]}
