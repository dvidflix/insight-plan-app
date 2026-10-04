<!-- order: 14 -->
<!-- group: Under the hood -->
# SeaTable: model data and custom fields

The local SeaTable (Docker, `C:\insight-stack\seatable`) can hold the model elements, so you can add your own columns to them in a spreadsheet-like table and bring those columns back into the app as **custom fields**. **Inputs › SeaTable (model data)** does both. It needs the dev server (`vite-plugins/seatablePlugin.ts`), which reads SeaTable's address and the base's API token from `C:\insight-stack\seatable\.env` (`SEATABLE_ENV_FILE` to point elsewhere).

**Push.** Tick the IFC classes (for example Wall and Slab; the number is the loaded elements of that class) and press **Push**. Every element of those classes goes into the **Elements** table of the *Insight Plan Rates* base, one row per element, keyed by its GlobalId:

- fixed columns: `GUID`, `Model`, `IFC class`, `Name`, `Last pushed`, `Removed`;
- one column per model property, named `Pset.Property`. Only the properties the Properties table shows are sent (what is ticked in **Models › Properties › Show / hide properties**), so hide what you don't need first. A property is a number column when every value is a number, otherwise text.

A push only writes those columns. Rows of elements that are no longer in the model are marked `Removed`, never deleted, so what you typed stays. Pushing again updates the rows in place.

**Custom fields.** Add your own columns to the Elements table in SeaTable (text, number, single select, checkbox, date…) and **keep their names free of dots**: a name with a dot is taken for a model property. Press **Pull custom fields**, or leave **Pull when a model loads** ticked (the default): the columns come back as the **Custom** property group of the elements, matched by GlobalId. The app keeps a copy of the last pull in the project, so with SeaTable off the saved fields still show when a model loads.

The custom fields work like any property: they show in the **Properties** table and the **Data table**, can be picked in **Colour**, in **Filters / search sets** and in the **Link Groups** object filters (property set `Custom`), and can be hidden in Show / hide properties.

Limits: the Developer Edition's row limit per base applies (push only the classes you need); values come back as plain text or numbers (links and files are not brought back); Single-select columns return the option's name.
