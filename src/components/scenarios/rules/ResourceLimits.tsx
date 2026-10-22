import { useRecipeStore } from '../../../state/recipeStore';
import { useScenarioStore } from '../../../state/scenarioStore';
import type { LimitRow, PoolRow } from '../../../prs/rules';
import { IconRemove } from '../../icons';
import { useRuleContext } from './RuleParts';
import { useEditableGrid } from '../../useEditableGrid';

/** Limits, shown under the resource they belong to: for each equipment and crane, the activities it limits and how many of them can run at once. A
    limit takes its number from the resource (its "Max at once" is the resource's ID), so the quantity is typed once, in the table above. Limits that
    name no resource (a plain number, or a parameter) are listed last. The same rows as the Limits table of the workbook: nothing is duplicated. */

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const limitMax = (t: string): number | string => (t.trim() !== '' && Number.isFinite(Number(t)) ? Number(t) : t);

type Entry = { l: LimitRow; i: number };

function LimitGroup({ pool, entries, limits, setLimits }: { pool?: PoolRow; entries: Entry[]; limits: LimitRow[]; setLimits: (next: LimitRow[]) => void }) {
  const grid = useEditableGrid({ widthsKey: 'resources.limits',
    rows: entries,
    get: (col, { l }) => (col === 'phase' ? l.phase : col === 'group' ? l.group ?? '' : col === 'max' ? String(l.max) : l.note ?? ''),
    write: (col, cells) => {
      const to = new Map(cells.map(([at, text]) => [entries[at].i, text]));
      setLimits(limits.map((x, j) => {
        const t = to.get(j);
        if (t === undefined) return x;
        return col === 'phase' ? { ...x, phase: t } : col === 'group' ? { ...x, group: t || undefined } : col === 'max' ? { ...x, max: limitMax(t) } : { ...x, note: t || undefined };
      }));
    },
  });
  const add = () => setLimits([...limits, { id: `${pool?.id ?? 'Limit'}-${limits.length + 1}`, phase: 'Formwork', max: pool ? pool.id : 1 }]);
  return (
    <div className="res-limits__group">
      <div className="rel-bar">
        <strong>{pool ? `${pool.name || pool.id} (${pool.id})` : 'Other limits'}</strong>
        <span className="scn-dim">{pool ? `${pool.quantity} available: the activities below share them` : 'A plain number, or a parameter, not a resource'}</span>
        <button type="button" className="btn btn--small" onClick={add}>+ Limit</button>
      </div>
      {entries.length === 0 ? <div className="scn-dim scn-editor__help">{pool ? 'Not limiting any activity yet.' : 'None.'}</div> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 28 }} /><col style={{ width: 200 }} /><col style={{ width: 200 }} /><col style={{ width: 240 }} /><col /><col style={{ width: 32 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th aria-label="On" title="Use this limit" /><th>Activity</th><th>Logical group</th><th title="How many can run at the same time">How many at once</th><th>Notes</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {entries.map(({ l, i }, at) => {
              const set = (patch: Partial<LimitRow>) => setLimits(limits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={i} data-line={at} className={l.enabled === false ? 'is-off' : ''}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__check"><input type="checkbox" checked={l.enabled !== false} onChange={(e) => set({ enabled: e.target.checked ? undefined : false })} aria-label="On" /></td>
                  <td className={`xl__cell xgrid__cell${grid.sel('phase', at)}`} data-col="phase" data-row={at}><input {...grid.cell('phase', at)} list="res-limit-phases" value={l.phase} onChange={(e) => set({ phase: e.target.value })} />{grid.handle('phase', at)}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('group', at)}`} data-col="group" data-row={at}><input {...grid.cell('group', at)} list="res-limit-groups" value={l.group ?? ''} placeholder="every pour" onChange={(e) => set({ group: e.target.value || undefined })} />{grid.handle('group', at)}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('max', at)}`} data-col="max" data-row={at}><input {...grid.cell('max', at)} value={l.max} placeholder="4, or a resource ID" onChange={(e) => set({ max: limitMax(e.target.value) })} />{grid.handle('max', at)}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('note', at)}`} data-col="note" data-row={at}><input {...grid.cell('note', at)} value={l.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />{grid.handle('note', at)}</td>
                  <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => setLimits(limits.filter((_, j) => j !== i))} aria-label="Delete"><IconRemove /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ResourceLimits() {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const pools = useRecipeStore((s) => s.pools);
  const recipes = useRecipeStore((s) => s.recipes);
  const limits = ctx.rules.limits;
  const setLimits = (next: LimitRow[]) => ctx.change((r) => ({ ...r, limits: next }));
  if (!scenarioOpen) return <div className="scn-dim scn-editor__help">Open a scenario to edit its limits: they are part of the scenario.</div>;

  // Which resource a limit takes its number from: its "max" names the resource's ID (or its name).
  const owner = (l: LimitRow): PoolRow | undefined => (typeof l.max === 'string' ? pools.find((p) => p.kind !== 'material' && (same(p.id, l.max as string) || (p.name.trim() !== '' && same(p.name, l.max as string)))) : undefined);
  const all: Entry[] = limits.map((l, i) => ({ l, i }));
  const limiting = pools.filter((p) => p.kind !== 'material');
  const other = all.filter(({ l }) => !owner(l));
  const phases = [...new Set(recipes.flatMap((r) => r.tasks.map((t) => t.phase)).filter(Boolean))];

  return (
    <div>
      {limiting.length === 0 && <div className="scn-dim scn-editor__help">Add equipment or a crane above, then limit the activities that need it here.</div>}
      {limiting.map((p) => <LimitGroup key={p.id} pool={p} entries={all.filter(({ l }) => owner(l) === p)} limits={limits} setLimits={setLimits} />)}
      <LimitGroup entries={other} limits={limits} setLimits={setLimits} />
      <div className="scn-dim xl__note">Limits control how many of an activity run at the same time. A limit that names a resource uses its quantity from the table above.</div>
      <datalist id="res-limit-phases">{phases.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="res-limit-groups">{ctx.groupIds.map((g) => <option key={g} value={g} />)}</datalist>
    </div>
  );
}
