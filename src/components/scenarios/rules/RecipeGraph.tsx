import { useRef, useState } from 'react';
import { END, NODE_H, NODE_W, START, graphEdges, positions, type GraphEdge } from '../../../prs/recipeGraph';
import type { Recipe, RecipeLink, RecipeTask } from '../../../prs/recipes';
import { IconTrash } from '../../icons';

/** The tasks of a recipe as a graph, like the Prepare view of ALICE: a box per task (crew, days), an arrow per link (FS, or the share of the task
    before it that must be done), the work before and after at the ends. Drag a task to place it, Connect Task to link two, Auto Layout to put them
    in order again. A dashed arrow is the link a task has because it has no other (it follows the task before it); linking it to something else
    replaces it. The table beside it edits the same recipe. */

const BOUNDARY_H = 34;
const LINK_H = 46;
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

type Pick = { kind: 'task'; phase: string } | { kind: 'edge'; from: string; to: string } | null;

const sizeOf = (id: string) => ({ w: NODE_W, h: id === START || id === END ? BOUNDARY_H : NODE_H });
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function RecipeGraph({ recipe, recipes = [], onChange }: { recipe: Recipe; recipes?: Recipe[]; onChange: (r: Recipe) => void }) {
  const [picked, setPicked] = useState<Pick>(null);
  const [connect, setConnect] = useState<string | null | false>(false); // false: off; null: pick the first task; a phase: pick the second
  const [drag, setDrag] = useState<{ phase: string; x: number; y: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const edges = graphEdges(recipe);
  const placed = positions(recipe);
  const at = (id: string) => (drag && drag.phase === id ? { x: drag.x, y: drag.y } : placed.get(id) ?? { x: 0, y: 0 });
  const others = recipes.filter((r) => r !== recipe && r.id !== recipe.id);
  // The calls of other recipes: a green node under the task, in a lane below the graph.
  const baseY = Math.max(...[...placed.keys()].map((id) => at(id).y + sizeOf(id).h)) + 56;
  const linkNodes = recipe.tasks.flatMap((t) => (t.links ?? []).map((l, i) => ({ t, l, i }))).map((n, k) => ({ ...n, x: at(n.t.phase).x, y: baseY + (k % 2) * (LINK_H + 12) }));
  const width = Math.max(...[...placed.keys()].map((id) => at(id).x + NODE_W)) + 40;
  const height = Math.max(...[...placed.keys()].map((id) => at(id).y + sizeOf(id).h)) + 40 + (linkNodes.length ? baseY - Math.max(...[...placed.keys()].map((id) => at(id).y + sizeOf(id).h)) + 2 * (LINK_H + 12) : 0);
  const task = (phase: string) => recipe.tasks.find((t) => same(t.phase, phase));

  const setLinks = (phase: string, links: RecipeLink[]) => setTask(phase, { links: links.length ? links : undefined });
  const setTask = (phase: string, patch: Partial<RecipeTask>) => onChange({ ...recipe, tasks: recipe.tasks.map((t) => (same(t.phase, phase) ? { ...t, ...patch } : t)) });
  const writtenEdges = recipe.edges ?? [];
  const link = (from: string, to: string) => {
    if (same(from, to) || from === START || from === END || to === START || to === END) return;
    if (writtenEdges.some((e) => same(e.from, from) && same(e.to, to))) return;
    onChange({ ...recipe, edges: [...writtenEdges, { from, to }] });
    setPicked({ kind: 'edge', from, to });
  };
  const click = (id: string) => {
    if (connect === false) return setPicked(id === START || id === END ? null : { kind: 'task', phase: id });
    if (id === START || id === END) return;
    if (connect === null) return setConnect(id);
    link(connect, id);
    setConnect(false);
  };
  const addTask = () => {
    let n = recipe.tasks.length + 1;
    while (recipe.tasks.some((t) => same(t.phase, `Task ${n}`))) n++;
    onChange({ ...recipe, tasks: [...recipe.tasks, { phase: `Task ${n}` }] });
    setPicked({ kind: 'task', phase: `Task ${n}` });
  };
  const autoLayout = () => onChange({ ...recipe, tasks: recipe.tasks.map(({ x: _x, y: _y, ...t }) => t) });
  const removeTask = (phase: string) => {
    onChange({ ...recipe, tasks: recipe.tasks.filter((t) => !same(t.phase, phase)), edges: writtenEdges.filter((e) => !same(e.from, phase) && !same(e.to, phase)) });
    setPicked(null);
  };

  const onDown = (e: React.PointerEvent, id: string) => {
    if (connect !== false || id === START || id === END) return;
    const p = at(id);
    grab.current = { dx: e.clientX - p.x, dy: e.clientY - p.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent, id: string) => {
    if (!grab.current) return;
    grab.current.moved = true;
    setDrag({ phase: id, x: Math.max(0, Math.round((e.clientX - grab.current.dx) / 10) * 10), y: Math.max(0, Math.round((e.clientY - grab.current.dy) / 10) * 10) });
  };
  const onUp = () => {
    if (grab.current?.moved && drag) setTask(drag.phase, { x: drag.x, y: drag.y });
    grab.current = null;
    setDrag(null);
  };

  const path = (e: GraphEdge) => {
    const a = at(e.from);
    const b = at(e.to);
    const ah = sizeOf(e.from).h;
    const bh = sizeOf(e.to).h;
    const x1 = a.x + NODE_W;
    const y1 = a.y + ah / 2;
    const x2 = b.x;
    const y2 = b.y + bh / 2;
    const c = Math.max(40, Math.abs(x2 - x1) / 2);
    return { d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  };
  const label = (e: GraphEdge) => (e.sharePct < 100 ? `${e.sharePct}%${task(e.to)?.finishAfter ? ' +FF' : ''}` : 'FS');

  const sel = picked?.kind === 'task' ? task(picked.phase) : undefined;
  const selEdge = picked?.kind === 'edge' ? writtenEdges.find((e) => same(e.from, picked.from) && same(e.to, picked.to)) : undefined;
  const field = (t: RecipeTask, key: 'name' | 'days' | 'rate' | 'crew' | 'calendar', w: number, listId?: string, numeric?: boolean) => (
    <input className="rel-cell" style={{ width: w }} type={numeric ? 'number' : 'text'} step="any" list={listId} spellCheck={false} value={t[key] ?? ''}
      onChange={(e) => setTask(t.phase, { [key]: numeric ? num(e.target.value) : e.target.value || undefined })} />
  );

  return (
    <div className="rg">
      <div className="rel-bar">
        <button type="button" className={`btn btn--small${connect !== false ? ' primary' : ''}`} onClick={() => setConnect(connect === false ? null : false)} title="Click the task that comes first, then the task that follows it">
          {connect === false ? 'Connect Task' : connect === null ? 'Pick the first task…' : `${connect} → pick the next…`}
        </button>
        <button type="button" className="btn btn--small" onClick={autoLayout} title="Put the tasks in order again, left to right">Auto Layout</button>
        <button type="button" className="btn btn--small" onClick={addTask}>+ Create Task</button>
        <span className="scn-dim">Drag a task to place it. A dashed arrow is the default link: the task follows the one before it.</span>
      </div>
      <div className="rg__wrap">
        <div className="rg__canvas" style={{ width, height }} onClick={(e) => { if (e.target === e.currentTarget) setPicked(null); }}>
          <svg className="rg__edges" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker>
            </defs>
            {linkNodes.map((n) => {
              const a = at(n.t.phase);
              const down = n.l.direction !== 'before';
              const x = a.x + NODE_W / 2;
              return (
                <g key={`l${n.t.phase}|${n.i}`} className="rg__edge rg__edge--link">
                  <path d={down ? `M${x},${a.y + NODE_H} L${x},${n.y}` : `M${x},${n.y} L${x},${a.y + NODE_H}`} fill="none" markerEnd="url(#rg-arrow)" />
                </g>
              );
            })}
            {edges.map((e, i) => {
              const g = path(e);
              const isSel = picked?.kind === 'edge' && same(picked.from, e.from) && same(picked.to, e.to);
              const text = label(e);
              return (
                <g key={i} className={`rg__edge${e.implicit ? ' is-implicit' : ''}${isSel ? ' is-sel' : ''}`}>
                  <path d={g.d} fill="none" markerEnd="url(#rg-arrow)" />
                  {!e.implicit && (
                    <g className="rg__chip" transform={`translate(${g.mx},${g.my})`} onClick={() => setPicked({ kind: 'edge', from: e.from, to: e.to })}>
                      <rect x={-5 - text.length * 3.2} y={-9} width={10 + text.length * 6.4} height={18} rx={4} />
                      <text textAnchor="middle" dy="4">{text}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {linkNodes.map((n) => (
            <div key={`${n.t.phase}|${n.i}`} className={`rg__node rg__node--link${n.l.enabled === false ? ' is-off' : ''}`} style={{ left: n.x, top: n.y, width: NODE_W, height: LINK_H }} onClick={() => setPicked({ kind: 'task', phase: n.t.phase })}
              title={`${n.t.phase} ${n.l.direction === 'before' ? 'follows' : 'is followed by'} ${n.l.recipe} · ${n.l.phase} (${n.l.scope ?? 'level'})`}>
              <div className="rg__title">{n.l.recipe} · {n.l.phase}</div>
              <div className="rg__sub">Recipe link · {n.l.type ?? 'FS'} · {n.l.scope === 'all' ? 'anywhere' : n.l.scope === 'building' ? 'same building' : 'same level'}</div>
            </div>
          ))}
          {[...placed.keys()].map((id) => {
            const p = at(id);
            if (id === START || id === END) {
              return <div key={id} className="rg__node rg__node--end" style={{ left: p.x, top: p.y, width: NODE_W, height: BOUNDARY_H }}>{id === START ? 'Previous elements' : 'Next elements'}</div>;
            }
            const t = task(id)!;
            const isSel = picked?.kind === 'task' && same(picked.phase, id);
            return (
              <div
                key={id}
                className={`rg__node${isSel ? ' is-sel' : ''}${t.enabled === false ? ' is-off' : ''}${connect === id ? ' is-from' : ''}${connect !== false ? ' is-connecting' : ''}`}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => onDown(e, id)} onPointerMove={(e) => onMove(e, id)} onPointerUp={onUp} onClick={() => click(id)}
              >
                <div className="rg__title">{t.name || t.phase}</div>
                <div className="rg__sub">{t.name && t.name !== t.phase ? `${t.phase} · ` : ''}{t.crew ?? '—'}</div>
                <div className="rg__sub">{t.days !== undefined ? `${t.days} d` : t.rate ?? ''}{t.calendar ? ` · ${t.calendar}` : ''}</div>
                {(t.cranes?.length || t.equipment?.length || t.materials?.length) ? <div className="rg__sub" title={[...(t.cranes ?? []), ...(t.equipment ?? []), ...(t.materials ?? [])].map((u) => `${u.type}${u.count && u.count !== 1 ? ` x${u.count}` : ''}`).join(', ')}>{[...(t.cranes ?? []), ...(t.equipment ?? []), ...(t.materials ?? [])].map((u) => u.type).join(' · ')}</div> : null}
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <div className="rg__links">
          <div className="rel-bar">
            <strong className="scn-dim">Recipe links of {sel.phase}</strong>
            <button type="button" className="btn btn--small" disabled={!others.length} onClick={() => setLinks(sel.phase, [...(sel.links ?? []), { recipe: others[0].id, phase: others[0].tasks[0]?.phase ?? '' }])} title={others.length ? 'Make a task of another recipe follow (or precede) this one' : 'Add another recipe first'}>+ Link to another recipe</button>
          </div>
          {(sel.links ?? []).map((l, i) => {
            const target = others.find((r) => r.id.toUpperCase() === l.recipe.trim().toUpperCase());
            const set = (patch: Partial<RecipeLink>) => setLinks(sel.phase, (sel.links ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className={`rel-bar${l.enabled === false ? ' is-off' : ''}`}>
                <select className="rel-cell" value={l.direction ?? 'after'} onChange={(e) => set({ direction: e.target.value as RecipeLink['direction'] })} title="After: the other task follows this one. Before: it precedes it.">
                  <option value="after">is followed by</option>
                  <option value="before">follows</option>
                </select>
                <select className="rel-cell" value={l.recipe} onChange={(e) => { const r = others.find((o) => o.id === e.target.value); set({ recipe: e.target.value, phase: r?.tasks[0]?.phase ?? '' }); }}>
                  {!target && <option value={l.recipe}>{l.recipe || '(pick a recipe)'}</option>}
                  {others.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                </select>
                <select className="rel-cell" value={l.phase} onChange={(e) => set({ phase: e.target.value })}>
                  {!target?.tasks.some((t) => same(t.phase, l.phase)) && <option value={l.phase}>{l.phase || '(pick a task)'}</option>}
                  {(target?.tasks ?? []).map((t) => <option key={t.phase} value={t.phase}>{t.phase}</option>)}
                </select>
                <select className="rel-cell" value={l.type ?? 'FS'} onChange={(e) => set({ type: e.target.value as RecipeLink['type'] })}>
                  {['FS', 'SS', 'FF', 'SF'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="scn-dim">lag <input className="rel-cell" style={{ width: 52 }} type="number" step="any" value={l.lagHours ?? ''} placeholder="0" onChange={(e) => set({ lagHours: num(e.target.value) })} /> h</label>
                <select className="rel-cell" value={l.scope ?? 'level'} onChange={(e) => set({ scope: e.target.value as RecipeLink['scope'] })} title="Which objects of the two recipes are tied: those on the same level, in the same building, or all of them">
                  <option value="level">same level</option>
                  <option value="building">same building</option>
                  <option value="all">anywhere</option>
                </select>
                <button type="button" className="mini-btn" onClick={() => setLinks(sel.phase, (sel.links ?? []).filter((_, j) => j !== i))} aria-label="Remove the link"><IconTrash /></button>
              </div>
            );
          })}
        </div>
      )}
      {sel && (
        <div className="rel-bar rg__panel">
          <label className="scn-dim">Phase <input className="rel-cell" style={{ width: 130 }} list="recipe-phases" value={sel.phase} spellCheck={false}
            onChange={(e) => {
              const old = sel.phase;
              const phase = e.target.value;
              onChange({ ...recipe, tasks: recipe.tasks.map((t) => (t === sel ? { ...t, phase } : t)), edges: writtenEdges.map((x) => ({ ...x, from: x.from === old ? phase : x.from, to: x.to === old ? phase : x.to })) });
              setPicked({ kind: 'task', phase });
            }} /></label>
          <label className="scn-dim">Name {field(sel, 'name', 130)}</label>
          <label className="scn-dim">Days {field(sel, 'days', 56, undefined, true)}</label>
          <label className="scn-dim">Rate {field(sel, 'rate', 100, 'recipe-rates')}</label>
          <label className="scn-dim">Crew {field(sel, 'crew', 100, 'recipe-crews')}</label>
          <label className="scn-dim">Calendar {field(sel, 'calendar', 80, 'recipe-calendars')}</label>
          <label className="scn-dim"><input type="checkbox" checked={!!sel.gates} onChange={(e) => setTask(sel.phase, { gates: e.target.checked || undefined })} /> Gates what follows</label>
          <button type="button" className="btn btn--small" onClick={() => removeTask(sel.phase)}>Delete task</button>
        </div>
      )}
      {selEdge && (
        <div className="rel-bar rg__panel">
          <span>{selEdge.from} → {selEdge.to}</span>
          <label className="scn-dim" title="The share of the first task that must be done when the second starts; empty or 100: it must be finished">Starts when
            <input className="rel-cell" style={{ width: 56, margin: '0 4px' }} type="number" min={0} max={100} value={selEdge.sharePct ?? ''} placeholder="100"
              onChange={(e) => { const v = num(e.target.value); onChange({ ...recipe, edges: writtenEdges.map((x) => (x === selEdge ? { ...x, sharePct: v === undefined || v >= 100 ? undefined : Math.max(0, v) } : x)) }); }} />% is done</label>
          <button type="button" className="btn btn--small" onClick={() => { onChange({ ...recipe, edges: writtenEdges.filter((x) => x !== selEdge) }); setPicked(null); }}>Remove link</button>
        </div>
      )}
    </div>
  );
}
