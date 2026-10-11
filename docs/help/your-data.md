<!-- order: 9 -->
# Your data and saving

## Where things are kept

Everything stays on your computer. Nothing is sent to a server.

- **The project folder** you chose in Inputs holds:
  - `insight-plan.db`: your programmes, link groups, capacities, settings and clash results. It is an ordinary SQLite file.
  - `insight-plan-models/`: each model you loaded, its converted copy and a short history, as plain files.
- **The licence key** is kept in the browser.

## Saving

Changes are saved to the project folder automatically, about a second after each change, and again when you hide or close the page. The Inputs page shows the save state. There is no Save button.

## Back up and share

- Copy the project folder to back it up.
- Keep it in OneDrive if you like, but **only one person should have a project open at a time**. Two people editing the same file at once will overwrite each other.
- Open `insight-plan.db` in DB Browser for SQLite only while the app is **closed**.

## Working offline

After you install the app (see [Getting started](getting-started.md)) it works with no internet. A new version of the app is picked up the next time you open it with internet access.

## What this edition does not have

The browser edition has no server side, so a few things are not available and are left out of the screens:

- the Scenarios pour-by-pour programme generator
- linking to a P6 Professional database by its file path (load an `.xer` or `.xml` file instead)
- writing model fixes and property edits back to IFC files
- importing IDS files
- cloud connections such as SeaTable and Superset
- automatic update from a code repository

## If something goes wrong

- **"None chosen" under Project folder**: press **Choose folder…**, or **Allow … again** if you used one before.
- **The browser cannot pick a folder**: use Chrome or Edge.
- **A model does not appear**: large IFC files take time to convert. Wait for the progress to finish.
- **The licence screen comes back**: the key has run out, or the browser cleared its storage. Enter the key again, or ask for a renewal.
