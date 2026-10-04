<!-- order: 5 -->
<!-- group: App pages -->
# Scenarios

Re-sequence a concrete pour model and generate its programme (dev server only). You only need the model: load its IFC in **Inputs**, then open Scenarios.

1. **A project folder.** Scenarios works in a project folder — the same folder as the [project database](project-database.md#project-database). Pick yours in the Scenario panel, or use **Start without a project folder**, which works in `Documents\Insight Plan\Default project`. A folder laid out like the CWA planning tool's (`models`, `2-enriched-ifc`, `4-schedule-xlsx`) works as before.
2. **Add the model.** When the building loaded in Inputs is not in the folder yet, **Add to project** copies its IFC into `models`. The first time, preparing its pour list runs class fixing and clash detection (a few minutes); after that, updates take about a second. Adding a model again replaces it and clears what the app built from the old one.
3. **Model check.** Before and after adding, the **Model check** card says whether the generator can make a programme from the model: *Ready to generate*, *Will generate, with gaps* or *Cannot be generated* — see [What the generator needs from a model](#what-the-generator-needs-from-a-model). **Show** selects the elements concerned in 3D.
4. Scenarios are kept in the project database (`ip_scenario*` tables): each one's pour order, manual links and crews, per building. The generator's outputs (XML, caches) stay in `<project>/scenarios/<name>`. Scenario JSON files and Overrides workbooks from before the database are imported into it once, the first time it is opened.
5. Reorder pours in the scenario's **SequenceOrder** table (drag, move to, group rows into one Index that starts together; the table has the Columns / Filters / Group / Sort / Colour pane).
6. **Update 4D** regenerates the programme for the order on screen and loads it straight into 4D, with no download or Inputs step. It uses a generator process that stays running and keeps the building's model and pour records loaded (`scenario-engine/serve.py`). After a warm-up when the scenario opens, an update takes about a second in the generator and about 3 s until 4D shows it. **Auto-update** does this a moment after each change. The first update for a building runs the whole generator once (`main.py`, XML only — no Excel) to build its geometry cache. **Save** keeps the order; XML / XER downloads stay available.
7. **Links** and **Crews** (side-pane tabs) edit the scenario's manual links (predecessor / successor activity IDs from the generated programme, with names and a warning for IDs it doesn't have; type; lag in hours) and its crew overrides (phase, optional pour type, trade, people; **Customise** copies a phase's default crews in to change them). They are saved with the order, and Update 4D uses them at once.
8. The same scenario works inside **4D Sequencing › Scenarios**, beside the 3D model: picking pours in the table selects them in 3D and the other way round, and double-clicking a pour moves the 4D timeline to the day its linked activity starts (Update 4D first, so the programme has that pour), and the Scenario panel is docked next to it. Both places share one state, so unsaved edits carry over.
9. **Steps.** In Models > Search sets, **Import steps…** reads a CSV / TXT (a column that identifies the objects — GlobalId or any model property, e.g. the Pour ID Number — and a task-name column, in construction order, e.g. a Navisworks TimeLiner export). Consecutive rows with the same task become a search set (that property is any of …) in the **Steps** folder, numbered 1, 2, …; rows without a task name are left out. In the scenario toolbar, **From steps** orders the pours by those sets — each step's pours start together — and pours in no step leave the sequence. You can then split steps and move pours as usual.
10. **Record picks.** In 4D > Scenarios, switch on **Record picks** and click pours in 3D one at a time; the count shows how many are remembered. **Sort by picks** puts them first, one step each, in the order picked; **Clear picks** forgets them.

## What the generator needs from a model

Only elements with the **CWA Pour** property set are pours; everything else in the model is ignored, and no other property set is needed. What CWA Codes holds (General Level 1–3, Full Pour ID) is worked out from CWA Pour, and CWA_Planning is the generator's own output. From CWA Pour it reads:

| Property | Needed for | When it is missing |
| --- | --- | --- |
| Pour Type | activity type code, durations, crews | **error** — the pour becomes "OTHER" |
| Pour Volume m3 | including the pour; rebar tonnes | **error** — counted as 0 m³ and left out |
| Pour ID Number | the pour number in the activity ID (four digits: 21 → 0021) | warning — the generator numbers the pour itself, after the building's highest number |
| Level | level code and WBS | warning — the pour goes on L0 |
| Building (and Unit) | building code in IDs and WBS | warning — "UNKNOWN" |
| Building Zone | zone code (C / D) | noted — no zone code |
| Is External? | EW / IW for walls | noted — walls taken as internal |
| Concrete Stage, Max / Min Elevation | stage 2, precast, double-height walls | optional |

Pours under **0.25 m³**, and the types **BOSS, SCREED, GROUT, SPECIAL**, are left out of the programme. Two pours with the same building, level, zone, type and pour number would get the same activity ID — the check flags them. The rules live in `scenario-engine/main.py` (reading the pours) and `config.py`; the app's check (`src/scenarios/modelCheck.ts`) follows them.
