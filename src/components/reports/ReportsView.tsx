import { useState, type ComponentType } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { ConstraintReport } from './ConstraintReport';
import { FloatReport } from './FloatReport';
import { RelationshipReport } from './RelationshipReport';
import { MilestoneVarianceReport, WbsVarianceReport } from './VarianceReport';

interface ReportProps {
  model: ScheduleModel;
  onBack: () => void;
}

interface ReportDef {
  id: string;
  title: string;
  description: string;
  /** Absent = listed but not built yet. */
  component?: ComponentType<ReportProps>;
}

const STANDARD: ReportDef[] = [
  { id: 'milestone-variance', title: 'Milestone Variance', description: 'Start and finish milestones only, in their WBS branches, with variance columns.', component: MilestoneVarianceReport },
  { id: 'wbs-variance', title: 'WBS Variance', description: 'Activities collapsed to WBS roll-up rows only, with variance columns.', component: WbsVarianceReport },
];

const ANALYSIS: ReportDef[] = [
  { id: 'calendar', title: 'Calendar Analysis', description: 'Which calendars the schedule runs on — working patterns, exceptions and WBS concentration.' },
  { id: 'constraint', title: 'Constraint Analysis', description: 'Hard and soft constraints — coverage, type mix and WBS concentration.', component: ConstraintReport },
  { id: 'delay', title: 'Delay Analysis', description: 'The delay-event register — needs several saved schedule updates to compare.' },
  { id: 'float', title: 'Float Analysis', description: 'Schedule flexibility and criticality — float distribution and negative float.', component: FloatReport },
  { id: 'longest-path', title: 'Longest Path Analysis', description: 'Ranked driving paths through the schedule network and what feeds the finish.' },
  { id: 'milestone', title: 'Milestone Analysis', description: 'The milestone register — status against the data date and upcoming/overdue queues.' },
  { id: 'relationship', title: 'Relationship and Lag Analysis', description: 'Network logic — relationship type mix, lags and leads, and cross-WBS links.', component: RelationshipReport },
];

export function ReportsView({ model }: { model: ScheduleModel }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = [...STANDARD, ...ANALYSIS].find((r) => r.id === openId);

  if (open?.component) {
    const Report = open.component;
    return <div className="reports-view"><Report model={model} onBack={() => setOpenId(null)} /></div>;
  }

  const list = (title: string, defs: ReportDef[]) => (
    <>
      <div className="report-section__title">{title}</div>
      <div className="report-list">
        {defs.map((d) => (
          <button key={d.id} type="button" className="report-list__row" disabled={!d.component} onClick={() => setOpenId(d.id)}>
            <span className="report-list__name">{d.title}</span>
            <span className="report-list__desc">{d.component ? d.description : `${d.description} (not available yet)`}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="reports-view">
      <div className="report-header">
        <h2 className="report-header__title">Reports and Analysis</h2>
        <div className="report-header__desc">Select a report to open it.</div>
      </div>
      {list('Standard reports', STANDARD)}
      {list('Analysis', ANALYSIS)}
    </div>
  );
}
