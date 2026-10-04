import { useMemo, useState } from 'react';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useScheduleStore, useVisibleSchedules } from '../../state/scheduleStore';
import { runSearchSet } from '../../viewer/searchSets';
import type { GroupLinkResult } from '../../schedule/linkGroups';
import { DEFAULT_METHODS_FIELD, SET_MATCH_OPTIONS, planSetNames, type SetMatch } from '../../schedule/setNamesToField';
import { usePersistedState } from '../../utils/persistedState';

/** 4D tab > Task fields from search sets: writes the name of the search set(s)
    holding a task's linked objects into a task field (a user-defined field),
    so the method / break-down names travel with the programme (Gantt and Tasks
    columns > User Fields, filters, exports). */
export function TaskFieldFromSets({ results }: { results: { modelId: string; links: GroupLinkResult }[] }) {
  const engine = useViewerEngine();
  const sets = useSearchSetsStore((s) => s.sets);
  const visible = useVisibleSchedules();
  const setActivityField = useScheduleStore((s) => s.setActivityField);
  const [field, setField] = usePersistedState('sequence.setNamesField', DEFAULT_METHODS_FIELD);
  const [folder, setFolder] = usePersistedState('sequence.setNamesFolder', '');
  const [match, setMatch] = usePersistedState<SetMatch>('sequence.setNamesMatch', 'most');
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const folders = useMemo(() => [...new Set(sets.map((s) => s.group).filter(Boolean))], [sets]);
  const usable = sets.filter((s) => !folder || s.group === folder);

  /** A merged task id ("1:A100") back to its programme and own id (a single programme is not prefixed). */
  const origin = (mergedId: string): { scheduleId: string; id: string } | null => {
    if (visible.length === 1) return { scheduleId: visible[0].id, id: mergedId };
    const m = /^(\d+):(.*)$/s.exec(mergedId);
    const schedule = m ? visible[Number(m[1])] : undefined;
    return m && schedule ? { scheduleId: schedule.id, id: m[2] } : null;
  };

  const apply = () => {
    const name = field.trim();
    if (!name) return setMessage({ kind: 'warn', text: 'Give the task field a name first.' });
    if (usable.length === 0) return setMessage({ kind: 'warn', text: 'No search sets to copy: make some in Models > Search sets.' });
    const indexes = engine.getIndexes();
    if (indexes.size === 0) return setMessage({ kind: 'warn', text: 'Load a model first: the sets are run on its objects.' });

    const taskToElements = new Map<string, Map<string, number[]>>();
    for (const { modelId, links } of results) {
      const tasks = taskToElements.get(modelId) ?? taskToElements.set(modelId, new Map()).get(modelId)!;
      for (const [taskId, ids] of links.taskToElements) tasks.set(taskId, [...new Set([...(tasks.get(taskId) ?? []), ...ids])]);
    }
    const plan = planSetNames(taskToElements, usable.map((s) => ({ name: s.name, ids: runSearchSet(indexes, s) })), match);
    if (plan.linkedTasks === 0) return setMessage({ kind: 'warn', text: 'No task is linked to objects yet: set up the Link Groups first.' });
    if (plan.values.size === 0) return setMessage({ kind: 'warn', text: `None of the ${plan.linkedTasks} linked tasks has its objects in a search set${folder ? ` of “${folder}”` : ''}.` });

    const bySchedule = new Map<string, Map<string, string>>();
    for (const [mergedId, value] of plan.values) {
      const o = origin(mergedId);
      if (!o) continue;
      (bySchedule.get(o.scheduleId) ?? bySchedule.set(o.scheduleId, new Map()).get(o.scheduleId)!).set(o.id, value);
    }
    setActivityField(name, bySchedule);
    setMessage({
      kind: 'ok',
      text: `“${name}” written to ${plan.values.size} of ${plan.linkedTasks} linked tasks${plan.joined ? ` (${plan.joined} matched several sets and list them all)` : ''}. Show it in Tasks / Gantt: Columns › User Fields. It is kept in the app: export the programme to keep it.`,
    });
  };

  return (
    <div className="disp" style={{ padding: 8 }}>
      <label className="settings-field">
        <span className="settings-field__label">Task field</span>
        <input type="text" value={field} onChange={(e) => setField(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label className="settings-field">
        <span className="settings-field__label">Sets from</span>
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">All search sets ({sets.length})</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f} ({sets.filter((s) => s.group === f).length})</option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span className="settings-field__label">A set counts when it holds</span>
        <select value={match} onChange={(e) => setMatch(e.target.value as SetMatch)}>
          {SET_MATCH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <button className="btn" type="button" onClick={apply} title="For every task linked to objects, write the name of the search set(s) holding those objects into the task field">
        Copy set names to tasks
      </button>
      {message && <div style={{ marginTop: 8, fontSize: 12, color: message.kind === 'warn' ? 'var(--danger)' : 'var(--text-dim)' }}>{message.text}</div>}
    </div>
  );
}
