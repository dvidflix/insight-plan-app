<!-- order: 9 -->
<!-- group: Scheduling -->
# Imported programmes (P6 XER / XML)

`src/schedule/`

- **Activities, links and dates come from the file.** Relationship types are normalised to FS / SS / FF / SF: XER's `PR_FS`… codes, and XML's "Finish to Start"-style text. Lags are read in hours.
- **Links to activities that aren't loaded are dropped.** This happens, for example, when the other end belongs to a project that wasn't picked.
- **Choosing projects** (XER). The chosen projects become one programme, so links between them are kept. Each project's root WBS node becomes a top-level band. `src/schedule/parsers/xerStream.ts` reads large files in two passes in a Web Worker:
  1. It scans the raw bytes for table positions, the project list and activity counts (about 1 s for a 375 MB file on a local disk).
  2. It reads only the tables and columns the app uses (`XER_TABLE_COLUMNS` in `parsers/normalize.ts`), and only the rows of the chosen projects.
- **Text encoding.** Each line is read as UTF-8 when it is valid UTF-8, otherwise as Windows-1252, the code page P6 writes in.
- **Critical and float.** Critical means total float ≤ 0; P6's own longest-path flag is not used. If at least half the activities carry a float value, the file's own values are used as they are. Otherwise `src/schedule/cpm.ts` recalculates dates and float with the same FS / SS / FF / SF rules as above:
  - it works in days, on each activity's calendar;
  - it uses remaining duration when there is one;
  - it starts from the project's data date, or else its planned start.
- **Resources.** Each assignment's units / time is read as its crew size (XML `PlannedUnitsPerTime`, XER `target_qty_per_hr`). Without it, crew = hours ÷ (working days × hours per day). A labour resource's capacity comes from its latest max units / time (XML `ResourceRate`, XER `RSRCRATE`).
- **Calendars.** The real weekly pattern is kept: XML's `StandardWorkWeek`, XER's `clndr_data` (days of the week). So are the dated exceptions (XML's `HolidayOrExceptions`, the `Exceptions()` part of `clndr_data`): a holiday is a non-working day, an exception with work hours a working one. Recalculated dates, float, the heatmap, resource loading and levelling all skip holidays. Programmes › Calendars lists each calendar's exceptions by year. Calculations count whole working days, so an exception that only changes a day's hours makes no difference to them.
