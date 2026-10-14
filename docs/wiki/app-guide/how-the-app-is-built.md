<!-- order: 12 -->
<!-- group: Under the hood -->
# How the app is built

## Overview

![How features and the tech stack are organised](media/architecture-overview.svg)

## Tech stack

| Area | Technology |
| --- | --- |
| UI | **React 18** + **TypeScript 5**, plain CSS (`src/styles/global.css`, design tokens as CSS variables) |
| Build | **Vite 5** (`@vitejs/plugin-react`, `vite-plugin-static-copy` for the web-ifc WASM and Fragments worker) |
| State | **Zustand 5** stores, most persisted to `localStorage` |
| 3D / BIM | **That Open Engine**: `@thatopen/components` (worlds, fragments, IFC loader, hider, classifier, clipper, viewpoints, BCF), `@thatopen/components-front` (post-production renderer, highlighter, measurements, clip styler), `@thatopen/fragments` (Fragments format, worker), `@thatopen/ui` / `ui-obc` (a few Lit panels); **Three.js** |
| IFC | **web-ifc** (WASM) |
| Spreadsheets | **SheetJS (`xlsx`)** — XLSX export, Scenarios workbooks |
| Video | **mp4-muxer** with the browser's **WebCodecs** H.264 encoder |
| Scenarios generator | **Python 3.12** (`scenario-engine/`), run by a Vite dev-server plugin |

---

## How the app is structured

### Principles

- **One viewer, mounted once.** `ViewerWorkspace` (and the WebGL renderer inside it) stays mounted for the app's lifetime. Switching pages only toggles its visibility (it is parked off-screen at a real size, never `display: none`, so the camera keeps a valid aspect). The Models and 4D Sequencing pages share it.
- **The engine owns the 3D.** `src/viewer/ViewerEngine.ts` wraps That Open's components: loading, indexing, selection, visibility, colour/opacity overrides, measurements, sections, storey slide, placement. React components call the engine; they don't create That Open components themselves. `SecondaryView.ts` is the split's second view, with its own world and its own copy of every model.
- **Shared state in stores.** Loaded models and programmes, the selection, and every setting live in small Zustand stores (`src/state/`), so pages and tabs can come and go without losing anything.
- **One side pane, filled by the page.** `SidePaneHost` renders the pane; each page portals its tabs into it with `<SidePane>`.
- **Shared building blocks.** Column pickers, field pickers, rule rows (reorder / remove), filters, group / sort / colour panels are written once in `src/components/schedule/` and reused by the Programmes, Scenarios and Models data tables.

### Folders

```
src/
  main.tsx, App.tsx       entry; top bar, pages, keyboard shortcuts
  pages/                  SchedulePage (Programmes), SequencePage (4D), ScenariosPage
  viewer/                 3D layer
    ViewerEngine.ts         the engine (That Open wrapper) — the only place that drives the 3D
    ViewerWorkspace.tsx     toolbar row + canvas + side pane + data table; mounted once
    ViewerCanvas.tsx        viewer shell, split / compare slider, per-view settings sync
    SecondaryView.ts        the split's second view
    viewerUI.ts             the That Open Lit panels still in use (tree, properties, views, topics)
    bimTables.ts            property table / values over the element index
    searchSets.ts           search & selection set model and evaluation
    relations.ts            touching / overlapping pairs from geometry (clash runs)
    useClashRunner.ts       keeps Clashes & contacts up to date and stored in the project
    storeySlide.ts, growthAnimator.ts, flythrough.ts, realism.ts, frameCapture.ts,
    navCube.ts, northArrow.ts, ifcLayers.ts, colorPalettes.ts, …
  components/             React UI
    ViewerToolbar.tsx       the 3D toolbar
    ModelConfigPanel.tsx    Models page side pane tabs
    ModelChecksPanel.tsx, PropertyEditorPanel.tsx
                            Model checks tab; Properties › Edit properties
    SearchSetsPanel.tsx, DataTablePanel.tsx, ModelDataTable.tsx, ModelColorPanel.tsx,
    IfcTree.tsx, RelatedPanel.tsx, View3DPanel.tsx, FlythroughPanel.tsx, SettingsMenu.tsx,
    SidePane.tsx, DuplicateTab.tsx, FullScreenOnStart.tsx, icons.tsx, …
    schedule/               Programme views and the shared table / rule panels
    reports/                Programme reports
    sequence/               4D panels (link groups, appearance, label, tags, tasks, export)
    scenarios/              Scenarios table configuration
  schedule/               programme domain: parsers (XER / XML), data model, CPM & network,
                          calendars, checks, compare, columns, filters, aggregates, 4D linking,
                          appearance, label / tag templates, Navisworks export, XLSX export
  scenarios/              Scenarios client: API calls, pour order, table view
  ids/                    Model checks: IDS library (docs/ids), evaluation (evaluate.ts),
                          patches and property edits on the IFC text (patches.ts, step.ts),
                          saving a _FIXED copy and reloading it (writeBack.ts)
  wiki/                   the Wiki's pages (docs/wiki) and Markdown rendering
  state/                  Zustand stores (models, schedules, selection, view settings, colour,
                          search sets, data table, link groups, appearance, timeline, …) and
                          appConfig.ts (export / import of the whole configuration)
  utils/                  persisted state hook, CSV / download helpers, table resizing
  icons/                  SVG icons (imported raw by components/icons.tsx)
  styles/global.css       all styles
scenario-engine/          Python schedule generator for Scenarios (see its README)
vite-plugins/scenarios.ts dev-server API that runs the generator
vite-plugins/projectDbPlugin.ts, db/
                          dev-server API for the project database (SQLite, P6 tables)
vite-plugins/ids.ts       dev-server API for Model checks: saves IDS files, patches and fixed models
vite-plugins/wiki.ts, appUpdate.ts
                          dev-server API for wiki editing and app updates
docs/wiki/, docs/ids/     the Wiki's pages and the IDS library (shipped with the app)
samples/                  sample IFC models and programme
public/                   static assets
```

### How a model gets on screen

1. `InputsPage` reads the file and calls `engine.loadIfc` (or `loadFrag`).
2. The engine converts it with web-ifc to Fragments, adds it to the scene, and builds a **model index** (every element's class, name, GlobalId and flattened `Pset.Property` values, plus the spatial tree and layers) — the index behind the tree, properties, search sets, data table and colouring.
3. `modelsStore` gets the model's summary; the pages react to it. If the split view is open, `SecondaryView` copies the model.
