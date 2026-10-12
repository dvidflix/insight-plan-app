/** Two editions of the app from one code base. The "internal" one (the default) keeps every integration the team uses.
    The "product" edition (built with VITE_EDITION=product, see `npm run build:product`) is for customers: it works fully
    offline and never contacts GitHub, SeaTable or Superset — those features are off, in the screens and on the server. */
export const EDITION: 'internal' | 'product' | 'web' = import.meta.env.VITE_EDITION === 'product' ? 'product' : import.meta.env.VITE_EDITION === 'web' ? 'web' : 'internal';

const internal = EDITION === 'internal';

export const FEATURES = {
  /** "Update available" from GitHub, and Update now (git pull). */
  selfUpdate: internal,
  /** File details and model data synced with SeaTable. */
  seatable: internal,
  /** The External data and Dashboards pages (SeaTable / Superset in a frame). */
  externalPages: internal,
  /** The project database and files live in this browser and the chosen folder (the web edition has no server). */
  browserData: EDITION === 'web',
  /** The Scenarios generator (needs the Python engine on a server). */
  scenarios: EDITION !== 'web',
  /** Editing and deleting Wiki pages, and writing model fixes back to IDS files (they write files in the app's own folder). */
  serverFiles: EDITION !== 'web',
  /** Reading projects from a P6 Professional database by its path on disk. */
  p6Database: EDITION !== 'web',
  /** The Help tab, in every edition (Settings > Window switches it on and off, like the Wiki). The team's Timelines and Wiki tabs are not part of the shipped editions. */
  help: true,
  teamPages: internal,
  /** The licence check at start-up: the browser edition is only for licensed customers. */
  licence: EDITION === 'web',
} as const;
