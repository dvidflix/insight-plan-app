import { useMemo } from 'react';
import { ListConfig } from './ListConfig';
import { ColumnsPanel } from './schedule/ColumnsPanel';
import { GroupPanel } from './schedule/GroupPanel';
import { SortPanel } from './schedule/SortPanel';
import { InputsFilters } from './InputDetails';
import { BUILT_IN_GROUPS, DEFAULT_INPUT_COLUMNS, INPUT_COLUMNS, useInputDetailsStore } from '../state/inputDetailsStore';

const DETAILS = 'SeaTable details';

/** The Files table's Filter, Sort, Group and Columns, given to the shared List setup panel (no buttons of its own). */
export function InputsTools({ onCollapseAll, onExpandAll }: { onCollapseAll: () => void; onExpandAll: () => void }) {
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
  const filterCount = Object.keys(filters).length;

  return (
    <ListConfig
      id="files"
      label="Files"
      badges={{ filters: filterCount, sort: sortRules.length, group: groupRules.length }}
      panels={{
        filters: <InputsFilters />,
        sort: (
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
        ),
        group: (
          <GroupPanel
            bare
            fields={groupFields}
            presets={[{ label: 'Project / Building', fields: ['Project', 'Building'] }, { label: 'Type', fields: ['type'] }, { label: 'Discipline', fields: ['Discipline'] }]}
            rules={groupRules}
            onChange={setGroupRules}
            extraToggle={{ label: 'Levels on one line', tip: 'On: several fields make one group per combination, its header the values joined by "  |  " (Project A  |  Area 1  |  Building 2). Off: each field is a level nested in the one before.', on: groupCombine, onToggle: () => setGroupCombine(!groupCombine) }}
            onClose={() => {}}
            onCollapseAll={onCollapseAll}
            onExpandAll={onExpandAll}
          />
        ),
        columns: (
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
        ),
      }}
    />
  );
}
