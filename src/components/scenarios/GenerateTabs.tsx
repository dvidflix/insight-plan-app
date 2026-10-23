import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDirty, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';

/** The tabs of the Generate view (pages/ScenariosPage.tsx). They sit in the main header, beside the page picker, like the toolbars of Programmes,
    Models and 4D Sequencing, so the page below starts straight with its content. The chosen tab is remembered. */

export type GenerateTab = 'scenario' | 'order' | 'objects' | 'assumptions' | 'recipes' | 'parameters' | 'extras' | 'rules';

/** The editors a header tab holds. A tab with more than one shows them as a short row of tabs under the header (the only second level there is). */
export type AdvancedTab = 'recipes' | 'levels' | 'parameters' | 'extras' | 'levelTasks' | 'limits' | 'pours' | 'rules';

export const ADVANCED_TABS: { id: AdvancedTab; label: string; tip: string; needsScenario: boolean }[] = [
  { id: 'recipes', label: 'Recipes', tip: 'How each group is built (its activities, links, days or formula). Open it to change a default', needsScenario: false },
  { id: 'levels', label: 'Levels', tip: 'Which property of your objects is the level, and the order the levels are built in', needsScenario: true },
  { id: 'parameters', label: 'Parameters & resources', tip: 'Named values the duration formulas read, how many of each piece of equipment, crane or material there is', needsScenario: true },
  { id: 'limits', label: 'All limits', tip: 'Every limit on how many of one activity may run at the same time, in one list. Usually set as the Max at once column of Recipes or of a resource', needsScenario: true },
  { id: 'extras', label: 'Extra activities', tip: 'Activities added to the programme that are not built from the model', needsScenario: true },
  { id: 'levelTasks', label: 'Summary bars', tip: 'One summary task per building and level, spanning the objects of a group', needsScenario: true },
  { id: 'pours', label: 'Objects', tip: 'The model’s objects one by one, in the order they are built: move, filter, group or colour them', needsScenario: true },
  { id: 'rules', label: 'Rules', tip: 'Manual links, crew overrides, settings and the logic between objects', needsScenario: true },
];

/** The tabs of the header, in the order a planner takes them. Scenario opens first, then the Work breakdown (the path); the rest are set apart and quieter. Every
    main thing is a tab of its own, none is buried in a menu. */
export const GENERATE_TABS: { id: GenerateTab; label: string; tip: string; needsScenario: boolean; secondary?: boolean; parts?: AdvancedTab[] }[] = [
  { id: 'scenario', label: '1 - Scenario', tip: 'Project folder, building, start date, Update 4D, Save, and the list of scenarios', needsScenario: false },
  { id: 'order', label: '2 - Work breakdown', tip: 'Your search sets as the work breakdown, in the order they are built, beside the model in 3D. Generate is here', needsScenario: true },
  { id: 'objects', label: '3 - Sequence', tip: 'The sequence of the model’s objects one by one, in the order they are built: move, filter, group or colour them', needsScenario: true, secondary: true, parts: ['pours'] },
  { id: 'assumptions', label: '4 - Labour', tip: 'People, gangs and productivity in one table', needsScenario: true, secondary: true },
  { id: 'recipes', label: '5 - Recipes', tip: 'How each group is built (its activities, links, days or formula). Open it only to change a default', needsScenario: false, secondary: true, parts: ['recipes'] },
  { id: 'parameters', label: '6 - Parameters', tip: 'Named values the duration formulas read, how many of each piece of equipment, crane or material there is, and the named rates recipe activities use', needsScenario: true, secondary: true, parts: ['parameters'] },
  { id: 'extras', label: '7 - Extras', tip: 'Activities that are not built from the model, and one summary bar per building and level', needsScenario: true, secondary: true, parts: ['extras', 'levelTasks'] },
  { id: 'rules', label: '8 - Rules', tip: 'Manual links, crew overrides, settings, the logic between objects, and every limit in one list', needsScenario: true, secondary: true, parts: ['rules', 'limits'] },
];

/** Levels and zones are part of the Work breakdown tab (below its list): asking for them opens that tab. */
const tabOfPart = (part: AdvancedTab): GenerateTab => (part === 'levels' ? 'order' : GENERATE_TABS.find((t) => t.parts?.includes(part))?.id ?? 'recipes');

/** Names an earlier layout used, which a caller or a remembered choice may still give. */
const MOVED: Record<string, GenerateTab> = { resources: 'parameters', labour: 'assumptions', productivity: 'parameters', advanced: 'recipes' };

export const useGenerateTab = create<{ tab: GenerateTab; setTab: (tab: GenerateTab | string) => void; advanced: AdvancedTab; /** Opens an editor on its own tab. */ setAdvanced: (part: AdvancedTab) => void; gantt: boolean; setGantt: (on: boolean) => void }>()(
  // Version 5: every main editor is a tab of the header, so a remembered tab is dropped once.
  persist((set, get) => ({
    tab: 'scenario',
    setTab: (tab) => {
      const id = (MOVED[tab] ?? tab) as GenerateTab;
      const parts = GENERATE_TABS.find((t) => t.id === id)?.parts;
      const part = tab === 'resources' || tab === 'productivity' ? 'parameters' : undefined;
      set({ tab: id, ...(part ? { advanced: part } : parts && !parts.includes(get().advanced) ? { advanced: parts[0] } : {}) });
    },
    advanced: 'recipes', setAdvanced: (advanced) => set({ advanced, tab: tabOfPart(advanced) }), gantt: false, setGantt: (gantt) => set({ gantt }),
  }), { name: 'generate.tab', version: 5, migrate: (old) => ({ ...(old as object), tab: 'scenario' }) as never, partialize: (s) => ({ tab: s.tab, advanced: s.advanced, gantt: s.gantt }) }),
);

/** The tab to show: the chosen one, or Scenario while no scenario is open (most of the others need one). */
export function useShownGenerateTab(): GenerateTab {
  const { ready } = useScenarioView();
  const picked: string = useGenerateTab((s) => s.tab);
  const meta = GENERATE_TABS.find((t) => t.id === (MOVED[picked] ?? picked)) ?? GENERATE_TABS[0];
  return !ready && meta.needsScenario ? 'scenario' : meta.id;
}

/** The editor to show on the shown tab: the chosen one if the tab holds it, else the tab's first. */
export function useShownAdvancedTab(): AdvancedTab {
  const tab = useShownGenerateTab();
  const advanced = useGenerateTab((s) => s.advanced) as string;
  const parts = GENERATE_TABS.find((t) => t.id === tab)?.parts ?? ['recipes'];
  return (parts.includes(advanced as AdvancedTab) ? advanced : parts[0]) as AdvancedTab;
}

export function GenerateTabs() {
  const { ready } = useScenarioView();
  const dirty = useScenarioStore((s) => isDirty(s));
  const setTab = useGenerateTab((s) => s.setTab);
  const shown = useShownGenerateTab();
  return (
    <div className="gen-tabs" role="tablist" aria-label="Generate">
      {GENERATE_TABS.map((t, i) => {
        const off = t.needsScenario && !ready;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={shown === t.id} disabled={off} className={`${shown === t.id ? 'is-active' : ''}${t.secondary ? ' is-secondary' : ''}${t.secondary && !GENERATE_TABS[i - 1]?.secondary ? ' is-first-secondary' : ''}`} onClick={() => setTab(t.id)} title={off ? 'Open a scenario first (tab 1)' : t.tip}>{t.label}</button>
        );
      })}
      {dirty && <span className="scn-chip scn-chip--warn gen-tabs__dirty" title="The scenario has changes that are not saved">unsaved</span>}
    </div>
  );
}
