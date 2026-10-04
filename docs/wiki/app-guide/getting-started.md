<!-- order: 1 -->
<!-- group: Start here -->
# Getting started

## Setting up on a new laptop

1. Ask for access to the GitHub repository (it is private), and accept the invitation e-mail.
2. Get **`setup/Install Insight Plan.cmd`** (from GitHub, or sent to you) and double-click it. It:
   - installs **Git**, **Node.js** (LTS, 22.5 or later) and **Python 3.12** with winget, if missing — Windows may ask for permission;
   - downloads the app into `%USERPROFILE%\Insight Plan` — the first time, a browser window asks you to sign in to GitHub;
   - installs the app's packages (npm) and the Scenarios generator's (pip), and sets `SCENARIO_PYTHON`;
   - adds an **Insight Plan** shortcut to the Desktop and Start menu.

   Running it again repairs the install and gets the latest version. GitHub Desktop is not needed.
3. Start the app from the **Insight Plan** shortcut (`Autorun.bat`).

If winget is blocked on a managed laptop, install Git, Node.js LTS and Python 3.12 by hand, then run the installer again.

**Updates.** The app checks GitHub for a newer version a few seconds after it starts, then every two hours. When there is one, **Update available** shows in the top bar with the list of changes; **Update now** runs `Autorun.bat update` (stops the server, `git pull`, npm and pip packages, starts it again) and the page reloads by itself. A copy with local changes (a developer's) is never updated from the app.

## Developing

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
