import { create } from 'zustand';

export type Theme = 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>(() => ({
  theme: 'light',
  toggle: () => undefined,
}));
