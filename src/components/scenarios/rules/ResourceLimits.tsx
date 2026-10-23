import { useRecipeStore } from '../../../state/recipeStore';
import { useScenarioStore } from '../../../state/scenarioStore';
import type { LimitRow } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';
import { GroupPicker } from './GroupPicker';

/** Limits, as one spreadsheet (like Parameters): which activity, for which group, how many may run at once, and where that number comes from (a plain
    number, a resource's quantity or a parameter). The same rows as the Limits table of the workbook: nothing is kept twice. The common case, one
    limit for every activity that uses a resource, is the "Max at once" cell of the resource table; this is the place for a different limit on one activity. */

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const limitMax = (t: string): number | string => (t.trim() !== '' && Number.isFinite(Number(t)) ? Number(t) : t);

export function ResourceLimits() {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const pools = useRecipeStore((s) => s.pools).filter((p) => p.kind !== 'material');
  const recipes = useRecipeStore((s) => s.recipes);
  const limits = ctx.rules.limits;
  const parameters = ctx.rules.parameters ?? [];
  const setLimits = (next: LimitRow[]) => ctx.change((r) => ({ ...r, limits: next }));
  const rows = limits.map((l, i) => ({ l, i }));
  const grid = useEditableGrid({ widthsKey: 'resources.limits',
    rows,
    get: (col, { l }) => (col === 'phase' ? l.phase : col === 'group' ? l.group ?? '' : col === 'max' ? String(l.max) : l.note ?? ''),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [rows[at].i, text]));
      setLimits(limits.map((x, j) => {
        const t = to.get(j);
        if (t === undefined) return x;
        return col === 'phase' ? { ...x, phase: t } : col === 'group' ? { ...x, group: t || undefined } : col === 'max' ? { ...x, max: limitMax(t) } : { ...x, note: t || undefined };
      }));
    },
  });
  if (!scenarioOpen) return <div className="scn-dim scn-editor__help">Open a scenario to edit its limits: they are part of the scenario.</div>;

  /** Where the number of a limit comes from, in words, and what is wrong with it. */
  const source = (l: LimitRow): { text: string; problem: string } => {
    if (typeof l.max === 'number') return { text: 'a number', problem: '' };
    const t = l.max.trim();
    if (!t) return { text: 'no limit', problem: '' };
    if (Number.isFinite(Number(t))) return { text: 'a number', problem: '' };
    const pool = pools.find((p) => same(p.id, t) || (p.name.trim() !== '' && same(p.name, t)));
    if (pool) return { text: `${pool.name || pool.id}: ${pool.quantity} available`, problem: '' };
    const param = parameters.find((p) => same(p.name, t));
    if (param) return { text: `parameter ${param.name} = ${param.value}`, problem: '' };
    return { text: 'not found', problem: `“${l.max}” is not a number, a resource ID or a parameter` };
  };
  const phases = [...new Set(recipes.flatMap((r) => r.tasks.map((t) => t.phase)).filter(Boolean))];
  const add = () => setLimits([...limits, { id: `Limit-${limits.length + 1}`, phase: phases[0] ?? '', max: pools[0]?.id ?? 1 }]);

  return (
    <div>
      <div className="rel-bar">
        <button type="button" className="btn btn--small primary" onClick={add}>+ Limit</button>
        <span className="scn-dim hint">At most this many of an activity run at the same time. Type a number, or a resource ID to use its quantity. For all the activities that use a resource, set “Max at once” on the resource instead.</span>
      </div>
      {rows.length === 0 ? <div className="scn-dim scn-editor__help">No limits yet.</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 200 }} /><col style={{ width: 200 }} /><col style={{ width: 150 }} /><col style={{ width: 250 }} /><col style={{ width: 260 }} /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this limit" /><th>Activity</th><th title="Only the objects of this group (empty: every object)">Logical group</th><th title="A number, or a resource ID, or a parameter name">How many at once</th><th title="Where that number comes from">Number from</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map(({ l, i }, at) => {
              const set = (patch: Partial<LimitRow>) => setLimits(limits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const src = source(l);
              return (
                <tr key={i} data-line={at} className={l.enabled === false ? 'is-off' : ''}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__check"><input type="checkbox" checked={l.enabled !== false} onChange={(e) => set({ enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                  <td className={`xl__cell xgrid__cell${grid.sel('phase', at)}`} data-col="phase" data-row={at}><input {...grid.cell('phase', at)} list="res-limit-phases" value={l.phase} onChange={(e) => set({ phase: e.target.value })} />{grid.handle('phase', at)}</td>
                  <td className="xl__cell"><GroupPicker value={l.group ?? ''} none="every object" folders={ctx.groupFolders} title="Only the objects of this group (every object: no group)" onChange={(group) => set({ group: group || undefined })} /></td>
                  <td className={`xl__cell xl__num xgrid__cell${grid.sel('max', at)}${src.problem ? ' is-bad' : ''}`} data-col="max" data-row={at}><input {...grid.cell('max', at)} list="res-limit-sizes" value={l.max} placeholder="4 or RES-1" aria-invalid={!!src.problem} title={src.problem} onChange={(e) => set({ max: limitMax(e.target.value) })} />{grid.handle('max', at)}</td>
                  <td className="xl__cell xl__ro" title={src.problem || src.text}>{src.text}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('note', at)}`} data-col="note" data-row={at}><input {...grid.cell('note', at)} value={l.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />{grid.handle('note', at)}</td>
                  <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => setLimits(limits.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
                </tr>
              );
            })}
            <tr className="xl__add"><th className="xl__row">*</th><td colSpan={7}><button type="button" onClick={add}>+ Add a limit</button></td></tr>
          </tbody>
        </table>
      )}
      <datalist id="res-limit-phases">{phases.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="res-limit-sizes">{[...pools.map((p) => p.id), ...parameters.map((p) => p.name)].map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}
