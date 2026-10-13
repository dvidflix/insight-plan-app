import { useEffect } from 'react';
import { useSelectionStore } from '../state/selectionStore';
import { setRules, useScenarioStore } from '../state/scenarioStore';
import { joinObjects, unjoinObjects } from '../prs/joins';

/** The scenario's model in the 3D view, as usePourElements gives it. */
interface PourElements { modelId: string | null; guidById: Map<number, string> }

// The objects picked in 3D, in the order they were picked (the Highlighter's selection has no order of its own): what stays picked keeps its
// place and what is new goes last, so the first one picked of a selection is the main object of a join.
let order: string[] = [];
const providers: PourElements[] = [];
let listening = false;

const guidsOf = (pours: PourElements, byModel: Record<string, number[]>) =>
  (pours.modelId ? byModel[pours.modelId] ?? [] : []).map((id) => pours.guidById.get(id)).filter((g): g is string => !!g);

function track(pours: PourElements, byModel: Record<string, number[]>) {
  const now = guidsOf(pours, byModel);
  const set = new Set(now);
  order = [...order.filter((g) => set.has(g)), ...now.filter((g) => !order.includes(g))];
}

const note = (kind: 'ok' | 'error', text: string) => useScenarioStore.setState({ message: { kind, text } });

function onKey(e: KeyboardEvent) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyJ') return; // (the code, not the key: Alt+J types another character on some keyboards)
  const target = e.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const st = useScenarioStore.getState();
  if (!providers.length || !st.loaded) return;
  e.preventDefault();
  // Only the scenario's own objects (the pours of its table) can be joined.
  const own = new Set(st.rows.map((r) => r.key.split('#')[0]));
  const picked = order.filter((g) => own.has(g));
  if (e.shiftKey) {
    const next = unjoinObjects(st.rules, picked);
    if (next === st.rules) return note('error', 'None of the picked objects is joined.');
    setRules(next);
    return note('ok', `Took ${picked.length} object${picked.length === 1 ? '' : 's'} out of their joins.`);
  }
  if (picked.length < 2) return note('error', 'Pick two or more objects in the 3D view to join them (Alt+J). The first one picked is the main object.');
  setRules(joinObjects(st.rules, picked));
  note('ok', `Joined ${picked.length} objects into one activity: the main object is the first picked (${picked[0]}). Alt+Shift+J splits them again. Save keeps the join with the scenario.`);
}

/** Alt+J in the 3D view joins the picked objects into one (the first picked is the main object; they get one set of activities), Alt+Shift+J
    takes them out of their joins. Saved with the scenario's rules (rules.joins). Mount it where the scenario's pours are linked to the 3D view. */
export function useJoinShortcut(pours: PourElements) {
  useEffect(() => {
    const entry = { modelId: pours.modelId, guidById: pours.guidById };
    providers.push(entry);
    track(entry, useSelectionStore.getState().byModel);
    const stop = useSelectionStore.subscribe((s) => track(entry, s.byModel));
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      stop();
      providers.splice(providers.indexOf(entry), 1);
      if (!providers.length) {
        window.removeEventListener('keydown', onKey);
        listening = false;
        order = [];
      }
    };
  }, [pours]);
}
