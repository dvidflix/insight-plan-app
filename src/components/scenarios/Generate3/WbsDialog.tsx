import { useMemo, useRef, useState } from 'react';
import { packagesRequest } from '../../../prs/workPackages';
import { NO_VALUE_OPS, PACKAGE_FIELDS, WBS_OPS, packageTreeRules, previewTree, rowsToRules, rulesToRows, type WbsItem, type WbsNode, type WbsOp, type WbsRule, type WbsRuleSet } from '../../../prs/wbsRules';
import { readWbsWorkbook, writeWbsWorkbook } from '../../../prs/wbsRulesFile';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useEditableGrid } from '../../useEditableGrid';
import { IconArrowDown, IconArrowUp, IconRemove } from '../../icons';
import { useRuleContext } from '../rules/RuleParts';
import { Dialog } from './Controls';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** WBS (Generate): how the programme's WBS is laid out. By default a node per work package, nested as the packages are; or the user's own rules,
    tried in order for each activity, the first that fits placing it (prs/wbsRules.ts; the generator places the activities the same way,
    scenario-engine/core/wbs_rules.py). The rules are a spreadsheet (a condition, the levels as name templates, phases for the last level), with how many
    activities each catches, a preview of the tree they make of this plan's packages, and an Excel round trip. Nothing here knows any kind of object:
    the fields are the packages' own (PACKAGE_FIELDS). */

type WP = ReturnType<typeof useWorkPackages>;
const SEP = ' > ';
/** The grid's column widths: row number, on, name, field, operator, value, starts under, levels, phases, every, activities, buttons. */
const COLS = [36, 34, 140, 120, 110, 100, 90, 300, 140, 50, 80, 82];
const n = (v: number) => v.toLocaleString();

/** This plan's work items as the WBS rules read them (what Generate sends), with their activities' phases. */
function useItems(wp: WP): WbsItem[] {
  return useMemo(() => {
    const req = packagesRequest(wp.effective, wp.contents, wp.methods, '', wp.objectMethods);
    return req.workItems.map((w) => {
      const pkg = w.id.split('|')[1];
      return { fields: w.properties, phases: wp.methods.get(pkg)?.activities.map((a) => a.phase) ?? [], objects: w.quantities.count ?? 1 };
    });
  }, [wp.effective, wp.contents, wp.methods, wp.objectMethods]);
}

export function WbsDialog({ wp }: { wp: WP }) {
  const open = useG3((s) => s.wbsDialog);
  if (!open) return null;
  return <WbsEditor wp={wp} onClose={() => useG3.setState({ wbsDialog: false })} />;
}

function WbsEditor({ wp, onClose }: { wp: WP; onClose: () => void }) {
  const ctx = useRuleContext();
  const scenario = useScenarioStore((s) => s.scenario);
  const items = useItems(wp);
  const depth = Math.max(1, ...items.map((it) => Object.keys(it.fields).filter((k) => /^Package level \d+$/.test(k)).length));
  const own = ctx.rules.wbs;
  const shown: WbsRuleSet = own ?? packageTreeRules(depth);
  const rules = shown.rules;
  const preview = useMemo(() => previewTree(shown, items), [shown, items]);
  const fields = useMemo(() => [...new Set([...PACKAGE_FIELDS, 'Object', 'phase', ...items.flatMap((it) => Object.keys(it.fields))])].sort((a, b) => a.localeCompare(b)), [items]);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const save = (next: WbsRuleSet | undefined) => ctx.change((r) => { const { wbs: _w, ...rest } = r; return next && next.rules.length ? { ...rest, wbs: next } : rest; });
  const setRules = (next: WbsRule[]) => save({ rules: next });
  const patch = (at: number, p: Partial<WbsRule>) => setRules(rules.map((r, i) => (i === at ? { ...r, ...p } : r)));
  const move = (at: number, by: number) => { const to = at + by; if (to < 0 || to >= rules.length) return; const next = [...rules]; [next[at], next[to]] = [next[to], next[at]]; setRules(next); };
  const add = () => setRules([...rules, { id: `rule-${Date.now().toString(36)}`, name: '', when: [{ field: '', op: 'equals', value: '' }], path: [{ name: '{Package}' }] }]);

  // The cells typed like a spreadsheet's: a rule's name, its first condition's field and value, its levels (joined by >) and the last level's phases.
  const levelsText = (r: WbsRule) => r.path.map((l) => l.name).join(SEP);
  const phasesText = (r: WbsRule) => r.path[r.path.length - 1]?.phases?.join(', ') ?? '';
  const get = (col: string, r: WbsRule) => (col === 'name' ? r.name ?? '' : col === 'field' ? r.when[0]?.field ?? '' : col === 'value' ? r.when[0]?.value ?? '' : col === 'levels' ? levelsText(r) : col === 'phases' ? phasesText(r) : '');
  const withCell = (r: WbsRule, col: string, v: string): WbsRule => {
    const t = v.trim();
    if (col === 'name') return { ...r, name: t || undefined };
    if (col === 'field' || col === 'value') {
      const first = r.when[0] ?? { field: '', op: 'equals' as WbsOp, value: '' };
      const c = { ...first, [col]: t };
      return { ...r, when: c.field ? [c, ...r.when.slice(1)] : r.when.slice(1) };
    }
    if (col === 'levels') {
      const names = t.split(/\s*>\s*/).map((x) => x.trim()).filter(Boolean);
      const last = r.path[r.path.length - 1];
      return { ...r, path: names.map((name, i) => (i === names.length - 1 && last?.phases ? { name, phases: last.phases, ...(last.always ? { always: true } : {}) } : { name })) };
    }
    if (col === 'phases') {
      const phases = t.split(',').map((x) => x.trim()).filter(Boolean);
      return { ...r, path: r.path.map((l, i) => (i === r.path.length - 1 ? (phases.length ? { name: l.name, phases, ...(l.always ? { always: true } : {}) } : { name: l.name }) : l)) };
    }
    return r;
  };
  const write = (col: string, cells: [number, string][]) => setRules(rules.map((r, i) => { const c = cells.find(([at]) => at === i); return c ? withCell(r, col, c[1]) : r; }));
  const grid = useEditableGrid({ widthsKey: 'generate3.wbs', rows: rules, get, write });
  const cell = (col: string, at: number, extra?: { list?: string; placeholder?: string; title?: string }) => {
    const v = get(col, rules[at]);
    return (
      <td className={`xl__cell xgrid__cell${grid.sel(col, at)}`} data-col={col} data-row={at}>
        <input {...grid.cell(col, at)} list={extra?.list} placeholder={extra?.placeholder} title={extra?.title} defaultValue={v} key={`${col}:${at}:${v}`}
          onBlur={(e) => { if (e.target.value !== v) write(col, [[at, e.target.value]]); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {grid.handle(col, at)}
      </td>
    );
  };

  const download = () => writeWbsWorkbook(rulesToRows(shown), `${(scenario || 'Plan').replace(/[\\/:*?"<>|]+/g, '_')} - WBS rules.xlsx`);
  const upload = async (file: File) => {
    try {
      const read = rowsToRules(await readWbsWorkbook(file));
      if (!read.set.rules.length) throw new Error('it has no rule with a level.');
      const notes = read.warnings.length ? `\n\nNot read (${read.warnings.length}):\n${read.warnings.slice(0, 10).join('\n')}` : '';
      if (!window.confirm(`Replace the WBS rules with the ${read.set.rules.length} rule${read.set.rules.length === 1 ? '' : 's'} of “${file.name}”?${notes}`)) return;
      save(read.set);
      setNote({ text: `${read.set.rules.length} rule${read.set.rules.length === 1 ? '' : 's'} read from ${file.name}.`, error: false });
    } catch (e) {
      setNote({ text: `${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };

  return (
    <Dialog title="WBS" onClose={onClose} foot={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
      <p className="scn-dim hint">How the programme’s WBS is laid out. For each activity the rules are tried from the top, and the first that fits places it; a rule with no condition fits every activity, so put it last.</p>
      <div className="g3-wbs__mode" role="radiogroup" aria-label="WBS">
        <label className="g3-adv__check"><input type="radio" name="g3-wbs" checked={!own} onChange={() => save(undefined)} /><span>Follow the work packages<small className="g3-adv__why">A node for each package, nested as the packages are. Nothing to set.</small></span></label>
        <label className="g3-adv__check"><input type="radio" name="g3-wbs" checked={!!own} onChange={() => save(packageTreeRules(depth))} /><span>My own rules<small className="g3-adv__why">Starts from the package tree; change it, or add rules above it for some activities.</small></span></label>
      </div>
      <div className="g3-wbs__bar">
        <button type="button" className="btn btn--small" onClick={download} title="The rules as an Excel sheet, with a Read me on how to write them">Download Excel</button>
        <button type="button" className="btn btn--small" onClick={() => input.current?.click()} title="Replace the rules with the rows of an edited sheet (you see what it read first)">Upload Excel</button>
        <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
        {note && <small className={note.error ? 'scn-error' : 'scn-dim'}>{note.text}</small>}
      </div>
      {/* As wide as its columns need: it scrolls sideways in a narrow window rather than squeezing them. */}
      <div className="g3-wbs__grid">
      <table className={`xl xgrid${own ? '' : ' is-readonly'}`} style={{ width: COLS.reduce((a, b) => a + b, 0) }} {...grid.grid}>
        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            <th className="xl__corner" aria-label="Order" />
            <th title="Off: the rule is kept but not used">On</th>
            <th>Name</th>
            <th title="Which field of the activity the condition reads (the package’s fields, or phase)">When field</th>
            <th>Is</th>
            <th>Value</th>
            <th title="Where the levels start: under the building’s level node, or under its Construction node">Starts under</th>
            <th title={'The WBS nodes under one another, separated by >. {Field} is the activity’s value of a field; {Field:title} formats it; {parent} is the node above. A level that reads an empty field is left out'}>Levels</th>
            <th title="The last level is only for these phases (comma-separated); write it as {parent} - {phase} for a node per phase">Last level for phases</th>
            <th title="Make a node for each of those phases, used or not">Every</th>
            <th title="Activities this rule places in this plan (the first rule that fits wins)">Activities</th>
            <th aria-label="Move or delete" />
          </tr>
        </thead>
        <tbody>
          {rules.map((r, at) => {
            const c = r.when[0];
            const last = r.path[r.path.length - 1];
            return (
              <tr key={`${r.id}:${at}`} className={r.enabled === false ? 'is-off' : ''}>
                <th className="xl__row" scope="row">{at + 1}</th>
                <td className="xl__check"><input type="checkbox" checked={r.enabled !== false} disabled={!own} aria-label={`Use rule ${at + 1}`} onChange={(e) => patch(at, { enabled: e.target.checked ? undefined : false })} /></td>
                {cell('name', at, { placeholder: r.when.length ? '' : 'Otherwise' })}
                {cell('field', at, { list: 'g3-wbs-fields', placeholder: 'every activity' })}
                {!c ? <td className="xl__cell xl__ro" title="No condition: the rule fits every activity" /> : <td className="xl__cell">
                  <select value={c.op} disabled={!own} aria-label={`Operator of rule ${at + 1}`} onChange={(e) => patch(at, { when: [{ ...c, op: e.target.value as WbsOp, ...(NO_VALUE_OPS.includes(e.target.value as WbsOp) ? { value: undefined } : {}) }, ...r.when.slice(1)] })}>
                    {WBS_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                </td>}
                {!c || NO_VALUE_OPS.includes(c.op) ? <td className="xl__cell xl__ro" /> : cell('value', at, { placeholder: c ? 'value' : '' })}
                <td className="xl__cell">
                  <select value={r.under === 'root' ? 'root' : 'level'} disabled={!own} aria-label={`Rule ${at + 1} starts under`} onChange={(e) => patch(at, { under: e.target.value === 'root' ? 'root' : undefined })}>
                    <option value="level">level</option>
                    <option value="root">building</option>
                  </select>
                </td>
                {cell('levels', at, { placeholder: '{Package}', title: r.when.length > 1 ? `This rule has ${r.when.length} conditions: only the first is shown here (all are in the Excel sheet)` : undefined })}
                {cell('phases', at, { placeholder: 'every phase' })}
                <td className="xl__check"><input type="checkbox" checked={!!last?.always} disabled={!own || !last?.phases?.length} aria-label={`Rule ${at + 1}: a node for every phase`} onChange={(e) => setRules(rules.map((x, i) => (i === at ? { ...x, path: x.path.map((l, k) => (k === x.path.length - 1 ? { ...l, always: e.target.checked || undefined } : l)) } : x)))} /></td>
                <td className="xl__cell xl__num xl__ro">{preview.byRule.get(r.id) ? n(preview.byRule.get(r.id)!) : r.enabled === false ? 'off' : '0'}</td>
                <td className="xl__check g3-wbs__acts">
                  <button type="button" className="cols__icon" disabled={!own || at === 0} aria-label={`Move rule ${at + 1} up`} title="Up: tried earlier" onClick={() => move(at, -1)}><IconArrowUp width={14} height={14} /></button>
                  <button type="button" className="cols__icon" disabled={!own || at === rules.length - 1} aria-label={`Move rule ${at + 1} down`} title="Down: tried later" onClick={() => move(at, 1)}><IconArrowDown width={14} height={14} /></button>
                  <button type="button" className="cols__icon cols__icon--remove" disabled={!own || rules.length < 2} aria-label={`Delete rule ${at + 1}`} title={rules.length < 2 ? 'The last rule: choose Follow the work packages instead' : 'Delete the rule'} onClick={() => setRules(rules.filter((_, i) => i !== at))}><IconRemove /></button>
                </td>
              </tr>
            );
          })}
          {own && <tr className="xl__add"><th className="xl__row">*</th><td colSpan={11}><button type="button" onClick={add}>+ Add a rule</button></td></tr>}
        </tbody>
      </table>
      </div>
      <datalist id="g3-wbs-fields">{fields.map((f) => <option key={f} value={f} />)}</datalist>
      {!own && <p className="scn-dim g3-adv__why">These are the default rules, shown for reference: choose My own rules to change them.</p>}
      {preview.unplaced > 0 && <p className="g3-adv__note">{n(preview.unplaced)} activit{preview.unplaced === 1 ? 'y fits' : 'ies fit'} no rule: {preview.unplaced === 1 ? 'it goes' : 'they go'} straight under {preview.unplaced === 1 ? 'its' : 'their'} level. Add a last rule with no condition to place them.</p>}
      <h4 className="g3-dlg__sub">Preview <span className="scn-dim">this plan’s WBS, roughly (the generator adds the building’s code to the top names): objects · activities</span></h4>
      <div className="g3-wbs__tree">{preview.tree.children.length ? <Tree node={preview.tree} depth={0} budget={{ left: 400 }} /> : <p className="scn-dim g3-adv__why">No work package holds objects yet: make some in step 1.</p>}</div>
    </Dialog>
  );
}

/** The preview: each node with how many objects and activities are in it or under it (at most `budget.left` nodes, so a big plan stays quick). */
function Tree({ node, depth, budget }: { node: WbsNode; depth: number; budget: { left: number } }) {
  if (budget.left <= 0) return null;
  budget.left--;
  const acts = (x: WbsNode): number => x.activities + x.children.reduce((k, c) => k + acts(c), 0);
  return (
    <>
      <div className="g3-wbs__node" style={{ paddingLeft: depth * 16 }}>
        <span className="g3-wbs__name">{node.name}</span>
        <span className="scn-dim">{n(node.objects)} · {n(acts(node))}</span>
      </div>
      {node.children.map((c, i) => <Tree key={`${c.name}:${i}`} node={c} depth={depth + 1} budget={budget} />)}
      {depth === 0 && budget.left <= 0 && <div className="g3-wbs__node scn-dim">… more nodes not shown</div>}
    </>
  );
}

