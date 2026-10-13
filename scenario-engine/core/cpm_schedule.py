# cpm_schedule.py
# Calendar-aware CPM (Critical Path Method) scheduling — a "Calculate
# Schedule" pass equivalent to pressing F9 in Primavera or "Calculate" in
# Synchro, run on this tool's own P6 XML before it ever leaves this project.
# The exported XML must already carry final, correct Start/Finish dates —
# downstream consumers (e.g. InsightPlan) only read and animate the schedule,
# they never recalculate it.
#
# Vendored copy: this used to be dynamically loaded from insightplan_dev's
# tab_4d/cpm_schedule.py. It's now owned by this project so the fix below
# doesn't depend on (or need to touch) that separate repo.
#
# Scope/limitations (deliberately simplified vs a full P6/Synchro engine):
#  - No resource leveling (activities competing for the same finite resource
#    pool are not staggered apart from each other).
#  - No activity constraints (must-start-on, finish-no-later-than, etc.).
#  - Each calendar supports one working-time window per weekday (no
#    multi-shift days, no named holiday/exception dates beyond what's baked
#    into the weekly pattern).
# Within those bounds, the forward/backward pass and relationship-type
# handling (FS/SS/FF/SF with lag) follow the same CPM logic P6 itself uses.
#
# Actual dates (has_actual_start/has_actual_finish, from
# ActualStartDate/ActualFinishDate resp. act_start_date/act_end_date) are
# treated as fixed and never recomputed — an activity that already started or
# finished in P6 keeps that real date every Sync, rather than this simplified
# engine silently overwriting real progress with its own recalculation.

from datetime import datetime, timedelta, time as dt_time

DEFAULT_CALENDAR = {
	"hours_per_day": 8.0,
	"workdays": {
		0: ("08:00:00", "16:00:00"),
		1: ("08:00:00", "16:00:00"),
		2: ("08:00:00", "16:00:00"),
		3: ("08:00:00", "16:00:00"),
		4: ("08:00:00", "16:00:00"),
		5: None,
		6: None,
	},
}


def _parse_time(text):
	h, m, s = (text or "00:00:00").split(":")
	return dt_time(int(h), int(m), int(float(s)))


class WorkCalendar:
	"""Weekday-based working-time calendar, parsed from a P6 <Calendar>
	(see op_schedule_import.parse_p6_xml_file). Provides calendar-aware
	forward ("add_hours") and backward ("subtract_hours") date math."""

	def __init__(self, calendar_dict):
		calendar_dict = calendar_dict or DEFAULT_CALENDAR
		self.hours_per_day = calendar_dict.get("hours_per_day") or 8.0
		self._windows = {}
		for weekday, window in (calendar_dict.get("workdays") or {}).items():
			if window is None:
				self._windows[int(weekday)] = None
				continue
			start_t, finish_t = window
			self._windows[int(weekday)] = (_parse_time(start_t), _parse_time(finish_t))
		for weekday in range(7):
			self._windows.setdefault(weekday, None)
		if not any(self._windows.values()):
			# Degenerate calendar (no working days at all) — fall back to a
			# standard 5-day week rather than looping forever.
			self._windows = {wd: win for wd, win in WorkCalendar(DEFAULT_CALENDAR)._windows.items()}

	def _day_hours(self, weekday):
		window = self._windows.get(weekday)
		if window is None:
			return 0.0
		start_t, finish_t = window
		return (finish_t.hour * 60 + finish_t.minute) / 60.0 - (start_t.hour * 60 + start_t.minute) / 60.0

	def _day_start(self, date_obj):
		window = self._windows.get(date_obj.weekday())
		start_t = window[0] if window else dt_time(0, 0)
		return datetime.combine(date_obj, start_t)

	def _day_finish(self, date_obj):
		window = self._windows.get(date_obj.weekday())
		finish_t = window[1] if window else dt_time(0, 0)
		return datetime.combine(date_obj, finish_t)

	def snap_forward(self, dt):
		"""Move dt onto the calendar: if it isn't within a working window,
		advance to the start of the next working day. Always safe to call —
		a dt already inside a working window is returned unchanged."""
		current = dt
		for _ in range(3660):  # ~10 years of days as a hard safety cap
			window = self._windows.get(current.weekday())
			if window is None:
				current = self._day_start(current.date() + timedelta(days=1))
				continue
			day_start = self._day_start(current.date())
			day_finish = self._day_finish(current.date())
			if current < day_start:
				current = day_start
			if current >= day_finish:
				current = self._day_start(current.date() + timedelta(days=1))
				continue
			break
		return current

	def snap_backward(self, dt):
		"""Inverse of snap_forward, for the backward pass: move dt onto the
		calendar by retreating to the end of the previous working day if
		dt isn't within (or right at the close of) a working window."""
		current = dt
		for _ in range(3660):
			window = self._windows.get(current.weekday())
			if window is None:
				current = self._day_finish(current.date() - timedelta(days=1))
				continue
			day_start = self._day_start(current.date())
			day_finish = self._day_finish(current.date())
			if current > day_finish:
				current = day_finish
			if current <= day_start:
				current = self._day_finish(current.date() - timedelta(days=1))
				continue
			break
		return current

	def add_hours(self, start_dt, hours):
		"""Advance start_dt by `hours` of working time, skipping non-working
		days/hours. hours may be 0 (returns start_dt snapped forward onto the
		calendar, even when no working time is actually consumed — callers
		must NOT skip this call just because hours/lag is 0: a predecessor's
		finish (or any other candidate instant) can land exactly on a
		non-working boundary, e.g. the last minute of a work day, and still
		needs this snap to become a valid successor start)."""
		remaining = max(0.0, hours)
		current = self.snap_forward(start_dt)

		while remaining > 1e-9:
			window = self._windows.get(current.weekday())
			if window is None:
				current = self._day_start(current.date() + timedelta(days=1))
				continue
			day_finish = self._day_finish(current.date())
			available = (day_finish - current).total_seconds() / 3600.0
			if available <= 1e-9:
				current = self._day_start(current.date() + timedelta(days=1))
				continue
			if remaining <= available:
				current = current + timedelta(hours=remaining)
				remaining = 0.0
			else:
				remaining -= available
				current = self._day_start(current.date() + timedelta(days=1))
		return current

	def subtract_hours(self, end_dt, hours):
		"""Inverse of add_hours, for the backward pass."""
		remaining = max(0.0, hours)
		current = self.snap_backward(end_dt)

		while remaining > 1e-9:
			window = self._windows.get(current.weekday())
			if window is None:
				current = self._day_finish(current.date() - timedelta(days=1))
				continue
			day_start = self._day_start(current.date())
			available = (current - day_start).total_seconds() / 3600.0
			if available <= 1e-9:
				current = self._day_finish(current.date() - timedelta(days=1))
				continue
			if remaining <= available:
				current = current - timedelta(hours=remaining)
				remaining = 0.0
			else:
				remaining -= available
				current = self._day_finish(current.date() - timedelta(days=1))
		return current

	def hours_between(self, start_dt, end_dt):
		"""Working hours between two datetimes (start_dt <= end_dt)."""
		if end_dt <= start_dt:
			return 0.0
		total = 0.0
		current = start_dt
		for _ in range(3660):
			if current >= end_dt:
				break
			window = self._windows.get(current.weekday())
			if window is None:
				current = self._day_start(current.date() + timedelta(days=1))
				continue
			day_start = self._day_start(current.date())
			day_finish = min(self._day_finish(current.date()), end_dt)
			segment_start = max(current, day_start)
			if day_finish > segment_start:
				total += (day_finish - segment_start).total_seconds() / 3600.0
			current = self._day_start(current.date() + timedelta(days=1))
		return total


def _normalize_rel_type(raw):
	"""P6 relationship Type values ("FinishToStart", "Start to Start", "SS",
	...) collapsed to one of 'FS'/'SS'/'FF'/'SF' (defaulting to 'FS', P6's
	own default relationship type, for anything unrecognized).

	Splits on the "to" token (after stripping spaces/dashes) and takes the
	first letter of each side, rather than deleting every "to" substring
	outright — the previous version did the latter, which silently mapped
	EVERY full-word form ("FinishToStart", "StartToStart", "Finish to
	Start", ...) to the 'FS' fallback: e.g. "startstart" (what's left of
	"starttostart" after blindly stripping "to") never matches the 'ss' key,
	so only the already-abbreviated 2-letter codes ("FS"/"SS"/"FF"/"SF")
	ever normalized correctly. Only 2-letter codes need the early-return
	fast path; anything else goes through the split."""
	norm = (raw or "").strip().lower()
	mapping = {"fs": "FS", "ss": "SS", "ff": "FF", "sf": "SF"}
	if norm in mapping:
		return mapping[norm]
	compact = norm.replace(" ", "").replace("-", "")
	if "to" in compact:
		left, _, right = compact.partition("to")
		code = (left[:1] + right[:1]).upper()
		if code in mapping.values():
			return code
	return "FS"


def _parse_dt(text, fallback):
	if not text:
		return fallback
	try:
		return datetime.fromisoformat(str(text).replace("Z", "+00:00")).replace(tzinfo=None)
	except Exception:
		return fallback


def calculate_cpm(result):
	"""Mutate result["tasks"] in place: recalculate start/finish/
	total_float_hours/is_critical via forward+backward pass CPM, using each
	task's own duration/calendar and the predecessor/successor relationships
	already parsed from the P6 XML. Returns a stats dict.

	`result` is one file's parse_p6_xml_file() output (tasks/calendars/
	data_date) — CPM is run per-file since relationships never cross files.
	"""
	tasks = result.get("tasks") or {}
	calendars_raw = result.get("calendars") or {}
	data_date = _parse_dt(result.get("data_date"), datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))

	calendar_cache = {}

	def get_calendar(calendar_id):
		if calendar_id not in calendar_cache:
			calendar_cache[calendar_id] = WorkCalendar(calendars_raw.get(calendar_id))
		return calendar_cache[calendar_id]

	if not tasks:
		return {"scheduled": 0, "cycle_detected": False, "project_finish": None}

	# Kahn's algorithm topological sort, over predecessor -> successor edges.
	in_degree = {key: 0 for key in tasks}
	for key, task in tasks.items():
		for pred in task.get("predecessors", []):
			if pred["id"] in tasks:
				in_degree[key] = in_degree.get(key, 0) + 1

	queue = [key for key, deg in in_degree.items() if deg == 0]
	order = []
	remaining_in_degree = dict(in_degree)
	while queue:
		key = queue.pop(0)
		order.append(key)
		for succ in tasks[key].get("successors", []):
			succ_id = succ["id"]
			if succ_id not in remaining_in_degree:
				continue
			remaining_in_degree[succ_id] -= 1
			if remaining_in_degree[succ_id] == 0:
				queue.append(succ_id)

	cycle_detected = len(order) < len(tasks)
	if cycle_detected:
		# Any tasks not reached by the topological sort are part of a cycle
		# (or depend on one) — append them in arbitrary order so they still
		# get scheduled (anchored at the data date) rather than left out.
		order.extend(key for key in tasks if key not in order)

	es = {}
	ef = {}

	for key in order:
		task = tasks[key]
		calendar = get_calendar(task.get("calendar_id", ""))
		duration = task.get("duration_hours") or 0.0
		has_actual_start = bool(task.get("has_actual_start"))
		has_actual_finish = bool(task.get("has_actual_finish"))

		if task.get("loe"):
			# A level of effort (a programme rule's level task): it starts with the earliest of the activities tied to
			# it by Start-to-Start and finishes with the latest tied by Finish-to-Finish, whatever its own duration.
			starts = [es[p["id"]] for p in task.get("predecessors", []) if p["id"] in es and _normalize_rel_type(p.get("type")) == "SS"]
			finishes = [ef[p["id"]] for p in task.get("predecessors", []) if p["id"] in ef and _normalize_rel_type(p.get("type")) == "FF"]
			es[key] = min(starts) if starts else (min(finishes) if finishes else data_date)
			ef[key] = max(finishes) if finishes else es[key]
			if ef[key] < es[key]:
				ef[key] = es[key]
			task["loe_hours"] = round(calendar.hours_between(es[key], ef[key]), 2) if ef[key] > es[key] else 0.0
			continue

		# An activity that's already actually started/finished in P6 keeps
		# that real date fixed — it already happened, so no amount of
		# predecessor/duration logic should move it. Only activities without
		# a real actual date get computed from predecessors + duration, same
		# as before. (has_actual_start/has_actual_finish come from
		# parse_p6_xml_file/parse_p6_xer_file's ActualStartDate/
		# ActualFinishDate resp. act_start_date/act_end_date fields.)
		if has_actual_start:
			es[key] = calendar._day_start(_parse_dt(task.get("start"), data_date).date())
		else:
			start_floor = data_date
			for pred in task.get("predecessors", []):
				pred_key = pred["id"]
				if pred_key not in ef:
					continue
				lag = pred.get("lag_hours") or 0.0
				rel_type = _normalize_rel_type(pred.get("type"))
				pred_es = es[pred_key]
				pred_ef = ef[pred_key]
				# NOTE: add_hours/subtract_hours are always called here, even
				# when lag is 0 — add_hours(x, 0)/subtract_hours(x, 0) still
				# snap x onto the calendar. Skipping the call whenever lag is
				# falsy (the previous behavior) used the raw pred_es/pred_ef
				# as the candidate instead, which is wrong whenever that
				# instant lands exactly on a non-working boundary (e.g. a
				# predecessor finishing at the close of a work day, which is
				# the common case for whole-day durations): the successor
				# would then be recorded as starting on the SAME calendar day
				# the predecessor finishes, instead of the next working
				# instant, even though the predecessor must genuinely finish
				# before the successor starts.
				if rel_type == "SS":
					candidate = calendar.add_hours(pred_es, lag)
				elif rel_type == "FF":
					target_ef = calendar.add_hours(pred_ef, lag)
					candidate = calendar.subtract_hours(target_ef, duration)
				elif rel_type == "SF":
					target_ef = calendar.add_hours(pred_es, lag)
					candidate = calendar.subtract_hours(target_ef, duration)
				else:  # FS (P6 default)
					candidate = calendar.add_hours(pred_ef, lag)
				if candidate > start_floor:
					start_floor = candidate
			es[key] = start_floor

		if has_actual_finish:
			ef[key] = calendar._day_finish(_parse_dt(task.get("finish"), data_date).date())
		else:
			ef[key] = calendar.add_hours(es[key], duration) if duration > 0 else es[key]

	project_finish = max(ef.values()) if ef else data_date

	lf = {}
	ls = {}
	for key in reversed(order):
		task = tasks[key]
		calendar = get_calendar(task.get("calendar_id", ""))
		duration = task.get("duration_hours") or 0.0

		if task.get("loe"):
			lf[key], ls[key] = ef[key], es[key]
			continue

		if task.get("has_actual_finish"):
			# Already complete — fixed, zero float, not subject to
			# successor-driven late-date pull (there's nothing left to
			# reschedule; it's in the past).
			lf[key] = ef[key]
			ls[key] = es[key]
			continue

		finish_ceiling = project_finish
		has_successor = False
		for succ in task.get("successors", []):
			succ_key = succ["id"]
			if succ_key not in ls:
				continue
			if tasks[succ_key].get("loe"):
				continue  # a level of effort follows what it spans: it does not hold its pours back
			has_successor = True
			lag = succ.get("lag_hours") or 0.0
			rel_type = _normalize_rel_type(succ.get("type"))
			succ_ls = ls[succ_key]
			succ_lf = lf[succ_key]
			# See the matching NOTE in the forward pass above: always call
			# add_hours/subtract_hours (even for lag == 0) so a candidate
			# landing exactly on a non-working boundary still gets snapped
			# onto the calendar instead of being used raw.
			if rel_type == "SS":
				target_es = calendar.subtract_hours(succ_ls, lag)
				candidate = calendar.add_hours(target_es, duration)
			elif rel_type == "FF":
				candidate = calendar.subtract_hours(succ_lf, lag)
			elif rel_type == "SF":
				target_ls = calendar.subtract_hours(succ_lf, lag)
				candidate = calendar.add_hours(target_ls, duration)
			else:  # FS
				candidate = calendar.subtract_hours(succ_ls, lag)
			if candidate < finish_ceiling:
				finish_ceiling = candidate

		lf[key] = finish_ceiling if has_successor else ef[key]
		ls[key] = calendar.subtract_hours(lf[key], duration) if duration > 0 else lf[key]

	scheduled = 0
	for key, task in tasks.items():
		calendar = get_calendar(task.get("calendar_id", ""))
		task_es, task_ef = es[key], ef[key]
		task_ls, task_lf = ls[key], lf[key]
		total_float = calendar.hours_between(task_es, task_ls) if task_ls > task_es else -calendar.hours_between(task_ls, task_es)

		task["start"] = task_es.isoformat()
		task["finish"] = task_ef.isoformat()
		task["total_float_hours"] = round(total_float, 2)
		task["is_critical"] = total_float <= 1e-6
		scheduled += 1

	return {
		"scheduled": scheduled,
		"cycle_detected": cycle_detected,
		"project_finish": project_finish.isoformat() if project_finish else None,
	}
