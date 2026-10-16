import { useMemo, useState } from 'react';
import { ToolPopover } from './TablePopovers';
import { GroupPanel } from './schedule/GroupPanel';
import { SortPanel } from './schedule/SortPanel';
import { IconFilter, IconGroup, IconRemove, IconSort } from './icons';
import { NO_VALUE } from '../state/inputDetailsStore';
import { SCENE_BUILT_INS, sceneMatches, useSceneDetailsStore, valuesOfScene } from '../state/sceneDetailsStore';
import type { Scene } from '../state/scenes';

const DETAILS = 'Details';
const labelOf = (v: string) => (v === NO_VALUE ? '(none)' : v);

/** Home's Filter: keep only the scenes with chosen values of a field, every value listed with how many scenes it would leave. */
function SceneFilters({ scenes }: { scenes: Scene[] }) {
  const fields = useSceneDetailsStore((s) => s.fields);
  const filters = useSceneDetailsStore((s) => s.filters);
  const details = useSceneDetailsStore((s) => s.values);
  const { setFilter, clearFilters } = useSceneDetailsStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const keys = useMemo(() => [...SCENE_BUILT_INS.filter((b) => b.id === 'programme'), ...fields.filter((f) => f !== 'Notes').map((f) => ({ id: f, label: f }))], [fields]);
  const matched = useMemo(() => scenes.filter((s) => sceneMatches(s, filters, details)).length, [scenes, filters, details]);
  const valuesOf = (key: string) => {
    const counts = new Map<string, number>();
    for (const s of scenes) {
      const all = valuesOfScene(key, s, details).filter(Boolean);
      const pass = sceneMatches(s, filters, details, key);
      for (const v of all.length ? all : [NO_VALUE]) counts.set(v, (counts.get(v) ?? 0) + (pass ? 1 : 0));
    }
    for (const v of filters[key] ?? []) if (!counts.has(v)) counts.set(v, 0);
    return [...counts].sort(([a], [b]) => (a === NO_VALUE ? 1 : b === NO_VALUE ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  };
  return (
    <div className="flt flt--inputs">
      <div className="flt__result">
        <div className="flt__result-text"><b>{matched}</b> of {scenes.length} scenes{scenes.length > 0 && matched === 0 && <span className="flt__none"> — no matches</span>}</div>
        <button type="button" className="cols__link" disabled={Object.keys(filters).length === 0} onClick={clearFilters}>Clear all</button>
      </div>
      {keys.map((k) => {
        const kept = filters[k.id] ?? [];
        const isOpen = open === k.id;
        return (
          <div key={k.id} className={`flt__field${kept.length ? ' active' : ''}`}>
            <div className="flt__field-head">
              <button type="button" className="flt__field-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k.id)}>
                <span className="flt__field-label">{k.label}</span>
                {kept.length > 0 && <span className="flt__field-sum">{kept.length <= 2 ? kept.map(labelOf).join(', ') : `${kept.length} values`}</span>}
              </button>
              {kept.length > 0 && <button type="button" className="cols__icon cols__icon--remove" onClick={() => setFilter(k.id, [])} aria-label={`Clear ${k.label}`} title="Clear"><IconRemove /></button>}
            </div>
            {isOpen && (
              <div className="flt__field-body">
                <div className="flt__values">
                  {valuesOf(k.id).map(([v, n]) => (
                    <label key={v} className={`cols__check${n === 0 && !kept.includes(v) ? ' flt__zero' : ''}`}>
                      <input type="checkbox" checked={kept.includes(v)} onChange={() => setFilter(k.id, kept.includes(v) ? kept.filter((x) => x !== v) : [...kept, v])} />
                      <span title={labelOf(v)}>{labelOf(v)}</span>
                      <span className="flt__n">{n}</span>
                    </label>
                  ))}
                  {scenes.length === 0 && <div className="flt__hint">No scenes.</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Home's tools, as the Files table has them: Filter, Sort and Group, each a popover under its button. */
export function SceneTools({ scenes, onCollapseAll, onExpandAll }: { scenes: Scene[]; onCollapseAll: () => void; onExpandAll: () => void }) {
  const fields = useSceneDetailsStore((s) => s.fields);
  const filters = useSceneDetailsStore((s) => s.filters);
  const sortRules = useSceneDetailsStore((s) => s.sortRules);
  const groupRules = useSceneDetailsStore((s) => s.groupRules);
  const groupCombine = useSceneDetailsStore((s) => s.groupCombine);
  const { setSortRules, setGroupRules, setGroupCombine } = useSceneDetailsStore.getState();
  const detailFields = useMemo(() => fields.filter((f) => f !== 'Notes').map((f) => ({ id: f, label: f, group: DETAILS })), [fields]);
  const sortFields = useMemo(() => [...SCENE_BUILT_INS.map((b) => ({ ...b, group: 'Scene' })), ...detailFields], [detailFields]);
  const groupFields = useMemo(() => [...SCENE_BUILT_INS.filter((b) => b.id === 'programme').map((b) => ({ ...b, group: 'Scene' })), ...detailFields], [detailFields]);
  const filterCount = Object.keys(filters).length;
  return (
    <span className="tp-row">
      <ToolPopover icon={<IconFilter width={16} height={16} />} label="Filter" active={filterCount} activeLabel={`${filterCount} filter${filterCount === 1 ? '' : 's'}`} width={400}>
        <SceneFilters scenes={scenes} />
      </ToolPopover>
      <ToolPopover icon={<IconSort width={16} height={16} />} label="Sort" active={sortRules.length} activeLabel={`${sortRules.length} sort${sortRules.length === 1 ? '' : 's'}`}>
        <SortPanel
          bare
          fields={sortFields}
          rules={sortRules}
          onChange={setSortRules}
          onClose={() => {}}
          presets={[
            { label: 'Latest saved', rules: [{ field: 'saved', direction: 'down' }] },
            { label: 'Name', rules: [{ field: 'name', direction: 'up' }] },
            { label: 'Status', rules: [{ field: 'Status', direction: 'up' }, { field: 'name', direction: 'up' }] },
          ]}
        />
      </ToolPopover>
      <ToolPopover icon={<IconGroup width={16} height={16} />} label="Group" active={groupRules.length} activeLabel={`Grouped by ${groupRules.length}`}>
        <GroupPanel
          bare
          fields={groupFields}
          presets={[{ label: 'Project / Area', fields: ['Project', 'Area'] }, { label: 'Status', fields: ['Status'] }, { label: 'Project', fields: ['Project'] }]}
          rules={groupRules}
          onChange={setGroupRules}
          extraToggle={{ label: 'Levels on one line', tip: 'On: several fields make one group per combination ("Project A  |  Area 1"). Off: each field is a level nested in the one before.', on: groupCombine, onToggle: () => setGroupCombine(!groupCombine) }}
          onClose={() => {}}
          onCollapseAll={onCollapseAll}
          onExpandAll={onExpandAll}
        />
      </ToolPopover>
    </span>
  );
}
