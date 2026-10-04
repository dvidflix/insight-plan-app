import { useMemo, useRef, useState } from 'react';
import { useModelsStore } from '../../state/modelsStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { checkModel, type ModelCheck } from '../../scenarios/modelCheck';
import { addModelToProject } from '../../scenarios/api';
import { modelFileFor } from '../../state/modelFiles';
import { refreshProject } from '../../state/scenarioStore';
import { IconExpander } from '../icons';

const VERDICT: Record<ModelCheck['verdict'], { label: string; cls: string }> = {
  ready: { label: 'Ready to generate', cls: 'ok' },
  gaps: { label: 'Will generate, with gaps', cls: 'warn' },
  blocked: { label: 'Cannot be generated', cls: 'error' },
};

/** The building's model, as loaded in Inputs, checked against what the
    Scenarios generator needs (scenarios/modelCheck.ts). "Show" selects the
    elements concerned in 3D. */
export function useModelCheck(stem: string | null) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const model = stem ? models.find((m) => m.name.replace(/\.(ifc|frag)$/i, '') === stem) : undefined;
  const check = useMemo(() => {
    const index = model ? engine.getIndexes().get(model.modelId) : undefined;
    return index ? checkModel([...index.elements.values()]) : null;
  }, [engine, model]);
  const show = (guids: string[]) => {
    if (!model) return;
    const index = engine.getIndexes().get(model.modelId);
    const wanted = new Set(guids);
    const ids = [...(index?.elements.values() ?? [])].filter((e) => wanted.has(e.guid)).map((e) => e.localId);
    void engine.selectElements({ [model.modelId]: ids }, true);
  };
  return { check, show };
}

export function ModelCheckCard({ stem, compact }: { stem: string; compact?: boolean }) {
  const { check, show } = useModelCheck(stem);
  const [open, setOpen] = useState(!compact);
  if (!check) return null;
  const v = VERDICT[check.verdict];
  const main = check.issues.filter((i) => i.severity !== 'info');
  const minor = check.issues.filter((i) => i.severity === 'info');
  return (
    <section className="scn-card mcheck">
      <button type="button" className="mcheck__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="scn-card__title">Model check</span>
        <span className={`mcheck__verdict mcheck__verdict--${v.cls}`}>{v.label}</span>
        <span className="mcheck__chev"><IconExpander open={open} /></span>
      </button>
      <div className="scn-dim">
        {check.pours.toLocaleString()} pours · {check.included.toLocaleString()} to schedule
      </div>
      {open && (
        <>
          {main.length === 0 && <div className="scn-dim">Everything the generator needs is there.</div>}
          {[...main, ...minor].map((i) => (
            <div key={i.id} className={`mcheck__issue mcheck__issue--${i.severity}`}>
              <div className="mcheck__row">
                <span className="mcheck__dot" aria-hidden="true" />
                <span className="mcheck__title">{i.title}</span>
                {i.guids.length > 0 && (
                  <button type="button" className="mini-btn" onClick={() => show(i.guids)} title="Select these elements in 3D">Show</button>
                )}
              </div>
              <div className="mcheck__detail">{i.detail}</div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** A building loaded in Inputs but not in the project folder yet: its check,
    and Add to project (the IFC from Inputs, or picked again after a reload). */
export function AddModelToProject({ root, stem }: { root: string; stem: string }) {
  const { check } = useModelCheck(stem);
  const [state, setState] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false });
  const pickRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setState({ busy: true, text: 'Adding the model…', error: false });
    try {
      const res = await addModelToProject(root, stem, file, (f) => setState({ busy: true, text: `Adding the model… ${Math.round(f * 100)}%`, error: false }));
      setState({ busy: false, text: res.note, error: false });
      await refreshProject(root);
    } catch (e) {
      setState({ busy: false, text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  const add = () => {
    const file = modelFileFor(stem);
    if (file) void upload(file);
    else pickRef.current?.click();
  };

  return (
    <div className="scn-addmodel">
      <section className="scn-card">
        <div className="scn-card__title">Add this model to the project</div>
        <p className="scn-dim scn-editor__help">
          <strong>{stem}</strong> is loaded in Inputs but is not in the project folder yet. Adding it copies the IFC into <code>models</code>, where the generator works on it. The first time, preparing its pour list takes a few minutes (class fixing, clash detection); after that, updates take about a second.
        </p>
        <div className="scn-row">
          <button type="button" className="btn primary" disabled={state.busy || check?.verdict === 'blocked'} onClick={add} title={check?.verdict === 'blocked' ? 'The model check found nothing to schedule' : undefined}>
            {state.busy ? 'Adding…' : 'Add to project'}
          </button>
          {state.text && <span className={state.error ? 'scn-error' : 'scn-dim'}>{state.text}</span>}
        </div>
        <input
          ref={pickRef}
          type="file"
          accept=".ifc"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </section>
      <ModelCheckCard stem={stem} />
    </div>
  );
}
