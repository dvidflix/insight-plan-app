import { create } from 'zustand';

/** What the 4D view (pages/SequencePage.tsx SequencePanel, wherever it is mounted: 4D Sequencing, or Generate's step 4) offers to the lists beside it:
    move the TimeLiner to the start of the earliest activity linked to the objects selected. Null while no 4D view is up. */
export const useSequenceFocusStore = create<{ jumpToSelected: (() => void) | null }>(() => ({ jumpToSelected: null }));
