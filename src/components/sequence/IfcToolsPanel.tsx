import { useEffect, useState } from 'react';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useModelsStore } from '../../state/modelsStore';
import { useModelPlacementStore, ZERO_OFFSET } from '../../state/modelPlacementStore';
import { dbRoot } from '../../state/projectDbStore';
import { ensureModelFile } from '../../state/modelFiles';
import { saveNewIfc } from '../../ids/writeBack';
import { runIfcTool } from '../../ifcTools/client';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';
import type { ViewPage } from '../../state/viewSettingsStore';

const stem = (name: string) => name.replace(/\.ifc$/i, '');

/** Models and 4D Sequencing › 3D tab › Split and merge IFCs: IfcOpenShell on the loaded models. Merge joins the ticked models into
    one new IFC (each with the placement it has here baked in); Split writes one IFC per storey or per element class. Both write
    new files and leave the originals alone. */
export function IfcToolsPanel({ page }: { page: ViewPage }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const offsets = useModelPlacementStore((s) => s.offsets);
  const sections = useOpenSections<'tools'>(`${page}.ifcTools.sections`, []);
  const [ticked, setTicked] = useState<string[]>([]);
  const [mergedName, setMergedName] = useState('merged');
  const [splitModel, setSplitModel] = useState('');
  const [by, setBy] = useState<'storey' | 'class'>('storey');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setTicked((t) => t.filter((n) => models.some((m) => m.name === n)));
    if (!models.some((m) => m.name === splitModel)) setSplitModel(models[0]?.name ?? '');
  }, [models, splitModel]);

  const files = async (names: string[]) => {
    const out: File[] = [];
    for (const name of names) {
      const f = await ensureModelFile(name, dbRoot());
      if (!f) throw new Error(`${name}: its IFC isn't at hand — load the .ifc again from Inputs.`);
      out.push(f);
    }
    return out;
  };
  const run = async (job: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await job() });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const merge = () => run(async () => {
    const name = `${mergedName.trim().replace(/\.ifc$/i, '').replace(/[^A-Za-z0-9._ -]+/g, '-') || 'merged'}.ifc`;
    const out = await runIfcTool('merge', { offsets: ticked.map((n) => offsets[n] ?? ZERO_OFFSET) }, await files(ticked));
    const where = await saveNewIfc(engine, name, out.parts[0].bytes, `Merged from ${ticked.join(', ')}`, true);
    return `${ticked.length} models merged into ${name} (${out.result.elements} elements), ${where}. The originals are unchanged: remove them from the view if you only want the merged model.`;
  });

  const split = () => run(async () => {
    const [file] = await files([splitModel]);
    const out = await runIfcTool('split', { by, name: splitModel }, [file]);
    if (out.parts.length === 0) return `${splitModel}: nothing to split by ${by === 'storey' ? 'building storey' : 'element class'}.`;
    for (const part of out.parts) await saveNewIfc(engine, part.name, part.bytes, `Split from ${splitModel} by ${by}`, false);
    const names = out.parts.map((p) => p.name).join(', ');
    return `${splitModel} split into ${out.parts.length} IFCs (${names}) ${dbRoot() ? 'in the project folder (models/edited) and the model store: open them from Inputs.' : 'and downloaded.'}`;
  });

  if (models.length === 0) return null;
  return (
    <CollapsibleSection
      title="Split and merge IFCs"
      open={sections.isOpen('tools')}
      onToggle={() => sections.toggle('tools')}
      flush
      tip={<p>Uses IfcOpenShell on your computer (the app's local server must be running). Merge joins the ticked models into one new IFC, each placed where it is shown here. Split writes one IFC per building storey, or per element class. New files are saved next to the edited models; the originals are never changed.</p>}
    >
      <div className="mp">
        <div className="cols__heading"><span>Merge</span></div>
        {models.map((m) => (
          <label key={m.modelId} className="pvis__label">
            <input type="checkbox" checked={ticked.includes(m.name)} onChange={(e) => setTicked(e.target.checked ? [...ticked, m.name] : ticked.filter((n) => n !== m.name))} />
            <span>{m.name}</span>
          </label>
        ))}
        <label className="mp__field">
          <span>Merged file name</span>
          <input type="text" value={mergedName} onChange={(e) => setMergedName(e.target.value)} />
        </label>
        <div className="mp__row">
          <button type="button" className="btn btn--small primary" disabled={busy || ticked.length < 2} onClick={() => void merge()} title="Join the ticked models into one new IFC">{busy ? 'Working…' : 'Merge IFCs'}</button>
        </div>

        <div className="cols__heading"><span>Split</span></div>
        <label className="mp__field">
          <span>Model</span>
          <select value={splitModel} onChange={(e) => setSplitModel(e.target.value)}>
            {models.map((m) => <option key={m.modelId} value={m.name}>{stem(m.name)}</option>)}
          </select>
        </label>
        <div className="segmented-choice">
          <button type="button" className={by === 'storey' ? 'active' : ''} onClick={() => setBy('storey')}>By storey</button>
          <button type="button" className={by === 'class' ? 'active' : ''} onClick={() => setBy('class')}>By element class</button>
        </div>
        <div className="mp__row">
          <button type="button" className="btn btn--small primary" disabled={busy || !splitModel} onClick={() => void split()} title="Write one IFC per storey or per element class">{busy ? 'Working…' : 'Split IFC'}</button>
        </div>
        {message && <div className={`model-checks__msg model-checks__msg--${message.kind}`}>{message.text}</div>}
      </div>
    </CollapsibleSection>
  );
}
