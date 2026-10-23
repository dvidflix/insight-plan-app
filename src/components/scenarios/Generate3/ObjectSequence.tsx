import { useMemo, useRef, type RefObject } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { usePersistedState } from '../../../utils/persistedState';
import { isFineTuned } from '../../../prs/workPackages';
import { ScenarioTabContent } from '../ScenarioDock';
import { useRuleContext } from '../rules/RuleParts';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Generate's step 4, Granular sequence: the model on the left (the shared 3D view shows through, linked both ways with the list) and on the right the
    object-by-object sequence table (it lived in the Sequence panel before; it is only here now): steps, joins, Record picks, Sort by picks, its List
    setup and the search box. With "Use this object order in Generate" on, each package without an object order of its own builds its objects in
    the table's order (prs/objectOrder.ts withSequenceOrder); the packages keep their own order and links. The split is adjustable and remembered. */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number) => v.toLocaleString();

export function ObjectSequenceStep({ wp, view }: { wp: WP; view: RefObject<HTMLDivElement> }) {
  const [left, setLeft] = usePersistedState('generate3.split', 50);
  const box = useRef<HTMLDivElement>(null);
  const ctx = useRuleContext();
  const on = !!ctx.rules.objectSequence;
  const rows = useScenarioStore((s) => s.rows);
  const sequenced = rows.filter((r) => r.step !== null).length;
  // What the table's order does to the packages (the ones with an object order of their own keep it).
  const effect = useMemo(() => {
    const own = wp.packages.filter(isFineTuned).length;
    const taken = wp.effective.filter((p, i) => isFineTuned(p) && !isFineTuned(wp.packages[i] ?? p)).length;
    return { own, taken };
  }, [wp.packages, wp.effective]);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const move = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); setLeft(Math.round(Math.min(80, Math.max(20, ((ev.clientX - r.left) / r.width) * 100)))); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const setOn = (v: boolean) => ctx.change((r) => { const { objectSequence: _o, ...rest } = r; return v ? { ...rest, objectSequence: true } : rest; });
  return (
    <div className="g3-split" ref={box} style={{ gridTemplateColumns: `${left}% 8px minmax(0, 1fr)` }}>
      <section className="g3-split__view" ref={view} aria-label="Model">
        <div className="g3-split__viewbar">
          <span className="scn-dim">Pick objects here or in the list: the two follow each other.</span>
          <button type="button" className="btn btn--small" onClick={() => window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: 'sequence' }))} title="Open 4D Sequencing to play the generated programme over the model">Play in 4D</button>
        </div>
      </section>
      <div className="g3-split__grip" role="separator" aria-orientation="vertical" aria-valuenow={left} aria-valuemin={20} aria-valuemax={80} tabIndex={0} title="Drag to change the widths (double-click: half and half)"
        onPointerDown={drag} onDoubleClick={() => setLeft(50)} onKeyDown={(e) => { if (e.key === 'ArrowLeft') setLeft(Math.max(20, left - 5)); if (e.key === 'ArrowRight') setLeft(Math.min(80, left + 5)); }} />
      <section className="g3-split__list" aria-label="Object sequence">
        <div className="g3-seqbar">
          <label className="g3-adv__check">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <span>Use this object order in Generate
              <small className="g3-adv__why">{on
                ? `Each package builds its objects in this order (${n(effect.taken)} package${effect.taken === 1 ? '' : 's'}${effect.own ? `; ${effect.own} keep the order set for them in step 2` : ''}). The packages keep their own order and links.`
                : 'Optional. Off: each package is built as one piece (or in the order set for it in step 2), in the order of step 2.'}</small>
            </span>
          </label>
          <span className="scn-dim g3-seqbar__n">{n(sequenced)} of {n(rows.length)} objects have a step</span>
        </div>
        {rows.length === 0 && (
          <p className="g3-adv__note g3-seqbar__none">This model has no object sequence table: it is made for objects that carry the pour properties. To order the objects of a package, use <button type="button" className="link-btn" onClick={() => { useG3.getState().setStep(2); useG3.getState().setOrderDialog(useG3.getState().picked ? 'picked' : 'all'); }}>Fine-tune object order</button> in step 2.</p>
        )}
        <div className="g3-split__table"><ScenarioTabContent /></div>
      </section>
    </div>
  );
}
