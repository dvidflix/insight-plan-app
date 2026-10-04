<!-- order: 3 -->
<!-- group: Start here -->
# File formats and how to prepare them

What you can drop on [Inputs](inputs.md), and how to get a file into a shape the app reads. One drop zone takes all of them; the file's extension decides what it becomes.

| You have | Extension | Becomes |
| --- | --- | --- |
| BIM model | `.ifc` | A model: elements, properties and a spatial tree, searchable and linkable to the programme |
| Converted BIM model | `.frag` | The same model, already converted (skips the IFC conversion) |
| P6 programme | `.xer`, `.xml` | A programme |
| MS Project programme | `.xml` (File › Save As › XML) | A programme |
| Excel / CSV programme | `.xlsx`, `.xlsm`, `.xls`, `.csv` | A programme |
| Site context mesh (terrain, aerial photo, surroundings) | `.glb`, `.gltf` | A context mesh in the 3D view, outside 4D |

Not read directly: Blender (`.blend`), Revit (`.rvt`), Navisworks (`.nwd`/`.nwc`), SketchUp (`.skp`), MS Project (`.mpp`). Export from them to one of the formats above.

## glTF / GLB: terrain, aerial photos and surroundings

A glTF mesh is meant as **context** around the IFC models: a terrain with an aerial photo, neighbouring buildings, a site plan. It sits in the 3D view beside the models and does not take part in 4D: it is never hidden or coloured by date, it is not selectable (a click goes through to the model behind), and it casts no shadows. It shows in the main 3D view only, not in the second view of a split. It is not kept when you reload the page: drop the file again.

### From Blender

1. Put the mesh in **real-world metres** and at the **same coordinates as your IFC models** (project axes: X east, Y north, Z up). That is what lines it up with them. Check this first: a mesh modelled at the origin will not land on a model that sits at survey coordinates.
2. Apply the scale and any modifiers you want kept (**Object › Apply**).
3. Keep the aerial photo reasonably small. 4096 px is plenty for a site; 8192 px is the most to expect a browser to handle on a laptop. A larger texture can make the browser slow or run out of memory.
4. **File › Export › glTF 2.0 (.glb/.gltf)**, with:
   - Format: **glTF Binary (.glb)** — one file with the textures inside.
   - Include: Selected Objects, if the scene holds more than the context mesh.
   - Transform: **+Y Up** on (the default). Blender's X east / Y north / Z up then arrives as the project's axes.
   - Mesh: **Apply Modifiers** on, **Compression off.** Draco-compressed files are not read.
   - Material: Export on, images as JPEG (smaller than PNG for a photo).
5. Drop the `.glb` on Inputs.

### In the app

- It appears in the Inputs table with a **glTF** tag. *Items* is its triangle count and *Min / max XYZ* is its extent in project axes, so you can compare it with the models' boxes.
- If it does not line up, use **Move** under its name: X east, Y north, Z up, in metres. The table's box moves with it.
- The eye hides it without unloading; the bin removes it. Large or very detailed meshes slow the 3D view down: decimate in Blender (**Decimate** modifier) before exporting.

## Excel and CSV programmes

Drop a spreadsheet and the app reads the first sheet with a header row (within its first 20 rows) as a programme. Column names are matched ignoring case, spaces and punctuation.

| Field | Recognised headings |
| --- | --- |
| Name (**required**) | Activity Name, Task Name, Name, Description, Activity, Task, Title |
| Activity ID | Activity ID, Task ID, ID, Activity Code, Code, Unique ID, Ref, Reference |
| Start | Start, Start Date, Planned Start, Early Start, Begin |
| Finish | Finish, Finish Date, End, End Date, Planned Finish, Early Finish |
| Duration | Duration, Original Duration, Planned Duration, Duration Days, Days |
| WBS | WBS, WBS Code, WBS Path, WBS Name, Outline Number |
| Predecessors | Predecessors, Predecessor, Preds, Dependencies, Depends On |
| % complete | Complete, % Complete, Percent Complete, Progress |
| Actual start / finish | Actual Start, Actual Finish |
| Type | Type, Activity Type, Task Type (a value containing "milestone" makes it a milestone) |

The sheet needs a name column and at least one of Start, Finish or Duration. Any other named column is kept as a text field on each activity.

- **Dates** can be real Excel dates, Excel serial numbers, ISO (`2026-10-05`) or day-first text (`05/10/2026`, `Mon 05/10/26`). In a **CSV**, dates are always read day-first.
- **Durations** are working days; a blank duration is worked out from Start and Finish, or defaults to one day.
- **Calendar:** Excel programmes use a Monday–Friday, 8-hour day. Activities with no start take the programme's first start and the logic places them.
- **WBS:** a path with `/`, `>` or `\` (`Civils / Level 1`) or dotted numbers (`1.2.3`) builds the WBS tree.
- **Predecessors:** list them in one cell separated by commas, semicolons or line breaks. Each is an Activity ID (or the row number, written `#5` or `5`), optionally with a type and a lag: `A100`, `A100FS+2d`, `A200SS-1 day`. Without a type it is Finish-to-Start. Unknown references are left out.

Example:

| Activity ID | Activity Name | Start | Duration | Predecessors | WBS |
| --- | --- | --- | --- | --- | --- |
| A100 | Excavate | 05/10/2026 | 10 | | Civils / Basement |
| A110 | Blinding | | 2 | A100 | Civils / Basement |
| A120 | Base slab rebar | | 6 | A110FS+1d | Civils / Basement |
| A130 | Base slab pour | | 1 | A120 | Civils / Basement |

## Other programme formats

- **P6 `.xer`** — File › Export › Primavera PM (XER). Large multi-project files open a picker. See [Imported programmes](imported-programmes.md#imported-programmes-p6-xer--xml).
- **P6 `.xml`** — File › Export › Primavera PM (XML).
- **MS Project** — File › Save As › XML (`.xml`); `.mpp` itself is not read.

## IFC and FRAG

- Export IFC 2x3 or IFC4 from your authoring tool; properties and the spatial tree are indexed for search. Keep the model at its real coordinates so models, context meshes and the programme line up.
- A `.frag` is a model already converted to the app's own format (the app uses it to hand models to a duplicated tab). Loading one skips the IFC conversion.
- IFC layers are read from the IFC text, so a `.frag` has none.
