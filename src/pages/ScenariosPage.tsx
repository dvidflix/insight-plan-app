import { useEffect } from 'react';
import { isDirty, isTableCfgTab, useScenarioStore } from '../state/scenarioStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioStatus, ScenarioSync, ScenarioTable, ScenarioToolbar, useScenarioTabs } from '../components/scenarios/ScenarioParts';
import { SidePane } from '../components/SidePane';
import { useSidePaneStore } from '../state/sidePaneStore';

/** Scenarios tab: reorder a model's pours (its Overrides workbook's
    SequenceOrder sheet), then run the CWA schedule generator to get a P6 XML
    for that order — loaded straight into Inputs for 4D, and downloadable as
    XML or XER. Each scenario is a folder under <project>/scenarios. The
    same scenario, with the 3D model beside it, is 4D Sequencing's Scenarios
    panel: both work on the one store (state/scenarioStore.ts). */
export function ScenariosPage() {
  const { ready, project, scenario } = useScenarioView();
  const cfgTab = useScenarioStore((s) => s.cfgTab);
  const dirty = useScenarioStore((s) => isDirty(s));
  const tabs = useScenarioTabs();

  // The side pane opens on the Scenario tab while there is nothing else to
  // pick a scenario from.
  useEffect(() => {
    if (project && scenario) return;
    useSidePaneStore.setState({ open: true, settings: false });
    useScenarioStore.setState({ cfgTab: 'scenario' });
  }, [project, scenario]);

  const tab = ready ? cfgTab : 'scenario';
  return (
    <div className="scn-page">
      <ScenarioSync />
      <div className="filterbar schedule-toolbar viewer-toolbar-row scn-toolbar">
        <div className="schedule-toolbar__left">
          <h2>{scenario ?? 'Scenarios'}</h2>
          {dirty && <span className="scn-chip scn-chip--warn">unsaved</span>}
          {ready && (
            <>
              <span className="scn-sep" />
              <ScenarioToolbar />
            </>
          )}
        </div>
        <div className="schedule-toolbar__right" />
      </div>
      <div className="scn-body">
        <main className="scn-main">
          <ScenarioNotice />
          {ready && <ScenarioTable />}
        </main>
        <SidePane
          tabs={tabs}
          active={tab}
          onSelect={(id) => useScenarioStore.setState({ cfgTab: id })}
          bodyClassName={ready && isTableCfgTab(tab) ? 'config-panel__body scn-panel' : 'scn-panel scn-panel__body'}
        >
          <ScenarioPanelBody tab={tab} />
        </SidePane>
      </div>
      <ScenarioStatus />
    </div>
  );
}
