import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';
import type { ViewSettings } from '../state/viewSettingsStore';
import { renderTargets, slideStoreys, type BaseHeights, type Storey } from './storeySlide';
import { NavCube } from './navCube';
import { NorthArrow } from './northArrow';
import { attachBoxSelect, type ScreenPoint } from './boxSelect';
import { classNumberForPainted } from './materialClasses';
import { configureSun, markBaseMaterials, newConcreteUniforms, patchAllConcrete, refreshMaterialClasses, setConcreteStrength, setSkyUniforms, skyParamsFor, type RealismSettings, type SunLights } from './realism';
import { SkyBackdrop } from './skyBackdrop';
import { DEFAULT_QUALITY, applyRenderQuality, type AdaptiveResolution } from './renderQuality';
import { applyXray } from './xray';
import { hideFadedFromEdges } from './ghostEdges';

/** Ghost mode's look (as the main view's Highlighter "ghost" style). */
const GHOST_OPACITY = 0.12;
const GHOST_COLOR = new THREE.Color('#64748b');

type World = OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>;

const EDGE_COLOR = '#2a2a2a';

/** A second, independent 3D view of the models the main viewer holds.
    It has its own world (scene, camera, renderer) and its own copy of every
    model. Its look (camera, style, edges, occlusion, anti-aliasing,
    background, grid) is its own setting, see apply(). The models are loaded
    through a separate FragmentsModels instance — colours, visibility and
    opacity live on the model, so two views can only differ if they don't
    share one. That doubles GPU memory for the loaded models
    while the split is open; dispose() gives it back. Model ids are the main
    viewer's, so the 4D driver addresses both views the same way. */
export class SecondaryView {
  private copies = new Map<string, FRAGS.FragmentsModel>();
  private linked = true;
  private syncing = false;
  private removeLinks: (() => void) | null = null;
  /** Which view drives the other while linked (the last one handled). */
  private driver: 'main' | 'mine' = 'main';
  private disposed = false;
  private cube: NavCube | null = null;
  private north: NorthArrow | null = null;
  private grid: OBC.SimpleGrid | null = null;
  /** Called if this view's own WebGL context is lost (the split then closes itself). */
  onContextLost: (() => void) | null = null;

  private constructor(
    private readonly engine: ViewerEngine,
    private readonly world: World,
    private readonly core: FRAGS.FragmentsModels,
  ) {}

  static async create(engine: ViewerEngine, container: HTMLElement): Promise<SecondaryView> {
    const source = engine.getSecondaryViewSource();
    const components = engine.components;

    const world = components.get(OBC.Worlds).create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBCF.PostproductionRenderer(components, container);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.scene.setup();
    const scene = world.scene.three;
    scene.background = new THREE.Color('#f5f6f5');
    const hemi = new THREE.HemisphereLight('#ffffff', '#c7cdd3', 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight('#ffffff', 2.2);
    dir.position.set(12, 20, 8);
    scene.add(dir);
    scene.add(dir.target);
    const fill = new THREE.DirectionalLight('#dbe6ff', 0.4);
    fill.position.set(-10, 8, -12);
    scene.add(fill);
    // Sun & shadows (the realistic look, when this view's settings ask for it).
    world.renderer.three.shadowMap.enabled = true;
    world.renderer.three.shadowMap.type = THREE.PCFSoftShadowMap;
    dir.shadow.mapSize.set(4096, 4096);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShadowMaterial({ opacity: 0.4 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    catcher.visible = false;
    scene.add(catcher);

    // Same pipeline as the main view; each switch is set from apply().
    const post = world.renderer.postproduction;
    post.enabled = true;
    post.outlinesEnabled = true;
    post.glossEnabled = false;
    post.edgesPass.color = new THREE.Color(EDGE_COLOR);
    post.excludedObjectsEnabled = true;
    post.aoPass.updateGtaoMaterial({
      radius: 0.4, distanceExponent: 2, thickness: 2, scale: 0.85, samples: 24, distanceFallOff: 1, screenSpaceRadius: true,
    });

    // The edge pass would outline every grid line; hide the grid from it (as the main view does).
    const grid = components.get(OBC.Grids).create(world);
    const edges = post.edgesPass;
    const renderEdges = edges.render.bind(edges);
    let viewRef: SecondaryView | null = null;
    edges.render = (renderer, writeBuffer, readBuffer) => {
      const visible = grid.three.visible;
      const catcherVisible = catcher.visible;
      grid.three.visible = false;
      catcher.visible = false;
      // Ghosted objects get no edges (as in the main view's Ghost mode).
      const restoreGhosts = viewRef?.hideGhostTiles();
      renderEdges(renderer, writeBuffer, readBuffer);
      restoreGhosts?.();
      grid.three.visible = visible;
      catcher.visible = catcherVisible;
    };

    const core = new FRAGS.FragmentsModels(source.workerUrl);
    core.settings.autoCoordinate = source.autoCoordinate;
    // The edge and AO passes find their tiles through the app's one
    // FragmentsManager, i.e. the main view's models. Here that meant the edge
    // capture never swapped this view's tiles to their per-element ID colours
    // (edges came from shading instead) — point both at this view's models.
    const own = { initialized: true, core };
    (post.edgesPass as unknown as { _fragments: unknown })._fragments = own;
    (post.aoPass as unknown as { _fragments: unknown })._fragments = own;
    const view = new SecondaryView(engine, world, core);
    viewRef = view;
    view.grid = grid;
    view.lights = { sun: dir, hemi, fill };
    view.catcher = catcher;
    core.models.materials.list.onItemSet.add(({ value: material }) => {
      if (!('isLodMaterial' in material && material.isLodMaterial)) {
        const painted = 'color' in material && classNumberForPainted(material.color as THREE.Color) > 0;
        if (view.concrete || painted) patchAllConcrete([material], view.concreteUniforms);
        if (painted) refreshMaterialClasses([material]);
        material.polygonOffset = true;
        material.polygonOffsetUnits = 1;
        material.polygonOffsetFactor = Math.random();
      }
    });
    // Section planes: the main view's cut this one too (same planes, same place).
    const mainRenderer = engine.world.renderer!;
    const syncPlanes = () => {
      if (view.world.renderer) view.world.renderer.three.clippingPlanes = [...mainRenderer.three.clippingPlanes];
    };
    mainRenderer.onClippingPlanesUpdated.add(syncPlanes);
    syncPlanes();
    const removeBox = attachBoxSelect(
      container,
      () => view.boxTool,
      (a, b, fullyIncluded, additive) => void view.selectInRectangle(a, b, fullyIncluded, additive),
      (additive) => { if (!additive) void engine.applySelection({}, false); },
    );
    view.removeExtras = () => {
      mainRenderer.onClippingPlanesUpdated.remove(syncPlanes);
      removeBox();
    };
    world.camera.controls.addEventListener('update', () => core.update());
    const onProjection = (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) => {
      for (const model of view.copies.values()) model.useCamera(camera);
      post.updateCamera();
      void core.update(true);
    };
    world.camera.projection.onChanged.add(onProjection);
    world.renderer.three.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      view.onContextLost?.();
    });
    view.linkCameras();
    view.linkSelection();
    view.addViewCube(container);
    view.copyCameraFromMain();
    view.setBoxTool(engine.getActiveTool() === 'box');
    await view.syncModels();
    await view.showSelection(engine.highlighter.selection.select);
    await view.showGhost(engine.getGhosted());
    if (engine.isXray()) view.setXray(true);
    return view;
  }

  /** Make the copies match the main viewer's models: load ones that appeared,
      drop ones that were disposed. */
  syncModels(): Promise<void> {
    // One at a time: two overlapping runs would both load a new model.
    const run = () => this.syncModelsNow();
    this.syncQueue = this.syncQueue.then(run, run);
    return this.syncQueue;
  }

  private syncQueue: Promise<void> = Promise.resolve();

  private async syncModelsNow() {
    if (this.disposed) return;
    const source = this.engine.getSecondaryViewSource();
    const wanted = new Set(source.modelIds);
    let changed = false;

    for (const [id, copy] of this.copies) {
      if (wanted.has(id)) continue;
      changed = true;
      this.copies.delete(id);
      this.world.scene.three.remove(copy.object);
      await this.core.disposeModel(id);
    }

    for (const id of wanted) {
      if (this.copies.has(id)) continue;
      const original = source.getModel(id);
      if (!original) continue;
      const buffer = await original.getBuffer(false);
      if (this.disposed) return;
      const copy = await this.core.load(buffer, { modelId: id, camera: this.world.camera.three });
      copy.object.position.copy(original.object.position);
      copy.object.quaternion.copy(original.object.quaternion);
      copy.object.scale.copy(original.object.scale);
      // The model's own materials, before any 4D colour: the concrete look greys only these.
      markBaseMaterials(this.core.models.materials.list.values());
      if (this.concrete) patchAllConcrete(this.core.models.materials.list.values(), this.concreteUniforms);
      if (this.xray) applyXray(this.core.models.materials.list.values(), true);
      // Tiles stream in and out as the camera moves: flag each for shadows.
      for (const m of renderTargets(this.core, copy)) {
        const flag = (mesh: THREE.Object3D) => { mesh.castShadow = true; mesh.receiveShadow = true; };
        m.tiles.forEach((mesh) => flag(mesh));
        m.tiles.onItemSet.add(({ value }) => flag(value));
      }
      this.world.scene.three.add(copy.object);
      this.copies.set(id, copy);
      const step = this.slides.get(id) ?? 0;
      if (step !== 0) await this.applySlide(id, step);
      changed = true;
    }
    if (changed) {
      this.applyHidden();
      this.updateSun();
      const selected = this.selected;
      this.selected = {};
      await this.showSelection(selected);
    }
  }

  /** Models this view leaves out (see ViewerEngine.setViewHiddenModels). */
  private hidden = new Set<string>();

  setHiddenModels(modelIds: Iterable<string>) {
    if (this.disposed) return;
    this.hidden = new Set(modelIds);
    this.applyHidden();
    void this.core.update(true);
  }

  private applyHidden() {
    for (const [id, copy] of this.copies) {
      const shown = !this.hidden.has(id);
      for (const m of renderTargets(this.core, copy)) m.object.visible = shown;
    }
  }

  private baseHeights = new Map<string, BaseHeights>();
  /** This view's own storey slide per model (independent of the main view). */
  private slides = new Map<string, number>();

  getStoreySlide(modelId: string) {
    return this.slides.get(modelId) ?? 0;
  }

  /** Storey slide for this view only (see ViewerEngine.setStoreySlide). A
      model not copied yet gets it once it loads. */
  async setStoreySlide(modelId: string, step: number) {
    if (this.disposed || (this.slides.get(modelId) ?? 0) === step) return;
    this.slides.set(modelId, step);
    if (!this.copies.has(modelId)) return;
    await this.applySlide(modelId, step);
    await this.core.update(true);
    // The 4D driver's overrides now sit on different render models.
    this.engine.onExternalVisibilityChange.trigger();
  }

  private async applySlide(modelId: string, step: number) {
    const bases = this.baseHeights.get(modelId) ?? new Map<number, number>();
    this.baseHeights.set(modelId, bases);
    await slideStoreys(this.core, modelId, this.engine.getStoreys(modelId) as Storey[], step, bases);
    this.applyHidden();
  }

  /** Mirrors a model move made in the main viewer. */
  setModelPosition(modelId: string, position: THREE.Vector3, quaternion: THREE.Quaternion) {
    const copy = this.copies.get(modelId);
    if (!copy || this.disposed) return;
    copy.object.position.copy(position);
    copy.object.quaternion.copy(quaternion);
    copy.object.updateMatrixWorld(true);
    void this.core.update(true);
  }

  // ---- look -----------------------------------------------------------------

  /** Applies this view's display settings. */
  apply(s: ViewSettings) {
    const renderer = this.world.renderer;
    if (this.disposed || !renderer) return;
    const post = renderer.postproduction;
    this.world.camera.projection.set(s.projection);
    post.style = OBCF.PostproductionAspect[s.style];
    post.smaaEnabled = s.antiAliasing;
    post.edgesPass.enabled = s.edgeLines;
    post.edgesPass.width = s.edgeWidth;
    this.applyQuality(s);
    this.aoWanted = s.ambientOcclusion;
    post.aoPass.enabled = s.ambientOcclusion && !this.xray;
    this.bgColor = s.background;
    if (!this.skyActive) this.world.scene.three.background = new THREE.Color(s.background);
    if (this.grid) this.grid.visible = s.grid;
    // A projection change resizes this view's frustum once it settles; match
    // the main view's scale again afterwards.
    if (this.linked) setTimeout(() => { if (!this.disposed && this.linked) this.copyCameraFromMain(); }, 60);
  }

  private adaptive: AdaptiveResolution | null = null;
  private adaptiveWired = false;
  private pixelRatioHeld = false;

  /** This view's own render quality (occlusion, resolution, edge colour). */
  private applyQuality(s: ViewSettings) {
    const renderer = this.world.renderer;
    if (!renderer || this.pixelRatioHeld) return;
    const q = { ...DEFAULT_QUALITY, ...s.quality };
    this.adaptive = applyRenderQuality(renderer, q, Math.min(window.devicePixelRatio || 1, 2), this.adaptive, EDGE_COLOR);
    if (this.adaptive && !this.adaptiveWired) {
      this.adaptiveWired = true;
      renderer.onAfterUpdate.add(() => this.adaptive?.tick());
    }
  }

  private lights: SunLights | null = null;
  private catcher: THREE.Mesh | null = null;
  private realism: RealismSettings | null = null;
  private concrete: RealismSettings | null = null;
  readonly concreteUniforms = newConcreteUniforms();
  private bgColor = '#f5f6f5';
  private sky: SkyBackdrop | null = null;
  private skyActive = false;

  /** This view's sky backdrop and the sky its shiny materials reflect. */
  setSky(on: boolean, settings: RealismSettings) {
    if (this.disposed) return;
    this.skyActive = on;
    const params = skyParamsFor(settings.sunAzimuth, settings.sunElevation);
    setSkyUniforms(params, this.concreteUniforms);
    const renderer = this.world.renderer?.three;
    const scene = this.world.scene.three;
    if (!renderer) return;
    if (on) {
      this.sky ??= new SkyBackdrop();
      this.sky.update(renderer, params);
      scene.background = this.sky.texture;
    } else {
      scene.background = new THREE.Color(this.bgColor);
    }
    void this.core.update(true);
  }

  /** This view's sun & shadows (the realistic look), or none. */
  setRealism(settings: RealismSettings | null) {
    if (this.disposed) return;
    this.realism = settings;
    this.updateSun();
  }

  private updateSun() {
    if (!this.lights || !this.catcher) return;
    const on = !!this.realism;
    const box = on ? this.engine.modelsBox() : null;
    configureSun(this.lights, this.realism, box);
    this.lights.sun.castShadow = on;
    this.lights.sun.shadow.needsUpdate = true;
    this.catcher.visible = on;
    if (box) this.catcher.position.y = box.min.y - 0.05;
    void this.core.update(true);
  }

  /** This view's concrete surface, or none (its own strength, not the main view's). */
  setConcrete(settings: RealismSettings | null) {
    if (this.disposed) return;
    this.concrete = settings;
    setConcreteStrength(settings ? settings.concrete : 0, settings ? settings.concreteColor : 0, this.concreteUniforms);
    if (settings) patchAllConcrete(this.core.models.materials.list.values(), this.concreteUniforms);
    void this.core.update(true);
  }

  // ---- X-ray (as the main view's, see ViewerEngine.setXray) --------------------
  private xray = false;
  private aoWanted = true;

  setXray(on: boolean) {
    if (this.disposed) return;
    this.xray = on;
    applyXray(this.core.models.materials.list.values(), on);
    if (this.world.renderer) this.world.renderer.postproduction.aoPass.enabled = this.aoWanted && !on;
    void this.core.update(true);
  }

  // ---- camera --------------------------------------------------------------

  /** The navigation cube in this view's corner, driven by this view's camera. */
  private addViewCube(container: HTMLElement) {
    const cube = new NavCube((direction) => void this.frame(direction));
    container.append(cube.element);
    const north = new NorthArrow();
    container.append(north.element);
    this.north = north;
    const sync = () => {
      cube.update(this.world.camera.three);
      north.update(this.world.camera.three);
    };
    this.world.camera.controls.addEventListener('update', sync);
    this.world.camera.projection.onChanged.add(sync);
    sync();
    this.cube = cube;
  }

  /** Frames `modelIdMap` (else every model) from `direction` (target -> camera;
      else from where the camera looks now) — the toolbar's Fit and Views
      while the cameras aren't linked. */
  async fitTo(modelIdMap?: OBC.ModelIdMap, direction?: THREE.Vector3) {
    if (this.disposed) return;
    const sphere = modelIdMap && !OBC.ModelIdMapUtils.isEmpty(modelIdMap) ? await this.engine.boundsSphere(modelIdMap) : this.engine.modelsSphere();
    if (!sphere) return;
    let dir = direction;
    if (!dir) {
      const position = new THREE.Vector3();
      const target = new THREE.Vector3();
      this.world.camera.controls.getPosition(position);
      this.world.camera.controls.getTarget(target);
      dir = position.sub(target);
    }
    await this.frame(dir, sphere);
  }

  /** Frames every model (or `sphere`) from `direction` (target -> camera), in either projection. */
  private async frame(direction: THREE.Vector3, target?: THREE.Sphere) {
    const sphere = target ?? this.engine.modelsSphere();
    if (!sphere) return;
    const camera = this.world.camera;
    const dir = direction.clone().normalize();
    // Straight up/down is degenerate for an up-vector of +Y.
    if (Math.abs(dir.y) > 0.999) dir.z += 1e-3;
    const radius = sphere.radius * 1.05;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.threePersp.fov) / 2);
    const c = sphere.center;
    const ortho = camera.projection.current !== 'Perspective';
    await camera.controls.setLookAt(c.x + dir.x * distance, c.y + dir.y * distance, c.z + dir.z * distance, c.x, c.y, c.z, !ortho);
    if (ortho) {
      const o = camera.threeOrtho;
      await camera.controls.zoomTo((o.top - o.bottom) / (2 * radius), false);
    }
  }

  setCubeVisible(visible: boolean) {
    this.cube?.setVisible(visible);
  }

  /** This view's north arrow (see NorthArrow). */
  setNorthArrow({ visible, rotation, belowCube }: { visible: boolean; rotation: number; belowCube: boolean }) {
    this.north?.setVisible(visible);
    this.north?.setRotation(rotation);
    this.north?.setBelowCube(belowCube);
  }

  /** The main view drives from now on (e.g. its camera is being moved by
      the fly-through, not by a hand in either view). */
  followMain() {
    this.driver = 'main';
  }

  setLinked(linked: boolean) {
    this.linked = linked;
    if (linked) this.copyCameraFromMain();
  }

  private copyCameraFromMain() {
    this.copyCamera(this.engine.world.camera, this.world.camera);
  }

  /** Makes `to` look from the same direction at the same target with the
      same on-screen scale as `from` — matching visible world height, not
      raw position/zoom, so it also holds between a perspective and an
      orthographic view (and between two orthographic cameras whose frustums
      were sized at different times). */
  private copyCamera(from: OBC.OrthoPerspectiveCamera, to: OBC.OrthoPerspectiveCamera) {
    if (this.syncing) return;
    this.syncing = true;
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    from.controls.getPosition(position);
    from.controls.getTarget(target);
    const offset = position.clone().sub(target);
    const distance = offset.length() || 1;
    const halfTan = (cam: OBC.OrthoPerspectiveCamera) => Math.tan(THREE.MathUtils.degToRad(cam.threePersp.fov) / 2);
    const fromOrtho = from.projection.current !== 'Perspective';
    const toOrtho = to.projection.current !== 'Perspective';
    const o = from.threeOrtho;
    const height = fromOrtho ? (o.top - o.bottom) / o.zoom : 2 * distance * halfTan(from);

    let done: Promise<unknown>;
    if (toOrtho) {
      const p = target.clone().add(offset);
      const t = to.threeOrtho;
      done = to.controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, false).then(() => to.controls.zoomTo((t.top - t.bottom) / height, false));
    } else {
      const p = target.clone().add(offset.normalize().multiplyScalar(height / (2 * halfTan(to))));
      done = to.controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, false);
    }
    void done.finally(() => {
      this.syncing = false;
    });
  }

  /** Only the view being handled (last pointer/wheel inside it) drives the
      other one — syncing both ways on every update made them echo each
      other and drift. */
  private linkCameras() {
    const main = this.engine.world.camera;
    const mine = this.world.camera;
    const mainEl = this.engine.world.renderer?.three.domElement.parentElement;
    const mineEl = this.world.renderer?.three.domElement.parentElement;
    const toMain = () => (this.driver = 'main');
    const toMine = () => (this.driver = 'mine');
    for (const type of ['pointerdown', 'wheel']) {
      mainEl?.addEventListener(type, toMain, { capture: true, passive: true });
      mineEl?.addEventListener(type, toMine, { capture: true, passive: true });
    }
    const onMain = () => { if (this.linked && this.driver === 'main') this.copyCamera(main, mine); };
    const onMine = () => { if (this.linked && this.driver === 'mine') this.copyCamera(mine, main); };
    main.controls.addEventListener('update', onMain);
    mine.controls.addEventListener('update', onMine);
    // A projection switch or a resize changes the on-screen scale (the
    // orthographic frustum is re-sized) without an 'update' — sync again a
    // frame later, from whichever view is driving.
    const resync = () => requestAnimationFrame(() => {
      if (!this.linked || this.disposed) return;
      if (this.driver === 'main') this.copyCamera(main, mine);
      else this.copyCamera(mine, main);
    });
    const onMainProjection = resync;
    const onMineProjection = resync;
    main.projection.onChanged.add(onMainProjection);
    mine.projection.onChanged.add(onMineProjection);
    this.engine.world.renderer?.onResize.add(resync);
    this.world.renderer?.onResize.add(resync);
    this.removeLinks = () => {
      for (const type of ['pointerdown', 'wheel']) {
        mainEl?.removeEventListener(type, toMain, { capture: true });
        mineEl?.removeEventListener(type, toMine, { capture: true });
      }
      main.controls.removeEventListener('update', onMain);
      mine.controls.removeEventListener('update', onMine);
      main.projection.onChanged.remove(onMainProjection);
      mine.projection.onChanged.remove(onMineProjection);
      this.engine.world.renderer?.onResize.remove(resync);
    };
  }

  // ---- per-element overrides (same shape as ViewerEngine's 4D hooks) --------

  /** Colour / opacity set on each element (by model), kept so an element
      can get them back after its selection highlight comes off. */
  private colors = new Map<string, Map<number, string>>();
  private opacities = new Map<string, Map<number, number>>();

  async setVisible(modelId: string, localIds: number[], visible: boolean, skipUpdate = false) {
    const model = this.copies.get(modelId);
    if (!model) return;
    for (const m of renderTargets(this.core, model)) await m.setVisible(localIds, visible);
    if (!skipUpdate) await this.core.update(true);
  }

  async setColor(modelId: string, localIds: number[], color: string | null, skipUpdate = false) {
    const model = this.copies.get(modelId);
    if (!model || localIds.length === 0) return;
    const kept = this.colors.get(modelId) ?? this.colors.set(modelId, new Map()).get(modelId)!;
    for (const id of localIds) {
      if (color === null) kept.delete(id);
      else kept.set(id, color);
    }
    // Selected elements keep their highlight; they get the colour on deselect.
    const ids = this.unselected(modelId, localIds);
    if (ids.length) for (const m of renderTargets(this.core, model)) {
      if (color === null) await m.resetColor(ids);
      else await m.setColor(ids, new THREE.Color(color));
    }
    if (!skipUpdate) await this.core.update(true);
  }

  async setOpacity(modelId: string, localIds: number[], opacity: number | null, skipUpdate = false) {
    const model = this.copies.get(modelId);
    if (!model || localIds.length === 0) return;
    const kept = this.opacities.get(modelId) ?? this.opacities.set(modelId, new Map()).get(modelId)!;
    for (const id of localIds) {
      if (opacity === null) kept.delete(id);
      else kept.set(id, opacity);
    }
    const ids = this.unselected(modelId, localIds);
    if (ids.length) for (const m of renderTargets(this.core, model)) {
      if (opacity === null) await m.resetOpacity(ids);
      else await m.setOpacity(ids, opacity);
    }
    if (!skipUpdate) await this.core.update(true);
  }

  /** Of `localIds`, those drawn with their own colour now (not selected, not ghosted). */
  private unselected(modelId: string, localIds: number[]) {
    const selected = this.selected[modelId];
    const ghosted = this.ghosted[modelId];
    if (!selected?.size && !ghosted?.size) return localIds;
    return localIds.filter((id) => !selected?.has(id) && !ghosted?.has(id));
  }

  // ---- visibility (Hide / Isolate / Show all) --------------------------------

  /** Mirrors a Hider change made in the main view (Hide, Isolate, Show all,
      IFC element types): `visible` for `modelIdMap`, or for everything. */
  async mirrorVisibility(visible: boolean, modelIdMap?: OBC.ModelIdMap) {
    if (this.disposed) return;
    for (const [modelId, copy] of this.copies) {
      const ids = modelIdMap ? modelIdMap[modelId] : undefined;
      if (modelIdMap && !ids?.size) continue;
      for (const m of renderTargets(this.core, copy)) await m.setVisible(ids ? [...ids] : undefined, visible);
    }
    await this.core.update(true);
  }

  // ---- ghost mode -------------------------------------------------------------

  /** What Ghost mode fades here (the main view's, see ViewerEngine.getGhosted). */
  private ghosted: OBC.ModelIdMap = {};

  private ghostMaterial() {
    return { customId: 'ghost', color: GHOST_COLOR, opacity: GHOST_OPACITY, transparent: true, renderedFaces: FRAGS.RenderedFaces.ONE };
  }

  /** Fades `map` (and brings back what is no longer in it); selected objects keep their highlight. */
  showGhost(map: OBC.ModelIdMap): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return;
      const previous = this.ghosted;
      this.ghosted = OBC.ModelIdMapUtils.clone(map);
      for (const [modelId, copy] of this.copies) {
        const selected = this.selected[modelId];
        const was = [...(previous[modelId] ?? [])].filter((id) => !this.ghosted[modelId]?.has(id) && !selected?.has(id));
        const now = [...(this.ghosted[modelId] ?? [])].filter((id) => !selected?.has(id));
        for (const m of renderTargets(this.core, copy)) {
          if (was.length) {
            await m.resetHighlight(was);
            await this.restore(m, modelId, was);
          }
          if (now.length) {
            await m.resetHighlight(now);
            await m.highlight(now, this.ghostMaterial());
          }
        }
      }
      await this.core.update(true);
    });
  }

  /** Leaves the faded parts of the tiles out of the edge pass while ghosting
      or X-raying (see ghostEdges.ts); returns the function that puts them back. */
  hideGhostTiles(): () => void {
    if (OBC.ModelIdMapUtils.isEmpty(this.ghosted) && !this.xray) return () => {};
    const tiles = [...this.core.models.list.values()].flatMap((model) => [...model.tiles.values()]);
    return hideFadedFromEdges(tiles, 0.5);
  }

  /** Highlight changes one at a time (selection and ghost touch the same objects). */
  private hlQueue: Promise<void> = Promise.resolve();
  private enqueue(job: () => Promise<void>): Promise<void> {
    this.hlQueue = this.hlQueue.then(job, job);
    return this.hlQueue;
  }

  // ---- box select ---------------------------------------------------------------

  private boxTool = false;
  private removeExtras: (() => void) | null = null;

  /** The toolbar's Box select is on: drags draw a rectangle, the camera stays put. */
  setBoxTool(on: boolean) {
    this.boxTool = on;
    this.world.camera.controls.enabled = !on;
    const dom = this.world.renderer?.three.domElement.parentElement;
    if (dom) dom.style.cursor = on ? 'crosshair' : '';
  }

  /** Box select in this view: the visible objects fully inside the rectangle, or touching it. */
  async selectInRectangle(a: ScreenPoint, b: ScreenPoint, fullyIncluded: boolean, additive: boolean) {
    const dom = this.world.renderer?.three.domElement;
    if (!dom || this.disposed) return;
    const data = {
      camera: this.world.camera.three,
      dom,
      topLeft: new THREE.Vector2(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      bottomRight: new THREE.Vector2(Math.max(a.x, b.x), Math.max(a.y, b.y)),
      fullyIncluded,
    };
    const indexes = this.engine.getIndexes();
    const map: OBC.ModelIdMap = {};
    for (const [modelId, copy] of this.copies) {
      if (this.hidden.has(modelId)) continue;
      const index = indexes.get(modelId);
      const found = new Set<number>();
      for (const m of renderTargets(this.core, copy)) {
        if (!m.object.visible) continue;
        const hit = await m.rectangleRaycast(data);
        for (const id of hit?.localIds ?? []) if (!index || index.elements.has(id)) found.add(id);
      }
      if (!found.size) continue;
      const ids = [...found];
      const shown = await copy.getVisible(ids);
      const visible = ids.filter((_, i) => shown[i]);
      if (visible.length) map[modelId] = new Set(visible);
    }
    await this.engine.applySelection(map, additive);
  }

  // ---- selection ------------------------------------------------------------

  /** What this view shows selected — always the app's (main view's) selection. */
  private selected: OBC.ModelIdMap = {};
  private removeSelectionLinks: (() => void) | null = null;

  /** Picking in this view selects in the app (Ctrl: add / remove), so the
      Properties, tree, data table and Isolate / Ghost follow; the
      selection is drawn here too. */
  private linkSelection() {
    const highlighter = this.engine.highlighter;
    const dom = this.world.renderer!.three.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // A drag is a camera move, not a pick.
      if (!start || e.button !== 0 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
      void this.pick(e);
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    const onHighlight = (map: OBC.ModelIdMap) => void this.showSelection(map);
    const onClear = () => void this.showSelection({});
    highlighter.events.select.onHighlight.add(onHighlight);
    highlighter.events.select.onClear.add(onClear);
    this.removeSelectionLinks = () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      highlighter.events.select.onHighlight.remove(onHighlight);
      highlighter.events.select.onClear.remove(onClear);
    };
  }

  private async pick(e: PointerEvent) {
    if (this.disposed) return;
    const dom = this.world.renderer!.three.domElement;
    const data = { camera: this.world.camera.three, mouse: new THREE.Vector2(e.clientX, e.clientY), dom };
    let best: { modelId: string; localId: number; distance: number } | null = null;
    for (const [modelId, copy] of this.copies) {
      if (this.hidden.has(modelId)) continue;
      for (const m of renderTargets(this.core, copy)) {
        if (!m.object.visible) continue;
        const hit = await m.raycast(data);
        if (hit && (!best || hit.distance < best.distance)) best = { modelId, localId: hit.localId, distance: hit.distance };
      }
    }
    const highlighter = this.engine.highlighter;
    const add = e.ctrlKey || e.metaKey;
    if (!best) {
      if (!add) await highlighter.clear('select');
      return;
    }
    const current = highlighter.selection.select;
    if (add && current[best.modelId]?.has(best.localId)) {
      const next = OBC.ModelIdMapUtils.clone(current);
      next[best.modelId].delete(best.localId);
      if (OBC.ModelIdMapUtils.isEmpty(next)) await highlighter.clear('select');
      else await highlighter.highlightByID('select', next, true, false);
      return;
    }
    await highlighter.highlightByID('select', { [best.modelId]: new Set([best.localId]) }, !add, false);
  }

  /** Draws `map` as this view's selection; the previous one gets its own
      colour / opacity back. */
  private showSelection(map: OBC.ModelIdMap): Promise<void> {
    return this.enqueue(() => this.showSelectionNow(map));
  }

  private async showSelectionNow(map: OBC.ModelIdMap) {
    if (this.disposed) return;
    const previous = this.selected;
    this.selected = OBC.ModelIdMapUtils.clone(map);
    const color = this.engine.highlighter.styles.get('select')?.color ?? new THREE.Color('#1e88e5');
    for (const [modelId, copy] of this.copies) {
      const was = [...(previous[modelId] ?? [])].filter((id) => !this.selected[modelId]?.has(id));
      const now = [...(this.selected[modelId] ?? [])];
      for (const m of renderTargets(this.core, copy)) {
        if (was.length) {
          await m.resetHighlight(was);
          // Back to faded in Ghost mode, else to its own colour.
          const ghosted = this.ghosted[modelId];
          const fade = ghosted?.size ? was.filter((id) => ghosted.has(id)) : [];
          const own = fade.length ? was.filter((id) => !ghosted!.has(id)) : was;
          await this.restore(m, modelId, own);
          if (fade.length) await m.highlight(fade, this.ghostMaterial());
        }
        // A colour already on an element would win over the highlight.
        if (now.length) await m.resetHighlight(now);
        if (now.length) await m.highlight(now, { customId: 'select', color, opacity: 1, transparent: false, renderedFaces: FRAGS.RenderedFaces.ONE });
      }
    }
    await this.core.update(true);
  }

  /** Puts back the colour / opacity kept for `ids`. */
  private async restore(m: FRAGS.FragmentsModel, modelId: string, ids: number[]) {
    const group = <T>(kept: Map<number, T> | undefined) => {
      const out = new Map<T, number[]>();
      for (const id of ids) {
        const v = kept?.get(id);
        if (v !== undefined) (out.get(v) ?? out.set(v, []).get(v)!).push(id);
      }
      return out;
    };
    for (const [c, list] of group(this.colors.get(modelId))) await m.setColor(list, new THREE.Color(c));
    for (const [o, list] of group(this.opacities.get(modelId))) await m.setOpacity(list, o);
  }

  async forceUpdate() {
    await this.core.update(true);
  }

  setPixelRatio(ratio: number) {
    const r = this.world.renderer;
    if (!r || this.disposed) return;
    r.three.setPixelRatio(ratio);
    r.resize(undefined);
  }

  /** This view's own world (camera and renderer), for overlays that project onto it (tags next to objects). */
  get overlayWorld(): World {
    return this.world;
  }

  /** Renders now and returns the canvas — read it before yielding (the
      drawing buffer is cleared after the frame is shown). */
  renderNow(): HTMLCanvasElement | null {
    const renderer = this.world.renderer;
    if (!renderer || this.disposed) return null;
    renderer.update();
    return renderer.three.domElement;
  }

  /** Takes every colour override off this view's copies (not visibility or opacity). */
  async resetColors() {
    for (const model of this.copies.values()) {
      for (const m of renderTargets(this.core, model)) await m.resetColor(undefined);
    }
    this.colors.clear();
    // The reset took the selection highlight off too: show it again.
    await this.showSelection(this.selected);
  }

  /** Takes every colour and opacity override off this view's copies (visibility stays), then draws the selection again. */
  async resetLooks() {
    for (const model of this.copies.values()) {
      for (const m of renderTargets(this.core, model)) {
        await m.resetColor(undefined);
        await m.resetOpacity(undefined);
      }
    }
    this.colors.clear();
    this.opacities.clear();
    await this.showSelection(this.selected);
  }

  async resetOverrides() {
    for (const model of this.copies.values()) {
      for (const m of renderTargets(this.core, model)) {
        await m.resetVisible();
        await m.resetColor(undefined);
        await m.resetOpacity(undefined);
      }
    }
    this.colors.clear();
    this.opacities.clear();
    // The reset took the selection highlight and the ghosting off too.
    const selected = this.selected;
    this.selected = {};
    await this.showSelection(selected);
    const ghosted = this.ghosted;
    this.ghosted = {};
    await this.showGhost(ghosted);
  }

  // ---- lifecycle -----------------------------------------------------------

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeLinks?.();
    this.removeSelectionLinks?.();
    this.removeExtras?.();
    this.cube?.dispose();
    this.north?.dispose();
    for (const [id, copy] of this.copies) {
      this.world.scene.three.remove(copy.object);
      await this.core.disposeModel(id).catch(() => {});
    }
    this.copies.clear();
    await this.core.dispose().catch(() => {});
    this.world.dispose();
  }
}
