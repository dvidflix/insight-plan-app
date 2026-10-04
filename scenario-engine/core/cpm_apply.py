# cpm_apply.py
#
# Applies calendar-aware CPM (Critical Path Method) date calculation to the P6
# XML this tool builds, using this project's own core.cpm_schedule
# forward/backward-pass engine — the same "Calculate Schedule" logic a
# scheduling tool runs on Calculate — so the exported XML already carries real
# calculated Start/Finish dates instead of every activity defaulting to the
# project's Data Date (see xml_builder.write_activities_and_relationships,
# which writes the same placeholder PlannedStartDate/PlannedFinishDate onto
# every Activity). Downstream consumers (e.g. InsightPlan) only read and
# animate these dates — they never recalculate the schedule themselves — so
# this project's own export is the only place dates get computed, and they
# must be correct here.

from datetime import datetime, time as dt_time

from core import cpm_schedule

# Fixed display clock windows for Rebar/Concrete activities, overriding
# whatever time-of-day the calendar arithmetic lands on. Rebar keeps
# whatever start/finish DATES CPM computed (it can genuinely span many
# workdays) but always reads 08:00->12:00 on those dates. Concrete is
# forced onto a single calendar day (start date == finish date, no
# exceptions) reading 13:00->17:00, since a pour is a same-day event
# regardless of what the hours-based duration math would otherwise produce.
# Matches the suffix convention in activity_generator.py's phase_sequence
# tables ("-R" for Rebar, "-C" for Concrete) across wall/slab/raft pours.
_REBAR_START_TIME = dt_time(8, 0, 0)
_REBAR_FINISH_TIME = dt_time(12, 0, 0)
_CONCRETE_START_TIME = dt_time(13, 0, 0)
_CONCRETE_FINISH_TIME = dt_time(17, 0, 0)


def _apply_fixed_phase_times(task_id, start_dt, finish_dt):
    if task_id.endswith("-R"):
        start_dt = datetime.combine(start_dt.date(), _REBAR_START_TIME)
        finish_dt = datetime.combine(finish_dt.date(), _REBAR_FINISH_TIME)
    elif task_id.endswith("-C"):
        start_dt = datetime.combine(start_dt.date(), _CONCRETE_START_TIME)
        finish_dt = datetime.combine(start_dt.date(), _CONCRETE_FINISH_TIME)
    return start_dt, finish_dt

# "CWA 6d Calendar" — matches xml_builder.add_detailed_calendar()'s
# StandardWorkWeek exactly (Mon-Fri 09:00-17:00, weekends off, a true 8-hour
# day). Every Activity this tool writes uses CalendarObjectId "1", so this is
# the only calendar CPM ever needs here.
#
# NOTE: this window must stay an exact 8-hour span, matching how
# xml_builder.py turns duration_days into PlannedDuration hours
# (duration_hours = duration_days * 8). A window of 09:00-16:59 (7h59m) used
# to be here, one minute short of a full day — over a whole-day-multiple
# duration (the norm for every phase in this project's DURATIONS config),
# that shortfall pushed the computed finish one minute into the NEXT
# calendar day, so what should be e.g. a same-day concrete pour instead
# spilled across two days.
_CWA_CALENDAR = {
    "hours_per_day": 8.0,
    "workdays": {
        0: ("09:00:00", "17:00:00"),
        1: ("09:00:00", "17:00:00"),
        2: ("09:00:00", "17:00:00"),
        3: ("09:00:00", "17:00:00"),
        4: ("09:00:00", "17:00:00"),
        5: None,
        6: None,
    },
}

# CalendarObjectId "2" — matches xml_builder.add_detailed_calendar()'s "CWA
# 7d Curing Calendar". Used only by Heavy Precast's "Curing" activity
# (PRECAST_CURING_DEFINITION): concrete cures on weekends too, so a 28-day
# duration must elapse 28 actual calendar days rather than 28 Mon-Fri
# workdays — every day of the week is open here, same 8-hour window.
_CWA_CURING_CALENDAR = {
    "hours_per_day": 8.0,
    "workdays": {
        0: ("09:00:00", "17:00:00"),
        1: ("09:00:00", "17:00:00"),
        2: ("09:00:00", "17:00:00"),
        3: ("09:00:00", "17:00:00"),
        4: ("09:00:00", "17:00:00"),
        5: ("09:00:00", "17:00:00"),
        6: ("09:00:00", "17:00:00"),
    },
}


def apply_cpm_to_xml(root, data_date):
    """Mutates root's <Activity> PlannedStartDate/PlannedFinishDate in place.

    root: the XML tree produced by create_p6_xml_root(), after
    write_activities_and_relationships() has already run (every Activity/
    Relationship element must already exist — this reads them back rather
    than hooking into activity generation itself).
    data_date: the project's Data Date (pass xml_builder.START_DATE) —
    anchors the forward pass, same as a fresh P6 schedule that's never been
    leveled.

    Returns cpm_schedule.calculate_cpm()'s stats dict, or None if nothing
    was calculated (no activities)."""
    project_elem = root.find("Project")
    if project_elem is None:
        return None

    activities = project_elem.findall("Activity")
    if not activities:
        return None

    objid_to_taskid = {}
    activity_elements = {}
    tasks = {}
    for act in activities:
        oid = act.findtext("ObjectId")
        task_id = act.findtext("Id")
        if not oid or not task_id:
            continue
        duration_hours = float(act.findtext("PlannedDuration") or 0)
        objid_to_taskid[oid] = task_id
        activity_elements[task_id] = act
        tasks[task_id] = {
            "duration_hours": duration_hours,
            "calendar_id": act.findtext("CalendarObjectId") or "1",
            "has_actual_start": False,
            "has_actual_finish": False,
            "start": None,
            "finish": None,
            "predecessors": [],
            "successors": [],
        }

    for rel in project_elem.findall("Relationship"):
        pred_oid = rel.findtext("PredecessorActivityObjectId")
        succ_oid = rel.findtext("SuccessorActivityObjectId")
        pred_id = objid_to_taskid.get(pred_oid)
        succ_id = objid_to_taskid.get(succ_oid)
        if not pred_id or not succ_id:
            continue
        rel_type = rel.findtext("Type") or "FinishToStart"
        lag = float(rel.findtext("Lag") or 0)
        tasks[pred_id]["successors"].append({"id": succ_id, "type": rel_type, "lag_hours": lag})
        tasks[succ_id]["predecessors"].append({"id": pred_id, "type": rel_type, "lag_hours": lag})

    result = {
        "tasks": tasks,
        "calendars": {"1": _CWA_CALENDAR, "2": _CWA_CURING_CALENDAR},
        "data_date": data_date.isoformat(),
    }

    stats = cpm_schedule.calculate_cpm(result)

    updated = 0
    for task_id, task in tasks.items():
        act = activity_elements.get(task_id)
        if act is None:
            continue
        start_str, finish_str = task.get("start"), task.get("finish")
        if not start_str or not finish_str:
            continue
        # calculate_cpm now returns full datetime ISO strings (real
        # calendar-snapped hour-of-day, not just a bare date) — write them
        # through as-is rather than re-anchoring onto a fixed start/finish
        # time, which is what previously discarded the actual computed
        # ordering between same-day predecessor/successor pairs.
        start_dt = datetime.fromisoformat(start_str)
        finish_dt = datetime.fromisoformat(finish_str)
        start_dt, finish_dt = _apply_fixed_phase_times(task_id, start_dt, finish_dt)
        start_elem = act.find("PlannedStartDate")
        finish_elem = act.find("PlannedFinishDate")
        if start_elem is not None:
            start_elem.text = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if finish_elem is not None:
            finish_elem.text = finish_dt.strftime("%Y-%m-%dT%H:%M:%S")
        updated += 1

    if stats is not None:
        stats["activities_updated"] = updated
    return stats
