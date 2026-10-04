import { create } from 'zustand';

/** Settings > Accessibility > Colour palette. 'colour-blind' swaps the status
    and critical colours (green / red) for a blue / orange set that stays
    distinguishable with the common kinds of colour-blindness (the Okabe-Ito
    palette). Stored under a "viewer." key, so the app configuration file
    carries it; applied as a class on <body> that the CSS variables follow. */
const KEY = 'viewer.colourPalette';

export type ColourPalette = 'standard' | 'colour-blind';

const apply = (p: ColourPalette) => document.body.classList.toggle('cb-safe', p === 'colour-blind');

function load(): ColourPalette {
  try {
    return localStorage.getItem(KEY) === 'colour-blind' ? 'colour-blind' : 'standard';
  } catch {
    return 'standard';
  }
}

export const useAccessibilityStore = create<{ palette: ColourPalette; setPalette: (p: ColourPalette) => void }>((set) => ({
  palette: load(),
  setPalette: (palette) => {
    try {
      localStorage.setItem(KEY, palette);
    } catch {
      // not remembered
    }
    apply(palette);
    set({ palette });
  },
}));

apply(load());

// Settings pulled in from the project database (db/uiSettingsSync.ts).
window.addEventListener('ip-ui-settings', (e) => {
  if (!(e as CustomEvent<{ keys: string[] }>).detail.keys.includes(KEY)) return;
  const palette = load();
  apply(palette);
  useAccessibilityStore.setState({ palette });
});
