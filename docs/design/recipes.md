# Design: from rules to recipes

Status: proposal, 2026-10-13. Nothing here is built.

## Why

ALICE Technologies builds a programme from **recipes**: a named task graph for one kind of work (for example "Concrete Slabs (Typical)": Set Up Forms, Install Rebar, Pour Concrete, Cure, Strip Forms), assigned to groups of model elements. Our Scenarios generator already builds a programme from model objects, but the knowledge sits in many separate tables. A planner cannot open one thing and say "this is how we build a slab".

## What we have today (src/prs/rules.ts, scenario-engine/core/rules.py)

| Recipe idea | Today | Where |
| --- | --- | --- |
| Which elements it applies to | **Groups**: filter rows on fields or model properties, joined by And / Or | `RuleGroup` |
| The tasks, in order | **Chains**: rows of group, order, phase, id suffix, label | `ChainRow` |
| Overlap with an earlier task | `follows` such as `Rebar@80`, plus `finishAfter` | `ChainRow.follows` |
| Duration | **Rate** (fixed days, productivity, rebar density) linked by **Assignment** | `RateRow`, `Assignment` |
| Crew | **Crew template** (trades and sizes) linked by Assignment | `CrewTemplate` |
| Calendar | Calendar rule, or Assignment | `CalendarRule` |
| Links between groups | Sequences, contacts, level links | `RuleSequence`, `ContactRule`, `LevelLink` |

So a chain plus its assignments is already about 70 % of a recipe. The gaps are that they are separate tables joined by group name, and that a few recipe features do not exist.

## Gaps against ALICE recipes

1. **One object, in its own file.** A recipe should be one thing you open, edit and save, not rows spread over Groups, Chains, Rates, Crews and Assignments.
2. **Task graph.** A chain is a list with `follows` text. A recipe needs explicit edges: type (FS, SS, FF, SF), lag, and a percentage on either end.
3. **Ranges.** ALICE tasks carry a duration range (8 to 24 hrs) and a crew range (1 to 3). We hold single values. Ranges only pay off once something searches over them (see "Later").
4. **Equipment.** Cranes, buckets and similar are a resource type next to labour trades. The engine has labour trades only.
5. **Recipe links.** A task that calls another recipe (a crane dismantle at the end of a Sky Bridge recipe).
6. **Boundary nodes.** "Previous Elements" and "Next Elements": where the recipe joins the work before and after it. Today this is the sequence, contact and level-gate rules.
7. **Phase.** A tag (substructure, structure, fit-out) for filtering and for the programme's WBS.

## Proposed model

A recipe is a new top-level section of `ScenarioRules`, next to the existing ones.

```ts
interface Recipe extends Row {
  name: string;
  phase?: string;
  /** Which objects it applies to: a rule group id (existing), so groups stay reusable. */
  group: string;
  priority?: number;
  tasks: RecipeTask[];
  edges: RecipeEdge[];
}
interface RecipeTask {
  id: string;                       // local to the recipe
  name: string;                     // "Set Up Forms"
  tag?: string;                     // short code, "FR"
  phase: string;                    // "Rebar", "Cure" ... same names the engine knows
  suffix?: string;                  // as ChainRow
  material?: '' | 'rebar' | 'concrete';
  labor?: { subcontractor?: string; crew: string; min: number; max: number }[];   // who (a company, or our own), the CrewTemplate id, and how many crews (min to max)
  equipment?: ResourceUse[];        // see "Resources" below
  cranes?: ResourceUse[];
  materials?: ResourceUse[];
  rate?: string;                    // existing RateRow id (the Rates tab)
  duration?: TaskDuration;
  calendar?: string;                // override
  gates?: boolean;
  recipe?: string;                  // a recipe link instead of a task
}
/** One assigned item: a type from the project's list for that category. A task can assign several (ALICE's Cranes tab: "Assign Crane" adds a row with a Type picker; "Assigned Cranes" lists them). */
interface ResourceUse { type: string; count: number; action?: 'requires' | 'consumes' | 'produces' | 'releases' }
interface TaskDuration {
  /** Hours as a formula of the number of crews, written like ALICE's "1*8" (fixed 8 hrs) or "40/crews". Fixed days stay the simple case. */
  formula?: string;
  elasticMin?: boolean; elasticMax?: boolean;   // later, for the optimiser
  continuity?: boolean;                          // the operation may not be split
  roundUpHrs?: number;                           // round up to this many hours
}
interface RecipeEdge { from: string; to: string; type?: RelType; lagHours?: number; sharePct?: number; finishAfter?: boolean }
```

Key choices:

- **Compile, do not replace.** On load, a recipe is turned into the existing rows (`chains`, `assignments`, with `when: {group}`), as `rules.py` already does for the relational form. The generator, the tests and the presets keep working, and the engine gains no second code path.
- **Groups stay.** A recipe points at a rule group, so the same group can be used by a recipe, a contact rule and a sequence.
- **Rates and crews stay named and shared.** A recipe task points at them; it does not copy them.
- **Edges replace `follows`.** `Rebar@80, Under Slab` becomes two edges, one with `sharePct: 80`. The compiler writes the text back for the engine.

## Migration of what exists

- The shipped presets (`ENGINE_RULES`, `RELATIONAL_RULES` in `src/prs/presets.ts`) already define chains per group: `C-SLAB`, `C-RAFT`, `C-LANDING`, `C-PEDESTAL-2`, `C-PRECAST`, `C-HEAVY-PRECAST`, and the default chain. Each becomes one recipe: "Slab", "Raft", "Landing", "Precast" and so on.
- A converter groups existing `chains` and their `assignments` by group into recipes. It is lossless, so old scenarios open as recipes without edits.
- `tests/test_preset_parity.py` stays the safety net: generating from the converted recipes must give the same programme as the golden fixtures.

## Build order

1. **Schema and compiler.** The `Recipe` type in `rules.ts`, `normalizeRules`, and a compile step (in TypeScript for the preview; in `core/rules.py` for the generator). Parity tests against the existing presets.
2. **Converter.** Existing chains and assignments to recipes, and back.
3. **Recipes tab.** Replace the Chains and Assignments editing with a recipe list and a recipe editor. First version is a table of tasks with an edges column; the node graph comes next.
4. **Graph editor.** Nodes and arrows like ALICE's Prepare view. The Network view and the shared rule-row components may be reusable.
5. **Equipment, cranes and materials.** Three resource categories, each a project list of types; a task assigns types and counts. Counted first, shown in the Resources view and written to P6 and the XER export; levelling later.
6. **Recipe links and boundary nodes.**
7. **Assign from the 3D view.** Pick objects, search sets or a group and assign a recipe; show recipe, level and status in the tree.

Steps 1 to 3 give the planner what they asked for. Steps 4 to 7 are where it starts to look like ALICE.

## Later (beyond recipes)

Ranges only matter with an optimiser. To get ALICE's "Targeted Optimization" and "Construction Simulation", a search would run the generator many times over the ranges and the choice of recipe, then score each run on finish date, peak labour and cost. The generator takes about a second per run, so a few hundred runs is feasible. This needs its own design.

## Resources (from ALICE's operation dialog)

An ALICE operation has six tabs: **Labor, Equipment, Cranes, Materials, Rates, Duration**, plus a name, a short tag (FR) and a calendar override. We take the same split:

- **Labor** is mostly what we have: crew templates made of trades. ALICE's Labor tab assigns a crew as **Subcontractor** ("Facade Sub"), **Type** ("Facade Crew") and a **Min to Max** number of crews (1 to 1). So a crew belongs to a company, which is how a planner reads who does the work, and the number of crews is what the Duration formula divides by. We add an optional `subcontractor` to each labour row and to the crew template list, and map it to a P6 resource group or role so it shows in the Resources view.
- **Equipment, Cranes and Materials** are three resource categories next to labour, each a named list (for example a tower crane, a concrete bucket, rebar). A task says how many of each it uses. Cranes are their own category because they are the usual bottleneck and are shared across recipes.
- **Rates** is the existing rate (productivity, fixed days, rebar density).
- **Duration** is a formula of the number of crews, with "Elastic min / max", "Operation continuity" and "Round up to nearest N hrs" switches. ALICE's example is `1*8` = 8 hours. The simple fixed-days case stays a plain number; the formula and the elastic switches are for the optimiser later.

**Materials** differ from the others in two ways, seen on ALICE's Materials tab: each row has a **Type** ("Slab Formwork Sets"), an **Action** ("Requires"; we expect also consume, produce, release, for reusable formwork that is released when stripped) and a **Qty Required**. The tab also shows the **element parameters** of the selected objects with their range across them (`el.lateral_surface_area` 141 to 2317 ft², `el.num_elements` 1 to 22). So a quantity or a duration can be written from the objects' own measurements, and the editor shows the range the objects actually have.

The types of each category (for example crane types "Tower crane TC1", "Mobile 50t") are defined once per project, in a Resources list, and each task picks from it with an "Assign" button and a Type dropdown per row, as ALICE does. That answers the pool question: a type is shared across the programme, with a count available, not declared per recipe.

Equipment, cranes and materials start as counted only (shown on the task and in the Resources view). Levelling them against a capacity, as labour trades are, comes after recipes work.

## Decisions (2026-10-14)

- **Own file.** Recipes live in their own file, not inside rule presets. Format: JSON beside the project, with a `version` like the rules file. Needs: load, save as, merge by recipe id, and export for sharing. See "Two streams" below for how a scenario uses it.
- **Groups and recipes.** A group may have several recipes, ranked by priority as chains are today, but the editor treats one recipe per group as the normal case and warns when a group has more than one.
- **Old tabs.** Chains and Assignments stay until recipes are operational and the parity tests pass on the shipped presets; then they are removed. Until then a recipe compiles into them, so they show what a recipe produced.

- **Pool size per scenario.** How many of each equipment, crane and material type exist is set in the scenario, so two scenarios can test two crane fleets. The list of types is shared by the project; the counts belong to the scenario.
- **Formulas.** Duration and material quantities are formulas that can use `crews` and the objects' parameters, such as `area/25/crews`. The parameter names follow ALICE's three groups, seen on its Materials tab:
  - **Element parameters** (`el.*`): `el.volume`, `el.surface_area`, `el.lateral_surface_area`, `el.num_elements`. Each is shown with the range across the objects the recipe applies to (for example volume 319 to 1512). We add the generator's own as well: rebar tonnes, level number.
  - **Custom parameters** (`el.$.<name>`): any model property, picked by property set and name as the productivity rate already does.
  - **Resource parameters**: the counts and sizes of the task's own resources (crews, cranes).
  A productivity rate becomes a formula with a name, so existing rates convert.
- **Materials.** In the first version a material is attached to a task as "requires" (held for the task's duration, quantity from a formula). Consume, produce and release wait for later.
- **Built so far (steps 1 to 5).** Step 5: a scenario has pools (`rules.resourcePools`: kind equipment / crane / material, id, name, quantity, the scenario's own like its recipes), and a recipe task names the types it uses (`equipment`, `cranes`, `materials`, each `{type, count}`). Each pool is a P6 resource (equipment and cranes Nonlabor, materials Material) whose max units is its quantity, and each task that uses one gets a resource assignment (units = count x its days, units per time = count). The Resources view has an Equipment tab for them: one chart per resource (peak in use per period) with its pool as the capacity line, and a count of the resources over their pool (the programme gives each pool's count as its max units, which the parsers now read for equipment and counted materials). **Recipe links** (step 6): a task can call a task of another recipe (`links`: recipe, phase, is followed by / follows, type, lag, scope same level / building / anywhere). The generator ties that task of the objects of one recipe's group to the other's, in the same scope (`core/rule_logic.build_recipe_links`), and the graph shows each as a green node under the task. The Incoming and Outgoing tags of ALICE are these links: there is no separate tag. **Maximize resource availability** is a scenario setting (`settings.maximizeResources`) with a button in the Resources section: the generator then writes every pool and labour trade with no limit, and the counts stay in the scenario for when it is switched off. Step 4 is the graph view of a recipe (Table / Graph toggle on each recipe card): a box per task, arrows with FS or the share done, dashed arrows for the default link, Previous and Next elements at the ends, drag to place, Connect Task, Auto Layout, Create Task. Task positions (`x`, `y`) are saved in the recipe and ignored by the generator. A scenario keeps its recipes in its rules object (`rules.recipes`), like its joined objects: they are saved, copied, autosaved and counted for "Update 4D needed" with the rest of the scenario with no new plumbing, and a preset neither brings nor removes them. The recipes file is the exchange format: Export file and Import file in Rules > Recipes. A project-level library of recipes files that a scenario points at is not built; it is the next step if the export and import is not enough.
- **Two streams.** A scenario is made of two separate streams, each its own file: the **sequence** (the order the pours are built in, as the Scenarios table holds it today) and the **recipes** (how each kind of object is built). A scenario names one of each, so the same sequence can be run with different recipe files, and the same recipe file with different sequences. Export and import work on a whole file or on picked recipes.

- **Metric units.** Parameters are in metric (m, m², m³), as the model carries them; the formula editor shows the unit beside each parameter. ALICE's ft² and ft³ are not used.
- **No override in a scenario.** Because the recipes are their own stream, a scenario does not override a single recipe: to test a different duration, copy the recipes file (or one recipe) and pick it. A recipe's result then depends on one place only.

- **Pool sizes in the scenario.** A small block in the scenario holds the count of each equipment, crane and material type, so one recipes file serves scenarios with different fleets.
- **Sequence stream unchanged.** The sequence keeps its present form; the scenario only gains a pointer to a recipes file.

## From ALICE's scenario and recipe screens (2026-10-14)

Five more screens, taken as reference. Costs ($/crew/hr, $/hr, the cost axis) are left out as agreed.

**Create New Scenario** (name, description, optimisation objectives, then tabs Crews, Equipment, Materials, Rates, Milestones):
- *Crews tab:* a row per crew with **Max units / time** (the pool, "Max." = unlimited), a **calendar** (default "Use task calendar") and a **Workforce limit** for the whole scenario. Our scenario block takes the same: the pool per crew type, a calendar override per crew type, the workforce limit.
- *Equipment tab:* a row per equipment type with a **Quantity** (fractions allowed, 1.2). Same as the pool counts we agreed.
- *Maximize resource availability:* one button that sets every pool to its maximum, to see the shortest programme the logic allows. Cheap to build and useful for the Bidding phase ("what is the fastest this can be built if resources are not the limit?"). Add it.
- *Rates tab:* a scenario can change the productivity rates. That is an override, which we decided against inside a scenario; the answer stays the same (pick another recipes file).
- *Milestones tab and the "Milestone completion time is optimised for ..." objective:* a target date for a milestone is an input of a scenario. Later, with the optimiser.
- *Run scenario and Max run time (minutes):* a run is a search with a time limit. Ours takes about a second, so no limit is needed yet.
- *Scenario names read as questions* ("What if we add another concrete pump?"), with a one-line description of what changed. Good habit; the scenario list already has names and a note.

**Scenarios list and chart:** each scenario shows its objectives and a **range of results** (788 to 929 workdays; 1,102 to 1,299 calendar days), because ALICE returns several solutions per scenario. The chart plots one dot per solution. Ours returns one result per run until the optimiser exists; the comparison chart plots finish date against peak labour (or crane use) for the scenarios.

**Recipe editor:** the editor has a **Notes** field, a category ("Construction"), **Incoming and Outgoing** tags (the "Previous Elements" and "Next Elements" nodes), and the buttons **Connect Task**, **Auto Layout** and **Create Task**. Tasks show their crew range, equipment counts and duration range on the node. A **FaS** link (finish at start of the next: a warning triangle marks it) joins Pour Concrete to Cure. We have FS, SS, FF, SF for links; FaS is not one of them. For the first graph editor: Notes on the recipe, Auto Layout, and a warning on a link that cannot hold.

**Analyze:** a Gantt grouped by WBS and export to P6 XML, P6 XER, MS Project XML, CSV, PDF and a **Comparison report (.csv)**. We already read and write most of these. The comparison report (what changed between two solutions) is the one to match; the programme comparison we have covers part of it.

## Where recipes sit in the project phases

ALICE presents five phases: Development, Planning, Bidding, Scheduling, Execution. The goal is for Insight Plan to be strong in all five. Recipes are the base for the first four; the fifth is mostly what the app already does with programmes.

| Phase | What the planner needs | Insight Plan today | What recipes add |
| --- | --- | --- | --- |
| 1 Development | Explore major activities and milestones; see the effect of design on schedule and cost | Generate a programme from a model; model-driven 4D | Quick programme from a model with default recipes; compare design options by swapping the model, same recipes |
| 2 Planning | Validate durations; find the labour, equipment and material needed; buy out trades | Resource loading, resource levelling, crews | Resource demand per trade, subcontractor, crane and material per period from the recipes; subcontractor on each crew is the buy-out view |
| 3 Bidding | Analyse and optimise basic sequences; submit the fastest or best-value schedule | Scenarios, what-if, schedule comparison | Compare scenarios (different sequence or recipes) on finish date, peak labour and crane use; later the optimiser over ranges |
| 4 Scheduling | Refine the plan; inform procurement; find the best strategy; forecast and mitigate risk | Quality checks, planning tools, Monte Carlo risk, P6 export | Material and equipment quantities from the model for procurement; levelling against the pools; recipes as the standard method statements. Risk analysis is not a goal for now |
| 5 Execution | Track progress; recover schedules; respond to change | Programme comparison, baseline vs current, 4D planned vs actual, Lookahead, PPC | Re-generate after a design change with the same recipes and compare with the baseline; recovery by changing recipes or crews |

Gaps to plan for, in order of value: scenario comparison on finish date and peak resources (phase 3); resource and material take-off from recipes (phases 2 and 4); recovery runs in execution (phase 5). **Cost is out of scope**: no resource, recipe or scenario carries a cost, and ALICE's cost axis and $/crew/hr column are not copied. Where ALICE plots time against cost, we plot time against peak labour (or crane use).

## The scenario's resource block

ALICE's Explore Scenarios page shows what the scenario holds: tabs for Labor, Equipment, Materials, Rates, Milestones and Info, a **Workforce limit**, and per subcontractor a table of crews with **# Available** and **# persons per crew**. That is the pool block we agreed on, so it holds, per scenario:

- per subcontractor, per crew type: the number of crews available and the people in a crew;
- the count of each equipment, crane and material type;
- an optional workforce limit (people on site at once).

A recipe task asks for crews (min to max); the generator takes them from this pool and delays the task when none is free. That is resource levelling inside the generator, not after it, and is the step that makes the Bidding comparison meaningful. It is a bigger change than the first version needs, so the first version counts the demand and reports where it exceeds the pool; waiting for a free crew comes after.

## Open questions

- Does the generator wait for a free crew in version 1, or only report where demand exceeds the pool? Proposal: report only.
