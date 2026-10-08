import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which programme the app uses: the one selected, and the ones switched off from the Inputs list (the eye), by
    programme key (its file / scenario name). Kept in the browser like the other layout settings, so a scene brings
    its own back: the programmes load from the project database each time, and ProgrammeChoiceSync then applies it. */
export interface ProgrammeChoice {
  selected: string | null;
  hidden: string[];
}

interface ProgrammeChoiceState extends ProgrammeChoice {
  set: (choice: ProgrammeChoice) => void;
}

export const useProgrammeChoiceStore = create<ProgrammeChoiceState>()(
  persist(
    (set) => ({ selected: null, hidden: [], set: (choice) => set({ selected: choice.selected, hidden: choice.hidden }) }),
    { name: 'programmes.choice', partialize: (s) => ({ selected: s.selected, hidden: s.hidden }) },
  ),
);

/** Set once the user has picked / hidden a programme in this page session: from then on the remembered choice is no
    longer re-applied to programmes that finish loading (it only restores what the scene had at start-up). */
let choiceMade = false;
export const markChoiceMade = () => { choiceMade = true; };
export const hasMadeChoice = () => choiceMade;

/** The choice after the user changed something. Programmes that are not loaded (yet) keep what was remembered about
    them, so a choice made while only some are loaded does not forget the others. */
export function nextChoice(prev: ProgrammeChoice, loadedKeys: string[], selectedKey: string | null, hiddenLoadedKeys: string[]): ProgrammeChoice {
  const loaded = new Set(loadedKeys);
  return {
    selected: selectedKey ?? prev.selected,
    hidden: [...new Set([...prev.hidden.filter((k) => !loaded.has(k)), ...hiddenLoadedKeys])],
  };
}
