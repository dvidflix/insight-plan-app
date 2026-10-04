import { create } from 'zustand';

/** Settings > Appearance: the accent colour of the app (buttons, selections, the Gantt's bars,
    highlights). Each palette sets the accent variables in the CSS (html.accent-<id>); Standard,
    the green, is the default. Stored under a "viewer." key, so the app configuration file and
    the project database carry it. */
const KEY = 'viewer.accentPalette';

export interface AccentPalette {
  id: string;
  label: string;
  /** For the swatches: accent, strong, bright. */
  colors: [string, string, string];
}

export const ACCENT_PALETTES: AccentPalette[] = [
  { id: 'standard', label: 'Standard (green)', colors: ['#1b8d68', '#0f7d5b', '#1f9d69'] },
  { id: 'ocean', label: 'Ocean (blue)', colors: ['#1d6fb8', '#14558f', '#2b86d6'] },
  { id: 'teal', label: 'Teal', colors: ['#0f8a94', '#0a6d75', '#17a2ad'] },
  { id: 'violet', label: 'Violet', colors: ['#6d4fd6', '#5638b8', '#7e63e6'] },
  { id: 'rose', label: 'Rose', colors: ['#cc3f6c', '#a82d56', '#e05683'] },
  { id: 'amber', label: 'Amber', colors: ['#d9731a', '#b45a0c', '#ee8a2e'] },
  { id: 'graphite', label: 'Graphite', colors: ['#4b5563', '#374151', '#6b7280'] },
];

const apply = (id: string) => {
  for (const p of ACCENT_PALETTES) document.documentElement.classList.toggle(`accent-${p.id}`, p.id === id && id !== 'standard');
};

function load(): string {
  try {
    const saved = localStorage.getItem(KEY);
    return ACCENT_PALETTES.some((p) => p.id === saved) ? (saved as string) : 'standard';
  } catch {
    return 'standard';
  }
}

export const useAccentPaletteStore = create<{ id: string; setId: (id: string) => void }>((set) => ({
  id: load(),
  setId: (id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // not remembered
    }
    apply(id);
    set({ id });
  },
}));

apply(load());

// Settings pulled in from the project database (db/uiSettingsSync.ts).
window.addEventListener('ip-ui-settings', (e) => {
  if (!(e as CustomEvent<{ keys: string[] }>).detail.keys.includes(KEY)) return;
  const id = load();
  apply(id);
  useAccentPaletteStore.setState({ id });
});

/** The accent as a colour string, for canvas drawing (follows the palette). */
export const accentColor = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#1b8d68';
