import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDirty, useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { useGenerateTab, type GenerateTab } from '../GenerateTabs';

/** Generate 2 has one screen, Build (pages/Generate2Page.tsx): the search sets, the work breakdown tree, each work item's activities with their crews
    and days, the 3D model, and Generate. Everything else is in one Advanced area, closed by default, that covers Build until it is closed: the
    scenario (project, building, start date, Save) and the full editors of Generate (recipes, crews and rates, parameters, extras and summary bars, rules,
    and the objects one by one). The header holds a Scenario button and an Advanced button that open it. The last editor opened is remembered; whether
    it is open is not. */

export type AdvancedArea = 'scenario' | 'recipes' | 'crews' | 'parameters' | 'extras' | 'rules' | 'objects';

export const ADVANCED_AREAS: { id: AdvancedArea; label: string; tip: string; needsScenario: boolean; /** The Generate tab it shows. */ tab: GenerateTab }[] = [
  { id: 'scenario', label: 'Scenario', tip: 'Project folder, building, start date, Save, and the list of scenarios', needsScenario: false, tab: 'scenario' },
  { id: 'recipes', label: 'Recipes', tip: 'Every recipe: the activities each group of objects gets, their days, crews and resources', needsScenario: false, tab: 'recipes' },
  { id: 'crews', label: 'Crews & rates', tip: 'The crews, their trades and people, and the productivity rates the recipes use', needsScenario: true, tab: 'assumptions' },
  { id: 'parameters', label: 'Parameters', tip: 'Named values the duration formulas read, and how much equipment, cranes and materials there is', needsScenario: true, tab: 'parameters' },
  { id: 'extras', label: 'Extras & summary bars', tip: 'Activities that are not built from the model, and summary bars per building and level', needsScenario: true, tab: 'extras' },
  { id: 'rules', label: 'Rules & links', tip: 'Manual links, crew overrides, settings, the logic between objects, and every limit in one list', needsScenario: true, tab: 'rules' },
  { id: 'objects', label: 'Objects one by one', tip: 'Fine-tune individual objects: the order table, one row per object, in the order they are built', needsScenario: true, tab: 'objects' },
];

export const useGenerate2Tab = create<{ area: AdvancedArea | null; last: AdvancedArea; open: (area?: AdvancedArea) => void; close: () => void }>()(
  persist((set, get) => ({ area: null, last: 'recipes', open: (area) => { const a = area ?? get().last; set({ area: a, ...(a !== 'scenario' ? { last: a } : {}) }); }, close: () => set({ area: null }) }),
    { name: 'generate2.advanced', version: 2, partialize: (s) => ({ last: s.last }) as never }),
);

/** A Generate tab as the Advanced area that shows it: the Work breakdown and Generate's own sequence list are Build here. */
const areaOf = (tab: GenerateTab): AdvancedArea | null => (tab === 'order' ? null : ADVANCED_AREAS.find((a) => a.tab === tab)?.id ?? null);

/** The area to show: the open one, or the Scenario while no scenario is open (Build needs one). */
export function useShownArea(): AdvancedArea | null {
  const { ready } = useScenarioView();
  const area = useGenerate2Tab((s) => s.area);
  const meta = ADVANCED_AREAS.find((a) => a.id === area);
  return !ready && (!meta || meta.needsScenario) ? 'scenario' : area;
}

/** The editors shared with Generate open their tab through the Generate view's tab store ("Edit recipe", a resource link, "Open them"): here they open
    the same editor in the Advanced area. Mounted while Generate 2 shows. */
export function useFollowGenerateTabs() {
  const { open, close } = useGenerate2Tab.getState();
  useEffect(() => useGenerateTab.subscribe((s, was) => {
    if (s.gantt !== was.gantt) return;
    const area = areaOf(s.tab);
    if (area) open(area); else close();
  }), [open, close]);
}

/** The header's cells after the search box: the scenario, and Advanced. */
export function Generate2Tabs() {
  const { ready } = useScenarioView();
  const dirty = useScenarioStore((s) => isDirty(s));
  const scenario = useScenarioStore((s) => s.scenario);
  const { open, close } = useGenerate2Tab();
  const shown = useShownArea();
  const toggle = (scenarioArea: boolean) => (scenarioArea ? (shown === 'scenario' && ready ? close() : open('scenario')) : shown && shown !== 'scenario' ? close() : open());
  return (
    <div className="gen-tabs" role="toolbar" aria-label="Generate 2">
      <button type="button" className={shown === 'scenario' ? 'is-active' : ''} aria-pressed={shown === 'scenario'} onClick={() => toggle(true)}
        title={ready ? `Scenario ${scenario}: project, building, start date and Save. Click again to go back to Build` : 'Open a scenario, or make one'}>{ready && scenario ? `Scenario: ${scenario}` : 'Scenario'}</button>
      <button type="button" className={`is-secondary${shown && shown !== 'scenario' ? ' is-active' : ''}`} aria-pressed={!!shown && shown !== 'scenario'} disabled={!ready} onClick={() => toggle(false)}
        title={ready ? 'The full editors: recipes, crews and rates, parameters, extras, rules and the objects one by one. Most work items need none of them' : 'Open a scenario first'}>Advanced</button>
      {dirty && <span className="scn-chip scn-chip--warn gen-tabs__dirty" title="The scenario has changes that are not saved">unsaved</span>}
    </div>
  );
}
