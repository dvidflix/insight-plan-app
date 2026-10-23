import { useMemo, useState, type ReactNode } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { emptyGroup, newId } from '../../schedule/linkGroups';
import { CONFIDENCE_LABEL, groupNameOf, suggestMatches, unlinked, type Confidence, type Suggestion } from '../../schedule/suggestMatches';

/** What no Link Group links yet, and the match rules that would link the most of it. The counts update with the groups; a suggestion is accepted into an
    ordinary Link Group with one match rule (so the timeline, appearance profiles and colours work on it as on any group), and goes from the list. A rejected
    one stays away for this session only. */

const SHOWN: Confidence[] = ['high', 'medium'];

/** `actions`: more buttons for the bar, before "Suggest matches" (the Link Groups panel's "Link selection"). */
export function SuggestMatches({ model, actions }: { model: ScheduleModel; actions?: ReactNode }) {
  const engine = useViewerEngine();
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const add = useLinkGroupsStore((s) => s.add);
  const [open, setOpen] = useState(false);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<Confidence>>(new Set(SHOWN));
  const [note, setNote] = useState<string | null>(null);

  const objects = useMemo(() => sharedActivityObjects(model, loadedModels, groups), [model, loadedModels, groups]);
  const gaps = useMemo(() => unlinked(model, loadedModels, objects.objectsOf, new Set(objects.ownersOf.keys())), [model, loadedModels, objects]);
  // Only worked out while the list is open: it reads every property of every unlinked object.
  const all = useMemo(() => (open ? suggestMatches(model, loadedModels, gaps) : []), [open, model, loadedModels, gaps]);
  const list = all.filter((s) => !rejected.has(s.id) && levels.has(s.confidence));

  if (loadedModels.length === 0) return null;
  const nothing = gaps.tasks.length === 0 || gaps.objects.size === 0;
  const show = (s: Suggestion) => {
    const by: Record<string, number[]> = {};
    for (const k of s.objectKeys) {
      const at = k.lastIndexOf(':');
      (by[k.slice(0, at)] ??= []).push(Number(k.slice(at + 1)));
    }
    void engine.selectElements(by, false);
  };
  const accept = (s: Suggestion) => {
    const group = { ...emptyGroup(groupNameOf(s)), matchRules: [{ id: newId(), ...s.rule }] };
    add(group);
    setNote(`Linked ${s.tasks.toLocaleString()} task${s.tasks === 1 ? '' : 's'} to ${s.objects.toLocaleString()} object${s.objects === 1 ? '' : 's'} with the group “${group.name}”. Delete the group to undo.`);
  };

  return (
    <div className="sm">
      <div className="sm__bar">
        <span className="sm__count" title="Tasks that no Link Group gives an object to">{gaps.tasks.length === 0 ? 'All tasks linked' : `${gaps.tasks.length.toLocaleString()} of ${gaps.totalTasks.toLocaleString()} tasks unlinked`}</span>
        <span className="sm__count" title="Objects that no Link Group links to a task">{gaps.objects.size === 0 ? 'all objects linked' : `${gaps.objects.size.toLocaleString()} of ${gaps.totalObjects.toLocaleString()} objects unlinked`}</span>
        {actions}
        <button type="button" className="btn btn--small" disabled={nothing} aria-expanded={open} onClick={() => setOpen(!open)} title={nothing ? 'Needs unlinked tasks and unlinked objects' : 'Find the fields that would link the most unlinked tasks to unlinked objects'}>Suggest matches {open ? '▲' : '▼'}</button>
      </div>
      {open && (
        <div className="sm__panel">
          <div className="scn-dim xl__note">Each suggestion is a match rule: a task field equal to an object property. Scored by the share of the unlinked tasks it would link.</div>
          <div className="rel-bar">
            {(['high', 'medium', 'low'] as Confidence[]).map((c) => (
              <label key={c} className="scn-dim"><input type="checkbox" checked={levels.has(c)} onChange={(e) => setLevels((prev) => { const next = new Set(prev); if (e.target.checked) next.add(c); else next.delete(c); return next; })} /> {CONFIDENCE_LABEL[c]}</label>
            ))}
            <button type="button" className="btn btn--small primary" disabled={!list.some((s) => s.confidence === 'high')} onClick={() => list.filter((s) => s.confidence === 'high').forEach(accept)} title="Add a Link Group for every High suggestion shown">Accept all high</button>
            <button type="button" className="btn btn--small" onClick={() => setOpen(false)}>Dismiss</button>
          </div>
          {note && <div className="scn-rules__note" role="status">{note}</div>}
          {list.length === 0 ? <div className="scn-dim scn-editor__help">{all.length === 0 ? 'No field of the unlinked tasks has a value that an unlinked object also holds, so no rule would link any of them.' : 'No suggestion at the shown scores: tick Low to see the weaker ones.'}</div> : (
            <table className="xl">
              <thead><tr><th>Score</th><th title="The task field and the object property that hold the same value">Rule</th><th title="Unlinked tasks linked">Tasks</th><th title="Unlinked objects linked">Objects</th><th title="A value both hold">Example</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="xl__cell xl__ro"><span className={`sm__chip sm__chip--${s.confidence}`}>{CONFIDENCE_LABEL[s.confidence]}</span> {Math.round(s.coverage * 100)}%</td>
                    <td className="xl__cell xl__ro">{s.taskLabel} = {s.objectLabel}</td>
                    <td className="xl__cell xl__num xl__ro">{s.tasks.toLocaleString()}</td>
                    <td className="xl__cell xl__num xl__ro">{s.objects.toLocaleString()}</td>
                    <td className="xl__cell xl__ro" title={s.example}>{s.example.length > 24 ? `${s.example.slice(0, 24)}…` : s.example}</td>
                    <td className="xl__cell xl__ro">
                      <button type="button" className="btn btn--small" onClick={() => show(s)} title="Select the objects this rule would link, in 3D">Show</button>{' '}
                      <button type="button" className="btn btn--small primary" onClick={() => accept(s)}>Accept</button>{' '}
                      <button type="button" className="btn btn--small" onClick={() => setRejected(new Set([...rejected, s.id]))} title="Leave it out of this list for this session">Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
