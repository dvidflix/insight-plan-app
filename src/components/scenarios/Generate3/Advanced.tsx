import { useState, type ReactNode } from 'react';
import { useRecipeStore } from '../../../state/recipeStore';
import { STANDARD_METHODS } from '../../../prs/standardMethods';
import { isFineTuned, type WorkPackage } from '../../../prs/workPackages';
import { subtreeIds } from '../../../prs/packageTree';
import { useEditableGrid } from '../../useEditableGrid';
import { IconChevronDown, IconChevronRight, IconClose } from '../../icons';
import { Dialog, MethodSelect, NumberField, StartSelect, packageAbove, parsePositive } from './Controls';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Generate 3's Advanced: a panel that slides over the timeline, closed by default. It shows only what concerns the package picked (or, with none,
    a few settings for every package), in three short sections in plain words: how it is built and how long it takes, when it starts, and extras.
    Rarely needed details are behind "Show more". At the bottom, two links open focused editors: the methods with their rates, and the crews. None of
    this is the classic Generate view's recipes, rules or parameters: each control here becomes those behind the scenes (prs/workPackages.ts). */

type WP = ReturnType<typeof useWorkPackages>;
const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="g3-adv__sec"><h4>{title}</h4>{children}</section>;
}

/** One setting: its name, the control, and a line saying what it does. */
function Field({ label, why, children }: { label: string; why: string; children: ReactNode }) {
  return <div className="g3-adv__field"><span className="g3-adv__label">{label}</span><div className="g3-adv__ctl">{children}</div><small className="g3-adv__why">{why}</small></div>;
}

export function AdvancedPanel({ wp }: { wp: WP }) {
  const open = useG3((s) => s.advanced);
  const setAdvanced = useG3((s) => s.setAdvanced);
  const picked = useG3((s) => s.picked);
  const [dialog, setDialog] = useState<'methods' | 'crews' | null>(null);
  if (!open) return null;
  const row = wp.rows.find((r) => r.pkg.id === picked);
  return (
    <aside className="g3-adv" aria-label="Advanced">
      <div className="g3-adv__head">
        <span className="g3-adv__tab">Advanced</span>
        <span className="g3-adv__what" title={row ? `${row.code} ${row.pkg.name}` : undefined}>{row ? `${row.code} ${row.pkg.name || 'Package'}` : 'Every package'}</span>
        <button type="button" className="g3-adv__close" onClick={() => setAdvanced(false)} aria-label="Close Advanced" title="Close Advanced (the Advanced button at the bottom opens it again)"><IconClose /></button>
      </div>
      <div className="g3-adv__body">
        {row ? <PackageSettings key={row.pkg.id} wp={wp} p={row.pkg} inside={row.children} /> : <EverySettings wp={wp} />}
        <div className="g3-adv__links">
          <button type="button" className="link-btn" onClick={() => useG3.getState().setRecipeEditor('')} title="This project’s own recipes, in a focused editor">Edit recipes</button>
          <button type="button" className="link-btn" onClick={() => setDialog('methods')} title="Every standard method with its activities and rough rates, and this project’s recipes">See all methods and rates</button>
          <button type="button" className="link-btn" onClick={() => setDialog('crews')} title="How many people each method’s crew has in this scenario">Manage all crews</button>
        </div>
      </div>
      {dialog === 'methods' && <MethodsDialog wp={wp} onClose={() => setDialog(null)} />}
      {dialog === 'crews' && <CrewsDialog wp={wp} onClose={() => setDialog(null)} />}
    </aside>
  );
}

function PackageSettings({ wp, p, inside }: { wp: WP; p: WorkPackage; inside: number }) {
  const [more, setMore] = useState(false);
  const own = wp.contents.objects.get(p.id)?.length ?? 0;
  const m = wp.methods.get(p.id);
  const works = own > 0 && !!m;
  const below = subtreeIds(wp.packages, p.id).filter((id) => id !== p.id && (wp.contents.objects.get(id)?.length ?? 0) > 0);
  const setAllMethods = (method: string) => wp.save(wp.packages.map((x) => (below.includes(x.id) ? { ...x, method: method || undefined, days: undefined, totalDays: undefined, people: undefined } : x)));
  return (
    <>
      {!works && !inside && <p className="g3-adv__note">This package holds no objects of the loaded model, so it is not in the schedule. Add a search set to it (step 1), or delete it.</p>}
      <Section title="1 · How it is built">
        {works && m ? (
          <>
            <Field label="Method" why={m.chosen ? 'Chosen by you.' : `Chosen automatically: ${m.why}.`}><MethodSelect wp={wp} p={p} m={m} /></Field>
            <Field label="Days" why={`Leave empty for the estimate (${n(m.estimate, 1)} days). Type a number to fix this package’s days; its activities share them.`}>
              <NumberField value={p.totalDays} placeholder={n(m.estimate, 1)} label="Days for this package" onChange={(v) => wp.patch(p.id, { totalDays: v, ...(v ? { days: undefined } : {}) })} /> <span className="scn-dim">days</span>
            </Field>
            {m.people !== null && (
              <Field label="Crew size" why={`The ${m.crew.replace(/ \(\d+\)$/, '')} usually has ${m.people} people. More people, fewer days: twice the people halves the days.`}>
                <NumberField value={p.people} placeholder={String(m.people)} label="People in the crew" onChange={(v) => wp.patch(p.id, { people: v ? Math.round(v) : undefined })} /> <span className="scn-dim">people</span>
              </Field>
            )}
            <button type="button" className="g3-adv__more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? <IconChevronDown /> : <IconChevronRight />} {more ? 'Show less' : 'Show more: days of each activity'}</button>
            {more && (
              <div className="g3-days">
                {m.activities.map((a) => (
                  <label key={a.phase} className="g3-days__row" title={a.how}>
                    <span>{a.name}</span>
                    <NumberField className="g3-num" value={p.days?.[a.phase]} placeholder={n(a.days, 1)} label={`Days of ${a.name}`}
                      onChange={(v) => { const days = { ...p.days }; if (v === undefined) delete days[a.phase]; else days[a.phase] = v; wp.patch(p.id, { days: Object.keys(days).length ? days : undefined, totalDays: undefined }); }} />
                    <span className="scn-dim">{a.how}</span>
                  </label>
                ))}
                <small className="g3-adv__why">One activity’s days, fixed here, replace the package’s total above.</small>
              </div>
            )}
          </>
        ) : inside > 0 ? (
          <Field label="Method for all inside" why={`Sets the method of the ${below.length} package${below.length === 1 ? '' : 's'} with objects inside this one. Each can still be changed on its own.`}>
            <SameMethod onPick={setAllMethods} />
          </Field>
        ) : <p className="scn-dim g3-adv__why">Nothing to build.</p>}
      </Section>
      <Section title="2 · When it starts">
        {works && packageAbove(wp, p.id) ? (
          <Field label="Starts" why="Usually after the package above it in the build order. Pick another package to start after it instead; add a gap in working days if needed."><StartSelect wp={wp} p={p} compact /></Field>
        ) : works ? <p className="g3-adv__why">It is the first package: it starts at the start of the schedule.</p> : null}
        {works && (
          <Field label="Object order" why={isFineTuned(p) ? 'Its objects are built one by one, in an order of their own.' : 'Built as one piece. Optional: build its objects one by one in an order you set.'}>
            <button type="button" className="btn btn--small" onClick={() => useG3.getState().setOrderDialog('picked')}>{isFineTuned(p) ? 'See or change the order…' : 'Fine-tune object order…'}</button>
          </Field>
        )}
        {inside > 0 && (
          <Field label="At most at once" why={`How many of the packages inside may be worked on at the same time. Empty: no limit (they follow the build order).`}>
            <NumberField value={p.maxAtOnce} placeholder="no limit" label="Most packages at once" onChange={(v) => wp.patch(p.id, { maxAtOnce: v ? Math.round(v) : undefined })} />
          </Field>
        )}
        {!works && !inside && <p className="g3-adv__why">Nothing to place.</p>}
      </Section>
      <Section title="3 · Extras">
        <label className="g3-adv__check">
          <input type="checkbox" checked={inside > 0 ? p.bar !== false : p.bar === true} onChange={(e) => wp.patch(p.id, { bar: inside > 0 ? (e.target.checked ? undefined : false) : (e.target.checked ? true : undefined) })} />
          <span>Summary bar<small className="g3-adv__why">A bar over the whole package in the programme, from its first activity to its last.{inside > 0 ? ' On by default for a package that holds others.' : ''}</small></span>
        </label>
        {works && (p.extra ? (
          <div className="g3-adv__extra">
            <Field label="Added activity" why="One more activity for this package, with its own days, before or after its method’s activities.">
              <input className="g3-adv__text" value={p.extra.name} placeholder="Activity name" aria-label="Name of the added activity" onChange={(e) => wp.patch(p.id, { extra: { ...p.extra!, name: e.target.value } })} />
              <NumberField value={p.extra.days || undefined} placeholder="1" label="Days of the added activity" onChange={(v) => wp.patch(p.id, { extra: { ...p.extra!, days: v ?? 1 } })} /> <span className="scn-dim">days</span>
              <select value={p.extra.before ? 'before' : 'after'} aria-label="Before or after" onChange={(e) => wp.patch(p.id, { extra: { ...p.extra!, before: e.target.value === 'before' || undefined } })}>
                <option value="after">after the others</option>
                <option value="before">before the others</option>
              </select>
              <button type="button" className="link-btn" onClick={() => wp.patch(p.id, { extra: undefined })}>Remove</button>
            </Field>
          </div>
        ) : <button type="button" className="btn btn--small" onClick={() => wp.patch(p.id, { extra: { name: 'Added activity', days: 1 } })} title="One more activity for this package (before or after its method’s)">+ Add an activity</button>)}
      </Section>
    </>
  );
}

function SameMethod({ onPick }: { onPick: (method: string) => void }) {
  const recipes = useRecipeStore((s) => s.recipes);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  return (
    <select value="-" aria-label="Method for all inside" onChange={(e) => { if (e.target.value !== '-') onPick(e.target.value); }}>
      <option value="-">Choose…</option>
      <option value="">The automatic choice for each</option>
      <optgroup label="Standard methods">{STANDARD_METHODS.map((s) => <option key={s.id} value={`std:${s.id}`}>{s.name}</option>)}</optgroup>
      {chains.length > 0 && <optgroup label="This project’s recipes">{chains.map((r) => <option key={r.id} value={`recipe:${r.id}`}>{r.name?.trim() || r.id}</option>)}</optgroup>}
    </select>
  );
}

/** With no package picked: settings that apply to every package at once. */
function EverySettings({ wp }: { wp: WP }) {
  const strip = (keys: (keyof WorkPackage)[]) => wp.save(wp.packages.map((p) => { const q = { ...p }; for (const k of keys) delete q[k]; return q; }));
  const links = wp.packages.filter((p) => p.link || p.lagDays || p.after).length;
  const methods = wp.packages.filter((p) => p.method).length;
  const days = wp.packages.filter((p) => p.totalDays || p.days || p.people).length;
  const groups = wp.rows.filter((r) => r.children > 0);
  const barsOff = groups.filter((r) => r.pkg.bar === false).length;
  return (
    <>
      <p className="g3-adv__note">Pick a package, in the list or in 3D, to change how it is built, when it starts and what it adds. These apply to every package.</p>
      <Section title="1 · Methods and days">
        <Field label="Methods" why={methods ? `${methods} package${methods === 1 ? ' has a method' : 's have methods'} chosen by hand.` : 'Every package uses the method chosen from its objects.'}>
          <button type="button" className="btn btn--small" disabled={!methods} onClick={() => strip(['method', 'days', 'totalDays', 'people'])}>Back to automatic for all</button>
        </Field>
        <Field label="Days" why={days ? `${days} package${days === 1 ? ' has' : 's have'} days or a crew size set by hand.` : 'Every package uses the estimated days.'}>
          <button type="button" className="btn btn--small" disabled={!days} onClick={() => strip(['days', 'totalDays', 'people'])}>Use the estimates for all</button>
        </Field>
      </Section>
      <Section title="2 · When they start">
        <Field label="Links" why={links ? `${links} package${links === 1 ? ' starts' : 's start'} other than straight after the one above.` : 'Each package starts when the one above it finishes.'}>
          <button type="button" className="btn btn--small" disabled={!links} onClick={() => strip(['link', 'lagDays', 'after'])}>Each after the one above</button>
        </Field>
      </Section>
      {groups.length > 0 && (
        <Section title="3 · Extras">
          <label className="g3-adv__check">
            <input type="checkbox" checked={barsOff === 0} onChange={(e) => wp.save(wp.packages.map((p) => (groups.some((r) => r.pkg.id === p.id) ? { ...p, bar: e.target.checked ? undefined : false } : p)))} />
            <span>Summary bars over the {groups.length} package{groups.length === 1 ? '' : 's'} that hold others<small className="g3-adv__why">A bar from the first activity inside to the last, so the breakdown shows in the programme.</small></span>
          </label>
        </Section>
      )}
    </>
  );
}

/** Every method a package can be built with: the standard ones with their activities and rough rates, and the project's own recipes. */
function MethodsDialog({ wp, onClose }: { wp: WP; onClose: () => void }) {
  const recipes = useRecipeStore((s) => s.recipes).filter((r) => r.enabled !== false && r.chain !== false);
  const used = (key: string) => wp.packages.filter((p) => (wp.contents.objects.get(p.id)?.length ?? 0) > 0 && wp.methods.get(p.id)?.key === key).length;
  const unit = (u: string) => (u === 'm3' ? 'm³' : u === 'm2' ? 'm²' : 'objects');
  return (
    <Dialog title="Methods" onClose={onClose}>
      <p className="scn-dim hint">A method is a short chain of activities, each with a rough rate for one crew. Each package gets one automatically; change it in the package’s row (step 3) or in Advanced.</p>
      <h4 className="g3-dlg__sub">Standard methods</h4>
      <table className="xl">
        <thead><tr><th className="xl__corner" aria-label="Row" /><th>Method</th><th>Activities and rates (one crew, a day)</th><th>Crew</th><th>Packages</th></tr></thead>
        <tbody>
          {STANDARD_METHODS.map((s, i) => (
            <tr key={s.id}>
              <th className="xl__row" scope="row">{i + 1}</th>
              <td className="xl__cell xl__ro">{s.name}</td>
              <td className="xl__cell xl__ro">{s.tasks.map((t) => `${t.name}: ${t.rate} ${unit(t.per)}`).join(' → ')}</td>
              <td className="xl__cell xl__ro">{s.crew.name} ({s.crew.people})</td>
              <td className="xl__cell xl__num xl__ro">{used(`std:${s.id}`) || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="scn-dim g3-adv__why">The rates are starting points. Objects without a volume or area are counted instead (so many a day).</p>
      <h4 className="g3-dlg__sub">This project’s recipes <button type="button" className="link-btn" onClick={() => { onClose(); useG3.getState().setRecipeEditor(''); }}>Edit recipes</button></h4>
      {recipes.length === 0 ? <p className="scn-dim g3-adv__why">This project has no recipes of its own. The standard methods are enough to generate a schedule.</p> : (
        <table className="xl">
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>Recipe</th><th>Used for</th><th>Activities</th><th>Packages</th></tr></thead>
          <tbody>
            {recipes.map((r, i) => (
              <tr key={r.id}>
                <th className="xl__row" scope="row">{i + 1}</th>
                <td className="xl__cell xl__ro">{r.name?.trim() || r.id}</td>
                <td className="xl__cell xl__ro">{r.group.trim() || 'every object'}</td>
                <td className="xl__cell xl__ro">{r.tasks.filter((t) => t.enabled !== false).map((t) => t.name || t.phase).join(' → ')}</td>
                <td className="xl__cell xl__num xl__ro">{used(`recipe:${r.id}`) || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

/** The crews of the standard methods the packages use, and how many people each has in this scenario (the days change in proportion). */
function CrewsDialog({ wp, onClose }: { wp: WP; onClose: () => void }) {
  const live = wp.packages.filter((p) => (wp.contents.objects.get(p.id)?.length ?? 0) > 0);
  const rows = STANDARD_METHODS.map((s) => {
    const pkgs = live.filter((p) => wp.methods.get(p.id)?.key === `std:${s.id}`);
    const sizes = [...new Set(pkgs.map((p) => p.people ?? s.crew.people))];
    return { s, pkgs, people: sizes.length === 1 ? sizes[0] : null };
  }).filter((r) => r.pkgs.length > 0);
  const setPeople = (at: number, v: number | undefined) => {
    const ids = new Set(rows[at].pkgs.map((p) => p.id));
    const people = v && Math.round(v) !== rows[at].s.crew.people ? Math.round(v) : undefined;
    wp.save(wp.packages.map((p) => { if (!ids.has(p.id)) return p; const q = { ...p, people }; if (people === undefined) delete q.people; return q; }));
  };
  const grid = useEditableGrid({
    widthsKey: 'generate3.crews',
    rows,
    get: (col, r) => (col === 'people' ? (r.people === null ? '' : String(r.people)) : ''),
    write: (col, cells) => { if (col === 'people') for (const [at, text] of cells) setPeople(at, parsePositive(text)); },
  });
  return (
    <Dialog title="Crews" onClose={onClose}>
      <p className="scn-dim hint">The crew each method’s packages are built by. Change the people to change the days of every package built that way; one package can differ (Advanced, Crew size).</p>
      {rows.length === 0 ? <p className="scn-dim g3-adv__why">No package uses a standard method: the project’s recipes bring their own crews.</p> : (
        <table className="xl xgrid" {...grid.grid}>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 180 }} /><col style={{ width: 200 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>Method</th><th>Crew</th><th title="People in the crew in this scenario">People</th><th>Packages</th></tr></thead>
          <tbody>
            {rows.map((r, at) => (
              <tr key={r.s.id}>
                <th className="xl__row" scope="row">{at + 1}</th>
                <td className="xl__cell xl__ro">{r.s.name}</td>
                <td className="xl__cell xl__ro">{r.s.crew.name}</td>
                <td className={`xl__cell xl__num xgrid__cell${grid.sel('people', at)}`} data-col="people" data-row={at}>
                  <input {...grid.cell('people', at)} type="text" inputMode="numeric" defaultValue={r.people ?? ''} key={`${r.s.id}:${r.people}`} placeholder={r.people === null ? 'mixed' : String(r.s.crew.people)} title={`Usually ${r.s.crew.people}`} onBlur={(e) => setPeople(at, parsePositive(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  {grid.handle('people', at)}
                </td>
                <td className="xl__cell xl__num xl__ro">{r.pkgs.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
