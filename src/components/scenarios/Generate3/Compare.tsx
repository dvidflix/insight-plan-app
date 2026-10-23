import { useEffect, useState } from 'react';
import { scenarioNamesFor, useScenarioStore } from '../../../state/scenarioStore';
import { useProjectDbStore } from '../../../state/projectDbStore';
import { useScheduleStore } from '../../../state/scheduleStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { fetchSequence, scenarioFileName } from '../../../scenarios/api';
import { packagesView } from '../../../scenarios/packageSource';
import { normalizeRules } from '../../../prs/rules';
import { treeRows } from '../../../prs/packageTree';
import { isFineTuned, quantities, type WorkPackage } from '../../../prs/workPackages';
import { compareVersions, type VersionSide } from '../../../prs/compareVersions';
import { summariseProgramme } from '../../../schedule/programmeSummary';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { Dialog } from './Controls';
import type { useWorkPackages } from './useWorkPackages';

/** Compare two versions (Generate 3): the open scenario beside another of the same model, their programmes' length, dates, activities and critical
    share (when generated and loaded), their packages' objects and volume, and the packages whose method, days, objects or place differ. The other
    version's packages are worked out on the loaded model, like the open one's (prs/compareVersions.ts). */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number | null, d = 1) => (v === null ? '' : v.toLocaleString(undefined, { maximumFractionDigits: d }));

/** The figures of a scenario's generated programme, when it is loaded. */
function programmeOf(stem: string, scenario: string): VersionSide['programme'] {
  const programmes = useProjectDbStore.getState().programmes;
  const schedules = useScheduleStore.getState().schedules;
  const p = programmes.find((x) => x.kind === 'scenario' && x.scenario === scenario && x.stem === stem);
  const file = `${scenarioFileName(stem, scenario)}.xml`;
  const model = schedules.find((s) => (p && s.dbProgrammeId === p.id) || s.sourceFileName === file);
  if (!model) return null;
  const sum = summariseProgramme(model);
  return sum.activities > 0 ? { days: sum.days, activities: sum.activities, criticalShare: sum.criticalShare, start: sum.start, finish: sum.finish } : null;
}

function sideOf(name: string, packages: readonly WorkPackage[], view: Pick<WP, 'contents' | 'methods' | 'daysOf'>, programme: VersionSide['programme']): VersionSide {
  return {
    name, programme,
    packages: treeRows(packages).map((r) => {
      const own = view.contents.objects.get(r.pkg.id) ?? [];
      return { id: r.pkg.id, code: r.code, name: r.pkg.name, method: own.length ? view.methods.get(r.pkg.id)?.name ?? '' : '', days: view.daysOf.get(r.pkg.id) ?? 0, objects: own.length, volume: quantities(own).volume, fineTuned: isFineTuned(r.pkg) };
    }),
  };
}

export function CompareDialog({ wp, onClose }: { wp: WP; onClose: () => void }) {
  const engine = useViewerEngine();
  const project = useScenarioStore((s) => s.project);
  const drafts = useScenarioStore((s) => s.drafts);
  const loaded = useScenarioStore((s) => s.loaded);
  const scenario = useScenarioStore((s) => s.scenario);
  const sets = useSearchSetsStore((s) => s.sets);
  const others = scenarioNamesFor(project, drafts, loaded?.stem ?? null).filter((x) => x !== scenario);
  const [other, setOther] = useState(others[0] ?? '');
  const [theirs, setTheirs] = useState<VersionSide | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setTheirs(null);
    setError('');
    if (!other || !project || !loaded) return;
    let dead = false;
    void fetchSequence(project.root, loaded.stem, other).then((sheet) => {
      if (dead) return;
      const rules = normalizeRules(sheet.rules);
      const pkgs = rules.packages ?? [];
      const view = packagesView(engine, pkgs, sets, rules.recipes, rules, sheet.crews ?? [], wp.objects);
      setTheirs(sideOf(other, pkgs, view, programmeOf(loaded.stem, other)));
    }).catch((e) => { if (!dead) setError(e instanceof Error ? e.message : String(e)); });
    return () => { dead = true; };
  }, [other, project, loaded, engine, sets, wp.objects]);
  const mine = loaded && scenario ? sideOf(scenario, wp.packages, wp, programmeOf(loaded.stem, scenario)) : null;
  const result = mine && theirs ? compareVersions(mine, theirs) : null;
  return (
    <Dialog title="Compare versions" onClose={onClose}>
      <div className="g3-order__row">
        <span className="g3-adv__label">Compare “{scenario}” with</span>
        <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Scenario to compare with" disabled={!others.length}>
          {!others.length && <option value="">No other scenario of this model: save a version first</option>}
          {others.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span />
      </div>
      {error && <div className="g3-order__note is-warn">“{other}” could not be read: {error}</div>}
      {other && !theirs && !error && <p className="scn-dim g3-adv__why">Reading “{other}”…</p>}
      {result && (
        <>
          <table className="xl">
            <thead><tr><th className="xl__corner" aria-label="Row" /><th /><th>{scenario}</th><th>{other}</th></tr></thead>
            <tbody>
              {result.figures.map((f, i) => (
                <tr key={f.label} className={f.differs ? 'g3-cmp__differs' : ''}>
                  <th className="xl__row" scope="row">{i + 1}</th>
                  <td className="xl__cell xl__ro"><b>{f.label}</b></td>
                  <td className="xl__cell xl__ro">{f.a}</td>
                  <td className="xl__cell xl__ro">{f.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!mine!.programme || !theirs!.programme) && <p className="scn-dim g3-adv__why">“Not generated”: that version has no programme loaded. Generate it (or open it in Programmes) to compare its length.</p>}
          <h4 className="g3-dlg__sub">Packages that differ ({result.packages.length})</h4>
          {result.packages.length === 0 ? <p className="scn-dim g3-adv__why">The packages are the same: same methods, days, objects and order.</p> : (
            <table className="xl">
              <thead><tr><th className="xl__corner" aria-label="Row" /><th>Package</th><th>What differs</th><th>Method · {scenario}</th><th>Method · {other}</th><th>Days · {scenario}</th><th>Days · {other}</th></tr></thead>
              <tbody>
                {result.packages.map((p, i) => (
                  <tr key={`${p.codeA}|${p.codeB}|${p.name}`}>
                    <th className="xl__row" scope="row">{i + 1}</th>
                    <td className="xl__cell xl__ro">{p.codeA || p.codeB} {p.name}</td>
                    <td className="xl__cell xl__ro">{p.what}</td>
                    <td className="xl__cell xl__ro">{p.methodA}</td>
                    <td className="xl__cell xl__ro">{p.methodB}</td>
                    <td className="xl__cell xl__num xl__ro">{n(p.daysA)}</td>
                    <td className="xl__cell xl__num xl__ro">{n(p.daysB)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Dialog>
  );
}
