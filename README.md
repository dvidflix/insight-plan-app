# Insight Plan

A browser app for construction planning with BIM. Load IFC models and Primavera P6 programmes, interrogate each on its own, link activities to model objects, and review the build as a 4D sequence — then export it as images, video or a Navisworks TimeLiner pack.

Models are converted and rendered locally in the browser. The dev server adds the project database (SQLite, P6 tables), the Scenarios generator (Python), app updates and the Wiki.

## Documentation: the Wiki

Everything about the app and the team's standards is in the **Wiki** tab of the app — Markdown pages in [`docs/wiki`](docs/wiki), editable in the app (or any Markdown editor, e.g. VS Code or Obsidian), shipped with the app's updates:

- **Standards** — [Activity ID structure](docs/wiki/standards/activity-id-structure.md)
- **App guide** — [overview](docs/wiki/app-guide/index.md): [Inputs](docs/wiki/app-guide/inputs.md), [Models](docs/wiki/app-guide/models.md), [Programmes](docs/wiki/app-guide/programmes.md), [Scenarios](docs/wiki/app-guide/scenarios.md), [4D Sequencing](docs/wiki/app-guide/4d-sequencing.md), [Scheduling logic](docs/wiki/app-guide/scheduling-logic.md), [Project database](docs/wiki/app-guide/project-database.md), [How the app is built](docs/wiki/app-guide/how-the-app-is-built.md), [Data, persistence and limitations](docs/wiki/app-guide/data-and-limitations.md)

To add screenshots or videos, edit a page in the app and paste or drop them in (they are saved in `docs/wiki/media`). Commit and push wiki changes to share them.

## Getting started

### Setting up on a new laptop

1. Ask for access to the GitHub repository (it is private), and accept the invitation e-mail.
2. Get **`setup/Install Insight Plan.cmd`** (from GitHub, or sent to you) and double-click it. It:
   - installs **Git**, **Node.js** (LTS, 22.5 or later) and **Python 3.12** with winget, if missing — Windows may ask for permission;
   - downloads the app into `%USERPROFILE%\Insight Plan` — the first time, a browser window asks you to sign in to GitHub;
   - installs the app's packages (npm) and the Scenarios generator's (pip), and sets `SCENARIO_PYTHON`;
   - adds an **Insight Plan** shortcut, with the app's icon, to the Desktop and Start menu.

   Running it again repairs the install and gets the latest version. GitHub Desktop is not needed.
3. Pin it to the taskbar: find **Insight Plan** in the Start menu, right-click > **Pin to taskbar** (or right-click the Desktop shortcut > *Show more options* > **Pin to taskbar**). Start the app from there from then on: it runs `Autorun.bat` minimised and opens the app in its own Chrome (or Edge) window, without the bookmarks and address bars. For a copy cloned somewhere else, **`setup/Create shortcuts.cmd`** makes the same shortcuts for that folder.

If winget is blocked on a managed laptop, install Git, Node.js LTS and Python 3.12 by hand, then run the installer again.

**Something not working?** Double-click **`setup/Check Insight Plan.cmd`**. It checks Node.js, the Scenarios generator's Python (`SCENARIO_PYTHON`) and its packages (ifcopenshell, ifcclash, pandas, openpyxl), says what is missing and offers to install it. Patching a model (Model checks › Apply, the property editor) needs no Python, but the model's `.ifc` must have been loaded in the current session, and a project folder open to save the `_FIXED.ifc` into (without one it is downloaded).

**Updates.** The app checks GitHub for a newer version a few seconds after it starts, then every two hours. When there is one, **Update available** shows in the top bar with the list of changes; **Update now** runs `Autorun.bat update` (stops the server, `git pull`, npm and pip packages, starts it again) and the page reloads by itself. A copy with local changes (a developer's) is never updated from the app.

### Developing

Requirements: **Node.js 22.5+** (npm) — the project database uses Node's built-in SQLite (`node:sqlite`); older Node still runs the app, without the database. For the Scenarios tab only: **Python 3.12**.

```bash
npm install
npm run dev          # http://localhost:5173
```

On Windows, `Autorun.bat` does the same in one window: it stops a running copy, installs dependencies, then runs the server in that window and opens the app once it answers. Closing the window stops the app.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (includes the Scenarios bridge) |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |

**Scenarios** (optional) needs the Python generator's packages:

```bash
pip install -r scenario-engine/requirements.txt
# set SCENARIO_PYTHON to use a specific interpreter instead of `python`
```

Sample files to try the app with are in `samples/` (IFC models, a P6 XML programme).
