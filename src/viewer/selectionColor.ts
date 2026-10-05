/** The colour selected objects are drawn in (the highlighter's "select" style).
    One for the whole viewer; set in View settings > Selection, remembered under
    a "viewer." key so the app configuration file carries it. */
export const SELECTION_COLOR_KEY = 'viewer.selectionColor';
export const DEFAULT_SELECTION_COLOR = '#1e88e5';
export const SELECTION_COLORS = [
  { label: 'Orange', hex: '#ff8a00' },
  { label: 'Blue', hex: '#1e88e5' },
  { label: 'Purple', hex: '#7c5cff' },
  { label: 'Green', hex: '#1b8d68' },
];
