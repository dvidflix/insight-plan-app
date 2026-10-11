<!-- order: 6 -->
# Planning tools

Choose these from the **Views** list on the Programmes page.

## Lookahead

What the next few weeks ask for. Pick the first day (it starts on the data date) and the length (1 to 12 weeks). The table lists every unfinished activity that **starts**, **finishes** or **runs through** the window, plus everything already **late**. A tag shows why each is listed.

- Filter by tag, and sort any column.
- **Export (CSV)** saves the list.
- **Set 4D date** moves the 4D timeline to the window's first day.
- Click an activity ID to open it in the Table.

## Bulk edit

Change many activities at once, with a preview.

1. **Which activities**: rules on any column (contains, equals, starts with, is empty…), matching all or any.
2. **What to change**: set a user field, find and replace in names, shift dates by a number of days, scale or set durations (not-started activities only), set or clear a constraint, or set the calendar.
3. **Preview** lists before and after. **Apply** changes them all. **Undo the last edit** puts them back.

Edits stay in the app. **Download Excel** keeps the result.

## Renumber to new model

When a new version of the model changes its Pour IDs, this carries the programme over. Give it the old-to-new Pour IDs (from a model comparison or a file). Every Activity ID, name, user field and WBS name holding an old Pour ID gets the new one. Logic, dates and links stay as they are. One click undoes it.

## Driving path, Curtain and Notes

- **Show driving path** (in the Activity pane): picks out the chain of predecessors that fixes the activity's start. The Gantt tints the rows. **Driving path to … ✕** in the toolbar clears it.
- **Curtain** (toolbar): filters, the search box and the driving path fade the other rows back instead of hiding them, so you keep the surroundings. Good for presenting a selection in context.
- **Notes** (Activity pane): free text kept against the activity and saved when you leave the box. There is a **Notes** column in the column picker.

## Tools you can switch on

Turn these on in **Settings › Experimental features**. They then appear in the Views list.

- **PPC (Plan Complete)**: the share of activities planned to finish in each week that finished by its end. Click a week to see what it missed and record a reason for each miss. The reasons add up in "Why plans were missed".
- **Risk (Monte Carlo)**: how likely the programme is to finish by a date when durations are uncertain. Set the shortest and longest duration as a percentage of planned (default 90 % to 130 %). You get the chance of finishing by a target date, the P50, P80 and P90 finish dates, and each activity's criticality. Big programmes take a while. **Stop** ends the run.
- **What-If Scenarios**: change durations and relationships and see the new critical path and finish date.
- **Network View**: the logic network, grouped by WBS or resource, optionally the critical path only.
- **Schedule Explorer**: the table, Gantt, resources and calendar together on one page, each panel resizable.
- **Anonymise**: a masked copy of the programme to share outside your company. Names, codes and resources become neutral labels (the same value always gets the same label), and you can shift all dates. Check the result before you share it: free text the tool does not know about is left as it is.
