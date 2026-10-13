import path from 'node:path';

/** Where the scenario generator finds the local copies of the SeaTable data (the wall-class rates, and the retired / extra activities).
    The generator has no location of its own: the dev server hands it these, so a different machine only sets INSIGHT_DATA_DIR (or the
    two file variables) and the engine code never names a path. */
const DATA_DIR = process.env.INSIGHT_DATA_DIR ?? 'C:\insight-stack\data';

export const RATES_FILE = process.env.INSIGHT_RATES_FILE ?? path.join(DATA_DIR, 'rates.json');
export const ADJUSTMENTS_FILE = process.env.INSIGHT_ADJUSTMENTS_FILE ?? path.join(DATA_DIR, 'adjustments.json');

/** The environment the generator process runs in. */
export const engineEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  INSIGHT_RATES_FILE: RATES_FILE,
  INSIGHT_ADJUSTMENTS_FILE: ADJUSTMENTS_FILE,
  ...extra,
});
