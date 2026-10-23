import { useMemo, useState } from 'react';
import { useSelectionStore } from '../../../state/selectionStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { VERDICT_TEXT, readiness, type Finding } from '../../../prs/packageReadiness';
import type { PackageObject } from '../../../prs/workPackages';
import { Dialog } from './Controls';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Generate 3's model readiness: a chip beside Generate (Ready, Will generate with gaps, Cannot generate) and, on a click, what it found, each with
    its count, what it means, what to do, and Show in 3D (or Show in the list for packages). Nothing here stops Generate except having nothing to
    build (prs/packageReadiness.ts). */

type WP = ReturnType<typeof useWorkPackages>;

export function useReadiness(wp: WP) {
  return useMemo(() => readiness(wp.objects, wp.packages, wp.contents, wp.methods), [wp.objects, wp.packages, wp.contents, wp.methods]);
}

export function ReadinessChip({ wp }: { wp: WP }) {
  const r = useReadiness(wp);
  const [open, setOpen] = useState(false);
  const gaps = r.findings.filter((f) => f.id !== 'unknowndays').length;
  const cls = r.verdict === 'ready' ? 'ok' : r.verdict === 'gaps' ? 'warn' : 'bad';
  return (
    <>
      <button type="button" className={`scn-chip scn-chip--${cls === 'bad' ? 'warn' : cls} g3-ready g3-ready--${cls}`} onClick={() => setOpen(true)}
        title={r.verdict === 'ready' ? 'The model and the packages are ready to generate. Click for details' : `${r.findings.map((f) => f.title).join('\n')}\nClick for what to do`}>
        {VERDICT_TEXT[r.verdict]}{r.verdict === 'gaps' && gaps ? ` (${gaps})` : ''}
      </button>
      {open && <ReadinessDialog findings={r.findings} verdict={VERDICT_TEXT[r.verdict]} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReadinessDialog({ findings, verdict, onClose }: { findings: Finding[]; verdict: string; onClose: () => void }) {
  const engine = useViewerEngine();
  const showIn3D = (objs: PackageObject[]) => {
    const byModel: Record<string, number[]> = {};
    for (const o of objs) { const at = o.key.lastIndexOf(':'); (byModel[o.key.slice(0, at)] ??= []).push(Number(o.key.slice(at + 1))); }
    useG3.getState().pick(null);
    useSelectionStore.getState().setSelection(Object.values(byModel)[0] ?? [], byModel);
    void engine.fit(Object.fromEntries(Object.entries(byModel).map(([m, ids]) => [m, new Set(ids)])));
    onClose();
  };
  const showInList = (ids: string[]) => { useG3.getState().pick(ids[0] ?? null); onClose(); };
  return (
    <Dialog title={`Model readiness · ${verdict}`} onClose={onClose} wide={false}>
      {findings.length === 0 ? <p className="g3-adv__note">Every object of the loaded model is in a work package, with what its method needs. Generate when you are ready.</p> : (
        <ul className="g3-ready__list">
          {findings.map((f) => (
            <li key={f.id} className={f.blocks ? 'is-block' : ''}>
              <b>{f.title}</b>
              <span className="g3-adv__why">{f.hint}</span>
              <span className="g3-ready__acts">
                {f.objects.length > 0 && <button type="button" className="btn btn--small" onClick={() => showIn3D(f.objects)} title="Select these objects in 3D and frame them">Show in 3D</button>}
                {f.packages.length > 0 && f.objects.length === 0 && <button type="button" className="btn btn--small" onClick={() => showInList(f.packages)} title="Pick the first of these packages in the list">Show in the list</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="scn-dim g3-adv__why">None of these stops Generate, except having nothing to build: the programme is made with what there is.</p>
    </Dialog>
  );
}
