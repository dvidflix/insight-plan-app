import type { DockPanelId } from '../state/dockStore';

/** The four kinds of panel (planning only, common to both, 3D / 4D, secondary), each with its own colour in the navigation bars: muted tones that sit with the app's green accent
    (slate blue, a deeper green, ochre, plum). */
export type PanelKind = 'planning' | 'models' | 'others' | 'settings';

export const PANEL_KIND_COLOR: Record<PanelKind, string> = {
  planning: '#4a6fa5',
  models: '#2f8466',
  others: '#b0803a',
  settings: '#8a6a9e',
};

const PLANNING: DockPanelId[] = ['details', 'links', 'predecessors', 'successors', 'layouts', 'planning'];
const COMMON: DockPanelId[] = ['files', 'datatable', 'gantt', 'tasks', 'resources', 'distribution', 'scenarios'];
const MODELS: DockPanelId[] = ['related', 'tree', 'properties', 'search', 'views', 'viewpoints', 'colour', 'clash', 'topics', 'fourD', 'checks', 'compare'];
const SETTINGS: DockPanelId[] = ['settings', 'cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor', 'dictionary', 'generated'];
/** The groups of the Navigation Bar menu, in order: the planning-only panels, those common to both, the 3D / 4D ones, and the secondary ones (settings and the like). */
export const PANEL_KIND_ORDER: PanelKind[] = ['planning', 'others', 'models', 'settings'];

export function panelKind(id: DockPanelId): PanelKind {
  if (SETTINGS.includes(id)) return 'settings';
  if (PLANNING.includes(id)) return 'planning';
  if (MODELS.includes(id)) return 'models';
  if (COMMON.includes(id)) return 'others';
  return 'others';
}

export const panelColor = (id: DockPanelId) => PANEL_KIND_COLOR[panelKind(id)];
