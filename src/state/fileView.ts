/** The Files list's own view (filters, grouping, sorting, columns, collapsed groups) belongs to the scene. It is kept in the same saved
    key as the file details (models.fileDetails), so these helpers split the two: the scene snapshot keeps the whole key, while the
    project database (shared by every scene) and workspaces only ever carry the details, never the view. */

export const FILE_VIEW_KEY = 'models.fileDetails';
export const FILE_VIEW_PROPS = ['filters', 'paused', 'groupRules', 'groupCombine', 'sortRules', 'columns', 'collapsed'] as const;

type Saved = { state?: Record<string, unknown> } & Record<string, unknown>;
const parse = (text: string | null | undefined): Saved | null => {
  if (!text) return null;
  try {
    const p = JSON.parse(text) as Saved;
    return p && typeof p === 'object' && p.state && typeof p.state === 'object' ? p : null;
  } catch {
    return null;
  }
};

/** The view part of a saved key (empty when there is none). */
export function viewOf(text: string | null | undefined): Record<string, unknown> {
  const state = parse(text)?.state;
  const out: Record<string, unknown> = {};
  if (state) for (const p of FILE_VIEW_PROPS) if (p in state) out[p] = state[p];
  return out;
}

/** `text` with its view replaced by the one of `viewText` (none: the view is taken out). Text that cannot be read is returned as it is. */
export function withView(text: string, viewText: string | null | undefined): string {
  const parsed = parse(text);
  if (!parsed?.state) return text;
  const view = viewOf(viewText);
  for (const p of FILE_VIEW_PROPS) {
    if (p in view) parsed.state![p] = view[p];
    else delete parsed.state![p];
  }
  return JSON.stringify(parsed);
}

export const stripView = (text: string) => withView(text, null);

/** While Home shows another scene's Files view in the store, nothing the store saves may reach the browser's key (that is the scene you are in). */
export const foreignView = { on: false };
