<!-- order: 2 -->
# Inputs

Everything you work with comes in here: models, programmes and the project folder.

## Adding files

Drop files on the drop zone, or click it to pick them. The app decides what each one is:

| File | What happens |
| --- | --- |
| **IFC** | Converted in your browser and shown in Models. Properties, the spatial tree and IFC layers are indexed for search. This can take a while for large models. |
| **FRAG** | A model already converted (faster to open). |
| **P6 `.xer` or `.xml`** | Loaded as a programme. A file with several projects opens a picker: tick the projects you want. They load together as one programme, so links between them are kept. |
| **Excel programme** | Loaded as a programme if it follows the expected layout. |
| **glTF / GLB** | Site context such as terrain or surroundings. Shown in 3D only, with a **Move** control to line it up. |

Large XER files are read in the background, so the app stays usable.

## The table of loaded files

Each row shows the file type, its elements (models) or activities (programmes), a model's lowest and highest X, Y and Z in metres, and the file size.

- **Turn a file off** without removing it. It stays in memory but is left out everywhere.
- **Remove** a file when you are finished with it.

## The project folder

On the right, the project panel shows the folder the project is kept in.

- **Choose folder…** picks a folder on your computer or in OneDrive. Chrome or Edge only.
- **Allow … again** appears when you open the app on a later day: the browser asks permission once per session before using the folder.

Models you load are also kept in the project folder (in `insight-plan-models`), with a short history of each, so they are there next time. See [Your data and saving](your-data.md).
