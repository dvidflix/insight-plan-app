<!-- order: 3 -->
<!-- group: App pages -->
# Model checks (IDS)

**Models › Model checks** (side pane) checks the loaded models against IDS files, the buildingSMART format for model requirements, laid out like the programme quality checks. Where a check fails and a **patch** is linked to it, the app can fix the IFC and load the fixed copy.

## Running the checks

1. Load the models (Inputs). Only the models shown are checked.
2. Open **Model checks**, tick the IDS files to use and press **Run checks**.
3. Each specification shows a ring (share of elements passing), how many fail and **PASS**, **FAIL** or **N/A** (nothing it applies to). Click it to see the failing elements and why. Click a row to select that element, or **Select all failing**.

**CSV** exports every specification and failing element. The download button beside a file exports that `.ids`.

## The IDS library

IDS files live in the repo in `docs/ids`, so the whole team uses the same ones. **Import IDS** adds a file there. Commit and push it to share it, as with wiki pages.

`Minimum-requirements-for-planning.ids` holds what the CWA models need for 4D sequencing:

| Check | Fix |
| --- | --- |
| Pour elements have a specific IFC class (not IfcBuildingElementProxy when their Pour Type names a wall, slab…) | Reclassify by Pour Type |
| Pour elements have a Pour Type | – |
| Pour elements are contained in a building storey | Rebuild site, buildings and storeys |
| Storeys are not Undefined | Rebuild site, buildings and storeys |
| Pour elements say whether they are external (Is External?) | Add Is External? = NO where missing |

## Custom rules

Some checks can't be written in IDS: it can't count ("only one building"), and it can't compare one value with another ("the building is named after its elements' property"). Those are **custom rules**, JSON files in `docs/ids/rules`, listed as *Custom rules* next to the IDS files and shown the same way. A patch links to a rule as it does to a specification: `{"ids": "Custom rules", "specification": "<rule id>"}`.

| Rule | Fix |
| --- | --- |
| One building, named Unit + Building (`1HN`, `9HVD`): not the zones or groups an export turns into buildings (CONNECTED_HL, DISCONNECTED…) | Merge buildings into one |
| Element names are their pour ID: the Name equals Full Pour ID String, Pour ID Number or Pour ID (any property set; the variants Full Pour ID, FullPourID and PourID count too; numbers by value, so `0389` = `389`) | Name elements after their pour ID: copies the first of those it has, in that order |

The name comes from the model's first pour element with a *Building* (Unit + Building, from the CWA property sets). If the elements don't all agree, the check says which values they carry.

The app evaluates Entity, Attribute, Property and PartOf facets itself, following IDS 1.0, and hands Classification and Material requirements to That Open. PartOf and Classification / Material can't yet be used under *applicability*.

## Patches

A patch is a JSON file in `docs/ids/patches`, one per patch. It names the specification(s) it fixes (`fixes`: the IDS file and the specification's identifier) and what it does (`operation`):

- **reclassify**: changes an element's IFC class from a property value, e.g. CWA Pour / Pour Type `WALL` → IfcWall. It also fits the class's type attribute to the schema: IFC2X3 beams, walls, columns and members have one attribute fewer than a proxy.
- **spatial-structure**: rebuilds the whole model's hierarchy. One IfcSite, an IfcBuilding per Unit + Building, an IfcBuildingStorey per Level at *level number × storeyHeight* metres (converted to the file's units), and each element contained in its storey. Elements without a level go in the site.
  Both this and merge-buildings put the storeys in level order: in the file, in the building's list, and in their GlobalIds, so viewers that sort the tree by GlobalId list them bottom to top too.
- **name-from-property**: sets the failing elements' Name to the first of a list of properties they have (by name, in any property set).
- **pad-property**: pads the failing elements' numeric properties (by name) with leading zeros to a number of digits (389 → 0389), written as text. Values that aren't whole numbers or are longer are left alone.
- **merge-buildings**: keeps the first IfcBuilding, renamed Unit + Building, and moves the other buildings' storeys and contents under it. Storeys with the same name are merged, their elements put together. The emptied buildings and storeys are removed, and nothing is left pointing at them.
- **set-property**: gives the failing elements a property value, creating the property set where missing. With `overwrite: false`, existing values stay.

In a failing check, **Preview** shows what the patch would change and what it leaves alone. **Apply** then:

1. edits the IFC text in place (everything else stays byte for byte),
2. saves it as `<name>_FIXED.ifc`, into the project folder's `models/edited` when a project is open (with a `.log.json` of every change), otherwise as a download,
3. loads it in place of the original, keeping its placement, and runs the checks again.

The original file is never changed. Only IFCs loaded in this session can be patched, not `.frag` files.

## Editing properties

**Properties › Edit properties** writes properties for the selected elements:

1. Select the elements (in 3D, a search set, or *Select all failing* in Model checks).
2. Enter the property set, property, value and type (Text, Number, Yes / No…). The fields suggest what the selection already has, and *now:* shows its current values.
3. **Add selected to queue**. Repeat for other properties or selections.
4. **Write queued changes to IFC** writes them all and loads the `_FIXED` copy, as a patch does.

Property values in IFC are often shared between elements, so a value is never edited in place. The element's set points at a new value, and a set shared with other elements is first copied, so those keep theirs. **Keep a backup** keeps the previous `_FIXED` file, timestamped, when it is written again.
