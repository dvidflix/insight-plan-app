<!-- order: 2 -->
<!-- group: Start here -->
# Inputs

- One drop zone and one table hold both: drop or pick **IFC** / **FRAG** models and **P6 `.xer` / `.xml`** programmes (models by file type, everything else as a programme). The table shows each file's type, elements (models) or activities (programmes), a model's lowest and highest X, Y, Z in project axes (metres), and the file size; the project database sits in the narrower column on the right. Several of each can be loaded. A multi-project `.xer` opens a picker (search, activity counts); the chosen projects load together as one programme, so links between them are kept. Large XER files (hundreds of MB) are read in a background worker, one table and one project at a time — see [Imported programmes](imported-programmes.md#imported-programmes-p6-xer--xml).
- **glTF / GLB** meshes (terrain with an aerial photo, surroundings) can be dropped too: they appear as site context in the 3D view, outside 4D, with a Move control to line them up. How to export one from Blender, and the Excel programme layout, are in [File formats and how to prepare them](file-formats.md#file-formats-and-how-to-prepare-them).
- Models are converted to Fragments in the browser (web-ifc), with their properties, spatial tree and IFC layers indexed for search.
- Turn a model or programme off without unloading it (kept in memory, excluded everywhere), or remove it.
- After importing an app configuration (see [Settings](across-the-app.md#across-the-app)), the files it expects are listed until they are loaded again.
