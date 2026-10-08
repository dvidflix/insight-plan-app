# Retired and extra activities (SeaTable)

Tasks the generator should **not** regenerate, and activities it should **add** to every programme it generates, are kept in
three tables of the SeaTable Files base ("insight-plan-files", the one whose API token is SEATABLE_FILES_API_TOKEN). Everything is pushed and pulled from one place:
**Programmes › Generated schedules tab › Retired and extra activities (SeaTable)**.

## Picking tasks

In the Programmes table or the Gantt:

- click a row: that task
- **Ctrl+click** (Cmd on Mac): add or remove a task
- **Shift+click**: every task between the last click and this one, in the order listed (Ctrl+Shift adds the range)

The table and the Gantt share the picks.

## Retired

1. Pick the generated tasks, open the Generated schedules tab, optionally type a reason, and press **Send N to Retired**.
2. One row per Task ID is added to the **Retired** table (a Task ID already there is left alone). The app makes the table
   when it is missing.
3. At once the tasks leave the table, the Gantt and 4D, and the links around each are closed up (every predecessor is linked to
   every successor) so the chain does not break. The app also pulls the Retired table into the local copy the generator reads and, when a
   scenario is open, generates the programme again (Update 4D), so the links are the generator's own.
   With no scenario open, open it and press Update 4D.

To bring a task back, delete its row in the Retired table and pull.

The Task ID is the one shown as the activity ID (for example `SZC-1HDAB-L2-…-0313-R`). It stays the same while the pour's ID
does.

| Retired column | Type | Notes |
|---|---|---|
| Task ID | text | the key |
| Task name | text | written by the app, for reading |
| Reason | text | optional |
| Retired on | text | written by the app |

## Baselines and extra activities (you create these two tables)

**Baselines**

| Column | Type |
|---|---|
| Name | text (first column) |
| Start | date |
| Finish | date |
| Notes | text |

**Extra activities**

| Column | Type | Notes |
|---|---|---|
| Task ID | text (first column) | must not already exist in the programme (such a row is skipped) |
| Task name | text | |
| Duration (days) | number | 0 makes a finish milestone |
| Baseline | link to **Baselines** | its Start / Finish become the activity's target (baseline) dates |
| Predecessors | text | Task IDs separated by commas |
| Successors | text | Task IDs separated by commas |
| WBS | text | reserved; extras are grouped under "&lt;building&gt; - Extra activities" |
| Notes | text | |

Extras are added to every generated programme, under their own WBS node, scheduled by the CPM from their
predecessors. An extra linked to a baseline keeps the CPM dates as its current dates (`StartDate` / `FinishDate`) and takes the
baseline's dates as its planned (target) dates, which the Gantt draws as the baseline bar (Gantt settings › Show target bars).

## How the generator gets them

Pull writes `C:\insight-stack\data\adjustments.json` (override with the `INSIGHT_ADJUSTMENTS_FILE` environment variable, or
`ADJUSTMENTS_FILE` in `scenario-engine/config.py`). The generator reads that file, so it works with SeaTable switched off. No
file: nothing is retired and nothing is added.
