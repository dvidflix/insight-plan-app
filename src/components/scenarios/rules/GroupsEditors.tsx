import { useMemo, useState } from 'react';
import { groupInstances, previewSequence } from '../../../prs/match';
import { FAMILIES } from '../../../prs/rules';
import { FILTER_OPS, freshId, type GroupFilter, type FilterOp, type LevelLink, type LevelTask, type RelType, type RuleGroup, type RuleSequence } from '../../../prs/rules';
import { CellPick } from '../../CellPick';
import { IconSectionChevron, IconRemove } from '../../icons';
import { Field, NumberInput, RuleCard, type RuleContext } from './RuleParts';
import { useSearchSetsStore } from '../../../state/searchSetsStore';

/** Rule types Group, Level task, Sequence and Level link (rows of the Rules list). Groups are named selections of objects that
    live in the rules (they are not the 4D Link Groups) and can be far more granular; the others use them by name. */

const FOR_EACH: { id: RuleGroup['forEach'][number]; label: string }[] = [
  { id: 'building', label: 'building' },
  { id: 'level', label: 'level' },
  { id: 'zone', label: 'zone' },
  { id: 'type', label: 'type' },
  { id: 'family', label: 'family' },
  { id: 'stage', label: 'stage' },
];
const REL_TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const REL_LABEL: Record<RelType, string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };

const num = (v: number) => (Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------- groups

let seq = 0;
/** A condition row (the field, the operator and the value; the first row's And / Or is not used). */
export const cond = (field: string, op: FilterOp, value: string, conj: 'and' | 'or' = 'and'): GroupFilter => ({ id: `c${Date.now().toString(36)}${seq++}`, field, op, value, conj });

const COLS = '44px minmax(0, 1.5fr) 96px minmax(0, 1fr) 68px 26px';

const ConjSelect = ({ value, first, onChange }: { value: 'and' | 'or'; first: boolean; onChange: (c: 'and' | 'or') => void }) =>
  first ? <span /> : <CellPick value={value} options={[{ value: 'and', label: 'And' }, { value: 'or', label: 'Or' }]} onChange={(v) => onChange(v as 'and' | 'or')} title="And / Or" />;

/** A group's conditions, as the 4D Link Group editor lists its object conditions: And / Or, field, is, value, Aa (case) and Ign (switched off). */
function GroupFilters({ ctx, filters, onChange }: { ctx: RuleContext; filters: GroupFilter[]; onChange: (f: GroupFilter[]) => void }) {
  const [open, setOpen] = useState(true);
  const set = (id: string, patch: Partial<GroupFilter>) => onChange(filters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const suggestions: Record<string, string[]> = { building: ctx.buildings, level: ctx.levels, type: ctx.types, stage: ctx.stages, family: [...FAMILIES] };
  const counted = filters.filter((c) => !c.ignore && c.value.trim()).length;
  return (
    <div className="ge">
      <section className="ge-sec">
        <div className="ge-sec__bar">
          <button type="button" className="ge-sec__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <IconSectionChevron className="section-chevron" />
            <span>Objects</span>
            {filters.length > 0 && <span className="ge-sec__count">{filters.length}</span>}
          </button>
          {open && <button type="button" className="ge-add" onClick={() => onChange([...filters, cond('type', 'equals', '')])}>+ condition</button>}
        </div>
        {open && (
          <div className="ge-table">
            <div className="ge-row ge-row--head" style={{ gridTemplateColumns: COLS }}><span /><span>Field</span><span>Is</span><span>Value</span><span /><span /></div>
            {filters.map((c, i) => (
              <div key={c.id} className="ge-row" style={{ gridTemplateColumns: COLS }}>
                <ConjSelect value={c.conj} first={i === 0} onChange={(conj) => set(c.id, { conj })} />
                <CellPick value={c.field} options={ctx.fields} onChange={(field) => set(c.id, { field })} />
                <CellPick value={c.op} options={FILTER_OPS} onChange={(op) => set(c.id, { op: op as FilterOp })} />
                <input value={c.value} list={suggestions[c.field] ? `rule-val-${c.field}` : undefined} onChange={(e) => set(c.id, { value: e.target.value })} placeholder={c.op === 'equals' || c.op === 'notEquals' ? 'value, or A|B' : 'value'} spellCheck={false} />
                <span className="ge-flags">
                  <button type="button" className={`tags__chip${c.caseSensitive ? ' active' : ''}`} aria-pressed={!!c.caseSensitive} title="Case-sensitive (for model properties)" onClick={() => set(c.id, { caseSensitive: !c.caseSensitive || undefined })}>Aa</button>
                  <button type="button" className={`tags__chip${c.ignore ? ' active' : ''}`} aria-pressed={!!c.ignore} title="Ignore this condition" onClick={() => set(c.id, { ignore: !c.ignore || undefined })}>Ign</button>
                </span>
                <button type="button" className="cols__icon cols__icon--remove" title="Remove" aria-label="Remove" onClick={() => onChange(filters.filter((x) => x.id !== c.id))}><IconRemove /></button>
              </div>
            ))}
            {counted === 0 && <div className="ge-none">No condition with a value: the group holds no objects{filters.length === 0 ? '' : ' yet'}.</div>}
            {Object.entries(suggestions).map(([field, list]) => (
              <datalist key={field} id={`rule-val-${field}`}>{list.map((v) => <option key={v} value={v} />)}</datalist>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function addGroup(ctx: RuleContext, seed?: Partial<RuleGroup>) {
  ctx.change((r) => ({
    ...r,
    groups: [...r.groups, { forEach: ['building', 'level'], filters: [], ...seed, id: freshId(seed?.id ?? 'GROUP', r.groups.map((g) => g.id)) }],
  }));
}

/** The groups most programmes start with. */
export const addStarterGroups = (ctx: RuleContext) => {
  addGroup(ctx, { id: 'WALLS', filters: [cond('family', 'equals', 'wall')] });
  addGroup(ctx, { id: 'SLABS', filters: [cond('family', 'equals', 'slab')] });
  addGroup(ctx, { id: 'RAFTS', forEach: ['building'], filters: [cond('family', 'equals', 'raft')] });
};

/** The generator's own scope as three groups: the types it does not schedule, the objects under 0.25 m³ (a stair is never "small"), and
    the small in-situ stair objects that are steps cast with their flight. */
export function addStarterScope(ctx: RuleContext) {
  addGroup(ctx, { id: 'NOT-SCHEDULED', name: 'Types not scheduled', forEach: [], treatAs: 'exclude', filters: [cond('type', 'equals', 'BOSS|SCREED|GROUT|SPECIAL')] });
  addGroup(ctx, { id: 'SMALL', name: 'Objects under 0.25 m³', forEach: [], treatAs: 'exclude', filters: [cond('volume', 'lessThan', '0.25'), cond('type', 'notEquals', 'STAIR')] });
  addGroup(ctx, { id: 'STAIR-STEPS', name: 'Stair steps (cast with their flight)', forEach: [], treatAs: 'stairStep', filters: [cond('type', 'equals', 'STAIR'), cond('volume', 'lessThan', '0.09')] });
}

export function RuleGroupRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const [listed, setListed] = useState(false);
  const g = rules.groups[i];
  const update = (patch: Partial<RuleGroup>) => change((r) => ({ ...r, groups: r.groups.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const instances = groupInstances(g, ctx.facts, ctx.membership);
  const objects = instances.reduce((n, x) => n + x.pours, 0);
  const others = rules.groups.filter((o) => o.id !== g.id);
  return (
    <RuleCard
      kind="group"
      id={g.id}
      onId={(id) => change((r) => ({ ...r, groups: r.groups.map((x, j) => (j === i ? { ...x, id } : { ...x, include: (x.include ?? []).map((n) => (n === g.id ? id : n)) })) }))}
      enabled={g.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      title={<input className="rule-card__name" value={g.name ?? ''} placeholder="Name (optional)" onChange={(e) => update({ name: e.target.value })} aria-label="Group name" />}
      onCopy={() => change((r) => ({ ...r, groups: [...r.groups.slice(0, i + 1), { ...g, id: freshId(g.id, r.groups.map((x) => x.id)), filters: g.filters.map((c) => ({ ...c })) }, ...r.groups.slice(i + 1)] }))}
      onDelete={() => change((r) => ({ ...r, groups: r.groups.filter((_, j) => j !== i).map((x) => ({ ...x, include: (x.include ?? []).filter((n) => n !== g.id) })) }))}
      summary={`${g.treatAs === 'exclude' ? 'LEFT OUT of the schedule · ' : g.treatAs === 'stairStep' ? 'stair steps · ' : ''}${g.forEach.length ? `made per ${g.forEach.join(', ')}` : 'one group for the whole model'}`}
      note={ctx.facts.length ? `${objects.toLocaleString()} object${objects === 1 ? '' : 's'} in ${instances.length} group${instances.length === 1 ? '' : 's'}` : undefined}
    >
      <GroupFilters ctx={ctx} filters={g.filters} onChange={(filters) => update({ filters })} />
      {others.length > 0 && (
        <div className="rule-when">
          <span className="rule-when__label">Also the objects of</span>
<div className="rule-when__items">
          {others.map((o) => {
            const on = (g.include ?? []).includes(o.id);
            return (
              <label key={o.id} className={`rule-chip${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => update({ include: on ? (g.include ?? []).filter((n) => n !== o.id) : [...(g.include ?? []), o.id] })} />
                {o.id}
              </label>
            );
          })}
</div>
        </div>
      )}
      <div className="rule-when">
        <span className="rule-when__label">Made per</span>
<div className="rule-when__items">
        {FOR_EACH.map((f) => {
          const on = g.forEach.includes(f.id);
          return (
            <label key={f.id} className={`rule-chip${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => update({ forEach: on ? g.forEach.filter((x) => x !== f.id) : [...g.forEach, f.id] })} />
              {f.label}
            </label>
          );
        })}
        {g.forEach.length === 0 && <span className="scn-dim">one group for the whole model</span>}
</div>
      </div>
      <div className="rule-when">
        <span className="rule-when__label">Objects in this group</span>
<div className="rule-when__items">
        <select value={g.treatAs ?? ''} onChange={(e) => update({ treatAs: (e.target.value || undefined) as RuleGroup['treatAs'] })} aria-label="What happens to the objects of this group">
          <option value="">are scheduled as usual</option>
          <option value="exclude">are left out of the schedule</option>
          <option value="stairStep">are stair steps, cast with the flight they touch</option>
        </select>
</div>
      </div>
      {ctx.facts.length > 0 && (
        <div className="scn-dim">
          <button type="button" className="mini-btn" onClick={() => setListed(!listed)}>{listed ? 'hide the groups' : 'list the groups'}</button>
        </div>
      )}
      {listed && (
        <div className="rule-list scn-dim">
          {instances.length === 0 ? 'No objects.' : instances.map((x) => <span key={x.label} className="rule-list__item">{x.label}: {x.pours}</span>)}
        </div>
      )}
    </RuleCard>
  );
}

// ---------------------------------------------------------------- level tasks

export function addLevelTask(ctx: RuleContext, seed?: Partial<LevelTask>) {
  ctx.change((r) => ({ ...r, levelTasks: [...r.levelTasks, { id: freshId(seed?.id ?? 'TASK', r.levelTasks.map((t) => t.id)), name: seed?.name ?? '', group: seed?.group ?? r.groups[0]?.id ?? '' }] }));
}

/** The options of a group picker: the search sets, by folder (a value that is not one stays listed, marked). */
function SetOptions({ ctx, value }: { ctx: RuleContext; value: string }) {
  const known = ctx.groupIds.some((g) => g.toUpperCase() === value.trim().toUpperCase());
  return (
    <>
      <option value="">{ctx.groupIds.length ? '—' : 'No search sets yet (Models › Search sets)'}</option>
      {value && !known && <option value={value}>{value} (no search set of this name)</option>}
      {ctx.groupFolders.filter((f) => f.names.length > 0).map((f) => (
        <optgroup key={f.folder} label={`Search sets${f.folder ? ` · folder "${f.folder}"` : ''}`}>
          {f.names.map((n) => <option key={`${f.folder}|${n}`} value={n}>{n}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/** One level task for each group that is made per level (Walls, Slabs ...). */
export const addStarterLevelTasks = (ctx: RuleContext) =>
  ctx.rules.groups
    .filter((g) => g.forEach.includes('level'))
    .forEach((g) => addLevelTask(ctx, { id: g.id, name: g.name || g.id[0] + g.id.slice(1).toLowerCase(), group: g.id }));

export function LevelTaskRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const t = rules.levelTasks[i];
  const update = (patch: Partial<LevelTask>) => change((r) => ({ ...r, levelTasks: r.levelTasks.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const group = rules.groups.find((g) => g.id === t.group);
  const instances = group ? groupInstances(group, ctx.facts, ctx.membership) : [];
  return (
    <RuleCard
      kind="levelTask"
      id={t.id}
      onId={(id) => change((r) => ({ ...r, levelTasks: r.levelTasks.map((x, j) => (j === i ? { ...x, id } : x)), levelLinks: r.levelLinks.map((l) => ({ ...l, tasks: l.tasks.map((n) => (n === t.id ? id : n)) })) }))}
      enabled={t.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, levelTasks: r.levelTasks.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, levelTasks: [...r.levelTasks.slice(0, i + 1), { ...t, id: freshId(t.id, r.levelTasks.map((x) => x.id)) }, ...r.levelTasks.slice(i + 1)] }))}
      summary={`${t.name || t.id} from group ${t.group || '—'}`}
      note={group && ctx.facts.length ? `${instances.length} task${instances.length === 1 ? '' : 's'}: one for each ${group.forEach.join(' and ') || 'model'} the group has objects in` : undefined}
      problem={t.group && !group ? `The group "${t.group}" does not exist` : null}
    >
      <div className="rule-grid">
        <Field label="Name"><input value={t.name} onChange={(e) => update({ name: e.target.value })} placeholder="Walls" /></Field>
        <Field label="Group" help="A search set (Models › Search sets): the objects it finds are the group.">
          <select value={t.group} onChange={(e) => update({ group: e.target.value })}>
            <SetOptions ctx={ctx} value={t.group} />
          </select>
        </Field>
      </div>
      <div className="scn-dim scn-editor__help">A level of effort that starts with the earliest object of the group and finishes with the latest. Activity ID: <code>{`<project>-<building>-<level>-${t.id}`}</code>, named "{'<building> - <level> - '}{t.name || t.id}".</div>
    </RuleCard>
  );
}

// ---------------------------------------------------------------- sequences

function SequencePreview({ ctx, seq }: { ctx: RuleContext; seq: RuleSequence }) {
  const order = useMemo(() => previewSequence(ctx.rules, seq.id, ctx.facts, ctx.membership), [ctx.rules, seq.id, ctx.facts, ctx.membership]);
  if (!order.length) return null;
  return (
    <div className="rule-order scn-dim" title={order.join(' → ')}>
      {order.slice(0, 14).join(' → ')}
      {order.length > 14 ? ` … → ${order[order.length - 1]}` : ''} <span>({order.length} steps for the first building)</span>
    </div>
  );
}

export function addSequence(ctx: RuleContext) {
  ctx.change((r) => ({
    ...r,
    sequences: [...r.sequences, { id: freshId('SEQ', r.sequences.map((s) => s.id)), steps: [{ group: r.groups[0]?.id ?? '' }, { group: r.groups[1]?.id ?? r.groups[0]?.id ?? '' }] }],
  }));
}

export function SequenceRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const s = rules.sequences[i];
  const update = (patch: Partial<RuleSequence>) => change((r) => ({ ...r, sequences: r.sequences.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const sets = useSearchSetsStore((st) => st.sets);
  const folders = [...new Set(sets.map((x) => x.group ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const fromFolder = !!s.stepsFolder;
  const moveStep = (k: number, d: -1 | 1) => {
    const steps = [...s.steps];
    const to = k + d;
    if (to < 0 || to >= steps.length) return;
    [steps[k], steps[to]] = [steps[to], steps[k]];
    update({ steps });
  };
  return (
    <RuleCard
      kind="sequence"
      id={s.id}
      onId={(id) => update({ id })}
      enabled={s.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      title={<input className="rule-card__name" value={s.name ?? ''} placeholder="Name (optional)" onChange={(e) => update({ name: e.target.value })} aria-label="Sequence name" />}
      onDelete={() => change((r) => ({ ...r, sequences: r.sequences.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, sequences: [...r.sequences.slice(0, i + 1), { ...s, id: freshId(s.id, r.sequences.map((x) => x.id)), steps: s.steps.map((x) => ({ ...x })) }, ...r.sequences.slice(i + 1)] }))}
      summary={s.steps.map((st) => `${st.group || '—'}${st.perLevel ? '/level' : ''}`).join(' → ')}
    >
      <SequencePreview ctx={ctx} seq={s} />
      <div className="rule-grid">
        <Field label="Steps from a folder of sets" help="Each search set of the folder is a step, in the folder's order (by number when the names start with one). Add, remove or reorder the sets there, in Models > Search sets, and the sequence follows. Choose none to write the steps here.">
          <select value={s.stepsFolder ?? ''} onChange={(e) => update({ stepsFolder: e.target.value || undefined })} aria-label="Steps from a folder of sets">
            <option value="">None: the steps below</option>
            {s.stepsFolder && !folders.includes(s.stepsFolder) && <option value={s.stepsFolder}>{s.stepsFolder} (not found)</option>}
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
      </div>
      <div className="rule-steps">
        {s.steps.map((st, k) => (
          <div key={k} className="rule-step">
            <span className="rule-step__n">{k + 1}</span>
            <select value={st.group} disabled={fromFolder} onChange={(e) => update({ steps: s.steps.map((x, j) => (j === k ? { ...x, group: e.target.value } : x)) })} aria-label="Group">
              <SetOptions ctx={ctx} value={st.group} />
            </select>
            <label className="rule-chip" title="Repeat this step for every level, in turn">
              <input type="checkbox" checked={!!st.perLevel} onChange={(e) => update({ steps: s.steps.map((x, j) => (j === k ? { ...x, perLevel: e.target.checked || undefined } : x)) })} />
              per level
            </label>
            {!fromFolder && <button type="button" className="mini-btn" onClick={() => moveStep(k, -1)} disabled={k === 0} aria-label="Move step up">↑</button>}
            {!fromFolder && <button type="button" className="mini-btn" onClick={() => moveStep(k, 1)} disabled={k === s.steps.length - 1} aria-label="Move step down">↓</button>}
            {!fromFolder && <button type="button" className="cols__icon cols__icon--remove" onClick={() => update({ steps: s.steps.filter((_, j) => j !== k) })} aria-label="Remove step"><IconRemove /></button>}
          </div>
        ))}
        {!fromFolder && <button type="button" className="mini-btn" onClick={() => update({ steps: [...s.steps, { group: ctx.groupIds[0] ?? '' }] })}>+ step</button>}
      </div>
      <div className="rule-grid">
        <Field label="Link">
          <select value={s.type ?? 'FS'} onChange={(e) => update({ type: e.target.value as RelType })}>
            {REL_TYPES.map((t) => <option key={t} value={t}>{REL_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Lag (working hours)" help="Into the next step; 8 h = 1 day"><NumberInput value={s.lagHours ?? 0} min={-9999} onChange={(v) => update({ lagHours: num(v) })} /></Field>
      </div>
      <div className="scn-dim scn-editor__help">What is in one step finishes before the next starts (a milestone joins them). A step marked "per level" is repeated level by level. Cycles are dropped from the engine's own links, never from the sequence.</div>
    </RuleCard>
  );
}

// ---------------------------------------------------------------- level links

export function addLevelLink(ctx: RuleContext) {
  ctx.change((r) => ({ ...r, levelLinks: [...r.levelLinks, { id: freshId('LINK', r.levelLinks.map((l) => l.id)), activities: 'extras', tasks: r.levelTasks.map((t) => t.id), type: 'FF', direction: 'toTask' }] }));
}

const ACTIVITIES_LABEL: Record<LevelLink['activities'], string> = { extras: 'extra activities', open: 'open-ended activities', select: 'a selection' };

export function LevelLinkRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const l = rules.levelLinks[i];
  const update = (patch: Partial<LevelLink>) => change((r) => ({ ...r, levelLinks: r.levelLinks.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <RuleCard
      kind="levelLink"
      id={l.id}
      onId={(id) => update({ id })}
      enabled={l.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      title={<input className="rule-card__name" value={l.name ?? ''} placeholder="Name (optional)" onChange={(e) => update({ name: e.target.value })} aria-label="Link name" />}
      onDelete={() => change((r) => ({ ...r, levelLinks: r.levelLinks.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, levelLinks: [...r.levelLinks.slice(0, i + 1), { ...l, id: freshId(l.id, r.levelLinks.map((x) => x.id)), tasks: [...l.tasks] }, ...r.levelLinks.slice(i + 1)] }))}
      summary={`${ACTIVITIES_LABEL[l.activities]} ${l.type ?? 'FF'} ${l.direction === 'fromTask' ? 'from' : 'to'} ${l.tasks.join(', ') || 'no task'}`}
    >
      <div className="rule-grid">
        <Field label="Activities">
          <select value={l.activities} onChange={(e) => update({ activities: e.target.value as LevelLink['activities'] })}>
            <option value="extras">Extra activities</option>
            <option value="open">Open-ended activities</option>
            <option value="select">A selection…</option>
          </select>
        </Field>
        {(l.activities === 'select' || l.activities === 'open') && (
          <Field label={l.activities === 'open' ? 'Only these (optional)' : 'Selection'} wide>
            <input value={l.select ?? ''} onChange={(e) => update({ select: e.target.value })} placeholder="select:{family=column; phase=Concrete}" spellCheck={false} />
          </Field>
        )}
        {l.activities === 'extras' && (
          <Field label="To the pours (optional)" wide>
            <input value={l.pours ?? ''} onChange={(e) => update({ pours: e.target.value || undefined })} placeholder="select:{type=SLAB; phase=Concrete}" spellCheck={false} />
          </Field>
        )}
        <Field label="Link">
          <select value={l.type ?? 'FF'} onChange={(e) => update({ type: e.target.value as RelType })}>
            {REL_TYPES.map((t) => <option key={t} value={t}>{REL_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={l.direction ?? 'toTask'} onChange={(e) => update({ direction: e.target.value as LevelLink['direction'] })}>
            <option value="toTask">{l.pours ? 'activity → pour' : 'activity → level task'}</option>
            <option value="fromTask">{l.pours ? 'pour → activity' : 'level task → activity'}</option>
          </select>
        </Field>
        <Field label="Lag (hours)"><NumberInput value={l.lagHours ?? 0} min={-9999} onChange={(v) => update({ lagHours: num(v) })} /></Field>
      </div>
      <div className="rule-when">
        <span className="rule-when__label">{l.pours ? 'Only extras tagged with' : 'To the level tasks'}</span>
<div className="rule-when__items">
        {rules.levelTasks.map((t) => {
          const on = l.tasks.includes(t.id);
          return (
            <label key={t.id} className={`rule-chip${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => update({ tasks: on ? l.tasks.filter((x) => x !== t.id) : [...l.tasks, t.id] })} />
              {t.id}
            </label>
          );
        })}
</div>
      </div>
      <div className="scn-dim scn-editor__help">Ties activities to the level tasks of their own building and level. With <strong>To the pours</strong> filled in, an extra is tied to those pours of its own building and level instead (for example <code>select:{'{'}type=SLAB; phase=Concrete{'}'}</code>: the Concrete of the slabs; add a second link, with Start → Start, for both). <strong>Extra activities</strong> need a building and level. <strong>Open-ended activities</strong> are the ones left with no successor; linking them here takes the place of their close-out link. Finish → Finish to a level task means the task finishes with the activity.</div>
    </RuleCard>
  );
}
