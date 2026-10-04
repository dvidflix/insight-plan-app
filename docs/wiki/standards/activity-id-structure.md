<!-- order: 1 -->
# Activity ID structure

Activities are generated from the 3D model: each pour becomes one activity per construction phase (rebar, formwork, concrete…). The activity ID and name are built from the pour's properties. **Double Height** is worked out from the pour's bounding box height; everything else is taken from the pour's properties.

## Activity ID

<code><span class="aid-prj">PRJ</span>-<span class="aid-bld">{Unit}{Building}</span>-<span class="aid-lvl">{Level}</span>-<span class="aid-zone">{Zone}</span>-<span class="aid-ie">{Int/Ext}</span><span class="aid-type">{Pour type}</span>-<span class="aid-num">{Pour number}</span>-<span class="aid-act">{Activity type}</span></code>

| Part | Example | From | Notes |
| --- | --- | --- | --- |
| Project | `PRJ` | fixed | |
| <span class="aid-bld">Unit + Building</span> | `HVL`, `1HN` | pour properties *Unit* and *Building* | unit 9 (site-wide buildings) is left out: `HVL`, not `9HVL` |
| <span class="aid-lvl">Level</span> | `L3` | pour property *Level* | |
| <span class="aid-zone">Zone</span> | `D`, `C` | pour property *Building Zone* | D = Disconnected, C = Connected; left out when the pour has no zone |
| <span class="aid-ie">Internal / External</span> + <span class="aid-type">Pour type</span> | `IW`, `EW`, `B` | *Pour Type* (and *Is External?* for walls) | see [Pour type codes](#pour-type-codes) |
| <span class="aid-num">Pour number</span> | `0016` | planning proposed pour ID | four digits |
| <span class="aid-act">Activity type</span> | `R`, `C`, `I` | the construction phase | see [Activity type codes](#activity-type-codes) |

## Activity name

<span class="aid-bld">{Unit}{Building}</span> - <span class="aid-lvl">{Level}</span> - <span class="aid-zone">{Zone}</span> - <span class="aid-ie">{Internal/External}</span> <span class="aid-dh">{Double Height}</span> <span class="aid-dh">{Precast}</span> <span class="aid-type">{Pour Type}</span> <span class="aid-num">{Pour Number}</span> - <span class="aid-act">{Activity type}</span>

## Examples

| Activity ID | Activity name |
| --- | --- |
| PRJ-<span class="aid-bld">HVL</span>-<span class="aid-lvl">L3</span>-<span class="aid-zone">D</span>-<span class="aid-ie">I</span><span class="aid-type">W</span>-<span class="aid-num">0016</span>-R | <span class="aid-bld">HVL</span> - <span class="aid-lvl">L3</span> - <span class="aid-zone">Disconnected Zone</span> - <span class="aid-ie">Internal</span> <span class="aid-type">Wall</span> <span class="aid-num">0016</span> - Rebar |
| PRJ-<span class="aid-bld">HVL</span>-<span class="aid-lvl">L3</span>-<span class="aid-zone">D</span>-<span class="aid-ie">E</span><span class="aid-type">W</span>-<span class="aid-num">0015</span>-R | <span class="aid-bld">HVL</span> - <span class="aid-lvl">L3</span> - <span class="aid-zone">Disconnected Zone</span> - <span class="aid-ie">External</span> <span class="aid-type">Wall</span> <span class="aid-num">0015</span> - Rebar |
| PRJ-<span class="aid-bld">HVL</span>-<span class="aid-lvl">L1</span>-<span class="aid-zone">D</span>-<span class="aid-ie">E</span><span class="aid-type">W</span>-<span class="aid-num">0101</span>-C | <span class="aid-bld">HVL</span> - <span class="aid-lvl">L1</span> - <span class="aid-zone">Disconnected Zone</span> - <span class="aid-ie">External</span> <span class="aid-dh">Double Height</span> <span class="aid-type">Wall</span> <span class="aid-num">0101</span> - Concrete |
| PRJ-<span class="aid-bld">HVL</span>-<span class="aid-lvl">L1</span>-<span class="aid-zone">D</span>-<span class="aid-ie">I</span><span class="aid-type">W</span>-<span class="aid-num">0107</span>-C | <span class="aid-bld">HVL</span> - <span class="aid-lvl">L1</span> - <span class="aid-zone">Disconnected Zone</span> - <span class="aid-ie">Internal</span> <span class="aid-dh">Double Height</span> <span class="aid-type">Wall</span> <span class="aid-num">0107</span> - Concrete |
| PRJ-<span class="aid-bld">1HN</span>-<span class="aid-lvl">L4</span>-<span class="aid-zone">C</span>-<span class="aid-ie">I</span><span class="aid-type">W</span>-<span class="aid-num">0488</span>-R | <span class="aid-bld">1HN</span> - <span class="aid-lvl">L4</span> - <span class="aid-zone">Connected Zone</span> - <span class="aid-ie">Internal</span> <span class="aid-type">Wall</span> <span class="aid-num">0488</span> - Rebar |
| PRJ-<span class="aid-bld">HVD</span>-<span class="aid-lvl">L2</span>-<span class="aid-type">B</span>-<span class="aid-num">0049</span>-I | <span class="aid-bld">HVD</span> - <span class="aid-lvl">L2</span> - <span class="aid-dh">Precast</span> <span class="aid-type">Beam</span> <span class="aid-num">0049</span> - Installation |

"Double Height" is calculated from the pour's bounding box height (walls taller than 6 m); everything else is taken from the pour's properties.

## Pour type codes

The Scenarios generator writes these (`scenario-engine/main.py`, `_activity_type_code`).

| # | Pour type | Code in activity ID |
| --- | --- | --- |
| 1 | WALL - External | EW |
| 2 | WALL - Internal | IW |
| 3 | HEAVY_PRECAST | HP |
| 4 | STAIR | ST |
| 5 | SCREED | SC |
| 6 | CORBEL | CO |
| 7 | REMOVABLE_ELEMENT | RE |
| 8 | PARAPET | PA |
| 9 | RAFT | R |
| 10 | SLAB / MAIN_SLAB | S |
| 11 | COLUMN | C |
| 12 | BEAM | B |
| 13 | PEDESTAL | P |
| 14 | GULLIES | G |
| 15 | UPSTAND | U |
| 16 | LANDING | L |
| 17 | AIRDUCT | AD |
| 18 | BOSS | BO |
| 19 | GROUT | GR |
| 20 | PLINTH | PL |

## Activity type codes

The last part of the ID, one per construction phase. These are the codes the generator uses today (`scenario-engine/config.py`, `core/activity_generator.py`), to be confirmed as the standard.

| # | Code | Activity type | Used for |
| --- | --- | --- | --- |
| 1 | R | Rebar | in-situ pours |
| 2 | F | Formwork (EP+FWK on walls, FWK on slabs) | in-situ pours |
| 3 | C | Concrete | in-situ pours |
| 4 | DK | Decking | slabs |
| 5 | D | Under slab | slabs |
| 6 | ALL | Works before slab | slabs (when switched on) |
| 7 | E2 | EOP on slab | slabs |
| 8 | RFC | Rebar, formwork and concrete | small pours done in one go |
| 9 | I | Installation | precast |
| 10 | S | Stitching | precast |
| 11 | PR | Propping | heavy precast |
| 12 | CU | Curing (walls under) | heavy precast |
| 13 | RP | Propping removal | heavy precast |

## Open points

**One-letter codes.** `R`, `C`, `S` and `P` are pour types here and also activity types (Rebar, Concrete, Stitching, Propping). They sit in different places in the ID, so IDs stay unique, but a reader can mix them up. Worth a decision when the standard is confirmed.
