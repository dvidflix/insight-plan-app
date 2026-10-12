import { useMemo, useState } from 'react';
import { IconSectionChevron } from './icons';
import { FACET_FIELDS, FACET_LABEL, FACET_TYPES, IFC_VERSIONS, newFacet, newSpec, parseIds, serializeIds, type Cardinality, type Facet, type FacetType, type IdsDoc, type IdsValue, type Spec } from '../ids/idsDoc';

type Mode = IdsValue['kind'];
const MODES: { id: Exclude<Mode, 'raw'>; label: string }[] = [
  { id: 'any', label: 'Anything' },
  { id: 'simple', label: 'Is' },
  { id: 'enum', label: 'One of' },
  { id: 'pattern', label: 'Pattern' },
];

/** One value of a facet: anything, an exact text, one of a list (one per line or comma), or a regular expression. */
function ValueEditor({ value, onChange }: { value: IdsValue; onChange: (v: IdsValue) => void }) {
  if (value.kind === 'raw') {
    return <span className="ids-raw" title={value.xml}>(kept as it is: {value.xml.slice(0, 40)}…)</span>;
  }
  const change = (mode: Mode) => {
    if (mode === value.kind) return;
    const first = value.kind === 'simple' ? value.text : value.kind === 'pattern' ? value.pattern : value.kind === 'enum' ? value.values.join(', ') : '';
    onChange(mode === 'any' ? { kind: 'any' } : mode === 'simple' ? { kind: 'simple', text: first } : mode === 'pattern' ? { kind: 'pattern', pattern: first } : { kind: 'enum', values: first.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) });
  };
  return (
    <span className="ids-val">
      <select value={value.kind} onChange={(e) => change(e.target.value as Mode)} aria-label="How the value is given">
        {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {value.kind === 'simple' && <input value={value.text} onChange={(e) => onChange({ kind: 'simple', text: e.target.value })} aria-label="Value" />}
      {value.kind === 'pattern' && <input value={value.pattern} placeholder="regular expression" onChange={(e) => onChange({ kind: 'pattern', pattern: e.target.value })} aria-label="Pattern" />}
      {value.kind === 'enum' && <input value={value.values.join(', ')} placeholder="a, b, c" onChange={(e) => onChange({ kind: 'enum', values: e.target.value.split(',').map((x) => x.trim()) })} onBlur={() => onChange({ kind: 'enum', values: value.values.filter(Boolean) })} aria-label="Values, separated by commas" />}
    </span>
  );
}

function FacetRow({ facet, requirement, onChange, onRemove }: { facet: Facet; requirement: boolean; onChange: (f: Facet) => void; onRemove: () => void }) {
  const retype = (type: FacetType) => onChange({ ...newFacet(type, requirement), id: facet.id, cardinality: facet.cardinality, instructions: facet.instructions });
  return (
    <div className="ids-facet">
      <div className="ids-facet__top">
        <select value={facet.type} onChange={(e) => retype(e.target.value as FacetType)} aria-label="Facet type">
          {FACET_TYPES.map((t) => <option key={t} value={t}>{FACET_LABEL[t]}</option>)}
        </select>
        {requirement && facet.type !== 'entity' && (
          <select value={facet.cardinality} onChange={(e) => onChange({ ...facet, cardinality: e.target.value as Cardinality })} aria-label="Cardinality" title="Required: must be there. Optional: may be. Prohibited: must not be.">
            <option value="required">Required</option>
            <option value="optional">Optional</option>
            <option value="prohibited">Prohibited</option>
          </select>
        )}
        {facet.type === 'property' && <input className="ids-facet__small" value={facet.dataType} onChange={(e) => onChange({ ...facet, dataType: e.target.value.toUpperCase() })} placeholder="IFC data type" title="IFC data type of the value (IFCLABEL, IFCINTEGER, ...)" />}
        {facet.type === 'partOf' && <input className="ids-facet__small" value={facet.relation} onChange={(e) => onChange({ ...facet, relation: e.target.value.toUpperCase() })} placeholder="IFC relation" title="IFCRELAGGREGATES, IFCRELCONTAINEDINSPATIALSTRUCTURE, ..." />}
        <input className="ids-facet__note" value={facet.instructions} onChange={(e) => onChange({ ...facet, instructions: e.target.value })} placeholder="Instructions (optional)" />
        <button type="button" className="ge-x" onClick={onRemove} title="Remove" aria-label="Remove">{'✕'}</button>
      </div>
      <div className="ids-facet__fields">
        {FACET_FIELDS[facet.type].map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <ValueEditor value={facet.values[f.key] ?? { kind: 'any' }} onChange={(v) => onChange({ ...facet, values: { ...facet.values, [f.key]: v } })} />
          </label>
        ))}
      </div>
    </div>
  );
}

function FacetList({ title, hint, facets, requirement, onChange }: { title: string; hint: string; facets: Facet[]; requirement: boolean; onChange: (f: Facet[]) => void }) {
  return (
    <div className="ids-list">
      <div className="ge-sec__bar">
        <span title={hint}>{title}</span>
        <button type="button" className="ge-add" onClick={() => onChange([...facets, newFacet(requirement ? 'property' : 'entity', requirement)])}>+ facet</button>
      </div>
      <div className="ids-list__body">
        {facets.map((f) => <FacetRow key={f.id} facet={f} requirement={requirement} onChange={(next) => onChange(facets.map((x) => (x.id === f.id ? next : x)))} onRemove={() => onChange(facets.filter((x) => x.id !== f.id))} />)}
        {facets.length === 0 && <div className="ge-none">{requirement ? 'No requirement yet: every applicable element passes.' : 'No facet: the specification applies to every element.'}</div>}
      </div>
    </div>
  );
}

function SpecEditor({ spec, open, onToggle, onChange, onRemove }: { spec: Spec; open: boolean; onToggle: () => void; onChange: (s: Spec) => void; onRemove: () => void }) {
  const versions = spec.ifcVersion.split(/\s+/).filter(Boolean);
  const toggleVersion = (v: string) => onChange({ ...spec, ifcVersion: (versions.includes(v) ? versions.filter((x) => x !== v) : [...versions, v]).join(' ') });
  return (
    <section className="ge-sec ids-spec">
      <div className="ids-spec__head">
        <button type="button" className="ids-spec__toggle" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}><IconSectionChevron className="section-chevron" /></button>
        <input className="ids-spec__name" value={spec.name} onChange={(e) => onChange({ ...spec, name: e.target.value })} placeholder="Specification name" aria-label="Specification name" />
        <span className="ids-spec__count">{spec.applicability.length} applies · {spec.requirements.length} requires</span>
        <button type="button" className="ge-x" onClick={() => { if (window.confirm(`Remove "${spec.name}"?`)) onRemove(); }} title="Remove the specification" aria-label="Remove the specification">{'✕'}</button>
      </div>
      {open && (
        <div className="ids-spec__body">
          <div className="ids-spec__meta">
            <label><span>Identifier</span><input value={spec.identifier} onChange={(e) => onChange({ ...spec, identifier: e.target.value })} placeholder="e.g. CWA-POUR-CLASS" /></label>
            <label><span>IFC versions</span>
              <span className="ids-spec__versions">{IFC_VERSIONS.map((v) => <button key={v} type="button" className={`tags__chip${versions.includes(v) ? ' active' : ''}`} aria-pressed={versions.includes(v)} onClick={() => toggleVersion(v)}>{v}</button>)}</span>
            </label>
            <label className="ids-spec__wide"><span>Description</span><input value={spec.description} onChange={(e) => onChange({ ...spec, description: e.target.value })} /></label>
            <label className="ids-spec__wide"><span>Instructions (how to fix a failure)</span><input value={spec.instructions} onChange={(e) => onChange({ ...spec, instructions: e.target.value })} /></label>
          </div>
          <FacetList title="Applies to" hint="Which elements the specification is about" facets={spec.applicability} requirement={false} onChange={(applicability) => onChange({ ...spec, applicability })} />
          <FacetList title="Must have" hint="What each of those elements must satisfy" facets={spec.requirements} requirement onChange={(requirements) => onChange({ ...spec, requirements })} />
        </div>
      )}
    </section>
  );
}

/** Edits an IDS file: its details and specifications, each with what it applies to and what it requires. Saves as .ids. */
export function IdsEditor({ name, xml, canSave, onSave, onClose }: {
  /** The file's name, or null for a new file (named on saving). */
  name: string | null;
  xml: string | null;
  /** Saved into the app's IDS library (docs/ids), not just downloaded. */
  canSave: boolean;
  onSave: (fileName: string, xml: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const parsed = useMemo(() => {
    try {
      return { doc: xml ? parseIds(xml) : null, error: '' };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [xml]);
  const [doc, setDoc] = useState<IdsDoc>(() => parsed.doc ?? { title: 'New IDS', description: '', author: '', version: '1', date: new Date().toISOString().slice(0, 10), purpose: '', specs: [newSpec(1)] });
  const [fileName, setFileName] = useState(name ?? '');
  const [openSpecs, setOpenSpecs] = useState<Set<string>>(() => new Set(doc.specs.length === 1 ? [doc.specs[0].id] : []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);
  const edit = (next: IdsDoc) => { setDoc(next); setDirty(true); };
  const toggle = (id: string) => setOpenSpecs((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const finalName = (fileName.trim() || doc.title.trim() || 'checks').replace(/[\\/:*?"<>|]+/g, '_').replace(/(\.ids)?$/i, '.ids');
  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      await onSave(finalName, serializeIds(doc));
      setDirty(false);
      setMsg(canSave ? `Saved ${finalName} to the IDS library.` : `Downloaded ${finalName}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { if (!dirty || window.confirm('Close without saving your changes?')) onClose(); };

  if (parsed.error) {
    return <div className="model-checks"><div className="model-checks__msg model-checks__msg--error">{name}: {parsed.error}</div><div className="model-checks__bar"><button type="button" className="btn" onClick={onClose}>Back</button></div></div>;
  }
  return (
    <div className="model-checks ids-editor">
      <div className="model-checks__bar">
        <button type="button" className="btn" onClick={close}>‹ Back</button>
        <button type="button" className="btn primary" disabled={busy || doc.specs.length === 0} onClick={() => void save()} title={canSave ? 'Save into docs/ids' : 'Download the .ids file'}>{canSave ? 'Save' : 'Download .ids'}</button>
        <button type="button" className="btn" onClick={close} title="Close without saving">Cancel</button>
        <span className="ids-editor__state">{dirty ? 'unsaved changes' : ''}</span>
      </div>
      {msg && <div className="model-checks__msg model-checks__msg--ok">{msg}</div>}
      <div className="ids-editor__body">
        <section className="ge-sec">
          <div className="ids-info">
            <label><span>File name</span><input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={finalName} disabled={name !== null} title={name !== null ? 'The file keeps its name (to rename it, save a copy under a new name)' : undefined} /></label>
            <label><span>Title</span><input value={doc.title} onChange={(e) => edit({ ...doc, title: e.target.value })} /></label>
            <label><span>Author (e-mail)</span><input value={doc.author} onChange={(e) => edit({ ...doc, author: e.target.value })} /></label>
            <label><span>Version</span><input value={doc.version} onChange={(e) => edit({ ...doc, version: e.target.value })} /></label>
            <label className="ids-spec__wide"><span>Description</span><input value={doc.description} onChange={(e) => edit({ ...doc, description: e.target.value })} /></label>
          </div>
        </section>
        <div className="ge-sec__bar ids-editor__bar">
          <span>Specifications ({doc.specs.length})</span>
          <button type="button" className="ge-add" onClick={() => { const s = newSpec(doc.specs.length + 1); edit({ ...doc, specs: [...doc.specs, s] }); setOpenSpecs((o) => new Set(o).add(s.id)); }}>+ specification</button>
        </div>
        {doc.specs.map((s) => (
          <SpecEditor key={s.id} spec={s} open={openSpecs.has(s.id)} onToggle={() => toggle(s.id)} onChange={(next) => edit({ ...doc, specs: doc.specs.map((x) => (x.id === s.id ? next : x)) })} onRemove={() => edit({ ...doc, specs: doc.specs.filter((x) => x.id !== s.id) })} />
        ))}
      </div>
    </div>
  );
}
