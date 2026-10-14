import { create } from 'zustand';

/** Settings > Appearance: Light, Dark, or follow the system. The choice is stored under a "viewer." key (so the app
    configuration file and the project database carry it) and shows as html[data-theme="light" | "dark"], which the CSS
    colour variables follow. index.html applies the same choice before the first paint, so there is no flash. */
const KEY = 'viewer.theme';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const media = window.matchMedia?.('(prefers-color-scheme: dark)');

function load(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
  } catch {
    return 'light';
  }
}

/** The theme in effect: "system" follows the operating system. */
export const resolveTheme = (choice: ThemeChoice): 'light' | 'dark' => (choice === 'system' ? (media?.matches ? 'dark' : 'light') : choice);

const apply = (choice: ThemeChoice) => {
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent('ip-theme', { detail: { theme } }));
};

export const useThemeStore = create<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>((set) => ({
  choice: load(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // not remembered
    }
    apply(choice);
    set({ choice });
  },
}));

apply(load());
media?.addEventListener?.('change', () => {
  if (useThemeStore.getState().choice === 'system') apply('system');
});

// Settings pulled in from the project database (db/uiSettingsSync.ts).
window.addEventListener('ip-ui-settings', (e) => {
  if (!(e as CustomEvent<{ keys: string[] }>).detail.keys.includes(KEY)) return;
  const choice = load();
  apply(choice);
  useThemeStore.setState({ choice });
});

/** True while the dark theme is showing (for canvas drawing, which CSS variables do not reach). */
export const isDark = () => document.documentElement.dataset.theme === 'dark';
