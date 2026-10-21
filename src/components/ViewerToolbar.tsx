import { useMarkersStore } from '../state/markersStore';
import { useFocusStore } from '../state/focusStore';
import { useSectionsStore } from '../state/sectionsStore';
import { useIgnoreTimelinerStore } from '../state/ignoreTimelinerStore';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type * as OBC from '@thatopen/components';
import * as THREE from 'three';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import type { MeasureKind, ViewerTool } from '../viewer/ViewerEngine';
import { useSelectionStore } from '../state/selectionStore';
import { useModelsStore } from '../state/modelsStore';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { useTagsStore } from '../state/tagsStore';
import { useSequenceLabelStore } from '../state/sequenceLabelStore';
import { usePersistedState } from '../utils/persistedState';
import { elementValue, prettyClass } from '../viewer/bimTables';
import { useIndexTick } from './modelFields';
import { WALK_SPEEDS } from '../viewer/walkthrough';
import {
  IconBoxSelect, IconCategory, IconLocationPoint, IconNavigationArrow, IconWalk, IconShortText, IconTagOutline, IconViewCube, IconChevronDown, IconChevronRight, IconFullscreen, IconCube, IconCursor, IconDeleteAll, IconFilter, IconGhost, IconGrid, IconIfcGrid, IconPaintBucket, IconPalette, IconMeasureArea, IconMeasureLength,
  IconMeasurePerimeter, IconMeasureSlope, IconMeasureVertical, IconModelOrtho, IconPerspective, IconPin, IconSection, IconSelectionSet, IconSelectOff, IconSinglePane, IconTransparency, IconTwoPane, IconViewAxon, IconViewBack,
  IconViewBottom, IconViewFront, IconViewLeft, IconViewRight, IconViewShowAll, IconViewTop, IconVisibility, IconVisibilityOff, IconZoomToSelected,
} from './icons';

type IconC = (p: React.SVGProps<SVGSVGElement>) => ReactNode;

// ---- building blocks ---------------------------------------------------------

/** A dark label under the hovered control (rendered on <body>, so the
    toolbar's own scrolling never clips it). */
function Tip({ anchor, text }: { anchor: HTMLElement | null; text: string }) {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  return createPortal(<div className="vtb-tip" style={{ left: r.left + r.width / 2, top: r.bottom + 6 }}>{text}</div>, document.body);
}

function useTip(text: string) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    props: { onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget), onMouseLeave: () => setAnchor(null), onMouseDown: () => setAnchor(null), 'aria-label': text },
    tip: <Tip anchor={anchor} text={text} />,
  };
}

/** An icon button; `active` fills it with the accent colour (a toggle that's on, or the tool in use). */
export function Btn({ icon: I, tip, active, disabled, onClick, ownGesture, size = 20 }: { icon: IconC; tip: string; active?: boolean; disabled?: boolean; onClick: () => void; ownGesture?: boolean; size?: number }) {
  const t = useTip(tip);
  return (
    <>
      <button type="button" className={`vtb-btn${active ? ' is-on' : ''}`} aria-pressed={active} disabled={disabled} onClick={onClick} data-own-gesture={ownGesture || undefined} {...t.props}>
        <I width={size} height={size} />
      </button>
      {t.tip}
    </>
  );
}

// Full screen (as F11 does), in step with Esc / F11 / the browser. Entered
// from a toolbar it also hides the app's top bar (the page tabs), for the
// most room; leaving full screen any way (Esc, F11) brings it back. One
// state for every toolbar showing the button (3D viewer, Programmes).
export const useFullscreenStore = create<{ on: boolean }>(() => ({
  on: !!document.fullscreenElement && document.body.classList.contains('viewer-fullscreen'),
}));
function setTopBarHidden(hidden: boolean) {
  document.body.classList.toggle('viewer-fullscreen', hidden);
  useFullscreenStore.setState({ on: hidden });
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setTopBarHidden(false);
});
export function toggleFullscreen() {
  if (useFullscreenStore.getState().on) {
    setTopBarHidden(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    return;
  }
  setTopBarHidden(true);
  // Already full screen (e.g. on start): just hide the top bar.
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => setTopBarHidden(false));
}

/** Enter / exit full screen mode (also hides the page tabs). */
export function FullscreenButton() {
  const on = useFullscreenStore((st) => st.on);
  return <Btn icon={IconFullscreen} size={24} tip={on ? 'Exit full screen mode' : 'Enter full screen mode'} active={on} ownGesture onClick={toggleFullscreen} />;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconC;
  /** A tick box (checked / not). */
  checked?: boolean;
  /** Highlighted as the current choice. */
  current?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
  /** A flyout with more items. */
  items?: MenuItem[];
  /** Keep the menu open after clicking (tick boxes). */
  keepOpen?: boolean;
}

/** A dropdown under `anchor` (on <body>); closes on a click outside or Esc. */
function Menu({ anchor, items, onClose, sub }: { anchor: DOMRect; items: MenuItem[]; onClose: () => void; sub?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flyout, setFlyout] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [pos, setPos] = useState({ left: sub ? anchor.right : anchor.left, top: sub ? anchor.top : anchor.bottom + 2 });
  useLayoutEffect(() => {
    // Keep it on screen.
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = sub ? anchor.right : anchor.left;
    if (left + w > window.innerWidth - 8) left = sub ? anchor.left - w : window.innerWidth - 8 - w;
    const top = Math.max(8, Math.min(sub ? anchor.top : anchor.bottom + 2, window.innerHeight - 8 - h));
    setPos({ left, top });
  }, [anchor, sub, items.length]);
  useEffect(() => {
    if (sub) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.vtb-menu')) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, sub]);
  return createPortal(
    <div ref={ref} className="vtb-menu" role="menu" style={pos}>
      {items.map((it) => {
        if (it.separator) return <div key={it.key} className="vtb-menu__sep" role="separator" />;
        const I = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            className={`vtb-menu__item${it.current ? ' is-current' : ''}${flyout?.key === it.key ? ' is-open' : ''}`}
            disabled={it.disabled}
            onMouseEnter={(e) => setFlyout(it.items ? { key: it.key, rect: e.currentTarget.getBoundingClientRect() } : null)}
            onClick={(e) => {
              if (it.items) { setFlyout({ key: it.key, rect: e.currentTarget.getBoundingClientRect() }); return; }
              it.onClick?.();
              if (!it.keepOpen) onClose();
            }}
          >
            {it.checked !== undefined && <input type="checkbox" readOnly tabIndex={-1} checked={it.checked} />}
            {I && <I width={18} height={18} />}
            <span className="vtb-menu__label">{it.label}</span>
            {it.items && <IconChevronRight className="vtb-menu__more" width={14} height={14} />}
          </button>
        );
      })}
      {flyout && (() => {
        const it = items.find((x) => x.key === flyout.key);
        return it?.items ? <Menu anchor={flyout.rect} items={it.items} onClose={onClose} sub /> : null;
      })()}
    </div>,
    document.body,
  );
}

/** A button with a chevron beside it for its menu; `onClick` null: the button opens the menu too. */
export function Split({ icon, tip, menuTip, active, disabled, onClick, items }: { icon: IconC; tip: string; menuTip: string; active?: boolean; disabled?: boolean; onClick: (() => void) | null; items: MenuItem[] }) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const caret = useTip(menuTip);
  const toggle = () => setOpen((o) => (o ? null : root.current!.getBoundingClientRect()));
  return (
    <span className={`vtb-split${active ? ' is-on' : ''}${open ? ' is-open' : ''}`} ref={root}>
      <Btn icon={icon} tip={tip} active={active} disabled={disabled} onClick={onClick ?? toggle} />
      <button type="button" className={`vtb-caret${active ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={!!open} onClick={toggle} {...caret.props}>
        <IconChevronDown width={12} height={12} />
      </button>
      {caret.tip}
      {open && <Menu anchor={open} items={items} onClose={() => setOpen(null)} />}
    </span>
  );
}

export const Sep = () => <span className="vtb-sep" aria-hidden="true" />;

// ---- the toolbar -------------------------------------------------------------

interface MeasureChoice {
  id: string;
  kind: MeasureKind | 'point';
  mode?: string;
  label: string;
  icon: IconC;
  tip: string;
}

/** What the viewer can measure (That Open's measurement tools and their modes). */
const MEASURES: MeasureChoice[] = [
  { id: 'length', kind: 'length', mode: 'free', label: 'Length (point to point)', icon: IconMeasureLength, tip: 'Double-click two points. Delete removes one, Esc cancels.' },
  { id: 'edge', kind: 'length', mode: 'edge', label: 'Length of an edge', icon: IconMeasureVertical, tip: 'Double-click an edge of an object.' },
  { id: 'area', kind: 'area', mode: 'free', label: 'Area (polygon)', icon: IconMeasureArea, tip: 'Double-click each corner, then the first again.' },
  { id: 'square', kind: 'area', mode: 'square', label: 'Area (rectangle)', icon: IconMeasurePerimeter, tip: 'Double-click three corners of a rectangle.' },
  { id: 'face', kind: 'area', mode: 'face', label: 'Area of a face', icon: IconMeasureArea, tip: 'Double-click a face of an object.' },
  { id: 'angle', kind: 'angle', label: 'Angle', icon: IconMeasureSlope, tip: 'Double-click start, vertex and end.' },
  { id: 'point', kind: 'point', label: 'Point coordinates', icon: IconLocationPoint, tip: 'Double-click a point (it snaps to corners): its X, Y, Z (project axes, metres) is written in the view and copied. Delete removes the last one.' },
  { id: 'volume', kind: 'volume', label: 'Volume of an object', icon: IconCube, tip: 'Double-click an object.' },
];

const VIEWS: { id: string; label: string; icon: IconC; dir: THREE.Vector3 }[] = [
  { id: 'axon', label: 'Axon view', icon: IconViewAxon, dir: new THREE.Vector3(1, 0.8, 1) },
  { id: 'top', label: 'Top view', icon: IconViewTop, dir: new THREE.Vector3(0, 1, 0) },
  { id: 'front', label: 'Front view', icon: IconViewFront, dir: new THREE.Vector3(0, 0, 1) },
  { id: 'left', label: 'Left view', icon: IconViewLeft, dir: new THREE.Vector3(-1, 0, 0) },
  { id: 'back', label: 'Back view', icon: IconViewBack, dir: new THREE.Vector3(0, 0, -1) },
  { id: 'right', label: 'Right view', icon: IconViewRight, dir: new THREE.Vector3(1, 0, 0) },
  { id: 'bottom', label: 'Bottom view', icon: IconViewBottom, dir: new THREE.Vector3(0, -1, 0) },
];

/** Colours offered by the paint bucket. */
const PAINT_COLORS = [
  { hex: '#e03131', label: 'Red' },
  { hex: '#f08c00', label: 'Orange' },
  { hex: '#fcc419', label: 'Yellow' },
  { hex: '#2f9e44', label: 'Green' },
  { hex: '#1c7ed6', label: 'Blue' },
  { hex: '#7048e8', label: 'Purple' },
  { hex: '#adb5bd', label: 'Grey' },
  { hex: '#ffffff', label: 'White' },
  { hex: '#212529', label: 'Black' },
];
const swatchIcon = (hex: string): IconC => {
  const Swatch: IconC = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="4" fill={hex} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
    </svg>
  );
  return Swatch;
};
const SWATCH_ICONS = new Map(PAINT_COLORS.map((c) => [c.hex, swatchIcon(c.hex)]));

/** The 3D viewer's toolbar (Models and 4D Sequencing): icon buttons, the
    ones switched on filled with the accent colour, and split buttons with
    a menu for the measure types, the standard views and what is shown. */
export function ViewerToolbar() {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  const hasSelection = Object.values(byModel).some((ids) => ids.length > 0);
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const page = useViewSettingsStore((s) => s.activePage);
  const main = useViewSettingsStore((s) => s.pages[page].main);
  const patchView = useViewSettingsStore((s) => s.patch);
  const patchPage = useViewSettingsStore((s) => s.patchPage);
  const showCube = useViewSettingsStore((s) => s.pages[page].showCube);
  const showNorth = useViewSettingsStore((s) => s.pages[page].showNorth ?? true);
  const showIfcGrids = useViewSettingsStore((s) => s.pages[page].showIfcGrids ?? false);
  // 4D Sequencing overlays (set up in its Label tab).
  const tagsShown = useTagsStore((s) => s.shown);
  const markersShown = useMarkersStore((s) => s.visible);
  const setMarkersShown = useMarkersStore((s) => s.setVisible);
  const setTagsShown = useTagsStore((s) => s.setShown);
  const tagList = useTagsStore((s) => s.tags);
  const hoverTagId = useTagsStore((s) => s.hoverTagId);
  const setHoverTagId = useTagsStore((s) => s.setHoverTagId);
  const dateLabel = useSequenceLabelStore((s) => s.enabled);
  const ignoreTimeliner = useIgnoreTimelinerStore((s) => s.ignore);
  const focus = useFocusStore((s) => s.focus);
  const setDateLabel = useSequenceLabelStore((s) => s.setEnabled);

  // Paint bucket: the colour the next click paints the selection with.
  const [paintColor, setPaintColor] = usePersistedState('viewer.toolbar.paintColor', '#e03131');
  const paintInput = useRef<HTMLInputElement>(null);
  const paint = (hex: string) => {
    setPaintColor(hex);
    void engine.paintSelection(hex);
  };
  const BucketIcon = useMemo<IconC>(() => (p) => <IconPaintBucket {...p} bar={paintColor} />, [paintColor]);

  // Tools and what they left behind.
  const [tool, setToolState] = useState<ViewerTool>(() => engine.getActiveTool());
  const [measureId, setMeasureId] = usePersistedState('viewer.toolbar.measure', 'length');
  const measure = MEASURES.find((m) => m.id === measureId) ?? MEASURES[0];
  const [, bump] = useState(0);
  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    engine.onToolContentChange.add(onChange);
    return () => { engine.onToolContentChange.remove(onChange); };
  }, [engine]);
  const setTool = (next: ViewerTool) => {
    engine.setActiveTool(next);
    setToolState(next);
  };
  // The Sections panel's close button ends the tool as well.
  const sectionsOpen = useSectionsStore((s) => s.open);
  useEffect(() => {
    if (!sectionsOpen && engine.getActiveTool() === 'section') { engine.setActiveTool('select'); setToolState('select'); }
  }, [engine, sectionsOpen]);
  const pickMeasure = (m: MeasureChoice) => {
    setMeasureId(m.id);
    if (m.mode && m.kind !== 'point') engine.setMeasureMode(m.kind, m.mode);
    setTool(m.kind);
  };
  const measuring = tool !== 'select' && tool !== 'section' && tool !== 'box';

  // Walkthrough (W A S D, E / Space up, Q / C down): the keyboard moves the camera through the model.
  const [walking, setWalking] = useState(false);
  const [walkSpeed, setWalkSpeed] = useState(4);
  useEffect(() => {
    let off = () => {};
    void engine.ready.then(() => {
      const w = engine.walkthrough;
      if (!w) return;
      setWalking(w.isActive);
      setWalkSpeed(w.speed);
      const on = (active: boolean) => setWalking(active);
      w.onChange.add(on);
      off = () => w.onChange.remove(on);
    });
    return () => off();
  }, [engine]);

  // Select / Isolate, Ghost on top, Pin.
  const [baseMode, setBaseMode] = useState<'select' | 'isolate'>(() => (engine.getInteractionMode() === 'isolate' ? 'isolate' : 'select'));
  const [ghost, setGhost] = useState(() => engine.getInteractionMode() === 'reveal');
  const [pinned, setPinned] = useState(() => engine.isRevealPinned());
  // The mode can also be changed from code (Record in Search sets goes back to Select): the buttons follow.
  useEffect(() => {
    const onMode = (mode: 'select' | 'isolate' | 'reveal') => {
      setGhost(mode === 'reveal');
      if (mode !== 'reveal') setBaseMode(mode);
    };
    engine.onInteractionModeChange.add(onMode);
    return () => { engine.onInteractionModeChange.remove(onMode); };
  }, [engine]);
  // In a split, which view the buttons work on (the one last clicked in), shown beside them.
  const [activeView, setActiveView] = useState(() => engine.getActiveView());
  const [hasSecond, setHasSecond] = useState(() => !!engine.secondary);
  const sideBySide = useViewSettingsStore((st) => (st.pages[page].compare ?? 'side') === 'side');
  useEffect(() => {
    const sync = () => { setActiveView(engine.getActiveView()); setHasSecond(!!engine.secondary); };
    engine.onActiveViewChange.add(sync);
    engine.onSecondaryChange.add(sync);
    sync();
    return () => { engine.onActiveViewChange.remove(sync); engine.onSecondaryChange.remove(sync); };
  }, [engine]);
  // In a split the buttons show the view last clicked in: when that changes they take on its mode and pin.
  useEffect(() => {
    const onView = () => {
      const mode = engine.getInteractionMode();
      setGhost(mode === 'reveal');
      if (mode !== 'reveal') setBaseMode(mode);
      setPinned(engine.isRevealPinned());
    };
    engine.onActiveViewChange.add(onView);
    return () => { engine.onActiveViewChange.remove(onView); };
  }, [engine]);
  useEffect(() => {
    const onPin = (p: boolean) => setPinned(p);
    engine.onRevealPinChange.add(onPin);
    return () => { engine.onRevealPinChange.remove(onPin); };
  }, [engine]);
  const [xray, setXray] = useState(() => engine.isXray());
  useEffect(() => {
    const onXray = (on: boolean) => setXray(on);
    engine.onXrayChange.add(onXray);
    return () => { engine.onXrayChange.remove(onXray); };
  }, [engine]);
  const applyMode = (base: 'select' | 'isolate', wantGhost: boolean) => {
    // Ghost fades what Isolate would hide: it belongs to Isolate, so Select never has it.
    const g = base === 'isolate' && wantGhost;
    setBaseMode(base);
    setGhost(g);
    // The buttons then show what the view really is in, whatever finished first.
    void engine.setInteractionMode(g ? 'reveal' : base).then(() => {
      const mode = engine.getInteractionMode();
      setGhost(mode === 'reveal');
      if (mode !== 'reveal') setBaseMode(mode);
    });
  };

  // Ignoring the timeliner (Scenarios toolbar) isolates + ghosts; following it again goes back to select and shows all objects.
  const firstIgnoreRun = useRef(true);
  const skipFocusEffect = useRef(false);
  useEffect(() => {
    if (firstIgnoreRun.current) { firstIgnoreRun.current = false; return; }
    if (ignoreTimeliner) {
      applyMode('isolate', true);
      return;
    }
    void (async () => {
      // Following the 4D dates again ends Focus: unpin first, then back to Select.
      if (useFocusStore.getState().focus) {
        skipFocusEffect.current = true;
        useFocusStore.getState().setFocus(false);
        await engine.setRevealPinned(false);
      }
      applyMode('select', false);
      void showAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignoreTimeliner]);

  // Focus (Scenarios toolbar): isolate the selection with no ghost and pin it; off = the regular ghost, unpinned.
  const firstFocusRun = useRef(true);
  useEffect(() => {
    if (firstFocusRun.current) { firstFocusRun.current = false; return; }
    if (skipFocusEffect.current) { skipFocusEffect.current = false; return; }
    void (async () => {
      if (focus) {
        setBaseMode('isolate');
        setGhost(false);
        await engine.setInteractionMode('isolate');
        await engine.setRevealPinned(true);
      } else {
        await engine.setRevealPinned(false);
        setGhost(true);
        await engine.setInteractionMode('reveal');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Selection actions.
  const selection = () => engine.highlighter.selection.select;
  // Select similar: the objects that match the first selected one on every one of `keys` (a class, a property).
  const firstSelected = () => {
    for (const [modelId, ids] of Object.entries(byModel)) {
      const el = ids.length ? engine.getIndexes().get(modelId)?.elements.get(ids[0]) : undefined;
      if (el) return el;
    }
    return undefined;
  };
  const selectSimilar = (keys: string[]) => {
    const first = firstSelected();
    if (!first) return;
    const want = keys.map((k) => elementValue(first, k));
    const out: Record<string, number[]> = {};
    for (const [modelId, index] of engine.getIndexes()) {
      for (const [id, e] of index.elements) if (keys.every((k, i) => elementValue(e, k) === want[i])) (out[modelId] ??= []).push(id);
    }
    void engine.selectElements(out, false);
  };
  const similarItems = (): MenuItem[] => {
    const first = firstSelected();
    const cls = 'Attributes.Class';
    const items: MenuItem[] = [
      { key: 'class', label: 'Same class', onClick: () => selectSimilar([cls]) },
      { key: 'name', label: 'Same name', onClick: () => selectSimilar(['Attributes.Name']) },
    ];
    if (!first) return items;
    const named = Object.keys(first.props).filter((k) => /^(Pour Type|Concrete Stage|Level|General Level \d|Building|Building Zone|Logic Group \d)$/i.test(k.slice(k.indexOf('.') + 1)) && String(first.props[k] ?? '').trim());
    if (named.length) items.push({ key: 'sep', label: '', separator: true });
    for (const k of named) {
      const label = k.slice(k.indexOf('.') + 1);
      items.push({ key: `p:${k}`, label: `Same ${label} (${String(first.props[k])})`, onClick: () => selectSimilar([k]) });
      items.push({ key: `cp:${k}`, label: `Same class and ${label}`, onClick: () => selectSimilar([cls, k]) });
    }
    return items;
  };
  const hide = async () => {
    await engine.hider.set(false, selection());
    engine.onExternalVisibilityChange.trigger();
    await engine.highlighter.clear('select');
  };
  const isolate = async () => {
    await engine.hider.isolate(selection());
    engine.onExternalVisibilityChange.trigger();
  };
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set());
  const showAll = async () => {
    await engine.hider.set(true);
    engine.onExternalVisibilityChange.trigger();
    setHiddenClasses(new Set());
  };

  // IFC element types in the loaded models, with how many objects each.
  const classes = useMemo(() => {
    const m = new Map<string, Record<string, number[]>>();
    for (const [modelId, index] of engine.getIndexes()) {
      for (const [id, e] of index.elements) {
        const byM = m.get(e.category) ?? m.set(e.category, {}).get(e.category)!;
        (byM[modelId] ??= []).push(id);
      }
    }
    return [...m].map(([category, ids]) => ({ category, label: prettyClass(category), ids, count: Object.values(ids).reduce((n, l) => n + l.length, 0) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick]);
  const toggleClass = async (category: string, ids: Record<string, number[]>) => {
    const hidden = hiddenClasses.has(category);
    const map: OBC.ModelIdMap = Object.fromEntries(Object.entries(ids).map(([k, l]) => [k, new Set(l)]));
    await engine.hider.set(hidden, map);
    engine.onExternalVisibilityChange.trigger();
    setHiddenClasses((prev) => {
      const next = new Set(prev);
      if (hidden) next.delete(category); else next.add(category);
      return next;
    });
  };

  const ortho = main.projection === 'Orthographic';
  const split = useViewSettingsStore((s) => s.pages[page].split);
  const linked = useViewSettingsStore((s) => s.pages[page].linked || (s.pages[page].compare ?? 'side') === 'slider');
  /** Fit / standard views: the main view, and the split's right view too
      (linked, it follows the main camera; unlinked, it is framed the same way). */
  const fitViews = async (map?: OBC.ModelIdMap, dir?: THREE.Vector3) => {
    const second = engine.secondary;
    if (second && linked) second.followMain();
    await engine.fit(map, true, dir?.clone());
    if (second && !linked) await second.fitTo(map, dir?.clone());
  };

  /** The fit keys: the view that is active (the one last clicked) is framed; when the views are linked the other follows it. */
  const fitActive = async (map?: OBC.ModelIdMap) => {
    const second = engine.secondary;
    if (!second || linked) return fitViews(map);
    if (engine.getActiveView() === 'second') return second.fitTo(map);
    await engine.fit(map);
  };

  // Blender's numpad views, on the numpad or the digit row: 1 front, 3 right, 7 top (Ctrl: back, left, bottom), 9 the
  // opposite view, 5 perspective / orthographic, 4 6 8 2 turn the view by 15° (Ctrl: slide it), + / - zoom,
  // numpad . fit the selection, Home or . (main keyboard) fit everything (zoom extents).
  const keysRef = useRef({ fitViews, fitActive, patchView, page, ortho, hasSelection, selection, linked, walking });
  keysRef.current = { fitViews, fitActive, patchView, page, ortho, hasSelection, selection, linked, walking };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.defaultPrevented || e.altKey || e.metaKey || e.shiftKey || k.walking || !engine.isInitialized || !engine.isOnScreen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const numpad = e.code.startsWith('Numpad');
      // Ctrl on the digit row belongs to the browser (tabs): only the numpad has the Ctrl views.
      if (e.ctrlKey && !numpad) return;
      const digit = /^(?:Numpad|Digit)(\d)$/.exec(e.code)?.[1];
      const follow = () => { if (engine.secondary && k.linked) engine.secondary.followMain(); };
      const turn = (az: number, pol: number) => { void engine.orbitBy(az, pol).then(follow); };
      const slide = (right: number, up: number) => { void engine.panBy(right, up).then(follow); };
      const standard = (id: string) => { const v = VIEWS.find((x) => x.id === id); if (v) void k.fitViews(undefined, v.dir); };
      let handled = true;
      switch (digit ?? e.code) {
        case '1': standard(e.ctrlKey ? 'back' : 'front'); break;
        case '3': standard(e.ctrlKey ? 'left' : 'right'); break;
        case '7': standard(e.ctrlKey ? 'bottom' : 'top'); break;
        case '9': void engine.flipView().then(follow); break;
        case '5': {
          const projection = k.ortho ? 'Perspective' : 'Orthographic';
          k.patchView(k.page, 'main', { projection });
          k.patchView(k.page, 'second', { projection });
          break;
        }
        case '4': e.ctrlKey ? slide(-1, 0) : turn(-15, 0); break;
        case '6': e.ctrlKey ? slide(1, 0) : turn(15, 0); break;
        case '8': e.ctrlKey ? slide(0, 1) : turn(0, 15); break;
        case '2': e.ctrlKey ? slide(0, -1) : turn(0, -15); break;
        case 'NumpadAdd': void engine.zoomBy(1.25).then(follow); break;
        case 'NumpadSubtract': void engine.zoomBy(0.8).then(follow); break;
        case 'NumpadDecimal': void k.fitActive(k.hasSelection ? k.selection() : undefined); break;
        case 'Home':
        case 'Period': void k.fitActive(undefined); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const hasSections = engine.isInitialized && engine.hasSections();

  return (
    <div className="vtb" role="toolbar" aria-label="3D viewer tools">
      {/* Two groups: when the viewer is narrow the second one drops to its own row as a whole. */}
      <div className="vtb-group">
      <Btn icon={IconCursor} tip="Select objects (Ctrl+click adds)" active={tool === 'select'} onClick={() => setTool('select')} />
      <Btn
        icon={IconBoxSelect}
        tip="Box select: drag left to right for objects fully inside, right to left for objects touched. Ctrl / Shift adds."
        active={tool === 'box'}
        onClick={() => setTool(tool === 'box' ? 'select' : 'box')}
      />
      <Split
        icon={measure.icon}
        tip={`${measure.label}: ${measure.tip}`}
        menuTip="Measure"
        active={measuring}
        onClick={() => (measuring ? setTool('select') : pickMeasure(measure))}
        items={[
          ...MEASURES.map((m): MenuItem => ({ key: m.id, label: m.label, icon: m.icon, current: measuring && m.id === measure.id, onClick: () => pickMeasure(m) })),
          { key: 'sep', label: '', separator: true },
          { key: 'clear', label: 'Delete all measurements', icon: IconDeleteAll, disabled: !(engine.isInitialized && engine.hasMeasurements()), onClick: () => engine.clearMeasurements() },
        ]}
      />
      <Split
        icon={IconSection}
        tip="Sections: add horizontal, vertical or cross cuts, cut at a level, and save sets. Double-click the model to cut it there; Delete removes the plane under the cursor."
        menuTip="Section planes"
        active={tool === 'section'}
        onClick={() => {
          const on = tool !== 'section';
          setTool(on ? 'section' : 'select');
          useSectionsStore.getState().setOpen(on);
        }}
        items={[
          { key: 'cut', label: 'Planes cut the model', checked: engine.isInitialized && engine.sectionsActive, keepOpen: true, disabled: !hasSections, onClick: () => engine.setSectionsActive(!engine.sectionsActive) },
          { key: 'handles', label: 'Show the planes', checked: engine.isInitialized && engine.sectionHandlesVisible, keepOpen: true, onClick: () => engine.setSectionHandlesVisible(!engine.sectionHandlesVisible) },
          { key: 'sep', label: '', separator: true },
          { key: 'clear', label: 'Delete all section planes', icon: IconDeleteAll, disabled: !hasSections, onClick: () => engine.clearSections() },
        ]}
      />
      <Sep />
      <Btn icon={IconSelectOff} tip="Clear the selection" disabled={!hasSelection} onClick={() => void engine.highlighter.clear('select')} />
      <Split
        icon={IconSelectionSet}
        tip="Select similar: every object with the same class as the selection"
        menuTip="Select similar by…"
        disabled={!hasSelection}
        onClick={() => selectSimilar(['Attributes.Class'])}
        items={similarItems()}
      />
      <Btn icon={IconVisibilityOff} tip="Hide the selected objects" disabled={!hasSelection} onClick={() => void hide()} />
      <Btn icon={IconFilter} tip="Isolate the selected objects (hide the rest)" disabled={!hasSelection} onClick={() => void isolate()} />
      <Btn icon={IconViewShowAll} tip="Show all objects" onClick={() => void showAll()} />
      <Split
        icon={BucketIcon}
        tip="Paint the selected objects with the current colour"
        menuTip="Paint colour"
        disabled={!hasSelection}
        onClick={() => paint(paintColor)}
        items={[
          ...PAINT_COLORS.map((c): MenuItem => ({ key: c.hex, label: c.label, icon: SWATCH_ICONS.get(c.hex), current: c.hex === paintColor, disabled: !hasSelection, onClick: () => paint(c.hex) })),
          { key: 'custom', label: 'Other colour…', icon: IconPalette, disabled: !hasSelection, onClick: () => paintInput.current?.click() },
          { key: 'sep', label: '', separator: true },
          { key: 'clear-sel', label: 'Clear the colour of the selection', icon: IconDeleteAll, disabled: !hasSelection, onClick: () => void engine.paintSelection(null) },
          { key: 'clear-all', label: 'Clear all colour overrides', icon: IconDeleteAll, onClick: () => void engine.clearColorOverrides() },
        ]}
      />
      <input ref={paintInput} type="color" value={paintColor} aria-hidden tabIndex={-1} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} onChange={(e) => paint(e.target.value)} />
      <Sep />
      </div>
      <div className="vtb-group">
      {/* Side by side, each view has these in its own header (components/ViewHeaders.tsx). */}
      {!(hasSecond && sideBySide) && (
      <>
      {hasSecond && <span className="vtb-view" title="Select / Isolate / Ghost / Pin work on the view you last clicked in" style={{ fontSize: 11, fontWeight: 600, padding: '0 6px', color: 'var(--accent)' }}>{activeView === 'main' ? 'Left' : 'Right'}</span>}
      <div className="vtb-seg" role="radiogroup" aria-label="What selecting does">
        <button type="button" role="radio" aria-checked={baseMode === 'select'} className={baseMode === 'select' ? 'is-on' : ''} onClick={() => applyMode('select', baseMode === 'select' ? ghost : false)} title="Selecting only highlights">Select</button>
        <button type="button" role="radio" aria-checked={baseMode === 'isolate'} className={baseMode === 'isolate' ? 'is-on' : ''} onClick={() => applyMode('isolate', baseMode === 'isolate' ? ghost : true)} title="Only the selection stays visible">Isolate</button>
      </div>
      <Btn icon={IconGhost} tip="Ghost (with Isolate): fade everything outside the selection instead of hiding it" active={ghost} disabled={baseMode === 'select'} onClick={() => applyMode(baseMode, !ghost)} />
      <Btn
        icon={IconPin}
        tip="Pin: keep the isolated / un-ghosted objects while the selection changes"
        active={pinned}
        disabled={!ghost && baseMode === 'select'}
        onClick={() => void engine.setRevealPinned(!pinned)}
      />
      <Sep />
      </>
      )}
      <Btn
        icon={ortho ? IconPerspective : IconModelOrtho}
        tip={ortho ? 'Orthogonal view (click for perspective)' : 'Perspective view (click for orthogonal)'}
        onClick={() => {
          const projection = ortho ? 'Perspective' : 'Orthographic';
          patchView(page, 'main', { projection });
          patchView(page, 'second', { projection });
        }}
      />
      <Btn icon={IconTransparency} tip="X-ray: see through the model (the selection stays solid)" active={xray} onClick={() => engine.setXray(!xray)} />
      <Split
        icon={IconViewAxon}
        tip="Axon view"
        menuTip="Standard views"
        onClick={() => void fitViews(undefined, VIEWS[0].dir)}
        items={VIEWS.map((v) => ({ key: v.id, label: v.label, icon: v.icon, onClick: () => void fitViews(undefined, v.dir) }))}
      />
      <Btn icon={IconZoomToSelected} tip={hasSelection ? 'Fit the selection' : 'Fit all models'} onClick={() => void fitViews(hasSelection ? selection() : undefined)} />
      <Split
        icon={IconWalk}
        tip={walking ? 'Leave the walkthrough (Esc)' : 'Walkthrough: move with W A S D, up with E / Space / Page Up, down with Q / C / Page Down, turn with ← →, Shift for faster'}
        menuTip="Walkthrough speed"
        active={walking}
        onClick={() => {
          const w = engine.walkthrough;
          if (!w) return;
          // Walking needs the perspective camera.
          if (!w.isActive && ortho) {
            patchView(page, 'main', { projection: 'Perspective' });
            patchView(page, 'second', { projection: 'Perspective' });
          }
          w.toggle();
        }}
        items={WALK_SPEEDS.map((s): MenuItem => ({
          key: s.id,
          label: s.label,
          checked: walkSpeed === s.speed,
          onClick: () => {
            setWalkSpeed(s.speed);
            if (engine.walkthrough) engine.walkthrough.speed = s.speed;
            try {
              localStorage.setItem('viewer.walkSpeed', String(s.speed));
            } catch {
              // not remembered
            }
          },
        }))}
      />
      <Split
        icon={IconVisibility}
        tip="What is shown"
        menuTip="What is shown"
        onClick={null}
        items={[
          // Both views of a split (the grid has no switch of its own in View settings).
          { key: 'grid', label: 'Grid', icon: IconGrid, checked: main.grid, keepOpen: true, onClick: () => { patchView(page, 'main', { grid: !main.grid }); patchView(page, 'second', { grid: !main.grid }); } },
          { key: 'ifcgrids', label: 'IFC grids', icon: IconIfcGrid, checked: showIfcGrids, keepOpen: true, onClick: () => patchPage(page, { showIfcGrids: !showIfcGrids }) },
          { key: 'cube', label: 'View cube', icon: IconViewCube, checked: showCube, keepOpen: true, onClick: () => patchPage(page, { showCube: !showCube }) },
          { key: 'north', label: 'North arrow', icon: IconNavigationArrow, checked: showNorth, keepOpen: true, onClick: () => patchPage(page, { showNorth: !showNorth }) },
          { key: 'markers', label: 'Markers', icon: IconLocationPoint, checked: markersShown, keepOpen: true, onClick: () => setMarkersShown(!markersShown) },
          ...(page === 'sequence'
            ? [
                { key: 'tags', label: 'Tags', icon: IconTagOutline, checked: tagsShown, keepOpen: true, onClick: () => setTagsShown(!tagsShown) },
                { key: 'date', label: 'Date label', icon: IconShortText, checked: dateLabel, keepOpen: true, onClick: () => setDateLabel(!dateLabel) },
              ]
            : [
                {
                  key: 'hovertag',
                  label: 'Tag on hover',
                  icon: IconTagOutline,
                  items: tagList.length
                    ? [
                        { key: 'off', label: 'Off', checked: !hoverTagId, onClick: () => setHoverTagId(null) },
                        ...tagList.map((t) => ({ key: t.id, label: t.name, checked: hoverTagId === t.id, onClick: () => setHoverTagId(t.id) })),
                      ]
                    : [{ key: 'none', label: 'No tags yet (4D Sequencing › Label)', disabled: true }],
                },
              ]),
          {
            key: 'types',
            label: 'IFC element types',
            icon: IconCategory,
            items: classes.length
              ? classes.map((c) => ({ key: c.category, label: `${c.label} (${c.count.toLocaleString()})`, checked: !hiddenClasses.has(c.category), keepOpen: true, onClick: () => void toggleClass(c.category, c.ids) }))
              : [{ key: 'none', label: 'No models loaded', disabled: true }],
          },
        ]}
      />
      <Sep />
      <Btn
        icon={split ? IconSinglePane : IconTwoPane}
        tip={split ? 'Back to a single view' : 'Split into two views'}
        active={split}
        onClick={() => patchPage(page, { split: !split })}
      />
      {document.fullscreenEnabled && (
        <>
          <Sep />
          {/* Its own click: the full-screen-on-first-click setting must not act on it too. */}
          <FullscreenButton />
        </>
      )}
      </div>
    </div>
  );
}
