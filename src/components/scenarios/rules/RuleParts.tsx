import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { IconCopy, IconEye, IconEyeOff, IconSectionChevron, IconRemove } from '../../icons';
import { KIND_BY_ID, type RuleKind } from './kinds';
import { setRules, useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { countWhen, factsOf, groupMembership, levelNumber, type PourFact } from '../../../prs/match';
import { FAMILIES, FILTER_FIELDS, NO_RULES, WHEN_KEYS, isEmptyRules, mergeTrades, whenText, type EngineDefaults, type ScenarioRules, type When, type WhenKey } from '../../../prs/rules';

/** The pieces the Rules panel's editors share: the rules and what they can name (buildings, levels, types, groups), the
    card a rule is edited in, and the condition editor ("when") every rate / link rule has. */

export interface RuleContext {
  rules: ScenarioRules;
  /** Applies a change to the rules (kept as NO_RULES when nothing is left, so "unsaved" goes away). */
  change: (fn: (r: ScenarioRules) => ScenarioRules) => void;
  defaults: EngineDefaults | null;
  facts: PourFact[];
  membership: Map<string, Set<string>>;
  buildings: string[];
  levels: string[];
  types: string[];
  stages: string[];
  groupIds: string[];
  /** The fields a group condition can read: the object's own, and the properties of the object table. */
  fields: { value: string; label: string }[];
  /** Objects a `when` fits, of all the scenario's objects. */
  fits: (when: When | undefined) => number;
}

/** The trades a crew can name: the generator's and the rules' (Trade rules over them). */
export function useTrades() {
  const engine = useScenarioStore((s) => s.crewOptions?.trades);
  const rows = useScenarioStore((s) => s.rules.trades);
  return useMemo(() => mergeTrades(engine ?? [], rows), [engine, rows]);
}

const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];

export function useRuleContext(): RuleContext {
  const rules = useScenarioStore((s) => s.rules);
  const defaults = useScenarioStore((s) => s.engineDefaults);
  const { loaded, rows } = useScenarioView();
  const facts = useMemo(() => (loaded ? factsOf(loaded.headers, rows) : []), [loaded, rows]);
  const headers = loaded?.headers;
  const fields = useMemo(() => [...FILTER_FIELDS, ...(headers ?? []).filter((h) => h.trim()).map((h) => ({ value: `prop:CWA Pour/${h}`, label: `CWA Pour / ${h}` }))], [headers]);
  const membership = useMemo(() => groupMembership(rules.groups, facts), [rules.groups, facts]);
  return useMemo<RuleContext>(
    () => ({
      rules,
      change: (fn) => {
        const next = fn(useScenarioStore.getState().rules);
        setRules(isEmptyRules(next) ? NO_RULES : next);
      },
      defaults,
      facts,
      membership,
      buildings: uniq(facts.map((f) => f.building)).sort(),
      levels: uniq(facts.map((f) => f.level)).sort((a, b) => (levelNumber(a) ?? 0) - (levelNumber(b) ?? 0)),
      types: uniq([...facts.map((f) => f.type), ...(defaults?.pourTypes ?? [])]).sort(),
      stages: uniq(facts.map((f) => f.stage)).sort(),
      groupIds: rules.groups.map((g) => g.id),
      fields,
      fits: (when) => countWhen(when, facts, membership),
    }),
    [rules, defaults, facts, membership, fields],
  );
}

/** The list row a card sits in, and the row just added (it opens by itself). */
export const EntryKeyContext = createContext<string>('');
export const FreshEntryContext = createContext<string | null>(null);

/** One rule: a header (on / off, id, copy, delete) and its fields. */
export function RuleCard({
  id, onId, enabled, onEnabled, title, onCopy, onDelete, note, problem, children, kind, summary, defaultOpen, collapsed, onCollapsed, hideHead,
}: {
  /** The card without its header line (its id, switch, copy and delete are somewhere else on the screen). */
  hideHead?: boolean;
  /** A card that is not in the rules list (no `kind`) is always open; with these two it can be folded: `collapsed` is the state the owner keeps. */
  collapsed?: boolean;
  onCollapsed?: (collapsed: boolean) => void;
  /** In the rules list: the rule's type (shown as a badge) and a one-line summary; the card then opens and closes. */
  kind?: RuleKind;
  summary?: ReactNode;
  defaultOpen?: boolean;
  id: string;
  onId?: (id: string) => void;
  enabled: boolean;
  /** Without it the rule has no on / off switch (a setting is simply there or not). */
  onEnabled?: (on: boolean) => void;
  title?: ReactNode;
  onCopy?: () => void;
  onDelete: () => void;
  /** A line under the header: what the rule does, or how many objects it fits. */
  note?: ReactNode;
  problem?: string | null;
  children?: ReactNode;
}) {
  const entryKey = useContext(EntryKeyContext);
  const fresh = useContext(FreshEntryContext);
  const [open, setOpen] = useState(defaultOpen || !kind || (!!entryKey && entryKey === fresh));
  const meta = kind ? KIND_BY_ID[kind] : undefined;
  return (
    <div className={`rule-card${hideHead ? ' rule-card--bare' : ''}${enabled ? '' : ' is-off'}${problem ? ' has-problem' : ''}${kind ? ` rule-card--list rule-card--${meta?.family}${open ? ' is-open' : ''}` : ''}`} title={problem ?? undefined}>
      {!hideHead && (
      <div className="rule-card__head">
        {!kind && onCollapsed && (
          <button type="button" className="rule-card__fold" onClick={() => onCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? 'Open the recipe' : 'Fold the recipe'} title={collapsed ? 'Open' : 'Fold'}>
            <IconSectionChevron className="section-chevron" />
          </button>
        )}
        {kind && (
          <button type="button" className="rule-card__toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close the rule' : 'Open the rule'} title={meta?.tip}>
            <span className="rule-card__chevron"><IconSectionChevron className="section-chevron" /></span>
            {meta && <span className="rule-kind">{meta.label}</span>}
          </button>
        )}
        {onId ? <input className="rule-card__id" value={id} onChange={(e) => onId(e.target.value)} aria-label="Rule id" spellCheck={false} /> : id ? <span className="rule-card__id">{id}</span> : null}
        {title && <span className="rule-card__title">{title}</span>}
        {kind && <span className="rule-card__summary" onClick={() => setOpen(!open)}>{summary}</span>}
        {kind && note && <span className="rule-card__note rule-card__note--inline scn-dim">{note}</span>}
        <span className="rule-card__tools">
          {onEnabled && (
            <button type="button" className={enabled ? undefined : 'is-off'} onClick={() => onEnabled(!enabled)} aria-pressed={enabled} title={enabled ? 'On: click to keep the rule but not apply it' : 'Off: not applied. Click to switch it on'} aria-label={enabled ? 'Switch the rule off' : 'Switch the rule on'}>
              {enabled ? <IconEye /> : <IconEyeOff />}
            </button>
          )}
          {onCopy && <button type="button" onClick={onCopy} title="Duplicate" aria-label="Duplicate rule"><IconCopy /></button>}
          <button type="button" className="cols__icon cols__icon--remove" onClick={onDelete} title="Delete this rule" aria-label="Delete rule"><IconRemove /></button>
        </span>
      </div>
      )}
      {!kind && note && <div className="rule-card__note scn-dim">{note}</div>}
      {problem && <div className="rule-card__problem">{problem}</div>}
      {children && open && !(collapsed && !kind) && <div className="rule-card__body">{children}</div>}
    </div>
  );
}

export const Field = ({ label, children, wide, help }: { label: string; children: ReactNode; wide?: boolean; help?: string }) => (
  <label className={`rule-field${wide ? ' rule-field--wide' : ''}`} title={help}>
    <span className="rule-field__label">{label}</span>
    {children}
  </label>
);

export function NumberInput({ value, onChange, min = 0, step = 1, placeholder, ariaLabel }: { value: number | string | undefined; onChange: (v: number) => void; min?: number; step?: number; placeholder?: string; ariaLabel?: string }) {
  return (
    <input
      className="rule-num"
      type="number"
      min={min}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
    />
  );
}

const WHEN_LABEL: Record<WhenKey, string> = {
  group: 'Group', family: 'Family', type: 'Type', building: 'Building', level: 'Level', levelFrom: 'Level from', levelTo: 'Level to',
  stage: 'Stage', zone: 'Zone', external: 'External', doubleHeight: 'Height', general: 'General type', volumeFrom: 'Volume at least (m³)', volumeBelow: 'Volume under (m³)', typeNot: 'Type is not',
};

/** The conditions of a rule: only the terms set are shown; "+ condition" adds one. */
export function WhenEditor({ ctx, value, onChange, label = 'Applies to', noGroup, empty = 'every pour' }: { ctx: RuleContext; value: When | undefined; onChange: (w: When) => void; label?: string; noGroup?: boolean; empty?: string }) {
  const when = value ?? {};
  const keys = WHEN_KEYS.filter((k) => !(noGroup && k === 'group'));
  const shown = keys.filter((k) => when[k] !== undefined);
  const unused = keys.filter((k) => when[k] === undefined);
  const set = (k: WhenKey, v: string | undefined) => {
    const next = { ...when };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const listFor = (k: WhenKey): string[] | null =>
    k === 'building' ? ctx.buildings : k === 'level' || k === 'levelFrom' || k === 'levelTo' ? ctx.levels : k === 'type' || k === 'typeNot' ? ctx.types : k === 'stage' ? ctx.stages : k === 'family' ? [...FAMILIES] : k === 'group' ? ctx.groupIds : null;
  const listId = (k: WhenKey) => `rule-opts-${k}`;
  return (
    <div className="rule-when">
      <span className="rule-when__label">{label}</span>
<div className="rule-when__items">
      {shown.length === 0 && <span className="scn-dim">{empty}</span>}
      {shown.map((k) => {
        const options = listFor(k);
        return (
          <span key={k} className="rule-term">
            <span className="rule-term__name">{WHEN_LABEL[k]}</span>
            {k === 'external' ? (
              <select value={when[k] ?? ''} onChange={(e) => set(k, e.target.value)} aria-label={WHEN_LABEL[k]}>
                <option value="">any</option>
                <option value="true">external</option>
                <option value="false">internal</option>
              </select>
            ) : k === 'doubleHeight' ? (
              <select value={when[k] ?? ''} onChange={(e) => set(k, e.target.value)} aria-label={WHEN_LABEL[k]}>
                <option value="">any</option>
                <option value="true">double height (over 6 m)</option>
                <option value="false">standard</option>
              </select>
            ) : k === 'zone' ? (
              <select value={when[k] ?? ''} onChange={(e) => set(k, e.target.value)} aria-label={WHEN_LABEL[k]}>
                <option value="">any</option>
                <option value="disconnected">disconnected</option>
                <option value="connected">connected</option>
              </select>
            ) : k === 'volumeFrom' || k === 'volumeBelow' ? (
              <input className="rule-num" type="number" min={0} step="any" value={when[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder="0.25" aria-label={WHEN_LABEL[k]} />
            ) : (
              <input value={when[k] ?? ''} list={options ? listId(k) : undefined} onChange={(e) => set(k, e.target.value)} placeholder={k === 'type' || k === 'typeNot' || k === 'building' || k === 'group' ? 'A|B for several' : ''} aria-label={WHEN_LABEL[k]} spellCheck={false} />
            )}
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => set(k, undefined)} title="Remove this condition" aria-label={`Remove ${WHEN_LABEL[k]}`}><IconRemove /></button>
          </span>
        );
      })}
      <select className="rule-when__add" value="" onChange={(e) => e.target.value && set(e.target.value as WhenKey, '')} aria-label="Add a condition">
        <option value="">+ condition</option>
        {unused.map((k) => (
          <option key={k} value={k}>{WHEN_LABEL[k]}</option>
        ))}
      </select>
      {WHEN_KEYS.map((k) => {
        const options = listFor(k);
        return options ? (
          <datalist key={k} id={listId(k)}>
            {options.map((o) => <option key={o} value={o} />)}
          </datalist>
        ) : null;
      })}
</div>
    </div>
  );
}

/** "12/340": how many of the scenario's objects a rule's conditions fit (the tooltip says it in words). */
export function Fits({ ctx, when }: { ctx: RuleContext; when: When | undefined }) {
  if (!ctx.facts.length) return <span className="scn-dim">{whenText(when)}</span>;
  const n = ctx.fits(when);
  return (
    <span className={n === 0 ? 'rule-fits is-none' : 'rule-fits'} title={`Fits ${n.toLocaleString()} of ${ctx.facts.length.toLocaleString()} objects: ${whenText(when)}`}>
      {n.toLocaleString()}/{ctx.facts.length.toLocaleString()}
    </span>
  );
}

export const Help = ({ children }: { children: ReactNode }) => <p className="scn-dim scn-editor__help">{children}</p>;

export function Section({ title, tip, count, children, actions }: { title: string; tip?: ReactNode; count?: number; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="scn-card">
      <div className="scn-card__title">
        {title}
        {count !== undefined && count > 0 && <span className="scn-chip">{count}</span>}
        {actions && <span className="rule-section__actions">{actions}</span>}
      </div>
      {tip && <Help>{tip}</Help>}
      {children}
    </section>
  );
}

export function NeedsModel({ ctx }: { ctx: RuleContext }) {
  return ctx.facts.length ? null : <div className="scn-dim">Open a scenario with its model loaded to see which objects each rule fits and to pick buildings, levels and types from lists.</div>;
}

/** An id for a new row that no row already has. */
export { freshId } from '../../../prs/rules';
