import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';
import { extractLayers } from './ifcLayers';
import { SecondaryView } from './SecondaryView';
import { ContextMeshes } from './contextMeshes';
import { renderTargets, slideStoreys, type BaseHeights } from './storeySlide';
import { GrowthAnimator } from './growthAnimator';
import { Flythrough } from './flythrough';
import { Walkthrough } from './walkthrough';
import { ElementRelations } from './relations';
import { attachBoxSelect } from './boxSelect';
import { PointMarks, copyText, formatCoords, projectCoords } from './pointMarks';
import { configureSun, markBaseMaterials, patchAllConcrete, refreshMaterialClasses, setConcreteStrength, setMaterialsEnabled, setSkyUniforms, skyParamsFor, type RealismSettings } from './realism';
import { SkyBackdrop } from './skyBackdrop';
import { extractGrids, extractStoreys, type IfcGridData, type IfcStoreyData } from './ifcGrids';
import { gridDimensions, spacingText } from './gridDimensions';
import { gridCutPlane, levelCutPlane, planeToScene, type SectionCuts } from './sectionPlanes';
import { useSectionCutsStore } from '../state/sectionCutsStore';
import { MarkerLayer } from './markerLayer';
import { ConstructionPlaneLayer } from './constructionPlaneLayer';
import type { ConstructionPlane } from '../state/constructionPlanesStore';
import type { Marker } from '../state/markersStore';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { DEFAULT_OUTLINE, DEFAULT_SECTION_STYLE, SECTION_CATEGORY_DEFS, type OutlineSettings, type SectionStyle } from './visualAids';
import { DEFAULT_QUALITY, applyRenderQuality, type AdaptiveResolution, type RenderQuality } from './renderQuality';
import { buildMaterialEntries, collectMaterialNames, setClassOverrides, setMaterialEntries, type ClassChoice, type ElementMaterialInfo, type MaterialEntry } from './materialClasses';
import { applyXray } from './xray';
import { hideFadedFromEdges } from './ghostEdges';
import type { ViewSettings } from '../state/viewSettingsStore';
import type { ElementSummary, LoadedModelInfo, ModelTreeNode } from './types';

type World = OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>;

// Below this, a tile's face material is faded near-invisible enough (e.g. a
// "not yet built" 4D ghost stage) that it should read as a faint preview,
// not a fully-drawn volume — see syncGhostEdgeExclusion()'s own comment.
const GHOST_OPACITY_EDGE_CUTOFF = 0.35;

export type MeasureKind = 'length' | 'area' | 'angle' | 'volume';
export type ViewerTool = 'select' | 'box' | MeasureKind | 'point' | 'section';
export type ViewerStyle = 'COLOR' | 'PEN' | 'PEN_SHADOWS' | 'COLOR_PEN' | 'COLOR_SHADOWS' | 'COLOR_PEN_SHADOWS';

export type InteractionMode = 'select' | 'isolate' | 'reveal';

/** Per-model lookup built once at load, so the tree and property tables can
    be rebuilt instantly without going back to the worker. */
export interface ModelIndex {
  name: string;
  tree: ModelTreeNode;
  /** Names of spatial nodes and elements, by local id. */
  names: Map<number, string>;
  elements: Map<number, ElementSummary>;
  /** Layer name -> element local ids (empty when the IFC carries none). */
  layers: Map<string, number[]>;
}

const EDGE_COLOR = '#2a2a2a';

export const STOREYS_CLASSIFICATION = 'Storeys';
export const CATEGORIES_CLASSIFICATION = 'Categories';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Thin, typed wrapper that owns the That Open components (world, fragments,
    highlighter, hider, finder, classifier, viewpoints, views, clipper,
    measurements). All viewer *chrome* is built from @thatopen/ui in
    viewerUI.ts — this class only wires the engine side, plus the
    programmatic visibility/colour/opacity hooks the 4D timeline drives. */
/** The camera saved with the scene, if any. */
function readSavedCamera() {
  try {
    const c = JSON.parse(localStorage.getItem('viewer.camera') ?? 'null');
    const ok = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
    return c && ok(c.position) && ok(c.target) ? { position: c.position as number[], target: c.target as number[], ortho: !!c.ortho, zoom: Number(c.zoom) } : null;
  } catch {
    return null;
  }
}

export class ViewerEngine {
  private _components: OBC.Components | null = null;
  private _world: World | null = null;
  private fragments: OBC.FragmentsManager | null = null;
  private ifcLoader: OBC.IfcLoader | null = null;
  private grid: OBC.SimpleGrid | null = null;
  private shadowCatcher: THREE.Mesh | null = null;
  private models = new Map<string, FRAGS.FragmentsModel>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private measurements = new Map<MeasureKind, OBCF.Measurement<any, any>>();
  private activeTool: ViewerTool = 'select';
  private loadingIfc = false;
  private loadingFrag = false;
  private indexes = new Map<string, ModelIndex>();
  private interactionMode: InteractionMode = 'select';
  private onDblClick: (() => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private container: HTMLElement | null = null;
  private workerUrl = '';
  private markReady: () => void = () => {};
  /** Resolves once init() has finished — imports made from the Inputs tab
      can race the (async) worker/wasm setup, so loadIfc waits on this. */
  readonly ready = new Promise<void>((resolve) => {
    this.markReady = resolve;
  });

  /** Fired by the Highlighter's select style — the app mirrors it into the
      4D page's selection store. */
  onSelectionChange: ((map: OBC.ModelIdMap) => void) | null = null;
  /** A model appeared via something other than loadIfc (e.g. the official
      loadFrag button) — the app adds it to its own models store. */
  onModelRegistered: ((info: LoadedModelInfo) => void) | null = null;
  onModelDisposed: ((modelId: string) => void) | null = null;
  /** Fired once a model's storey/category classification and finder queries exist. */
  readonly onSetsReady = new OBC.Event<string>();
  /** Visibility was changed by something other than the 4D timeline (Show
      all / Hide / Isolate) — the timeline re-applies everything next tick. */
  readonly onExternalVisibilityChange = new OBC.Event<void>();
  /** The mode (Select / Isolate / Reveal) changed, from the toolbar or from code: the toolbar's buttons follow it. */
  readonly onInteractionModeChange = new OBC.Event<InteractionMode>();
  /** Fired after every Hider change (Hide, Isolate, Show all, IFC element types). */
  readonly onVisibilityChange = new OBC.Event<void>();
  /** Reveal's focus set was pinned (true) or released (false). */
  readonly onRevealPinChange = new OBC.Event<boolean>();

  get isInitialized() {
    return this._components !== null;
  }

  get components(): OBC.Components {
    if (!this._components) throw new Error('ViewerEngine.init() must be called first');
    return this._components;
  }

  get world(): World {
    if (!this._world) throw new Error('ViewerEngine.init() must be called first');
    return this._world;
  }

  /** glTF / GLB site context (terrain, surroundings) beside the models. */
  readonly contexts = new ContextMeshes(
    () => this.world.scene.three,
    () => this.globalOffset(),
  );

  private _secondary: SecondaryView | null = null;
  private secondaryPending: Promise<SecondaryView> | null = null;

  /** The second 3D view, while the 4D page is split. */
  get secondary(): SecondaryView | null {
    return this._secondary;
  }

  /** Fired when the second view is created or disposed. */
  readonly onSecondaryChange = new OBC.Event<void>();

  async openSecondary(container: HTMLElement): Promise<SecondaryView> {
    if (this._secondary) return this._secondary;
    if (!this.secondaryPending) {
      this.secondaryPending = SecondaryView.create(this, container).then((view) => {
        this._secondary = view;
        this.secondaryPending = null;
        this.onSecondaryChange.trigger();
        return view;
      }).catch((e) => {
        this.secondaryPending = null;
        throw e;
      });
    }
    return this.secondaryPending;
  }

  async closeSecondary() {
    const pending = this.secondaryPending;
    if (pending) await pending.catch(() => undefined);
    const view = this._secondary;
    if (!view) return;
    this._secondary = null;
    await view.dispose();
    this.onSecondaryChange.trigger();
  }

  /** Everything a second view needs to render the same models on its own:
      the fragments worker, and each model's data + placement. */
  getSecondaryViewSource() {
    if (!this.fragments) throw new Error('ViewerEngine.init() must be called first');
    return {
      workerUrl: this.workerUrl,
      autoCoordinate: this.fragments.core.settings.autoCoordinate,
      modelIds: [...this.models.keys()],
      getModel: (modelId: string) => this.models.get(modelId),
    };
  }

  async init(container: HTMLElement) {
    if (this._components) return;
    const components = new OBC.Components();
    this._components = components;
    this.container = container;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBCF.PostproductionRenderer(components, container);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    this._world = world;

    components.init();
    world.scene.setup();
    if (world.scene.three) {
      world.scene.three.background = new THREE.Color('#f5f6f5');

      const hemi = new THREE.HemisphereLight('#ffffff', '#c7cdd3', 1.1);
      world.scene.three.add(hemi);
      this.hemi = hemi;

      const dir = new THREE.DirectionalLight('#ffffff', 2.2);
      dir.position.set(12, 20, 8);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.camera.near = 0.5;
      dir.shadow.camera.far = 80;
      dir.shadow.camera.left = -30;
      dir.shadow.camera.right = 30;
      dir.shadow.camera.top = 30;
      dir.shadow.camera.bottom = -30;
      dir.shadow.bias = -0.0005;
      dir.shadow.normalBias = 0.02;
      world.scene.three.add(dir);
      world.scene.three.add(dir.target);
      this.sun = dir;

      // A soft, low-intensity fill from the opposite side so shadowed faces
      // don't go fully black.
      const fill = new THREE.DirectionalLight('#dbe6ff', 0.4);
      fill.position.set(-10, 8, -12);
      world.scene.three.add(fill);
      this.fill = fill;

      world.renderer.three.shadowMap.enabled = true;
      world.renderer.three.shadowMap.type = THREE.PCFSoftShadowMap;

      // Receiver for the directional light's cast shadow, repositioned under
      // the loaded models' bounding box in fitShadowCatcherToScene().
      const shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.ShadowMaterial({ opacity: 0.28 }),
      );
      shadowCatcher.rotation.x = -Math.PI / 2;
      shadowCatcher.receiveShadow = true;
      shadowCatcher.position.y = 0;
      world.scene.three.add(shadowCatcher);
      this.shadowCatcher = shadowCatcher;
    }

    const post = world.renderer.postproduction;
    post.enabled = true;
    post.style = OBCF.PostproductionAspect.COLOR_PEN_SHADOWS;
    post.smaaEnabled = true;
    post.outlinesEnabled = true;
    post.glossEnabled = false;
    // Fragments-aware "Pen" pass (edge detection on an offscreen per-element
    // capture) — the official replacement for hand-built edge overlays. Its
    // offscreen capture ignores mesh opacity, so ghosted 4D elements are
    // registered with excludedObjectsPass (see syncGhostEdgeExclusion).
    post.edgesPass.enabled = true;
    post.edgesPass.width = 1.2;
    post.edgesPass.color = new THREE.Color(EDGE_COLOR);
    post.excludedObjectsEnabled = true;
    post.aoPass.enabled = true;
    post.aoPass.updateGtaoMaterial({
      radius: 0.4,
      distanceExponent: 2,
      thickness: 2,
      scale: 0.85,
      samples: 24,
      distanceFallOff: 1,
      screenSpaceRadius: true,
    });

    const grids = components.get(OBC.Grids);
    this.grid = grids.create(world);
    // Outside fragment tiles the edge pass renders every object with its own
    // material and outlines any colour change — which turns each grid line
    // (and the shadow catcher's edge) into a thick black edge. Hide both from
    // that pass only; they still draw normally in the base pass.
    const grid = this.grid;
    const edges = post.edgesPass;
    const renderEdges = edges.render.bind(edges);
    edges.render = (renderer, writeBuffer, readBuffer) => {
      const gridVisible = grid.three.visible;
      const catcherVisible = this.shadowCatcher?.visible ?? false;
      grid.three.visible = false;
      if (this.shadowCatcher) this.shadowCatcher.visible = false;
      // The fly-through path is a plain overlay, not something to outline.
      const path = this._flythrough?.object;
      const pathVisible = path?.visible ?? false;
      if (path) path.visible = false;
      // In Reveal (and X-ray), the faded tiles are hidden from the edge
      // capture too, so only the solid elements get (normal, dark) edge lines.
      const restoreGhosts = this.interactionMode === 'reveal' || this.xray ? this.hideRevealGhostTiles() : null;
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      for (const [group, flat] of this.edgeFreeObjects) {
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          swapped.push([mesh, mesh.material]);
          mesh.material = flat;
        });
      }
      renderEdges(renderer, writeBuffer, readBuffer);
      for (const [mesh, material] of swapped) mesh.material = material;
      restoreGhosts?.();
      grid.three.visible = gridVisible;
      if (this.shadowCatcher) this.shadowCatcher.visible = catcherVisible;
      if (path) path.visible = pathVisible;
    };

    // Fragments — same wiring as the official Views / ItemsFinder tutorials, but the app works offline: the worker is
    // the version-matched copy vite-plugin-static-copy puts under /wasm/ (never fetched from unpkg).
    const workerUrl = new URL('/wasm/worker.mjs', window.location.origin).toString();
    this.workerUrl = workerUrl;
    const fragments = components.get(OBC.FragmentsManager);
    this.fragments = fragments;
    fragments.init(workerUrl);
    // Models this view leaves out (setViewHiddenModels) are only hidden from
    // drawing — the stock raycast walks every model, so skip them here too
    // or the hidden project could still be picked or measured.
    const raycastAll = fragments.raycast.bind(fragments);
    fragments.raycast = async (data) => {
      if (this.viewHidden.size === 0) return raycastAll(data);
      let best: Awaited<ReturnType<typeof raycastAll>>;
      for (const model of fragments.core.models.list.values()) {
        if (!model.object.visible) continue;
        const snapping = data.snappingClasses;
        let hit = snapping?.length ? (await model.raycastWithSnapping({ ...data, snappingClasses: snapping }))?.[0] : undefined;
        hit ??= (await model.raycast(data)) ?? undefined;
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      return best;
    };
    world.camera.controls.addEventListener('update', () => fragments.core.update());
    world.camera.controls.addEventListener('update', () => this.updateNearFar());
    this.rememberCamera(world);
    // Switching Perspective <-> Orthographic swaps world.camera.three (fired
    // by projection.onChanged; onCameraChanged only covers replacing the whole
    // camera component). The base and ambient-occlusion passes keep a
    // reference to the camera they were built with — without updateCamera()
    // the shaded image stays on the old camera while the edge pass (which
    // reads world.camera each frame) follows the new one.
    const onCameraSwapped = (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) => {
      for (const [, model] of fragments.list) {
        model.useCamera(camera);
      }
      world.renderer?.postproduction.updateCamera();
      fragments.core.update(true);
    };
    world.onCameraChanged.add((camera: OBC.OrthoPerspectiveCamera) => onCameraSwapped(camera.three));
    world.camera.projection.onChanged.add((camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) => onCameraSwapped(camera));
    fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      fragments.core.update(true);
      void this.handleModelSet(model);
    });
    fragments.list.onItemDeleted.add((key) => {
      this.models.delete(key);
      this.keptColors.delete(key);
      this.keptOpacities.delete(key);
      this.indexes.delete(key);
      this.onModelDisposed?.(key);
    });
    fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
      if (!('isLodMaterial' in material && material.isLodMaterial)) {
        if (this.concrete || this.matsOn) patchAllConcrete([material]);
        material.polygonOffset = true;
        material.polygonOffsetUnits = 1;
        material.polygonOffsetFactor = Math.random();
      }
    });

    const ifcLoader = components.get(OBC.IfcLoader);
    this.ifcLoader = ifcLoader;
    await ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: '/wasm/', absolute: true },
    });

    // Highlighter — official selection (click, Ctrl+click multi-select).
    components.get(OBC.Raycasters).get(world);
    const highlighter = components.get(OBCF.Highlighter);
    highlighter.setup({
      world,
      selectMaterialDefinition: {
        color: new THREE.Color(this.selectionColor),
        opacity: 1,
        transparent: false,
        renderedFaces: 0,
      },
    });
    highlighter.styles.set('ghost', {
      color: new THREE.Color('#64748b'),
      opacity: 0.12,
      transparent: true,
      renderedFaces: 0,
    });
    // A storey slide draws the moved elements through a delta model, and the Highlighter adds the original
    // model to every selection of one: the element would light up in its old place as well. Leave out of the
    // original's highlight whatever the delta draws.
    if (this.fragments) {
      const manager = this.fragments;
      const highlightAll = manager.highlight.bind(manager);
      manager.highlight = async (style, map) => {
        if (!map) return highlightAll(style, map);
        const adjusted: OBC.ModelIdMap = {};
        for (const [modelId, ids] of Object.entries(map)) {
          const deltaId = manager.core.models.list.get(modelId)?.deltaModelId;
          const delta = deltaId ? manager.core.models.list.get(deltaId) : undefined;
          if (!delta) {
            adjusted[modelId] = ids;
            continue;
          }
          const moved = new Set(await delta.getItemsIdsWithGeometry());
          const kept = new Set([...ids].filter((id) => !moved.has(id)));
          if (kept.size) adjusted[modelId] = kept;
        }
        return highlightAll(style, adjusted);
      };
    }
    // Every selection change resets all highlights before drawing the
    // styles — and colours / opacities (Models > Colour, the 4D look) are
    // highlights too. Put them back on everything the styles don't cover.
    const updateColors = highlighter.updateColors.bind(highlighter);
    highlighter.updateColors = async () => {
      await updateColors();
      await this.restoreKeptOverrides();
    };
    // Hide / Isolate / Show all reach the split's second view too.
    const hider = components.get(OBC.Hider);
    // One change at a time: the stock isolate() runs set(false) and
    // set(true, map) in parallel, so the "hide all" could land last (in
    // either view) and leave nothing visible.
    const hiderSet = hider.set.bind(hider);
    let hiderQueue: Promise<void> = Promise.resolve();
    hider.set = (visible: boolean, modelIdMap?: OBC.ModelIdMap) => {
      const job = async () => {
        this.noteUserVisibility(visible, modelIdMap);
        await hiderSet(visible, modelIdMap);
        await this._secondary?.mirrorVisibility(visible, modelIdMap);
        this.onVisibilityChange.trigger();
      };
      hiderQueue = hiderQueue.then(job, job);
      return hiderQueue;
    };
    hider.isolate = async (modelIdMap: OBC.ModelIdMap) => {
      await Promise.all([hider.set(false), hider.set(true, modelIdMap)]);
    };
    highlighter.events.select.onHighlight.add((map) => {
      this.onSelectionChange?.(map);
      void this.applyInteraction(map);
    });
    highlighter.events.select.onClear.add(() => {
      this.onSelectionChange?.({});
      void this.clearInteraction();
    });

    OBC.Views.defaultRange = 15;
    components.get(OBC.Views).world = world;
    components.get(OBC.Viewpoints).world = world;
    components.get(OBCF.ClipStyler).world = world;

    this.setupMeasurementAndSection(container);

    // Camera fly-through (Fly-through tab). Grabbing the view stops it.
    const fly = new Flythrough(world.camera, () => this.modelsSphere()?.radius ?? 10, () => this._secondary?.followMain());
    world.scene.three.add(fly.object);
    this._flythrough = fly;
    // Walkthrough (W A S D…): the camera moves through the model with the keyboard.
    const walk = new Walkthrough(world.camera, container, () => this._secondary?.followMain());
    try {
      const saved = Number(localStorage.getItem('viewer.walkSpeed'));
      if (saved > 0) walk.speed = saved;
    } catch {
      // default speed
    }
    // Starting a fly-through leaves the walkthrough.
    fly.onPlayingChange.add((playing: boolean) => { if (playing) walk.disable(); });
    this._walkthrough = walk;
    for (const type of ['pointerdown', 'wheel']) container.addEventListener(type, () => fly.pause(), { capture: true, passive: true });

    this.markReady();
  }

  private _flythrough: Flythrough | null = null;
  private _walkthrough: Walkthrough | null = null;

  /** The keyboard walkthrough; null until init() has run. */
  get walkthrough(): Walkthrough | null {
    return this._walkthrough;
  }

  /** The camera fly-through; null until init() has run. */
  get flythrough(): Flythrough | null {
    return this._flythrough;
  }

  // ---- Official components, exposed so the UI layer never news anything ----
  get highlighter() {
    return this.components.get(OBCF.Highlighter);
  }
  get hider() {
    return this.components.get(OBC.Hider);
  }
  get finder() {
    return this.components.get(OBC.ItemsFinder);
  }
  get classifier() {
    return this.components.get(OBC.Classifier);
  }
  get viewpoints() {
    return this.components.get(OBC.Viewpoints);
  }
  get views() {
    return this.components.get(OBC.Views);
  }
  get clipper() {
    return this.components.get(OBC.Clipper);
  }
  get boundingBoxer() {
    return this.components.get(OBC.BoundingBoxer);
  }
  /** The loaded fragments model by id (null if not loaded). */
  getFragmentsModel(modelId: string): FRAGS.FragmentsModel | null {
    return this.models.get(modelId) ?? null;
  }

  /** Replaces the selection with `ids` (per model id), optionally framing it; `add` keeps the current selection too. */
  async selectElements(ids: Record<string, number[]>, zoom = true, add = false) {
    const map: OBC.ModelIdMap = {};
    for (const [modelId, list] of Object.entries(ids)) if (list.length) map[modelId] = new Set(list);
    if (OBC.ModelIdMapUtils.isEmpty(map)) {
      await this.highlighter.clear('select');
      return;
    }
    await this.highlighter.highlightByID('select', map, !add, false);
    if (zoom) await this.fit(map);
  }

  /** Shows only `ids` (per model id): they become the selection, everything else is hidden (Show all brings it back), and the view frames them. */
  async isolateElements(ids: Record<string, number[]>, zoom = true) {
    const map: OBC.ModelIdMap = {};
    for (const [modelId, list] of Object.entries(ids)) if (list.length) map[modelId] = new Set(list);
    if (OBC.ModelIdMapUtils.isEmpty(map)) return;
    await this.highlighter.highlightByID('select', map, true, false);
    await this.hider.isolate(map);
    this.onExternalVisibilityChange.trigger();
    if (zoom) await this.fit(map);
  }

  /** Touching / overlapping pairs from geometry (Clashes & contacts, Related tab). */
  readonly relations = new ElementRelations(this);

  getIndexes(): ReadonlyMap<string, ModelIndex> {
    return this.indexes;
  }

  /** Select (just highlight), Isolate (Hider.isolate the selection) or
      Reveal (selection normal, everything else ghosted via a custom
      Highlighter style — Simplebim's "Reveal"). */
  async setInteractionMode(mode: InteractionMode) {
    // Leaving a pinned Isolate for Select: the isolation stays (only the
    // pinned elements remain visible) and those visible elements become the
    // selection — to query and step through them one by one; picks then only
    // select, never isolate. Show all brings the rest back as usual.
    if (mode === 'select' && this.interactionMode === 'isolate' && this.revealPinned) {
      const visible = this.revealPinned;
      this.setPinnedState(null);
      this.interactionMode = 'select';
      await this.highlighter.highlightByID('select', visible, true, false);
      this.syncGhostEdgeExclusion();
      this.onInteractionModeChange.trigger('select');
      return;
    }
    this.setPinnedState(null);
    await this.clearInteraction();
    this.interactionMode = mode;
    const selection = this.highlighter.selection.select;
    if (!OBC.ModelIdMapUtils.isEmpty(selection)) await this.applyInteraction(selection);
    this.syncGhostEdgeExclusion();
    this.onInteractionModeChange.trigger(mode);
  }

  getInteractionMode() {
    return this.interactionMode;
  }

  /** The pinned focus set (Isolate or Reveal): while set, the isolation /
      ghosting stays on these elements whatever is selected, so they can be
      unselected (Reveal: real colours) or picked one by one to query them. */
  private revealPinned: OBC.ModelIdMap | null = null;

  isRevealPinned() {
    return this.revealPinned !== null;
  }

  private setPinnedState(pinned: OBC.ModelIdMap | null) {
    const was = this.revealPinned !== null;
    this.revealPinned = pinned;
    if (was !== (pinned !== null)) this.onRevealPinChange.trigger(pinned !== null);
  }

  /** Pins the current focus set (the selection) in Isolate or Reveal, or
      releases it — the isolation / ghosting then follows the selection
      again. Pinning needs a selection. */
  async setRevealPinned(pin: boolean) {
    // Isolate pins the same way: the isolated set stays while the selection changes.
    if (this.interactionMode !== 'reveal' && this.interactionMode !== 'isolate') return;
    const selection = this.highlighter.selection.select;
    if (pin) {
      if (this.revealPinned || OBC.ModelIdMapUtils.isEmpty(selection)) return;
      this.setPinnedState(OBC.ModelIdMapUtils.clone(selection));
      return;
    }
    if (!this.revealPinned) return;
    this.setPinnedState(null);
    await this.clearInteraction();
    if (!OBC.ModelIdMapUtils.isEmpty(selection)) await this.applyInteraction(selection);
  }

  /** Bumped by every apply / clear, so a Ghost pass still running when the mode or selection changes can tell it is stale. */
  private interactionRun = 0;

  private async applyInteraction(selection: OBC.ModelIdMap) {
    if (this.revealPinned) return;
    const run = ++this.interactionRun;
    if (this.interactionMode === 'isolate') {
      await this.hider.isolate(selection);
      this.onExternalVisibilityChange.trigger();
    } else if (this.interactionMode === 'reveal') {
      // Selection keeps its highlight; every other element gets the "ghost"
      // Highlighter style. The edge pass skips ghost tiles (see
      // hideRevealGhostTiles), so only the focused elements are outlined.
      const rest: OBC.ModelIdMap = {};
      for (const [modelId, model] of this.models) {
        const chosen = selection[modelId];
        const others = (await getGeometryLocalIds(model)).filter((id) => !chosen?.has(id));
        if (others.length) rest[modelId] = new Set(others);
      }
      // Switched to Isolate / Select (or picked again) while that ran: no ghost.
      if (run !== this.interactionRun || this.interactionMode !== 'reveal') return;
      // (Through withHighlighter: with Box select on, the Highlighter is paused.)
      await this.withHighlighter((h) => h.highlightByID('ghost', rest, true, false));
      if (run !== this.interactionRun || this.interactionMode !== 'reveal') {
        await this.withHighlighter((h) => h.clear('ghost'));
        return;
      }
      this.ghosted = rest;
      await this._secondary?.showGhost(rest);
      await this.forceUpdate();
    }
  }

  /** What Ghost mode fades now (the second view shows the same). */
  private ghosted: OBC.ModelIdMap = {};

  getGhosted(): OBC.ModelIdMap {
    return this.ghosted;
  }

  private async clearInteraction() {
    if (this.revealPinned) return;
    this.interactionRun++;
    if (this.interactionMode === 'isolate') {
      await this.hider.set(true);
      this.onExternalVisibilityChange.trigger();
    } else if (this.interactionMode === 'reveal') {
      await this.withHighlighter((h) => h.clear('ghost'));
      this.ghosted = {};
      await this._secondary?.showGhost({});
      await this.forceUpdate();
    }
  }

  /** Leaves the faded (ghost / X-ray) parts of the fragment tiles out of
      the edge pass, whose ID capture ignores opacity (see ghostEdges.ts);
      returns the function that puts them back. */
  private hideRevealGhostTiles(): () => void {
    if (!this.fragments?.initialized) return () => {};
    const tiles = [...this.fragments.core.models.list.values()].flatMap((model) => [...model.tiles.values()]);
    return hideFadedFromEdges(tiles, GHOST_OPACITY_EDGE_CUTOFF);
  }

  get postproduction() {
    return this.world.renderer!.postproduction;
  }

  /** A model that didn't come through loadIfc or loadFrag (e.g. dropped
      straight onto the official Views/ItemsFinder demo UI, if that's ever
      wired in alongside this one). */
  private async handleModelSet(model: FRAGS.FragmentsModel) {
    if (this.loadingIfc || this.loadingFrag || this.models.has(model.modelId)) return;
    this.models.set(model.modelId, model);
    this.wireShadows(model);
    try {
      const info = await this.summarize(model, model.modelId);
      await this.postLoad(model);
      this.fitShadowCatcherToScene();
      await this.restoreAssembled();
      this.onModelRegistered?.(info);
    } catch (e) {
      console.warn('ViewerEngine: registering model failed', e);
    }
  }

  /** Reads the IFC layers of a model loaded from a .frag (which carries none) out of its IFC. */
  async attachLayers(modelId: string, ifcBytes: Uint8Array) {
    await this.loadLayers(modelId, ifcBytes);
  }

  private async loadLayers(modelId: string, bytes: Uint8Array) {
    try {
      const index = this.indexes.get(modelId);
      if (!index) return;
      const idByGuid = new Map([...index.elements.values()].map((e) => [e.guid, e.localId]));
      for (const [layer, guids] of await extractLayers(bytes)) {
        const ids = guids.map((g) => idByGuid.get(g)).filter((id): id is number => id !== undefined);
        if (ids.length) index.layers.set(layer, ids);
      }
      if (index.layers.size > 0) this.onSetsReady.trigger(modelId);
    } catch (e) {
      console.warn('ViewerEngine: reading IFC layers failed', e);
    }
  }

  // ---- Markers (points with icons, from the Markers panel) ----
  private markerLayer: MarkerLayer | null = null;

  /** Draws exactly these markers, or none while they are hidden. */
  syncMarkers(list: Marker[], visible: boolean) {
    if (!this._world) return;
    this.markerLayer ??= new MarkerLayer(this.components, this._world, () => this.globalOffset());
    this.markerLayer.sync(list, visible);
  }

  /** Flies the camera to a marker, looking at it from the side it is already seen from. */
  async focusMarker(m: { x: number; y: number; z: number }) {
    if (!this._world || !this.markerLayer) return;
    const p = this.markerLayer.scenePoint(m);
    const controls = this._world.camera.controls;
    const from = controls.getPosition(new THREE.Vector3());
    const dir = from.sub(p);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
    dir.normalize().multiplyScalar(14);
    if (dir.y < 3) dir.y = 3;
    await controls.setLookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z, p.x, p.y, p.z, true);
  }

  // ---- Construction planes (translucent boxes from the Construction planes panel) ----
  private planeLayer: ConstructionPlaneLayer | null = null;

  /** Draws exactly these planes, or none while they are hidden. */
  syncConstructionPlanes(list: ConstructionPlane[], visible: boolean) {
    if (!this._world) return;
    this.planeLayer ??= new ConstructionPlaneLayer(this._world, () => this.globalOffset());
    this.planeLayer.sync(list, visible);
  }

  /** Flies the camera to a construction plane, seen from the side it is already seen from. */
  async focusConstructionPlane(p: ConstructionPlane) {
    if (!this._world || !this.planeLayer) return;
    const box = this.planeLayer.box(p);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 2);
    const controls = this._world.camera.controls;
    const dir = controls.getPosition(new THREE.Vector3()).sub(centre);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
    dir.normalize().multiplyScalar(radius * 2.2);
    if (dir.y < radius * 0.5) dir.y = radius * 0.5;
    await controls.setLookAt(centre.x + dir.x, centre.y + dir.y, centre.z + dir.z, centre.x, centre.y, centre.z, true);
  }

  // ---- IFC grids (the model's IfcGrid axes, drawn as lines with a bubble at each end) ----
  private gridData = new Map<string, IfcGridData[]>();
  private storeyData = new Map<string, IfcStoreyData[]>();
  private gridGroups = new Map<string, THREE.Group>();
  private showGrids = false;
  readonly onIfcGridsChange = new OBC.Event<void>();

  /** Whether any loaded model carries IFC grids. */
  get hasIfcGrids(): boolean {
    return [...this.gridData.values()].some((g) => g.length > 0);
  }

  private async loadGrids(modelId: string, bytes: Uint8Array) {
    try {
      const grids = await extractGrids(bytes);
      const storeys = await extractStoreys(bytes);
      if (!this.models.has(modelId)) return;
      this.gridData.set(modelId, grids);
      this.storeyData.set(modelId, storeys);
      if (this.showGrids) this.buildGrids(modelId);
      this.onIfcGridsChange.trigger();
    } catch (e) {
      console.warn('ViewerEngine: reading IFC grids failed', e);
    }
  }

  /** Shows or hides the IFC grids of every loaded model. */
  setIfcGridsVisible(on: boolean) {
    this.showGrids = on;
    for (const modelId of this.gridData.keys()) {
      if (on && !this.gridGroups.has(modelId)) this.buildGrids(modelId);
      const group = this.gridGroups.get(modelId);
      if (group) group.visible = on;
    }
    void this.forceUpdate();
  }

  private buildGrids(modelId: string) {
    const model = this.models.get(modelId);
    const grids = this.gridData.get(modelId);
    if (!model || !grids?.length) return;
    this.gridGroups.get(modelId)?.removeFromParent();
    const g = this.globalOffset();
    // IFC (X east, Y north, Z up) -> the viewer's scene, relative to where the model sits.
    const base = this.basePositions.get(modelId) ?? model.object.position;
    const toLocal = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x - g.x, z - g.z, -(y - g.y)).sub(base);
    const group = new THREE.Group();
    group.name = 'ifc-grids';
    const positions: number[] = [];
    const bubbles: { at: THREE.Vector3; tag: string }[] = [];
    for (const grid of grids) {
      for (const axis of grid.axes) {
        const pts = axis.points.map(toLocal);
        for (let i = 0; i + 1 < pts.length; i++) positions.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        // A bubble beyond each end, along the axis.
        const first = pts[0];
        const last = pts[pts.length - 1];
        const along = last.clone().sub(first).normalize();
        const gap = 0.9;
        bubbles.push({ at: first.clone().addScaledVector(along, -gap), tag: axis.tag }, { at: last.clone().addScaledVector(along, gap), tag: axis.tag });
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lineMaterial = new THREE.LineDashedMaterial({ color: '#d6336c', dashSize: 1.2, gapSize: 0.5, transparent: true, opacity: 0.9, depthWrite: false });
    const lines = new THREE.LineSegments(geometry, lineMaterial);
    lines.computeLineDistances();
    lines.renderOrder = 5;
    group.add(lines);
    const textures = new Map<string, THREE.CanvasTexture>();
    const bubbleTexture = (tag: string) => {
      let tex = textures.get(tag);
      if (!tex) {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#d6336c';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(48, 48, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#7a1238';
        ctx.font = 'bold ' + (tag.length > 3 ? 26 : tag.length > 2 ? 32 : 44) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, 48, 51, 70);
        tex = new THREE.CanvasTexture(c);
        textures.set(tag, tex);
      }
      return tex;
    };
    for (const b of bubbles) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(b.tag), depthTest: false, transparent: true }));
      sprite.position.copy(b.at);
      sprite.scale.setScalar(1.6);
      sprite.renderOrder = 6;
      group.add(sprite);
    }
    // The spacing between neighbouring parallel gridlines, in a row beyond the bubbles.
    const dimTextures = new Map<string, THREE.CanvasTexture>();
    const dimTexture = (text: string) => {
      let tex = dimTextures.get(text);
      if (!tex) {
        const c = document.createElement('canvas');
        c.width = 192;
        c.height = 64;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = '#d6336c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(3, 3, 186, 58, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#7a1238';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 96, 34, 172);
        tex = new THREE.CanvasTexture(c);
        dimTextures.set(text, tex);
      }
      return tex;
    };
    for (const grid of grids) {
      for (const dim of gridDimensions(grid.axes)) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dimTexture(spacingText(dim.spacing)), depthTest: false, transparent: true }));
        sprite.position.copy(toLocal(dim.at)).addScaledVector(new THREE.Vector3(dim.outward[0], 0, -dim.outward[1]), 0.9 + 1.7);
        sprite.scale.set(2.4, 0.8, 1);
        sprite.renderOrder = 6;
        sprite.userData.title = `${dim.from} – ${dim.to}`;
        group.add(sprite);
      }
    }
    group.visible = this.showGrids;
    model.object.add(group);
    this.gridGroups.set(modelId, group);
  }

  /** The model's building storeys with the elements under each, in spatial-tree order. */
  getStoreys(modelId: string): { name: string; ids: number[] }[] {
    const index = this.indexes.get(modelId);
    if (!index) return [];
    const out: { name: string; ids: number[] }[] = [];
    const under = (node: ModelTreeNode, acc: number[] = []) => {
      if (node.localId !== null && index.elements.has(node.localId)) acc.push(node.localId);
      node.children.forEach((c) => under(c, acc));
      return acc;
    };
    const walk = (node: ModelTreeNode, category: string) => {
      if (node.localId !== null && category === 'IFCBUILDINGSTOREY') {
        out.push({ name: index.names.get(node.localId) || `Storey ${node.localId}`, ids: under(node) });
      }
      node.children.forEach((c) => walk(c, node.localId === null ? node.category : category));
    };
    walk(index.tree, index.tree.category);
    return out;
  }

  /** Once a model has been edited (see setStoreySlide) the edited elements are
      drawn by a separate "delta" model, so per-element overrides have to reach
      both it and the original. */
  private renderTargets(model: FRAGS.FragmentsModel): FRAGS.FragmentsModel[] {
    return this.fragments ? renderTargets(this.fragments.core, model) : [model];
  }

  /** Where each element sat before any storey slide (fragments' own vertical axis). */
  private baseHeights = new Map<string, BaseHeights>();
  private slides = new Map<string, number>();

  /** The storey-slide step currently applied to a model (0 = none). */
  getStoreySlide(modelId: string) {
    return { step: this.slides.get(modelId) ?? 0, storeys: this.getStoreys(modelId) };
  }

  /** Models the main view leaves out entirely (the per-view "Models" setting,
      e.g. one project per side of the compare slider). */
  private viewHidden = new Set<string>();

  /** Hides whole models from this view only. Works on the model objects, not
      element visibility, so the 4D sequence and Hide / Isolate never bring
      them back. (The split's right view has its own — SecondaryView.) */
  setViewHiddenModels(modelIds: Iterable<string>) {
    this.viewHidden = new Set(modelIds);
    this.applyViewHidden();
    void this.forceUpdate();
  }

  private applyViewHidden() {
    for (const [id, model] of this.models) {
      const shown = !this.viewHidden.has(id);
      for (const m of this.renderTargets(model)) m.object.visible = shown;
    }
  }

  /** Where the compare slider's divider is (fraction of the view width), or
      null when the second view isn't a slider — the image / video export
      clips the right view the same way. */
  compareSlider: number | null = null;

  /** Storey slide: lifts storey n by n x `step` metres (storeys in spatial-tree
      order, lowest first) by editing each element's placement. 0 puts everything
      back. Absolute, so repeating it never accumulates. */
  async setStoreySlide(modelId: string, step: number) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    const storeys = this.getStoreys(modelId);
    const bases = this.baseHeights.get(modelId) ?? new Map<number, number>();
    this.baseHeights.set(modelId, bases);
    this.slides.set(modelId, step);
    if (!(await slideStoreys(this.fragments.core, modelId, storeys, step, bases))) return;
    // The slide's edit layer is a new render model; it follows the view's hidden models.
    this.applyViewHidden();
    await this.fragments.core.update(true);
    this.fitShadowCatcherToScene();
    this.syncGhostEdgeExclusion();
    // The slide's edit layer is a new render model: it casts shadows too.
    this.wireShadows(model);
    // Whatever the 4D driver had applied now sits on different render models.
    // (The split's right view has its own slide — SecondaryView.setStoreySlide.)
    this.onExternalVisibilityChange.trigger();
  }

  /** Anything the automatic sets could not do, shown in the
      Sets and Views tabs so a silent failure isn't invisible. */
  readonly setupErrors: string[] = [];

  /** Storeys, categories and search sets, generated on load.
      Each step is independent and time-boxed: one failing (or hanging) on a
      difficult file must not take the others with it, and each falls back to
      building the same thing from the loaded tree/elements. */
  private async postLoad(model: FRAGS.FragmentsModel) {
    const modelId = model.modelId;
    // Everything in the material list now is the model's own (4D colours
    // come later) — the realistic look greys only these.
    if (this.fragments) {
      const mats = [...this.fragments.core.models.materials.list.values()];
      markBaseMaterials(mats);
      if (this.concrete || this.matsOn) patchAllConcrete(mats);
      refreshMaterialClasses(mats);
      if (this.matsOn) void this.ensureMaterialEntries(true);
      if (this.xray) applyXray(mats, true);
    }
    const only = [new RegExp(`^${escapeRegExp(modelId)}$`)];
    const index = this.indexes.get(modelId);

    const step = async (label: string, run: () => Promise<void>) => {
      try {
        await Promise.race([
          run(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 20s')), 20_000)),
        ]);
      } catch (e) {
        console.warn(`ViewerEngine: ${label} failed`, e);
        this.setupErrors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const storeyItems = () => this.getStoreys(modelId);

    await step('Storeys', async () => {
      await this.classifier.byIfcBuildingStorey({ classificationName: STOREYS_CLASSIFICATION, modelIds: only });
      if ((this.classifier.list.get(STOREYS_CLASSIFICATION)?.size ?? 0) === 0) throw new Error('classifier returned no storeys');
    }).then(async () => {
      if ((this.classifier.list.get(STOREYS_CLASSIFICATION)?.size ?? 0) > 0) return;
      // Fallback: the same static groups, from the loaded spatial tree.
      for (const { name, ids } of storeyItems()) {
        if (!ids.length) continue;
        this.classifier.getGroupData(STOREYS_CLASSIFICATION, name);
        this.classifier.addGroupItems(STOREYS_CLASSIFICATION, name, { [modelId]: new Set(ids) });
      }
      // The fallback covered it, so the first attempt's error isn't worth showing.
      if ((this.classifier.list.get(STOREYS_CLASSIFICATION)?.size ?? 0) > 0) {
        const i = this.setupErrors.findIndex((m) => m.startsWith('Storeys:'));
        if (i !== -1) this.setupErrors.splice(i, 1);
      }
    });

    await step('Categories', async () => {
      // byCategory registers an ItemsFinder query per category and a
      // classifier group linked to it, so both Sets lists fill up together.
      try {
        await this.classifier.byCategory({ classificationName: CATEGORIES_CLASSIFICATION, modelIds: only });
      } catch (e) {
        console.warn('ViewerEngine: classifier.byCategory failed, building category sets from the elements', e);
      }
      if ((this.classifier.list.get(CATEGORIES_CLASSIFICATION)?.size ?? 0) > 0 || !index) return;
      const categories = new Set([...index.elements.values()].map((e) => e.category));
      for (const category of categories) {
        this.finder.create(category, [{ categories: [new RegExp(`^${escapeRegExp(category)}$`)] }]);
        this.classifier.setGroupQuery(CATEGORIES_CLASSIFICATION, category, { name: category });
      }
    });

    this.onSetsReady.trigger(modelId);
  }

  async loadIfc(buffer: ArrayBuffer, name: string): Promise<LoadedModelInfo> {
    await this.ready;
    const fragments = this.fragments;
    if (!this.ifcLoader || !fragments || !this._world) throw new Error('ViewerEngine.init() must be called first');
    const bytes = new Uint8Array(buffer);
    this.loadingIfc = true;
    let model: FRAGS.FragmentsModel;
    try {
      model = await this.ifcLoader.load(bytes, true, name);
    } finally {
      this.loadingIfc = false;
    }
    this.models.set(model.modelId, model);
    this.wireShadows(model);

    model.object.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    await fragments.core.update(true);
    this.fitShadowCatcherToScene();

    const info = await this.summarize(model, name);
    await this.postLoad(model);
    await this.restoreAssembled();
    // Layers come from the IFC text and can take a while on a big file, so
    // they load in the background after the model, sets and floor plans are
    // already usable.
    void this.loadLayers(model.modelId, bytes);
    void this.loadGrids(model.modelId, bytes);
    return info;
  }

  /** Loads an already-converted .frag (Fragments binary) file — same result
      as loadIfc, minus the IFC-to-fragments conversion step and the layers
      pass (layers come from the raw IFC text, which a .frag doesn't carry). */
  async loadFrag(buffer: ArrayBuffer, name: string): Promise<LoadedModelInfo> {
    await this.ready;
    const fragments = this.fragments;
    if (!fragments || !this._world) throw new Error('ViewerEngine.init() must be called first');
    const bytes = new Uint8Array(buffer);
    this.loadingFrag = true;
    let model: FRAGS.FragmentsModel;
    try {
      model = await fragments.core.load(bytes, { modelId: name });
    } finally {
      this.loadingFrag = false;
    }
    this.models.set(model.modelId, model);
    this.wireShadows(model);

    model.object.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    await fragments.core.update(true);
    this.fitShadowCatcherToScene();

    const info = await this.summarize(model, name);
    await this.postLoad(model);
    await this.restoreAssembled();
    return info;
  }

  /** A loaded model as .frag bytes plus its IFC layers (which a .frag
      doesn't carry) — what another tab needs to load the same model
      without converting the IFC again (see duplicateTab.ts). */
  async exportModel(modelId: string) {
    const model = this.models.get(modelId);
    const index = this.indexes.get(modelId);
    if (!model || !index) return null;
    return { buffer: await model.getBuffer(false), name: index.name, layers: [...index.layers] };
  }

  /** Layers read by another tab (see exportModel). */
  setLayers(modelId: string, layers: [string, number[]][]) {
    const index = this.indexes.get(modelId);
    if (!index || layers.length === 0) return;
    for (const [layer, ids] of layers) index.layers.set(layer, ids);
    this.onSetsReady.trigger(modelId);
  }

  /** Where each model sat as loaded (auto-coordination already applied), so a
      translate is always "loaded position + offset" and Reset is exact. */
  private basePositions = new Map<string, THREE.Vector3>();

  /** Moves a model by an offset in project axes (X east, Y north, Z up, metres).
      The viewer is Y-up, so project (x, y, z) is scene (x, z, -y). */
  async setModelOffset(modelId: string, offset: { x: number; y: number; z: number; rot?: { deg: number; px: number; py: number; pz: number } }) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    let base = this.basePositions.get(modelId);
    if (!base) {
      base = model.object.position.clone();
      this.basePositions.set(modelId, base);
    }
    // Turn about the vertical axis through the pivot, then move: the model's
    // loaded position is turned about the pivot, and the model itself turns.
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((offset.rot?.deg ?? 0) * Math.PI) / 180);
    // The pivot is given in the IFC's own coordinates; the viewer sits at those minus the global offset.
    const g = this.globalOffset();
    const pivot = new THREE.Vector3((offset.rot?.px ?? 0) - g.x, (offset.rot?.pz ?? 0) - g.z, -((offset.rot?.py ?? 0) - g.y));
    const position = base.clone().sub(pivot).applyQuaternion(quaternion).add(pivot).add(new THREE.Vector3(offset.x, offset.z, -offset.y));
    model.object.position.copy(position);
    model.object.quaternion.copy(quaternion);
    model.object.updateMatrixWorld(true);
    await this.fragments.core.update(true);
    this.fitShadowCatcherToScene();
    this.secondary?.setModelPosition(modelId, position, quaternion);
  }

  /** Drops the shadow-catching floor plane just beneath the combined
      bounding box of everything currently loaded. */
  private fitShadowCatcherToScene() {
    if (!this.shadowCatcher) return;
    const box = new THREE.Box3();
    let hasContent = false;
    for (const model of this.models.values()) {
      const modelBox = new THREE.Box3().setFromObject(model.object);
      if (!modelBox.isEmpty()) {
        box.union(modelBox);
        hasContent = true;
      }
    }
    if (!hasContent) return;
    this.shadowCatcher.position.y = box.min.y - 0.05;
  }

  private async summarize(model: FRAGS.FragmentsModel, name: string): Promise<LoadedModelInfo> {
    const localIds = await getGeometryLocalIds(model);
    const CHUNK = 500;
    const elements: ElementSummary[] = [];
    for (let i = 0; i < localIds.length; i += CHUNK) {
      const chunk = localIds.slice(i, i + CHUNK);
      const data = await model.getItemsData(chunk, {
        attributesDefault: true,
        relations: { IsDefinedBy: { attributes: true, relations: true } },
      });
      data.forEach((item, idx) => {
        elements.push(flattenItem(chunk[idx], item, name));
      });
    }
    const tree = toTreeNode(await model.getSpatialStructure());
    this.indexes.set(model.modelId, {
      name,
      tree,
      names: await collectNames(model, tree, elements),
      elements: new Map(elements.map((e) => [e.localId, e])),
      layers: new Map(),
    });
    return {
      modelId: model.modelId,
      name,
      elementCount: elements.length,
      elements,
      tree,
    };
  }

  /** The postproduction edgesPass's offscreen ID-color capture always swaps
      every tile to a fully-opaque override material — it never sees a mesh's
      real opacity, so a low-opacity 4D "ghost" element still gets
      full-strength edges. excludedObjectsPass is the official mechanism for
      skipping such materials in every postproduction pass. */
  /** Materials drawn without edge lines: growth stand-ins whose profile turns edges off (see growthAnimator.ts). */
  readonly edgeFreeMaterials = new Set<THREE.Material>();
  /** The same stand-ins, each with the flat material it takes in the edge pass's capture: still there to hide
      the edges behind it, but one plain colour, so it draws none of its own. */
  readonly edgeFreeObjects = new Map<THREE.Object3D, THREE.Material>();

  /** Models drawn without edge lines (Models page › the list's Edges toggle), by model id. */
  private edgelessModels = new Set<string>();
  setModelEdges(modelId: string, on: boolean) {
    if (on) this.edgelessModels.delete(modelId);
    else this.edgelessModels.add(modelId);
    this.syncGhostEdgeExclusion();
    const renderer = this._world?.renderer as unknown as { needsUpdate?: boolean } | undefined;
    if (renderer) renderer.needsUpdate = true;
  }

  refreshEdgeExclusion() {
    this.syncGhostEdgeExclusion();
  }

  private syncGhostEdgeExclusion() {
    if (!this._world?.renderer?.postproduction) return;
    const pass = this._world.renderer.postproduction.excludedObjectsPass;
    const ghostMaterials = new Set<THREE.Material>(this.edgeFreeMaterials);
    for (const id of this.edgelessModels) {
      this.models.get(id)?.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) ghostMaterials.add(material);
      });
    }
    // Reveal hides every faded tile from the edge pass instead (see
    // hideRevealGhostTiles). The excluded pass would paint the ghosts back
    // over the final image, covering the focused elements' edges behind them.
    // X-ray does the same (its faded materials would be caught here too).
    if (this.interactionMode !== 'reveal' && !this.xray) for (const model of this.models.values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (material.transparent && (material as THREE.Material & { opacity: number }).opacity < GHOST_OPACITY_EDGE_CUTOFF) {
            ghostMaterials.add(material);
          }
        }
      });
    }
    for (const material of pass.excludedMaterials) {
      if (!ghostMaterials.has(material)) pass.removeExcludedMaterial(material);
    }
    for (const material of ghostMaterials) {
      if (!pass.excludedMaterials.includes(material)) pass.addExcludedMaterial(material);
    }
  }

  // ---- 4D timeline hooks (programmatic per-element visibility/colour) ----
  async setVisible(modelId: string, localIds: number[], visible: boolean, skipUpdate = false) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    for (const m of this.renderTargets(model)) await m.setVisible(localIds, visible);
    if (!skipUpdate) {
      await this.fragments.core.update(true);
      this.syncGhostEdgeExclusion();
    }
  }

  /** Colour / opacity set on each element (by model), kept so they can be
      put back after the Highlighter redraws (see restoreKeptOverrides). */
  private keptColors = new Map<string, Map<number, string>>();
  private keptOpacities = new Map<string, Map<number, number>>();

  private keep<T>(kept: Map<string, Map<number, T>>, modelId: string, localIds: number[], value: T | null) {
    const byId = kept.get(modelId) ?? kept.set(modelId, new Map()).get(modelId)!;
    for (const id of localIds) {
      if (value === null) byId.delete(id);
      else byId.set(id, value);
    }
  }

  /** Elements drawn in a Highlighter style (the selection, Reveal's ghosts). */
  private styledIds(modelId: string): Set<number> {
    const out = new Set<number>();
    if (!this._components) return out;
    for (const map of Object.values(this.highlighter.selection)) for (const id of map[modelId] ?? []) out.add(id);
    return out;
  }

  private async restoreKeptOverrides() {
    if (!this.fragments) return;
    for (const [modelId, model] of this.models) {
      const styled = this.styledIds(modelId);
      const group = <T>(kept: Map<number, T> | undefined) => {
        const out = new Map<T, number[]>();
        for (const [id, v] of kept ?? []) if (!styled.has(id)) (out.get(v) ?? out.set(v, []).get(v)!).push(id);
        return out;
      };
      const colors = group(this.keptColors.get(modelId));
      const opacities = group(this.keptOpacities.get(modelId));
      if (!colors.size && !opacities.size) continue;
      for (const m of this.renderTargets(model)) {
        for (const [c, ids] of colors) await m.setColor(ids, new THREE.Color(c));
        for (const [o, ids] of opacities) await m.setOpacity(ids, o);
      }
    }
    await this.fragments.core.update(true);
    this.syncGhostEdgeExclusion();
  }

  async setColor(modelId: string, localIds: number[], color: string | null, skipUpdate = false) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    if (localIds.length === 0) return;
    this.keep(this.keptColors, modelId, localIds, color);
    // Selected (or ghosted) elements keep their style; they get the colour back when it comes off.
    const styled = this.styledIds(modelId);
    const ids = styled.size ? localIds.filter((id) => !styled.has(id)) : localIds;
    if (ids.length) for (const m of this.renderTargets(model)) {
      if (color === null) await m.resetColor(ids);
      else await m.setColor(ids, new THREE.Color(color));
    }
    if (!skipUpdate) await this.fragments.core.update(true);
  }

  /** The colour the model itself gives these elements (#rrggbb), whatever
      overrides are on now. Elements without a material are left out. */
  async getElementColors(modelId: string, localIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const model = this.models.get(modelId) as unknown as
      | { getItemsMaterialDefinition?: (ids: number[]) => Promise<{ definition: { color: { r: number; g: number; b: number } }; localIds: number[] }[]> }
      | undefined;
    if (!model?.getItemsMaterialDefinition || localIds.length === 0) return out;
    try {
      for (const m of await model.getItemsMaterialDefinition(localIds)) {
        const { r, g, b } = m.definition.color;
        const hex = `#${new THREE.Color(r, g, b).getHexString()}`;
        for (const id of m.localIds) out.set(id, hex);
      }
    } catch (e) {
      console.warn('ViewerEngine: getElementColors failed', e);
    }
    return out;
  }

  async setOpacity(modelId: string, localIds: number[], opacity: number | null, skipUpdate = false) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    if (localIds.length === 0) return;
    this.keep(this.keptOpacities, modelId, localIds, opacity);
    const styled = this.styledIds(modelId);
    const ids = styled.size ? localIds.filter((id) => !styled.has(id)) : localIds;
    if (ids.length) for (const m of this.renderTargets(model)) {
      if (opacity === null) await m.resetOpacity(ids);
      else await m.setOpacity(ids, opacity);
    }
    if (!skipUpdate) {
      await this.fragments.core.update(true);
      this.syncGhostEdgeExclusion();
    }
  }

  /** Forces a single composited re-render after a batch of calls made with
      skipUpdate, and resyncs ghost/edge exclusion. */
  async forceUpdate() {
    if (!this.fragments) return;
    await this.fragments.core.update(true);
    this.syncGhostEdgeExclusion();
  }

  async resetVisible(modelId: string) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    for (const m of this.renderTargets(model)) await m.resetVisible();
    await this.fragments.core.update(true);
    this.syncGhostEdgeExclusion();
  }

  /** Paints the selected objects (every model, both views of a split) with a
      hand-picked colour — kept like the other colour overrides — or, with
      null, takes their colour back. The selection is cleared after painting,
      since selected objects show the selection colour instead. Returns how
      many objects it touched. */
  async paintSelection(color: string | null): Promise<number> {
    if (!this._components) return 0;
    const selected = this.highlighter.selection.select;
    let count = 0;
    for (const [modelId, ids] of Object.entries(selected)) {
      const list = [...ids];
      if (!list.length) continue;
      count += list.length;
      await this.setColor(modelId, list, color, true);
      await this._secondary?.setColor(modelId, list, color, true);
    }
    if (count === 0) return 0;
    await this.forceUpdate();
    if (color !== null) await this.highlighter.clear('select');
    return count;
  }

  /** Takes every colour override off every model (the picked ones, Models >
      Colour and the 4D stage colours alike); visibility and opacity stay. */
  async clearColorOverrides() {
    if (!this.fragments) return;
    this.keptColors.clear();
    for (const model of this.models.values()) {
      for (const m of this.renderTargets(model)) await m.resetColor(undefined);
    }
    await this._secondary?.resetColors();
    // Resetting colours also took the selection highlight off: draw it again.
    await this.highlighter.updateColors();
    await this.forceUpdate();
  }

  /** Puts every object's colour and opacity back to the model's own, in both views (painted colours, Models > Colour,
      the colour legend and the 4D stages alike); what is hidden stays hidden. The 4D page then draws its own again
      ("Refresh graphics"). */
  async resetLooks() {
    if (!this.fragments) return;
    this.keptColors.clear();
    this.keptOpacities.clear();
    for (const model of this.models.values()) {
      for (const m of this.renderTargets(model)) {
        await m.resetColor(undefined);
        await m.resetOpacity(undefined);
      }
    }
    await this._secondary?.resetLooks();
    // The reset took the selection highlight off too: draw it again.
    await this.highlighter.updateColors();
    await this.forceUpdate();
  }

  /** Drops every per-element visibility/colour/opacity override on every
      model — what the 4D sequence leaves behind (elements hidden before
      their start date, recoloured stages) — so leaving that page doesn't
      leave the Models view looking empty. */
  async resetOverrides() {
    if (!this.fragments) return;
    this.keptColors.clear();
    this.keptOpacities.clear();
    for (const model of this.models.values()) {
      for (const m of this.renderTargets(model)) {
        await m.resetVisible();
        await m.resetColor(undefined);
        await m.resetOpacity(undefined);
      }
    }
    this._growth?.clear();
    // The split's right view carries the same 4D overrides.
    await this._secondary?.resetOverrides();
    await this.fragments.core.update(true);
    this.syncGhostEdgeExclusion();
    this.onExternalVisibilityChange.trigger();
  }

  /** Fits the camera across ids from several models at once (e.g. a Link
      Group whose matches span more than one loaded IFC file). */
  async fitToModelIds(idsByModel: Map<string, number[]>) {
    if (!this._world) return;
    try {
      const nonEmpty = [...idsByModel.entries()].filter(([, ids]) => ids.length > 0);
      if (nonEmpty.length === 0) {
        await this._world.camera.fitToItems();
        return;
      }
      const sel: Record<string, Set<number>> = {};
      for (const [modelId, ids] of nonEmpty) sel[modelId] = new Set(ids);
      await this._world.camera.fitToItems(sel);
    } catch (e) {
      console.warn('ViewerEngine: fitToModelIds failed', e);
    }
  }

  /** The camera ships with near=1 / far=1000, so a model a few hundred
      metres across is clipped away (edges still draw, shading and grid
      vanish). Stretch the far plane to the scene's size. */
  private adaptClipping(box: THREE.Box3) {
    const camera = this._world?.camera;
    if (!camera || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    if (!Number.isFinite(size) || size <= 0) return;
    this.sceneSphere = box.getBoundingSphere(new THREE.Sphere());
    for (const cam of [camera.threePersp, camera.threeOrtho]) {
      cam.far = Math.max(1000, size * 20);
      cam.near = Math.max(cam.near, Math.min(size / 2000, 1));
      cam.updateProjectionMatrix();
    }
  }

  /** The loaded models' bounding sphere (set with the clipping range): the near / far planes follow the camera's distance to it. */
  private sceneSphere: THREE.Sphere | null = null;

  /** Keeps the perspective camera's near plane just short of the nearest geometry (and the far plane beyond the farthest),
      so a large model (a terrain hundreds of metres across) is not cut away close to the camera while the depth buffer
      keeps its precision. Runs as the camera moves. */
  private updateNearFar() {
    const cam = this._world?.camera.threePersp;
    const s = this.sceneSphere;
    if (!cam || !s) return;
    const dist = cam.position.distanceTo(s.center);
    const outside = dist - s.radius;
    // Outside the models: the near plane can come close to the nearest point; inside them: a small one.
    const near = Math.max(Math.min(s.radius / 5000, 0.5), outside > 0 ? outside * 0.5 : 0, 0.01);
    const far = Math.max(1000, dist + s.radius * 2);
    if (Math.abs(near - cam.near) > cam.near * 0.05 || Math.abs(far - cam.far) > cam.far * 0.05) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  private selectionColor = '#1e88e5';

  /** Colour of selected objects (Settings > 3D views). Re-applies it to the
      current selection so the change shows at once. */
  async setSelectionColor(hex: string) {
    this.selectionColor = hex;
    if (!this._components) return;
    const style = this.highlighter.styles.get('select');
    if (!style) return;
    style.color = new THREE.Color(hex);
    this.components.get(OBCF.Outliner).fillColor = new THREE.Color(hex);
    const current = this.highlighter.selection.select;
    if (OBC.ModelIdMapUtils.isEmpty(current)) return;
    const copy = OBC.ModelIdMapUtils.clone(current);
    await this.highlighter.highlightByID('select', copy, true, false);
  }

  // ---- Realistic look (3D View > Realistic) ---------------------------------
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private fill: THREE.DirectionalLight | null = null;
  private realism: RealismSettings | null = null;
  private concrete: RealismSettings | null = null;

  /** Turns the sun & shadows look on (a fixed sun from the given bearing and
      height, soft shadows on the model) or off (the default studio lighting). */
  setRealism(settings: RealismSettings | null) {
    this.realism = settings;
    const world = this._world;
    if (!world?.renderer) return;
    // Shadows land on the model itself too, not only the ground plane.
    for (const model of this.models.values()) this.wireShadows(model);
    // No sun & shadows, no shadows at all: nothing casts, and the ground
    // plane that catches them is hidden.
    if (this.sun) this.sun.castShadow = !!settings;
    if (this.shadowCatcher) {
      (this.shadowCatcher.material as THREE.ShadowMaterial).opacity = 0.4;
      this.shadowCatcher.visible = !!settings;
    }
    if (this.sun) this.sun.shadow.mapSize.set(settings ? 4096 : 2048, settings ? 4096 : 2048);
    this.sun?.shadow.map?.dispose();
    if (this.sun) this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.updateSun();
  }

  /** Turns the concrete colour and texture on (strengths from `settings`)
      or off — independent of the sun & shadows. */
  setConcrete(settings: RealismSettings | null) {
    this.concrete = settings;
    setConcreteStrength(settings ? settings.concrete : 0, settings ? settings.concreteColor : 0);
    if (settings && this.fragments) patchAllConcrete(this.fragments.core.models.materials.list.values());
    void this.forceUpdate();
  }

  // ---- Real-time sky and material classes -----------------------------------
  private sky: SkyBackdrop | null = null;
  private skyActive = false;
  private matsOn = false;
  private entries: MaterialEntry[] | null = null;
  private entriesRun: Promise<void> | null = null;
  /** Called with the colour groups of the loaded models once they are read. */
  readonly materialEntryListeners = new Set<(entries: MaterialEntry[]) => void>();
  get materialEntries(): MaterialEntry[] | null {
    return this.entries;
  }

  /** The sky as backdrop (from the sun's bearing and height) and as what the
      shiny classes reflect — all moving with the sun controls. */
  setSky(on: boolean, settings: RealismSettings) {
    this.skyActive = on;
    const params = skyParamsFor(settings.sunAzimuth, settings.sunElevation);
    setSkyUniforms(params);
    const scene = this._world?.scene.three;
    const renderer = this._world?.renderer?.three;
    if (!scene || !renderer) return;
    if (on) {
      this.sky ??= new SkyBackdrop();
      this.sky.update(renderer, params);
      scene.background = this.sky.texture;
    } else {
      scene.background = new THREE.Color(this.bgColor);
    }
    void this.forceUpdate();
  }

  /** Shows the material classes (brick, glass, timber...) matched from the
      models' names, or the models' own colours. */
  setMaterials(on: boolean) {
    this.matsOn = on;
    setMaterialsEnabled(on);
    if (!this.fragments) return;
    const mats = this.fragments.core.models.materials.list.values();
    if (on) patchAllConcrete(mats);
    refreshMaterialClasses(this.fragments.core.models.materials.list.values());
    if (on) void this.ensureMaterialEntries();
    void this.forceUpdate();
  }

  /** The class chosen by hand per colour group, over the automatic match. */
  setClassChoices(choices: Record<string, ClassChoice>) {
    setClassOverrides(choices);
    this.refreshClasses();
  }

  private refreshClasses() {
    if (this.fragments) refreshMaterialClasses(this.fragments.core.models.materials.list.values());
    this.secondary?.refreshClasses();
    void this.forceUpdate();
  }

  /** Reads each element's colour group and the names that say what it is made
      of, once per set of loaded models (again when `again`). */
  async ensureMaterialEntries(again = false): Promise<void> {
    if (again) this.entries = null;
    if (this.entries) return;
    this.entriesRun ??= (async () => {
      const items: ElementMaterialInfo[] = [];
      for (const [modelId, model] of this.models) {
        const index = this.indexes.get(modelId);
        if (!index) continue;
        const ids = [...index.elements.keys()];
        const hex = new Map<number, string>();
        for (let i = 0; i < ids.length; i += 2000) for (const [id, h] of await this.getElementColors(modelId, ids.slice(i, i + 2000))) hex.set(id, h);
        const CHUNK = 400;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          let data: unknown[] = [];
          try {
            data = await model.getItemsData(chunk, { attributesDefault: false, relations: { HasAssociations: { attributes: true, relations: true } } });
          } catch (e) {
            console.warn('ViewerEngine: material names unavailable', e);
          }
          chunk.forEach((id, k) => {
            const colour = hex.get(id);
            const el = index.elements.get(id);
            if (!colour || !el) return;
            const item = data[k] as Record<string, unknown> | undefined;
            items.push({ hex: colour, materialNames: [...collectMaterialNames(item?.HasAssociations)], name: el.name, category: el.category });
          });
        }
      }
      this.entries = buildMaterialEntries(items);
      setMaterialEntries(this.entries);
      this.refreshClasses();
      for (const listener of this.materialEntryListeners) listener(this.entries);
    })().finally(() => { this.entriesRun = null; });
    await this.entriesRun;
  }

  private savedPixelRatio: number | null = null;

  /** Renders the view(s) at `scale` x their CSS size while an image/video
      export runs (real detail, not an upscale); null restores the screen
      resolution. */
  setCaptureScale(scale: number | null) {
    const r = this._world?.renderer;
    if (!r) return;
    if (scale === null) {
      if (this.savedPixelRatio === null) return;
      r.three.setPixelRatio(this.savedPixelRatio);
      this.secondary?.setPixelRatio(this.savedPixelRatio);
      this.savedPixelRatio = null;
    } else {
      if (this.savedPixelRatio === null) this.savedPixelRatio = r.three.getPixelRatio();
      r.three.setPixelRatio(scale);
      this.secondary?.setPixelRatio(scale);
    }
    r.resize(undefined);
    void this.forceUpdate();
  }

  /** Fragments streams a model's geometry in tiles that are created and
      replaced as the camera moves — flag each one as it arrives, or shadows
      come and go as tiles swap (the initial traverse only sees the first). */
  private readonly shadowWired = new WeakSet<FRAGS.FragmentsModel>();
  private wireShadows(model: FRAGS.FragmentsModel) {
    const flag = (mesh: THREE.Object3D) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    };
    for (const target of this.fragments ? renderTargets(this.fragments.core, model) : [model]) {
      if (this.shadowWired.has(target)) continue;
      this.shadowWired.add(target);
      target.tiles.forEach((mesh) => flag(mesh));
      target.tiles.onItemSet.add(({ value }) => flag(value));
    }
  }

  private updateSun() {
    if (!this.sun || !this.hemi || !this.fill) return;
    configureSun({ sun: this.sun, hemi: this.hemi, fill: this.fill }, this.realism, this.realism ? this.modelsBox() : null);
    void this.forceUpdate();
  }

  private _growth: GrowthAnimator | null = null;
  /** 4D growth simulation (stand-in copies that drop / slide / grow). */
  get growth(): GrowthAnimator {
    if (!this._growth) this._growth = new GrowthAnimator(this);
    return this._growth;
  }

  /** The IFC files' own coordinates are far from the origin, so the loader
      recentres the models on the first one loaded: what the viewer shows
      is the original coordinate minus this. `globalOffset` (project axes: X
      east, Y north, Z up, metres) is what to add to a viewer point to get its
      coordinate in the IFC (as other viewers show it). */
  globalOffset(): { x: number; y: number; z: number } {
    const c = this.fragments?.core.baseCoordinates;
    // The loader's coordinates are in the viewer's axes (X east, Y up, Z south), subtracted.
    return c && c.length >= 3 ? { x: -c[0], y: c[2], z: -c[1] } : { x: 0, y: 0, z: 0 };
  }

  /** Bounding box of one loaded model (placement included), or null without geometry. */
  modelBox(modelId: string): THREE.Box3 | null {
    const bb = this.boundingBoxer;
    bb.list.clear();
    bb.addFromModels([new RegExp(`^${escapeRegExp(modelId)}$`)]);
    const box = bb.get();
    bb.list.clear();
    const finite = Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y + box.min.z + box.max.z);
    return box.isEmpty() || !finite ? null : box.clone();
  }

  /** Bounding box of every loaded model, or null while there is none. */
  modelsBox(): THREE.Box3 | null {
    const bb = this.boundingBoxer;
    bb.list.clear();
    bb.addFromModels();
    const box = bb.get();
    bb.list.clear();
    const finite = Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y + box.min.z + box.max.z);
    return box.isEmpty() || !finite ? null : box.clone();
  }

  /** Bounding sphere of some objects, or null when they have no geometry. */
  async boundsSphere(modelIdMap: OBC.ModelIdMap): Promise<THREE.Sphere | null> {
    const bb = this.boundingBoxer;
    bb.list.clear();
    await bb.addFromModelIdMap(modelIdMap);
    const box = bb.get();
    bb.list.clear();
    const finite = Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y + box.min.z + box.max.z);
    return box.isEmpty() || !finite ? null : box.getBoundingSphere(new THREE.Sphere());
  }

  /** Bounding sphere of every loaded model, or null while there is none. */
  modelsSphere(): THREE.Sphere | null {
    const bb = this.boundingBoxer;
    bb.list.clear();
    bb.addFromModels();
    const box = bb.get();
    bb.list.clear();
    const finite = Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y + box.min.z + box.max.z);
    return box.isEmpty() || !finite ? null : box.getBoundingSphere(new THREE.Sphere());
  }

  // ---- The camera is kept with the scene (the browser key "viewer.camera" is part of its layout) ----
  private savedCamera: { position: number[]; target: number[]; ortho: boolean; zoom: number } | null = readSavedCamera();
  private cameraTimer: number | undefined;

  /** Writes the camera into the browser key a moment after it stops moving. Nothing is written until the saved one
      has been brought back (the first whole-model fit), so the default view never overwrites it. */
  private rememberCamera(world: World) {
    const camera = world.camera;
    const save = () => {
      if (this.savedCamera) return;
      const position = camera.controls.getPosition(new THREE.Vector3());
      const target = camera.controls.getTarget(new THREE.Vector3());
      const ortho = camera.projection.current !== 'Perspective';
      try {
        localStorage.setItem('viewer.camera', JSON.stringify({ position: position.toArray(), target: target.toArray(), ortho, zoom: camera.threeOrtho.zoom }));
      } catch {
        // storage full: the camera is simply not kept
      }
    };
    camera.controls.addEventListener('update', () => {
      window.clearTimeout(this.cameraTimer);
      this.cameraTimer = window.setTimeout(save, 700);
    });
  }

  /** Puts the saved camera back (once), after the models have been framed. */
  private async applySavedCamera() {
    const saved = this.savedCamera;
    if (!saved || !this._world) return;
    this.savedCamera = null;
    const camera = this._world.camera;
    if (saved.ortho !== (camera.projection.current !== 'Perspective')) camera.projection.set(saved.ortho ? 'Orthographic' : 'Perspective');
    const [px, py, pz] = saved.position;
    const [tx, ty, tz] = saved.target;
    await camera.controls.setLookAt(px, py, pz, tx, ty, tz, false);
    if (saved.ortho && Number.isFinite(saved.zoom)) await camera.controls.zoomTo(saved.zoom, false);
  }

  /** Fit / focus via BoundingBoxer — the given selection, else every model.
      Perspective is framed from the bounding sphere (distance = radius /
      sin(fov/2)) and set with setLookAt, which is exact at any model size;
      Orthographic uses fitToBox (it zooms rather than moving). `direction`
      is the view direction to frame from (default: keep the current one). */
  async fit(modelIdMap?: OBC.ModelIdMap, transition = true, direction?: THREE.Vector3) {
    if (!this._world) return;
    const bb = this.boundingBoxer;
    try {
      bb.list.clear();
      if (modelIdMap && !OBC.ModelIdMapUtils.isEmpty(modelIdMap)) await bb.addFromModelIdMap(modelIdMap);
      else bb.addFromModels();
      const box = bb.get();
      bb.list.clear();
      const finite = Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y + box.min.z + box.max.z);
      if (box.isEmpty() || !finite) {
        // No usable bounds yet (e.g. tiles still streaming in): fall back to
        // the camera's own fit so the model is never left out of frame.
        await this._world.camera.fitToItems();
        return;
      }
      this.adaptClipping(box);
      const camera = this._world.camera;
      const controls = camera.controls;
      // Orthographic: camera-controls' fitToBox leaves this camera framing
      // nothing on a fresh load (a blank view, grid included). Frame in
      // perspective and switch back, so the orthographic camera derives its
      // zoom from that position — what a manual Perspective → Orthographic
      // switch does, and that works.
      const wasOrtho = camera.projection.current !== 'Perspective';
      if (wasOrtho) camera.projection.set('Perspective');
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const position = new THREE.Vector3();
      const target = new THREE.Vector3();
      controls.getPosition(position);
      controls.getTarget(target);
      const dir = direction?.clone() ?? position.clone().sub(target);
      if (dir.lengthSq() < 1e-9) dir.set(1, 0.7, 1);
      dir.normalize();
      const halfFov = THREE.MathUtils.degToRad(camera.threePersp.fov) / 2;
      const distance = (sphere.radius / Math.sin(halfFov)) * 1.05;
      const c = sphere.center;
      await controls.setLookAt(c.x + dir.x * distance, c.y + dir.y * distance, c.z + dir.z * distance, c.x, c.y, c.z, wasOrtho ? false : transition);
      if (wasOrtho) camera.projection.set('Orthographic');
      // The first fit of the whole model after a start (or a scene switch) brings back the camera saved with the scene.
      if (!modelIdMap) await this.applySavedCamera();
    } catch (e) {
      console.warn('ViewerEngine: fit failed', e);
    }
  }

  /** Puts the whole building back together: everything visible (Hider) and
      the camera fitted to the full model (BoundingBoxer). */
  async restoreAssembled() {
    await this.hider.set(true);
    this.onExternalVisibilityChange.trigger();
    // No animation: this can run while the viewer is off-screen (models are
    // imported from the Inputs tab), where a transition never converges.
    await this.fit(undefined, false, new THREE.Vector3(1, 0.7, 1));
    this.fitShadowCatcherToScene();
  }

  // ---- Settings-menu toggles ----
  setPostproductionEnabled(enabled: boolean) {
    if (!this._world?.renderer) return;
    this._world.renderer.postproduction.enabled = enabled;
  }

  setEdgeLinesEnabled(enabled: boolean) {
    if (!this._world?.renderer?.postproduction) return;
    this._world.renderer.postproduction.edgesPass.enabled = enabled;
  }

  private aoWanted = true;
  setAmbientOcclusionEnabled(enabled: boolean) {
    this.aoWanted = enabled;
    if (!this._world?.renderer?.postproduction) return;
    // AO shades see-through surfaces as if solid: off while X-ray is on.
    this._world.renderer.postproduction.aoPass.enabled = enabled && !this.xray;
  }

  // ---- X-ray ------------------------------------------------------------------
  private xray = false;
  readonly onXrayChange = new OBC.Event<boolean>();

  isXray() {
    return this.xray;
  }

  /** X-ray: the model see-through (both views), the selection and other
      highlights still solid. */
  setXray(on: boolean) {
    if (this.xray === on) return;
    this.xray = on;
    if (this.fragments) applyXray(this.fragments.core.models.materials.list.values(), on);
    this.setAmbientOcclusionEnabled(this.aoWanted);
    this._secondary?.setXray(on);
    this.onXrayChange.trigger(on);
    void this.forceUpdate();
  }

  // ---- Outliner and styled section cuts (ClipStyler) -----------------
  private sectionCfg: SectionStyle = { ...DEFAULT_SECTION_STYLE };

  /** Outlines the selection (a line and a tinted fill), or stops. */
  setOutline(partial: Partial<OutlineSettings> | undefined) {
    const world = this._world;
    if (!world) return;
    const cfg = { ...DEFAULT_OUTLINE, ...partial };
    try {
      const outliner = this.components.get(OBCF.Outliner);
      outliner.world = world;
      outliner.color = new THREE.Color(cfg.color);
      outliner.fillColor = new THREE.Color(this.selectionColor); // one selection colour: the tint matches the highlight
      outliner.fillOpacity = cfg.fillOpacity;
      outliner.thickness = cfg.thickness;
      if (cfg.enabled) {
        outliner.enabled = true;
        if (!outliner.styles.has('select')) outliner.styles.add('select');
      } else {
        outliner.styles.delete('select');
        outliner.clean();
        outliner.enabled = false;
      }
    } catch (e) {
      console.warn('ViewerEngine: outline failed', e);
    }
    void this.forceUpdate();
  }

  /** Outlines these items in a named group of their own (colour, fill, width),
      e.g. a search set or the clashes of a test, next to the selection outline. */
  async outlineItems(map: OBC.ModelIdMap, group: string, config: { color?: string; fillColor?: string; fillOpacity?: number; thickness?: number } = {}) {
    const outliner = this.components.get(OBCF.Outliner);
    outliner.world = this._world ?? undefined;
    outliner.enabled = true;
    outliner.create(group, {
      color: config.color ? new THREE.Color(config.color) : undefined,
      fillColor: config.fillColor ? new THREE.Color(config.fillColor) : undefined,
      fillOpacity: config.fillOpacity,
      thickness: config.thickness,
    });
    await outliner.addItems(map, group);
    void this.forceUpdate();
  }

  /** Removes the outlines drawn by outlineItems (one group, or all of them). */
  clearOutlines(group?: string) {
    this.components.get(OBCF.Outliner).clean(group);
    void this.forceUpdate();
  }

  /** The cut fill and outline of section planes: one fill, or one colour per kind of element. */
  setSectionStyle(partial: Partial<SectionStyle> | undefined) {
    this.sectionCfg = { ...DEFAULT_SECTION_STYLE, ...partial, categories: { ...DEFAULT_SECTION_STYLE.categories, ...partial?.categories } };
    try {
      this.syncSectionStyles();
      const clipStyler = this.components.get(OBCF.ClipStyler);
      for (const [, edges] of clipStyler.list) {
        edges.items.clear();
        const items = this.sectionItems();
        if (items) for (const [name, item] of Object.entries(items)) edges.items.set(name, item);
        void edges.update();
      }
    } catch (e) {
      console.warn('ViewerEngine: section style failed', e);
    }
    void this.forceUpdate();
  }

  /** Makes (or updates) the ClipStyler styles from the section settings. */
  private syncSectionStyles() {
    const cfg = this.sectionCfg;
    const clipStyler = this.components.get(OBCF.ClipStyler);
    const make = (name: string, fill: string) => {
      const existing = clipStyler.styles.get(name);
      if (existing) {
        existing.linesMaterial?.color.set(cfg.lineColor);
        if (existing.linesMaterial) existing.linesMaterial.linewidth = cfg.lineWidth;
        (existing.fillsMaterial as THREE.MeshBasicMaterial | undefined)?.color.set(fill);
        clipStyler.updateStyle(name);
        return;
      }
      clipStyler.styles.set(name, {
        linesMaterial: new LineMaterial({ color: new THREE.Color(cfg.lineColor).getHex(), linewidth: cfg.lineWidth }),
        fillsMaterial: new THREE.MeshBasicMaterial({ color: fill, side: THREE.DoubleSide }),
      });
    };
    make('Cut:all', cfg.fill);
    for (const def of SECTION_CATEGORY_DEFS) make(`Cut:${def.id}`, cfg.categories[def.id] ?? def.color);
  }

  /** What a cut styles: every kind of element in its colour, grouped by the
      Categories classification; null when section styling is off. */
  private sectionItems(forceByCategory = false): Record<string, { style: string; data?: OBC.ClassifierIntersectionInput }> | null {
    const cfg = this.sectionCfg;
    if (!cfg.enabled && !forceByCategory) return null;
    if (!cfg.byCategory && !forceByCategory) return { All: { style: 'Cut:all' } };
    const groups = [...(this.classifier.list.get(CATEGORIES_CLASSIFICATION)?.keys() ?? [])];
    const items: Record<string, { style: string; data?: OBC.ClassifierIntersectionInput }> = {};
    for (const def of SECTION_CATEGORY_DEFS) {
      const names = groups.filter((g) => def.test.test(g));
      if (names.length) items[def.id] = { style: `Cut:${def.id}`, data: { [CATEGORIES_CLASSIFICATION]: names } };
    }
    return Object.keys(items).length ? items : { All: { style: 'Cut:all' } };
  }

  // ---- Render quality: occlusion, resolution, adaptive resolution -------------
  private adaptive: AdaptiveResolution | null = null;
  private adaptiveWired = false;

  /** Applies the view's quality settings (see renderQuality.ts). */
  setQuality(quality: Partial<RenderQuality> | undefined) {
    const renderer = this._world?.renderer;
    if (!renderer) return;
    const q = { ...DEFAULT_QUALITY, ...quality };
    // An export in progress owns the pixel ratio (setCaptureScale).
    if (this.savedPixelRatio !== null) return;
    this.adaptive = applyRenderQuality(renderer, q, Math.min(window.devicePixelRatio || 1, 2), this.adaptive, EDGE_COLOR);
    if (this.adaptive && !this.adaptiveWired) {
      this.adaptiveWired = true;
      renderer.onAfterUpdate.add(() => this.adaptive?.tick());
    }
    void this.forceUpdate();
  }

  setAntiAliasingEnabled(enabled: boolean) {
    if (!this._world?.renderer?.postproduction) return;
    this._world.renderer.postproduction.smaaEnabled = enabled;
  }

  /** View style — the two official aspects we expose. */
  setStyle(style: ViewerStyle) {
    if (!this._world?.renderer?.postproduction) return;
    this._world.renderer.postproduction.style = OBCF.PostproductionAspect[style];
  }

  getStyle(): ViewerStyle {
    const current = this._world?.renderer?.postproduction.style;
    return (current === undefined ? 'COLOR_PEN_SHADOWS' : OBCF.PostproductionAspect[current]) as ViewerStyle;
  }

  /** Applies one view's display settings to the main viewer. */
  async applyViewSettings(s: ViewSettings) {
    await this.ready;
    this.setProjection(s.projection);
    this.setStyle(s.style);
    this.setAntiAliasingEnabled(s.antiAliasing);
    this.setEdgeLinesEnabled(s.edgeLines);
    this.setAmbientOcclusionEnabled(s.ambientOcclusion);
    this.setEdgeWidth(s.edgeWidth);
    this.setQuality(s.quality);
    this.setOutline(s.outline);
    this.setSectionStyle(s.sectionStyle);
    this.setBackgroundColor(s.background);
    this.setGridVisible(s.grid);
  }

  setProjection(projection: 'Perspective' | 'Orthographic') {
    this._world?.camera.projection.set(projection);
  }

  setEdgeWidth(width: number) {
    if (this._world?.renderer) this._world.renderer.postproduction.edgesPass.width = width;
  }

  setGridVisible(visible: boolean) {
    if (this.grid) this.grid.visible = visible;
  }

  /** A small JPEG of the main view as it is now — a viewpoint's thumbnail.
      Null when the view has no size (hidden or not started). */
  async captureThumbnail(width = 320, height = 180): Promise<Uint8Array | null> {
    const renderer = this._world?.renderer;
    const src = renderer?.three.domElement;
    if (!renderer || !src || !src.width || !src.height) return null;
    await this.forceUpdate();
    // Render then read in the same task, before the buffer is presented.
    renderer.update();
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Cover-crop to the thumbnail's shape, keeping the centre.
    const k = Math.max(width / src.width, height / src.height);
    const sw = width / k;
    const sh = height / k;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  private bgColor = '#f5f6f5';
  setBackgroundColor(hex: string) {
    this.bgColor = hex;
    // A real-time sky replaces the plain background while it is on.
    if (this._world?.scene.three && !this.skyActive) this._world.scene.three.background = new THREE.Color(hex);
  }

  /** Unloads a model: disposes it in the fragments manager (whose delete
      hook drops its index and tells the models store), then clears what this
      engine kept for it. */
  async removeModel(modelId: string) {
    const model = this.models.get(modelId);
    if (!model || !this.fragments) return;
    await this.fragments.core.disposeModel(modelId);
    this.models.delete(modelId);
    this.indexes.delete(modelId);
    this.keptColors.delete(modelId);
    this.keptOpacities.delete(modelId);
    this.viewHidden.delete(modelId);
    this.basePositions.delete(modelId);
    this.gridData.delete(modelId);
    this.storeyData.delete(modelId);
    this.gridGroups.get(modelId)?.removeFromParent();
    this.gridGroups.delete(modelId);
    this.baseHeights.delete(modelId);
    this.slides.delete(modelId);
    await this.fragments.core.update(true);
  }

  // ---- Measure (Length/Area/Angle/Volume) + Section (Clipper/ClipStyler) ----
  private setupMeasurementAndSection(container: HTMLElement) {
    const components = this.components;
    const world = this.world;

    const kinds: [MeasureKind, OBCF.Measurement<any, any>][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      ['length', components.get(OBCF.LengthMeasurement)],
      ['area', components.get(OBCF.AreaMeasurement)],
      ['angle', components.get(OBCF.AngleMeasurement)],
      ['volume', components.get(OBCF.VolumeMeasurement)],
    ];
    // Measurements / section planes added or removed: the Clear buttons follow.
    const changed = () => this.onToolContentChange.trigger();
    for (const [kind, m] of kinds) {
      m.world = world;
      m.enabled = false;
      // The volume tool's default colour is white, which made its label white text on a white box.
      if (kind === 'volume') m.color = new THREE.Color('#6528d7');
      this.measurements.set(kind, m);
      m.list.onItemAdded.add(changed);
      m.list.onItemDeleted.add(changed);
      m.list.onCleared.add(changed);
    }

    const clipper = this.clipper;
    clipper.enabled = false;
    clipper.list.onItemSet.add(changed);
    clipper.list.onItemDeleted.add(changed);
    clipper.list.onCleared.add(changed);
    const clipStyler = components.get(OBCF.ClipStyler);
    clipper.onAfterCreate.add((plane) => {
      for (const [id, p] of clipper.list) {
        if (p === plane) clipStyler.createFromClipping(id, { world, link: true, items: this.sectionItems() ?? undefined });
      }
    });

    this.pointMarks = new PointMarks(world, () => this.globalOffset());

    this.onDblClick = () => {
      const m = this.activeMeasurement();
      if (m) void m.create();
      else if (this.activeTool === 'point') void this.pickPoint();
      else if (this.activeTool === 'section') void clipper.create(world);
    };
    container.addEventListener('dblclick', this.onDblClick);

    this.setupBoxSelect(container);

    this.onKeyDown = (e: KeyboardEvent) => {
      const m = this.activeMeasurement();
      if (m) {
        if (e.code === 'Escape') m.cancelCreation();
        if (e.code === 'Delete' || e.code === 'Backspace') m.delete();
      } else if (this.activeTool === 'point') {
        if (e.code === 'Delete' || e.code === 'Backspace') {
          this.pointMarks?.removeLast();
          this.onToolContentChange.trigger();
        }
      } else if (this.activeTool === 'section') {
        if (e.code === 'Delete' || e.code === 'Backspace') clipper.delete(world);
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  private pointMarks: PointMarks | null = null;

  /** Point coordinates tool: marks the point under the cursor (snapping to a
      vertex when one is near), writes its X / Y / Z in the view and copies
      it. Returns the coordinates text, or null when nothing is under the cursor. */
  private async pickPoint(): Promise<string | null> {
    const caster = this.components.get(OBC.Raycasters).get(this.world);
    const hit = (await caster.castRay({ snappingClasses: [FRAGS.SnappingClass.POINT] })) ?? (await caster.castRay());
    if (!hit || !this.pointMarks) return null;
    this.pointMarks.add(hit.point);
    this.onToolContentChange.trigger();
    const text = formatCoords(hit.point, this.globalOffset());
    void copyText(text);
    return text;
  }

  /** Waits for one double-click in the view and gives the point under it (snapping to a vertex when one is near)
      in project axes (X east, Y north, Z up, metres); null on Escape or when nothing is under the cursor. */
  pickProjectPoint(): Promise<{ x: number; y: number; z: number } | null> {
    const container = this.container;
    if (!container || !this._world) return Promise.resolve(null);
    return new Promise((resolve) => {
      container.classList.add('picking-point');
      const finish = (v: { x: number; y: number; z: number } | null) => {
        container.removeEventListener('dblclick', onDbl, true);
        window.removeEventListener('keydown', onKey, true);
        container.classList.remove('picking-point');
        resolve(v);
      };
      const onDbl = async (e: Event) => {
        e.stopPropagation();
        const caster = this.components.get(OBC.Raycasters).get(this.world);
        const hit = (await caster.castRay({ snappingClasses: [FRAGS.SnappingClass.POINT] })) ?? (await caster.castRay());
        finish(hit ? projectCoords(hit.point, this.globalOffset()) : null);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Escape') finish(null);
      };
      container.addEventListener('dblclick', onDbl, true);
      window.addEventListener('keydown', onKey, true);
    });
  }

  private activeMeasurement(): OBCF.Measurement<any, any> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = this.activeTool;
    return t === 'length' || t === 'area' || t === 'angle' || t === 'volume' ? this.measurements.get(t) ?? null : null;
  }

  getActiveTool() {
    return this.activeTool;
  }

  /** One double-click tool armed at a time; the Highlighter is paused while
      one is, so clicks used to place points don't also change the selection. */
  setActiveTool(tool: ViewerTool) {
    this.activeTool = tool;
    for (const [kind, m] of this.measurements) m.enabled = tool === kind;
    this.clipper.enabled = tool === 'section';
    this.highlighter.enabled = tool === 'select';
    // Box select drags a rectangle: the camera mustn't orbit meanwhile.
    this.world.camera.controls.enabled = tool !== 'box';
    if (this.container) this.container.style.cursor = tool === 'box' ? 'crosshair' : '';
    this._secondary?.setBoxTool(tool === 'box');
  }

  // ---- What the user hid (Hide / Isolate / IFC types; Show all clears it) ----
  // The 4D timeline drives visibility too: it keeps these hidden rather than
  // showing them again on its next step (see isUserHidden).
  private userHidden = new Map<string, Set<number>>();
  /** After a "hide everything" (Isolate's first step): only these are shown. */
  private userOnly: Map<string, Set<number>> | null = null;

  private noteUserVisibility(visible: boolean, modelIdMap?: OBC.ModelIdMap) {
    if (!modelIdMap) {
      this.userHidden.clear();
      this.userOnly = visible ? null : new Map();
      return;
    }
    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      const hidden = this.userHidden.get(modelId) ?? this.userHidden.set(modelId, new Set()).get(modelId)!;
      const only = this.userOnly ? this.userOnly.get(modelId) ?? this.userOnly.set(modelId, new Set()).get(modelId)! : null;
      for (const id of ids) {
        if (visible) {
          hidden.delete(id);
          only?.add(id);
        } else {
          hidden.add(id);
          only?.delete(id);
        }
      }
    }
  }

  /** Hidden by the user (Hide, Isolate, IFC element types) until Show all. */
  isUserHidden(modelId: string, localId: number): boolean {
    if (this.userHidden.get(modelId)?.has(localId)) return true;
    return !!this.userOnly && !this.userOnly.get(modelId)?.has(localId);
  }

  /** Of `localIds`, those shown in the main view now (not hidden by Hide / Isolate / the 4D timeline). */
  async visibleOf(modelId: string, localIds: number[]): Promise<number[]> {
    const model = this.models.get(modelId);
    if (!model || this.viewHidden.has(modelId) || !localIds.length) return [];
    const shown = await model.getVisible(localIds);
    return localIds.filter((_, i) => shown[i]);
  }

  /** The visible element under a client-pixel point in the main view, or null. */
  async elementAt(clientX: number, clientY: number): Promise<{ modelId: string; localId: number } | null> {
    const dom = this.world.renderer?.three.domElement;
    if (!dom || !this.fragments) return null;
    const hit = await this.fragments.raycast({ camera: this.world.camera.three, mouse: new THREE.Vector2(clientX, clientY), dom });
    if (!hit) return null;
    // An edited model (storey slide) draws through its delta model.
    let modelId = hit.fragments.modelId;
    if (!this.models.has(modelId)) for (const [id, m] of this.models) if (m.deltaModelId === modelId) modelId = id;
    const model = this.models.get(modelId);
    if (!model || !this.indexes.get(modelId)?.elements.has(hit.localId)) return null;
    const [shown] = await model.getVisible([hit.localId]);
    return shown ? { modelId, localId: hit.localId } : null;
  }

  // ---- Box select ------------------------------------------------------------

  private removeBoxSelect: (() => void) | null = null;

  /** Box select on this view (see boxSelect.ts); the split's second view has its own. */
  private setupBoxSelect(container: HTMLElement) {
    this.removeBoxSelect = attachBoxSelect(
      container,
      () => this.activeTool === 'box',
      (a, b, fullyIncluded, additive) => void this.selectInRectangle(a, b, fullyIncluded, additive),
      (additive) => { if (!additive) void this.applySelection({}, false); },
    );
  }

  /** Selects the visible objects in a screen rectangle (client pixels):
      those fully inside it, or every one it touches. */
  async selectInRectangle(a: { x: number; y: number }, b: { x: number; y: number }, fullyIncluded: boolean, additive = false) {
    const dom = this.world.renderer?.three.domElement;
    if (!dom || !this.fragments) return;
    const data = {
      camera: this.world.camera.three,
      dom,
      topLeft: new THREE.Vector2(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      bottomRight: new THREE.Vector2(Math.max(a.x, b.x), Math.max(a.y, b.y)),
      fullyIncluded,
    };
    const map: OBC.ModelIdMap = {};
    for (const [modelId, model] of this.models) {
      if (this.viewHidden.has(modelId)) continue;
      const index = this.indexes.get(modelId);
      const found = new Set<number>();
      for (const m of this.renderTargets(model)) {
        if (!m.object.visible) continue;
        const hit = await m.rectangleRaycast(data);
        for (const id of hit?.localIds ?? []) if (!index || index.elements.has(id)) found.add(id);
      }
      if (!found.size) continue;
      // Hidden objects (Hide / Isolate / the 4D timeline) are not picked.
      const ids = [...found];
      const shown = await model.getVisible(ids);
      const visible = ids.filter((_, i) => shown[i]);
      if (visible.length) map[modelId] = new Set(visible);
    }
    await this.applySelection(map, additive);
  }

  /** Makes `map` the selection (or adds it), whichever tool is on — for
      picks made outside the Highlighter (box select, the second view). */
  async applySelection(map: OBC.ModelIdMap, additive: boolean) {
    if (OBC.ModelIdMapUtils.isEmpty(map)) {
      if (!additive) await this.withHighlighter((h) => h.clear('select'));
    } else {
      await this.withHighlighter((h) => h.highlightByID('select', map, !additive, false));
    }
  }

  /** The Highlighter is paused while a tool other than Select is on (see
      setActiveTool) and then ignores requests: let this one through. */
  private async withHighlighter(fn: (h: OBCF.Highlighter) => Promise<unknown>) {
    const highlighter = this.highlighter;
    const paused = !highlighter.enabled;
    highlighter.enabled = true;
    try {
      await fn(highlighter);
    } finally {
      if (paused && this.activeTool !== 'select') highlighter.enabled = false;
    }
  }

  /** Fired when measurements or section planes are added or removed. */
  readonly onToolContentChange = new OBC.Event<void>();

  hasMeasurements() {
    return [...this.measurements.values()].some((m) => m.list.size > 0) || (this.pointMarks?.size ?? 0) > 0;
  }

  hasSections() {
    return this.clipper.list.size > 0;
  }

  clearMeasurements() {
    this.pointMarks?.clear();
    for (const m of this.measurements.values()) {
      m.list.clear();
      m.lines.clear();
      m.fills.clear();
      m.labels.clear();
      m.volumes.clear();
    }
    this.onToolContentChange.trigger();
  }

  /** The way a measurement is taken (length: free / edge; area: free /
      square / face), as the library offers it. */
  setMeasureMode(kind: MeasureKind, mode: string) {
    const m = this.measurements.get(kind) as unknown as { modes?: string[]; mode: string } | undefined;
    if (m && (!m.modes || m.modes.includes(mode))) m.mode = mode;
  }

  private sectionsOn = true;

  /** Section planes cut the model (off: the planes stay, but don't cut). */
  get sectionsActive() {
    return this.sectionsOn;
  }

  setSectionsActive(on: boolean) {
    this.sectionsOn = on;
    for (const [id, plane] of this.clipper.list) {
      plane.enabled = on && !this.previewPlaneIds.has(id);
      plane.visible = on && this.clipper.visible;
    }
    this.onToolContentChange.trigger();
  }

  /** The section planes' handles (the planes themselves) shown in the view. */
  get sectionHandlesVisible() {
    return this.clipper.visible;
  }

  setSectionHandlesVisible(visible: boolean) {
    this.clipper.visible = visible;
    this.onToolContentChange.trigger();
  }

  clearSections() {
    this.clipper.deleteAll();
    this.cutPlaneIds = [];
    useSectionCutsStore.getState().clearAll();
    this.onToolContentChange.trigger();
  }

  // ---- Section cuts (Views > Section cuts): a cut along a gridline and a cut at a level ----
  private cutPlaneIds: string[] = [];
  /** Cut planes shown as a sheet only (the cut switched off). */
  private previewPlaneIds = new Set<string>();
  private cutChain: Promise<void> = Promise.resolve();

  /** What the cuts can name: the gridlines' tags and the storeys, from the loaded models (first one wins on a repeat). */
  sectionCutOptions(): { grids: { name: string; family: 'U' | 'V' | 'W' }[]; storeys: { name: string; elevation: number }[] } {
    const grids = new Map<string, 'U' | 'V' | 'W'>();
    for (const list of this.gridData.values()) for (const g of list) for (const a of g.axes) if (a.tag && !grids.has(a.tag)) grids.set(a.tag, a.family);
    const storeys = new Map<string, number>();
    for (const list of this.storeyData.values()) for (const st of list) if (st.name && st.elevation !== null && !storeys.has(st.name)) storeys.set(st.name, st.elevation);
    return {
      grids: [...grids].map(([name, family]) => ({ name, family })).sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name, undefined, { numeric: true })),
      storeys: [...storeys].map(([name, elevation]) => ({ name, elevation })).sort((a, b) => a.elevation - b.elevation),
    };
  }

  /** Draws the cuts as clipping planes (replacing the ones it drew before). A name the loaded models do not have draws nothing. */
  applySectionCuts(cuts: SectionCuts): Promise<void> {
    this.cutChain = this.cutChain.then(async () => {
      const world = this._world;
      if (!world) return;
      for (const id of this.cutPlaneIds) await this.clipper.delete(world, id);
      this.cutPlaneIds = [];
      this.previewPlaneIds.clear();
      const g = this.globalOffset();
      const planes: { plane: ReturnType<typeof gridCutPlane>; cut: boolean }[] = [];
      if (cuts.grid.name) {
        const axis = [...this.gridData.values()].flatMap((list) => list.flatMap((grid) => grid.axes)).find((a) => a.tag === cuts.grid.name);
        const first = axis?.points[0];
        const last = axis?.points[axis.points.length - 1];
        planes.push({ plane: first && last ? gridCutPlane(first, last, cuts.grid.offset, cuts.grid.flip) : null, cut: cuts.grid.cut });
      }
      if (cuts.level.name) {
        const storey = [...this.storeyData.values()].flatMap((list) => list).find((st) => st.name === cuts.level.name && st.elevation !== null);
        planes.push({ plane: storey ? levelCutPlane(storey.elevation!, cuts.level.offset, cuts.level.flip) : null, cut: cuts.level.cut });
      }
      for (const { plane, cut } of planes) {
        if (!plane) continue;
        const scene = planeToScene(plane, g);
        const id = this.clipper.createFromNormalAndCoplanarPoint(world, new THREE.Vector3(...scene.normal), new THREE.Vector3(...scene.point));
        const simple = this.clipper.list.get(id);
        if (simple) {
          simple.enabled = cut && this.sectionsOn;
          simple.visible = this.clipper.visible;
        }
        if (!cut) this.previewPlaneIds.add(id);
        this.cutPlaneIds.push(id);
      }
      this.onToolContentChange.trigger();
    });
    return this.cutChain;
  }

  dispose() {
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown);
    if (this.onDblClick) this.container?.removeEventListener('dblclick', this.onDblClick);
    this.removeBoxSelect?.();
    this._flythrough?.dispose();
    this._flythrough = null;
    this._walkthrough?.dispose();
    this._walkthrough = null;
    this._components?.dispose();
    this._components = null;
    this._world = null;
    this.fragments = null;
    this.ifcLoader = null;
    this.measurements.clear();
    this.onDblClick = null;
    this.onKeyDown = null;
    this.models.clear();
  }
}

function getVal(attr: unknown): unknown {
  if (attr && typeof attr === 'object' && 'value' in (attr as Record<string, unknown>)) {
    return (attr as { value: unknown }).value;
  }
  return undefined;
}

/** Property sets (Pset_*) hold their values in a "NominalValue" attribute;
    quantity sets (Qto_*) instead use a type-specific one (LengthValue,
    AreaValue, VolumeValue, CountValue, WeightValue...) — scanning for any
    "*Value" attribute covers both without needing to know which relation
    name (HasProperties vs Quantities) the loader used for this IFC schema. */
function findLeafValue(entry: FRAGS.ItemData): unknown {
  for (const [key, val] of Object.entries(entry)) {
    if (key.endsWith('Value')) {
      const v = getVal(val);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function flattenItem(localId: number, item: FRAGS.ItemData, fileName: string): ElementSummary {
  const props: Record<string, unknown> = {};
  const name = (getVal(item.Name) as string) ?? '';
  const category = (getVal(item._category) as string) ?? '';
  const guid = (getVal(item._guid) as string) ?? '';
  const description = String(getVal(item.Description) ?? '');

  const rels = item.IsDefinedBy;
  if (Array.isArray(rels)) {
    for (const setItem of rels as FRAGS.ItemData[]) {
      const setName = getVal(setItem.Name) as string | undefined;
      if (!setName) continue;
      for (const [key, value] of Object.entries(setItem)) {
        if (key === 'Name' || key.startsWith('_') || !Array.isArray(value)) continue;
        for (const entry of value as FRAGS.ItemData[]) {
          const entryName = getVal(entry.Name) as string | undefined;
          const entryVal = findLeafValue(entry);
          if (entryName !== undefined && entryVal !== undefined) {
            props[`${setName}.${entryName}`] = entryVal;
          }
        }
      }
    }
  }

  return { localId, guid, name, category, description, fileName, props };
}

async function getGeometryLocalIds(model: FRAGS.FragmentsModel): Promise<number[]> {
  const items = await model.getItemsWithGeometry();
  const ids = await Promise.all(items.map((it) => it.getLocalId()));
  return ids.filter((id): id is number => id !== null);
}

function toTreeNode(item: FRAGS.SpatialTreeItem): ModelTreeNode {
  return {
    category: item.category ?? 'Item',
    localId: item.localId,
    children: (item.children ?? []).map(toTreeNode),
  };
}

/** Names for every spatial node and element — the tree shows "Level 1", not
    "IFCBUILDINGSTOREY 214". */
async function collectNames(model: FRAGS.FragmentsModel, tree: ModelTreeNode, elements: ElementSummary[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  for (const e of elements) names.set(e.localId, e.name);
  const spatialIds: number[] = [];
  const walk = (node: ModelTreeNode) => {
    if (node.localId !== null && !names.has(node.localId)) spatialIds.push(node.localId);
    node.children.forEach(walk);
  };
  walk(tree);
  const CHUNK = 500;
  for (let i = 0; i < spatialIds.length; i += CHUNK) {
    const chunk = spatialIds.slice(i, i + CHUNK);
    const data = await model.getItemsData(chunk, { attributesDefault: true });
    data.forEach((item, idx) => names.set(chunk[idx], String(getVal(item.Name) ?? '')));
  }
  return names;
}
