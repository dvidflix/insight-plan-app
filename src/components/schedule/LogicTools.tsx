import { useMemo, useState } from 'react';
import { useDismiss } from '../useDismiss';
import { IconChevronDown } from '../icons';
import type { RelationType, ScheduleModel } from '../../schedule/types';
import { addLinks, linkKey, linksOf, removeLinks, removeSoftLogic, setLinksSoft } from '../../schedule/linkTools';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';

/** Logic for many activities at once (ALICE's assignment panel): give the picked activities the same predecessors or successors, look at and
    remove the links inside the picked ones or all that touch them, make links soft (preferential, drawn dashed) or hard, and take every soft link
    away to see what the hard logic alone allows. One undo step each. */

type Done = { error: string } | object;
const failed = (r: Done): r is { error: string } => 'error' in r;

const TYPES: RelationType[] = ['FS', 'SS', 'FF', 'SF'];

export function LogicTools({ model, picked, onNote }: { model: ScheduleModel; picked: string[]; onNote: (text: string) => void }) {
  const key = programmeKey(model);
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  const [role, setRole] = useState<'pred' | 'succ'>('pred');
  const [others, setOthers] = useState('');
  const [type, setType] = useState<RelationType>('FS');
  const [lag, setLag] = useState('0');
  const [soft, setSoft] = useState(false);
  const [mode, setMode] = useState<'contained' | 'uncontained'>('contained');
  const [review, setReview] = useState<Set<string> | null>(null);

  const byCode = useMemo(() => new Map(model.activities.map((a) => [a.code.toLowerCase(), a])), [model.activities]);
  const byId = useMemo(() => new Map(model.activities.map((a) => [a.id, a])), [model.activities]);
  const softCount = model.relationships.filter((r) => r.soft).length;
  const listed = useMemo(() => (review ? linksOf(model, picked, mode) : []), [review, model, picked, mode]);

  const run = (label: string, command: Parameters<typeof editStructure>[1]) => {
    const r = commit(label, () => editStructure(key, command));
    if (failed(r)) { onNote(r.error); return null; }
    return r as Record<string, number>;
  };

  const add = () => {
    const codes = others.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
    const unknown = codes.filter((c) => !byCode.has(c.toLowerCase()));
    if (unknown.length) return onNote(`There is no activity with the ID ${unknown.slice(0, 3).map((c) => `“${c}”`).join(', ')}${unknown.length > 3 ? ' …' : ''}.`);
    const ids = codes.map((c) => byCode.get(c.toLowerCase())!.id);
    const r = run(`Link ${picked.length} to ${role === 'pred' ? 'predecessors' : 'successors'}`, (m) => addLinks(m, picked, ids, { role, type, lagDays: Number(lag) || 0, soft }));
    if (r) onNote(`${r.added} ${soft ? 'soft ' : ''}${type} ${r.added === 1 ? 'link' : 'links'} added${r.skipped ? `; ${r.skipped} left out (already there, itself, or they would make a loop)` : ''}. Undo (Ctrl+Z) puts them back.`);
  };
  const startReview = () => {
    const l = linksOf(model, picked, mode);
    if (!l.length) return onNote(mode === 'contained' ? 'There are no links between the picked activities.' : 'The picked activities have no links.');
    setReview(new Set(l.map(linkKey)));
  };
  const removeReviewed = () => {
    if (!review || !review.size) return;
    const r = run(`Remove ${review.size} links`, (m) => removeLinks(m, review));
    if (r) onNote(`Removed ${r.removed} ${r.removed === 1 ? 'link' : 'links'}. Undo (Ctrl+Z) puts them back.`);
    setReview(null);
  };
  const softLinks = (on: boolean) => {
    const l = linksOf(model, picked, 'contained');
    if (!l.length) return onNote('There are no links between the picked activities.');
    const r = run(on ? 'Make links soft' : 'Make links hard', (m) => setLinksSoft(m, l.map(linkKey), on));
    if (r) onNote(`${r.changed} ${r.changed === 1 ? 'link' : 'links'} made ${on ? 'soft (drawn dashed)' : 'hard'}.`);
  };
  const dropSoft = () => {
    if (!softCount || !window.confirm(`Remove all ${softCount} soft ${softCount === 1 ? 'link' : 'links'}? Undo (Ctrl+Z) puts them back.`)) return;
    const r = run('Remove soft logic', (m) => removeSoftLogic(m));
    if (r) onNote(`Removed ${r.removed} soft ${r.removed === 1 ? 'link' : 'links'}: the dates now follow the hard logic alone.`);
  };
  const name = (id: string) => byId.get(id)?.code ?? id;

  return (
    <span className="schedule-toolbar__edit-wbs" ref={ref}>
      <button type="button" className="btn btn--small" aria-expanded={open} onClick={() => setOpen(!open)} title="Logic for many activities: the same predecessors or successors, remove links after a look, soft (preferential) and hard links">
        Logic <IconChevronDown width={14} height={14} />
      </button>
      {open && (
        <div className="schedule-toolbar__edit-panel" role="group" aria-label="Logic">
          <div className="scn-dim">{picked.length ? `${picked.length} picked` : 'Pick activities first (Ctrl+click or Shift+click).'}</div>

          <b>Add links</b>
          <span className="np__seg" role="radiogroup" aria-label="The other activities are">
            <button type="button" role="radio" aria-checked={role === 'pred'} className={role === 'pred' ? 'is-on' : ''} onClick={() => setRole('pred')} title="The activities typed below come before every picked one">Predecessors</button>
            <button type="button" role="radio" aria-checked={role === 'succ'} className={role === 'succ' ? 'is-on' : ''} onClick={() => setRole('succ')} title="The activities typed below come after every picked one">Successors</button>
          </span>
          <input value={others} onChange={(e) => setOthers(e.target.value)} placeholder="Activity IDs, e.g. A1000, A1010" aria-label="Activity IDs" spellCheck={false} />
          <span className="np__seg" role="radiogroup" aria-label="Link type">
            {TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={type === t} className={type === t ? 'is-on' : ''} onClick={() => setType(t)}>{t}</button>)}
          </span>
          <label title="Working days; negative for an overlap">Lag <input type="number" step="0.5" value={lag} onChange={(e) => setLag(e.target.value)} style={{ width: 56 }} /> d</label>
          <label className="np__check" title="Soft logic: how you would like the work to run, not forced by the work itself"><input type="checkbox" checked={soft} onChange={(e) => setSoft(e.target.checked)} /> Soft</label>
          <button type="button" className="btn btn--small primary" disabled={!picked.length || !others.trim()} onClick={add}>Add</button>

          <b>Remove links</b>
          <span className="np__seg" role="radiogroup" aria-label="Which links">
            <button type="button" role="radio" aria-checked={mode === 'contained'} className={mode === 'contained' ? 'is-on' : ''} onClick={() => { setMode('contained'); setReview(null); }} title="Only the links between the picked activities">Between the picked</button>
            <button type="button" role="radio" aria-checked={mode === 'uncontained'} className={mode === 'uncontained' ? 'is-on' : ''} onClick={() => { setMode('uncontained'); setReview(null); }} title="Every link that has an end among the picked, also those to activities outside them">All touching them</button>
          </span>
          <button type="button" className="btn btn--small" disabled={picked.length === 0} onClick={startReview}>Review…</button>
          {review && (
            <div className="logic-review" style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 4 }}>
              {listed.map((r) => (
                <label key={linkKey(r)} className="np__check" style={{ display: 'flex', gap: 6 }}>
                  <input type="checkbox" checked={review.has(linkKey(r))} onChange={() => setReview((cur) => { const next = new Set(cur); if (!next.delete(linkKey(r))) next.add(linkKey(r)); return next; })} />
                  <span>{name(r.predId)} → {name(r.succId)} <span className="scn-dim">{r.type}{r.lagHours ? ` ${r.lagHours > 0 ? '+' : ''}${r.lagHours} h` : ''}{r.soft ? ' · soft' : ''}</span></span>
                </label>
              ))}
              <button type="button" className="btn btn--small primary" disabled={review.size === 0} onClick={removeReviewed}>Remove {review.size}</button>
              <button type="button" className="btn btn--small" onClick={() => setReview(null)}>Cancel</button>
            </div>
          )}

          <b>Soft logic</b>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--small" disabled={picked.length < 2} onClick={() => softLinks(true)} title="Make the links between the picked activities soft: drawn dashed">Make soft</button>
            <button type="button" className="btn btn--small" disabled={picked.length < 2} onClick={() => softLinks(false)} title="Make the links between the picked activities hard again">Make hard</button>
            <button type="button" className="btn btn--small" disabled={!softCount} onClick={dropSoft} title="Take every soft link out of the programme, to see what the hard logic alone allows">Remove soft logic ({softCount})</button>
          </span>
        </div>
      )}
    </span>
  );
}
