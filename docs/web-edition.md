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
- Left out and hidden (they need a server): the Scenarios generator (Python), P6 Professional database links, editing Wiki pages,
  IDS import, writing fixes and property edits back to IFC files, SeaTable, Superset, self-update. The flags are in `src/features.ts`.
- Chrome or Edge only (they are the browsers that can pick a folder). The project is always kept in a folder the user chooses; there is no browser-storage option.

## Where the data is
- `insight-plan.db` in the project folder: the same SQLite file the desktop edition uses. It is held in memory while the app is open
  and written back about a second after each change, and when the page is hidden or closed.
  Open it in DBeaver or DB Browser for SQLite only while the app is closed.
- `insight-plan-models/` in the project folder: each model's IFC, its converted copy and a short history, as plain files.
- Keep a project in a OneDrive folder if you like, but only one person should have it open at a time.

## Code
- `src/db/core.ts`: the project database logic, shared with the server (`vite-plugins/db/projectDb.ts`).
- `src/web/`: the browser side (SQLite in WebAssembly, the worker, the folder handling, the model store).
- Tests: `tests/unit/browserDb.test.ts`, `tests/unit/modelStore.test.ts`, `tests/unit/projectDb.test.ts`.

## Licence key
- The app asks for a key on first start (`src/licence/`). The key is signed (ECDSA P-256), so it is checked in the browser with no
  server, and kept in the browser's storage. It carries the customer, the last day of use and the number of seats; a warning shows in the last 30 days.
- Issue keys with `node tools/licence.mjs issue "Customer" 2027-10-10 --seats 3`. The signing key is `tools/licence-private.jwk`
  (git-ignored): **back it up and keep it secret**; if it is lost, every customer needs a new build with a new public key.
- This stops casual copying; it cannot stop someone who edits the built files.

## Install and offline
- The built site is an installable app (manifest + service worker, made by `vite-plugins/offlineApp.ts`). Chrome and Edge offer
  Install in the address bar; after the first visit it opens with no network.
- The service worker keeps every file of the build. A new build gets a new version and replaces them on the next visit
  (the second open after a deploy shows it).
- Host `sw.js` and `index.html` with no long caching, or updates are late.
