import json
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adjustments import apply_baselines, drop_retired, extra_activities, extra_predecessors, load_adjustments


def test_no_file_means_no_adjustments(tmp_path):
    adj = load_adjustments(str(tmp_path / "missing.json"))
    assert adj == {"retired": set(), "extras": []}


def test_the_pulled_file_is_read(tmp_path):
    f = tmp_path / "adjustments.json"
    f.write_text(json.dumps({
        "retired": [{"taskId": " szc-1-r "}, {"taskId": ""}],
        "extras": [{"taskId": "X1", "name": "Crane"}, {"taskId": ""}],
    }), encoding="utf-8")
    adj = load_adjustments(str(f))
    assert adj["retired"] == {"SZC-1-R"}
    assert [e["taskId"] for e in adj["extras"]] == ["X1"]


def test_retired_tasks_are_left_out_whatever_their_case():
    acts = [{"task_id": "A-R"}, {"task_id": "A-F"}, {"task_id": "a-c"}]
    kept, n = drop_retired(acts, {"A-R", "A-C"})
    assert [a["task_id"] for a in kept] == ["A-F"]
    assert n == 2
    assert drop_retired(acts, set()) == (acts, 0)


def test_extras_become_activities_and_a_zero_duration_is_a_milestone():
    extras = [
        {"taskId": "X1", "name": "Crane", "durationDays": 3, "baselineStart": "2026-11-02", "baselineFinish": "2026-11-04"},
        {"taskId": "X2", "durationDays": 0},
        {"taskId": "TAKEN"},
    ]
    acts = extra_activities(extras, ["taken"], wbs_oid=77)
    assert [a["task_id"] for a in acts] == ["X1", "X2"]
    assert acts[0]["wbs_oid"] == 77 and acts[0]["duration_days"] == 3 and acts[0]["rec"] == {}
    assert acts[0]["baseline_start"] == "2026-11-02"
    assert acts[1]["milestone"] is True and acts[1]["task_name"] == "X2"


def test_predecessors_and_successors_become_edges_between_known_tasks():
    extras = [{"taskId": "X1", "predecessors": ["A", "NOPE"], "successors": ["B"]}]
    edges = extra_predecessors(extras, ["A", "B", "X1"])
    assert edges == {"X1": ["A"], "B": ["X1"]}


def test_a_baseline_becomes_the_target_dates_and_the_cpm_dates_stay_as_current():
    project = ET.Element("Project")
    act = ET.SubElement(project, "Activity")
    ET.SubElement(act, "Id").text = "X1"
    ET.SubElement(act, "PlannedStartDate").text = "2026-10-05T07:00:00"
    ET.SubElement(act, "PlannedFinishDate").text = "2026-10-06T15:00:00"
    ET.SubElement(act, "Status").text = "Not Started"
    other = ET.SubElement(project, "Activity")
    ET.SubElement(other, "Id").text = "OTHER"
    ET.SubElement(other, "PlannedStartDate").text = "2026-10-05T07:00:00"
    ET.SubElement(other, "PlannedFinishDate").text = "2026-10-05T15:00:00"

    n = apply_baselines(project, [{"task_id": "X1", "baseline_start": "2026-11-02", "baseline_finish": "2026-11-04"}])

    assert n == 1
    assert act.findtext("PlannedStartDate") == "2026-11-02T07:00:00"
    assert act.findtext("PlannedFinishDate") == "2026-11-04T15:00:00"
    assert act.findtext("StartDate") == "2026-10-05T07:00:00"
    assert act.findtext("FinishDate") == "2026-10-06T15:00:00"
    # The planned dates come before the current ones, and nothing else moved.
    tags = [c.tag for c in act]
    assert tags.index("StartDate") == tags.index("PlannedFinishDate") + 1 and tags.index("FinishDate") == tags.index("StartDate") + 1
    assert other.find("StartDate") is None
