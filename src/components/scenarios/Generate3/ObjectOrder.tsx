import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { scenarioNamesFor, useScenarioStore, orderOfScenario } from '../../../state/scenarioStore';
import { fetchSequence } from '../../../scenarios/api';
import { normalizeRules } from '../../../prs/rules';
import { walkFolder } from '../../../viewer/setTree';
import { className, isFineTuned, type PackageObject, type WorkPackage } from '../../../prs/workPackages';
import { compactOrder, listRows, orderFromRanks, orderRuns, ranksFromList, ranksFromSets, type ObjectOrder } from '../../../prs/objectOrder';
import { useEditableGrid } from '../../useEditableGrid';
import { Dialog, parsePositive } from './Controls';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Fine-tune object order (Generate 3, step 2): the objects of a package built one by one in an order of their own, instead of the package as one
    piece (prs/objectOrder.ts). For the package picked, a grid of its objects with their rank (type, fill down, paste from Excel); for every package,
    only the sources. An order comes from another scenario, from search or selection sets, or from a list (pasted, or an Excel file). The packages keep
    their own order and links: the object order is the order inside each package. */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const LARGE = 300;

export function ObjectOrderDialog({ wp }: { wp: WP }) {
  const scope = useG3((s) => s.orderDialog);
  const setScope = useG3((s) => s.setOrderDialog);
  const picked = useG3((s) => s.picked);
  const row = scope === 'picked' ? wp.rows.find((r) => r.pkg.id === picked) : undefined;
  const live = wp.rows.filter((r) => (wp.contents.objects.get(r.pkg.id)?.length ?? 0) > 0);
  const targets = row ? [row] : scope === 'all' ? live : [];
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  if (!scope) return null;
  const close = () => setScope(null);

  /** Sets the order of each target package from ranks by GlobalId; packages the ranks say nothing of are left as they are. */
  const applyRanks = (ranks: ReadonlyMap<string, number>, what: string, unmatched: string[] = []) => {
    let pkgs = 0;
    let objs = 0;
    const next = wp.packages.map((p) => {
      if (!targets.some((t) => t.pkg.id === p.id)) return p;
      const mine = wp.contents.objects.get(p.id) ?? [];
      const { order, found } = orderFromRanks(mine, ranks);
      if (!found) return p;
      pkgs++;
      objs += found;
      return { ...p, objectOrder: compactOrder(mine, order) };
    });
    if (!pkgs) { setNote({ kind: 'warn', text: `${what} gives no order to ${row ? 'this package’s' : 'any package’s'} objects.${unmatched.length ? ` ${unmatched.length} rows name no object of the loaded model (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '…' : ''}).` : ''}` }); return; }
    wp.save(next);
    setNote({ kind: unmatched.length ? 'warn' : 'ok', text: `${what}: ${n(objs)} objects ordered in ${pkgs} package${pkgs === 1 ? '' : 's'}; objects it does not name come after them.${unmatched.length ? ` ${unmatched.length} rows name no object (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '…' : ''}).` : ''}` });
  };
  const clear = () => {
    const ids = new Set(targets.map((t) => t.pkg.id));
    wp.save(wp.packages.map((p) => { if (!ids.has(p.id)) return p; const { objectOrder: _o, ...rest } = p; return rest; }));
    setNote({ kind: 'ok', text: row ? 'Back to the package as one piece.' : 'Every package is built as one piece again.' });
  };
  const fineTuned = targets.filter((t) => isFineTuned(t.pkg)).length;
  const title = row ? `Object order · ${row.code} ${row.pkg.name}` : 'Object order · every package';
  return (
    <Dialog title={title} onClose={close} foot={<button type="button" className="btn primary" onClick={close}>Done</button>}>
      <p className="scn-dim hint">Optional. A package is normally built as one piece. With an object order, each of its objects is built on its own, in that order (the same number: together). The packages keep their own order and links.</p>
      <div className="g3-order__scope">
        <label><input type="radio" checked={scope === 'picked'} disabled={!picked} onChange={() => setScope('picked')} /> The package picked{picked ? '' : ' (pick one first)'}</label>
        <label><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Every package ({live.length})</label>
        <span className="scn-dim">{fineTuned ? `${fineTuned} with an object order` : 'none with an object order yet'}</span>
        {fineTuned > 0 && <button type="button" className="link-btn" onClick={clear}>Clear{row ? '' : ' all'}</button>}
      </div>
      <Sources wp={wp} targets={targets.map((t) => t.pkg)} onRanks={applyRanks} />
      {note && <div className={`g3-order__note${note.kind === 'warn' ? ' is-warn' : ''}`}>{note.text}</div>}
      {row && <OrderGrid wp={wp} p={row.pkg} />}
      {!row && scope === 'picked' && <p className="scn-dim g3-adv__why">Pick a package in the list (or in 3D) to see and type its objects’ order.</p>}
    </Dialog>
  );
}

/** The three sources of an order. */
function Sources({ wp, targets, onRanks }: { wp: WP; targets: WorkPackage[]; onRanks: (ranks: ReadonlyMap<string, number>, what: string, unmatched?: string[]) => void }) {
  const project = useScenarioStore((s) => s.project);
  const drafts = useScenarioStore((s) => s.drafts);
  const loaded = useScenarioStore((s) => s.loaded);
  const current = useScenarioStore((s) => s.scenario);
  const others = scenarioNamesFor(project, drafts, loaded?.stem ?? null).filter((x) => x !== current);
  const [other, setOther] = useState('');
  const [setMode, setSetMode] = useState<'set' | 'folder'>('set');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const objs = useMemo(() => targets.flatMap((p) => wp.contents.objects.get(p.id) ?? []), [targets, wp.contents]);
  const sets = useMemo(() => walkFolder(wp.sets, ''), [wp.sets]);

  const fromScenario = async () => {
    if (!other || !project || !loaded) return;
    setBusy(true);
    try {
      // Its fine-tuned object order first (packages of Generate 3), then its order of objects (the classic sequence), else its programme's.
      const sheet = await fetchSequence(project.root, loaded.stem, other);
      const theirs = normalizeRules(sheet.rules).packages ?? [];
      const ranks = new Map<string, number>();
      let base = 0;
      for (const p of theirs) {
        if (!p.objectOrder) continue;
        const top = Math.max(0, ...Object.values(p.objectOrder));
        for (const [g, r] of Object.entries(p.objectOrder)) if (!ranks.has(g)) ranks.set(g, base + r);
        base += top;
      }
      if (!ranks.size) {
        const steps = await orderOfScenario(other);
        if (typeof steps === 'string') { window.alert(steps); return; }
        for (const [g, r] of steps.steps) if (r > 0) ranks.set(g, r);
      }
      onRanks(ranks, `From “${other}”`);
    } catch (e) {
      window.alert(`“${other}” could not be read: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const fromSets = () => onRanks(ranksFromSets(objs, sets, wp.finds, setMode === 'folder'), setMode === 'folder' ? 'From the folders of your sets' : 'From the order of your sets');
  const fromList = (rows: unknown[][], what: string) => { const r = ranksFromList(rows, objs); onRanks(r.ranks, what, r.unmatched); };
  const fromFile = async (f: File) => {
    try {
      const book = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error('the workbook has no sheet');
      fromList(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }), `From “${f.name}”`);
    } catch (e) {
      window.alert(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const none = !targets.length;
  return (
    <div className="g3-order__src">
      <div className="g3-order__row">
        <span className="g3-adv__label">From another scenario</span>
        <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Scenario" disabled={!others.length}>
          <option value="">{others.length ? 'Choose a scenario…' : 'No other scenario of this model'}</option>
          {others.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button type="button" className="btn btn--small" disabled={none || !other || busy} onClick={() => void fromScenario()} title="Its objects’ order: a Generate 3 object order, else its order of objects, else its programme’s start dates">{busy ? 'Reading…' : 'Apply'}</button>
      </div>
      <div className="g3-order__row">
        <span className="g3-adv__label">From your sets</span>
        <select value={setMode} onChange={(e) => setSetMode(e.target.value === 'folder' ? 'folder' : 'set')} aria-label="Order of">
          <option value="set">in the order of the sets ({sets.length})</option>
          <option value="folder">in the order of their folders</option>
        </select>
        <button type="button" className="btn btn--small" disabled={none || !sets.length} onClick={fromSets} title="An object takes the place of the first set (or folder) in Models › Sets that holds it">Apply</button>
      </div>
      <div className="g3-order__row g3-order__row--top">
        <span className="g3-adv__label">From a list</span>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder={'One object per line: its GlobalId or name,\nwith a number before it if you want (3<TAB>name)'} aria-label="Ordered list of objects" />
        <span className="g3-order__btns">
          <button type="button" className="btn btn--small" disabled={none || !paste.trim()} onClick={() => fromList(listRows(paste), 'From the list')}>Apply</button>
          <button type="button" className="btn btn--small" disabled={none} onClick={() => file.current?.click()} title="The first sheet: an object per row (GlobalId or name), with an optional number in the column before it">From Excel…</button>
          <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromFile(f); }} />
        </span>
      </div>
    </div>
  );
}

/** The objects of one package in their order, with the rank typed like a spreadsheet (fill down, paste a column from Excel). */
function OrderGrid({ wp, p }: { wp: WP; p: WorkPackage }) {
  const objs = useMemo(() => wp.contents.objects.get(p.id) ?? [], [wp.contents, p.id]);
  const on = isFineTuned(p);
  const runs = useMemo(() => orderRuns(objs, p.objectOrder), [objs, p.objectOrder]);
  const rows = useMemo(() => runs.flatMap((run) => run.map((o) => ({ o }))), [runs]);
  const methods = useMemo(() => (on ? wp.objectMethods(p, [...objs]) : null), [on, wp, p, objs]);
  const setOrder = (order: ObjectOrder) => wp.patch(p.id, { objectOrder: Object.keys(order).length ? order : undefined });
  const grid = useEditableGrid({
    widthsKey: 'generate3.objectOrder',
    rows,
    get: (col, r) => (col === 'rank' ? (r.o.guid && p.objectOrder?.[r.o.guid] !== undefined ? String(p.objectOrder[r.o.guid]) : '') : ''),
    write: (col, cells) => {
      if (col !== 'rank') return;
      const next = { ...p.objectOrder };
      for (const [at, text] of cells) { const o = rows[at]?.o; if (!o?.guid) continue; const v = parsePositive(text); if (v === undefined) delete next[o.guid]; else next[o.guid] = v; }
      setOrder(next);
    },
  });
  if (!on) {
    return (
      <div className="g3-order__off">
        <p className="g3-adv__note">This package is built as one piece ({n(objs.length)} objects).</p>
        <button type="button" className="btn" onClick={() => setOrder(Object.fromEntries(objs.filter((o) => o.guid).map((o, i) => [o.guid, i + 1])))} title="Each object gets activities of its own, in the order below; change the numbers to change it">Build its objects one by one</button>
        {objs.length > LARGE && <small className="g3-adv__why">It has {n(objs.length)} objects: each gets activities of its own, so the programme grows by that many.</small>}
      </div>
    );
  }
  const total = methods ? runs.reduce((k, run) => k + Math.max(0, ...run.map((o) => methods.get(o.key)?.days ?? 0)), 0) : 0;
  return (
    <div className="g3-order__grid">
      <div className="g3-order__bar">
        <span className="scn-dim">{n(objs.length)} objects in {runs.length} step{runs.length === 1 ? '' : 's'} · about {n(total, 1)} days one after another</span>
        <button type="button" className="btn btn--small" onClick={() => setOrder(compactOrder(objs, p.objectOrder))} title="Number the steps 1, 2, 3… keeping the order (objects with the same number stay together)">Renumber</button>
        <button type="button" className="btn btn--small" onClick={() => { if (window.confirm('Build this package as one piece again? Its object order is removed.')) setOrder({}); }}>Back to one piece</button>
      </div>
      <table className="xl xgrid" {...grid.grid}>
        <colgroup><col style={{ width: 40 }} /><col style={{ width: 70 }} /><col style={{ width: 260 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /><col style={{ width: 80 }} /><col style={{ width: 70 }} /></colgroup>
        <thead><tr><th className="xl__corner" aria-label="Row" /><th title="Lower first; the same number: together; empty: after the numbered ones">Order</th><th>Object</th><th>Type</th><th>Storey</th><th>m³</th><th>Days</th></tr></thead>
        <tbody>
          {rows.map(({ o }, at) => (
            <tr key={o.key}>
              <th className="xl__row" scope="row">{at + 1}</th>
              <td className={`xl__cell xl__num xgrid__cell${grid.sel('rank', at)}`} data-col="rank" data-row={at}>
                <RankInput o={o} p={p} cell={grid.cell('rank', at)} onSet={(v) => { const next = { ...p.objectOrder }; if (v === undefined) delete next[o.guid]; else next[o.guid] = v; setOrder(next); }} />
                {grid.handle('rank', at)}
              </td>
              <td className="xl__cell xl__ro" title={o.guid}>{o.name || o.guid}</td>
              <td className="xl__cell xl__ro">{className(o.cls)}</td>
              <td className="xl__cell xl__ro">{o.storey}</td>
              <td className="xl__cell xl__num xl__ro">{o.volume ? n(o.volume, 1) : ''}</td>
              <td className="xl__cell xl__num xl__ro">{methods?.get(o.key)?.days !== undefined ? n(methods.get(o.key)!.days, 1) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A rank typed in place: the list re-sorts when the cell is left, not at each key. */
function RankInput({ o, p, cell, onSet }: { o: PackageObject; p: WorkPackage; cell: Record<string, unknown>; onSet: (v: number | undefined) => void }) {
  const value = o.guid && p.objectOrder?.[o.guid] !== undefined ? String(p.objectOrder[o.guid]) : '';
  return (
    <input {...cell} type="text" inputMode="decimal" defaultValue={value} key={`${o.key}:${value}`} disabled={!o.guid} title={o.guid ? undefined : 'This object has no GlobalId, so it cannot be ordered'}
      onBlur={(e) => { const v = parsePositive(e.target.value); if (String(v ?? '') !== value) onSet(v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}
