<!-- order: 4 -->
# Models: the side pane

The tabs beside the 3D view. Drag the edge of the pane to resize it.

## Selection Tree

The model's structure. Switch between **Structure** (site, building, storey…), **Types** and **Layers**. Click a row to select its objects; double-click to zoom to them. Picking an object in 3D reveals its row.

## Properties

The property sets of the selected object. With several objects selected (or none, for the whole model), you see one value or each value with its count. **Click a value** to select every object that has it.

- **Show / hide properties** chooses which sets and properties are shown.

## Search sets

Named groups of objects, kept in folders.

- **Search sets** are conditions, for example *Level is any of 03, 04* or *Name contains "wall"*. You can combine conditions and match *all* or *any*. They run again on whatever is loaded.
- **Selection sets** are saved selections. They survive reloading a model.
- Click a set to select its objects. The **eye** on a set or folder hides or shows its objects in 3D. The space bar turns the selected sets on or off.
- A search's matches can be frozen as a selection set.

## Data table

A table of the objects under the 3D view. Open it from the toolbar of this tab.

| Control | Use |
| --- | --- |
| **Columns** | Any property as a column |
| **Filters** | Show only rows matching conditions (the same conditions as Search sets) |
| **Group** | Nested groups, with subtotals |
| **Sort** | By several columns |
| **Colour** | Colour rows by rule or by value |
| **Totals** | Sum, average, min, max or count per column |
| **Export CSV** | Save the rows you see |
| **Presets** | Save the whole table set-up under a name |

Selecting rows selects the objects in 3D, and the other way round. The table handles very large models.

**Twin model**: for two models with the same geometry but different properties, pair each object with its counterpart and show both models' properties side by side.

## Views

Save the current view (camera, what is hidden, colours, section planes, style) under a name and come back to it. You choose what each view restores. This tab also holds the display settings (projection, style, edges, ambient occlusion, background, grid, sun, view cube) and the camera **fly-through** (key positions along a smooth path).

## 3D & Related

- **Model placement**: move a model in project axes, for example to line several buildings up. The **storey slide** pulls storeys apart vertically.
- **Touching the selection**: select what is *Below*, *Above*, *Beside* or *All* around the selection. Click again to go one step further.
- **Clashes & contacts**: the app checks every loaded model against itself and the others in the background. **Touching elements** lists pairs in one model; **Linked elements** lists pairs between two models. Click a pair to select them. Settings: tolerance, exact geometry, automatic updates. Results can be exported to CSV.

## Colour

Colour the model by any property, with a palette or random colours. Click a value to select its objects. In a split view, each view is coloured separately.

## Model checks

Checks the loaded models against IDS rules (the buildingSMART format for model requirements).

1. Load your models.
2. Tick the rule files to use and press **Run checks**.
3. Each specification shows a ring (share passing) and **PASS**, **FAIL** or **N/A**. Click one to see the failing elements and why. Click an element to select it, or **Select all failing**.
4. **CSV** exports every specification and failing element.

## Topics

BCF issues for the model. Switch Topics on in **Settings › Experimental features** (it is hidden until then). It also appears in 4D Sequencing, under 4D.

- **+ New topic** makes one. Give it a title, a type (Issue, Clash, Request, Remark, Fault or Inquiry), a status (Open, In progress, Resolved or Closed), a priority (Critical, High, Normal or Low) and an assignee.
- **Comments** can each carry a viewpoint, so the picture of the model travels with the words.
- A topic can have a **point in the model**. With **Markers** on, those topics show as markers in the 3D view; click one to open the topic. In 4D, a marker shows only while the topic's dates are on.
- A topic's **start and finish** can follow activities of the programme, or be set as dates.
- **Search** and the **status filter** narrow the list. The row-buttons chooser sets which buttons show on each topic.
- **Import BCF** reads a BCF file, for example from BIMcollab, Solibri or Revit. **Export BCF** writes one. The start date, the point and the linked activities go into the file as labels (such as "Start: 2026-10-05"), so other tools show them as ordinary labels and this app reads them back.
- **Author** is written on the topics and comments you make, and into the BCF file. BIMcollab expects an e-mail address.
