<!-- order: 3 -->
# Models

The 3D viewer, with a toolbar over the model and a side pane with the tools. For the side pane tabs see [Models: the side pane](models-side-pane.md).

## Moving around

- **Orbit**: drag. **Pan**: right-drag. **Zoom**: mouse wheel.
- In the Selection tree, **double-click** a row to zoom to its objects.
- **Views ▾** in the toolbar: Axon, Top, Front, Left, Back, Right, Bottom.
- **Fit** frames everything (or the selection, if there is one).
- **Orthogonal / perspective** switches the camera type.

## Selecting

Click an object to select it. **Ctrl + click** adds to the selection. The selection also shows in the Selection tree, Properties and Data table.

| Button | What it does |
| --- | --- |
| **Clear** | Clear the selection |
| **Hide** | Hide the selected objects |
| **Isolate** | Show only the selected objects |
| **Show all objects** | Undo every hide and isolate |
| **Select / Isolate** (mode) | What selecting does: only highlight, or isolate as well |
| **Ghost** | Fade everything outside the selection |
| **Pin** | Keep the current isolate or ghost while the selection changes |

## Measuring

Open **Measure ▾** and choose:

- **Length**: click two points.
- **Edge**: the length of an edge.
- **Area**: a polygon, rectangle or face.
- **Angle**.
- **Volume** of an object.
- **Point coordinates**: double-click a point (it snaps to corners). Its X, Y and Z in metres are shown in large type and **copied to the clipboard**. The copy icon copies it again.

*Delete all measurements* clears them. **Delete** removes the last one.

## Section planes

Open **Section ▾** and double-click the model to cut it there. Planes can be switched off, hidden or deleted.

## Visibility

**Visibility ▾** shows or hides section planes, the grid, and each **IFC element type** (walls, slabs and so on, with the number of objects of each).

## Split view

Show two views side by side, or stacked under a **compare slider**. Each view has its own models, display settings, storey slide and colouring, and the cameras can be linked. Useful for comparing two models or two colourings.
