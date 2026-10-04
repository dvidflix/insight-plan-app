<!-- order: 1 -->
<!-- group: Start here -->
# All features

Everything Insight Plan does, by page, with a link to the page that explains it.

## Inputs

- One drop zone for **IFC**, **FRAG**, **glTF / GLB** (site context), **P6 `.xer` / `.xml`** and Excel programmes. [Inputs](inputs.md), [File formats](file-formats.md)
- Models converted to Fragments in the browser, properties, spatial tree and IFC layers indexed for search.
- Turn a model or programme off without unloading it, or remove it.
- **Project database**: one project folder with one SQLite file (`insight-plan.db`), reload when it was changed outside the app, link live read-only **P6 Professional** databases. [Project database](project-database.md)
- **SeaTable**: push model elements, add your own columns there and pull them back as custom fields. [SeaTable](seatable-custom-fields.md)

## Models (3D viewer)

- Toolbar: select, **measure** (length, edge, area, angle, volume, point coordinates), **section planes**, hide / isolate / ghost / pin, orthogonal or perspective, standard views, visibility by IFC class. [Models](models.md)
- **Selection tree** (Structure, Types, Layers), **Properties** (per object or aggregated), **Search sets** (conditions, folders), **Data table** (columns, filters, group, sort).
- **Views**: saved camera, visibility, colours, section planes and style; view settings (projection, edges, AO, background, sun).
- **3D & Related**: model placement, storey slide, objects touching the selection.
- **Colour** by any property; **split view** with independent colouring.
- **Model checks (IDS)**: check against IDS files, fix failures with patches, write a `_FIXED` IFC. [Model checks](model-checks.md)
- **Topics**: BCF topics and comments.

## Programmes

- **Schedule Explorer**: table, Gantt, resources, calendar and more on one page, each panel resizable. [Programmes](programmes.md)
- **Table** (columns, filters, grouping, totals, XLSX export) and **Gantt** (by WBS or any fields).
- **Resources**: labour demand against capacity per trade. [Resource levelling](resource-levelling.md)
- **Calendar heatmap**, **Calendars**, **Activity codes**, **Network view**.
- **Quality checks**: DCMA 14-point plus extra checks with editable thresholds.
- **Reports and analysis**: variance, constraint, float, relationship and lag reports.
- **What-if scenarios** and **schedule comparison** (baseline vs current, delay events, critical-path drag).
- **Planning tools**: Lookahead, PPC (Plan Complete), Risk (Monte Carlo), driving path, Curtain, activity notes, bulk edit, anonymise, task fields from search sets. [Planning tools](planning-tools.md)
- Import of P6 XER / XML with calendars, resources and recomputed float. [Imported programmes](imported-programmes.md)

## Scenarios

- Re-sequence a concrete pour model and **generate its programme** (activities, links, durations, crews, dates). [Scenarios](scenarios.md), [Scheduling logic](scheduling-logic.md)
- Model check showing whether the generator can build a programme from the model.
- Pour order table (drag, group, columns / filters / sort / colour), manual **links**, **crew** overrides.
- **Update 4D** straight into the 4D view, with **auto-update**.
- Import **steps** from CSV / Navisworks TimeLiner, **record picks** in 3D.
- Scenarios kept in the project database, per building.

## 4D Sequencing

- **Link groups** between tasks and objects, **appearance profiles** (install / remove / maintain, colours, growth animation). [4D Sequencing](4d-sequencing.md)
- **Timeline** in the status bar: play, step, scrub, jump to date, planned or actual.
- Colour modes, **split view** (planned vs actual, or two projects), search sets, date **label**, **tags**, **Tasks** panel.
- **Export** images or MP4 video over a date range.
- Scenarios beside the 3D model.

## Timelines

- Timeline view of the project's programmes (see the page in the app).

## Across the app

- Side pane with tabs, resizable and hideable. [Across the app](across-the-app.md)
- **Settings**: export / import the whole configuration, full screen on start, accent colour palettes, colour-blind safe palette, 4D timeline options.
- **Duplicate in a new tab** with the same models and programmes.
- Status bar with the programme, model and database chip (click to reload from the database).
- This **wiki**, with paste / drop of images and mp4 videos while editing.
