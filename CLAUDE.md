# Insight Plan

Before adding or changing any UI (headers, tabs, fold/close buttons, tables, panels, buttons, spacing), read [docs/design/ui-standards.md](docs/design/ui-standards.md) and follow it. Reuse the existing classes and components it names; do not invent new looks for familiar things. After a UI change, check the result against a neighbouring page.

Key reminders (details in the standards):

- Every header is `--header-h` (38px), built from `filterbar schedule-toolbar`, full width, cells full height; docks and the navigation bar start below it.
- Fold = full-width strip with a centred chevron in the header; close = X at the far right.
- Step tabs go in the header after the search box; the search box has 12px each side; the view button is one fixed width.
- A view is not a panel (Gantt view vs Gantt panel). Choosing a view opens it; choosing a panel docks it.
- Any panel must open on any view, beside the main window, without switching view (never route a panel click to another page).
- Files: every loadable row has a tick box; Space ticks/unticks (loads/unloads), it does not show/hide.
- Tables look and work like Excel: `xl xgrid` + `useEditableGrid`, as in the Parameters table (`PlanTablesScreen.tsx`); no loose rounded inputs (`rel-table`).
- Compact but readable; use the tokens in `:root`, never hard-coded colours.
