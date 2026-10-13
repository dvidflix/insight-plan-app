import { useMemo } from 'react';
import { useScheduleStore } from '../../state/scheduleStore';
import { scenarioFileName } from '../../scenarios/api';
import { useScenarioView } from '../../scenarios/useScenarioView';

/** The activities of the scenario's generated programme: what manual links and extra activities can name. */

/** Activities of the scenario's programme in the app (else of any programme
    for the building): what manual links can name. */
export function useScenarioActivities() {
  const schedules = useScheduleStore((s) => s.schedules);
  const { scenario, stem } = useScenarioView();
  return useMemo(() => {
    if (!scenario || !stem) return { source: null, byCode: new Map<string, string>() };
    const name = scenarioFileName(stem, scenario);
    const own = schedules.find((s) => s.sourceFileName === name || s.sourceFileName === `${name}.xml`);
    const source = own ?? schedules.find((s) => s.sourceFileName.startsWith(stem)) ?? null;
    return { source, byCode: new Map((source?.activities ?? []).filter((a) => a.type !== 'wbs-summary').map((a) => [a.code, a.name])) };
  }, [schedules, scenario, stem]);
}
