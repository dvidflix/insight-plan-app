"""Extra activities through the real XML writer and the CPM: they get their own WBS, their relationships, and (with a
baseline) their baseline dates as target dates while the CPM dates stay as the current ones."""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adjustments import EXTRA_WBS_NAME, apply_baselines, extra_activities, extra_predecessors
from core.cpm_apply import apply_cpm_to_xml
from core.wbs_manager import WBSManager
from core.xml_builder import add_project_and_calendar, add_resources, create_p6_xml_root, write_activities_and_relationships


def test_extras_are_written_scheduled_and_given_their_baseline():
    wbs = WBSManager("XML", start_counter=1)
    wbs.register("T - Construction")
    wbs.register(f"T - {EXTRA_WBS_NAME}", "T - Construction")
    extras = [
        {"taskId": "X1", "name": "Crane erection", "durationDays": 3, "baselineStart": "2030-01-14", "baselineFinish": "2030-01-16", "predecessors": [], "successors": ["X2"]},
        {"taskId": "X2", "name": "Crane handover", "durationDays": 0, "predecessors": [], "successors": []},
    ]
    acts = extra_activities(extras, [], wbs.get_id(f"T - {EXTRA_WBS_NAME}"))
    edges = extra_predecessors(extras, ["X1", "X2"])
    assert edges == {"X2": ["X1"]}

    root = create_p6_xml_root()
    add_project_and_calendar(root, building_code="T", project_wbs_object_id="2", project_id="2")
    resources = add_resources(root)
    write_activities_and_relationships(root, acts, resources, wbs, automatic_predecessor_sources=[("extra_activities", edges)])
    apply_cpm_to_xml(root, datetime(2030, 1, 7))
    project = root.find("Project")
    assert apply_baselines(project, acts) == 1

    by_id = {a.findtext("Id"): a for a in project.findall("Activity")}
    x1, x2 = by_id["X1"], by_id["X2"]
    assert x1.findtext("Name") == "Crane erection"
    assert x1.findtext("WBSObjectId") == str(wbs.get_id(f"T - {EXTRA_WBS_NAME}"))
    assert x1.findtext("PlannedStartDate").startswith("2030-01-14")
    assert x1.findtext("PlannedFinishDate").startswith("2030-01-16")
    assert x1.findtext("StartDate").startswith("2030-01-07")  # the CPM start from the data date, kept as the current date
    assert x2.findtext("Type") == "Finish Milestone"
    # X1 -> X2 as a relationship
    rels = [(r.findtext("PredecessorActivityObjectId"), r.findtext("SuccessorActivityObjectId")) for r in project.findall("Relationship")]
    assert (x1.findtext("ObjectId"), x2.findtext("ObjectId")) in rels
