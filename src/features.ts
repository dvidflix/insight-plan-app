/** Two editions of the app from one code base. The "internal" one (the default) keeps every integration the team uses.
    The "product" edition (built with VITE_EDITION=product, see `npm run build:product`) is for customers: it works fully
    offline and never contacts GitHub, SeaTable or Superset — those features are off, in the screens and on the server. */
export const EDITION: 'internal' | 'product' = import.meta.env.VITE_EDITION === 'product' ? 'product' : 'internal';

const internal = EDITION === 'internal';

export const FEATURES = {
  /** "Update available" from GitHub, and Update now (git pull). */
  selfUpdate: internal,
  /** File details and model data synced with SeaTable. */
  seatable: internal,
  /** The External data and Dashboards pages (SeaTable / Superset in a frame). */
  externalPages: internal,
} as const;
