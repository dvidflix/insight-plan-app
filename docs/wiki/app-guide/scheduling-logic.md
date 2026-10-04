<!-- order: 8 -->
<!-- group: Scheduling -->
# Scheduling logic

This section explains how the app builds and dates schedules. There are two sources:

- **Generated schedules**: the Scenarios tab runs `scenario-engine/` (Python). It turns the pours in a concrete IFC model into P6 activities, links them, and dates them.
- **Imported programmes**: P6 `.xer` / `.xml` files loaded in Inputs. Their activities and links are taken as they are. The app only recalculates dates when the file has no float values.

Durations and switches live in `scenario-engine/config.py`. The rules below describe what the code does today. File references point to where each rule lives.

## Generated schedules (Scenarios)

The Scenarios tab runs the generator in its `schedule` stage (`main.py --stage schedule`). That stage reuses the enriched IFC and cached clash results from an earlier `prepare` run. It never renumbers pours and never rewrites the IFC. It reads the scenario's `<model>_Overrides.xlsx`, then writes P6 XML and an Excel report.

### 1. Pours are read from the model

`main.py › build_pour_records`

Every element with a `CWA Pour` property set becomes a **pour record**. Everything below is read from that one set (`POUR_PSET`); text values are trimmed (exports can leave a stray carriage return). The CWA Codes strings are rebuilt from it: *General Level 3* = `<Unit><Building>/<Level>/<Building Zone>/<General Pour Type>`, *Full Pour ID* = `<Unit><Building>/<the alternative pour ID>`.

| Field   | Where it comes from |
| ---   | ---  |
| Level | `Level`. The number in it gives the level code: `L1`, `L2`, … Level 0, negative or missing gives `L0`. |
| Pour type | `Pour Type`, else `General Pour Type` (upper-cased). Types outside the supported list (Airduct, Beam, Boss, Column, Corbel, Grout, Gullies, Heavy Precast, Landing, Main Slab, Parapet, Pedestal, Plinth, Raft, Removable Element, Screed, Slab, Stair, Upstand, Wall) are still processed, with a warning. |
| Stage | `Concrete Stage`: `1`, `2` or `PRECAST`. |
| External? | `Is External?` / `IsExternal` equal to Yes / Y / True / 1 / Ext / External. |
| Double height | Walls only: `Max Elevation − Min Elevation` > 6 m. |
| Building | `BUILDING_NAME_MAP` in `config.py` when the source file and its original IfcBuilding name are listed there. Otherwise `Unit` + `Building` (e.g. `1` + `HDAB` gives `1HDAB`). |
| Zone | `Building Zone` / `Zone`. Containing "DISCONNECTED" makes the pour *Disconnected*; otherwise containing "CONNECTED" makes it *Connected*. |
| Elevations | `Min Elevation` / `Max Elevation` and the element's placement Z. These are used by the vertical rules below. |

**Which pours are scheduled:** a pour gets activities only if its volume (`Pour Volume m3`) is at least **0.25 m³** and its type is not Boss, Screed, Grout or Special (`EXCLUDED_POUR_TYPES`).

### 2. Pour IDs

`main.py › assign_planning_proposed_pour_ids`

The Scenarios run keeps the existing IDs. For each pour it uses the first value found in this order:
1. the Overrides workbook's `PlanningProposedPourID_Override`;
2. CWA Pour's `Pour ID Number`, as four digits (`21` → `0021`; IDs that aren't plain numbers, like `768J`, are kept as they are).

Pours with neither get the next free numbers after the building's highest (`_number_missing_pour_ids`), in logic-group and GlobalId order, so a pour keeps its number when the scenario order changes. The model check lists them.

When the `prepare` stage generates new IDs (`GENERATE_NEW_POUR_IDS`), it works as follows:
- Pours are sorted into the build order described below and numbered 1, 2, 3… as four digits (`0001`).
- IDs fixed in the Overrides workbook are kept and skipped.
- Between logic groups (building + level + zone + pour type), the numbering leaves a gap for pours added later: **65 %** of the group's size for wall groups, **45 %** for the rest.

**Build order ("Option 3").** This order is used for numbering and for the order activities are listed in.
- **First:** pours whose type is not in the list below (raft, heavy precast, removable elements, stairs, double-height walls…). They follow the fixed ranking table in `main.py › OPTION3_ORDER_TABLE`, which is keyed by stage, general type, type, zone and external. Then by level.
- **Then:** these types, in this order: External Wall, Internal Wall, Slab, Landing, Column, Beam, Parapet, Pedestal, Gullies, Screed, Upstand, Airduct, Boss, Corbel, Grout, Plinth.
- **Within a type:** by level, then zone (Disconnected, then Connected-HK, Connected-HL, Connected), then stage (1, then 2, then precast).
- **Last tie-breaker:** the manual order in the `PourIDOrder` sheet.

Double-height walls land in the first bucket because their logic group reads "Double Height External Wall", which isn't in the type list.

### 3. Activities per pour

`core/activity_generator.py`

Each pour becomes a chain of activities. Durations are in **working days**, looked up in `config.py › DURATIONS` by duration key:

| Duration key | Rebar | Embedments | Formwork | Concrete |
| --- | --- | --- | --- | --- |
| Standard External Wall | 7 | 2 | 3 | 1 |
| Double Height External Wall | 12 | 4 | 5 | 1 |
| Standard Internal Wall | 4 | 6 | 3 | 1 |
| Double Height Internal Wall | 9 | 8 | 3 | 1 |
| Standard Internal Slab (Slab, Main Slab, Raft, Pit, Pits & Raft) | 18 | 18 | 2 | 1 |
| Other (all other types) | 5 | 2 | 4 | 1 |

| Pour | Activities, in order (ID suffix) | Durations |
| --- | --- | --- |
| Walls and other in-situ types | Rebar (`-R`) → Formwork, named "EP+FWK" (`-F`) → Concrete (`-C`) | Rebar; Embedments + Formwork; Concrete |
| Slab / Main Slab (anything whose type contains SLAB, PIT, FLOOR…) | Decking (`-DK`) → Under Slab (`-D`) → Rebar (`-R`) → EOP on Slab (`-E2`) → FWK (`-F`) → Concrete (`-C`) | **1 day each**, except Rebar and Concrete from the table. Decking, Under Slab, EOP on Slab and FWK have no entry in `PHASE_DEFINITIONS`, so they fall back to 1 day. |
| Raft (stage 1) | Rebar (`-R`) → EOP on Slab (`-E2`) → FWK (`-F`) → Concrete (`-C`) | same as slabs |
| Raft, stage 2 | *no activities* | |
| Pedestal, stage 2 | one combined "Rebar, Formwork and Concrete" (`-RFC`) | sum of all four columns (min 1) |
| Precast: Removable Element, Stair, precast Slab | Installation (`-I`) → Stitching (`-S`) | 1, 2 |
| Heavy Precast | Propping (`-PR`) → Installation (`-I`) → Stitching (`-S`) → Curing (`-CU`) → Propping Removal (`-RP`) | 1, 1, 2, **28 calendar days** (7-day calendar), 1 |

"Works before slab" (`-ALL`) is off by default (`ENABLE_WORKS_BEFORE_SLAB`).

- **Activity ID:** `PRJ-{unit}{building}-{level}[-D|-C]-{type code}-{pour ID}{suffix}`, e.g. `PRJ-1HDAB-L1-D-EW-0042-R`, as set out in the [Activity ID structure](../standards/activity-id-structure.md) standard. Unit 9 (site-wide buildings) is left out (`PRJ-HVD-…`). The type codes are EW / IW for walls, S slab and main slab, R raft, HP heavy precast, RE removable element, ST stair, C column, B beam, and so on ([Pour type codes](../standards/activity-id-structure.md#pour-type-codes)). `-D` / `-C` marks a Disconnected / Connected zone.
- **Activity name:** `{building} - {LEVEL} - [Disconnected - |Connected - ]{logic group} {pour ID} - {phase}`.
- The `Overrides` sheet can replace an activity's ID or name per pour GUID and phase (`TaskID_Override`, `TaskName_Override`).

What else is written onto each activity (`core/xml_builder.py › write_activities_and_relationships`):
- **Duration:** days × 8 hours.
- **Calendar:** calendar 1, Mon–Fri 09:00–17:00. Curing uses calendar 2, all 7 days. Calendar 1 is named "CWA 6d Calendar", but it is a 5-day week.
- **Activity codes:** CWA-Unit, CWA-Building, CWA-Level.
- **UDFs:** FullPourID, CWA-Element ID (the pour ID), CWA-Unit and Building, CWA-Unit, CWA-Building, the alternative pour ID.
- **CWA-Quantity UDF:** the pour volume on Concrete activities, and the rebar tonnes on Rebar activities.
- **Materials:** Concrete activities get `PRJ-C` (Concrete, m³) with the pour volume. Rebar activities, and a stage-2 pedestal's combined activity, get `PRJ-R` (Rebar, t): **pour volume × `REBAR_TONNES_PER_M3`** for its pour type (default 0.25 t/m³, i.e. rebar = 25 % of the concrete volume in tonnes).
- **Labour** (`core/resources.py`): every activity gets a crew for each trade its phase needs, from `CREW_TABLE`. A `"<phase>|<POUR_TYPE>"` row wins over the plain phase row.
  - Each trade is a Labor resource `PRJ-L-<code>`, from `LABOUR_TRADES`: steel fixers, carpenters / formwork, concrete gang, general operatives, embedments fixers, precast erection crew.
  - The assignment's units / time is the crew size, and its planned units are the man-hours (crew × duration × 8 h).
  - The trade's max units / time is its site capacity in people. The app uses it as the levelling limit.
  - Curing has no labour.
  - **The default crew sizes and capacities are placeholders**: set them in `config.py`, or per scenario in the Scenarios **Crews** tab (`ip_scenario_crew`: phase, pour type (optional), trade, crew — the legacy Overrides workbook's `Crews` sheet). Rows for a phase / pour type replace that entry's crews.

**WBS** (`xml_builder › _build_xml_wbs_manager_for_activities`):

```
<prefix> - Construction
└─ [<prefix> - Connected Zone / Disconnected Zone]     only when a building has both zones
   └─ <prefix> - Level N
      ├─ … - External Walls / Internal Walls
      │    └─ … - Rebar / Formwork / Concrete           each wall activity sits in its phase's folder
      ├─ … - Slabs
      │    └─ … - Slab <pour ID>                        one folder per slab
      └─ … - <Type>s                                    e.g. Columns, Heavy Precasts
```

## Relationships in generated schedules

Links come from five sources and are written in **priority order**. Each time a link is about to be written, it is checked against every link already written. It is **dropped if it would close a loop**, so when two sources contradict each other, the lower-priority one gives way. Duplicate links (same predecessor, successor and type) are written once. The generator's log lists every dropped link and its source.

| Priority | Source | Type |
| --- | --- | --- |
| 1 (highest) | **Relations** sheet (manual links) | as stated |
| 2 | **SequenceOrder** sheet (the Scenarios table) | SS inside a group, FS between groups |
| 3 | **Within one pour** (its own activity chain) | FS |
| 4 | **Automatic**, in this order: slab support (from clashes), level gate, Heavy Precast ↔ wall | FS |

All generated links have zero lag. Only Relations links can carry a lag.

### Relations sheet (manual links)

Edited in the Scenarios **Links** tab and kept in `ip_scenario_link` (the legacy Overrides workbook's `Relations` sheet). Columns: `ActivityID1` (predecessor), `ActivityID2` (successor), `Relation` (FS / SS / FF / SF, default FS), `Lag`.

- An activity named as a successor here **loses every generated link into it**. Only the links in the sheet are kept for it.
- `Lag` is in **working hours**: 8 = one day. It's written to P6 as-is, and P6 XML stores lag in hours.
- These links are written last, but they still pass the loop check.

### SequenceOrder sheet (the Scenarios table)

`xml_builder › _build_sequence_order_relationships`

Rows are sorted by `Index`; rows without an Index are left out of the sequence.

- **Rows sharing an Index form a group that starts together.** The group's first row is linked Start-to-Start to every other row in the group.
- **Each new Index waits for the previous one.** A Finish-to-Start link runs from the previous group's first row to this group's first row. Only the first rows are linked across groups; the rest of each group is not.
- Each row names a pour (GUID) and optionally a `Phase`. If the phase is blank, the pour's first working activity is used: Decking for slabs, the combined activity for stage-2 pedestals, Installation for precast and stairs, Rebar otherwise.
- This sheet never checks levels. That is deliberate, so a planner can sequence, say, external walls up to level N before inner structures below.

### Within one pour

`xml_builder › _build_intra_pour_predecessors`

Each pour's activities are chained Finish-to-Start in the order shown in the activities table. Pours are matched by building + pour ID. Missing activities are skipped, so the chain closes over the gap.

### Automatic links from geometry

The automatic rules use **pour-to-pour clashes**. `core/clash_detection.py` runs ifcclash in clearance mode at **5 mm** (`CLEARANCE_MM`). It tests every pour that has a `Pour ID Number` against every other and keeps each touching pair once. The results are cached in `<model>.geometry_cache.json` until the source IFC changes (its modified time or size).

In every automatic rule:
- **Only pours in the same building are linked.**
- **"Finish" of a pour** is its Concrete, else its combined activity, else Stitching, else Installation.
- **"Start" of a pour** is:
  - for precast and stairs: Propping, else Installation, else Stitching;
  - for slabs: Decking, else Under Slab, else Works before slab, else Concrete;
  - otherwise: Rebar, else Formwork, else Concrete.

**Slab support** (`_build_slab_support_predecessors_from_clashes`). For each clashing pair:
1. **Removable elements go last.** If exactly one of the pair is a removable element, the other pour must finish before it starts.
2. **Lower before upper.** This applies when neither pour is Heavy Precast. A is *below* B if A's top is at least 5 cm under B's bottom. Without elevations, A is below B if A's centre is at least 25 cm lower. The link is only made when:
   - the two pours are on the same level or the next level up (never skipping a level, never downwards);
   - their centres are no more than 7.5 m apart vertically.

   Then the lower pour finishes before the upper one starts.
3. **Slabs wait for what holds them up.** If one pour is a Slab / Main Slab and the other is underneath it, the other pour finishes before the slab starts. "Underneath" means any of:
   - its centre is more than 0.5 m lower;
   - its top is more than 10 cm below the slab's bottom;
   - it is a supporting type (wall, column, beam, pedestal, raft, landing, heavy precast) and the gap is between −30 cm and +10 cm.

Two exclusions apply to all three:
- A **stage-2 pedestal** is never used as the lower pour. Stage-2 box-outs are sequenced separately and would otherwise delay everything above them.
- A **Heavy Precast** pour never drives these links, except towards a removable element.

**Level gate** (`_build_level_gate_predecessors`). Per building, each level waits for the level below it: the next lower level that has pours.
- **Waiting:** only the upper level's **slabs** (`LEVEL_GATE_SLABS_ONLY`), at their start: Decking, else Under Slab, else Rebar. Walls, columns and so on follow their own slab through the slab-support links instead.
- **Waited on:** the lower level's **Concrete** activities (`LEVEL_GATE_DECKING_CONCRETE_ONLY`). Stage-2 pours are left out.
- Every such slab is linked to every such Concrete activity, all Finish-to-Start.

**Heavy Precast ↔ supporting walls** (`_build_heavy_precast_wall_predecessors_from_clashes`). This applies to a clashing pair of a Heavy Precast pour and a wall **below** it. "Below" is decided by `core/clash_position.py`:
- The two elevation ranges are compared.
- No overlap: *Definitely* below or above.
- An overlap of at least 50 % of the shorter pour's height: *Side* (`CLASH_POSITION_SIDE_OVERLAP_THRESHOLD`).
- Otherwise: *Majority* below or above, by which centre is lower.

Only *Definitely* or *Majority Below* walls count.

| Wall | Links (all Finish-to-Start) |
| --- | --- |
| Stage 1 | wall Rebar (or Formwork) → precast **Installation** · precast **Stitching** → wall Concrete · wall Concrete → precast **Curing** (so Propping Removal waits for the wall to cure 28 days) |
| Stage 2 (box-outs) | precast **Propping Removal** → wall Rebar: the wall can't start while the props are in the way |

Curing also keeps its link from the precast's own Stitching. That link is a fallback for when no supporting wall is found.

Off by default: GET / GIVE group milestones and a Building Completion milestone (`ENABLE_GROUP_MILESTONES`, `ENABLE_BUILDING_COMPLETION`).

## Dates: the generator's CPM

`core/cpm_apply.py`, `core/cpm_schedule.py`

After the links are written, the generator dates every activity itself, so the XML arrives with final dates.

- **Forward pass** from the data date. The data date is the Scenarios tab's *Start date* (`CWA_START_DATE`), or today if none is set. Activities are processed in dependency order. Each one starts at the latest of the data date and what each predecessor allows:

  | Link | Successor's earliest start |
  | --- | --- |
  | FS | predecessor's finish + lag |
  | SS | predecessor's start + lag |
  | FF | predecessor's finish + lag, minus the successor's duration |
  | SF | predecessor's start + lag, minus the successor's duration |

  All arithmetic is in working hours on the activity's calendar. A time that lands outside working hours moves to the next working instant.
- **Backward pass** from the latest finish. **Total float** is the working hours between early and late start. An activity is **critical** when its float is ≤ 0.
- **Not modelled:** resource levelling and constraints (must-start-on and similar). Each calendar has one working window per weekday and no holidays.
- **Loops:** if the links still contain a loop, the activities caught in it are anchored at the data date, and the run reports it.
- **Fixed times on screen:** after the calculation, activities whose ID ends in `-R` (Rebar) show 08:00–12:00 on their computed dates. Activities ending in `-C` (Concrete) are shown as a single day, 13:00–17:00, on their start date. This only changes the displayed times; the dates come from the calculation.
