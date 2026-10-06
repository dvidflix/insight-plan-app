import { useEffect, useRef, useState } from 'react';
import { layoutProfiles, START_PAGE_KEY, type LayoutProfile } from '../state/layoutProfiles';

const START_PAGES = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'model', label: 'Models' },
  { id: 'schedule', label: 'Programmes' },
  { id: 'sequence', label: '4D Sequencing' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'timelines', label: 'Timelines' },
  { id: 'external', label: 'External data' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'wiki', label: 'Wiki' },
];

/** Settings › Layout profiles: save the whole arrangement of the app (start page, tabs, panel and column sizes,
    column choices, rules, view settings…) under a name, export / import it as a JSON file, pick the Default
    template and have the app start from it. */
export function LayoutProfilesPanel() {
  const [store, setStore] = useState(layoutProfiles.get);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startPage, setStartPage] = useState(() => localStorage.getItem(START_PAGE_KEY) ?? 'inputs');
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => setStore(layoutProfiles.get());
    window.addEventListener('ip-layout-profiles', refresh);
    return () => window.removeEventListener('ip-layout-profiles', refresh);
  }, []);

  const apply = (p: LayoutProfile) => {
    if (window.confirm(`Apply “${p.name}”? The page reloads with this layout (models loaded now are unloaded).`)) layoutProfiles.apply(p.id);
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const exists = store.profiles.some((p) => p.name.toLowerCase() === n.toLowerCase());
    if (exists && !window.confirm(`Replace the profile “${n}” with the current layout?`)) return;
    layoutProfiles.save(n);
    setName('');
  };

  return (
    <>
      <label className="disp__row">
        <span>Open on</span>
        <select value={startPage} onChange={(e) => { setStartPage(e.target.value); localStorage.setItem(START_PAGE_KEY, e.target.value); }}>
          {START_PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <input type="text" value={name} placeholder="Profile name…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="btn" onClick={save} disabled={!name.trim()} title="Save how the app is arranged now under this name">Save current</button>
      </div>
      {store.profiles.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No profiles yet. Arrange the app as you like, give it a name and save it; the first one saved is the Default.</div>}
      {store.profiles.map((p) => {
        const isDefault = store.defaultId === p.id;
        return (
          <div key={p.id} className="disp__row" style={{ gap: 4, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 90 }} title={`Saved ${new Date(p.savedAt).toLocaleString()} · ${Object.keys(p.settings).length} settings`}>
              {isDefault ? '★ ' : ''}{p.name}{isDefault ? ' (Default)' : ''}
            </span>
            <button type="button" className="mini-btn" onClick={() => apply(p)} title="Load this layout (reloads the page)">Apply</button>
            <button type="button" className="mini-btn" onClick={() => { if (window.confirm(`Replace “${p.name}” with the current layout?`)) layoutProfiles.update(p.id); }} title="Overwrite this profile with the layout as it is now">Update</button>
            <button type="button" className="mini-btn" onClick={() => layoutProfiles.setDefault(isDefault ? null : p.id)} title={isDefault ? 'Stop using this as the Default' : 'Make this the Default template'}>{isDefault ? 'Unset default' : 'Set default'}</button>
            <button type="button" className="mini-btn" onClick={() => layoutProfiles.exportProfile(p.id)} title="Download as a JSON file">Export</button>
            <button type="button" className="mini-btn danger" onClick={() => { if (window.confirm(`Delete the profile “${p.name}”?`)) layoutProfiles.remove(p.id); }} title="Delete this profile" aria-label={`Delete ${p.name}`}>✕</button>
          </div>
        );
      })}
      <div className="disp__row">
        <span>Start from the Default every time</span>
        <button
          type="button"
          role="switch"
          aria-checked={store.startFromDefault}
          disabled={!store.defaultId}
          className={`switch${store.startFromDefault ? ' on' : ''}`}
          onClick={() => layoutProfiles.setStartFromDefault(!store.startFromDefault)}
          title={store.defaultId ? 'Each time the app opens, the Default profile replaces the layout, so changes made in a session are not kept' : 'Set a Default profile first'}
        >
          <span className="switch__thumb" />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" className="btn" onClick={() => importRef.current?.click()}>Import profile…</button>
        {store.defaultId && <button type="button" className="btn" onClick={() => { const p = store.profiles.find((x) => x.id === store.defaultId); if (p) apply(p); }} title="Load the Default template">Reset to Default</button>}
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          layoutProfiles.importProfile(f).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }}
      />
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </>
  );
}
