<!-- order: 13 -->
<!-- group: Under the hood -->
# Data, persistence and limitations

## Data and persistence

- **The project database** (above) holds programmes, scenarios, link groups, trade capacities, project settings and the Clashes & contacts results.
- Settings are saved in the browser's `localStorage`, per browser profile. Keys starting `schedule.`, `table.`, `gantt.`, `viewer.` and `sequence.` are included in the configuration file that **Settings › Export all** writes, along with link groups, appearance profiles and programmes.
- **IDS files, custom rules and patches** (Model checks) are files in the repo, `docs/ids`, `docs/ids/rules` and `docs/ids/patches`, like the wiki's pages: commit and push them to share them.
- **Fixed models** (a patch or *Edit properties* written to the IFC) are saved as `<name>_FIXED.ifc` in `<project folder>/models/edited`, each write with a `.log.json` of what changed; without a project folder they are downloaded. The original IFC is never changed.
- **Model geometry is never stored.** After a reload, models are loaded again from Inputs; saved settings keyed by model name (placement, hidden models, selection sets…) apply again as soon as a model of that name is loaded.
- Stores that change shape carry a version and migrate older saved data.

---

## Known limitations

- **Calendars** count whole working days: an exception that only changes a day's hours, or an activity starting part-way through a day, is not modelled to the hour. Base calendars (a calendar inheriting from another) are not followed.
- **Project database**: one user at a time (no multi-user locking beyond SQLite's own). Model properties are not in it yet, and levelled programmes are not saved to it. XML programmes go in through the XER conversion (one project per file).
- **Critical-path drag** uses the standard practical approximation, not full path enumeration.
- **The dev server is needed** for Scenarios (with Python), editing the wiki, importing IDS files and saving fixed models into the project folder. A static build has no server: it can still run Model checks and download fixed models.
- **Model checks**: PartOf, Classification and Material can't be used under an IDS specification's *applicability* yet (they work as requirements). Property values are compared as the model index holds them; IDS data types are not checked.
- **Patches and Edit properties** work on IFCs loaded in this session: a `.frag`, or a model loaded before the page was reloaded, needs its IFC loaded again from Inputs. *Edit properties* writes single values (text, number, yes / no); it doesn't remove properties or edit quantities. The reclassify patch changes elements, not their type objects (an IfcBuildingElementProxyType stays one). The spatial patch doesn't place the new storeys (no ObjectPlacement, as the Python original), and names buildings Unit + Building unless the patch's `buildingNames` maps them.
- **Bundle size**: one large JS chunk (~8 MB) plus the Fragments worker — fine for local / internal use, worth code-splitting before a public deploy.
- Some reports in *Reports and Analysis* are listed but not built yet.
- **Clashes & contacts** compare element meshes where the models are placed, so a model offset (Model placement) is included. A storey slide moves only what you see, not the geometry tested. Results are checked again when a model's file, a pair's placement or the settings change, not when the same file is edited and saved under the same name, size and date. Every model is checked against every other, so many large models take a while the first time; with a project folder open that happens once.
- **Resource levelling** does not split activities or change crew sizes. When a critical activity can't fit, reduce its crew and extend its duration yourself, as the levelling workbook advises.
