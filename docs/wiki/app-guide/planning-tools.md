<!-- order: 4 -->
<!-- group: App pages -->
# Planning tools

The Programmes views added for look-ahead planning, risk and housekeeping, and the settings that go with them. Pick them in the **Views** list on the Programmes page.

## Lookahead

What the next few weeks ask for. Pick the first day (it starts on the data date) and the length (1–12 weeks). The table lists every unfinished activity that **starts**, **finishes** or **runs through** the window, and everything already **late** (should have finished, or should have started and has not). A tag shows why each is in. Filter by tag, sort any column, **Export (CSV)**, or **Set 4D date** to move the 4D timeline to the window's first day. Click an activity ID to open it in the Table.

## PPC (Plan Complete)

Percent Plan Complete by week, the Last Planner measure. A week's PPC is the share of activities **planned to finish in it** (baseline finish, else the planned finish) that **finished by its end** (actual finish). Open weeks show as in progress. The chart shows planned and finished bars with the percentage over each. Click a week to see what it missed, and give each miss a **reason** (predecessor late, labour, material, design / RFI, weather, access, permits, rework, other). The reasons add up in "Why plans were missed". Reasons are saved with the app configuration.

## Risk (Monte Carlo)

How likely the programme is to finish by a date when durations are uncertain. Each unfinished activity's duration is drawn from a triangular range: the shortest and longest you set, as a percentage of planned (default 90 % to 130 %), most likely the planned value. The critical path is recalculated for each of 200–2000 runs, in whole working days, so calendars and logic apply. You get the chance of finishing by a target date, the P50 / P80 / P90 finish dates, a histogram of the finish dates, and each activity's **criticality**: the share of runs in which it sat on the critical path. Big programmes take a while: the bar shows progress and **Stop** ends the run.

## Driving path, Curtain and Notes

- **Show driving path** (Activity pane, on the right of the Table and Gantt): picks out the chain of predecessors that fixes the activity's start (relationships whose date lands on the successor's, with no free float). The Gantt tints the rows and the Table marks them; **Driving path to … ✕** in the toolbar clears it.
- **Curtain** (toolbar): filters, the search box and the driving path **fade the other rows back** instead of removing them, so you keep the surroundings. It is for presenting a selection in context.
- **Notes** (Activity pane): free text kept against the activity (by project and ID), saved when you leave the box. There is a **Notes** column in the column picker. Notes are saved with the app configuration, not in the programme file.

## Bulk edit

Change many activities at once, with a preview. **1. Which activities**: rules on any column (contains, equals, starts with, is empty…), matching all or any. **2. What to change**: set a user field (value from a template such as `{wbsName}` or `{code:Zone}`; tokens: `{code} {name} {wbs} {wbsName} {start} {finish} {udf:Field} {code:Type}`), find and replace in names, shift dates by N days, scale or set durations (not-started activities only), set or clear a constraint, or set the calendar. **3. Preview** lists before and after; **Apply** changes them all and **Undo the last edit** puts them back. Edits stay in the app (a programme read from the project database is not written back): **Download Excel** keeps the result.

## Anonymise

A masked copy of the programme to share outside the company: activity IDs and names, WBS names, resources, activity code values and text fields, calendar names, and the project and file name become neutral labels. The same value always gets the same label, so the structure and logic still read the same. You can also **shift all dates** by a number of days. **Add as a new programme** loads the copy (hide the original in Inputs), and **Download Excel** writes it as activities (with predecessors), relationships and WBS sheets. The loaded programme is not changed. Check the result before you share it: free text the tool doesn't know about is left as it is.

## Task fields from search sets

4D Sequencing › Link Groups › **Task fields from search sets** copies the name of the search set(s) holding a task's linked objects into a task field (user field), "CWA-Methods Break Down" by default. Choose the folder of sets, and whether a set counts when it holds most, any or all of the task's objects. Several matching sets are joined with "; ". The field then shows in Tasks and the Gantt (Columns › User Fields).

## Colour palette and the 4D timeline

- **Settings › Appearance** picks the app's accent colour from a set of palettes (Standard green, Ocean, Teal, Violet, Rose, Amber, Graphite): buttons, selections, highlights and the Gantt bars follow it.
- **Settings › Accessibility › Colour palette**: *Colour-blind safe* swaps the green / red of the Gantt bars, critical links, Network view, float report and status colours for a blue / orange set that stays apart with the common kinds of colour-blindness.
- **Settings › 4D timeline**: zoom the timeline bar (Ctrl + wheel over it also zooms), follow the date while stepping, playback speed, and which rows show (years, months, week ticks, progress shading, a line at the current date).
