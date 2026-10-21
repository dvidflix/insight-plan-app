import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFocusStore } from '../../state/focusStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useModelsStore } from '../../state/modelsStore';
import { baseStem } from '../../scenarios/fromProgramme';
import { useSelectionStore } from '../../state/selectionStore';
import { setSelected, useScenarioStore } from '../../state/scenarioStore';
import { ListConfig } from '../ListConfig';
import { useListQuery } from '../../state/tableSearchStore';
import { configFocusProps } from '../../state/listConfigStore';
import { ScenarioTableConfig, scnTabBadges, type ScnConfigTab } from './ScenarioTableConfig';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { useJoinShortcut } from '../../scenarios/useJoinShortcut';
import { ScenarioNotice, ScenarioStatus, ScenarioSync, ScenarioTable, ScenarioToolbar } from './ScenarioParts';

/** Pours (rows, keyed by GlobalId) <-> elements of the scenario's building
    model in the 3D view. */
function usePourElements() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const { loaded } = useScenarioView();
  return useMemo(() => {
    // The loaded IFC may be the _FIXED copy of the building the scenario is for (same objects, same GlobalIds).
    const stemOf = (m: { name: string }) => m.name.replace(/\.(ifc|frag)$/i, '');
    const model = loaded ? models.find((m) => stemOf(m) === loaded.stem) ?? models.find((m) => baseStem(stemOf(m)).toLowerCase() === baseStem(loaded.stem).toLowerCase()) : undefined;
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
  const { ready, tableCfg, fields, allColumnIds, view } = useScenarioView();
  const pours = usePourElements();
  useJoinShortcut(pours); // Alt+J joins the objects picked in 3D

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

  const tableTab = (tab: ScnConfigTab) => (
    <ScenarioTableConfig
      tab={tab}
      cfg={tableCfg}
      onChange={(next) => useScenarioStore.setState({ tableCfg: next })}
      fields={fields}
      defaultColumns={allColumnIds}
      onCollapseAll={() => useScenarioStore.setState({ collapsedGroups: new Set(view.flatMap((x) => (x.kind === 'group' ? [x.key] : []))) })}
      onExpandAll={() => useScenarioStore.setState({ collapsedGroups: new Set() })}
    />
  );
  const badges = scnTabBadges(tableCfg, fields);
  // The words typed in the main header's search box (while this table is the active list) narrow the table.
  const words = useListQuery('sequence');
  useEffect(() => { useScenarioStore.setState({ filter: words }); }, [words]);
  return (
    <div className="scn-4d" {...configFocusProps('sequence')}>
      {/* The table's Columns, Filters, Group, Sort and Colour are in the List setup panel (no buttons of their own). */}
      {ready && (
        <ListConfig
          id="sequence"
          searchable
          label="Sequence table"
          badges={{ filters: badges.filters, group: badges.group, color: badges.color }}
          panels={{ columns: tableTab('columns'), filters: tableTab('filters'), group: tableTab('group'), color: tableTab('color') }}
        />
      )}
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
