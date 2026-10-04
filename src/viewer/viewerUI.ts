import * as BUI from '@thatopen/ui';
import * as BUIC from '@thatopen/ui-obc';
import * as OBC from '@thatopen/components';
import { NavCube } from './navCube';
import { STOREYS_CLASSIFICATION, type ViewerEngine, type ViewerStyle } from './ViewerEngine';
import { NorthArrow } from './northArrow';
import { useSavedViewAttrsStore, LEGACY_SAVED_VIEW_ATTRS, type SavedViewAttr } from '../state/savedViewAttrsStore';
import { useViewSettingsStore, type ViewSettings } from '../state/viewSettingsStore';
import { useModelPlacementStore, type Offset } from '../state/modelPlacementStore';

/** All viewer chrome, built only from @thatopen/ui (bim-grid / bim-viewport /
    bim-toolbar / bim-panel) and the official @thatopen/ui-obc factories
    (tables.modelsList / viewpointsList / topicsList / commentsList). Loading
    models (.ifc and .frag both) happens on the Inputs tab, not from a button
    in here — see ViewerEngine.loadIfc/loadFrag. */

export type ViewerLayout = 'model' | 'modelSplit' | 'modelSlider' | 'sequence' | 'sequenceSplit' | 'sequenceSlider';

export interface ViewerShell {
  grid: BUI.Grid<['model', 'modelSplit', 'modelSlider', 'sequence', 'sequenceSplit', 'sequenceSlider'], ['toolbar', 'sidebar', 'viewport', 'viewport2']>;
  viewport: BUI.Viewport;
  /** Host of the optional second 3D view (split mode). In the compare
      slider it is stacked over the main one and clipped (see
      .viewer-grid--slider in global.css). */
  viewport2: BUI.Viewport;
  /** The Models page's Configuration tab contents (set by attach). */
  modelPanels: ModelPanels | null;
  /** Show or hide the orientation cube of the main view. */
  setViewCubeVisible: (visible: boolean) => void;
  /** The main view's north arrow: shown or not, its rotation override
      (degrees clockwise from project north) and whether the cube is above it. */
  setNorthArrow: (opts: { visible: boolean; rotation: number; belowCube: boolean }) => void;
  attach: (engine: ViewerEngine) => void;
  setLayout: (layout: ViewerLayout) => void;
}


type NameRow = { Name: string; Actions: string };

/** A headerless Name | Actions table, same shape as the official Views /
    ItemsFinder tutorials use for their lists. */
function nameListTable(getNames: () => string[], actions: (name: string, refresh: () => void) => BUI.TemplateResult) {
  const table = document.createElement('bim-table') as BUI.Table<NameRow>;
  table.headersHidden = true;
  table.noIndentation = true;
  table.columns = ['Name', { name: 'Actions', width: 'auto' }];
  const refresh = () => {
    table.data = getNames().map((Name) => ({ data: { Name, Actions: '' } }));
  };
  table.dataTransform = {
    Actions: (value, row) => (row.Name ? actions(row.Name, refresh) : value),
  };
  refresh();
  return [table, refresh] as const;
}

/** Every bim-panel-section gets its expand chevron before the title,
    pointing right when collapsed and down when open, and a grey header row
    over a white body — the same as the app's own collapsible sections. The chevron lives in the section's shadow DOM,
    so an extra sheet joins the component's own styles (Lit adopts
    `elementStyles` into every instance; the library itself is untouched). */
function chevronFirstInSections() {
  const Section = customElements.get('bim-panel-section') as (CustomElementConstructor & { elementStyles?: (CSSStyleSheet | object)[]; chevronFirst?: boolean }) | undefined;
  if (!Section?.elementStyles || Section.chevronFirst) return;
  Section.chevronFirst = true;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .header { justify-content: flex-start; padding-left: 4px; background: #f4f4f5; }
    .header-end { order: -1; }
    .expand-icon { transform: rotate(180deg); }
    :host([collapsed]) .expand-icon { transform: rotate(90deg); }
  `);
  Section.elementStyles.push(sheet);
  // Sections already on the page were styled before this; add it to them too.
  document.querySelectorAll('bim-panel-section').forEach((el) => {
    const root = el.shadowRoot;
    if (root && !root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  });
}

export function createViewerShell(): ViewerShell {
  BUI.Manager.init();
  chevronFirstInSections();
  BUIC.Manager.init();
  // That Open defaults to dark; the app is light (colours are overridden on
  // .viewer-shell in global.css).
  document.documentElement.classList.remove('bim-ui-dark');
  document.documentElement.classList.add('bim-ui-light');
  const viewport = BUI.Component.create<BUI.Viewport>(() => BUI.html`<bim-viewport></bim-viewport>`);
  const viewport2 = BUI.Component.create<BUI.Viewport>(() => BUI.html`<bim-viewport></bim-viewport>`);
  const grid = document.createElement('bim-grid') as ViewerShell['grid'];
  grid.style.width = '100%';
  grid.style.height = '100%';
  // Until attach() runs the grid only holds the viewport, so the engine has
  // a mounted container to create its renderer in.
  grid.layouts = {
    model: { template: '"viewport" 1fr / 1fr', elements: { viewport } },
    sequence: { template: '"viewport" 1fr / 1fr', elements: { viewport } },
    sequenceSplit: { template: '"viewport viewport2" 1fr / 1fr 1fr', elements: { viewport, viewport2 } },
  } as never;
  grid.layout = 'model';
  // Official bim-grid dividers: drag the edge between the left pane and the
  // viewport to resize it.
  grid.resizeableAreas = true;
  grid.areasResizeExceptions = ['dock'];

  let layouts: ViewerShell['grid']['layouts'] | null = null;
  const shell: ViewerShell = { grid, viewport, viewport2, modelPanels: null, setViewCubeVisible: () => {}, setNorthArrow: () => {}, attach: () => {}, setLayout: () => {} };

  const attach = (engine: ViewerEngine) => {
    // Navigation cube: faces, edges and corners all frame the model from
    // that direction (ViewerEngine.fit), and it follows the camera.
    const { world } = engine;
    const navCube = new NavCube((direction) => void engine.fit(undefined, true, direction));
    viewport.append(navCube.element);
    shell.setViewCubeVisible = (visible) => navCube.setVisible(visible);
    // North arrow, under the cube; turns with the camera.
    const north = new NorthArrow();
    viewport.append(north.element);
    shell.setNorthArrow = ({ visible, rotation, belowCube }) => {
      north.setVisible(visible);
      north.setRotation(rotation);
      north.setBelowCube(belowCube);
    };
    const syncCube = () => {
      navCube.update(world.camera.three);
      north.update(world.camera.three);
    };
    world.camera.controls.addEventListener('update', syncCube);
    world.camera.projection.onChanged.add(syncCube);
    syncCube();

    shell.modelPanels = buildSidebar(engine);
    // Both pages mount the tools in their own toolbar row and the side
    // panes in their own Configuration pane (see ViewerWorkspace), so the
    // grid is just the viewport(s).
    layouts = {
      model: { template: '"viewport" 1fr / 1fr', elements: { viewport } },
      modelSplit: { template: '"viewport viewport2" 1fr / 1fr 1fr', elements: { viewport, viewport2 } },
      sequence: { template: '"viewport" 1fr / 1fr', elements: { viewport } },
      sequenceSplit: { template: '"viewport viewport2" 1fr / 1fr 1fr', elements: { viewport, viewport2 } },
      // Same areas as the split; CSS stacks the two viewports (see setLayout).
      modelSlider: { template: '"viewport viewport2" 1fr / 1fr 1fr', elements: { viewport, viewport2 } },
      sequenceSlider: { template: '"viewport viewport2" 1fr / 1fr 1fr', elements: { viewport, viewport2 } },
    } as never;
    const current = grid.layout ?? 'model';
    grid.layouts = layouts;
    grid.layout = current;
    // Same layout name as before, so Lit sees no property change — force the
    // re-render that swaps in the toolbar/sidebar.
    grid.requestUpdate();
  };

  const setLayout = (layout: ViewerLayout) => {
    const slider = layout.endsWith('Slider');
    grid.classList.toggle('viewer-grid--slider', slider);
    // The column divider would sit on top of the compare slider's own.
    grid.resizeableAreas = !slider;
    if (!slider) viewport2.style.clipPath = '';
    grid.layout = layout;
  };
  shell.attach = attach;
  shell.setLayout = setLayout;

  return shell;
}

/** bim-tables come back empty after being detached and re-attached (as the
    Configuration tabs are) — re-assign each one's data once laid out so it
    re-renders its rows (a plain requestUpdate isn't enough). */
export function rerenderTables(root: Element) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('bim-table').forEach((el) => {
      const t = el as HTMLElement & { data?: unknown[]; requestUpdate?: () => void };
      if (Array.isArray(t.data) && t.data.length > 0) {
        const rows = t.data;
        t.data = [];
        t.data = rows;
      }
      t.requestUpdate?.();
    });
  }));
}


// ---------------------------------------------------------------------------
// Sidebar — one bim-panel of bim-panel-sections
// ---------------------------------------------------------------------------
/** The Models page's Configuration tabs (except 3D and View settings, which are React). */
export type ModelPanelId = 'tree' | 'properties' | 'views' | 'topics';
export type ModelPanels = Record<ModelPanelId, HTMLElement>;

function buildSidebar(engine: ViewerEngine): ModelPanels {
  const { components, highlighter, hider, classifier, viewpoints, views } = engine;
  const fragments = components.get(OBC.FragmentsManager);

  // ---- Models --------------------------------------------------------
  const [modelsList] = BUIC.tables.modelsList({
    components,
    missingDataMessage: 'No models loaded — add IFC or FRAG files on the Inputs tab.',
    actions: { visibility: true, download: false, dispose: false },
  });

  // The IFC structure tree is React now (components/IfcTree.tsx).

  // ---- Properties: React now (components/PropertiesGrid.tsx) ---------

  // Anything the automatic sets / floor plans could not build, shown where
  // the user would look for them (one element per tab).
  const makeSetupNote = () => {
    const note = document.createElement('bim-label') as BUI.Label;
    note.icon = 'mdi:alert-outline';
    note.style.cssText = 'display: none; --bim-label--c: #cc4e4e; white-space: normal; padding: 0.5rem;';
    return note;
  };
  const setupNotes = [makeSetupNote()];
  const showSetupErrors = () => {
    for (const note of setupNotes) {
      note.textContent = `Could not generate automatically — ${engine.setupErrors.join('; ')}`;
      note.style.display = engine.setupErrors.length ? '' : 'none';
    }
  };
  engine.onSetsReady.add(showSetupErrors);

  // Search sets are React (components/SearchSetsPanel.tsx, own side-pane tab).

  // Selection sets are part of Search sets (components/SearchSetsPanel.tsx).

  // ---- Saved views (Viewpoints + hider + colours + clip + style) -----
  const [viewpointsTable, updateViewpoints] = BUIC.tables.viewpointsList({
    components,
    actions: { selectComponents: true, colorizeComponent: false, resetColors: true, updateCamera: true, delete: true, unlink: false },
  });

  /** Opens a saved view, bringing back only the attributes it was saved
      with (Views > Saved view attributes). Style, display settings and
      placement are restored through the settings stores, so the panels
      follow; the rest ride in the viewpoint's customData. */
  const openSavedView = async (vp: OBC.Viewpoint, transition: boolean) => {
    const a: Record<SavedViewAttr, boolean> = { ...LEGACY_SAVED_VIEW_ATTRS, ...(vp.customData.attrs ?? {}) };
    const data = vp.customData as { style?: ViewerStyle; display?: Partial<ViewSettings>; placement?: { offsets: Record<string, Offset>; storeySlides: Record<string, number> } };
    const settings = useViewSettingsStore.getState();
    const page = settings.activePage;
    const jobs: Promise<unknown>[] = [];
    if (a.sections) {
      vp.setClippingState(true);
      vp.setClippingVisibility(true);
    }
    if (a.visibility) jobs.push(vp.applyVisibility().then(() => engine.onExternalVisibilityChange.trigger()));
    const patch: Partial<ViewSettings> = {};
    if (a.style && data.style) patch.style = data.style;
    if (a.display && data.display) Object.assign(patch, data.display);
    if (a.placement && data.placement) {
      patch.storeySlides = { ...data.placement.storeySlides };
      const { setOffset } = useModelPlacementStore.getState();
      for (const [name, offset] of Object.entries(data.placement.offsets)) setOffset(name, offset);
    }
    if (Object.keys(patch).length) settings.patch(page, 'main', patch);
    if (a.camera) {
      const camera = engine.world.camera;
      camera.projection.set(vp.projection);
      const p = vp.position;
      const d = vp.direction;
      jobs.push(camera.controls.setLookAt(p.x, p.y, p.z, p.x + d.x * 80, p.y + d.y * 80, p.z + d.z * 80, transition));
    }
    await Promise.all(jobs);
  };
  let viewCount = 0;
  const onNewView = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    const viewpoint = viewpoints.create();
    viewCount += 1;
    viewpoint.title = `View ${viewpoints.list.size || viewCount}`;
    await viewpoint.updateCamera(true);

    // Saved view = the camera plus whichever attributes are ticked in
    // Views > Saved view attributes (what the Hider has hidden, the
    // Clipper's planes, the style, display settings, model placement).
    const attrs = { ...useSavedViewAttrsStore.getState().attrs };
    viewpoint.customData.attrs = attrs;
    const settings = useViewSettingsStore.getState();
    const main = settings.pages[settings.activePage].main;
    viewpoint.defaultVisibility = true;
    if (attrs.visibility) {
      const hidden = await hider.getVisibilityMap(false);
      const hiddenMap: OBC.ModelIdMap = {};
      for (const [modelId, ids] of Object.entries(hidden)) if (ids.length) hiddenMap[modelId] = new Set(ids);
      if (!OBC.ModelIdMapUtils.isEmpty(hiddenMap)) {
        for (const guid of await fragments.modelIdMapToGuids(hiddenMap)) viewpoint.exceptionComponents.add(guid);
      }
    }
    if (attrs.sections) viewpoint.updateClippingPlanes();
    if (attrs.style) viewpoint.customData.style = main.style;
    if (attrs.display) {
      const display: Partial<ViewSettings> = { ...main };
      delete display.storeySlides;
      delete display.hiddenModels;
      delete display.style;
      viewpoint.customData.display = display;
    }
    if (attrs.placement) {
      viewpoint.customData.placement = { offsets: { ...useModelPlacementStore.getState().offsets }, storeySlides: { ...main.storeySlides } };
    }
    // The views table's "go to" calls go(); open with the saved attributes instead.
    viewpoint.go = (config) => openSavedView(viewpoint, config?.transition ?? true);
    updateViewpoints();
    target.loading = false;
  };

  // ---- Floor plans (Views.createFromIfcStoreys) ----------------------
  const [floorPlansTable, refreshFloorPlans] = nameListTable(
    () => [...views.list.keys()],
    (name) => {
      const onOpen = () => views.open(name);
      const onRemove = () => views.list.delete(name);
      return BUI.html`
        <bim-button label-hidden label="Open" icon="mdi:floor-plan" @click=${onOpen}></bim-button>
        <bim-button label-hidden label="Remove" icon="mdi:delete-outline" @click=${onRemove}></bim-button>
      `;
    },
  );
  const refreshViews = () => refreshFloorPlans();
  views.list.onItemSet.add(refreshViews);
  views.list.onItemDeleted.add(refreshViews);
  views.list.onItemUpdated.add(refreshViews);
  views.list.onCleared.add(refreshViews);

  // ---- Storeys (classifier.byIfcBuildingStorey) ----------------------
  const [storeysTable, refreshStoreys] = nameListTable(
    () => [...(classifier.list.get(STOREYS_CLASSIFICATION)?.keys() ?? [])],
    (name) => {
      const storeyMap = async () => (await classifier.list.get(STOREYS_CLASSIFICATION)?.get(name)?.get()) ?? {};
      const onSelect = async ({ target }: { target: BUI.Button }) => {
        target.loading = true;
        await highlighter.highlightByID('select', await storeyMap(), true, false);
        target.loading = false;
      };
      const onIsolate = async ({ target }: { target: BUI.Button }) => {
        target.loading = true;
        await hider.isolate(await storeyMap()); engine.onExternalVisibilityChange.trigger();
        target.loading = false;
      };
      return BUI.html`
        <bim-button label-hidden label="Select" icon="mdi:cursor-default-click" @click=${onSelect}></bim-button>
        <bim-button label-hidden label="Isolate" icon="mdi:filter-outline" @click=${onIsolate}></bim-button>
      `;
    },
  );
  engine.onSetsReady.add(refreshStoreys);
  fragments.list.onItemDeleted.add(() => setTimeout(refreshStoreys, 0));

  // ---- BCF topics + comments (topicsList / commentsList) -------------
  const bcfTopics = components.get(OBC.BCFTopics);
  bcfTopics.setup();
  const [topicsTable, updateTopics] = BUIC.tables.topicsList({ components, dataStyles: { users: {} } });
  const commentsHost = document.createElement('div');
  let currentTopic: OBC.Topic | null = null;
  let topicTitle = '';
  let commentText = '';
  const showComments = () => {
    commentsHost.replaceChildren();
    if (!currentTopic) return;
    const [commentsTable] = BUIC.tables.commentsList({ topic: currentTopic, actions: { delete: true } });
    commentsHost.append(commentsTable);
  };
  const onCreateTopic = () => {
    const title = topicTitle.trim();
    if (!title) return;
    currentTopic = bcfTopics.create({ title });
    updateTopics();
    showComments();
  };
  const onAddComment = () => {
    const text = commentText.trim();
    if (!text || !currentTopic) return;
    currentTopic.createComment(text);
    showComments();
  };

  const panel = (tpl: () => ReturnType<typeof BUI.html>) => BUI.Component.create<HTMLElement>(tpl);
  return {
    tree: panel(() => BUI.html`
      <bim-panel>
        <bim-panel-section label="Models">
          ${modelsList}
        </bim-panel-section>
      </bim-panel>
    `),
    properties: panel(() => BUI.html`
      <bim-panel></bim-panel>
    `),
    views: panel(() => BUI.html`
      <bim-panel>
        ${setupNotes[0]}
        <bim-panel-section label="Saved views">
          <bim-button label="New view" icon="mdi:camera-plus-outline" @click=${onNewView}></bim-button>
          ${viewpointsTable}
        </bim-panel-section>
      </bim-panel>
    `),
    topics: panel(() => BUI.html`
      <bim-panel>
        <bim-panel-section label="BCF topics">
          <bim-text-input label="Title" @input=${(e: Event) => (topicTitle = (e.target as BUI.TextInput).value)}></bim-text-input>
          <bim-button label="Create topic" icon="mdi:plus" @click=${onCreateTopic}></bim-button>
          ${topicsTable}
        </bim-panel-section>
        <bim-panel-section label="Comments (latest topic)">
          <bim-text-input label="Comment" @input=${(e: Event) => (commentText = (e.target as BUI.TextInput).value)}></bim-text-input>
          <bim-button label="Add comment" icon="mdi:comment-plus-outline" @click=${onAddComment}></bim-button>
          ${commentsHost}
        </bim-panel-section>
      </bim-panel>
    `),
  };
}
