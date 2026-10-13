import { freshId, whenText, type ContactRule, type RelType } from '../../../prs/rules';
import { Field, Fits, NumberInput, RuleCard, WhenEditor, type RuleContext } from './RuleParts';

/** Rule type Contact link: links built from the clash detection results. Each object of the subject (the slabs, say) is linked to the objects
    the model has in contact with it: every object below it precedes it. The engine's own slab-support and level-gate links can be left
    out for those objects, so this rule takes their place. */

const REL_TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];
const REL_LABEL: Record<RelType, string> = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };

const num = (v: number) => (Number.isFinite(v) ? v : 0);

export const SLABS_ON_BELOW: Omit<ContactRule, 'id'> = {
  name: 'Slabs wait for everything in contact below',
  subject: { family: 'slab' },
  contact: 'below',
  position: 'any',
  with: {},
  predEnd: 'final',
  succEnd: 'start',
  direction: 'subjectIsSuccessor',
  type: 'FS',
  lagHours: 0,
  replaceBuiltIn: ['slabSupport'],
};

export function addContact(ctx: RuleContext, seed?: Omit<ContactRule, 'id'>) {
  ctx.change((r) => ({
    ...r,
    contacts: [
      ...r.contacts,
      { id: freshId('CONTACT', r.contacts.map((c) => c.id)), subject: {}, contact: 'below', position: 'any', with: {}, predEnd: 'final', succEnd: 'start', direction: 'subjectIsSuccessor', type: 'FS', lagHours: 0, ...seed },
    ],
  }));
}

const CONTACT_WORD: Record<ContactRule['contact'], string> = { below: 'below', above: 'above', side: 'beside', any: 'touching' };

export function ContactRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const c = rules.contacts[i];
  const update = (patch: Partial<ContactRule>) => change((r) => ({ ...r, contacts: r.contacts.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <RuleCard
      kind="contact"
      id={c.id}
      onId={(id) => update({ id })}
      enabled={c.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      title={<input className="rule-card__name" value={c.name ?? ''} placeholder="Name (optional)" onChange={(e) => update({ name: e.target.value })} aria-label="Rule name" />}
      onDelete={() => change((r) => ({ ...r, contacts: r.contacts.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, contacts: [...r.contacts.slice(0, i + 1), { ...c, id: freshId(c.id, r.contacts.map((x) => x.id)), subject: { ...c.subject }, with: { ...c.with } }, ...r.contacts.slice(i + 1)] }))}
      summary={`${whenText(c.subject)} ← ${whenText(c.with)} ${CONTACT_WORD[c.contact]} (${c.type ?? 'FS'})`}
      note={<Fits ctx={ctx} when={c.subject} />}
    >
      <WhenEditor ctx={ctx} value={c.subject} onChange={(subject) => update({ subject })} label="Subject: the objects that get links" empty="every object" />
      <div className="rule-grid">
        <Field label="Objects in contact">
          <select value={c.contact} onChange={(e) => update({ contact: e.target.value as ContactRule['contact'] })}>
            <option value="below">below the subject</option>
            <option value="above">above the subject</option>
            <option value="side">beside the subject</option>
            <option value="any">anywhere</option>
          </select>
        </Field>
        <Field label="How sure" help="Definitely = clear vertical separation; any also takes the ones that are mostly lower / higher">
          <select value={c.position ?? 'any'} onChange={(e) => update({ position: e.target.value as ContactRule['position'] })} disabled={c.contact === 'side' || c.contact === 'any'}>
            <option value="any">definitely or mostly</option>
            <option value="definite">definitely only</option>
          </select>
        </Field>
        <Field label="Direction">
          <select value={c.direction ?? 'subjectIsSuccessor'} onChange={(e) => update({ direction: e.target.value as ContactRule['direction'] })}>
            <option value="subjectIsSuccessor">the object precedes the subject</option>
            <option value="subjectIsPredecessor">the subject precedes the object</option>
          </select>
        </Field>
        <Field label="Link">
          <select value={c.type ?? 'FS'} onChange={(e) => update({ type: e.target.value as RelType })}>
            {REL_TYPES.map((t) => <option key={t} value={t}>{REL_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="From the object's" help="Which activity of the object the link leaves from (the predecessor's end)">
          <select value={c.predEnd} onChange={(e) => update({ predEnd: e.target.value as ContactRule['predEnd'] })}>
            <option value="final">concrete (what its successors wait for)</option>
            <option value="start">first activity</option>
            <option value="last">last activity</option>
          </select>
        </Field>
        <Field label="To the subject's">
          <select value={c.succEnd} onChange={(e) => update({ succEnd: e.target.value as ContactRule['succEnd'] })}>
            <option value="start">first activity</option>
            <option value="final">concrete</option>
            <option value="last">last activity</option>
          </select>
        </Field>
        <Field label="Lag (working hours)"><NumberInput value={c.lagHours ?? 0} min={-9999} onChange={(v) => update({ lagHours: num(v) })} /></Field>
        <Field label="Levels apart at most" help="Empty = no limit; 0 = same level only">
          <input className="rule-num" type="number" min={0} step={1} value={c.maxLevelGap ?? ''} onChange={(e) => update({ maxLevelGap: e.target.value === '' ? '' : Number(e.target.value) })} />
        </Field>
      </div>
      <WhenEditor ctx={ctx} value={c.with} onChange={(w) => update({ with: w })} label="Only objects that are" empty="any object in contact" />
      <div className="rule-when">
        <label className={`rule-chip${c.ignoreStage2 ? ' is-on' : ''}`} title="Stage-2 box-outs and later-pass work in contact are not waited for">
          <input type="checkbox" checked={!!c.ignoreStage2} onChange={(e) => update({ ignoreStage2: e.target.checked || undefined })} />
          ignore stage-2 objects
        </label>
        <span className="rule-when__label">Instead of the engine's</span>
        {([['slabSupport', 'slab support links'], ['levelGate', 'level gate']] as const).map(([key, label]) => {
          const on = (c.replaceBuiltIn ?? []).includes(key);
          return (
            <label key={key} className={`rule-chip${on ? ' is-on' : ''}`} title={`Leave out the engine's ${label} into these objects: this rule takes their place`}>
              <input type="checkbox" checked={on} onChange={() => update({ replaceBuiltIn: on ? (c.replaceBuiltIn ?? []).filter((x) => x !== key) : [...(c.replaceBuiltIn ?? []), key] })} />
              {label}
            </label>
          );
        })}
      </div>
      <div className="scn-dim scn-editor__help">The clash detection finds which objects touch (clearance mode, 5 mm). With <em>below</em>, every object touching the subject from underneath finishes before the subject starts. Where one sits is read from the objects' elevations.</div>
    </RuleCard>
  );
}
