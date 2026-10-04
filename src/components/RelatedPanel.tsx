import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSelectionStore } from '../state/selectionStore';
import { clashRows, useClashStore } from '../state/clashStore';
import { usePersistedState } from '../utils/persistedState';
import type { ContactRow, IdsByModel, VerticalPosition } from '../viewer/relations';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';
import { ContactsSection } from './ContactsSection';
import { ActivityLinksSection } from './ActivityLinksSection';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="disp__row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

type Side = 'below' | 'above' | 'beside';

/** Where the other element sits relative to the selected one, from a
    pair's "B is" (flipped when the selected one is B). */
const FLIP: Record<VerticalPosition, VerticalPosition> = { below: 'above', 'mostly-below': 'mostly-above', side: 'side', 'mostly-above': 'mostly-below', above: 'below' };
const sideOf = (p: VerticalPosition): Side => (p === 'below' || p === 'mostly-below' ? 'below' : p === 'above' || p === 'mostly-above' ? 'above' : 'beside');

const merge = (a: IdsByModel, b: IdsByModel): IdsByModel => {
  const out: IdsByModel = { ...a };
  for (const [m, ids] of Object.entries(b)) out[m] = [...new Set([...(out[m] ?? []), ...ids])];
  return out;
};

/** Models page > 3D & Related: what touches the selection (below, above,
    beside), read from the Clashes & contacts results, and those results. */
export function RelatedPanel() {
  const engine = useViewerEngine();
  const selection = useSelectionStore((s) => s.byModel);
  const results = useClashStore((s) => s.results);
  const running = useClashStore((s) => !!s.running || s.pending > 0);
  const sections = useOpenSections<'touching'>('related.sections', ['touching']);
  const [keep, setKeep] = usePersistedState('related.keepSelection', false);
  const [acrossModels, setAcrossModels] = usePersistedState('related.touchAcrossModels', false);

  // The elements touching the selection, by where they sit relative to it.
  const neighbours = useMemo(() => {
    const chosen = new Set(Object.entries(selection).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`)));
    const out: Record<Side | 'all', IdsByModel> = { below: {}, above: {}, beside: {}, all: {} };
    if (!chosen.size) return out;
    const { touching, linked } = clashRows(results);
    const add = (side: Side, e: ContactRow['a']) => {
      for (const group of [out[side], out.all]) {
        const list = (group[e.modelId] ??= []);
        if (!list.includes(e.localId)) list.push(e.localId);
      }
    };
    for (const r of acrossModels ? [...touching, ...linked] : touching) {
      const aIn = chosen.has(`${r.a.modelId}:${r.a.localId}`);
      const bIn = chosen.has(`${r.b.modelId}:${r.b.localId}`);
      if (aIn && !bIn) add(sideOf(r.position), r.b);
      else if (bIn && !aIn) add(sideOf(FLIP[r.position]), r.a);
    }
    return out;
  }, [selection, results, acrossModels]);

  const count = (ids: IdsByModel) => Object.values(ids).reduce((n, l) => n + l.length, 0);
  const selectedCount = count(selection);
  const pick = (side: Side | 'all') => void engine.selectElements(keep ? merge(selection, neighbours[side]) : neighbours[side], false);
  const ready = Object.keys(results).length > 0;

  const button = (side: Side | 'all', label: string, title: string) => (
    <button type="button" className="clash__kind" disabled={!count(neighbours[side])} onClick={() => pick(side)} title={title}>
      <span>{label}</span>
      <b>{count(neighbours[side])}</b>
    </button>
  );

  return (
    <div>
      <CollapsibleSection
        title="Touching the selection"
        open={sections.isOpen('touching')}
        onToggle={() => sections.toggle('touching')}
        tip={
          <>
            <p>Selects the elements that touch or clash with the selection, by where they sit: <b>Below</b>, <b>Above</b> (including mostly below / above) or <b>Beside</b>, or <b>All</b> of them. Click again after selecting to go one more step, e.g. the pours below the pours below.</p>
            <p>It reads the Clashes &amp; contacts results below, so it is instant once they are ready. <b>Include other models</b> also takes linked elements in other models; <b>Keep the selection</b> adds to it instead of replacing it.</p>
          </>
        }
      >
        <div className="clash">
          <div className="clash__kinds clash__kinds--four">
            {button('below', 'Below', 'Elements under the selection')}
            {button('above', 'Above', 'Elements on top of the selection')}
            {button('beside', 'Beside', 'Elements next to the selection, at the same height')}
            {button('all', 'All', 'Everything touching the selection')}
          </div>
          {!selectedCount && <div className="flt__hint">Select elements in the 3D view first.</div>}
          {selectedCount > 0 && !ready && <div className="flt__hint">{running ? 'Clashes & contacts are still being checked…' : 'No Clashes & contacts results yet (see below).'}</div>}
          <div className="disp">
            <Switch label="Keep the selection" on={keep} onChange={setKeep} />
            <Switch label="Include other models" on={acrossModels} onChange={setAcrossModels} />
          </div>
        </div>
      </CollapsibleSection>

      <ActivityLinksSection />

      <ContactsSection />
    </div>
  );
}
