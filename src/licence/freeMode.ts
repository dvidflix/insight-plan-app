import { FEATURES } from '../features';
import { STORE_KEY } from './licence';

/** The free edition: the browser edition without a licence key. It is fully usable but keeps nothing, so models are
    loaded and settings chosen again every visit. The check is synchronous (a key is saved or it is not) so this module can
    run before any store reads its saved settings; whether a saved key is valid is checked afterwards by the LicenceGate. */
const hasKey = () => {
  try {
    return !!window.localStorage.getItem(STORE_KEY);
  } catch {
    return false;
  }
};
export const FREE_MODE = FEATURES.licence && !hasKey();

/** localStorage kept in memory. Only the licence key goes through to the real storage, so entering one survives a reload. */
export function createMemoryStorage(real?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Storage {
  const data = new Map<string, string>();
  const through = (k: string) => k === STORE_KEY && real;
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (through(k) ? real!.getItem(k) : data.get(String(k)) ?? null),
    setItem: (k, v) => { if (through(k)) real!.setItem(k, String(v)); else data.set(String(k), String(v)); },
    removeItem: (k) => { if (through(k)) real!.removeItem(k); else data.delete(String(k)); },
    clear: () => data.clear(),
  };
}

if (FREE_MODE) {
  try {
    Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(window.localStorage), configurable: true });
  } catch {
    /* the browser would not let it be replaced: the free edition then saves like any other */
  }
}
