<!-- order: 5 -->
# Programmes

Your P6 programmes, in the view you choose from the **Views** list at the top of the page. Several programmes can be open together. The planning tools have their own page: [Planning tools](planning-tools.md).

## The views

| View | Use it to |
| --- | --- |
| **Gantt** | See the programme as bars, grouped by WBS or by any fields, with links and the critical path |
| **Table View** | List the activities in columns; export to Excel; totals along the bottom |
| **WBS** | See the WBS as a tree with the load of each branch |
| **Resources** | Compare labour demand with capacity per trade (see below) |
| **Calendar Heatmap** | See how many activities fall on each day; click a day to filter |
| **Calendars** | Read each calendar's working pattern and exceptions |
| **Activity Codes** | Browse code types and values as a tree; pick values to filter |
| **Quality Checks** | Assess the programme against the DCMA 14 points and extra checks, each with editable thresholds |
| **Reports and Analysis** | Milestone and WBS variance, constraint, float, relationship and lag reports |
| **Schedule Comparison** | Compare a baseline with the current programme: delay events and critical-path drag |
| **Concrete Comparison** | Compare concrete and rebar quantities over time, several programmes side by side |
| **Lookahead**, **Bulk edit**, **Renumber to new model** | See [Planning tools](planning-tools.md) |

Some views are still being tried out and are hidden until you switch them on in **Settings › Experimental features**: Schedule Explorer, Network View, PPC, Risk (Monte Carlo), Anonymise and What-If Scenarios.

## The side pane: Columns, Filters, Group, Sort, Colour

These shape the Table and the Gantt, and work the same way in the Models data table.

- **Columns**: choose, reorder and resize columns. Keep sets of columns as presets.
- **Filters**: quick filters, value lists with live counts, and ranges.
- **Group**: nest groups, like P6.
- **Sort**: sort by several columns.
- **Colour**: colour rows by a rule or by value.

## Layouts

**Layouts** (on the Table and Gantt) saves how the view looks and returns to it later: the columns, group, sort and colour rules, filters, zoom and Gantt options. Apply a layout to switch to it. **Update** overwrites it with the view as it is now. You can file layouts in folders and drag them to reorder.

A layout holds only how the view looks. Applying one never changes your programme.

## Activities

Select an activity to open its details on the right (the **Activity pane**): dates, float, relationships, notes, and **Show driving path**.

## Resources

Labour demand against capacity for each trade, stacked per day, week or month. Choose people on the peak day, people per average weekday, or man-hours. A line shows capacity, and ▲ marks periods over capacity.

- Click a bar to see the activities behind it.
- A cumulative man-hours curve and key figures are shown too.
- **Capacities** are editable. **Levelling** moves work to stay within capacity.
- Materials such as concrete and rebar get their own graphs.

## Float and the critical path

Float and the critical path come from the file when it has them. Otherwise the app calculates them, using the programme's calendars.
