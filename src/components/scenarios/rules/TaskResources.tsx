import type { PoolKind, ScenarioRules } from '../../../prs/rules';
import type { RecipeTask, ResourceUse } from '../../../prs/recipes';
import { useEditableGrid } from '../../useEditableGrid';

/** The resources of the selected task, laid out as in P6: one row per resource of the Resources pools (equipment, cranes, materials), and a
    number to type in the row to assign it to the task. Select another task and the same list is there for that one. */

const KEY: Record<PoolKind, 'equipment' | 'cranes' | 'materials'> = { equipment: 'equipment', crane: 'cranes', material: 'materials' };
const KIND_LABEL: Record<PoolKind, string> = { equipment: 'Equipment', crane: 'Crane', material: 'Material' };
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function TaskResources({ task, rules, onPatch }: { task: RecipeTask; rules: Pick<ScenarioRules, 'resourcePools' | 'crewTemplates'>; onPatch: (patch: Partial<RecipeTask>) => void }) {
  const countOf = (kind: PoolKind, type: string): number | undefined => (task[KEY[kind]] ?? []).find((u) => same(u.type, type))?.count ?? ((task[KEY[kind]] ?? []).some((u) => same(u.type, type)) ? 1 : undefined);
  /** The list of a kind with the units of a resource set (none: taken off). An assigned resource keeps its place; a new one goes at the end. */
  const withUnits = (list: ResourceUse[], type: string, raw: string): ResourceUse[] => {
    const n = raw.trim() === '' ? 0 : Number(raw);
    const use: ResourceUse = { type, ...(n === 1 ? {} : { count: n }) };
    return !(Number.isFinite(n) && n > 0) ? list.filter((u) => !same(u.type, type)) : list.some((u) => same(u.type, type)) ? list.map((u) => (same(u.type, type) ? use : u)) : [...list, use];
  };
  const assign = (kind: PoolKind, type: string, raw: string) => {
    const key = KEY[kind];
    const next = withUnits(task[key] ?? [], type, raw);
    onPatch({ [key]: next.length ? next : undefined });
  };
  const rows = rules.resourcePools.filter((p) => p.enabled !== false).map((p) => ({ kind: p.kind, type: p.id, name: p.name }));
  // A type the task names that has no pool: shown so it can be seen and cleared.
  for (const kind of Object.keys(KEY) as PoolKind[]) {
    for (const u of task[KEY[kind]] ?? []) if (!rows.some((r) => r.kind === kind && same(r.type, u.type))) rows.push({ kind, type: u.type, name: '' });
  }
  // The Units column as a spreadsheet's: range, fill down (Ctrl+D, the corner square), copy and paste. One patch for all the cells.
  const grid = useEditableGrid({ widthsKey: 'recipe.taskResources',
    rows,
    get: (_col, r) => { const n = countOf(r.kind, r.type); return n === undefined ? '' : String(n); },
    write: (_col, cells) => {
      const lists: Partial<Record<'equipment' | 'cranes' | 'materials', ResourceUse[]>> = {};
      for (const [at, text] of cells) {
        const r = rows[at];
        const key = KEY[r.kind];
        lists[key] = withUnits(lists[key] ?? task[key] ?? [], r.type, text);
      }
      onPatch(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v && v.length ? v : undefined])) as Partial<RecipeTask>);
    },
  });
  const crew = rules.crewTemplates.find((c) => same(c.id, task.crew ?? ''));
  const people = crew ? crew.trades.reduce((n, t) => n + (t.size || 0), 0) : 0;

  return (
    <div className="rel-scroll">
      <div className="rel-bar">
        <strong>{task.name || task.phase || 'Task'}: resources</strong>
        <span className="scn-dim">{task.crew ? `Crew ${task.crew}${people ? ` · ${people} people` : ''}` : 'No crew'} · type a number to assign a resource, empty to remove it</span>
      </div>
      {rows.length === 0 ? (
        <div className="scn-dim scn-editor__help">No resources yet: add equipment, cranes and materials under "Resources" at the top of the panel.</div>
      ) : (
        <table className="rel-table rel-table--grid xgrid" {...grid.grid}>
          <thead><tr><th>Kind</th><th>Resource</th><th>Name</th><th title="How many the task uses at once">Units</th></tr></thead>
          <tbody>
            {rows.map((r, at) => {
              const n = countOf(r.kind, r.type);
              const known = rules.resourcePools.some((p) => p.kind === r.kind && same(p.id, r.type));
              return (
                <tr key={`${r.kind}|${r.type}`} data-line={at} className={n ? 'is-assigned' : undefined} title={known ? undefined : 'This type has no pool: it gets no resource'}>
                  <td className="scn-dim">{KIND_LABEL[r.kind]}</td>
                  <td>{r.type}{known ? '' : ' (no pool)'}</td>
                  <td className="scn-dim">{r.name}</td>
                  <td className={`xgrid__cell${grid.sel('units', at)}`} data-col="units" data-row={at}><input className="rel-cell" type="number" min={0} step="any" style={{ width: 64 }} value={n ?? ''} onChange={(e) => assign(r.kind, r.type, e.target.value)} aria-label={`${r.type} units`} />{grid.handle('units', at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
