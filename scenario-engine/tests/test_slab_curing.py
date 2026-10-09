"""Concrete curing of slabs: a "Curing" activity after the slab's Concrete (core/activity_generator.py), chained after it
(xml_builder._build_intra_pour_predecessors), optionally gating what follows (SLAB_CURING_GATES_SUCCESSORS)."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import activity_generator as gen  # noqa: E402
from core import xml_builder  # noqa: E402


class FakeWbs:
    def register(self, name, parent_name=None):
        return 1

    def get_id(self, name):
        return 1


def rec(pour_type="SLAB", **over):
    base = {
        "element": SimpleNamespace(GlobalId="G1"), "conc_stage": "1", "pour_type": pour_type, "task_id_base": "P1",
        "building": "B1", "level_code": "l4", "level_display": "Level 4", "wbs_prefix": "B1", "lg1": "Main Slab", "pour_id": "0313",
        "task_pour_id": "0313", "concrete_wbs_oid": 1, "volume": 10.0, "is_external": False, "is_double_height": False,
    }
    return {**base, **over}


def phases(activities):
    return [a["phase"] for a in activities]


def test_a_slab_gets_a_curing_activity_after_its_concrete(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 7)
    acts = gen.create_activities(rec("SLAB"), FakeWbs())
    assert phases(acts)[-2:] == ["Concrete", "Curing"]
    curing = acts[-1]
    assert curing["duration_days"] == 7
    assert curing["task_id"] == "P1-CU"
    assert curing["task_name"].endswith(" - Curing")
    assert curing["resource"] is None and curing["volume"] is None
    assert curing["predecessor"] == acts[-2]["task_id"]


def test_a_raft_is_cured_too(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 7)
    assert phases(gen.create_activities(rec("RAFT"), FakeWbs()))[-1] == "Curing"


@pytest.mark.parametrize("pour_type", ["WALL", "LANDING", "COLUMN"])
def test_other_pours_are_not(monkeypatch, pour_type):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 7)
    assert "Curing" not in phases(gen.create_activities(rec(pour_type), FakeWbs()))


def test_it_can_be_switched_off_or_given_no_days(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", False)
    assert "Curing" not in phases(gen.create_activities(rec("SLAB"), FakeWbs()))
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 0)
    assert "Curing" not in phases(gen.create_activities(rec("SLAB"), FakeWbs()))


def test_the_days_come_from_the_setting(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 14)
    assert gen.create_activities(rec("SLAB"), FakeWbs())[-1]["duration_days"] == 14


def test_curing_follows_concrete_in_the_intra_pour_chain(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 7)
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


def test_a_landing_is_decking_rebar_concrete_chained_in_order(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", True)
    monkeypatch.setattr(gen, "SLAB_CURING_DAYS", 7)
    acts = gen.create_activities(rec("LANDING", lg1="Landing"), FakeWbs())
    assert phases(acts) == ["Decking", "Rebar", "Concrete"]
    assert [a["task_name"].rsplit(" - ", 1)[1] for a in acts] == ["Decking", "Rebar and EP/AP", "Concrete"]
    edges = xml_builder._build_intra_pour_predecessors(acts)
    assert edges["P1-R"] == ["P1-DK"] and edges["P1-C"] == ["P1-R"]


def test_a_slab_keeps_its_phases_when_curing_is_off(monkeypatch):
    monkeypatch.setattr(gen, "ENABLE_SLAB_CURING", False)
    assert phases(gen.create_activities(rec("SLAB"), FakeWbs()))[0] == "Decking"
