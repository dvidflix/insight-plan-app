import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DbProgramme } from '../db/api';
import type { ScheduleModel } from '../schedule/types';
import { loadProgramme, useProjectDbStore } from './projectDbStore';
import { useScheduleStore } from './scheduleStore';
import { programmeKey } from './unloadedWbsStore';

/** The saved baselines of a programme (frozen copies of it, see ProjectDbBase.saveBaseline) and the one it is shown against: on the
    Gantt, in the Saved baseline columns. The choice is kept per programme, with the project. */
interface BaselineChoice {
  /** programme key -> id of the baseline programme shown against it. */
  byProgramme: Record<string, number>;
  choose: (key: string, baselineId: number | null) => void;
}

export const useBaselineChoiceStore = create<BaselineChoice>()(
  persist(
    (set) => ({
      byProgramme: {},
      choose: (key, baselineId) =>
        set((s) => {
          const byProgramme = { ...s.byProgramme };
          if (baselineId === null) delete byProgramme[key];
          else byProgramme[key] = baselineId;
          return { byProgramme };
        }),
    }),
    { name: 'schedule.baselineChoice' },
  ),
);

/** The baselines saved of a programme loaded from the project database, oldest first. */
export function useBaselinesOf(model: ScheduleModel | null): DbProgramme[] {
  const programmes = useProjectDbStore((s) => s.programmes);
  const id = model?.dbProgrammeId;
  return useMemo(() => (id === undefined ? [] : programmes.filter((p) => p.baselineOf === id).sort((a, b) => a.id - b.id)), [programmes, id]);
}

/** The baseline the programme is shown against, loaded (it is read from the database the first time it is chosen), or null. */
export function useChosenBaseline(model: ScheduleModel | null): ScheduleModel | null {
  const key = model ? programmeKey(model) : null;
  const chosen = useBaselineChoiceStore((s) => (key ? s.byProgramme[key] : undefined));
  const baselines = useBaselinesOf(model);
  const schedules = useScheduleStore((s) => s.schedules);
  const record = chosen === undefined ? undefined : baselines.find((b) => b.id === chosen);
  const loaded = record ? schedules.find((m) => m.dbProgrammeId === record.id) ?? null : null;
  useEffect(() => {
    if (record && !loaded) void loadProgramme(record).catch(() => undefined);
  }, [record, loaded]);
  return loaded;
}
