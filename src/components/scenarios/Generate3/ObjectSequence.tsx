import { useMemo, useRef, type RefObject } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { usePersistedState } from '../../../utils/persistedState';
import { isFineTuned } from '../../../prs/workPackages';
import { ScenarioTabContent } from '../ScenarioDock';
import { SequenceTimelineStatusBar } from '../../sequence/SequenceTimelineStatusBar';
import { useSequenceFocusStore } from '../../../state/sequenceFocusStore';
import { useRuleContext } from '../rules/RuleParts';
import { InfoTip } from '../../InfoTip';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Generate's step 4, Granular sequence: the 4D view on the left (the shared 3D view played by the TimeLiner, its timeline under it; a row's
    double-click moves the TimeLiner to the start of its first linked activity) and on the right the
    object-by-object sequence table (it lived in the Sequence panel before; it is only here now): steps, joins, Record picks, Sort by picks, its List
    setup and the search box. With "Use this object order in Generate" on, each package without an object order of its own builds its objects in
    the table's order (prs/objectOrder.ts withSequenceOrder); the packages keep their own order and links. With "Follow it exactly" the table's
    steps are the build order across the packages (prs/workPackages.ts packagesRequest). The split is adjustable and remembered. */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number) => v.toLocaleString();

export function ObjectSequenceStep({ wp, view }: { wp: WP; view: RefObject<HTMLDivElement> }) {
  const [left, setLeft] = usePersistedState('generate3.split', 50);
  const [quiet, setQuiet] = usePersistedState('generate3.modeQuiet', false);
  const box = useRef<HTMLDivElement>(null);
  const ctx = useRuleContext();
  const on = !!ctx.rules.objectSequence;
  const exact = ctx.rules.objectSequence === 'exact';
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
  const setMode = (v: boolean | 'exact') => ctx.change((r) => { const { objectSequence: _o, ...rest } = r; return v ? { ...rest, objectSequence: v } : rest; });
  return (
    <div className="g3-split" ref={box} style={{ gridTemplateColumns: `${left}% 8px minmax(0, 1fr)` }}>
      <section className="g3-split__view" ref={view} aria-label="Model">
        {/* The 4D view: the model played by the TimeLiner (the same 4D driver and timeline as 4D Sequencing, mounted by App on this step). */}
        <div className="g3-split__viewbar"><SequenceTimelineStatusBar /></div>
      </section>
      <div className="g3-split__grip" role="separator" aria-orientation="vertical" aria-valuenow={left} aria-valuemin={20} aria-valuemax={80} tabIndex={0} title="Drag to change the widths (double-click: half and half)"
        onPointerDown={drag} onDoubleClick={() => setLeft(50)} onKeyDown={(e) => { if (e.key === 'ArrowLeft') setLeft(Math.max(20, left - 5)); if (e.key === 'ArrowRight') setLeft(Math.min(80, left + 5)); }} />
      <section className="g3-split__list" aria-label="Object sequence">
        {/* The two switches with short names (what they do is in their info tips), what they do now in a word, and how much of the table has a step. */}
        <div className="g3-seqbar">
          <label className="g3-seqbar__opt">
            <input type="checkbox" checked={on} onChange={(e) => setMode(e.target.checked)} />
            <span>Use this order in Generate</span>
          </label>
          <InfoTip label="About Use this order in Generate">
            {on
              ? `Each package builds its objects in this order (${n(effect.taken)} package${effect.taken === 1 ? '' : 's'}${effect.own ? `; ${effect.own} keep the order set for them in step 2` : ''}).`
              : 'Optional. Off: each package is built as one piece (or in the order set for it in step 2), in the order of step 2.'}{' '}
            Rows of the same step start together; each step waits for the one before.
          </InfoTip>
          <label className={`g3-seqbar__opt${on ? '' : ' is-off'}`} title={on ? undefined : 'Tick “Use this order in Generate” first'}>
            <input type="checkbox" checked={exact} disabled={!on} onChange={(e) => setMode(e.target.checked ? 'exact' : true)} />
            <span>Follow it exactly</span>
          </label>
          <InfoTip label="About Follow it exactly">
            Off: the packages keep the order of step 2, and this order applies inside each. On: this order is the build order of the whole schedule, across
            the packages: objects of the same step start together, each step after the one before. The packages’ order and their “starts after” links (step 2)
            are not used for the objects in this table; objects and packages not in it follow at the end, in step 2’s order.
          </InfoTip>
          {/* What Generate does with the table now; a click turns its highlight off or on (remembered). */}
          <button type="button" className={`source-chip g3-seqbar__mode${on && !quiet ? ' is-on' : ''}`} aria-pressed={!quiet} onClick={() => setQuiet(!quiet)}
            title={`What Generate does with this table now. Click to ${quiet ? 'highlight it again' : 'stop highlighting it'}`}>{exact ? 'Overrides the package order' : on ? 'Inside each package' : 'Not used'}</button>
          <span className="g3-seqbar__progress" title={`${n(sequenced)} of ${n(rows.length)} objects have a step; the rest are placed by Generate`}>
            <span className="g3-seqbar__meter" aria-hidden="true"><span style={{ width: `${rows.length ? Math.round((sequenced / rows.length) * 100) : 0}%` }} /></span>
            <span><b>{n(sequenced)}</b> / {n(rows.length)} sequenced</span>
          </span>
        </div>
        {rows.length === 0 && (
          <p className="g3-adv__note g3-seqbar__none">This model has no object sequence table: it is made for objects that carry the pour properties. To order the objects of a package, use <button type="button" className="link-btn" onClick={() => { useG3.getState().setStep(2); useG3.getState().setOrderDialog(useG3.getState().picked ? 'picked' : 'all'); }}>Fine-tune object order</button> in step 2.</p>
        )}
        <div className="g3-split__table"><ScenarioTabContent onOpen={() => useSequenceFocusStore.getState().jumpToSelected?.()} /></div>
      </section>
    </div>
  );
}
