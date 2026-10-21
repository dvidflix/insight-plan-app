import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { END, HOURS_PER_DAY, START, edgeChip, graphEdges, positions, previewBars, type GraphEdge, type PreviewBar, type Rect } from '../../../prs/recipeGraph';
import type { Recipe, RecipeEdge, RecipeLink, RecipeTask } from '../../../prs/recipes';
import type { ParameterRow, ScenarioRules } from '../../../prs/rules';
import { QUANTITY_NAMES } from '../../../prs/recipesWorkbook';
import { formulaNames } from '../../../schedule/durationFormula';
import { IconChevronDown, IconFullscreen, IconGear, IconRemove } from '../../icons';
import { RecipeTaskDialog } from './RecipeTaskDialog';
import { usePersistedState } from '../../../utils/persistedState';
import { useAppearanceStore } from '../../../state/appearanceStore';

/** The tasks of a recipe as a graph, like the Prepare view of ALICE: a card per task (crew, what it holds, its days), an arrow per link with its
    type and lag in a small box ("FS | 0", "SS | 16h"), the work before and after at the ends. Drag a task to place it, drag the background to
    pan, Connect Task to link two, Auto Layout to put them in order again, double-click a task for its dialog (Labor, Equipment, Cranes,
    Materials, Rates, Duration). A dashed arrow is the link a task has because it has no other (it follows the task before it); linking it to
    something else replaces it. The table beside it edits the same recipe. */

const HEAD_H = 24;
const ROW_H = 22;
const LINK_H = 46;
const clampZoom = (z: number) => Math.min(2.5, Math.max(0.1, z));
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const countOf = (list?: { count?: number }[]) => (list ?? []).reduce((n, u) => n + (u.count ?? 1), 0);
/** What a task shows under its header, one row each like the fields of a Blender node: the label, and its value in a field. */
const rowsOf = (t: RecipeTask, crewPeople: number, est?: PreviewBar): [string, string][] => {
  const rows: [string, string][] = [];
  if (t.crew) rows.push(['Crew', crewPeople ? `${t.crew} · ${crewPeople}` : t.crew]);
  if (t.formula) {
    rows.push(['Formula', t.formula]);
    // What the formula gives for the preview's reference pour.
    if (est) rows.push(['Duration', est.problem ? '? see Preview' : `~${Math.round(est.days * 10) / 10} ${est.days === 1 ? 'day' : 'days'}`]);
  }
  else if (t.days !== undefined) rows.push(['Duration', `${t.days} ${t.days === 1 ? 'day' : 'days'}`]);
  else if (t.rate) rows.push(['Rate', t.rate]);
  if (t.calendar) rows.push(['Calendar', t.calendar]);
  const cranes = countOf(t.cranes);
  const equipment = countOf(t.equipment);
  const materials = countOf(t.materials);
  if (cranes) rows.push(['Cranes', String(cranes)]);
  if (equipment) rows.push(['Equipment', String(equipment)]);
  if (materials) rows.push(['Materials', String(materials)]);
  return rows;
};

/** The header colour of a task: that of the Appearance Profile named like it (its finished colour: Rebar brown, Concrete cyan ...), else a
    default for the usual activities, else blue. */
const DEFAULT_HEAD: [string, string][] = [['rebar', '#8a5a3c'], ['concrete', '#1fa6b8'], ['curing', '#c4423b'], ['formwork', '#c98a2b'], ['mill', '#6b7f95'], ['deck', '#6b7f95'], ['e/p', '#7a6b99'], ['backfill', '#8b7d5a']];
const headColor = (t: RecipeTask, profiles: { name: string; startColor: { color: string | null }; activeStart: { color: string | null }; activeFinish: { color: string | null }; endColor: { color: string | null } }[]): string => {
  const names = [t.phase, t.name ?? ''].map((n) => n.trim().toLowerCase()).filter(Boolean);
  const p = profiles.find((x) => names.some((n) => x.name.trim().toLowerCase() === n)) ?? profiles.find((x) => names.some((n) => x.name.toLowerCase().includes(n)));
  const c = p && (p.endColor.color ?? p.activeFinish.color ?? p.activeStart.color ?? p.startColor.color);
  return c ?? DEFAULT_HEAD.find(([k]) => names.some((n) => n.includes(k)))?.[1] ?? '#3d6fa8';
};
const inkOn = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 165 ? '#1f2a3d' : '#fff';
};

type Pick = { kind: 'task'; phase: string } | { kind: 'edge'; index: number } | null;

/** Where the graph's tools go when the recipe's top row has room for them (one recipe showing): in that row, not a row of their own. */
export const RecipeBarSlot = createContext<HTMLElement | null>(null);

export function RecipeGraph({ recipe, recipes = [], rules, onChange, onFullscreen, fullscreen, lead }: { lead?: ReactNode; onFullscreen?: () => void; fullscreen?: boolean; recipe: Recipe; recipes?: Recipe[]; rules: ScenarioRules; onChange: (r: Recipe) => void }) {
  const barSlot = useContext(RecipeBarSlot);
  const [picked, setPicked] = useState<Pick>(null);
  const [connect, setConnect] = useState<string | null | false>(false); // false: off; null: pick the first task; a phase: pick the second
  // The cards being moved (all the selected ones move together) and by how far.
  const [drag, setDrag] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  // The view is infinite: the canvas is moved (x, y) and scaled (z) inside the frame, like Blender's node editor.
  const [view, setView] = useState({ x: 40, y: 40, z: 1 });
  const zoom = view.z;
  const [dialog, setDialog] = useState<string | null>(null);
  // The selected cards (shift/ctrl-click adds one, a box around several selects them); `picked` is the one whose details show below.
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const [hide, setHide] = useState(false); // H: cards show only their name
  const grab = useRef<{ sx: number; sy: number; ids: string[]; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const [side, setSide] = useState(false); // N: the side panel with the selected node's settings
  // Options (the button in the bar): the wires, the background, and the colour of the headers.
  const [wires, setWires] = usePersistedState<'curved' | 'straight' | 'angled'>('recipes.graph.wires', 'curved');
  const [sideW, setSideW] = usePersistedState<number>('recipes.graph.sideW', 300);
  const [bg, setBg] = usePersistedState<'dots' | 'grid' | 'none'>('recipes.graph.bg', 'dots');
  const [colors, setColors] = usePersistedState<'activity' | 'single'>('recipes.graph.colors', 'activity');
  const [opts, setOpts] = useState(false);
  const [ganttOpen, setGanttOpen] = usePersistedState('recipes.graph.preview', true);
  // The quantities the preview works the formula tasks out for (a reference pour).
  const [refConcrete, setRefConcrete] = usePersistedState('recipes.graph.refConcrete', 150);
  const [refRebar, setRefRebar] = usePersistedState('recipes.graph.refRebar', 3.5);
  const [refParams, setRefParams] = usePersistedState<Record<string, number>>('recipes.graph.refParams', {});
  // The preview's rows (drawn when the preview is open, and moved to the dock): measured when they are there, so the link arrows follow their width.
  const [gRows, setGRows] = useState<HTMLDivElement | null>(null);
  // In the Recipes dock the preview moves out to the dock's own scroller, so it can sit at the bottom edge of the panel.
  const previewAnchor = useRef<HTMLSpanElement>(null);
  const [dockHost, setDockHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setDockHost((previewAnchor.current?.closest('.scn-rules--dock, .rec-detail') as HTMLElement | null) ?? null); }, []);
  const inDock = (node: ReactNode) => (dockHost && !fullscreen ? createPortal(node, dockHost) : node);
  const [gw, setGw] = useState(0); // the width of the preview's lanes, for its link arrows
  useEffect(() => {
    const el = gRows;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setGw(Math.max(0, el.clientWidth - 110));
    const ro = new ResizeObserver(() => setGw(Math.max(0, el.clientWidth - 110)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [gRows]);
  const profiles = useAppearanceStore((st) => st.profiles);
  const [resize, setResize] = useState<{ id: string; w: number } | null>(null); // a node being made wider or narrower
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null); // a wire being pulled from an output socket

  // Blender's keys, while the mouse is over the graph: H collapse, N sidebar, A select all, Alt+A none, X / Delete delete, Shift+D duplicate,
  // Home view all, . (or numpad .) view selected; the wheel zooms, Ctrl+wheel pans sideways, Shift+wheel up and down, middle button or Alt-drag pans.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e) => {
    if (!hovered.current || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    const mine = [...multi].filter((id) => id !== START && id !== END);
    const stop = () => e.preventDefault();
    if (e.altKey) { if (k === 'a') { stop(); setMulti(new Set()); setPicked(null); } return; }
    if (k === 'h') { stop(); setHide((h) => !h); }
    else if (k === 'n') { stop(); setSide((s) => !s); }
    else if (k === 'home') { stop(); frame(false); }
    else if (k === '.' || e.code === 'NumpadDecimal') { stop(); frame(true); }
    else if (k === 'a') { stop(); setMulti(new Set(placed.keys())); setPicked(null); }
    else if (k === 'x' || k === 'delete') {
      if (!mine.length) return;
      stop();
      onChange({ ...recipe, tasks: recipe.tasks.filter((x) => !mine.some((id) => same(id, x.phase))), edges: writtenEdges.filter((x) => !mine.some((id) => same(id, x.from) || same(id, x.to))) });
      setMulti(new Set()); setPicked(null); setDialog(null);
    } else if (k === 'd' && e.shiftKey) {
      if (!mine.length) return;
      stop();
      const names = new Map<string, string>();
      const taken = new Set(recipe.tasks.map((x) => x.phase.toUpperCase()));
      for (const id of mine) {
        let n = `${id} copy`;
        for (let i = 2; taken.has(n.toUpperCase()); i++) n = `${id} copy ${i}`;
        taken.add(n.toUpperCase());
        names.set(id, n);
      }
      const copies = mine.map((id) => ({ ...task(id)!, phase: names.get(id)!, name: undefined, x: at(id).x + 40, y: at(id).y + 40 }));
      const kept = writtenEdges.filter((x) => names.has(x.from) && names.has(x.to)).map((x) => ({ ...x, from: names.get(x.from)!, to: names.get(x.to)! }));
      onChange({ ...recipe, tasks: [...recipe.tasks, ...copies], edges: [...writtenEdges, ...kept] });
      setMulti(new Set(names.values())); setPicked(null);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Zoom about a point of the frame (the wheel: about the cursor).
  const zoomAbout = (factor: number, px: number, py: number) => setView((v) => {
    const z = clampZoom(v.z * factor);
    return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z };
  });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey) setView((v) => ({ ...v, x: v.x - e.deltaY }));
      else if (e.shiftKey) setView((v) => ({ ...v, y: v.y - e.deltaY }));
      else zoomAbout(Math.exp(-e.deltaY / 500), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** View all (Home), or the selected nodes (.): fit them in the frame. */
  const frame = (selected: boolean) => {
    const el = wrap.current;
    if (!el) return;
    const ids = selected && multi.size ? [...multi] : [...placed.keys()];
    const rs = ids.map(rectOf);
    const x0 = Math.min(...rs.map((r) => r.x)); const y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)); const y1 = Math.max(...rs.map((r) => r.y + r.h));
    const z = Math.min(1.5, Math.max(0.1, Math.min((el.clientWidth - 80) / (x1 - x0 || 1), (el.clientHeight - 80) / (y1 - y0 || 1))));
    setView({ z, x: (el.clientWidth - (x1 - x0) * z) / 2 - x0 * z, y: (el.clientHeight - (y1 - y0) * z) / 2 - y0 * z });
  };
  const framed = useRef(false);
  useEffect(() => { if (!framed.current && wrap.current?.clientWidth) { framed.current = true; frame(false); } }); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = graphEdges(recipe);
  const placed = positions(recipe);
  const at = (id: string) => {
    const p = placed.get(id) ?? { x: 0, y: 0 };
    return drag && drag.ids.includes(id) ? { x: p.x + drag.dx, y: p.y + drag.dy } : p;
  };
  const task = (phase: string) => recipe.tasks.find((t) => same(t.phase, phase));
  const crewPeople = (id?: string) => rules.crewTemplates.find((c) => same(c.id, id ?? ''))?.trades.reduce((n, t) => n + (t.size || 0), 0) ?? 0;
  // The preview's days (also on the cards of the formula tasks). Parameters the scenario does not have (none open) take the values typed in the preview.
  const known = new Set([...QUANTITY_NAMES.map((q) => q.toLowerCase()), ...(rules.parameters ?? []).map((p) => p.name.toLowerCase())]);
  const missing = [...new Set(recipe.tasks.filter((t) => t.enabled !== false && t.formula).flatMap((t) => formulaNames(t.formula!)))].filter((n) => !known.has(n.toLowerCase()));
  const typed: ParameterRow[] = Object.entries(refParams).filter(([n]) => missing.some((m) => m.toLowerCase() === n.toLowerCase())).map(([name, value]) => ({ id: name, name, value }));
  const bars = previewBars(recipe, rules.rates, [...typed, ...(rules.parameters ?? [])], { concreteM3: refConcrete, rebarT: refRebar });
  const rowsFor = (t: RecipeTask) => (hide ? [] : rowsOf(t, crewPeople(t.crew), bars.find((b) => same(b.phase, t.phase))));
  /** A node is a header, a row for its sockets, then a row per value it holds (a collapsed node, H, is only its header). */
  const sizeOf = (id: string) => {
    const t = id === START || id === END ? undefined : task(id);
    const custom = resize?.id === id ? resize.w : id === START ? recipe.startW : id === END ? recipe.endW : t?.w;
    if (!t) return { w: custom ?? 160, h: hide ? HEAD_H : HEAD_H + ROW_H };
    const rows = rowsFor(t);
    const longest = Math.max((t.name || t.phase).length * 7.6 + 20, ...rows.map(([k, v]) => (k.length + v.length) * 6.6 + 30));
    return { w: custom ?? Math.round(Math.min(280, Math.max(168, longest))), h: HEAD_H + (hide ? 0 : ROW_H + rows.length * ROW_H + 4) };
  };
  /** Dragging the right edge of a node sets its width (kept with the recipe); double-click the edge to go back to the automatic width. */
  const setWidth = (id: string, w: number | undefined) => {
    if (id === START) { const { startW: _s, ...rest } = recipe; return onChange(w ? { ...rest, startW: w } : rest); }
    if (id === END) { const { endW: _e, ...rest } = recipe; return onChange(w ? { ...rest, endW: w } : rest); }
    setTask(id, { w });
  };
  const resizeDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX; const w0 = sizeOf(id).w;
    let last = w0;
    const move = (m: PointerEvent) => { last = Math.round(Math.min(600, Math.max(120, w0 + (m.clientX - x0) / zoom)) / 4) * 4; setResize({ id, w: last }); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); setResize(null); if (last !== w0) setWidth(id, last); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  /** Where the wires meet a node: the left and right edge, level with its sockets. */
  const sockY = () => (hide ? HEAD_H / 2 : HEAD_H + ROW_H / 2);
  const socketOut = (id: string) => { const r = rectOf(id); return { x: r.x + r.w, y: r.y + sockY() }; };
  const socketIn = (id: string) => { const r = rectOf(id); return { x: r.x, y: r.y + sockY() }; };
  const rectOf = (id: string): Rect => ({ ...at(id), ...sizeOf(id) });
  const others = recipes.filter((r) => r !== recipe && r.id !== recipe.id);
  const writtenEdges = recipe.edges ?? [];

  // The calls of other recipes: a green node under the task, in a lane below the graph.
  const bottom = Math.max(...[...placed.keys()].map((id) => at(id).y + sizeOf(id).h));
  const baseY = bottom + 56;
  const linkNodes = recipe.tasks.flatMap((t) => (t.links ?? []).map((l, i) => ({ t, l, i }))).map((n, k) => ({ ...n, x: at(n.t.phase).x, y: baseY + (k % 2) * (LINK_H + 12) }));

  const setTask = (phase: string, patch: Partial<RecipeTask>) => onChange({ ...recipe, tasks: recipe.tasks.map((t) => (same(t.phase, phase) ? { ...t, ...patch } : t)) });
  const setLinks = (phase: string, links: RecipeLink[]) => setTask(phase, { links: links.length ? links : undefined });
  const setEdge = (index: number, next: RecipeEdge) => onChange({ ...recipe, edges: writtenEdges.map((e, i) => (i === index ? next : e)) });
  const rename = (old: string, phase: string) => {
    onChange({
      ...recipe,
      tasks: recipe.tasks.map((t) => (t.phase === old ? { ...t, phase } : t)),
      edges: writtenEdges.map((e) => ({ ...e, from: e.from === old ? phase : e.from, to: e.to === old ? phase : e.to })),
    });
    if (dialog === old) setDialog(phase);
    if (picked?.kind === 'task' && picked.phase === old) setPicked({ kind: 'task', phase });
  };
  const link = (from: string, to: string) => {
    if (same(from, to) || from === START || from === END || to === START || to === END) return;
    if (writtenEdges.some((e) => same(e.from, from) && same(e.to, to) && !e.type && e.sharePct === undefined && !e.lagHours)) return;
    onChange({ ...recipe, edges: [...writtenEdges, { from, to }] });
    setPicked({ kind: 'edge', index: writtenEdges.length });
  };
  const click = (id: string, e?: React.MouseEvent) => {
    if (dragged.current) { dragged.current = false; return; } // the click that ends a drag
    if (connect === false) {
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        const next = new Set(multi);
        if (!next.delete(id)) next.add(id);
        setMulti(next);
        return setPicked(next.size === 1 && !next.has(START) && !next.has(END) ? { kind: 'task', phase: [...next][0] } : null);
      }
      setMulti(new Set([id]));
      return setPicked(id === START || id === END ? null : { kind: 'task', phase: id });
    }
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
  const autoLayout = () => { const { startAt: _s, endAt: _e, ...rest } = recipe; onChange({ ...rest, tasks: recipe.tasks.map(({ x: _x, y: _y, ...t }) => t) }); };
  const removeTask = (phase: string) => {
    onChange({ ...recipe, tasks: recipe.tasks.filter((t) => !same(t.phase, phase)), edges: writtenEdges.filter((e) => !same(e.from, phase) && !same(e.to, phase)) });
    setPicked(null);
    setDialog(null);
  };

  const onDown = (e: React.PointerEvent, id: string) => {
    if (connect !== false || e.button !== 0) return;
    dragged.current = false;
    // Grabbing a card that is not selected selects it (shift/ctrl keeps the others); a selected card moves with the rest.
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const ids = multi.has(id) ? [...multi] : additive ? [...multi, id] : [id];
    if (!multi.has(id) && !additive) setMulti(new Set([id]));
    grab.current = { sx: e.clientX, sy: e.clientY, ids, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
    g.moved = true;
    const snap = (v: number) => Math.round(v / 10) * 10;
    setDrag({ ids: g.ids, dx: snap((e.clientX - g.sx) / zoom), dy: snap((e.clientY - g.sy) / zoom) });
  };
  const onUp = () => {
    const g = grab.current;
    if (g?.moved && drag) {
      const move = (id: string) => ({ x: (placed.get(id)?.x ?? 0) + drag.dx, y: (placed.get(id)?.y ?? 0) + drag.dy });
      const next: Recipe = { ...recipe, tasks: recipe.tasks.map((t) => (drag.ids.some((i) => same(i, t.phase)) ? { ...t, ...move(t.phase) } : t)) };
      if (drag.ids.includes(START)) next.startAt = move(START);
      if (drag.ids.includes(END)) next.endAt = move(END);
      onChange(next);
      dragged.current = true;
      const only = drag.ids.length === 1 && drag.ids[0] !== START && drag.ids[0] !== END ? drag.ids[0] : null;
      setPicked(only ? { kind: 'task', phase: only } : null);
    }
    grab.current = null;
    setDrag(null);
  };
  // Dragging the background draws a box that selects the cards it touches (shift/ctrl adds to the selection); Alt or the middle button pans.
  const canvasPoint = (e: React.PointerEvent) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0)) / zoom, y: (e.clientY - (r?.top ?? 0)) / zoom };
  };
  const panDown = (e: React.PointerEvent) => {
    if ((e.target !== e.currentTarget && e.target !== canvas.current) || !wrap.current) return;
    if (e.button === 1 || e.altKey) { e.preventDefault(); panning.current = { x: e.clientX, y: e.clientY, left: view.x, top: view.y }; }
    else if (e.button === 0) { const p = canvasPoint(e); setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey || e.ctrlKey || e.metaKey }); }
    else return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const panMove = (e: React.PointerEvent) => {
    if (box) { const p = canvasPoint(e); setBox({ ...box, x1: p.x, y1: p.y }); return; }
    const g = panning.current;
    if (g) setView((v) => ({ ...v, x: g.left + e.clientX - g.x, y: g.top + e.clientY - g.y }));
  };
  const panUp = () => {
    panning.current = null;
    if (!box) return;
    const [l, r] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
    const [t, b] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
    setBox(null);
    if (r - l < 4 && b - t < 4) { if (!box.add) setMulti(new Set()); return; } // a click on the background
    const hits = [...placed.keys()].filter((id) => { const q = rectOf(id); return q.x < r && q.x + q.w > l && q.y < b && q.y + q.h > t; });
    const next = new Set(box.add ? [...multi, ...hits] : hits);
    setMulti(next);
    setPicked(next.size === 1 && !next.has(START) && !next.has(END) ? { kind: 'task', phase: [...next][0] } : null);
  };
  const setZoom = (z: number) => zoomAbout(z / zoom, (wrap.current?.clientWidth ?? 0) / 2, (wrap.current?.clientHeight ?? 0) / 2);

  /** A wire leaves the output socket of one node and enters the input socket of the next, as a curve; when several join the same pair
      (SS and FF between the same two tasks) they bow apart. */
  const curve = (x1: number, y1: number, x2: number, y2: number, off = 0) => {
    if (wires === 'straight') return { d: `M${x1},${y1} L${(x1 + x2) / 2},${(y1 + y2) / 2 + off} L${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 + off };
    if (wires === 'angled') { const xm = (x1 + x2) / 2 + off; return { d: `M${x1},${y1} H${xm} V${y2} H${x2}`, mx: xm, my: (y1 + y2) / 2 }; }
    const k = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return {
      d: `M${x1},${y1} C${x1 + k},${y1 + off} ${x2 - k},${y2 + off} ${x2},${y2}`,
      mx: (x1 + 3 * (x1 + k) + 3 * (x2 - k) + x2) / 8,
      my: (y1 + 3 * (y1 + off) + 3 * (y2 + off) + y2) / 8,
    };
  };
  const geometry = (e: GraphEdge, nth: number, of: number) => {
    const a = socketOut(e.from);
    const b = socketIn(e.to);
    return curve(a.x, a.y, b.x, b.y, (nth - (of - 1) / 2) * 34);
  };
  // Pulling a wire: from an output socket to an input socket (the same as Connect Task).
  const wireDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = canvasPoint(e);
    setWire({ from: id, x: p.x, y: p.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const wireMove = (e: React.PointerEvent) => { if (wire) { const p = canvasPoint(e); setWire({ ...wire, x: p.x, y: p.y }); } };
  const wireUp = (e: React.PointerEvent) => {
    if (!wire) return;
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-in]')?.dataset.in;
    if (target) link(wire.from, target);
    setWire(null);
  };
  const pairKey = (e: GraphEdge) => [e.from, e.to].sort().join('|');
  const perPair = new Map<string, GraphEdge[]>();
  for (const e of edges) perPair.set(pairKey(e), [...(perPair.get(pairKey(e)) ?? []), e]);

  const sel = picked?.kind === 'task' ? task(picked.phase) : undefined;
  const selEdge = picked?.kind === 'edge' ? writtenEdges[picked.index] : undefined;
  const mode = (e: RecipeEdge): 'FS' | 'SS' | 'FF' | 'SF' | 'pct' => (e.type ? e.type : e.sharePct !== undefined && e.sharePct < 100 ? 'pct' : 'FS');
  const setMode = (index: number, e: RecipeEdge, to: ReturnType<typeof mode>) =>
    setEdge(index, to === 'pct' ? { from: e.from, to: e.to, sharePct: e.sharePct !== undefined && e.sharePct < 100 ? e.sharePct : 80 } : { from: e.from, to: e.to, type: to, ...(e.lagHours ? { lagHours: e.lagHours } : {}), ...(e.lagPct ? { lagPct: e.lagPct, lagOf: e.lagOf } : {}) });
  const dialogTask = dialog ? task(dialog) : undefined;

  const bar = (
      <div className="rg__bar">
        {lead}
        <button type="button" className={`btn btn--small${connect !== false ? ' primary' : ''}`} onClick={() => setConnect(connect === false ? null : false)} title="Click the task that comes first, then the task that follows it">
          {connect === false ? 'Connect Task' : connect === null ? 'Pick the first task…' : `${connect} → pick the next…`}
        </button>
        <button type="button" className="btn btn--small" onClick={autoLayout} title="Put the tasks in order again, left to right">Auto Layout</button>
        <button type="button" className="btn btn--small" onClick={addTask}>+ Create Task</button>
        <span className="rg__optwrap">
          <button type="button" className={`btn btn--small rg__gear${opts ? ' primary' : ''}`} onClick={() => setOpts(!opts)} title="Options: wires, background, header colours" aria-label="Options"><IconGear width={14} height={14} /></button>
          {opts && (
            <div className="rg__opts" onPointerDown={(e) => e.stopPropagation()}>
              <label>Wires
                <select className="rel-cell" value={wires} onChange={(e) => setWires(e.target.value as typeof wires)}>
                  <option value="curved">Curved</option><option value="straight">Straight</option><option value="angled">Angled</option>
                </select>
              </label>
              <label>Background
                <select className="rel-cell" value={bg} onChange={(e) => setBg(e.target.value as typeof bg)}>
                  <option value="dots">Dots</option><option value="grid">Grid</option><option value="none">Plain</option>
                </select>
              </label>
              <label className="rg__optcheck" title="Blender keys over the graph: H collapse, N sidebar, A select all, Alt+A none, X delete, Shift+D duplicate, Home view all, . view selected. Wheel zooms, Ctrl/Shift+wheel and middle-button or Alt drag pan; drag the background to box-select."><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide details (H)</label>
              <label>Header colours
                <select className="rel-cell" value={colors} onChange={(e) => setColors(e.target.value as typeof colors)}>
                  <option value="activity">By activity (Appearance Profiles)</option><option value="single">One colour</option>
                </select>
              </label>
            </div>
          )}
        </span>
        <span className="rg__view">
        <input className="rg__zoom" type="range" min={10} max={250} step={5} value={Math.round(zoom * 100)} onChange={(e) => setZoom(clampZoom(Number(e.target.value) / 100))} aria-label="Zoom" />
        <input className="rg__zoombox" value={`${Math.round(zoom * 100)}%`} readOnly aria-label="Zoom level" />
        {onFullscreen && <button type="button" className="rg__full" onClick={onFullscreen} title={fullscreen ? 'Back to the panel (Esc)' : 'Full screen (Esc to close)'} aria-label={fullscreen ? 'Close full screen' : 'Full screen'}><IconFullscreen width={22} height={22} /></button>}
        </span>
      </div>
  );

  return (
    <div className="rg" onMouseEnter={() => { hovered.current = true; }} onMouseLeave={() => { hovered.current = false; }}>
      {barSlot && !fullscreen ? createPortal(bar, barSlot) : bar}
      <div className="rg__main">
      <div className="rg__wrap" ref={wrap} data-bg={bg} style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${100 * zoom}px ${100 * zoom}px, ${20 * zoom}px ${20 * zoom}px`, ['--rg-fine' as string]: Math.max(0, Math.min(1, (zoom - 0.3) / 0.4)) }}
        onClick={(e) => { if (e.target === e.currentTarget) setPicked(null); }} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp}>
          <div className="rg__canvas" ref={canvas} style={{ width: 0, height: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            <svg className="rg__edges" width={1} height={1} aria-hidden="true">
              <defs>
                <marker id="rg-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker>
              </defs>
              {linkNodes.map((n) => {
                const a = at(n.t.phase);
                const down = n.l.direction !== 'before';
                const x = a.x + sizeOf(n.t.phase).w / 2;
                return (
                  <g key={`l${n.t.phase}|${n.i}`} className="rg__edge rg__edge--link">
                    <path d={down ? `M${x},${a.y + sizeOf(n.t.phase).h} L${x},${n.y - 2}` : `M${x},${n.y + LINK_H} L${x},${a.y + sizeOf(n.t.phase).h + 2}`} fill="none" markerEnd="url(#rg-arrow)" />
                  </g>
                );
              })}
              {edges.map((e, i) => {
                const group = perPair.get(pairKey(e)) ?? [e];
                const g = geometry(e, group.indexOf(e), group.length);
                const isSel = picked?.kind === 'edge' && picked.index === e.index && e.index >= 0;
                const [kind, value] = edgeChip(e);
                const kw = 8 + kind.length * 7;
                const vw = 10 + value.length * 7;
                return (
                  <g key={i} className={`rg__edge${e.implicit ? ' is-implicit' : ''}${isSel ? ' is-sel' : ''}`}>
                    <path d={g.d} fill="none" />
                    {!e.implicit && (
                      <g className="rg__chip" transform={`translate(${g.mx - (kw + vw) / 2},${g.my - 11})`} onClick={(ev) => { ev.stopPropagation(); setPicked({ kind: 'edge', index: e.index }); }}>
                        <rect width={kw + vw} height={22} rx={4} />
                        <line x1={kw} y1={3} x2={kw} y2={19} />
                        <text x={kw / 2} y={15} textAnchor="middle" className="rg__chip-kind">{kind}</text>
                        <text x={kw + vw / 2} y={15} textAnchor="middle">{value}</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {wire && (() => { const a = socketOut(wire.from); return <g className="rg__edge is-sel"><path d={curve(a.x, a.y, wire.x, wire.y).d} fill="none" /></g>; })()}
            </svg>
            {linkNodes.map((n) => (
              <div key={`${n.t.phase}|${n.i}`} className={`rg__node rg__node--link${n.l.enabled === false ? ' is-off' : ''}`} style={{ left: n.x, top: n.y, width: Math.max(168, sizeOf(n.t.phase).w), height: LINK_H }} onClick={() => setPicked({ kind: 'task', phase: n.t.phase })}
                title={`${n.t.phase} ${n.l.direction === 'before' ? 'follows' : 'is followed by'} ${n.l.recipe} · ${n.l.phase} (${n.l.scope ?? 'level'})`}>
                <div className="rg__head"><span className="rg__title">{n.l.recipe} · {n.l.phase}</span></div>
                <div className="rg__row"><span className="rg__k">Recipe link</span><span className="rg__v">{n.l.type ?? 'FS'} · {n.l.scope === 'all' ? 'anywhere' : n.l.scope === 'building' ? 'building' : 'level'}</span></div>
              </div>
            ))}
            {[...placed.keys()].map((id) => {
              const p = at(id);
              const boundary = id === START || id === END;
              const t = boundary ? undefined : task(id)!;
              const isSel = multi.has(id) || (!!t && picked?.kind === 'task' && same(picked.phase, id));
              const rows = t ? rowsFor(t) : [];
              const sockTop = sockY() - 5;
              return (
                <div
                  key={id}
                  className={`rg__node${boundary ? ' rg__node--end' : ''}${isSel ? ' is-sel' : ''}${t?.enabled === false ? ' is-off' : ''}${connect === id ? ' is-from' : ''}${connect !== false ? ' is-connecting' : ''}`}
                  style={{ left: p.x, top: p.y, width: sizeOf(id).w, height: sizeOf(id).h }}
                  onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={onUp} onClick={(e) => click(id, e)} onDoubleClick={() => { if (connect === false && t) setDialog(id); }}
                  title={t ? 'Double-click to edit the task' : undefined}
                >
                  <div className="rg__head" style={t && colors === 'activity' && t.enabled !== false ? (() => { const c = headColor(t, profiles); return { background: c, color: inkOn(c) }; })() : undefined}><span className="rg__title">{boundary ? (id === START ? 'Previous Elements' : 'Next Elements') : t!.name || t!.phase}</span></div>
                  {!hide && (
                    <div className="rg__row rg__row--flow">
                      <span className="rg__k">{id === START ? '' : 'Start'}</span>
                      <span className="rg__v rg__v--out">{id === END ? '' : 'Finish'}</span>
                    </div>
                  )}
                  {rows.map(([k, v]) => <div key={k} className="rg__row"><span className="rg__k">{k}</span><span className="rg__v" title={v}>{v}</span></div>)}
                  <span className="rg__resize" title="Drag to set the width (double-click: automatic)" onPointerDown={(e) => resizeDown(e, id)} onDoubleClick={(e) => { e.stopPropagation(); setWidth(id, undefined); }} onClick={(e) => e.stopPropagation()} />
                  {id !== START && <span className="rg__sock rg__sock--in" data-in={id} style={{ top: sockTop }} />}
                  {id !== END && <span className="rg__sock rg__sock--out" style={{ top: sockTop }} title="Drag to the input of another task to link them" onPointerDown={(e) => wireDown(e, id)} onPointerMove={wireMove} onPointerUp={wireUp} />}
                </div>
              );
            })}
            {box && <div className="rg__marquee" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
          </div>
        {dialogTask && (
          <RecipeTaskDialog
            task={dialogTask} rules={rules}
            onPatch={(patch) => setTask(dialogTask.phase, patch)} onRename={(phase) => rename(dialogTask.phase, phase)}
            onDelete={() => removeTask(dialogTask.phase)} onClose={() => setDialog(null)}
          />
        )}
      </div>
      {side && (<div className="rg__split" role="separator" aria-orientation="vertical" title="Drag to resize the node settings" onPointerDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX; const w0 = sideW; const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => setSideW(Math.round(Math.min(700, Math.max(220, w0 + x0 - m.clientX))));
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      }} />)}
      {side && (<aside className="rg__side" style={{ flexBasis: sideW, maxWidth: '70%' }}><div className="rg__side-head">Node settings <span className="scn-dim">(N)</span></div>{!sel && !selEdge && <p className="scn-dim rg__side-empty">Select a task to see its crew, resources, rates and duration here, or a link to edit its type and lag.</p>}
      {sel && (
        <div className="rg__links">
          <div className="rel-bar">
            <strong>{sel.name || sel.phase}</strong>
            <button type="button" className="btn btn--small" onClick={() => setDialog(sel.phase)}>Edit task…</button>
            <button type="button" className="btn btn--small" disabled={!others.length} onClick={() => setLinks(sel.phase, [...(sel.links ?? []), { recipe: others[0].id, phase: others[0].tasks[0]?.phase ?? '' }])} title={others.length ? 'Make a task of another recipe follow (or precede) this one' : 'Add another recipe first'}>+ Link to another recipe</button>
          </div>
          <RecipeTaskDialog panel task={sel} rules={rules} onPatch={(patch) => setTask(sel.phase, patch)} onRename={(phase) => rename(sel.phase, phase)} onDelete={() => removeTask(sel.phase)} onClose={() => undefined} />
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
                <button type="button" className="cols__icon cols__icon--remove" onClick={() => setLinks(sel.phase, (sel.links ?? []).filter((_, j) => j !== i))} aria-label="Remove the link"><IconRemove /></button>
              </div>
            );
          })}
        </div>
      )}
      {selEdge && picked?.kind === 'edge' && (() => {
        const m = mode(selEdge);
        const kinds: [ReturnType<typeof mode>, string, string][] = [
          ['FS', 'FS', 'Finish to start: the next task starts when this one is finished.'],
          ['SS', 'SS', 'Start to start: the next task starts when this one starts.'],
          ['FF', 'FF', 'Finish to finish: the next task finishes when this one finishes.'],
          ['SF', 'SF', 'Start to finish: the next task finishes when this one starts.'],
          ['pct', '% done', 'The next task starts when a share of this one is done, so they overlap.'],
        ];
        return (
          <div className="np__task np__link">
            <details className="np__fold" open><summary><IconChevronDown className="np__chev" width={18} height={18} />Link</summary>
              <div className="np__body np__linkbody">
                <div className="np__ends"><span title={selEdge.from}>{selEdge.from}</span><span className="np__arrow">→</span><span title={selEdge.to}>{selEdge.to}</span></div>
                <div className="np__field">Type
                  <div className="np__seg" role="radiogroup" aria-label="Link type">
                    {kinds.map(([k, label, tip]) => (
                      <button key={k} type="button" role="radio" aria-checked={m === k} className={m === k ? 'is-on' : ''} title={tip} onClick={() => setMode(picked.index, selEdge, k)}>{label}</button>
                    ))}
                  </div>
                  <span className="np__hint">{kinds.find(([k]) => k === m)![2]}</span>
                </div>
                {m === 'pct' ? (
                  <label title="The share of the first task that must be done when the second starts (an overlap of the rest)">Share done
                    <span className="np__unit"><input className="rel-cell" type="number" min={0} max={99} value={selEdge.sharePct ?? 80} onChange={(e) => setEdge(picked.index, { ...selEdge, sharePct: Math.min(99, Math.max(0, num(e.target.value) ?? 80)) })} /><i>%</i></span>
                  </label>
                ) : (
                  <label title="Added to the link: working days, or a share of a task's duration, so it follows the quantities; negative: the tasks overlap by that much">Lag
                    <span className="np__unit">
                      <input className="rel-cell" type="number" step="any" value={(selEdge.lagPct ?? (selEdge.lagHours ? Math.round((selEdge.lagHours / HOURS_PER_DAY) * 100) / 100 : 0)) || ''} placeholder="0" onChange={(e) => {
                        const v = num(e.target.value);
                        const { lagHours: _h, lagPct: _p, lagOf: _o, ...rest } = selEdge;
                        setEdge(picked.index, !v ? rest : selEdge.lagPct !== undefined ? { ...rest, lagPct: v, lagOf: selEdge.lagOf ?? 'pred' } : { ...rest, lagHours: v * HOURS_PER_DAY });
                      }} />
                      <select className="rel-cell" aria-label="Lag unit" value={selEdge.lagPct !== undefined ? (selEdge.lagOf ?? 'pred') : 'd'} onChange={(e) => {
                        const unit = e.target.value;
                        // The figure stays as typed: days <-> % keeps the number, not the length of time.
                        const v = selEdge.lagPct ?? (selEdge.lagHours ? selEdge.lagHours / HOURS_PER_DAY : 0);
                        const { lagHours: _h, lagPct: _p, lagOf: _o, ...rest } = selEdge;
                        setEdge(picked.index, !v ? rest : unit === 'd' ? { ...rest, lagHours: v * HOURS_PER_DAY } : { ...rest, lagPct: v, lagOf: unit as 'pred' | 'succ' });
                      }}>
                        <option value="d">days</option>
                        <option value="pred">% of {selEdge.from}</option>
                        <option value="succ">% of {selEdge.to}</option>
                      </select>
                    </span>
                    <span className="np__hint">Negative makes the tasks overlap. A % is of that task's duration, so it follows the quantities.</span>
                  </label>
                )}
              </div>
            </details>
            <button type="button" className="btn btn--small np__danger" onClick={() => { onChange({ ...recipe, edges: writtenEdges.filter((_, i) => i !== picked.index) }); setPicked(null); }}>Remove link</button>
          </div>
        );
      })()}
      </aside>)}
      </div>
      <span ref={previewAnchor} hidden />
      {inDock(<div className="rg__preview">
      <button type="button" className={`rg__dockbar${ganttOpen ? ' is-open' : ''}`} onClick={() => setGanttOpen(!ganttOpen)} aria-expanded={ganttOpen} title={ganttOpen ? 'Hide the preview' : 'Show the preview: the recipe as a Gantt chart'}><IconChevronDown width={18} height={18} /><span>Preview</span></button>
      {(() => {
        // A rough Gantt of the recipe under the graph: a bar per task, as long as its days, placed by its links.
        if (!ganttOpen) return null;
        const total = Math.max(1, ...bars.map((b) => b.start + b.days));
        const step = [1, 2, 5, 10, 20, 50, 100].find((s) => total / s <= 12) ?? 100;
        const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
        return (
          <div className="rg__gantt" aria-label="Preview of the recipe as a Gantt chart">
            <div className="rg__gantt-head"><strong>Preview</strong><span className="scn-dim">about {Math.round(total * 10) / 10} working days, bars to scale; ~ means the days depend on quantities</span>
              <span className="scn-dim" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} title="The quantities the ~ bars are worked out for (a reference pour)">
                Reference
                <input type="number" min={0} step={10} value={refConcrete} onChange={(e) => setRefConcrete(Math.max(0, Number(e.target.value) || 0))} style={{ width: 64 }} aria-label="Reference concrete (m³)" />m³ concrete
                <input type="number" min={0} step={0.5} value={refRebar} onChange={(e) => setRefRebar(Math.max(0, Number(e.target.value) || 0))} style={{ width: 56 }} aria-label="Reference rebar (t)" />t rebar
                {missing.map((n) => (
                  <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`${n} is a scenario parameter (Parameters) and no scenario is open: type the value the preview should use`}>
                    {n}
                    <input type="number" step="any" placeholder="value" value={refParams[n] ?? ''} onChange={(e) => { const v = num(e.target.value); setRefParams((p) => { const { [n]: _d, ...rest } = p; return v === undefined ? rest : { ...rest, [n]: v }; }); }} style={{ width: 64 }} aria-label={`Value of ${n} for the preview`} />
                  </span>
                ))}
              </span></div>
            {bars.filter((b) => b.problem).map((b) => (
              <div key={b.phase} className="scn-dim" style={{ color: 'var(--warn, #b45309)' }}>{b.phase}: its formula could not be worked out for the preview, so it is drawn as one day — {b.problem}</div>
            ))}
            <div className="rg__gantt-axis">{ticks.map((d) => <span key={d} style={{ left: `${(d / total) * 100}%` }}>{d}</span>)}</div>
            <div className="rg__gantt-rows" ref={setGRows}>
            {gw > 0 && (
              <svg className="rg__gantt-links" width={gw} height={bars.length * 24} aria-hidden="true">
                {edges.filter((e) => e.from !== START && e.to !== END).map((e, i) => {
                  const ia = bars.findIndex((b) => same(b.phase, e.from));
                  const ib = bars.findIndex((b) => same(b.phase, e.to));
                  if (ia < 0 || ib < 0) return null;
                  const a = bars[ia];
                  const b = bars[ib];
                  const px = (d: number) => (d / total) * gw;
                  const from = e.type === 'SS' || e.type === 'SF' ? a.start : e.sharePct < 100 && !e.type ? a.start + (a.days * e.sharePct) / 100 : a.start + a.days;
                  const to = e.type === 'FF' || e.type === 'SF' ? b.start + b.days : b.start;
                  const x1 = px(from);
                  const x2 = px(to);
                  const y1 = ia * 24 + 12;
                  const y2 = ib * 24 + 12;
                  const ym = ib > ia ? ia * 24 + 20 : ia * 24 + 4;
                  return (
                    <g key={i} className={e.implicit ? 'is-implicit' : undefined}>
                      <path d={`M${x1},${y1} H${x1 + 6} V${ym} H${x2 - 6} V${y2} H${x2}`} fill="none" />
                      <path d={`M${x2},${y2} l-5,-3 v6 z`} className="rg__gantt-arrow" />
                    </g>
                  );
                })}
              </svg>
            )}
            {bars.map((b) => {
              const t = task(b.phase)!;
              const c = colors === 'activity' ? headColor(t, profiles) : '#3d6fa8';
              const on = multi.has(b.phase) || (picked?.kind === 'task' && same(picked.phase, b.phase));
              return (
                <div key={b.phase} className={`rg__gantt-row${on ? ' is-sel' : ''}`} onClick={() => { setMulti(new Set([b.phase])); setPicked({ kind: 'task', phase: b.phase }); }}>
                  <span className="rg__gantt-name" title={t.name || t.phase}>{t.name || t.phase}</span>
                  <div className="rg__gantt-lane">
                    {ticks.map((d) => <i key={d} style={{ left: `${(d / total) * 100}%` }} />)}
                    <span className="rg__gantt-bar" style={{ left: `${(b.start / total) * 100}%`, width: `${(b.days / total) * 100}%`, background: c, color: inkOn(c) }} title={`${t.name || t.phase}: day ${Math.round(b.start * 10) / 10} to ${Math.round((b.start + b.days) * 10) / 10}${b.problem ? ` (formula problem: ${b.problem})` : ''}`}>{b.approx ? '~' : ''}{Math.round(b.days * 10) / 10}d</span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        );
      })()}
      </div>)}
    </div>
  );
}
