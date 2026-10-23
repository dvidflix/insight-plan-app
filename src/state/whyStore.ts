import { create } from 'zustand';
import type { WhyData } from '../schedule/whyText';

/** The reasons for the links of the programme the generator last made (not saved: they come with each Update 4D). `file` is the programme's file name. */
export const useWhyStore = create<{ file: string | null; why: WhyData | null; set: (file: string, why: WhyData | null) => void }>((set) => ({ file: null, why: null, set: (file, why) => set({ file, why }) }));
