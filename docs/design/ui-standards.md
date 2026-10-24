# Insight Plan: UI standards

How the app's screens are put together, so a new panel, page or button looks and behaves like the rest. Read it before adding or changing UI. When a rule here and the code disagree, the rule is the intent: fix the code, or change the rule on purpose.

**The one principle: reuse before you invent.** Every header, tab strip, fold button, tool button, chip and table in the app already exists. Find the nearest one (the sections below name them), use its classes and components, and copy its structure. A new look for a familiar thing is a bug.

Sources: the styles in [`src/styles/global.css`](../../src/styles/global.css), the components named below, and the owner's corrections during development (marked **Owner**).

---

## 1. Principles

- **Compact, but readable.** Dense lists and grids, small chrome, no wasted padding. Body text 12–13px, chips and counts 10–11px, never smaller. Controls keep a 34px hit height (44px on touch). Data grids and Gantt rows keep their density; only the chrome around them grows on touch.
- **Consistent beats clever.** The same thing looks the same on every page: same height, same icon, same place, same spacing.
- **Flat.** Header buttons are flat, square and full height, with thin lines between them. No rounded chips in a header, no shadows, no stray borders.
- **Full height, full width.** A header's cells fill its height. A header runs the whole width; the docks start below it.
- **Quiet colour.** One accent green; muted tones elsewhere. Colour carries meaning (selected, critical, warning), not decoration.
- **No black boxes: intuitive without training.** (**Owner**) Every list of choices says where its values come from (group them under headings such as "Search sets · folder X" and "Rule groups · this scenario"); every warning says what is wrong, why it matters and what to do, in plain words; an empty or zero result says why. Never show a bare name list or a message that needs the developer to decode.
- **Instructions are easy to read.** (**Owner**) Every instruction line has the "i" icon, dark text (not dim), 15px, medium weight (the `hint` class, and `scn-editor__help`, `xl__note`, `seq__explain`). Not small, not thin.
- **Look at it.** After a UI change, load the page and check heights, alignment and spacing against a neighbouring page. Do not assume the CSS did what you meant (the stylesheet is 14,000+ lines and later rules win).

---

## 2. Tokens

All defined in `:root` in `global.css`. Use the tokens, never a hard-coded hex, so dark mode (`html[data-theme="dark"]`) keeps working.

| Token | Value | Use |
| --- | --- | --- |
| `--header-h` | 38px | Height of the main header **and** every panel header. |
| `--hit` / `--hit-gap` | 34px / 6px (44 / 8 on touch) | Minimum control height, gap between controls. |
| `--icon-row` | 18px | Icon size in rows, small buttons and tool strips. |
| `--icon-btn-w` / `--icon-btn-h` | 26 / 24px | Small icon buttons inside rows. |
| `--bg`, `--bg-elevated`, `--bg-panel`, `--bg-soft` | greys | Page, raised (inputs, buttons), panel, soft fill. |
| `--border` | `#d3d7d4` | Every line. Lines are 1px. |
| `--text`, `--text-dim` | | Text; secondary text, inactive icons. |
| `--accent`, `--accent-strong`, `--accent-rgb` | green | Selection, active tab, primary button. Tints: `rgb(var(--accent-rgb) / 0.08–0.16)`. |
| `--ok`, `--warn`, `--danger`, `--info` | | Status only. |
| `--n-xxxxxx`, `--l-…`, `--t-…` | neutral / line / text greys | Named greys that flip in dark mode. Prefer `--bg*` and `--border` first; reach for these only to match an existing surface. |

Hover on a flat control: `rgba(0, 0, 0, 0.07)`. Active/selected tint: `rgb(var(--accent-rgb) / 0.14)` with `--accent-strong` text.

---

## 3. The header (main bar and panel headers)

### 3.1 The main header

- **Height `--header-h` (38px)**, the same on every page: Home, Programmes (every view), Models, 4D Sequencing, Generate, and the other pages. Never set a page's own height.
- Build it from the shared classes: `filterbar schedule-toolbar`, with `schedule-toolbar__left` and `schedule-toolbar__right` inside. Do **not** use `viewer-toolbar-row` for a page header (it renders about 4px shorter and misses the full-height button rules).
- **It runs the full width.** Pages with their own header render it into the viewer's header slot (`useHeaderSlotStore` + `createPortal`, see `SchedulePage.tsx`, `HomePage.tsx`, `ScenariosPage.tsx`) so the docks and the navigation bar start **below** it. A header is never squeezed beside a dock.
- **Left to right:** Home · page/view picker (`ViewPicker`) · search box · the page's own controls (tabs, steppers, group-by…). Right side: the page's tools, then the List setup button.
- **Everything in it is full height.** Buttons, tabs and cells stretch (`align-self: stretch`, `height: 100%`), with a 1px `--border` line between cells. Only the search box and text inputs are inset and centred.
- **Icon buttons are true squares**: `--header-h` wide. The Home button is 72px.
- Same font weight and size for the view name on every page (the picker sets it; do not restyle it). **The view button (the second one) is a fixed width on every page**, sized for the longest view name ("Quality Checks", "4D Sequencing"; keep view names short), so the search box and everything after it never shifts when you change view. Longer names are cut with an ellipsis. (**Owner**)

### 3.2 Search box in a header

The `.gs` box (`GlobalSearch`): rounded pill, magnifier icon, 190px wide growing to 250px on focus, **12px of space on both sides** in every header. Placeholder is `Search…`, or `Search on <list>` when a list (Gantt, Data table…) is active. Do not give a page its own margin; the single rule at the end of `global.css` sets it.

### 3.3 Tabs in a header

- Step tabs and view tabs go **in the header, after the search box**, not in a second bar underneath. (**Owner**: tried underneath, rejected.)
- A tab is a header cell: full height, 13px, weight 600, `--text-dim`, a 1px line between tabs. The open tab has a white fill and a 3px `--accent` line under it, with `--accent-strong` text. Disabled tabs are 40% opaque.
- **Generate** (page id `generate3`, `pages/Generate3Page.tsx`) is the one way to generate. Classic Generate (page id `scenarios`, the eight tabs below) shows in the page picker as "Generate (classic)" only when Settings › Experimental features › Classic Generate is on; otherwise a request for it opens Generate. (**Owner**, 2026-10-23.)
- Classic Generate (see `GenerateTabs.tsx`): every main thing is a numbered tab of the header, none is buried in a menu: `1 - Scenario` (opens first), `2 - Work breakdown`, `3 - Sequence`, `4 - Labour`, `5 - Recipes`, `6 - Parameters`, `7 - Extras`, `8 - Rules`. A tab that holds two editors shows them as one short row of tabs under the header (the only second level). Tabs 3 onward are quieter. A planner who only knows search sets must be able to order them and Generate without opening any of them. (**Owner**)
- Generate (`pages/Generate3Page.tsx`, called Generate 3 while it was new) is a guided path with step tabs in the header: `1 - Work packages`, `2 - Sequence`, `3 - Methods & Generate`, and the optional `4 - Granular sequence` (the 4D view, the same 4D driver and TimeLiner bar as 4D Sequencing, beside the object-by-object sequence table, an adjustable split; that table is no longer a dock panel; a row's double-click moves the TimeLiner to its first linked activity). Its columns are the model (the shared 3D view, with the step's tools under it), the packages and a rough timeline, with `Generate schedule` always in the bottom bar. It shows no recipes, crews, rates or rules: a package's method stands for them (`prs/standardMethods.ts` is the only place with construction words and rates, on purpose). Packages nest (a package can hold others; `prs/packageTree.ts`), shown as a tree with fold chevrons in every step and in the timeline. `Advanced` is a panel inside Generate 3 (`Generate3/Advanced.tsx`), closed by default, sliding over the timeline column with a panel header (name, what it is for, close X at the far right). It shows only the picked package's settings in three plain sections (how it is built, when it starts, extras), with details behind "Show more". Its bottom links open focused dialogs (methods, crews), never the classic Generate view or its tabs. (**Owner**: wrapping the old tabs behind Advanced was rejected twice.) `Download Excel` / `Upload Excel` in the package list's head round-trip every package as one sheet (`prs/packagesWorkbook.ts`), as a config file for bulk edits. Optional, secondary tools, all inside Generate 3: the bottom bar's scenario picker and `Save as new version…` (copies, saves and generates); `Fine-tune object order…` in step 2 and Advanced (a dialog: ranks in an Excel-style grid, or from another scenario, sets or an Excel list); `Edit recipes…` in step 3, Advanced and the Methods dialog (a focused list-and-grid editor); `WBS…` in step 3 and Advanced › Set the WBS (a dialog: follow the work packages, or the user's own rules as an Excel-style grid with a preview tree and an Excel round trip, `prs/wbsRules.ts`). Step 4's table tools are in named groups (Order, History, Follow, Picks, Show; `ScenarioToolbar compact`), its two switches have short names with their help in info tips, and its "unsaved" is the header's one chip, which saves on a click. None of them leads to classic Generate. The bottom bar also has the readiness chip (`Generate3/Readiness.tsx`: Ready / Will generate with gaps / Cannot generate, findings with Show in 3D; it replaces classic Generate's model-check chip there), Cancel while generating, and `Compare…` (two versions side by side). Package rows carry their own warning chips; nothing but having nothing to build blocks Generate. The main search box keeps Generate 3 users in Generate 3 (its steps replace the classic tabs in the results). The package list is a list of the app (ListConfig `g3-packages`): searchable, with Filter and Colour in List setup (N).
- Text never sits on the edge of a page: a page of tables has 12px of space around it (`gen-pad`).
- Panel tabs (docks) use `.config-tab`: 12px, 600, 2px accent underline, vertically centred.

### 3.4 Panel (dock) headers

- Same height as the main header, same flat full-height buttons, same lines. The tabs never shrink; the panel's tools give way.
- Tool buttons: `ToolPopover` for a popover, `OverflowMenu` for the `⋯` menu, icon-only unless the label is short and needed.
- A tool group has a 1px line on each side. The panel's search box is the same as the main header's, first in the right-hand group.

---

## 4. Fold, close and chevrons

These keep being asked for, so exactly:

- **Fold (hide the panel's content, leave a strip):** a **full-height strip filling the free space** in the header, between the tabs/List dropdown on the left and the tools on the right, with a **centred chevron** (`IconChevronDown`, rotated for the dock's side). Flat, `--text-dim`, hover tint, 1px line on its left. In the bottom dock this is the `.mdt__fold` button (class reused by Files). In left/right docks the dock's own fold button (`.dock__tool--fold`) is the same strip. **Never** a small pill, a corner button or a floating control on the divider. (**Owner**: tried on the divider, rejected.)
- **Close (remove the panel):** an **X** (`IconClose`) at the **far right** of the header, a square `--header-h` wide with a 1px line on its left. A panel that can be folded and closed has both. Closing means the Panels menu brings it back; say so in the `title`.
- **Chevron meaning and icons:** `IconChevronDown` = fold / expand a menu / dropdown; `IconChevronRight` = collapsed group (click to open); `IconChevronDown` = open group. Rotate one icon rather than adding a new one. Icon size `--icon-row` (18px), 14px inside a group header.
- Every icon button has an `aria-label` and a `title` that says what it does and what happens next.

---

## 5. Buttons and controls

| Need | Use | Notes |
| --- | --- | --- |
| Normal action | `.btn` | 6px radius, `--bg-elevated`, border goes accent on hover. |
| Main action | `.btn.primary` | Accent fill, white text. One per view. |
| Destructive | `.btn.btn--danger` | Red text and border; red fill on hover. |
| Icon only | `.icon-btn` | `--hit` square, 18px icon. In a header: `--header-h` square, flat. |
| Row button | `.mini-btn` / `.mini-btn--icon` | In table rows. Which ones show is user-choosable (`RowButtonsChooser`). |
| Toggle (on/off) | button with `aria-pressed`, `.primary` or `.is-on` when on | e.g. Auto-update, Timeliner. |
| Segmented | `.np__seg`, `.ctx-stepper` (`‹ 2 ›`) | Full header height in a header. |
| Menu | `ToolPopover` / `OverflowMenu` | Popovers open **upward** in the bottom dock. Menu items are regular weight, not bold. |
| Help | `InfoTip` | A small info icon with a popover, not a paragraph of text on the page. |

Rules: sentence case, verb first (`Add files`, `Fold the Files panel away`). Disabled controls stay visible, at 35–40% opacity, with a `title` saying why. A control that does not apply is hidden, not disabled, when it would only add noise.

---

## 6. Lists, tables and rows

- **Density:** rows are compact (about 28px); header cells are small caps-free labels, 12px, dim. Zebra striping is off in the Excel-style grids (`.xl`): every cell white.
- **Tables look and work like Excel.** (**Owner**) Any table you type into or read as data is a spreadsheet grid: `<table className="xl xgrid">` with a row-number column (`xl__row`) and corner (`xl__corner`), every cell white with a thin grid line, the cell you click outlined and tinted, a fill-down handle, a `*` row at the bottom to add (`xl__add`), a narrow tick column for on/off (`xl__check`) and a delete icon column. Cells are plain inputs wired with `useEditableGrid`: click to select, arrows and Tab move, Ctrl+D or the corner square fills down, copy and paste ranges to and from Excel. A bad value tints its cell (`is-bad`) with the reason in its `title`. The reference is the **Parameters** table in `PlanTablesScreen.tsx` (and now **Limits**); copy it. Do not build a table of loose, rounded, individually bordered inputs (the old `rel-table` / `rel-cell` look): it reads as a form, not a sheet. Remaining `rel-table` tables (Steps, formula preview and others) are to be converted when next touched.
- **The Parameters panel is the reference for a table page, including the space around the table.** (**Owner**: "a good standard including space to the area".) Copy its arrangement: a bold section heading with a thin rule under it; a row of normal buttons (Download / Upload workbook) with a rule under it; then the add button (`.btn.btn--small.primary`, e.g. `+ Parameter`) with one line of dim help text beside it; then the grid; then a dim footnote line. About 12px of space to the left and between these blocks, so nothing touches the panel edge; the grid is as wide as its columns need (not stretched to the window) and left-aligned with the buttons above it. Column headers are small, uppercase, dim; row numbers centred in a grey gutter; numbers right-aligned; the selected cell outlined in the accent with the fill-down handle at its corner.
- **Column headers sort on click** (again reverses). Sorting, grouping, filtering and column choice are the shared list tools (`ListConfig`, the Columns / Filters / Group / Sort / Color panels), not per-page code.
- **Group headers:** a full-width row with a chevron, the group name in bold, the count in parentheses and dim. Outer groups darker, nested ones lighter. Totals row at the bottom, with `Total · N`. It scrolls sideways with the table, never on its own scrollbar.
- **One horizontal scrollbar** per table. If two appear, a wrapper is wider than the window: clip the wrapper (`min-width: 0; overflow: hidden`), do not hide the bar.
- **Selection:** click selects, Shift extends, Ctrl toggles, arrow keys move. The current row and selected rows are tinted with the accent.
- **Chips** (`.source-chip`): 10px, pill, 1px border, dim text, after the name: format (`XER`), state (`in database`, `Editable`, `Scenario`, `Baseline`). Dashed border = a warning or "not stored" state. Do not invent new chip shapes.
- **Types:** the file/programme icon (`.inputs-table__icon`) sits in the Type column, not before the name.
- Numbers right- or centre-aligned and formatted with `toLocaleString()`; dates `dd MMM yyyy`.

### 6.1 Files and the "open / loaded" state

- **Every file row that can be loaded has a tick box**: models, programmes (not just models). Ticked = loaded / linked to the scene; unticked = unloaded but kept. (**Owner**)
- **Space on a selection ticks or unticks** (loads / unloads). It does **not** show or hide. If any selected row is ticked, Space unticks all; otherwise it ticks all. (**Owner**)
- The eye (show/hide) is for rows that have no tick box (site-context meshes), and is not a substitute for loading.
- Group a list by Kind (Model, Programme…) by default on Home.

---

## 7. Pages, views and panels

Do not confuse these. (**Owner**, twice.)

- A **view** is a thing the main window shows: Gantt, Planner, WBS, Activity Codes… on the Programmes page; Models; 4D Sequencing; Generate. Choosing a view in the picker **opens that view** on its page.
- A **panel** is a dockable tool (Gantt panel, Data table, Tasks, Files…) with its own row in the picker and left / bottom / right buttons. Choosing it docks it; it never replaces the main window.
- **Any panel opens on any view, beside the main window, without changing view.** (**Owner**, repeatedly: "I'm on Generate and just want to check Sets at the same time".) Choosing a panel in the Navigation Bar or the Panels menu must dock it where you are. A panel that a view has not mounted is a bug, not a reason to jump to another page (`goToPanel` in `dockStore.ts` only exists as a last resort). When you add a page, mount every panel on it (the Models panels via `ModelConfigPanel background`, the Gantt via `ModelsGanttPanel`); when you add a panel, make sure every page can show it.
- The Gantt exists as both a **view** (Programmes › Gantt) and a **panel** (bottom dock, e.g. under Generate or 4D Sequencing). They are separate rows with separate behaviour. Do not make one stand in for the other, and do not add a "Gantt" toggle to a header or an inline Gantt to a page: use the panel.
- **The navigation bar** (left/right docks) always starts **under the header**, never beside it.
- **Every panel has a header** (same 38px as every header): the panel's name as the tab (white, accent line under it, on the grey bar) on the left, the fold strip filling the middle, and the close X at the far right. It is the bottom dock's header, the same in the left and right docks, where it runs across the top and the navigation bar starts under it. (**Owner**)
- **Each view remembers which panels it had open, and it is saved with the workspace.** (**Owner**) The side of each panel, the tab showing, the folds, the sizes and the panels' own on/off switches are kept per view (a page, or a Programmes view such as `schedule:gantt`) under the layout key `viewer.dockViews`, so a workspace or scene saves and restores them. Entering a view puts its panels back; Home keeps its own layout.
- Panel colours come from `panelColors.ts` (planning blue, common ochre, 3D/4D green, settings plum). A new panel goes in one of those lists.
- A new dockable panel is registered in `dockStore.ts` (`DockPanelId`, `DOCK_DEFAULTS`) and rendered with `DockPanel`. Its tools go in the header slot with `DockToolbar`, not in the body.

---

## 8. Layout and spacing

- Spacing scale: 4 - 6 - 8 - 12 px. `--hit-gap` between header controls; 12px beside the search box; 8–12px panel padding.
- Panels are resizable by a thin grip (8px); the grip has no buttons on it.
- Pages are `display: flex; flex-direction: column` with `min-height: 0` / `min-width: 0` on every flex child that scrolls. No `height: 100vh` hacks.
- Scroll the content, not the chrome: headers, tab bars and total rows stay put.
- Popovers are not clipped by their panel and flip direction when there is no room.

---

## 9. Behaviour

- **State persists** (`usePersistedState`, keyed `area.setting`): the open tab, panel sizes, folds, columns, grouping, collapsed groups. Reload returns to where you were. New settings that belong in the config file use a key under a persisted prefix.
- **Home keeps its own panel layout**, separate from scenes and workspaces.
- **Keyboard:** arrows move, Shift/Ctrl select, Space ticks/unticks, Esc closes a dialog, Ctrl+Tab and Alt+PageUp/PageDown move between pages. Say the keys in the control's `aria-label` or `title`. A key handler ignores keys typed into inputs, selects and textareas.
- **Nothing destructive without a way back or a confirmation.** Unticking and folding keep data; delete asks.
- **Long work shows progress** in the row (`loading 42%`), not a blocking dialog.
- **Errors are shown where the work was**, in plain words, with what to do next.

---

## 10. Text

- Sentence case everywhere except proper names. No trailing full stops on labels or button text.
- Tooltips (`title`) are one sentence that says what it does, plus the next step when not obvious.
- No jargon the planner would not use; programme terms follow P6 (Activity ID, Predecessors, WBS).
- UK spelling: programme, colour, organise.

---

## 11. Checklist before finishing a UI change

1. Header height is `--header-h` and matches the neighbouring page.
2. Every header cell is full height; icon buttons are square; lines are 1px `--border`.
3. Fold is the full-width centred-chevron strip; close is an X at the far right.
4. Search box has 12px each side.
5. Tokens used, no hard-coded colours; dark mode still reads.
6. Only one horizontal scrollbar per table.
7. A view is a view and a panel is a panel.
8. Persisted where the user would expect it to be.
9. Looked at in the running app, next to a page that already follows the standard.
