import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFocusStore } from '../../state/focusStore';
import { SidePaneDock } from '../SidePane';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useModelsStore } from '../../state/modelsStore';
import { useSelectionStore } from '../../state/selectionStore';
import { isTableCfgTab, setSelected, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioStatus, ScenarioSync, ScenarioTable, ScenarioToolbar, useScenarioTabs } from './ScenarioParts';

/** Pours (rows, keyed by GlobalId) <-> elements of the scenario's building
    model in the 3D view. */
function usePourElements() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const { loaded } = useScenarioView();
  return useMemo(() => {
    const model = loaded ? models.find((m) => m.name.replace(/\.(ifc|frag)$/i, '') === loaded.stem) : undefined;
    const idByGuid = new Map<string, number>();
    const guidById = new Map<number, string>();
    if (model) {
      for (const el of engine.getIndexes().get(model.modelId)?.elements.values() ?? []) {
        idByGuid.set(el.guid, el.localId);
        guidById.set(el.localId, el.guid);
      }
    }
    return { modelId: model?.modelId ?? null, idByGuid, guidById };
  }, [engine, models, loaded]);
}

/** Focus colours: while Focus is on, the pours that were selected when it went
    on each get a colour (random, spread round the colour wheel, or the colour
    the model gives them), in the 3D view and as the tint of their rows. Off, the
    objects get their normal colour back. */
function FocusColours({ pours }: { pours: ReturnType<typeof usePourElements> }) {
  const engine = useViewerEngine();
  const focus = useFocusStore((s) => s.focus);
  const mode = useFocusStore((s) => s.colourMode);
  useEffect(() => {
    const { modelId, idByGuid } = pours;
    if (!focus || !modelId) return;
    let cancelled = false;
    const st = useScenarioStore.getState();
    const keys = [...st.selected];
    const guidOf = (k: string) => k.split('#')[0];
    const idOf = (k: string) => idByGuid.get(guidOf(k));
    const ids = keys.map(idOf).filter((id): id is number => id !== undefined);
    void (async () => {
      const colours = new Map<string, string>();
      if (mode === 'random') {
        const order = new Map(st.rows.map((r, i) => [r.key, i]));
        for (const k of keys) colours.set(k, `hsl(${Math.round(((order.get(k) ?? 0) * 137.508) % 360)} 70% 52%)`);
        // The viewer takes hex.
        const hex = (css: string) => `#${new THREE.Color(css).getHexString()}`;
        for (const [k, c] of colours) {
          const id = idOf(k);
          colours.set(k, hex(c));
          if (id !== undefined && !cancelled) await engine.setColor(modelId, [id], hex(c), true);
        }
      } else {
        const original = await engine.getElementColors(modelId, ids);
        for (const k of keys) {
          const c = original.get(idOf(k) ?? -1);
          if (c) colours.set(k, c);
        }
        // Painted explicitly: resetting would show the view's own look (e.g. the grey Concrete colour).
        for (const k of keys) {
          const id = idOf(k);
          const c = colours.get(k);
          if (id !== undefined && c && !cancelled) await engine.setColor(modelId, [id], c, true);
        }
      }
      if (cancelled) return;
      await engine.forceUpdate();
      useFocusStore.setState({ colours });
    })();
    return () => {
      cancelled = true;
      useFocusStore.setState({ colours: new Map() });
      if (ids.length) void engine.setColor(modelId, ids, null);
    };
  }, [engine, focus, mode, pours]);
  return null;
}

/** 4D Sequencing > Scenarios (next to Gantt / Tasks): the scenario's pour
    order with its tools, linked both ways with the 3D view — pick pours in
    the table to select them in 3D, or in 3D to select their rows — then
    Generate (Scenario panel) to see the new order play in 4D at once. */
export function ScenarioTabContent({ onOpen }: { onOpen?: (key: string) => void }) {
  const engine = useViewerEngine();
  const { ready } = useScenarioView();
  const pours = usePourElements();

  const selectInViewer = (keys: Set<string>) => {
    if (!pours.modelId) return;
    const ids = [...keys].map((k) => pours.idByGuid.get(k.split('#')[0])).filter((id): id is number => id !== undefined);
    void engine.selectElements(ids.length ? { [pours.modelId]: ids } : {}, false);
  };

  // 3D picks select the matching rows.
  const byModel = useSelectionStore((s) => s.byModel);
  useEffect(() => {
    if (!pours.modelId) return;
    const ids = byModel[pours.modelId];
    if (!ids) return;
    const guids = new Set(ids.map((id) => pours.guidById.get(id)).filter((g): g is string => !!g));
    const rows = useScenarioStore.getState().rows;
    const keys = rows.filter((r) => guids.has(r.key.split('#')[0])).map((r) => r.key);
    const current = useScenarioStore.getState().selected;
    if (keys.length && (keys.length !== current.size || keys.some((k) => !current.has(k)))) setSelected(new Set(keys));
  }, [byModel, pours]);

  // "Record picks": objects picked in 3D are remembered in pick order.
  useEffect(() => {
    const st = useScenarioStore.getState();
    if (!st.recordPicks || !pours.modelId) return;
    const guids = (byModel[pours.modelId] ?? []).map((id) => pours.guidById.get(id)).filter((g): g is string => !!g);
    const keys = st.rows.filter((r) => guids.includes(r.key.split('#')[0])).map((r) => r.key);
    const fresh = keys.filter((k) => !st.pickOrder.includes(k));
    if (fresh.length) useScenarioStore.setState({ pickOrder: [...st.pickOrder, ...fresh] });
  }, [byModel, pours]);

  return (
    <div className="scn-4d">
      <ScenarioSync />
      <FocusColours pours={pours} />
      <ScenarioNotice />
      {ready && (
        <>
          <ScenarioToolbar compact />
          <div className="scn-4d__table">
            <ScenarioTable onPick={selectInViewer} onOpen={onOpen} />
          </div>
        </>
      )}
      <ScenarioStatus className="scn-4d__status" />
    </div>
  );
}

/** The Scenario panel (scenario card, table Columns / Filters / Group /
    Sort / Color), in the lower part of the side pane under the page's own
    tabs; the divider between them is draggable. */
export function ScenarioDock() {
  const { ready } = useScenarioView();
  const cfgTab = useScenarioStore((s) => s.cfgTab);
  const tabs = useScenarioTabs();
  const tab = ready ? cfgTab : 'scenario';
  return (
    <SidePaneDock>
      <div className="scn-dock" aria-label="Scenario">
        <div className="side-pane__bar scn-dock__bar" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`side-pane__tab${tab === t.id ? ' active' : ''}`}
              title={t.label}
              aria-label={t.label}
              onClick={() => useScenarioStore.setState({ cfgTab: t.id })}
            >
              {t.icon}
              {t.badge ? <span className="side-pane__badge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
        <div className={ready && isTableCfgTab(tab) ? 'config-panel__body scn-panel scn-dock__body' : 'scn-panel scn-panel__body scn-dock__body'}>
          <ScenarioPanelBody tab={tab} />
        </div>
      </div>
    </SidePaneDock>
  );
}
