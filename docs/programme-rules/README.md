# Programme Rules Specification (PRS)

A file that tells the generator **what a programme is made of for a given project**, so nothing about the project is written into code. It is shaped like a buildingSMART IDS file: *applicability* picks the model elements a rule is about, and the rule says what to do with them.

- **Status:** draft 2, for review (groups, level tasks, sequences; levels from the model property). Nothing reads this format yet.
- **Worked example:** [cwa-concrete-pours.prs.xml](cwa-concrete-pours.prs.xml) reproduces what the Python generator does today for a concrete-pour model (every duration, crew, code and link rule). Read the two side by side.
- **First importable file:** [cwa-engine-defaults.prs.xml](cwa-engine-defaults.prs.xml) is today's engine logic (settings, durations, rebar, crews, groups) in the format the Rules panel imports; importing it changes nothing in the output.
- **Engine:** the existing `scenario-engine` (Python), changed to read this file instead of `config.py` and the constants in `main.py`, `core/activity_generator.py` and `core/xml_builder.py`.

## Why a new format

| Today | With a PRS |
| --- | --- |
| Durations, crews, codes and link rules are Python constants | They are data, in one reviewed file per project or client |
| What a level, a type or a pour is: code in `main.py` | Declared, with the model property it is read from |
| Rates live in three places (`config.py`, SeaTable `rates.json`, Excel overrides) | One `rates` section, with an import hook for the SeaTable base |
| "Why does this activity have 7 days?" means reading code | The run records the rule that produced every activity, link and duration |
| A new project needs a code change | A new project is a new file |

## How a file reads

```
prs
├─ info                      who, what, version
├─ calendars                 working patterns
├─ derive                    values read from each element (building, level, type fields, volume...)
├─ maps                      lookup tables used by derive (e.g. original building names to final ones)
├─ levels                    what a level is, how levels are ordered, which are next to which
├─ types                     what a type is: applicability, code, family, which duration row it uses
├─ scope                     which elements get activities at all
├─ quantities                named numbers per pour (concrete m3, rebar t, formwork m2)
├─ rates                     durations and productivities, per type, level and building
├─ resources                 materials, trades, crew sizes
├─ activities                the chain each pour becomes: names, IDs, durations, crews, codes
├─ numbering                 pour numbers and the build order
├─ logic                     relationships, in priority order
├─ ruleGroups                named selections of pours (per building / level), used by name; separate from the 4D Link Groups
├─ levelTasks                the Walls and Slabs task of each level, dated from their group
├─ sequences                 groups put in order; the engine writes the links
├─ wbs                       the work breakdown structure
├─ schedule                  how dates are calculated
├─ checks                    what the model must carry
└─ tables                    plain tables referenced by name (the build-order ranking)
```

### Selecting elements (facets)

Applicability uses the IDS facets, so anyone who writes IDS can read it: `entity`, `attribute`, `property`, `classification`, `material`, `partOf`. Values are `simpleValue` or an `xs:restriction` (`enumeration`, `pattern`, `minInclusive` and so on). Three additions:

| Facet | Use |
| --- | --- |
| `derived name="x"` | Tests a value from the `derive` section (so a rule says `level` once, whatever property it came from) |
| `type ref="ID"` or `type family="wall slab"` | Tests the type an element was given in the `types` section |
| `level from="L0" to="L2"` | Tests the level, by order |

A rule with an empty `applicability` applies to everything.

### Expressions

Wherever a value is calculated (`expr`, `value=`, durations), the language is deliberately small and has no side effects.

- Numbers, text in single quotes, `true` / `false`, `and` `or` `not`, `+ - * / %`, `== != < <= > >=`.
- Derived values and quantities by their id: `volume`, `level`, `isDoubleHeight`.
- Functions: `if(c, a, b)`, `min`, `max`, `round`, `ceil(x, n)`, `floor`, `upper`, `lower`, `concat`, `pad(n, digits)`, `rate('table', 'field')`, `days(x)`.
- Units are checked: `m3`, `m2`, `t`, `Mh` (man-hours), `h`, `d`. A rate in `Mh/t` times a quantity in `t` is `Mh`; dividing by a crew's hours per day gives days. A mismatch is an error when the file is checked, not a wrong number later.

## The sections in detail

### Levels: what constitutes a level

A level is a **value**, not a model object. `derive` reads it from the first source that gives one:

**For now a level is read from the model property only** (here `CWA Pour / Level`), with a pattern to take the number out of text such as "Level 03". The storey an element sits in (`IfcBuildingStorey`) and elevation bands are possible later fallbacks, left commented in the example.

`levels` then says how levels relate: the order (by the number), and whether *next* and *previous* skip levels that have no pours. The rules that talk about "the level below" (the level gate, slab support) use that and nothing else. A pour that spans levels (a double-height wall) is on one level, its own; the type may flag it as `doubleHeight` so durations and links can treat it differently.

### Types: what constitutes a type

A `type` has an applicability, a `code` (the part of the activity ID), a `family` (the group the rules talk about: wall, slab, raft, precast, heavyPrecast, pedestal, insitu) and a `durationKey` that selects the duration row. The **first type that matches wins**, so specific types (external double-height wall) come before general ones (wall). Elements that match none are reported, and handled by a last catch-all type if the file has one.

Because rules refer to `ref="SLAB"` or `family="wall"` and never to a property, changing how a type is recognised (say, from `Pour Type` to the IFC predefined type) touches one place.

### Rates: per level and type

A `table` in `rates` is a list of rows. A row has an optional `when` (the applicability, plus optional `level`, `building`) and one or more `set` values (the rate). For one pour the engine picks, per field, **the matching row with the most conditions; a tie goes to the first in the file**. So:

```xml
<row><when><type family="wall"/><level from="L0" to="L2"/></when><set name="rebar.manhoursPerTonne" value="85"/></row>
<row><when><type family="wall"/></when>                          <set name="rebar.manhoursPerTonne" value="75"/></row>
<row>                                                              <set name="rebar.manhoursPerTonne" value="75"/></row>
```

is "walls on levels 0 to 2 are slower; any other wall and anything else use 75". A file with no `when` rows at all is a flat rate. `import` rows bring in an external table (the SeaTable "Insight Plan Rates" base: wall classes with productivity, crew, rebar content), keyed by element GUID or class; they sit among the rows and follow the same precedence.

Every duration is either:

- `mode="fixed"`: days from a table row by the type's `durationKey` (what the engine does now), or `mode="days" value="n"`; or
- `mode="computed"`: a quantity × man-hours per unit ÷ (crew × shifts × hours per shift), rounded (`ceil`, `round`, none) and never below `min`. This is the SF-003 / FWK-001 calculation of the wiki, as data.

Quantities come from the model (property, `Qto_*` quantity set, or geometry) with a stated order of fallbacks.

### Activities

A `template` applies to the pours its applicability picks and lists the activities each pour becomes, in order. An activity has a `phase`, an ID `suffix`, a `name`, a `calendar`, a WBS folder, a duration, a crew reference, and optional `output` (material quantity written to a resource), `udf`, `displayTime`. The ID and name patterns are written once in `activities`.

### Logic: relationships

Links come from **sources in priority order**; a link that would close a loop is dropped and the log says which rule lost. The file lists:

1. `source` entries for data the user supplies (manual links, the scenario's sequence order);
2. `rule` entries, each with a priority, a `chain` (links inside a pour) or a `for each="pair"` over **spatial pairs**.

The spatial pairs come from a named `spatial` query (here: clash in clearance mode at 5 mm, cached until the model changes). Rules use a small set of **named spatial tests**: `below`, `underneath`, `levelStep`, `verticalDistance`, `position` (definitely / majority below, with the 50 % overlap threshold). These are the only geometry the file can ask for; they are implemented once in the engine and documented with their numbers in the file, not hidden in code.

`anchors` says which activity is a pour's *start* and *finish* for the automatic rules (the first that exists in the list), so "Concrete, else the combined activity, else Stitching" is data too.

### Extra activities and links (high-level programme, manual logic)

Some activities are not made from a pour: milestones and summary work from a high-level programme that the detailed one has to include and hang off. They are `extras` in the file:

- an `activity` has an ID, name, duration (0 is a milestone), calendar, WBS path, optional activity codes, UDFs and a constraint (for example Start No Earlier Than);
- a named `baseline` gives it the **target dates** from the high-level programme (`baselineStart`, `baselineFinish`), so the generated programme is drawn against them. The engine dates the activity from its links, and keeps the baseline as its planned dates, as it does today.

`links` are manual relationships between any two activities. An end is either an **activity ID** or a **selector** that picks generated activities by what they are:

```
select:{building=1HDAB; level=L1; type=SLAB; phase=Concrete; last}
```

The terms are the derived values, types and phases of the file (`building`, `level`, `type`, `family`, `phase`, `stage`, `zone`, any `derive` id), joined by `;`. A closing word chooses from what matches: `each` (one link per match), `first`, `last` (by the programme's build order), `all` (the set as a whole: from its latest finish, or to every start). A selector that matches nothing is a warning, not an error, so a rule written for a bigger model does not fail on a smaller one.

Links have the highest priority and may carry a type (FS, SS, FF, SF) and a lag in working hours. By default a successor named in a manual link loses its generated links (as the Links tab does today); `replaces="false"` adds the link without removing them. A link that would close a loop is dropped and reported with its `id`.

### Groups, level tasks and sequences

A **group** is a named selection of pours, written once and used by name (`rulegroup:WALLS`). The idea is the same as Link Groups, but they are **separate things**: Link Groups (4D) are saved in the app and hold the objects behind activities, while groups live only in the rules file, can be much more granular, and are never shared with or written into the 4D groups. Neither reads the other; if one set is ever wanted in the other, it is an explicit import. `for-each="building level"` makes one group per building and level from the derived values, so nothing is written per level.

- **Level tasks:** per building and level, two tasks, *Walls* and *Slabs*, each with a start and a finish. With `dates="rollup"` they start with the earliest member and finish with the latest (a hammock), so they follow the detailed pours; a fixed start or finish can draw the level against a planned date.
- **Sequences:** `step`s in order, with `repeat over="level"` stepping through the levels. The engine writes the links from the last of one group to the first of the next, at the sequence's priority.
- **Open activities:** an extra activity carries a `building` and a `level`, and `levelLinks` link it FF to the Walls and Slabs task of its own level. The level is a field, not read from the name.
- Links and sequences may use a group or a level task at either end, besides activity IDs and selectors.
- **Rates and crews apply to groups:** `<ruleGroup ref="SLABS" building="1HDAB" level="L1"/>` is a facet like `type` or `level`, so it can sit in the `when` of any rate row, duration row or crew. The group counts as one condition, plus one more for each narrowing (`building`, `level`), so the most specific row still wins and a tie goes to the first in the file. A pour that belongs to several groups takes the best match among them.

### Layers: project file and scenario overlay

One project has a main file. A scenario can add an **overlay** of the same format: only the sections it changes, and rows that replace the main file's rows by `id` or are added to them. A scenario's own links, extra activities and crews live there; everything else is inherited. The run records which file each rule came from.

### Numbering and build order

`numbering` covers the pour IDs for pours that have none: digits, gap sizes between logic groups, IDs to keep, the order. The build order is a `table` of ranked rows (type, stage, zone, external) followed by a type list and sort keys: exactly the engine's `OPTION3_ORDER_TABLE`, as data.

### Checks

`checks` lists what the model must carry. They run before anything is generated and their findings are shown (as the model check already is), with the element and the rule that needed the value.

## What the engine does with a file

1. **Read and check** the file against the schema, then check units and references (a rate that names an unknown trade is an error here).
2. **Derive** every element's values; classify types; apply scope.
3. **Group** elements into pours; number them; order them.
4. **Quantify** and look up rates; build each pour's activities.
5. **Link**, in priority order, dropping loops.
6. **Date** with the engine's forward and backward pass.
7. **Write** P6 XML, the Excel report and the **trace**.

The **trace** is the thing that makes 99 % checkable: for every activity, duration and link it records the rule id, the row that matched and the inputs. In the app it appears as "why is this here?" on any activity.

## How "99 %" is proven

Not by reading the file. By a **parity run**: the same model, once through today's generator and once through the PRS example above, compared activity by activity (ID, name, duration, crew, calendar), link by link (from, to, type, lag, source) and date by date. The rule is that the example must reproduce the current output exactly before any project-specific rule is changed; after that, every change to a rate or rule shows as a diff of the output.

## Where today's hard-coded behaviour goes

| Today | In the file |
| --- | --- |
| `config.py › DURATIONS` (removed: durations are Duration rules; with none, a phase takes 1 day) | `rates › durations` (built) |
| `config.py › REBAR_TONNES_PER_M3` (removed: Rebar rate rules; with none, no rebar quantity) | `rates › rebar` (built) |
| `config.py › PHASE_DEFINITIONS` | `activities › template` |
| `config.py › CREW_TABLE`, `LABOUR_TRADES` | `resources › crews`, `trade` (built: Crew rules, Trades; `LABOUR_TRADES` is gone from config, `CREW_TABLE` remains as the default crews) |
| `xml_builder.py` calendars ("CWA 6d", "CWA 7d Curing"), `cpm_apply.py` calendars | `calendars`, `calendarRules` (built: Calendars, Calendar rules; with none defined there is one plain Mon-Fri calendar, and Curing on 7 days is a rule: load the 1HDAB_TOC preset) |
| `config.py › RATES_FILE`, `ADJUSTMENTS_FILE` | not in the engine: the app hands them over (`INSIGHT_RATES_FILE`, `INSIGHT_ADJUSTMENTS_FILE`, set in `vite-plugins/engineFiles.ts`) |
| `config.py › REBAR_TONNES_PER_M3` | `quantities › rebarTonnes`, `rates › rebar-density` |
| `config.py › EXCLUDED_POUR_TYPES`, volume 0.25 m3 | `scope › exclude` |
| `config.py › BUILDING_NAME_MAP`, `CWA_BUILDING_CODE_ALIASES` | `derive › building`, `maps` |
| `config.py › LEVEL_*`, `USE_PADDED_LEVEL_CODES` | `derive › level`, `levels` |
| `main.py › build_pour_records` (what each field is read from) | `derive` |
| `main.py › OPTION3_ORDER_TABLE`, numbering gaps | `numbering`, `tables` |
| `activity_generator.py` (chains per type) | `activities › templates` |
| `xml_builder.py` slab support, level gate, heavy precast | `logic › rule` with named spatial tests |
| `xml_builder.py` WBS builder | `wbs` |
| `cpm_apply.py` settings | `schedule` |
| `rates_info.py` (SeaTable wall classes) | `rates › import` |
| SeaTable "Extra activities", "Baselines" (`adjustments.py`) | `extras` with `baselines` |
| SeaTable "Retired" | `scope › exclude` rows by activity ID (or an overlay) |
| The Scenarios **Links** tab (manual relations, `ip_scenario_link`) | `links`, in the scenario's overlay |
| The Scenarios **Crews** tab (crew overrides, `ip_scenario_crew`) | `resources › crews`, in the scenario's overlay |

## Not yet expressed (decisions needed)

These exist in the engine today and the draft does not cover them, or covers them only in part. Each needs a decision before the format is frozen.

| Behaviour | Question |
| --- | --- |
| Stair steps (`stair_steps.py`, 0.09 m3 limit) | Is a stair pour split into step activities, and by what rule? |
| Slab curing | **Built:** Curing is a phase of the slab and raft chains (Rules > Chains) with its days and calendar from Assignments; the `ENABLE_SLAB_CURING`, `SLAB_CURING_DAYS` and `ENABLE_WORKS_BEFORE_SLAB` settings are gone. Whether what follows waits for the Curing is still a setting |
| Open-end sequencing and completion close-out (`ENABLE_OPEN_END_SEQUENCING`, 0.3 m) | Named rules to add to `logic`, with their distances |
| Level gate distance (`LEVEL_GATE_MAX_DISTANCE_M`, 0.05 m) | The pair test that decides which slabs are "the same" |
| Building coordinates (`BUILDING_COORDINATES`, the cardinal zone) | **Removed** from the engine, the Excel report and the SQLite export; the format has nothing for it |
| `adjustments.json` (retired and extra activities) | Stay as separate user data, or move into a `modifications` section |
| Model preparation (class fixing, spatial structure, colours, pour numbering written back to the IFC) | Out of scope for the PRS: it changes the model, not the programme |
| Other disciplines (MEP, finishes, civils) | The format allows more templates and types; each needs its own worked example before it is called supported |
| Rates by room, zone or area, not only level and type | `level` and `building` are in; zones and spaces would use the same `when` |
| Resource calendars, productivity learning curves, weather | Not modelled today; add `rates` fields only when someone needs them |

## The Rules panel (built)

The panel is **one list of rules**, each row with its type (the rule types are the table below, plus Extra activity, Manual link and Crew override). Type chips and a search filter the list, **+ Add rule** starts a rule from a type, and a row opens to the editor of its type. The generator's own defaults (duration table, rebar rates, default crews) sit under "Generator defaults and tools", each with a Customise button that starts a rule from it.

The Scenarios dock's **Rules** tab edits everything below, saved with the scenario in the project database (`ip_scenario_rules`, one JSON document; the extra activities, links and crews keep their own tables) and read by the generator on every Update 4D / generate:

| Section | What it sets | Engine |
| --- | --- | --- |
| **Extra activities** | activities from a high-level programme, with baseline dates and a building / level | `core/prs_links.py` |
| **Links** | manual links, ends by ID or `select:{...}` (now also `family=` and `group=`) | `core/prs_links.py` |
| **Crews** | the legacy per-phase overrides, and **crew rules** by condition / group | `core/resources.py` |
| **Durations & rates** | days per phase by condition; durations from a quantity (productivity); rebar t/m³ | `core/rules.py`, `core/activity_generator.py` |
| **Trades** | the labour trades crews are made of: code, name, people per day on site (the engine has no trades of its own: with none, no labour resources are written; a row switched off leaves a trade out) | `core/rules.py`, `core/resources.py` |
| **Calendars** | working weeks (days, start, hours a day), added by hand or imported from a P6 XML schedule; one is the default | `core/calendars.py` |
| **Calendar rules** | which activities run on which calendar: the usual `when` (a group, a family, levels ...) and optionally one phase (Curing); the most specific rule wins | `core/calendars.py` |
| **Assignments**, **Rates**, **Crews** | the relational form of durations, productivity, rebar rates, crews and calendars. A **group** says what the objects are (all the conditions live there); a **Rate** is a named fixed duration, productivity (man-hours per unit) or rebar density, defined once; a **Crew** is a named list of trades and people; an **Assignment** is one row per group and phase that gives it a rate (or days), a crew and a calendar, with a priority (higher wins, then the earlier row). Each is a table that copies to Excel and pastes back (Add / update by key, or Replace the table). They are turned into the rows below when the rules load, so the older condition-based rows still work beside them | `core/rules.py` (`_compile_assignments`), `core/calendars.py` |
| **Settings** | the engine's switches and distances (level gate, open ends, curing, smallest pour, excluded types, stair steps, clash side threshold) | `core/rules.py` |
| **Groups** | named selections of pours, made per building / level / ... (by type, family, volume m³ with `volumeFrom` / `volumeBelow`, a type it is not with `typeNot`); separate from the 4D Link Groups. A group can be treated as `exclude` (its pours are left out of the schedule: replaces the smallest pour and excluded pour types settings) or `stairStep` (its pours are steps cast with their flight: replaces the stair step volume setting) | `core/rules.py` |
| **Level tasks** | per building and level, a level-of-effort task dated from its group (SS from the first activity of each pour, FF from the last) | `core/rule_logic.py`, `core/cpm_*.py` |
| **Sequences** | groups in order, level by level, joined by finish milestones | `core/rule_logic.py` |
| **Level links** | extras / open-ended activities / a selection tied to the level tasks (FF by default) | `core/rule_logic.py` |
| **Contact links** | links from the **clash detection results**: every object in contact below (above, beside, any) a subject precedes it; may take the place of the engine's slab-support / level-gate links | `core/rule_logic.py` |

How a `when` is read: all its terms must hold; per pour the matching row with the most terms wins, a tie goes to the earlier row. With no rows (or no rules at all) the generator does exactly what it did before: the parity run of a real model (513 activities, 585 links, every date) is identical with and without the rules code.

Priority of links: manual links, then the sequence order, the pours' own chains, **the rules' links** (sequences, contact links, level tasks, level links), then the engine's automatic links; a link that would close a loop is dropped, never one of the rules (the log says how many were not written and why).

Level tasks are `Level of Effort` activities. The engine dates them from the pours tied to them (the app's CPM does the same); in P6 the SS / FF links give the same result. Activities linked FF to a level task (extras, open ends) extend its finish.

**Export / Import** write and read all of the above as a Programme Rules file (`extras`, `links`, `resources/crews`, `trades`, `calendars`, `calendarRules`, `settings`, `rates`, `ruleGroups`, `levelTasks`, `sequences`, `contacts`, `levelLinks`); a row with the same id is replaced on import.

What it does not do yet: the rest of this format (types, levels, numbering, the build order table, WBS, checks, calendars) is not read by the engine; a link always replaces the generated links into its successor (`replaces="false"` is not honoured); the overlay is per scenario, there is no project-level main file; a selector's keys are the generator's own fields, not yet the `derive` ids of a rules file; the Rules panel shows pours per rule from the pour table (it has no external / double-height column, so those terms are not counted there, the generator does apply them).

## What would be built next

1. **The XSD** for this format, so any editor validates it and the engine rejects bad files with a line number.
2. **The reader** in Python: parse, check units and references, produce the in-memory rule set.
3. **The engine pass** that applies it, writing the trace, behind a switch so today's path keeps working.
4. **The parity harness**: run both on a model and diff the output.
5. **The app side**: a Rules page to open, edit and validate a file, choose the one a scenario uses, and the "why is this here?" view.
