import { syncViewpoints } from './savedViews';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useExperimental } from '../state/appPrefsStore';
import { useMarkersStore } from '../state/markersStore';
import { useConstructionPlanesStore } from '../state/constructionPlanesStore';
import { useSectionCutsStore } from '../state/sectionCutsStore';
import { NO_CUTS } from './sectionPlanes';
import { markerShownAt } from './markerActivity';
import { CLOSED_STATUSES, STATUS_COLORS, useTopicsStore, type Topic } from '../state/topicsStore';
import { topicActiveAt, topicWindow } from '../topics/topicDates';
import { sanitizeNote } from '../utils/richText';
import type { Marker } from '../state/markersStore';
import { useSequenceSchedule, useVisibleSchedules } from '../state/scheduleStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { sharedActivityObjects } from '../schedule/activityObjects';
import { useSequenceTimelineStore } from '../state/sequenceTimelineStore';
import { DEFAULT_CAPTION, isTwoViewLayout, pageOfLayout, useViewSettingsStore } from '../state/viewSettingsStore';
import { useViewerEngine } from './ViewerEngineContext';
import { createViewerShell, type ViewerLayout, type ViewerShell } from './viewerUI';
import { useModelsStore } from '../state/modelsStore';
import { useSelectionStore } from '../state/selectionStore';
import { useModelPlacementStore, ZERO_OFFSET } from '../state/modelPlacementStore';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { useFlythroughStore } from '../state/flythroughStore';
import { tagCss, useTagsStore } from '../state/tagsStore';
import { renderTag } from '../schedule/tagTemplate';

/** Hosts the That Open UI shell (bim-grid > bim-viewport / bim-toolbar /
    bim-panel). The shell and engine are created once and live for the whole
    app session — React only mounts the grid element and switches its layout. */
export function ViewerCanvas({ layout }: { layout: ViewerLayout }) {
  const engine = useViewerEngine();
  const hostRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<ViewerShell | null>(null);
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shellRef.current) {
      const shell = createViewerShell();
      shellRef.current = shell;
      host.append(shell.grid);
      engine.init(shell.viewport).then(() => {
        engine.onSelectionChange = (map) => {
          // Mirror the Highlighter's selection into the 4D page's store.
          const [modelId, ids] = Object.entries(map)[0] ?? [];
          if (modelId && ids) useModelsStore.getState().select(modelId, null);
          const byModel = Object.fromEntries(Object.entries(map).map(([id, set]) => [id, [...set]]));
          useSelectionStore.getState().setSelection(ids ? [...ids] : [], byModel);
        };
        engine.onModelRegistered = (info) => useModelsStore.getState().addModel(info);
        engine.onModelDisposed = (modelId) => useModelsStore.getState().removeModel(modelId);
        shell.attach(engine);
        useSequenceUiStore.setState({ modelPanels: shell.modelPanels });
        // A lost WebGL context (the GPU ran out of memory or was reset) leaves the
        // canvas blank without any error — say so instead of showing nothing.
        const canvas = engine.world.renderer?.three.domElement;
        canvas?.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setContextLost(true); });
        canvas?.addEventListener('webglcontextrestored', () => { setContextLost(false); void engine.forceUpdate(); });
        setReady(true);
      }).catch((e) => console.error('Viewer failed to start', e));
    } else if (!host.contains(shellRef.current.grid)) {
      host.append(shellRef.current.grid);
    }
  }, [engine]);

  useEffect(() => {
    shellRef.current?.setLayout(layout);
  }, [layout, ready]);

  // The second 3D view exists only while a page is split (it holds its
  // own copy of every model, so it is released as soon as it is not shown).
  // Each page (Models / 4D Sequencing) has its own view setup.
  const page = pageOfLayout(layout);
  useEffect(() => {
    useViewSettingsStore.setState({ activePage: page });
  }, [page]);
  // The compare slider only makes sense with both views on the same camera.
  const slider = layout.endsWith('Slider');
  const linked = useViewSettingsStore((s) => s.pages[page].linked) || slider;
  useEffect(() => {
    const shell = shellRef.current;
    if (!ready || !shell) return;
    if (!isTwoViewLayout(layout)) {
      void engine.closeSecondary();
      return;
    }
    let cancelled = false;
    // Wait a frame so the grid has laid the second viewport out at its size.
    requestAnimationFrame(() => {
      if (cancelled) return;
      engine.openSecondary(shell.viewport2).then((view) => {
        const pv = useViewSettingsStore.getState().pages[page];
        view.setCubeVisible(pv.showCube);
        view.setLinked(pv.linked || layout.endsWith('Slider'));
        view.apply(pv.second);
        view.onContextLost = () => useViewSettingsStore.getState().patchPage(page, { split: false });
      }).catch((e) => console.error('Second view failed to start', e));
    });
    return () => { cancelled = true; };
  }, [layout, ready, engine]);
  const savedMain = useViewSettingsStore((s) => s.pages[page].main);
  const secondSettings = useViewSettingsStore((s) => s.pages[page].second);
  // Experimental features that are switched off have no effect, whatever a view saved.
  const cutsExperiment = useExperimental('sectionCuts');
  const materialsExperiment = useExperimental('realisticMaterials');
  const mainSettings = useMemo(
    () => ({ ...savedMain, sectionStyle: cutsExperiment ? savedMain.sectionStyle : undefined, materials: materialsExperiment ? savedMain.materials : false }),
    [savedMain, cutsExperiment, materialsExperiment],
  );
  useEffect(() => {
    if (ready) void engine.applyViewSettings(mainSettings);
  }, [engine, ready, mainSettings]);
  // The second view takes its own settings whenever it appears or they change.
  useEffect(() => {
    engine.secondary?.apply(secondSettings);
  }, [engine, secondSettings, layout, ready]);
  // Per-model translate: each model sits at its saved offset (by name).
  const models = useModelsStore((s) => s.models);
  // Models turned off on Inputs: left out of both views as whole objects, so
  // nothing element-level (Show all, Hide / Isolate, the 4D sequence) can
  // bring them back.
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const offsets = useModelPlacementStore((s) => s.offsets);
  const appliedOffsets = useRef(new Map<string, string>());
  useEffect(() => {
    if (!ready) return;
    for (const m of models) {
      const o = offsets[m.name] ?? ZERO_OFFSET;
      const sig = `${o.x}|${o.y}|${o.z}|${o.rot ? `${o.rot.deg},${o.rot.px},${o.rot.py},${o.rot.pz}` : ''}`;
      const prev = appliedOffsets.current.get(m.modelId);
      if (prev === sig || (prev === undefined && sig === '0|0|0|')) continue;
      appliedOffsets.current.set(m.modelId, sig);
      void engine.setModelOffset(m.modelId, o);
    }
  }, [engine, ready, models, offsets]);

  // Realistic look (main view): fixed sun & shadows, and concrete — each on its own switch.
  const realistic = !!mainSettings.realistic;
  const concrete = mainSettings.concrete ?? realistic;
  const realism = useViewSettingsStore((s) => s.realism);
  useEffect(() => {
    if (ready) engine.setRealism(realistic ? realism : null);
  }, [engine, ready, realistic, realism]);
  useEffect(() => {
    if (ready) engine.setConcrete(concrete ? realism : null);
  }, [engine, ready, concrete, realism]);

  // Real-time sky (needs the sun) and the material classes, per view.
  const skyOn = realistic && !!mainSettings.sky;
  const materialsOn = !!mainSettings.materials;
  useEffect(() => {
    if (ready) engine.setSky(skyOn, realism);
  }, [engine, ready, skyOn, realism]);
  useEffect(() => {
    if (ready) engine.setMaterials(materialsOn);
  }, [engine, ready, materialsOn]);
  useEffect(() => {
    if (ready) engine.setClassChoices(realism.mapping ?? {});
  }, [engine, ready, realism.mapping]);

  // Bumped when the split's right view is created, so it gets its settings.
  const [secondaryTick, setSecondaryTick] = useState(0);
  useEffect(() => {
    const onChange = () => setSecondaryTick((t) => t + 1);
    engine.onSecondaryChange.add(onChange);
    return () => { engine.onSecondaryChange.remove(onChange); };
  }, [engine]);

  // The split's right view: its own sun & shadows and concrete switches
  // (same sun position and strengths as the main view's).
  const secondRealistic = !!secondSettings.realistic;
  const secondConcrete = secondSettings.concrete ?? secondRealistic;
  useEffect(() => {
    if (ready) engine.secondary?.setRealism(secondRealistic ? realism : null);
  }, [engine, ready, secondRealistic, realism, secondaryTick]);
  useEffect(() => {
    if (ready) engine.secondary?.setConcrete(secondConcrete ? realism : null);
  }, [engine, ready, secondConcrete, realism, secondaryTick]);

  const secondSky = secondRealistic && !!secondSettings.sky;
  const secondMaterials = materialsExperiment && !!secondSettings.materials;
  useEffect(() => {
    if (ready) engine.secondary?.setSky(secondSky, realism);
  }, [engine, ready, secondSky, realism, secondaryTick]);
  useEffect(() => {
    if (!ready) return;
    engine.secondary?.setMaterials(secondMaterials);
    if (secondMaterials) void engine.ensureMaterialEntries();
  }, [engine, ready, secondMaterials, secondaryTick]);

  // Storey slide per model — a setting of each view (3D tab), so the
  // left and right views, and the Models / 4D pages, can each differ.
  const mainSlides = mainSettings.storeySlides;
  const secondSlides = secondSettings.storeySlides;
  useEffect(() => {
    if (!ready) return;
    for (const m of models) {
      const step = mainSlides[m.name] ?? 0;
      if (engine.getStoreySlide(m.modelId).step !== step) void engine.setStoreySlide(m.modelId, step);
    }
  }, [engine, ready, models, mainSlides]);
  useEffect(() => {
    const view = engine.secondary;
    if (!ready || !view) return;
    for (const m of models) void view.setStoreySlide(m.modelId, secondSlides[m.name] ?? 0);
  }, [engine, ready, models, secondSlides, layout, secondaryTick]);

  // Models loaded or removed while split: the right view copies / drops them too.
  useEffect(() => {
    if (ready) void engine.secondary?.syncModels();
  }, [engine, ready, models, secondaryTick]);

  // Models each view leaves out (by name, like the storey slides) — a
  // split's choice ("Models in this view"): one view shows every model, or
  // a model left out there would stay hidden with no picker to bring it back.
  const twoViews = isTwoViewLayout(layout);
  const mainHidden = twoViews ? mainSettings.hiddenModels : undefined;
  const secondHidden = secondSettings.hiddenModels;
  useEffect(() => {
    if (!ready) return;
    const names = new Set(mainHidden ?? []);
    engine.setViewHiddenModels(models.filter((m) => names.has(m.name) || hiddenModelIds.has(m.modelId)).map((m) => m.modelId));
  }, [engine, ready, models, mainHidden, hiddenModelIds]);
  useEffect(() => {
    const view = engine.secondary;
    if (!ready || !view) return;
    const names = new Set(secondHidden ?? []);
    view.setHiddenModels(models.filter((m) => names.has(m.name) || hiddenModelIds.has(m.modelId)).map((m) => m.modelId));
  }, [engine, ready, models, secondHidden, hiddenModelIds, layout, secondaryTick]);

  // Camera fly-through: keyframes and path display from the Fly-through tab.
  // Redrawn when models change too, since the path is sized to them.
  const flyKeys = useFlythroughStore((s) => s.keys);
  const showPath = useFlythroughStore((s) => s.showPath);
  useEffect(() => {
    if (ready) engine.flythrough?.setKeys(flyKeys);
  }, [engine, ready, flyKeys, models]);
  useEffect(() => {
    if (ready) engine.flythrough?.setPathVisible(showPath);
  }, [engine, ready, showPath]);

  const showCube = useViewSettingsStore((s) => s.pages[page].showCube);
  const showNorth = useViewSettingsStore((s) => s.pages[page].showNorth ?? true);
  const northRotation = useViewSettingsStore((s) => s.pages[page].northRotation ?? 0);
  const showIfcGrids = useViewSettingsStore((s) => s.pages[page].showIfcGrids ?? false);
  const markers = useMarkersStore((s) => s.markers);
  const markersVisible = useMarkersStore((s) => s.visible);
  // Markers are in the IFC's own coordinates, so they are redrawn when the models (and so the global offset) change.
  // In 4D Sequencing a marker linked to an activity shows from that activity's start to its finish.
  const seqSchedule = useSequenceSchedule();
  const seqDate = useSequenceTimelineStore((s) => s.date);
  const seqBasis = useSequenceTimelineStore((s) => s.basis);
  const shownKey = markers.map((m) => (!m.hidden && (page !== 'sequence' || markerShownAt(m, seqSchedule, seqDate, seqBasis)) ? '1' : '0')).join('');
  // Redrawn only when the shown set changes, not on every playback step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownMarkers = useMemo(() => markers.filter((_, i) => shownKey[i] === '1'), [markers, shownKey]);
  // Topics with a point are markers too: the icon follows the priority / type, the label shows the status and
  // description, and in 4D they show only while their dates are on. A click opens the topic.
  const topics = useTopicsStore((s) => s.topics);
  const showTopicMarkers = useTopicsStore((s) => s.showMarkers);
  const topicKey = topics.map((t) => (t.point && !CLOSED_STATUSES.includes(t.status) && (page !== 'sequence' || topicActiveAt(topicWindow(t, seqSchedule, seqBasis), seqDate)) ? '1' : '0')).join('');
  const topicMarkers = useMemo<Marker[]>(() => {
    if (!showTopicMarkers) return [];
    const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    return topics.filter((_, i) => topicKey[i] === '1').map((t: Topic) => ({
      id: `topic:${t.id}`,
      topicId: t.id,
      name: `#${t.index} ${t.title || 'Topic'}`,
      x: t.point!.x,
      y: t.point!.y,
      z: t.point!.z,
      icon: t.icon ?? (t.priority === 'Critical' || t.priority === 'High' ? 'warning' : t.type === 'Clash' ? 'flag' : 'pin'),
      color: STATUS_COLORS[t.status],
      note: sanitizeNote(`<b>${esc(t.status)}</b>${t.priority ? ` · ${esc(t.priority)}` : ''}${t.assignedTo ? ` · ${esc(t.assignedTo)}` : ''}${t.description ? `<br>${esc(t.description).replace(/\n/g, '<br>')}` : ''}`),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, topicKey, showTopicMarkers]);
  useEffect(() => {
    const open = (e: Event) => {
      useTopicsStore.getState().select((e as CustomEvent<string>).detail);
      useTopicsStore.setState((s) => ({ openRequest: s.openRequest + 1 }));
    };
    window.addEventListener('ip-open-topic', open);
    return () => window.removeEventListener('ip-open-topic', open);
  }, []);
  const allMarkers = useMemo(() => [...shownMarkers, ...topicMarkers], [shownMarkers, topicMarkers]);
  useEffect(() => {
    if (ready) engine.syncMarkers(allMarkers, markersVisible);
  }, [engine, ready, allMarkers, markersVisible, models]);
  // Construction planes are in the IFC's own coordinates too: redrawn when the models change.
  const planes = useConstructionPlanesStore((s) => s.planes);
  const planesVisible = useConstructionPlanesStore((s) => s.visible);
  useEffect(() => {
    if (ready) engine.syncConstructionPlanes(planes, planesVisible);
  }, [engine, ready, planes, planesVisible, models]);
  // Section cuts name gridlines and storeys, so they are drawn once the models (and their grids) are in.
  const sectionCuts = useSectionCutsStore((s) => s.cuts);
  const [gridsTick, setGridsTick] = useState(0);
  useEffect(() => {
    const bump = () => setGridsTick((t) => t + 1);
    engine.onIfcGridsChange.add(bump);
    return () => { engine.onIfcGridsChange.remove(bump); };
  }, [engine]);
  useEffect(() => {
    // Switched off in Settings › Experimental features: no cut is drawn, whatever was saved.
    if (ready) void engine.applySectionCuts(cutsExperiment ? sectionCuts : NO_CUTS);
  }, [engine, ready, sectionCuts, cutsExperiment, models, gridsTick]);
  // Saved viewpoints belong to the models they were taken with: back when those are loaded, set aside when not.
  useEffect(() => {
    if (ready) syncViewpoints(engine);
  }, [engine, ready, models]);
  useEffect(() => {
    if (ready) engine.setIfcGridsVisible(showIfcGrids);
  }, [engine, ready, showIfcGrids, models]);
  useEffect(() => {
    const opts = { visible: showNorth, rotation: northRotation, belowCube: showCube };
    shellRef.current?.setNorthArrow(opts);
    engine.secondary?.setNorthArrow(opts);
  }, [showNorth, northRotation, showCube, layout, ready, engine, secondaryTick]);
  useEffect(() => {
    shellRef.current?.setViewCubeVisible(showCube);
    engine.secondary?.setCubeVisible(showCube);
  }, [showCube, layout, ready, engine]);
  useEffect(() => {
    engine.secondary?.setLinked(linked);
  }, [linked, layout, ready, engine]);

  return (
    <div className="viewer-canvas">
      <div ref={hostRef} className="viewer-canvas__container viewer-shell" />
      {ready && slider && shellRef.current && (
        <CompareSlider
          page={page}
          viewport2={shellRef.current.viewport2}
          leftLabel={shownNames(models, mainHidden)}
          rightLabel={shownNames(models, secondHidden)}
        />
      )}
      {ready && twoViews && !slider && models.length > 0 && (
        <ViewCaptions page={page} />
      )}
      {ready && page === 'model' && <HoverTag />}
      {!ready && <div className="viewer-canvas__loading">Starting viewer…</div>}
      {contextLost && (
        <div className="viewer-canvas__loading viewer-canvas__lost" role="alert">
          <strong>The 3D graphics were lost</strong>
          <span>The GPU ran out of memory or was reset. Close the split view or unload models to free memory; if the view stays blank, reload the page.</span>
        </div>
      )}
    </div>
  );
}

/** Models page, "Tag on hover" (toolbar eye menu): once the pointer rests
    on an object in the main view, the chosen tag next to it, its {Obj:…}
    tokens filled from that object (task tokens stay empty: no timeline here). */
function HoverTag() {
  const engine = useViewerEngine();
  const tag = useTagsStore((s) => s.tags.find((t) => t.id === s.hoverTagId));
  const models = useModelsStore((s) => s.models);
  const [label, setLabel] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    setLabel(null);
    const dom = engine.world.renderer?.three.domElement;
    if (!tag || !dom) return;
    let timer = 0;
    let seq = 0;
    const hide = () => {
      window.clearTimeout(timer);
      seq++;
      setLabel(null);
    };
    const onMove = (e: PointerEvent) => {
      hide();
      if (e.buttons) return; // orbiting / panning
      const { clientX: x, clientY: y } = e;
      const mine = seq;
      timer = window.setTimeout(async () => {
        const hit = await engine.elementAt(x, y);
        if (mine !== seq || !hit) return;
        const el = models.find((m) => m.modelId === hit.modelId)?.elements.find((e) => e.localId === hit.localId);
        const text = el ? renderTag(tag.template, { activeCount: 1, elements: [el], basis: 'planned' }).trim() : '';
        if (text) setLabel({ x, y, text });
      }, 250);
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', hide);
    dom.addEventListener('pointerdown', hide);
    dom.addEventListener('wheel', hide, { passive: true });
    return () => {
      hide();
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', hide);
      dom.removeEventListener('pointerdown', hide);
      dom.removeEventListener('wheel', hide);
    };
  }, [engine, tag, models]);

  return label ? <div className="hover-tag" style={{ ...tagCss(tag), left: label.x + 14, top: label.y + 14 }}>{label.text}</div> : null;
}

/** Side-by-side split: what each view says about itself — the models it shows and the programmes driving it
    (along its bottom), and a custom label placed and styled per view (View settings > Labels in this view). */
function ViewCaptions({ page }: { page: 'model' | 'sequence' }) {
  const models = useModelsStore((s) => s.models);
  const hiddenIds = useModelsStore((s) => s.hiddenModelIds);
  const schedules = useVisibleSchedules();
  const groups = useLinkGroupsStore((s) => s.groups);
  const main = useViewSettingsStore((s) => s.pages[page].main);
  const second = useViewSettingsStore((s) => s.pages[page].second);
  const wantsProgramme = !!main.caption?.programme || !!second.caption?.programme;

  // Which models each programme's activities are linked to (Link Groups): a programme is "used" by a view when it reaches one of its models.
  const reach = useMemo(() => {
    if (!wantsProgramme) return [];
    return schedules.map((m) => {
      const used = new Set<string>();
      for (const byModel of sharedActivityObjects(m, models, groups).objectsOf.values()) for (const [modelId, ids] of byModel) if (ids.size) used.add(modelId);
      return { name: m.project?.name || m.sourceFileName, used };
    });
  }, [wantsProgramme, schedules, models, groups]);

  const half = (view: 'main' | 'second') => {
    const settings = view === 'main' ? main : second;
    const c = { ...DEFAULT_CAPTION, ...(settings.caption ?? {}) };
    const out = new Set(settings.hiddenModels ?? []);
    const shown = models.filter((m) => !out.has(m.name) && !hiddenIds.has(m.modelId));
    const shownIds = new Set(shown.map((m) => m.modelId));
    // Programmes with no links at all still show: nothing says which view they belong to.
    const programmes = reach.filter((r) => r.used.size === 0 || [...r.used].some((id) => shownIds.has(id))).map((r) => r.name);
    const chips = [
      ...(c.programme ? programmes.map((n) => ({ key: `p:${n}`, text: n, title: `Programme: ${n}`, programme: true })) : []),
      ...(c.models ? shown.map((m) => ({ key: m.modelId, text: m.name.replace(/\.(ifc|frag)$/i, ''), title: m.name, programme: false })) : []),
    ];
    return (
      <div className={`view-captions view-captions--${view === 'main' ? 'left' : 'right'}`}>
        {c.custom && c.text.trim() && (
          <div
            className={`view-captions__custom view-captions__custom--${c.position}`}
            style={{ fontSize: c.size, color: c.color, background: c.background ?? 'transparent', fontWeight: c.bold ? 700 : 400 }}
          >
            {c.text}
          </div>
        )}
        {chips.length > 0 && (
          <div className="view-models">
            {chips.map((chip) => (
              <span key={chip.key} className={`view-models__chip${chip.programme ? ' view-models__chip--programme' : ''}`} title={chip.title}>{chip.text}</span>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      {half('main')}
      {half('second')}
    </>
  );
}

const shownNames = (models: { name: string }[], hidden: string[] | undefined) => {
  const out = new Set(hidden ?? []);
  return models.filter((m) => !out.has(m.name)).map((m) => m.name).join(', ');
};

/** The compare slider's divider: the right view is stacked over the main
    (left) one and clipped left of the divider, so dragging it wipes between
    the two. Clip and handle move together on every pointer move; the store
    (persisted) only takes the position on release. */
function CompareSlider({ page, viewport2, leftLabel, rightLabel }: { page: 'model' | 'sequence'; viewport2: HTMLElement; leftLabel: string; rightLabel: string }) {
  const engine = useViewerEngine();
  const saved = useViewSettingsStore((s) => s.pages[page].sliderPos ?? 0.5);
  const patchPage = useViewSettingsStore((s) => s.patchPage);
  const [pos, setPos] = useState(saved);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setPos(saved), [saved]);

  useEffect(() => {
    viewport2.style.clipPath = `inset(0 0 0 ${pos * 100}%)`;
    engine.compareSlider = pos;
  }, [viewport2, engine, pos]);
  useEffect(() => () => {
    viewport2.style.clipPath = '';
    engine.compareSlider = null;
  }, [viewport2, engine]);

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const fromEvent = (e: React.PointerEvent) => {
    const area = rootRef.current?.parentElement?.getBoundingClientRect();
    return area && area.width ? clamp((e.clientX - area.left) / area.width) : pos;
  };
  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setPos(fromEvent(e));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    patchPage(page, { sliderPos: fromEvent(e) });
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const next = e.key === 'ArrowLeft' ? pos - step : e.key === 'ArrowRight' ? pos + step : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null;
    if (next === null) return;
    e.preventDefault();
    patchPage(page, { sliderPos: clamp(next) });
  };
  const drag = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp, onDoubleClick: () => patchPage(page, { sliderPos: 0.5 }) };

  // Each side's models, in that side's bottom corner (the cube has the top right).
  return (
    <>
      {leftLabel && pos > 0.08 && (
        <div className="compare-slider__label compare-slider__label--left" style={{ maxWidth: `calc(${pos * 100}% - 32px)` }} title={leftLabel}>{leftLabel}</div>
      )}
      {rightLabel && pos < 0.92 && (
        <div className="compare-slider__label compare-slider__label--right" style={{ maxWidth: `calc(${(1 - pos) * 100}% - 32px)` }} title={rightLabel}>{rightLabel}</div>
      )}
    <div ref={rootRef} className="compare-slider" style={{ left: `${pos * 100}%` }}>
      <div className="compare-slider__line" />
      <div className="compare-slider__grab" {...drag} />
      <div
        className="compare-slider__knob"
        role="slider"
        tabIndex={0}
        aria-label="Compare slider: left view / right view"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        title="Drag to compare the left and right views. Double-click to centre."
        onKeyDown={onKey}
        {...drag}
      >
        &lsaquo;&rsaquo;
      </div>
    </div>
    </>
  );
}
