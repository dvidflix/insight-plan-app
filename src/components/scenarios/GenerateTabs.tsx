import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDirty, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';

/** The tabs of the Generate view (pages/ScenariosPage.tsx). They sit in the main header, beside the page picker, like the toolbars of Programmes,
    Models and 4D Sequencing, so the page below starts straight with its content. The chosen tab is remembered. */

export type GenerateTab = 'scenario' | 'order' | 'recipes' | 'productivity' | 'resources' | 'sequence' | 'rules';

export const GENERATE_TABS: { id: GenerateTab; label: string; tip: string; needsScenario: boolean }[] = [
  { id: 'scenario', label: '1 · Scenario', tip: 'Project folder, building, start date, Update 4D, Save, and the list of scenarios', needsScenario: false },
  { id: 'order', label: '2 · Order', tip: 'The pours in the order they are built', needsScenario: true },
  { id: 'recipes', label: '3 · Recipes', tip: 'How each kind of object is built: its activities, links, days or formula', needsScenario: false },
  { id: 'productivity', label: '4 · Productivity', tip: 'Parameters (named rates), rates and crews: what sets the durations', needsScenario: true },
  { id: 'resources', label: '5 · Resources', tip: 'Equipment, cranes and materials, and how many there are', needsScenario: true },
  { id: 'sequence', label: '6 · Sequence', tip: 'The steps (search sets in build order) and the limits on activities running at once', needsScenario: true },
  { id: 'rules', label: '7 · Rules', tip: 'Extra activities, manual links, crew overrides, settings and the logic between objects', needsScenario: true },
];

export const useGenerateTab = create<{ tab: GenerateTab; setTab: (tab: GenerateTab) => void; gantt: boolean; setGantt: (on: boolean) => void }>()(
  persist((set) => ({ tab: 'scenario', setTab: (tab) => set({ tab }), gantt: false, setGantt: (gantt) => set({ gantt }) }), { name: 'generate.tab', partialize: (s) => ({ tab: s.tab, gantt: s.gantt }) }),
);

/** The tab to show: the chosen one, or the first while no scenario is open (the others need one). */
export function useShownGenerateTab(): GenerateTab {
  const { ready } = useScenarioView();
  const picked = useGenerateTab((s) => s.tab);
  const meta = GENERATE_TABS.find((t) => t.id === picked) ?? GENERATE_TABS[0];
  return !ready && meta.needsScenario ? 'scenario' : meta.id;
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
