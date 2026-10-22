import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDirty, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';

/** The tabs of the Generate view (pages/ScenariosPage.tsx). They sit in the main header, beside the page picker, like the toolbars of Programmes,
    Models and 4D Sequencing, so the page below starts straight with its content. The chosen tab is remembered. */

export type GenerateTab = 'scenario' | 'resources' | 'recipes' | 'order' | 'advanced';

/** What Advanced holds: the optional detail, in one row of tabs (most projects set it once, or never). */
export type AdvancedTab = 'parameters' | 'durations' | 'rates' | 'crews' | 'trades' | 'extras' | 'levelTasks' | 'limits' | 'pours' | 'rules';

export const ADVANCED_TABS: { id: AdvancedTab; label: string; tip: string }[] = [
  { id: 'parameters', label: 'Parameters', tip: 'Named values the duration formulas read' },
  { id: 'durations', label: 'Durations', tip: 'The days each formula gives, worked out live' },
  { id: 'rates', label: 'Rates', tip: 'Named durations or productivities, used by recipe activities' },
  { id: 'crews', label: 'Crews', tip: 'Named crews: the trades and how many people' },
  { id: 'trades', label: 'Trades', tip: 'The labour trades the crews are made of, and how many people the site has' },
  { id: 'limits', label: 'Limits', tip: 'How many of one activity may run at the same time' },
  { id: 'extras', label: 'Extra activities', tip: 'Activities added to the programme that are not built from the model' },
  { id: 'levelTasks', label: 'Level tasks', tip: 'One summary task per building and level, spanning the objects of a group' },
  { id: 'pours', label: 'Objects', tip: 'The model’s objects one by one, in the order they are built: move, filter, group or colour them' },
  { id: 'rules', label: 'Rules', tip: 'Manual links, crew overrides, settings and the logic between objects' },
];

export const GENERATE_TABS: { id: GenerateTab; label: string; tip: string; needsScenario: boolean }[] = [
  { id: 'scenario', label: '1 · Scenario', tip: 'Project folder, building, start date, Update 4D, Save, and the list of scenarios', needsScenario: false },
  { id: 'order', label: '2 · Order', tip: 'The groups of objects in the order they are built, what each one generates, and Generate', needsScenario: true },
  { id: 'resources', label: 'Resources', tip: 'Optional: what there is of each resource, what uses it and how many can be used at once', needsScenario: true },
  { id: 'recipes', label: 'Recipes', tip: 'Optional: how each group is built (its activities, links, days or formula). Open it to change a default', needsScenario: false },
  { id: 'advanced', label: 'Advanced', tip: 'Optional detail: parameters, rates, crews, extra activities, the objects and rules', needsScenario: true },
];

/** Tabs of the earlier layout, which a remembered choice may still name: two are now a part of Advanced (the others open the first tab). */
const LEGACY: Record<string, AdvancedTab> = { productivity: 'parameters', rules: 'rules' };

export const useGenerateTab = create<{ tab: GenerateTab; setTab: (tab: GenerateTab) => void; advanced: AdvancedTab; setAdvanced: (tab: AdvancedTab) => void; gantt: boolean; setGantt: (on: boolean) => void }>()(
  persist((set) => ({ tab: 'scenario', setTab: (tab) => set({ tab }), advanced: 'parameters', setAdvanced: (advanced) => set({ advanced }), gantt: false, setGantt: (gantt) => set({ gantt }) }), { name: 'generate.tab', partialize: (s) => ({ tab: s.tab, advanced: s.advanced, gantt: s.gantt }) }),
);

/** The tab to show: the chosen one, or the first while no scenario is open (the others need one). */
export function useShownGenerateTab(): GenerateTab {
  const { ready } = useScenarioView();
  const picked: string = useGenerateTab((s) => s.tab);
  const meta = GENERATE_TABS.find((t) => t.id === (LEGACY[picked] ? 'advanced' : picked)) ?? GENERATE_TABS[0];
  return !ready && meta.needsScenario ? 'scenario' : meta.id;
}

/** The part of Advanced to show (a remembered tab of the earlier layout opens its own part). */
export function useShownAdvancedTab(): AdvancedTab {
  const picked: string = useGenerateTab((s) => s.tab);
  const advanced = useGenerateTab((s) => s.advanced) as string;
  return LEGACY[picked] ?? (ADVANCED_TABS.some((t) => t.id === advanced) ? (advanced as AdvancedTab) : LEGACY[advanced] ?? 'parameters');
}

export function GenerateTabs() {
  const { ready } = useScenarioView();
  const dirty = useScenarioStore((s) => isDirty(s));
  const setTab = useGenerateTab((s) => s.setTab);
  const shown = useShownGenerateTab();
  return (
    <div className="gen-tabs" role="tablist" aria-label="Generate">
      {GENERATE_TABS.map((t) => {
        const off = t.needsScenario && !ready;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={shown === t.id} disabled={off} className={shown === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)} title={off ? 'Open a scenario first (tab 1)' : t.tip}>{t.label}</button>
        );
      })}
      {dirty && <span className="scn-chip scn-chip--warn gen-tabs__dirty" title="The scenario has changes that are not saved">unsaved</span>}
    </div>
  );
}
