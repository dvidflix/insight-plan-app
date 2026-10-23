# scenario-engine

A copy of the CWA planning tool's Python generator (`0-src` from
`TOC Step 2/10 Scenarios/V03 - MMS BIMCollab models`), bundled so the app's
**Scenarios** tab does not depend on that folder's code. The dev server
(`vite-plugins/scenarios.ts`) runs it as:

    python scenario-engine/main.py --input <project>/models/<model>.ifc \
        --stage schedule --skip-master-excel --output-dir <project>/scenarios/<scenario>

with the scenario's own `<model>_Overrides.xlsx` (SequenceOrder edited in the
app) and `CWA_START_DATE` set from the tab's Start date.

The scheduling rules it applies (activities, durations, relationships, CPM)
are documented in the main README, under *Scheduling logic*.

Setup: Python 3.12 with `pip install -r scenario-engine/requirements.txt`.
Set `SCENARIO_PYTHON` to use a specific interpreter instead of `python`.

Local changes versus the original:
- `config.py`: `START_DATE` read from `CWA_START_DATE` (blank = today).
- `core/excel_exporter.py`: `_fast_column_widths` casts to `object` first
  (pandas nullable `Int64` columns rejected the `""` fill and crashed the
  Excel report after the XML was written).

## Work items (units of work that are not pours)

The generator builds a record for each pour of a model. A request may carry `workItems` instead: units of work the app made from any objects (a
search set, objects with the same value of a property) at one building and level, with no model behind them (`core/work_items.py`).

```json
{ "op": "generate", "input": "...", "scenarioDir": "...", "startDate": "2026-01-05",
  "workItems": [{ "id": "WI-1", "group": "Chiller", "building": "H1", "level": "L1", "zone": "", "quantity": 4, "quantities": { "kw": 800 }, "properties": {} }],
  "sequence": [{ "GUID": "WI-1", "Index": 1 }], "rules": { "recipes": [] } }
```

An item is made into the record a pour of the same properties would have, so recipes, rates, crews, resources, links, levels, zones and the XML
read it the same way. Its `group` is what a recipe or a rule group finds it by (a rule group for each group is added when the rules have none). With
no recipe an item is one activity, `Work`. The generator's pour code never reads the group's words (a group called "Retaining wall" is not a wall).
`quantity` is the number "the pour's volume" is, `quantities` are numbers a productivity can take (property set `Work item`). `tests/test_work_items.py`.
