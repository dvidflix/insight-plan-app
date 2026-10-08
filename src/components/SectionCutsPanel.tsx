import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSectionCutsStore } from '../state/sectionCutsStore';
import { LEVEL_DEFAULT_OFFSET_MM, NO_CUT, type CutSetting, type SectionCuts } from '../viewer/sectionPlanes';
import { useModelsStore } from '../state/modelsStore';

/** Views > Section cuts: two cuts that can be on together — along a gridline of the models' IfcGrid, and at a
    level (a storey) — each with an offset in millimetres, a side to keep and a switch between cutting and only
    showing the plane. They are clipping planes like the Section tool's, so those switches (Planes cut the model,
    Delete all section planes) apply to them too. */
export function SectionCutsPanel() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const cuts = useSectionCutsStore((s) => s.cuts);
  const { setCut, clear, clearAll } = useSectionCutsStore.getState();
  // The names come from the loaded models; they appear as the IFC text is read.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    engine.onIfcGridsChange.add(bump);
    return () => { engine.onIfcGridsChange.remove(bump); };
  }, [engine]);
  const options = engine.isInitialized ? engine.sectionCutOptions() : { grids: [], storeys: [] };
  void models; void tick;

  const block = (kind: keyof SectionCuts) => {
    const c = cuts[kind];
    const names = kind === 'grid' ? options.grids.map((g) => ({ value: g.name, label: `${g.name} (${g.family})` })) : options.storeys.map((s) => ({ value: s.name, label: `${s.name}  ·  ${s.elevation.toFixed(2)}` }));
    // A remembered name the loaded models do not have stays listed (it draws nothing until they are back).
    if (c.name && !names.some((n) => n.value === c.name)) names.unshift({ value: c.name, label: `${c.name} (not in the loaded models)` });
    const pick = (name: string) => {
      if (!name) return clear(kind);
      setCut(kind, { name, ...(c.name === '' ? { offset: kind === 'level' ? LEVEL_DEFAULT_OFFSET_MM : 0, flip: false, cut: true } : {}) });
    };
    const patch = (p: Partial<CutSetting>) => setCut(kind, p);
    return (
      <div className="disp scut" key={kind}>
        <label className="disp__row">
          <span>{kind === 'grid' ? 'Cut along gridline' : 'Cut at level'}</span>
          <select value={c.name} onChange={(e) => pick(e.target.value)} disabled={names.length === 0}>
            <option value="">{names.length === 0 ? (kind === 'grid' ? 'No gridlines in the models' : 'No storeys with an elevation') : 'None'}</option>
            {names.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </label>
        {c.name !== '' && (
          <>
            <label className="disp__row" title={kind === 'grid' ? 'Millimetres from the gridline, to its left (looking from its first point to its last)' : 'Millimetres above the storey'}>
              <span>Offset (mm)</span>
              <input type="number" step={100} value={c.offset} onChange={(e) => patch({ offset: Number(e.target.value) || 0 })} style={{ width: 90 }} />
            </label>
            <div className="disp__row">
              <span>Keep</span>
              <div className="segmented-choice">
                <button type="button" className={!c.flip ? 'active' : ''} onClick={() => patch({ flip: false })}>{kind === 'grid' ? 'Left side' : 'Below'}</button>
                <button type="button" className={c.flip ? 'active' : ''} onClick={() => patch({ flip: true })}>{kind === 'grid' ? 'Right side' : 'Above'}</button>
              </div>
            </div>
            <div className="disp__row">
              <span>Cut the model</span>
              <button type="button" role="switch" aria-checked={c.cut} className={`switch${c.cut ? ' on' : ''}`} onClick={() => patch({ cut: !c.cut })} title="Off: only the plane is shown">
                <span className="switch__thumb" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      {block('grid')}
      {block('level')}
      <div className="disp">
        <button type="button" className="btn btn--small" onClick={() => clearAll()} disabled={cuts.grid.name === NO_CUT.name && cuts.level.name === NO_CUT.name}>Clear both cuts</button>
      </div>
    </div>
  );
}
