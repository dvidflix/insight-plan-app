import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDirty, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';

/** The tabs of the Generate view (pages/ScenariosPage.tsx). They sit in the main header, beside the page picker, like the toolbars of Programmes,
    Models and 4D Sequencing, so the page below starts straight with its content. The chosen tab is remembered. */

export type GenerateTab = 'scenario' | 'resources' | 'recipes' | 'order' | 'advanced';

/** What Advanced holds: the parts most projects set once, or never. */
export type AdvancedTab = 'productivity' | 'rules';

export const ADVANCED_TABS: { id: AdvancedTab; label: string; tip: string }[] = [
  { id: 'productivity', label: 'Parameters, rates & crews', tip: 'Parameters (named rates), rates and crews: what sets the durations' },
  { id: 'rules', label: 'Rules', tip: 'Extra activities, manual links, crew overrides, settings and the logic between objects' },
];

export const GENERATE_TABS: { id: GenerateTab; label: string; tip: string; needsScenario: boolean }[] = [
  { id: 'scenario', label: '1 · Scenario', tip: 'Project folder, building, start date, Update 4D, Save, and the list of scenarios', needsScenario: false },
  { id: 'resources', label: '2 · Resources', tip: 'Equipment, cranes and materials, how many there are, and how many activities may run at once: the one place the counts are typed', needsScenario: true },
  { id: 'recipes', label: '3 · Recipes', tip: 'How each kind of object is built: its activities, links, days or formula', needsScenario: false },
  { id: 'order', label: '4 · Order', tip: 'What is built first (the steps), and the pours in the order they are built', needsScenario: true },
  { id: 'advanced', label: 'Advanced', tip: 'Parameters, rates and crews, and rules: set once, or not needed', needsScenario: true },
];

/** Tabs of the earlier layout, which a remembered choice may still name: two are now a part of Advanced (the others open the first tab). */
const LEGACY: Record<string, AdvancedTab> = { productivity: 'productivity', rules: 'rules' };

export const useGenerateTab = create<{ tab: GenerateTab; setTab: (tab: GenerateTab) => void; advanced: AdvancedTab; setAdvanced: (tab: AdvancedTab) => void; gantt: boolean; setGantt: (on: boolean) => void }>()(
  persist((set) => ({ tab: 'scenario', setTab: (tab) => set({ tab }), advanced: 'productivity', setAdvanced: (advanced) => set({ advanced }), gantt: false, setGantt: (gantt) => set({ gantt }) }), { name: 'generate.tab', partialize: (s) => ({ tab: s.tab, advanced: s.advanced, gantt: s.gantt }) }),
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
  const advanced = useGenerateTab((s) => s.advanced);
  return LEGACY[picked] ?? advanced;
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
