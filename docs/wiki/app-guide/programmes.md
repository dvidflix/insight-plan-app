<!-- order: 4 -->
<!-- group: App pages -->
# Programmes

P6 programmes (several can be combined) in views chosen from the page's tab bar:

| View | |
| --- | --- |
| Schedule Explorer | Several panels stacked on one page (table, Gantt, resources, calendar…), each maximisable and resizable |
| Table View | The activities table, XLSX export, and a totals bar with per-column aggregates |
| Gantt | Gantt chart grouped by WBS or by any fields, with the same totals |
| Resources | Labour demand against capacity. Each trade is stacked per day / week / month (people on the peak day, people per average weekday, or man-hours) with the capacity line and ▲ on over-capacity periods. Also: KPIs, a cumulative man-hours S-curve, the activities behind any period (click a bar), editable capacities, and **levelling** (see [Resource levelling](resource-levelling.md#resource-levelling)). Materials (concrete m³, rebar t) get their own graphs. |
| Calendar Heatmap | Activity counts per day across the years; click a day to filter |
| Calendars | Each calendar's working pattern and exceptions |
| Activity Codes | Code types and values as a tree; pick values to filter activities |
| Network View | Canvas logic network grouped by WBS or resource, optionally the critical path only |
| Quality Checks | DCMA 14-point assessment plus additional checks, each with editable thresholds |
| Reports and Analysis | Milestone / WBS variance, constraint, float, relationship & lag reports (more listed as planned) |
| What-If Scenarios | Change durations and relationships and see the recomputed critical path and finish slip |
| Schedule Comparison | Baseline vs current: delay events and critical-path drag analysis |

The side pane holds **Columns** (presets, reorderable, grouped like P6), **Filters** (quick filters, value lists with live counts, ranges), **Group**, **Sort** and **Colour** rules — the same building blocks the Models data table uses.

Float and critical path come from the file when present; otherwise `schedule/cpm.ts` computes them. The CPM engines (`cpm.ts`, `network.ts`) are calendar-aware.

**Layouts.** The **Layouts** button on the Table, Gantt and Explorer views opens a panel to save the view under a name and come back to it. A layout remembers which view was open (Table, Gantt or Explorer, and the view Explorer sets up), the columns shown with their order and widths, the group, sort and colour rules and the group level, the filters of the Table and of the Gantt, the WBS palette, zoom, the Gantt options (links, critical path, baseline, labels), the curtain and the totals. Applying one switches to that view and restores all of it; **Update** overwrites a layout with the view as it is now. Layouts can be filed in folders and dragged to reorder.

A layout holds only view settings. The project's own settings (the pour map, auto-links, calculated columns, export choices, unloaded WBS, the tools' options) are not saved in it and applying a layout never changes them. Layouts saved before this rule keep working: anything else they contain is ignored.
