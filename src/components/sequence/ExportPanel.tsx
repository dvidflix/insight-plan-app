import { useMemo, useRef, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import type { ElementSummary } from '../../viewer/types';
import { samplePropKeys } from '../../viewer/query';
import { objectFieldKey, parseObjectFieldKey } from '../../schedule/linkGroups';
import { buildNavisworksPack, defaultNaming, parseNavisworksTemplate, type NwNaming } from '../../schedule/navisworksExport';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useAppearanceStore } from '../../state/appearanceStore';
import { downloadText } from '../../scenarios/api';
import { InfoTip } from '../InfoTip';

/** 4D Sequencing > Views > Navisworks TimeLiner: the current schedule +
    Link Groups as a Navisworks TimeLiner pack (search sets + TimeLiner CSV +
    steps). */
export function NavisworksExport({ schedule, models, basis }: { schedule: ScheduleModel; models: { elements: ElementSummary[] }[]; basis: 'planned' | 'actual' }) {
  const groups = useLinkGroupsStore((s) => s.groups);
  const profiles = useAppearanceStore((s) => s.profiles);
  const allElements = useMemo(() => models.flatMap((m) => m.elements), [models]);
  const keys = useMemo(() => samplePropKeys(allElements).filter((k) => k === '_name' || !k.startsWith('_')), [allElements]);

  // Default: the object property the Link Groups match tasks on.
  const defaultKey = useMemo(() => {
    const rule = groups.flatMap((g) => g.matchRules)[0];
    return rule ? objectFieldKey(rule.objectPropertySet, rule.objectAttribute) : keys.find((k) => k !== '_name') ?? '_name';
  }, [groups, keys]);
  const [picked, setPicked] = useState<string | null>(null);
  const keyStr = picked ?? defaultKey;
  const key = parseObjectFieldKey(keyStr);

  const [template, setTemplate] = useState<NwNaming | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const naming = template ?? defaultNaming(key);

  const pack = useMemo(
    () => buildNavisworksPack({ schedule, models, groups, profiles, key, naming, basis }),
    // key is derived from keyStr
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, models, groups, profiles, keyStr, naming, basis],
  );
  const base = schedule.sourceFileName.replace(/\.(xml|xer)$/i, '').replace(/[<>:"/\\|?*]+/g, '_');
  const { stats } = pack;

  const loadTemplate = async (file: File) => {
    setTemplateError(null);
    try {
      setTemplate(parseNavisworksTemplate(await file.text()));
    } catch (e) {
      setTemplate(null);
      setTemplateError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="disp">
      <label className="disp__row">
        <span>
          Find objects by{' '}
          <InfoTip>One search set per linked task, named like the task, plus a TimeLiner schedule with the same names; in Navisworks, Auto-Attach by name links them all.</InfoTip>
        </span>
        <select value={keyStr} onChange={(e) => setPicked(e.target.value)} style={{ maxWidth: 200 }}>
          {keys.map((k) => (
            <option key={k} value={k}>{k === '_name' ? 'Name' : k}</option>
          ))}
        </select>
      </label>

      <div className="cols__heading">
        <span>
          Navisworks property names{' '}
          <InfoTip>For an exact match with your Navisworks, export one search set on this property from it (add a second line with OR for tasks with several objects) and load it here.</InfoTip>
        </span>
      </div>
      <div className="flt__hint">
        {template ? (
          <>From your search set: <b>{naming.categoryDisplay} › {naming.propertyDisplay}</b>{naming.orFlags ? ' (with OR)' : ''}.</>
        ) : (
          <>Default (legacy IFC reader): <b>{naming.categoryDisplay} › {naming.propertyDisplay}</b>.</>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>Load Navisworks search set…</button>
        {template && <button type="button" className="btn btn--small" onClick={() => setTemplate(null)}>Use default</button>}
        <input
          ref={fileRef}
          type="file"
          accept=".xml"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadTemplate(f);
            e.target.value = '';
          }}
        />
      </div>
      {templateError && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{templateError}</div>}

      <div className="cols__heading">
        <span>
          Pack{' '}
          <InfoTip label="Using the pack in Navisworks">
            <ol>
              <li>Append the IFC model(s) in Navisworks Manage.</li>
              <li>Sets › Import Search Sets › the .xml.</li>
              <li>TimeLiner › Data Sources › Add › CSV Import › the .csv (row 1 = headings; map Sync ID, Task Name, Task Type, dates).</li>
              <li>Rebuild Task Hierarchy, then Auto-Attach Using Rules › “tasks to Selection Sets with the same name”.</li>
            </ol>
          </InfoTip>
        </span>
      </div>
      <div className="flt__hint">
        {stats.tasks} tasks · {stats.linkedTasks} linked · {stats.sets} search sets
        {stats.splitSets ? ` · ${stats.multiValue} tasks split (need an OR template)` : ''}
        {stats.noValue ? ` · ${stats.noValue} objects without a value` : ''}
      </div>
      {groups.length === 0 && <div className="flt__hint" style={{ color: 'var(--danger)' }}>No Link Groups yet — tasks need links to get search sets.</div>}
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        <button type="button" className="btn primary" disabled={!stats.sets} onClick={() => downloadText(`${base}_SearchSets.xml`, pack.setsXml, 'application/xml')}>Download search sets (.xml)</button>
        <button type="button" className="btn" onClick={() => downloadText(`${base}_TimeLiner.csv`, pack.csv, 'text/csv;charset=utf-8')}>Download TimeLiner schedule (.csv)</button>
        <button type="button" className="btn" onClick={() => downloadText(`${base}_Navisworks_README.txt`, pack.readme, 'text/plain;charset=utf-8')}>Download steps (.txt)</button>
      </div>
    </div>
  );
}
