<!-- order: 11 -->
<!-- group: Under the hood -->
# Project database

One SQLite file per project, `<project folder>/insight-plan.db`, created the first time the folder is opened (**Inputs › Project database**, or the Scenarios project folder — the same setting). It is the source of truth for the project and can be opened alongside the app in **DBeaver** or **DB Browser for SQLite** (WAL mode). Needs the dev server (`vite-plugins/projectDbPlugin.ts`, `vite-plugins/db/projectDb.ts`).

**Programmes** are stored in Primavera P6's own tables and columns, as in an XER: `PROJECT`, `PROJWBS`, `TASK`, `TASKPRED`, `RSRC`, `TASKRSRC`, `ACTVTYPE`, `ACTVCODE`, `TASKACTV`, `UDFTYPE`, `UDFVALUE`, `CALENDAR`… Each row has one extra column, `ip_programme_id`, naming its programme in `ip_programme`, so programmes from different files can share P6 ids. Tables and columns are created as XER files bring them; `*_id` columns are integers and counts / quantities / costs numeric, so SQL compares them as numbers; dates are text (`YYYY-MM-DD HH:MM`).

- Inputs imports a dropped `.xer` into these tables (the chosen projects only) and loads it from there; an `.xml` is converted to XER first. Scenario programmes (Update 4D) go in the same way, one per scenario and building (`kind = 'scenario'`), replacing the previous one.
- A **P6 Professional** standalone (SQLite) database can be added from Inputs: pick its projects and they are read **live and read-only** each time the programme loads (rows P6 marks deleted are skipped). Nothing is ever written to P6's database; changes go back to P6 by XER / XML import.
- Programmes hidden in Inputs are remembered (`ip_programme.hidden`) and only loaded when shown. **Delete** removes a programme and its rows.

**App data**, in `ip_*` tables:

| Table | Holds |
| --- | --- |
| `ip_scenario`, `ip_scenario_model` | scenarios, and the buildings each has been saved for |
| `ip_scenario_step` | pour order: `guid`, `step` (pours sharing a step start together) |
| `ip_scenario_link` | manual links: `pred_task_code`, `succ_task_code`, `rel_type`, `lag_hours` |
| `ip_scenario_crew` | crew overrides: `phase`, `pour_type`, `trade`, `crew` |
| `ip_link_group` | 4D link groups (rules as JSON) |
| `ip_trade_capacity` | site capacity per trade (Programmes › Resources levelling limit) |
| `ip_setting` | project settings (e.g. the scenarios' start date) |
| `ip_clash_run`, `ip_clash_pair` | Clashes & contacts: one run per model with itself and per pair of models, keyed by what the result depends on (the models' files, their placement, the tolerance); the pairs by GlobalId |

The first time a database is opened, the browser's link groups, trade capacities and scenario start date go into it (when it has none); after that the database wins. The **layout settings** (which columns each view shows, their order and widths, group / sort / colour rules, zoom, view settings, notes, PPC reasons, saved layouts…) are kept in the same database, in `ip_setting` as `ui:<setting>`, so they follow the project to another PC or browser. A change is written a moment later. Opening a project pulls them in: the first time the browser's settings go into the database; after that the database wins for the settings it has (and the browser's others are added to it). Most panels re-read them at once; a few that only read their settings at start show them after a reload. Link groups, trade capacities and the start date have their own tables.

**Editing outside the app.** The app polls the file for commits made by other programs (`PRAGMA data_version`); the database chip in the top bar then turns amber — click it, or **Reload from database** in Inputs, to bring the changes in (programmes, the scenario on screen, link groups, capacities, settings). Unsaved scenario edits are kept unless you agree to discard them. DB Browser for SQLite holds a lock while it has unwritten changes: *Write Changes* before saving in the app.

Without a project database the app works as before: programmes load from files into memory.

## Model store

Models live in a second file beside the project database, `<project folder>/insight-plan-models.db` (separate: models are large and rarely change, the schedule data changes all the time, and neither belongs in Git). With a project folder open, every IFC dropped on Inputs is kept in it:

- **The IFC**, gzip-compressed: the source of truth, and what **Export IFC** gives back.
- **A converted `.frag`** (with the IFC layers) built from that exact IFC by the current converter. **Inputs › Models in the project database › Open** uses it, so the model opens without converting the IFC again. A new IFC, or a new converter version, makes the copy stale; the next open converts once and keeps the new copy.
- **Earlier IFCs** (the last five), kept whenever an edit or a new file replaces the model. **Restore** makes one the current IFC again.

Edits made in the app (Properties › Edit properties, Model checks patches) are written to the IFC as before (a `_FIXED.ifc` in the project folder) and the edited IFC becomes the model's current IFC in the store, so Export IFC and the next open have them. A model opened from its converted copy has no IFC in memory: it is read from the store when an edit needs it.

Both `.db` files are best kept out of Git (they can be rebuilt); keep the `.ifc` files, with Git LFS for the big ones. The model store works under `npm run dev` only, like the project database; restart the dev server after updating the app so it picks up the new endpoints.

## Folder layout

```
<project folder>/
  insight-plan.db            programmes, scenarios, link groups, settings
  insight-plan-models.db     the stored models (IFC and converted copy)
  models/                    your IFC files (Scenarios reads the buildings from here)
    edited/                  IFCs the app wrote back (<name>_FIXED.ifc), each with a .log.json of what changed
  scenarios/                 one folder per scenario: the generated programme and the caches it needs
```

Projects made by earlier versions used `1-input-ifc`, `fixed-models` and `7-scenarios`. They keep working under those names. **Inputs › Project database** offers to rename them to the layout above (nothing is overwritten). The full CWA workflow's own scripts expect the old names, so only rename a folder you don't also run them on. Inside a scenario's folder the generator keeps its own sub-folders (`2-enriched-ifc` for the caches, `3-schedule-xml`, `4-schedule-xlsx`).
