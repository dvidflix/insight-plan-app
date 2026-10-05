/** Outliner (selection outline) and ClipStyler (styled section cuts) settings. */

export interface OutlineSettings {
  /** Outline the selection (a line around it and a tinted fill over it). */
  enabled: boolean;
  color: string;
  fillColor: string;
  fillOpacity: number;
  thickness: number;
}

export const DEFAULT_OUTLINE: OutlineSettings = { enabled: false, color: '#bcf124', fillColor: '#9519c2', fillOpacity: 0.35, thickness: 2 };

/** The kinds of element a section cut fills in their own colour. */
export const SECTION_CATEGORY_DEFS: { id: string; label: string; test: RegExp; color: string }[] = [
  { id: 'walls', label: 'Walls', test: /WALL/i, color: '#c4d4e8' },
  { id: 'slabs', label: 'Slabs & roofs', test: /SLAB|ROOF/i, color: '#e8dcc4' },
  { id: 'columns', label: 'Columns', test: /COLUMN/i, color: '#e8c4c4' },
  { id: 'beams', label: 'Beams & members', test: /BEAM|MEMBER/i, color: '#d9c4e8' },
  { id: 'stairs', label: 'Stairs', test: /STAIR|RAMP/i, color: '#c4e8d4' },
  { id: 'doors', label: 'Doors', test: /DOOR/i, color: '#a8d8a0' },
  { id: 'windows', label: 'Windows & plates', test: /WINDOW|PLATE|CURTAIN/i, color: '#222222' },
  { id: 'footings', label: 'Footings & piles', test: /FOOTING|PILE/i, color: '#b8b8b8' },
];

export interface SectionStyle {
  /** Style the fill and outline of section cuts (otherwise the engine's default). */
  enabled: boolean;
  /** Fill each kind of element in its own colour (otherwise one fill for everything cut). */
  byCategory: boolean;
  fill: string;
  lineColor: string;
  lineWidth: number;
  /** Fill colour per kind (SECTION_CATEGORY_DEFS ids). */
  categories: Record<string, string>;
}

export const DEFAULT_SECTION_STYLE: SectionStyle = {
  enabled: false,
  byCategory: true,
  fill: '#c9d0d8',
  lineColor: '#111111',
  lineWidth: 2,
  categories: Object.fromEntries(SECTION_CATEGORY_DEFS.map((d) => [d.id, d.color])),
};
