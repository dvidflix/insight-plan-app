import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSectionsStore } from '../state/sectionsStore';
import { IconClose, IconDelete, IconEye, IconEyeOff } from './icons';
import { LEVEL_DEFAULT_OFFSET_MM, SECTION_ORIENT_LABEL, type Section, type SectionOrient } from '../viewer/sectionPlanes';

const ORIENTS: SectionOrient[] = ['horizontal', 'vertical', 'cross'];
const ORIENT_TIP: Record<SectionOrient, string> = {
  horizontal: 'A plan cut: a level plane, keeping what is below',
  vertical: 'A cut facing east / west',
  cross: 'A cut facing north / south',
};
const FALLBACK: [number, number] = [-50, 50];

/** Keeps the viewer's clipping planes in step with the Sections panel. Always mounted (with the viewer). */
export function SectionsSync() {
  const engine = useViewerEngine();
  const sections = useSectionsStore((s) => s.sections);
  const solid = useSectionsStore((s) => s.solid);
  const handle = useSectionsStore((s) => s.handle);
  useEffect(() => {
    let alive = true;
    void engine.ready.then(() => { if (alive) void engine.syncSections(sections, solid, handle); });
    return () => { alive = false; };
  }, [engine, sections, solid, handle]);
  useEffect(() => {
    const moved = ({ id, offset, rotate }: { id: string; offset: number; rotate: number }) => useSectionsStore.getState().patch(id, { offset, rotate });
    engine.onSectionMoved.add(moved);
    return () => { engine.onSectionMoved.remove(moved); };
  }, [engine]);
  return null;
}

const RANGE_KEY: Record<SectionOrient, 'z' | 'x' | 'y'> = { horizontal: 'z', vertical: 'x', cross: 'y' };

/** The Sections panel: add several section planes at once (horizontal, vertical, cross), cut at a level, and adjust
    each one's offset, handle, rotation and side; sets of sections can be saved by name. */
export function SectionsPanel() {
  const engine = useViewerEngine();
  const { open, sections, activeId, handle, solid, saved } = useSectionsStore();
  const st = useSectionsStore.getState();
  const [name, setName] = useState('');
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    engine.onToolContentChange.add(on);
    return () => { engine.onToolContentChange.remove(on); };
  }, [engine]);
  const ranges = engine.isInitialized ? engine.sectionRanges() : null;
  const storeys = useMemo(() => (engine.isInitialized ? engine.sectionCutOptions().storeys : []), [engine, sections.length, open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const rangeOf = (o: SectionOrient): [number, number] => (ranges ? ranges[RANGE_KEY[o]] : FALLBACK);
  const mid = (o: SectionOrient) => { const [a, b] = rangeOf(o); return Math.round(((a + b) / 2) * 100) / 100; };
  const active = sections.find((s) => s.id === activeId) ?? null;
  const cutting = engine.isInitialized && engine.sectionsActive;

  const cutAtLevel = (elevation: number) => {
    const z = Math.round((elevation + LEVEL_DEFAULT_OFFSET_MM / 1000) * 100) / 100;
    if (active?.orient === 'horizontal') st.patch(active.id, { offset: z });
    else st.add('horizontal', z);
  };
  const changeOrient = (s: Section, orient: SectionOrient) => {
    if (orient !== s.orient) st.patch(s.id, { orient, offset: mid(orient), rotate: 0 });
  };

  const [lo, hi] = active ? rangeOf(active.orient) : FALLBACK;

  return (
    <div className="sec-panel" role="dialog" aria-label="Sections" onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="sec-panel__head">
        <b>Sections</b><span className="sec-panel__count">{sections.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="sec-icon" title={cutting ? 'Sections cut the model (click to show the whole model)' : 'Sections are off (click to cut again)'} aria-pressed={cutting} onClick={() => engine.setSectionsActive(!engine.sectionsActive)}>{cutting ? <IconEye width={16} height={16} /> : <IconEyeOff width={16} height={16} />}</button>
        <button type="button" className="sec-icon" title="Delete all sections" disabled={sections.length === 0} onClick={() => engine.clearSections()}><IconDelete width={16} height={16} /></button>
        <button type="button" className="sec-icon" title="Close" onClick={() => st.setOpen(false)}><IconClose width={16} height={16} /></button>
      </div>

      <div className="sec-label">Add a section</div>
      <div className="sec-row">
        {ORIENTS.map((o) => (
          <button key={o} type="button" className="btn btn--small sec-add" title={`${ORIENT_TIP[o]}. Each click adds another cut.`} onClick={() => st.add(o, mid(o))}>+ {SECTION_ORIENT_LABEL[o]}</button>
        ))}
      </div>

      {storeys.length > 0 && (
        <>
          <div className="sec-label">Cut at a level</div>
          <div className="sec-row sec-row--wrap">
            {[...storeys].reverse().map((l) => (
              <button key={l.name} type="button" className="btn btn--small" title={`Elevation ${l.elevation.toFixed(2)} m; the cut is ${(LEVEL_DEFAULT_OFFSET_MM / 1000).toFixed(1)} m above it`} onClick={() => cutAtLevel(l.elevation)}>{l.name}</button>
            ))}
          </div>
        </>
      )}

      {active && (
        <div className="sec-card">
          <div className="sec-card__head"><b>{sectionName(active, sections)}</b></div>
          <div className="segmented-choice sec-seg">
            {ORIENTS.map((o) => <button key={o} type="button" className={active.orient === o ? 'active' : ''} onClick={() => changeOrient(active, o)}>{SECTION_ORIENT_LABEL[o]}</button>)}
          </div>
          <label className="sec-field">
            <span>{active.orient === 'horizontal' ? 'Elevation' : 'Offset'}</span>
            <input type="range" min={Math.floor(lo)} max={Math.ceil(hi)} step={0.05} value={clamp(active.offset, Math.floor(lo), Math.ceil(hi))} onChange={(e) => st.patch(active.id, { offset: Number(e.target.value) })} />
            <input type="number" step={0.1} value={active.offset} className="sec-num" onChange={(e) => st.patch(active.id, { offset: Number(e.target.value) || 0 })} title="Metres, in project coordinates" />
            <small>m</small>
          </label>
          <div className="sec-field">
            <span>Handle</span>
            <div className="segmented-choice sec-seg">
              <button type="button" className={handle === 'move' ? 'active' : ''} onClick={() => st.setHandle('move')} title="Dragging the disc in the view moves the plane">Move</button>
              <button type="button" className={handle === 'rotate' ? 'active' : ''} onClick={() => st.setHandle('rotate')} title="Dragging the disc in the view turns the plane">Rotate</button>
            </div>
          </div>
          {active.orient !== 'horizontal' && (
            <label className="sec-field">
              <span>Rotate</span>
              <input type="range" min={-180} max={180} step={1} value={active.rotate} onChange={(e) => st.patch(active.id, { rotate: Number(e.target.value) })} />
              <span className="sec-num sec-num--text">{Math.round(active.rotate)}°</span>
            </label>
          )}
          <div className="sec-row">
            <button type="button" className="btn btn--small" title="Keep the other side of the plane" onClick={() => st.patch(active.id, { flip: !active.flip })}>⇅ Flip</button>
            <button type="button" className="btn btn--small" onClick={() => st.patch(active.id, { hidden: !active.hidden })}>{active.hidden ? 'Show' : 'Hide'}</button>
            <button type="button" className="btn btn--small btn--danger" onClick={() => st.remove(active.id)}>Remove</button>
          </div>
        </div>
      )}

      <div className="sec-label">Cut appearance</div>
      <div className="sec-field sec-field--between">
        <span><b>Solid cut</b><small>Fill the sliced faces so it reads as a section</small></span>
        <button type="button" role="switch" aria-checked={solid} className={`switch${solid ? ' on' : ''}`} onClick={() => st.setSolid(!solid)}><span className="switch__thumb" /></button>
      </div>

      {sections.length > 0 && (
        <>
          <div className="sec-label">Your sections</div>
          <div className="sec-list">
            {sections.map((s) => (
              <div key={s.id} className={`sec-item${s.id === activeId ? ' active' : ''}${s.hidden ? ' off' : ''}`} onClick={() => st.setActive(s.id)}>
                <span className="sec-item__name">{sectionName(s, sections)} · {SECTION_ORIENT_LABEL[s.orient]}</span>
                <button type="button" className="sec-icon" title={s.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); st.patch(s.id, { hidden: !s.hidden }); }}>{s.hidden ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}</button>
                <button type="button" className="sec-icon" title="Remove" onClick={(e) => { e.stopPropagation(); st.remove(s.id); }}><IconDelete width={16} height={16} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sec-label">Saved sections</div>
      {saved.length > 0 && (
        <div className="sec-list">
          {saved.map((s) => (
            <div key={s.name} className="sec-item" onClick={() => st.load(s.name)} title="Load this set (replaces the current sections)">
              <span className="sec-item__name">{s.name} <small>({s.sections.length})</small></span>
              <button type="button" className="sec-icon" title="Delete this saved set" onClick={(e) => { e.stopPropagation(); st.deleteSaved(s.name); }}><IconDelete width={16} height={16} /></button>
            </div>
          ))}
        </div>
      )}
      <form className="sec-row" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n && sections.length) { st.save(n); setName(''); } }}>
        <input type="text" value={name} placeholder="Name this set…" onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" className="btn btn--small primary" disabled={!name.trim() || sections.length === 0}>Save</button>
      </form>
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** "Section 3": numbered by when it was added. */
function sectionName(s: Section, all: Section[]): string {
  const n = Number(s.id.replace('section-', ''));
  return `Section ${Number.isFinite(n) ? n : all.indexOf(s) + 1}`;
}
