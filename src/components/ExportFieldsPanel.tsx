import { useMemo, useState } from 'react';
import { useScheduleStore } from '../state/scheduleStore';
import { collectUdfKeys } from '../schedule/filterFields';
import { useExportExclusionsStore } from '../schedule/exportFilter';
import { PRECAST_RESOURCE } from '../schedule/virtualResources';
import { IconSectionChevron } from './icons';
import { InfoTip } from './InfoTip';

type Kind = 'udfs' | 'resources' | 'codes';
const GROUPS: { kind: Kind; title: string }[] = [
  { kind: 'udfs', title: 'User fields' },
  { kind: 'resources', title: 'Resources' },
  { kind: 'codes', title: 'Activity codes' },
];

/** Project database › Exports (XML / XER): choose what leaves the app in the XML and
    XER files (the scenario downloads and the programmes downloaded from Inputs).
    Unticked user fields, resources and activity codes are for your own use and
    are left out, with every value and assignment that points at them. App-only
    resources (Precast (m3)) are the other way round: out unless ticked. */
export function ExportFieldsPanel() {
  const schedules = useScheduleStore((s) => s.schedules);
  const excluded = useExportExclusionsStore();
  const [open, setOpen] = useState(false);

  const names = useMemo(() => {
    const out: Record<Kind, Set<string>> = { udfs: new Set(), resources: new Set(), codes: new Set() };
    for (const m of schedules) {
      for (const k of collectUdfKeys(m)) out.udfs.add(k);
      for (const r of m.resourceCatalog ?? []) if (!r.virtual) out.resources.add(r.name);
      for (const a of m.activities) for (const r of a.resources) if (!r.virtual) out.resources.add(r.resourceName);
      for (const c of m.activityCodeTypes) out.codes.add(c);
    }
    // Names already set to stay out are listed even when no programme with them is loaded.
    for (const g of GROUPS) for (const n of excluded[g.kind]) out[g.kind].add(n);
    return Object.fromEntries(GROUPS.map((g) => [g.kind, [...out[g.kind]].sort((a, b) => a.localeCompare(b))])) as Record<Kind, string[]>;
  }, [schedules, excluded.udfs, excluded.resources, excluded.codes]); // eslint-disable-line react-hooks/exhaustive-deps

  const virtualIn = excluded.includeVirtual.includes(PRECAST_RESOURCE);
  const total = excluded.udfs.length + excluded.resources.length + excluded.codes.length;

  return (
    <div className="inputs-panel export-fields">
      <div className="inputs-panel__header">
        <button type="button" className="export-fields__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <IconSectionChevron className="section-chevron" />
          <span>Exports (XML / XER)</span>
        </button>
        <InfoTip>Tick what goes into the XML and XER files you download (scenario programmes, and programmes from the Inputs list). Untick the user fields, resources and activity codes that are for your own use: they stay in the app but are left out of the files, with their values and assignments. The app-only Precast (m3) resource is left out unless you tick it.</InfoTip>
        <span className="inputs-panel__count" title="Left out of exports">{total}</span>
      </div>
      {open && (
        <div className="inputs-panel__body export-fields__body">
          {GROUPS.map(({ kind, title }) => {
            const list = names[kind];
            const out = excluded[kind];
            const extra = kind === 'resources' ? 1 : 0;
            const exported = list.length - out.length + (extra && virtualIn ? 1 : 0);
            return (
              <div key={kind} className="export-fields__group">
                <div className="export-fields__head">
                  <b>{title}</b>
                  <span className="export-fields__count">{exported}/{list.length + extra} exported</span>
                  <span className="export-fields__bulk">
                    <button type="button" className="cols__link" onClick={() => excluded.setMany(kind, list, false)}>All</button>
                    <button type="button" className="cols__link" onClick={() => excluded.setMany(kind, list, true)}>None</button>
                  </span>
                </div>
                {list.length === 0 && !extra && <div className="flt__hint">None in the loaded programmes.</div>}
                <div className="export-fields__list">
                  {list.map((n) => (
                    <label key={n} className={`cols__check${out.includes(n) ? ' export-fields__off' : ''}`}>
                      <input type="checkbox" checked={!out.includes(n)} onChange={(e) => excluded.setExcluded(kind, n, !e.target.checked)} />
                      <span title={n}>{n}</span>
                    </label>
                  ))}
                  {kind === 'resources' && (
                    <label className={`cols__check${virtualIn ? '' : ' export-fields__off'}`} title="App-only: the precast concrete (m³) of each Precast Installation activity. Left out unless ticked.">
                      <input type="checkbox" checked={virtualIn} onChange={(e) => excluded.setIncludeVirtual(PRECAST_RESOURCE, e.target.checked)} />
                      <span>◇ {PRECAST_RESOURCE}</span>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
