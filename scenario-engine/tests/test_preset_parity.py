"""The 1HDAB_TOC preset (src/prs/presets.ts) must give what the generator made of every pour before the engine's own duration table and rebar
rates were taken out (fixtures/preset_golden.json, written from the engine of that day): durations, crews, rebar and which pours are in.
What the preset adds (level tasks, extra activities) is checked elsewhere. The preset is read from
fixtures/preset_1hdab_toc.json, which tests/unit/presetFixture.test.ts keeps equal to the preset."""
import itertools
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from core import activity_generator as gen, resources, rules  # noqa: E402
from test_rules import FakeWbs, rec  # noqa: E402

PRESET = json.loads((Path(__file__).parent / "fixtures" / "preset_1hdab_toc.json").read_text(encoding="utf8"))

TYPES = ["WALL", "EXTERNAL WALL", "SLAB", "MAIN_SLAB", "RAFT", "PIT", "PITS & RAFT", "FLOOR", "COLUMN", "BEAM", "LANDING", "STAIR", "PEDESTAL",
         "HEAVY_PRECAST", "REMOVABLE_ELEMENT", "PARAPET", "GULLIES", "UPSTAND", "CORBEL", "PLINTH", "AIRDUCT", "BOSS", "SCREED", "GROUT", "SPECIAL", "OTHER"]


@pytest.fixture(autouse=True)
def reset():
    rules.activate(None)
    yield
    rules.activate(None)


def pours():
    out = []
    for n, (t, ext, dh, stage, level, vol) in enumerate(itertools.product(TYPES, [False, True], [False, True], ["1", "2", "PRECAST"], [0, 1, 4], [0.1, 10.0])):
        out.append(rec(f"G{n}", t, level=level, volume=vol, is_external=ext, is_double_height=dh, conc_stage=stage, general_pour_type=t.replace(" ", "_")))
    return out


def snapshot(data):
    rules.activate(data)
    out = []
    for r in pours():
        r["rebar_weight_tonnes"] = resources.rebar_tonnes(r)
        included = rules.active().is_included(r, rules.excluded_pour_types(config.EXCLUDED_POUR_TYPES))
        acts = gen.create_activities(r, FakeWbs()) if included else []
        out.append((r["pour_type"], r["conc_stage"], included, round(r["rebar_weight_tonnes"], 6),
                    [(a["task_id"], a["phase"], a["duration_days"], tuple(resources.crews_for(a["phase"], r, {}))) for a in acts]))
    return out


def test_the_preset_generates_what_the_generator_did_with_its_own_tables():
    golden = json.loads((Path(__file__).parent / "fixtures" / "preset_golden.json").read_text(encoding="utf8"))
    after = snapshot(PRESET)
    as_json = [[a, b, c, d, [[x[0], x[1], x[2], [list(y) for y in x[3]]] for x in e]] for a, b, c, d, e in after]
    # A pour with no activities is the same whether it is "in" with none or left out (the preset leaves stage 2 rafts out by a group).
    same = lambda row: [row[0], row[1], bool(row[4]), row[3], row[4]]  # noqa: E731
    differing = [(g, n) for g, n in zip(golden, as_json) if same(g) != same(n)]
    assert len(golden) == len(as_json)
    assert not differing, f"{len(differing)} of {len(golden)} pours differ, first: {differing[0]}"


def test_without_rules_every_phase_takes_the_neutral_days_and_there_is_no_rebar():
    for pour_type in ("WALL", "SLAB", "RAFT", "HEAVY_PRECAST"):
        r = rec("N", pour_type, conc_stage="PRECAST" if pour_type == "HEAVY_PRECAST" else "1")
        rules.activate(None)
        acts = gen.create_activities(r, FakeWbs())
        assert acts and all(a["duration_days"] >= 1 for a in acts if a["phase"] != "Curing" or pour_type == "HEAVY_PRECAST")
        assert resources.rebar_tonnes(r) == 0.0


def test_the_preset_makes_the_steps_overlap():
    """Without it the scenario's order is a relay (each step waits for the one before to finish): 17 years on the 1HDAB order against 4.7."""
    assert PRESET["settings"]["sequenceFlow"] is True and PRESET["settings"]["sequenceLeadDays"] == 1


def test_the_preset_does_not_switch_on_a_sequence():
    """A sequence forces whole groups to finish before the next starts, which reshapes the programme."""
    assert not [s for s in PRESET["sequences"] if s.get("enabled") is not False]


def test_converting_the_old_form_to_the_tables_changes_nothing():
    """fixtures/legacy_and_converted.json (written by tests/unit/convertLegacy.test.ts): the old preset's rows with their own conditions, and the
    same rules after src/prs/convert.ts made groups, rates, crews and assignments of them. Every pour gets the same activities, days, crews and rebar."""
    both = json.loads((Path(__file__).parent / "fixtures" / "legacy_and_converted.json").read_text(encoding="utf8"))
    before, after = snapshot(both["legacy"]), snapshot(both["converted"])
    differing = [(b, a) for b, a in zip(before, after) if b != a]
    assert len(before) == len(after) > 1000
    assert not differing, f"{len(differing)} of {len(before)} pours differ, first: {differing[0]}"
    assert any(row[4] for row in before)


def test_the_legacy_fixture_is_not_empty_of_old_rows():
    both = json.loads((Path(__file__).parent / "fixtures" / "legacy_and_converted.json").read_text(encoding="utf8"))
    assert both["legacy"]["durations"] and both["legacy"]["crews"] and not both["converted"]["durations"] and both["converted"]["assignments"]


def sequence_edges(acts, order):
    """The links the scenario's sequence (step numbers by pour) makes: [(predecessor, successor, type)]."""
    from core import xml_builder
    return xml_builder._build_sequence_order_relationships(acts, [{"Index": i, "GUID": g, "Phase": ""} for g, i in order])


def test_a_step_waits_for_every_pour_of_the_step_before_to_be_finished_and_the_raft_for_its_curing(monkeypatch):
    """The scenario's step numbers, as a relay (Steps overlap off): a step starts when every pour of the one before is done (the raft: concreted,
    then cured, as its chain says), and the pours of a step start together."""
    from core import xml_builder
    rules.activate(PRESET)
    monkeypatch.setattr(xml_builder, "SEQUENCE_FLOW", False)
    pours = [rec("H1", "HEAVY_PRECAST", level=0, conc_stage="PRECAST"), rec("R0", "RAFT", level=0), rec("W1", "WALL", level=1), rec("W2", "WALL", level=1)]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    by = lambda guid: {a["phase"]: a["task_id"] for a in acts if a["rec"]["element"].GlobalId == guid}  # noqa: E731
    edges = sequence_edges(acts, [("H1", 1), ("R0", 2), ("W1", 3), ("W2", 3)])
    assert (by("H1")["Stitching"], by("R0")["Rebar"], "FinishToStart") in edges          # the raft's first activity waits for the heavy precast, finished
    assert (by("R0")["Curing"], by("W1")["Rebar"], "FinishToStart") in edges             # the walls wait for the raft's Curing, not its Concrete
    assert (by("R0")["Concrete"], by("W1")["Rebar"], "FinishToStart") not in edges
    assert (by("W1")["Rebar"], by("W2")["Rebar"], "StartToStart") in edges               # the walls of one step start together


def test_a_step_waits_for_all_of_the_step_before_not_only_its_first_pour():
    rules.activate({})
    pours = [rec("A", "WALL", level=1), rec("B", "WALL", level=1), rec("C", "WALL", level=2)]
    acts = [a for p in pours for a in gen.create_activities(p, FakeWbs())]
    by = lambda guid: {a["phase"]: a["task_id"] for a in acts if a["rec"]["element"].GlobalId == guid}  # noqa: E731
    edges = sequence_edges(acts, [("A", 1), ("B", 1), ("C", 2)])
    assert (by("A")["Concrete"], by("C")["Rebar"], "FinishToStart") in edges and (by("B")["Concrete"], by("C")["Rebar"], "FinishToStart") in edges


# ---------------------------------------------------------------- the sequence reaches every pour, and the overlap mode

def _acts(pours):
    return [a for p in pours for a in gen.create_activities(p, FakeWbs())]


def test_a_precast_pour_without_a_concrete_is_still_in_the_sequence():
    """A precast pour has Installation and Stitching, no rebar, formwork or concrete: a sequence row pointing at one of those is not dropped."""
    rules.activate({})
    pours = [rec("W1", "WALL", level=1), rec("P1", "HEAVY_PRECAST", level=1, conc_stage="PRECAST"), rec("W2", "WALL", level=2)]
    acts = _acts(pours)
    by = lambda guid: {a["phase"]: a["task_id"] for a in acts if a["rec"]["element"].GlobalId == guid}  # noqa: E731
    assert "Concrete" not in by("P1") and "Installation" in by("P1")
    edges = sequence_edges(acts, [("W1", 1), ("P1", 2), ("W2", 3)])
    assert (by("W1")["Concrete"], by("P1")["Installation"], "FinishToStart") in edges  # the precast pour waits for step 1
    assert (by("P1")["Stitching"], by("W2")["Rebar"], "FinishToStart") in edges  # and step 3 waits for its last activity


def test_overlapping_steps_start_a_few_days_apart_and_pour_in_order(monkeypatch):
    from core import xml_builder
    rules.activate({})
    pours = [rec("A", "WALL", level=1), rec("B", "WALL", level=1), rec("C", "WALL", level=1)]
    acts = _acts(pours)
    by = lambda guid: {a["phase"]: a["task_id"] for a in acts if a["rec"]["element"].GlobalId == guid}  # noqa: E731
    order = [("A", 1), ("B", 2), ("C", 3)]
    relay = sequence_edges(acts, order)
    assert (by("A")["Concrete"], by("B")["Rebar"], "FinishToStart") in relay  # a relay by default: B starts when A is done
    monkeypatch.setattr(xml_builder, "SEQUENCE_FLOW", True)
    monkeypatch.setattr(xml_builder, "SEQUENCE_LEAD_DAYS", 2)
    flow = sequence_edges(acts, order)
    assert (by("A")["Rebar"], by("B")["Rebar"], "StartToStart", 16.0) in flow  # B starts 2 working days (16 h) after A starts
    assert (by("B")["Rebar"], by("C")["Rebar"], "StartToStart", 16.0) in flow
    assert (by("A")["Concrete"], by("B")["Concrete"], "FinishToStart") in flow  # the concrete is poured in step order
    assert not any(e[2] == "FinishToStart" and e[1] == by("B")["Rebar"] for e in flow)  # and B's rebar is not held back by A's whole chain
    monkeypatch.setattr(xml_builder, "SEQUENCE_CONCRETE_FOLLOWS", False)
    loose = sequence_edges(acts, order)
    assert (by("A")["Rebar"], by("B")["Rebar"], "StartToStart", 16.0) in loose  # the steps still start in order
    assert not any(e[2] == "FinishToStart" and e[1] in (by("B")["Concrete"], by("C")["Concrete"]) for e in loose)  # but a pour is cast when it is ready


def test_the_overlap_settings_come_from_the_rules():
    from core import xml_builder
    rules.activate({"settings": {"sequenceFlow": True, "sequenceLeadDays": 1.5}})
    assert xml_builder.SEQUENCE_FLOW is True and xml_builder.SEQUENCE_LEAD_DAYS == 1.5
    rules.activate({})
    assert xml_builder.SEQUENCE_FLOW is False and xml_builder.SEQUENCE_LEAD_DAYS == 3.0
    rules.activate({"settings": {"sequenceConcreteFollows": False}})
    assert xml_builder.SEQUENCE_CONCRETE_FOLLOWS is False
    rules.activate({})
    assert xml_builder.SEQUENCE_CONCRETE_FOLLOWS is True
