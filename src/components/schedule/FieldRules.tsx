import { SearchRow } from '../SearchRow';
import { useMemo, useState, type ReactNode } from 'react';
import { COLUMN_GROUPS } from '../../schedule/columns';

/** A field that can be grouped / sorted / coloured on; `group` is its
    section in the picker (the schedule catalog's column groups). */
export interface PickField {
  id: string;
  label: string;
  group?: string;
}
import { IconSectionChevron, IconRemove } from '../icons';
import { queryMatcher } from '../../schedule/search';

/** Every field of the schedule, searchable and grouped the way the Columns
    tab groups them (Group / Sort / Color). Clicking a field picks it;
    fields already in use show a tick. */
export function FieldPicker<F extends PickField>({ catalog, picked, onPick, placeholder = 'Search fields…' }: {
  catalog: F[];
  picked: ReadonlySet<string>;
  onPick: (field: F) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set(['Relationships', 'Resources & Cost', 'Resource Units', 'Constraints']));
  const q = search.trim().toLowerCase();
  const hit = queryMatcher(search);
  const groups = useMemo(() => {
    const map = new Map<string, F[]>();
    for (const c of catalog) {
      const g = c.group ?? 'Fields';
      (map.get(g) ?? map.set(g, []).get(g)!).push(c);
    }
    const order: string[] = [...COLUMN_GROUPS, ...[...map.keys()].filter((g) => !(COLUMN_GROUPS as readonly string[]).includes(g))];
    return order.filter((g) => map.has(g)).map((g) => ({ name: g, fields: map.get(g)! }));
  }, [catalog]);
  const toggle = (name: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (!next.delete(name)) next.add(name);
    return next;
  });

  return (
    <>
      <SearchRow
        collapsed={groups.length > 0 && groups.every((g) => closed.has(g.name))}
        onCollapse={() => setClosed(new Set(groups.map((g) => g.name)))}
        onExpand={() => setClosed(new Set())}
      >
        <input className="cols__search" type="search" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      </SearchRow>
      {groups.map((g) => {
        const matches = q ? g.fields.filter((f) => hit(f.label)) : g.fields;
        if (matches.length === 0) return null;
        const open = q ? true : !closed.has(g.name);
        const used = g.fields.filter((f) => picked.has(f.id)).length;
        return (
          <div className={`cols__group${used > 0 ? ' is-active' : ''}`} key={g.name}>
            <div className="cols__group-head">
              <button type="button" className="cols__group-toggle" onClick={() => toggle(g.name)} aria-expanded={open}>
                <IconSectionChevron className="section-chevron" />
                <span className="cols__group-name">{g.name}</span>
                <span className="cols__count">{used ? `${used} used · ` : ''}{g.fields.length}</span>
              </button>
            </div>
            {open && (
              <div className="cols__group-body">
                {matches.map((f) => (
                  <button key={f.id} type="button" className={`field-pick${picked.has(f.id) ? ' is-picked' : ''}`} onClick={() => onPick(f)} title={picked.has(f.id) ? `${f.label} (in use)` : `Add ${f.label}`}>
                    <span className="field-pick__mark">{picked.has(f.id) ? '✓' : '+'}</span>
                    <span className="field-pick__label">{f.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The rules in effect, in order: drag the grip (or ↑ ↓) to reorder, ✕ to
    remove. `children` renders each rule's own controls. */
export function RuleRows<T extends { id: string }>({ rules, onChange, children, empty }: {
  rules: T[];
  onChange: (rules: T[]) => void;
  children: (rule: T, index: number) => ReactNode;
  empty: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const next = [...rules];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };
  if (rules.length === 0) return <div className="cols__shown"><div className="cols__empty">{empty}</div></div>;
  return (
    <div className="cols__shown">
      {rules.map((r, i) => (
        <div
          key={r.id}
          className={`cols__row rule-item${dragId === r.id ? ' dragging' : ''}`}
          draggable
          onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = rules.findIndex((x) => x.id === dragId);
            if (from >= 0) move(from, i);
            setDragId(null);
          }}
          onDragEnd={() => setDragId(null)}
        >
          <span className="cols__grip" aria-hidden="true">⋮⋮</span>
          <div className="rule-item__body">{children(r, i)}</div>
          <button type="button" className="cols__icon" disabled={i === 0} onClick={() => move(i, i - 1)} title="Move up" aria-label="Move up">↑</button>
          <button type="button" className="cols__icon" disabled={i === rules.length - 1} onClick={() => move(i, i + 1)} title="Move down" aria-label="Move down">↓</button>
          <button type="button" className="cols__icon cols__icon--remove" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} title="Remove" aria-label="Remove"><IconRemove /></button>
        </div>
      ))}
    </div>
  );
}

/** A↓Z / Z↓A toggle for a rule's direction. */
export function DirectionToggle({ value, onChange }: { value: 'up' | 'down'; onChange: (v: 'up' | 'down') => void }) {
  return (
    <button type="button" className="dir-toggle" onClick={() => onChange(value === 'up' ? 'down' : 'up')} title={value === 'up' ? 'Ascending (A→Z, oldest first, smallest first): click for descending' : 'Descending (Z→A, newest first, largest first): click for ascending'}>
      {value === 'up' ? 'A→Z' : 'Z→A'}
    </button>
  );
}

export const newRuleId = (prefix: string) => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
