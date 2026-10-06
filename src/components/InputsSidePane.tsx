import { useMemo } from 'react';
import { usePersistedState } from '../utils/persistedState';
import { SidePane } from './SidePane';
import { ColumnsPanel } from './schedule/ColumnsPanel';
import { GroupPanel } from './schedule/GroupPanel';
import { SortPanel } from './schedule/SortPanel';
import { InputsFilters } from './InputDetails';
import { ScenesPanel } from './ScenesPanel';
import { IconColumns, IconFilter, IconGroup, IconScenes, IconSort } from './icons';
import { BUILT_IN_GROUPS, DEFAULT_INPUT_COLUMNS, INPUT_COLUMNS, useInputDetailsStore } from '../state/inputDetailsStore';

type TabId = 'scenes' | 'columns' | 'filters' | 'group' | 'sort';

const DETAILS = 'SeaTable details';

/** The Inputs page's tabs in the side pane, like the Programmes page's: Columns, Filters, Group and Sort of the files list. */
export function InputsSidePane({ onCollapseAll, onExpandAll }: { onCollapseAll: () => void; onExpandAll: () => void }) {
  // The tab is remembered (and so goes with the scene).
  const [tab, setTab] = usePersistedState<TabId>('inputs.sideTab', 'columns');
  const fields = useInputDetailsStore((s) => s.fields);
  const columns = useInputDetailsStore((s) => s.columns);
  const groupRules = useInputDetailsStore((s) => s.groupRules);
  const filters = useInputDetailsStore((s) => s.filters);
  const sortRules = useInputDetailsStore((s) => s.sortRules);
  const groupCombine = useInputDetailsStore((s) => s.groupCombine);
  const { setColumns, setGroupRules, setGroupCombine, setSortRules } = useInputDetailsStore.getState();

  const catalog = useMemo(() => [...INPUT_COLUMNS, ...fields.map((f) => ({ id: f, label: f, group: DETAILS }))], [fields]);
  // Group on the type, format, folder or a detail; sort on any column but the box.
  const groupFields = useMemo(
    () => [...BUILT_IN_GROUPS.filter((g) => g.id !== 'none').map((g) => ({ ...g, group: 'File' })), ...fields.map((f) => ({ id: f, label: f, group: DETAILS }))],
    [fields],
  );
  const sortFields = useMemo(() => catalog.filter((c) => c.id !== 'bounds'), [catalog]);

  const tabs = [
    { id: 'scenes' as const, label: 'Scenes', icon: <IconScenes />, body: <ScenesPanel /> },
    { id: 'columns' as const, label: 'Columns', icon: <IconColumns />, body: (
      <ColumnsPanel
        key={fields.join()}
        catalog={catalog}
        views={[{ id: 'files', label: 'Files', selected: columns, defaults: [...DEFAULT_INPUT_COLUMNS, ...fields.filter((f) => ['Discipline', 'Building', 'Status'].includes(f))], onChange: setColumns }]}
        presets={[
          { id: 'compact', label: 'Compact', ids: ['type', 'name'] },
          { id: 'sizes', label: 'Sizes', ids: ['type', 'name', 'items', 'size'] },
          { id: 'details', label: 'Details', ids: ['type', 'name', ...fields] },
        ]}
        groupOrder={['File', DETAILS]}
        closedGroups={[]}
      />
    ) },
    { id: 'filters' as const, label: 'Filters', icon: <IconFilter />, badge: Object.keys(filters).length, body: <InputsFilters /> },
    { id: 'group' as const, label: 'Group', icon: <IconGroup />, badge: groupRules.length, body: (
      <GroupPanel
        bare
        fields={groupFields}
        presets={[{ label: 'Project / Building', fields: ['Project', 'Building'] }, { label: 'Type', fields: ['type'] }, { label: 'Discipline', fields: ['Discipline'] }]}
        rules={groupRules}
        onChange={setGroupRules}
        extraToggle={{ label: "Levels on one line", tip: "On: several fields make one group per combination, its header the values joined by \"  |  \" (Project A  |  Area 1  |  Building 2). Off: each field is a level nested in the one before.", on: groupCombine, onToggle: () => setGroupCombine(!groupCombine) }}
        onClose={() => {}}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
      />
    ) },
    { id: 'sort' as const, label: 'Sort', icon: <IconSort />, badge: sortRules.length, body: (
      <SortPanel
        bare
        fields={sortFields}
        rules={sortRules}
        onChange={setSortRules}
        onClose={() => {}}
        presets={[
          { label: 'Name', rules: [{ field: 'name', direction: 'up' }] },
          { label: 'Type', rules: [{ field: 'type', direction: 'up' }, { field: 'name', direction: 'up' }] },
          { label: 'Most items', rules: [{ field: 'items', direction: 'down' }] },
          { label: 'Largest', rules: [{ field: 'size', direction: 'down' }] },
        ]}
      />
    ) },
  ];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <SidePane tabs={tabs} active={active.id} onSelect={setTab} inputsSettings>
      {active.body}
    </SidePane>
  );
}
