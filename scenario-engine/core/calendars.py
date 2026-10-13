# core/calendars.py
"""Working calendars of the generated programme, and which activity runs on which.

The scenario's rules define them (docs/programme-rules; src/prs/rules.ts):

  calendars      [{id, name, workDays, start, hoursPerDay, default?}]   workDays: 0 = Monday ... 6 = Sunday
  calendarRules  [{id, when, phase?, calendar}]                         the calendar of the activities a rule fits

A rule's `when` is the same condition as every other rule's (a group, a family, a level range ...), and `phase` narrows it to one
activity of the pour (Curing). For one activity the matching rule with the most terms wins (a tie goes to the earlier row); an
activity no rule fits runs on the default calendar (the one marked default, else the first).

With no calendars in the rules there is one plain Mon-Fri 09:00-17:00 calendar for everything (BUILTIN_CALENDARS). Curing on a
7-day week is a calendar rule, like any other.
"""
from core import rules as _rules

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_XML_ORDER = [6, 0, 1, 2, 3, 4, 5]  # P6 lists the week from Sunday

# With no calendars in the rules: one plain Mon-Fri week for every activity (a Calendar rule gives Curing its 7-day week).
BUILTIN_CALENDARS = [{"id": "STD", "name": "Standard calendar", "workDays": [0, 1, 2, 3, 4], "start": "09:00", "hoursPerDay": 8, "default": True}]
BUILTIN_RULES = []


def _seconds(text, default=9 * 3600):
    try:
        parts = [int(p) for p in str(text).strip().split(":")]
        return parts[0] * 3600 + (parts[1] if len(parts) > 1 else 0) * 60 + (parts[2] if len(parts) > 2 else 0)
    except (TypeError, ValueError, IndexError):
        return default


def _clock(seconds):
    seconds = max(0, min(int(seconds), 24 * 3600 - 1))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


class Calendar:
    """One working calendar: the same window every working day."""

    def __init__(self, row, oid):
        self.id = str(row.get("id", "")).strip()
        self.name = str(row.get("name") or self.id).strip() or self.id
        self.oid = str(oid)
        days = row.get("workDays")
        days = [int(d) for d in days if str(d).strip().lstrip("-").isdigit() and 0 <= int(d) <= 6] if isinstance(days, (list, tuple)) else None
        self.work_days = sorted(set(days)) if days else [0, 1, 2, 3, 4]
        hours = _rules._number(row.get("hoursPerDay"), 8.0)
        self.hours_per_day = hours if hours and hours > 0 else 8.0
        start = _seconds(row.get("start"))
        self.start, self.finish = _clock(start), _clock(start + self.hours_per_day * 3600)
        self.hours_per_week = self.hours_per_day * len(self.work_days)

    def xml_windows(self):
        """[(day name, start, finish) or (day name, None, None)] from Sunday, as the P6 XML lists them."""
        return [(DAY_NAMES[d], self.start, self.finish) if d in self.work_days else (DAY_NAMES[d], None, None) for d in _XML_ORDER]

    def cpm(self):
        """The calendar as calendar-aware CPM (core/cpm_schedule.py) reads it: weekday 0 = Monday."""
        return {"hours_per_day": self.hours_per_day, "workdays": {d: ((self.start, self.finish) if d in self.work_days else None) for d in range(7)}}


class Calendars:
    def __init__(self, rules):
        rows = [c for c in getattr(rules, "calendars", []) if str(c.get("id", "")).strip() and c.get("enabled") is not False]
        self.rows = rows or BUILTIN_CALENDARS
        self.rules = [r for r in getattr(rules, "calendar_rules", []) if r.get("enabled") is not False] if rows else BUILTIN_RULES
        self.rules_obj = rules
        self.items, seen, flagged = [], set(), []
        for row in self.rows:
            key = str(row.get("id", "")).strip().upper()
            if key in seen:
                continue  # a repeated id: the first one stands
            seen.add(key)
            self.items.append(Calendar(row, len(self.items) + 1))
            if row.get("default"):
                flagged.append(self.items[-1])
        self.by_id = {c.id.upper(): c for c in self.items}
        self.by_oid = {c.oid: c for c in self.items}
        self.default = flagged[0] if flagged else self.items[0]

    def for_activity(self, phase, rec):
        """The calendar an activity of this phase of this pour runs on."""
        phase = str(phase or "").strip()
        found, found_key = None, None
        for index, row in enumerate(self.rules):
            wanted = str(row.get("phase") or "").strip()
            if wanted and wanted != phase:
                continue
            calendar = self.by_id.get(str(row.get("calendar", "")).strip().upper())
            if calendar is None or not self.rules_obj.matches(row.get("when") or {}, rec or {}):
                continue
            key = (_rules._number(row.get("priority"), 0.0) or 0.0, _rules.when_terms(row.get("when") or {}) + (1 if wanted else 0), -index)
            if found_key is None or key > found_key:
                found, found_key = calendar, key
        return found or self.default

    def cpm_calendars(self):
        return {c.oid: c.cpm() for c in self.items}


def active():
    """The calendars of the scenario's rules now active (rebuilt when the rules change)."""
    rules = _rules.active()
    cached = getattr(rules, "_calendars", None)
    if cached is None:
        cached = rules._calendars = Calendars(rules)
    return cached
