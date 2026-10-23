import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useModelsStore } from '../../../state/modelsStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { paletteColors } from '../../../viewer/colorPalettes';
import { packageObjects, packagesView, setFinder } from '../../../scenarios/packageSource';
import { timelineOf, type WorkPackage } from '../../../prs/workPackages';
import { useRuleContext } from '../rules/RuleParts';
import { useIndexTick } from '../../modelFields';

/** Generate 3's state: the step it is on (remembered) and the package picked (not remembered). */
export type G3Step = 1 | 2 | 3;
export const useG3 = create<{ step: G3Step; setStep: (s: G3Step) => void; picked: string | null; pick: (id: string | null) => void }>()(
  persist((set) => ({ step: 1, setStep: (step) => set({ step }), picked: null, pick: (picked) => set({ picked }) }), { name: 'generate3.step', partialize: (s) => ({ step: s.step }) as never }),
);

/** Colours for packages, the same palette as the rest of Generate. */
export const packageColors = (n: number) => paletteColors('vivid', Math.max(n, 1), 0);

/** The packages of the open scenario with what each holds, its method and its place on the timeline; and a way to change them. */
export function useWorkPackages() {
  const ctx = useRuleContext();
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const models = useModelsStore((s) => s.models.length);
  const sets = useSearchSetsStore((s) => s.sets);
  const recipes = useRecipeStore((s) => s.recipes);
  const crewSheet = useScenarioStore((s) => s.crews);
  const packages = useMemo(() => ctx.rules.packages ?? [], [ctx.rules.packages]);
  const objects = useMemo(() => packageObjects(engine), [engine, tick, models]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => packagesView(engine, packages, sets, recipes, ctx.rules, crewSheet, objects), [engine, packages, sets, recipes, ctx.rules, crewSheet, objects]);
  const finds = useMemo(() => setFinder(engine, sets), [engine, sets, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline = useMemo(() => timelineOf(packages, (p) => view.methods.get(p.id)?.days ?? 0), [packages, view.methods]);
  const save = (next: WorkPackage[]) => ctx.change((r) => { const { packages: _old, ...rest } = r; return next.length ? { ...rest, packages: next } : rest; });
  const patch = (id: string, p: Partial<WorkPackage>) => save(packages.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return { packages, ...view, timeline, save, patch, sets, finds };
}
