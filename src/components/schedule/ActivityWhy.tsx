import { useMemo, type ReactNode } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { drives } from '../../schedule/drivingPath';
import { indexWhy, whyKey, whyWords } from '../../schedule/whyText';
import { useWhyStore } from '../../state/whyStore';

/** Why an activity is where it is: what it waits for and why each link is there (the generator's own reason for it), what it holds back, and the recipe and
    work item that made it. The reasons come with each Update 4D, so a programme opened from the database without one says to update. Nothing is guessed:
    a link the generator did not label (one made by hand in the programme) says so. */

const MAX = 12;
const lagText = (h: number) => (h ? ` ${h > 0 ? '+' : ''}${h} h` : '');

export function ActivityWhy({ activity, model, onSelect }: { activity: Activity; model: ScheduleModel; onSelect: (a: Activity) => void }) {
  const { file, why } = useWhyStore();
  const mine = !!why && file === model.sourceFileName;
  const index = useMemo(() => (mine ? indexWhy(why) : null), [mine, why]);
  const byId = useMemo(() => new Map(model.activities.map((a) => [a.id, a])), [model]);
  const reasonOf = (pred: Activity, succ: Activity, type: string) => {
    if (!index) return null;
    const hit = (index.into.get(succ.code) ?? []).find((l) => l[0] === pred.code && whyKey(l[0], l[1], l[2]) === whyKey(pred.code, succ.code, type));
    return hit ? whyWords(hit[4]) : 'not made by the generator: a link added in the programme by hand';
  };
  const into = model.relationships.filter((r) => r.succId === activity.id);
  const out = model.relationships.filter((r) => r.predId === activity.id);
  const recipe = String(activity.udf['CWA-Recipe'] ?? '').trim();
  const item = String(activity.udf['Work Item'] ?? '').trim();

  const list = (rels: typeof into, side: 'pred' | 'succ'): ReactNode => (
    <ul className="why-list">
      {rels.slice(0, MAX).map((r) => {
        const other = byId.get(side === 'pred' ? r.predId : r.succId);
        if (!other) return null;
        const pred = side === 'pred' ? other : activity;
        const succ = side === 'pred' ? activity : other;
        const driving = side === 'pred' && drives(r, pred, succ);
        return (
          <li key={`${r.predId}|${r.succId}|${r.type}`}>
            <button type="button" className="link-btn" onClick={() => onSelect(other)} title="Open this activity">{other.code}</button>{' '}
            <span className="scn-dim">{other.name}</span>{' '}
            <b>{r.type}{lagText(r.lagHours)}</b>{driving && <span className="why-driving" title="This link sets the start of the activity: delaying it delays this activity"> · driving</span>}
            {mine && <div className="scn-dim">Because of {reasonOf(pred, succ, r.type)}.</div>}
          </li>
        );
      })}
      {rels.length > MAX && <li className="scn-dim">and {rels.length - MAX} more</li>}
    </ul>
  );

  return (
    <div className="why">
      {!mine && <div className="scn-dim xl__note">The reason for each link comes with Update 4D (Generate). This programme was opened without it, so only what the programme itself shows is given here.</div>}
      <p className="why__line">
        {activity.isCritical ? <b>On the critical path</b> : <>Not critical{activity.totalFloatHours !== null ? `: ${Math.round(activity.totalFloatHours * 10) / 10} working hours of float` : ''}</>}
        {recipe ? <> · made by the recipe “{recipe}”</> : null}{item ? <> · work item “{item}”</> : null}.
      </p>
      <h5 className="why__head">Starts after ({into.length})</h5>
      {into.length ? list(into, 'pred') : <div className="scn-dim">Nothing: it can start when the programme starts.</div>}
      <h5 className="why__head">Holds back ({out.length})</h5>
      {out.length ? list(out, 'succ') : <div className="scn-dim">Nothing follows it.</div>}
    </div>
  );
}
