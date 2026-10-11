import { create } from 'zustand';
import { ALL_MODULES, type LicenceModule } from './licence';

/** The modules the active licence unlocks. Every edition without a licence check (internal, product) keeps both. */
export const useLicenceModules = create<{ modules: LicenceModule[]; set: (modules: LicenceModule[]) => void }>((set) => ({ modules: [...ALL_MODULES], set: (modules) => set({ modules }) }));
