import type { DockPanelId } from '../state/dockStore';

/** The four kinds of panel, each with its own colour in the navigation bars: muted tones that sit with the app's green accent
    (slate blue, a deeper green, ochre, plum). */
export type PanelKind = 'planning' | 'models' | 'others' | 'settings';

export const PANEL_KIND_COLOR: Record<PanelKind, string> = {
  planning: '#4a6fa5',
  models: '#2f8466',
  others: '#b0803a',
  settings: '#8a6a9e',
};

const PLANNING: DockPanelId[] = ['details', 'links', 'predecessors', 'successors', 'layouts', 'planning', 'gantt', 'resources', 'scenarios', 'recipes', 'rules', 'dictionary', 'generated', 'tasks'];
const MODELS: DockPanelId[] = ['related', 'tree', 'properties', 'search', 'views', 'viewpoints', 'colour', 'clash', 'datatable', 'topics', 'fourD'];
const SETTINGS: DockPanelId[] = ['settings', 'scenarioSettings', 'cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor'];

export function panelKind(id: DockPanelId): PanelKind {
  if (SETTINGS.includes(id)) return 'settings';
  if (PLANNING.includes(id)) return 'planning';
  if (MODELS.includes(id)) return 'models';
  return 'others';
}

export const panelColor = (id: DockPanelId) => PANEL_KIND_COLOR[panelKind(id)];
