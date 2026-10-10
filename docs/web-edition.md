# Web edition (browser edition)

The app as a static website. There is no server side: the project database and the model files live in the user's browser
and in a project folder the user chooses (a folder on their computer or in OneDrive). Models are converted and drawn in the
browser as before.

## Build and run
- `npm run dev:web` runs it (Vite, `--mode web`).
- `npm run build:web` writes the site to `dist-web/`. Copy that folder to any static web host.

## Hosting
- It needs **HTTPS** (or `localhost`): the browser only allows folder access on a secure page.
- **Do not** add cross-origin-isolation headers (COOP / COEP). The viewer's model loading stops working with them on.
- Any static host works: a Synology (Web Station), Azure Static Web Apps, an intranet web server. Serve `index.html` for unknown paths.
- Customers whose IT blocks unknown sites can host the folder on their own intranet.

## What it does and does not have
- Has: the project database (programmes, link groups, capacities, settings, clashes), stored models and their version history,
  everything the viewer, programme and 4D screens do.
- Left out (they need a server): the Scenarios generator (Python), P6 Professional database links, editing Wiki pages,
  SeaTable, Superset, self-update.
- Chrome or Edge only for picking a folder. Other browsers can use the browser's own storage.

## Where the data is
- `insight-plan.db` in the project folder: the same SQLite file the desktop edition uses. It is held in memory while the app is open
  and written back about a second after each change, and when the page is hidden or closed.
  Open it in DBeaver or DB Browser for SQLite only while the app is closed.
- `insight-plan-models/` in the project folder: each model's IFC, its converted copy and a short history, as plain files.
- With "Use browser storage" the same files are kept inside the browser (private to the site; the browser may clear them), so
  back them up by using a real folder.
- Keep a project in a OneDrive folder if you like, but only one person should have it open at a time.

## Code
- `src/db/core.ts`: the project database logic, shared with the server (`vite-plugins/db/projectDb.ts`).
- `src/web/`: the browser side (SQLite in WebAssembly, the worker, the folder handling, the model store).
- Tests: `tests/unit/browserDb.test.ts`, `tests/unit/modelStore.test.ts`, `tests/unit/projectDb.test.ts`.
