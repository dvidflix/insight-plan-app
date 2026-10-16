import { useMemo } from 'react';
import { ToolPopover } from './TablePopovers';
import { ColumnsPanel } from './schedule/ColumnsPanel';
import { GroupPanel } from './schedule/GroupPanel';
import { SortPanel } from './schedule/SortPanel';
import { InputsFilters } from './InputDetails';
import { IconColumns, IconFilter, IconGroup, IconSort } from './icons';
import { BUILT_IN_GROUPS, DEFAULT_INPUT_COLUMNS, INPUT_COLUMNS, useInputDetailsStore } from '../state/inputDetailsStore';

const DETAILS = 'SeaTable details';

/** The Files table's tools, as SeaTable has them: Filter, Sort, Group and Columns, each a popover under its button. */
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
    <span className="tp-row">
      <ToolPopover icon={<IconFilter width={16} height={16} />} label="Filter" active={filterCount} activeLabel={`${filterCount} filter${filterCount === 1 ? '' : 's'}`} width={540}>
        <InputsFilters />
      </ToolPopover>
      <ToolPopover icon={<IconSort width={16} height={16} />} label="Sort" active={sortRules.length} activeLabel={`${sortRules.length} sort${sortRules.length === 1 ? '' : 's'}`}>
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
      </ToolPopover>
      <ToolPopover icon={<IconGroup width={16} height={16} />} label="Group" active={groupRules.length} activeLabel={`Grouped by ${groupRules.length}`}>
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
      </ToolPopover>
      <ToolPopover icon={<IconColumns width={16} height={16} />} label="Columns">
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
      </ToolPopover>
    </span>
  );
}
