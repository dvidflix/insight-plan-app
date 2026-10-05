import { useMemo } from 'react';
import { movedKeys, stepNumbers, type PourRow } from './pourOrder';
import { applyView, BASE_COL, COMPUTED_COLUMNS, FINISH_MONTH_COL, FINISH_WEEK_COL, SHIFT_COL, START_MONTH_COL, START_WEEK_COL, STEP_COL } from './tableView';
import { scenarioFileName } from './api';
import { baseStem } from './fromProgramme';
import { useScheduleStore } from '../state/scheduleStore';
import { elementIdField } from '../schedule/activityObjects';
import { taskFieldValue } from '../schedule/linkGroups';
import { finishOf, isoWeekLabel, monthLabel, startOf } from '../schedule/columns';
import { scenarioNamesFor, useScenarioStem, useScenarioStore } from '../state/scenarioStore';
import { queryMatcher } from '../schedule/search';

export type ScnItem = { r: PourRow; i: number };

/** What the Scenarios table, toolbar and status line derive from the store:
    step numbers, moved pours, columns, the filtered / sorted / grouped view. */
export function useScenarioView() {
  const project = useScenarioStore((s) => s.project);
  const scenario = useScenarioStore((s) => s.scenario);
  const drafts = useScenarioStore((s) => s.drafts);
  const loaded = useScenarioStore((s) => s.loaded);
  const rows = useScenarioStore((s) => s.rows);
  const filter = useScenarioStore((s) => s.filter);
  const tableCfg = useScenarioStore((s) => s.tableCfg);
  const collapsedGroups = useScenarioStore((s) => s.collapsedGroups);
  const flags = useScenarioStore((s) => s.flags);
  const flaggedOnly = useScenarioStore((s) => s.flaggedOnly);
  const stem = useScenarioStem();

  const scenarioNames = useMemo(() => scenarioNamesFor(project, drafts, stem), [project, drafts, stem]);
  const modelInfo = project?.models.find((m) => m.stem === stem) ?? null;
  const generatedAt = project?.scenarios.find((s) => s.name === scenario)?.models.find((m) => stem !== null && baseStem(m.stem).toLowerCase() === baseStem(stem).toLowerCase())?.generated ?? null;
  const ready = !!(project && scenario && stem && loaded && loaded.stem === stem && loaded.scenario === scenario);

  const steps = useMemo(() => stepNumbers(rows), [rows]);
  const indexCol = loaded ? loaded.headers.indexOf('Index') : -1;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const hit = queryMatcher(filter);
    const all: ScnItem[] = rows.map((r, i) => ({ r, i }));
    return q ? all.filter(({ r }) => r.cells.some((c) => hit(c))) : all;
  }, [rows, filter]);
  /** Keys of the groups a pour sits in, as applyView names them. */
  const groupKeysOf = (it: ScnItem, valueOf: (it: ScnItem, field: string) => string) => {
    const out: string[] = [];
    let prefix = '';
    for (const rule of tableCfg.groups) {
      prefix = `${prefix}/${rule.field}=${valueOf(it, rule.field)}`;
      out.push(prefix);
    }
    return out;
  };
  const moved = useMemo(() => (loaded ? movedKeys(rows, loaded.baseStep) : new Set<string>()), [rows, loaded]);

  // Columns: Step / Base / Shift, then the SequenceOrder sheet's own.
  const fields = useMemo(
    () => [...COMPUTED_COLUMNS, ...(loaded ? loaded.headers.filter((_, i) => i !== indexCol).map((h) => ({ id: h, label: h })) : [])],
    [loaded, indexCol],
  );
  const allColumnIds = useMemo(() => fields.map((f) => f.id), [fields]);
  const shownColumns = useMemo(() => (tableCfg.columns ?? allColumnIds).filter((id) => allColumnIds.includes(id)), [tableCfg.columns, allColumnIds]);

  // The pours' dates, from the programme generated for this scenario (matched by Pour ID = the schedule's Element ID).
  const schedules = useScheduleStore((s) => s.schedules);
  const pourDates = useMemo(() => {
    const out = new Map<string, { start: Date; finish: Date }>();
    const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, '');
    const prefix = stem && scenario ? scenarioFileName(stem, scenario) : '';
    const schedule = prefix ? schedules.find((s) => s.sourceFileName.startsWith(prefix) || s.sourceFileName.includes(`[${scenario}]`)) : undefined;
    const field = schedule && elementIdField(schedule);
    if (!schedule || !field) return { out, norm };
    for (const a of schedule.activities) {
      const id = norm(taskFieldValue(a, field));
      const start = startOf(a);
      const finish = finishOf(a);
      if (!id || !start || !finish) continue;
      const cur = out.get(id);
      out.set(id, { start: !cur || start < cur.start ? start : cur.start, finish: !cur || finish > cur.finish ? finish : cur.finish });
    }
    return { out, norm };
  }, [schedules, stem, scenario]);
  const pourIdCols = useMemo(() => (loaded ? ['PlanningProposedPourID', 'Pour ID'].map((h) => loaded.headers.indexOf(h)).filter((i) => i >= 0) : []), [loaded]);
  const datesOf = (r: PourRow) => {
    for (const c of pourIdCols) {
      const hit = pourDates.out.get(pourDates.norm(r.cells[c] ?? ''));
      if (hit) return hit;
    }
    return undefined;
  };

  const shiftOf = (r: PourRow, i: number) => {
    const base = loaded?.baseStep.get(r.key) ?? 0;
    return moved.has(r.key) && base && steps[i] ? steps[i] - base : 0;
  };
  const valueOf = (it: ScnItem, field: string): string => {
    if (field === STEP_COL) return steps[it.i] ? String(steps[it.i]) : '';
    if (field === BASE_COL) return String(loaded?.baseStep.get(it.r.key) || '');
    if (field === SHIFT_COL) return String(shiftOf(it.r, it.i) || '');
    if (field === START_WEEK_COL) { const d = datesOf(it.r); return d ? isoWeekLabel(d.start) : ''; }
    if (field === START_MONTH_COL) { const d = datesOf(it.r); return d ? monthLabel(d.start) : ''; }
    if (field === FINISH_WEEK_COL) { const d = datesOf(it.r); return d ? isoWeekLabel(d.finish) : ''; }
    if (field === FINISH_MONTH_COL) { const d = datesOf(it.r); return d ? monthLabel(d.finish) : ''; }
    const col = loaded ? loaded.headers.indexOf(field) : -1;
    return col >= 0 ? it.r.cells[col] ?? '' : '';
  };
  const view = useMemo(
    () => {
      // Flagged only: the flagged pours and everything in a flagged group.
      const shown = flaggedOnly ? visible.filter((it) => flags[it.r.key] || groupKeysOf(it, valueOf).some((k) => flags[k])) : visible;
      return applyView(shown, tableCfg, valueOf, collapsedGroups);
    },
    // valueOf reads steps / loaded / moved, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, tableCfg, collapsedGroups, steps, loaded, moved, pourDates, pourIdCols, flaggedOnly, flags],
  );
  const viewKeys = useMemo(() => view.flatMap((v) => (v.kind === 'row' ? [v.item.r.key] : [])), [view]);
  // Sorted or grouped, the rows are not in pour order, so dragging (which
  // places a pour by its neighbours) is off; the move buttons still work.
  const reordered = tableCfg.sorts.length > 0 || tableCfg.groups.length > 0;

  return {
    project, scenario, stem, loaded, rows, tableCfg, scenarioNames, modelInfo, generatedAt, ready,
    steps, moved, fields, allColumnIds, shownColumns, shiftOf, valueOf, view, viewKeys, reordered,
    stepCount: steps.reduce((m, n) => Math.max(m, n), 0),
    unsequencedCount: rows.filter((r) => r.step === null).length,
    firstUnsequencedKey: rows.find((r) => r.step === null)?.key ?? null,
  };
}
