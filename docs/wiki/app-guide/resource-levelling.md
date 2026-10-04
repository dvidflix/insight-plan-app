<!-- order: 10 -->
<!-- group: Scheduling -->
# Resource levelling

`src/schedule/resourceLoading.ts`, `src/schedule/levelling.ts`; the Programmes › Resources view.

This is the method of the levelling workbook (*Labour_Resource_Assignment_and_Levelling.xlsx*), run on the programme.

- **Demand.** Each activity puts its crew on every working day from its start to its finish, on its calendar. Demand is summed per trade per day. Trades are matched by resource name, so the same trade in several loaded programmes adds up.
  - Materials are spread evenly over the activity's working days.
  - The page's filters limit what is counted.
- **Over capacity.** A day is over capacity when any trade's demand exceeds that trade's capacity. The histogram's capacity line is the sum of the shown trades' capacities. The ▲ markers and KPIs count per-trade overloads.
  - Capacities start from the programme (P6 max units / time) and can be changed in the view. Changes are kept in this browser.
- **Levelling** is a serial pass, the method P6's leveller uses:
  1. Activities are taken in logic order. Among those whose predecessors are all placed, the earliest current start goes next, then the least float.
  2. Each is placed at the first working day, no earlier than its current start or than its levelled predecessors allow (FS / SS / FF / SF with lag), where every shown trade with a capacity stays within it on each of its days.
  3. **Within float** never moves an activity past its late start. What doesn't fit stays at its earliest date and is counted as unresolved. **Allow a later finish** delays as far as needed, up to about 10 years, which pushes the finish out.
  4. Levelling only delays. Started work stays fixed, and durations and crews don't change. An activity whose crew alone is bigger than its trade's capacity can't fit and is flagged.
- **Result.** It shows as the chart with the before-levelling total drawn as a grey line, KPIs with their before values, and the finish date change. *Add as new programme* puts the levelled dates (as early and planned dates) into a new programme, named `… [levelled]`. You can then compare it with the original in Schedule Comparison or play it in 4D.
- **Limits.** It works in whole working days, and the time of day is kept from the original dates. Late dates and float on the levelled copy are those of the original programme.
