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
