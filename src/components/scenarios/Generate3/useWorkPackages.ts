import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useModelsStore } from '../../../state/modelsStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { paletteColors } from '../../../viewer/colorPalettes';
import { firstSetFinder, packageObjects, packagesView, setFinder } from '../../../scenarios/packageSource';
import { timelineOf, type WorkPackage } from '../../../prs/workPackages';
import { inTreeOrder, treeRows } from '../../../prs/packageTree';
import { ranksFromRows } from '../../../prs/objectOrder';
import { useRuleContext } from '../rules/RuleParts';
import { useIndexTick } from '../../modelFields';

/** Generate 3's state: the step it is on and the packages folded shut (remembered), the package picked and whether Advanced is open (not
    remembered: Advanced is closed each time). */
export type G3Step = 1 | 2 | 3 | 4;
interface G3State {
  step: G3Step;
  setStep: (s: G3Step) => void;
  picked: string | null;
  pick: (id: string | null) => void;
  collapsed: string[];
  toggle: (id: string) => void;
  advanced: boolean;
  setAdvanced: (open: boolean) => void;
  /** The object order dialog: for the package picked, for every package, or shut. */
  orderDialog: 'picked' | 'all' | null;
  setOrderDialog: (d: 'picked' | 'all' | null) => void;
  /** The recipe editor, open on a recipe (or '' for the list). */
  recipeEditor: string | null;
  setRecipeEditor: (id: string | null) => void;
  /** Set by Try the sample building: once the plan is open, Generate groups the model (when it has no packages) and generates by itself. */
  autoRun: boolean;
  /** The WBS dialog (Generate3/WbsDialog.tsx) is open. */
  wbsDialog: boolean;
}
export const useG3 = create<G3State>()(
  persist((set) => ({
    step: 1, setStep: (step) => set({ step }),
    picked: null, pick: (picked) => set({ picked }),
    collapsed: [], toggle: (id) => set((s) => ({ collapsed: s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id] })),
    advanced: false, setAdvanced: (advanced) => set({ advanced }),
    orderDialog: null, setOrderDialog: (orderDialog) => set({ orderDialog }),
    recipeEditor: null, setRecipeEditor: (recipeEditor) => set({ recipeEditor }),
    autoRun: false,
    wbsDialog: false,
  }),{ name: 'generate3.step', partialize: (s) => ({ step: s.step, collapsed: s.collapsed }) as never }),
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
  const tableRows = useScenarioStore((s) => s.rows);
  const ranks = useMemo(() => (ctx.rules.objectSequence ? ranksFromRows(tableRows) : undefined), [ctx.rules.objectSequence, tableRows]);
  const view = useMemo(() => packagesView(engine, packages, sets, recipes, ctx.rules, crewSheet, objects, ranks), [engine, packages, sets, recipes, ctx.rules, crewSheet, objects, ranks]);
  const finds = useMemo(() => setFinder(engine, sets), [engine, sets, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstSet = useMemo(() => firstSetFinder(engine, sets), [engine, sets, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => treeRows(packages), [packages]);
  const timeline = useMemo(() => new Map(timelineOf(packages, (p) => view.daysOf.get(p.id) ?? 0, (p) => (view.contents.objects.get(p.id)?.length ?? 0) > 0).map((t) => [t.id, t])), [packages, view.daysOf, view.contents]);
  const save = (next: WorkPackage[]) => ctx.change((r) => { const { packages: _old, ...rest } = r; return next.length ? { ...rest, packages: inTreeOrder(next) } : rest; });
  /** Changes one package; a value set to undefined is taken away. */
  const patch = (id: string, p: Partial<WorkPackage>) => save(packages.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x, ...p };
    for (const k of Object.keys(next) as (keyof WorkPackage)[]) if (next[k] === undefined) delete next[k];
    return next;
  }));
  // `packages` are the saved ones (what the steps edit); `effective` are what Generate builds (with step 4's object sequence, when it is used).
  const { packages: effective, ...rest } = view;
  return { packages, effective, rows, ...rest, timeline, save, patch, sets, finds, firstSet };
}
