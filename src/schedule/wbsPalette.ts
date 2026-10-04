/** Ported from insight-plan-web's WBS_PALETTES (js/app.js) — colored by WBS
    nesting depth (not a hash of the path) so the same level always reads
    the same color across groups, and depth is visually obvious at a
    glance. Cycles if the tree goes deeper than the palette. */
export interface WbsPalette {
  label: string;
  colors: string[];
  text: string[];
}

export const WBS_PALETTES: Record<string, WbsPalette> = {
  project: {
    label: 'Project',
    colors: ['#00588B', '#0678A7', '#59571A', '#F2B708', '#F1860D', '#7788FF', '#7B8787', '#C8C5C1'],
    text: ['#fff', '#fff', '#fff', '#1e293b', '#1e293b', '#fff', '#fff', '#1e293b'],
  },
  light: {
    label: 'Light',
    colors: ['#FFD9C8', '#D7E8FF', '#DAD7FF', '#DEF7C4', '#FFD4FF', '#DDFFE6', '#FFDDE5', '#D8FAFF', '#FFEAB6', '#FFFCB5'],
    text: new Array(10).fill('#1e293b'),
  },
  // Primavera P6's default 20-level WBS layout (Layout Settings > Color & Font).
  p6: {
    label: 'P6',
    colors: [
      '#0000FF', '#80FF80', '#FFFF00', '#0000FF', '#FF0000', '#80FFFF', '#FF80FF', '#FFFF80', '#000000', '#C0C0C0',
      '#008000', '#000080', '#804000', '#800080', '#FF8040', '#8080C0', '#808040', '#808080', '#408080', '#8080C0',
    ],
    text: [
      '#FFFF00', '#000000', '#0000FF', '#FFFFFF', '#FFFFFF', '#000000', '#000000', '#000000', '#FFFFFF', '#FFFFFF',
      '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF',
    ],
  },
  // Microsoft Project's default outline-level colours (Project Summary = level 0).
  msproject: {
    label: 'MS Project',
    colors: [
      '#2E75B5', '#8492D6', '#838BF9', '#00FFFF', '#CAC5E5', '#A7F7F5', '#ED9DE5', '#FDFD9B', '#000000', '#D8D8D8', '#339147',
      '#1616FA', '#7F5431', '#990099', '#FF9900', '#A3A3C1', '#A8A400', '#9C8C8C', '#429984', '#8C8CB2', '#FFFFFF',
    ],
    text: [
      '#FFFFFF', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#FFFFFF', '#000000', '#FFFFFF',
      '#FFFFFF', '#FFFFFF', '#FFFFFF', '#000000', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#000000',
    ],
  },
};

export const DEFAULT_WBS_PALETTE = 'project';

export function wbsPaletteFor(id: string): WbsPalette {
  return WBS_PALETTES[id] ?? WBS_PALETTES[DEFAULT_WBS_PALETTE]; // an unknown id (e.g. a saved palette that was renamed) falls back to the default
}

/** depth 0 = a top-level WBS band (single "/"-joined segment). */
export function wbsDepthOf(wbsKey: string): number {
  return Math.max(0, wbsKey.split(' / ').filter(Boolean).length - 1);
}

export function wbsGroupColors(wbsKey: string, paletteId: string): { bg: string; fg: string } {
  const palette = wbsPaletteFor(paletteId);
  const depth = wbsDepthOf(wbsKey);
  return {
    bg: palette.colors[depth % palette.colors.length],
    fg: palette.text[depth % palette.text.length],
  };
}
