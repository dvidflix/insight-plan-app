/** The icons a marker can have (24 × 24 paths, filled). "Point coordinates" is the default. */
export interface MarkerIconDef {
  id: string;
  label: string;
  /** Bubble colour. */
  color: string;
  /** SVG path data; null for the plain dot of the default. */
  path: string | null;
}

export const MARKER_ICONS: MarkerIconDef[] = [
  { id: 'point', label: 'Point coordinates', color: '#d6336c', path: null },
  { id: 'pin', label: 'Pin', color: '#1c7ed6', path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z' },
  { id: 'flag', label: 'Flag', color: '#2f9e44', path: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z' },
  { id: 'warning', label: 'Warning', color: '#f08c00', path: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z' },
  { id: 'info', label: 'Info', color: '#1971c2', path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z' },
  { id: 'camera', label: 'Camera', color: '#7048e8', path: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z' },
  { id: 'star', label: 'Star', color: '#e8590c', path: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' },
  { id: 'check', label: 'Check', color: '#2b8a3e', path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' },
];

export const DEFAULT_MARKER_ICON = 'point';

export const markerIcon = (id: string): MarkerIconDef => MARKER_ICONS.find((i) => i.id === id) ?? MARKER_ICONS[0];

/** An icon from what was typed or pasted: its id or its name, in any case. */
export function iconFromText(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return MARKER_ICONS.find((i) => i.id === t || i.label.toLowerCase() === t)?.id ?? null;
}
