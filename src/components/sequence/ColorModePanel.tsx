import { useMemo } from 'react';
import { HexColorInput } from '../HexColorInput';
import type { ElementSummary } from '../../viewer/types';
import { samplePropKeys } from '../../viewer/query';
import { objectFieldValue, parseObjectFieldKey, newId } from '../../schedule/linkGroups';
import { COLOR_MODES, RULE_PALETTE, useColorModeStore, type PropertyColorRule, type ViewId } from '../../state/colorModeStore';
import { InfoTip } from '../InfoTip';

const valueOf = (el: ElementSummary, field: string) => {
  const { propertySet, attribute } = parseObjectFieldKey(field);
  return objectFieldValue(el, propertySet, attribute);
};

/** Distinct values of `field` across the elements, most common first. */
function distinctValues(elements: ElementSummary[], field: string): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const el of elements) {
    const v = valueOf(el, field);
    if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Rules that colour the `max` most common values, one palette colour each. */
function generateRules(elements: ElementSummary[], field: string, max = 24): PropertyColorRule[] {
  return distinctValues(elements, field).slice(0, max).map((d, i) => ({ id: newId(), value: d.value, color: RULE_PALETTE[i % RULE_PALETTE.length] }));
}

/** Colour of `el` under the property rules, or null for "original". */
export function propertyColorer(field: string, rules: PropertyColorRule[], fallback: string | null) {
  const byValue = new Map(rules.map((r) => [r.value.trim().toLowerCase(), r.color]));
  return (el: ElementSummary): string | null => byValue.get(valueOf(el, field).trim().toLowerCase()) ?? fallback;
}

/** The colour mode of one 3D view (Appearance Profiles / original colours / by model property), as a compact row
    for 4D › Options. */
export function ColorModeRow({ view, elements, label }: { view: ViewId; elements: ElementSummary[]; label?: string }) {
  const settings = useColorModeStore((s) => s[view]);
  const patchView = useColorModeStore((s) => s.patch);
  const { mode, field, rules } = settings;
  const modeInfo = COLOR_MODES.find((m) => m.id === mode)!;
  return (
    <label className="disp__row">
      <span>{label ?? 'Color mode'} <InfoTip>{modeInfo.hint}</InfoTip></span>
      <select value={mode} onChange={(e) => {
        const next = e.target.value as typeof mode;
        // First switch to "By property" with no rules yet: start from the model's values.
        patchView(view, next === 'property' && rules.length === 0 ? { mode: next, rules: generateRules(elements, field) } : { mode: next });
      }}>
        {COLOR_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </label>
  );
}

/** The by-property rules of one 3D view's colour mode — the Colour section of the View settings tab (the mode itself is in 4D › Options). */
export function ViewColorSettings({ view, elements }: { view: ViewId; elements: ElementSummary[] }) {
  const settings = useColorModeStore((s) => s[view]);
  const patchView = useColorModeStore((s) => s.patch);
  const patch = (p: Partial<typeof settings>) => patchView(view, p);
  const { mode, field, rules, fallback } = settings;
  const fields = useMemo(() => samplePropKeys(elements), [elements]);
  const counts = useMemo(() => (mode === 'property' ? new Map(distinctValues(elements, field).map((d) => [d.value.toLowerCase(), d.count])) : new Map<string, number>()), [elements, field, mode]);
  const modeInfo = COLOR_MODES.find((m) => m.id === mode)!;
  const update = (id: string, p: Partial<PropertyColorRule>) => patch({ rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  return (
    <>
      {mode !== 'property' && <div className="cols__empty">Colour mode: {modeInfo.label} (set under 4D › Options).</div>}
      {mode === 'property' && (
        <>
          <div className="cols__heading"><span>Property</span></div>
          <select className="filter-select" value={field} onChange={(e) => patch({ field: e.target.value, rules: generateRules(elements, e.target.value) })}>
            {fields.map((k) => <option key={k} value={k}>{k === '_category' ? 'IFC class' : k === '_name' ? 'Name' : k}</option>)}
          </select>

          <div className="cols__heading">
            <span>Rules <b>{rules.length}</b></span>
            <span>
              <button type="button" className="cols__link" onClick={() => patch({ rules: generateRules(elements, field) })} title="Replace the rules with one per value found in the model">Generate from model</button>
              {rules.length > 0 && <button type="button" className="cols__link" onClick={() => patch({ rules: [] })}>Clear</button>}
            </span>
          </div>
          <div className="cm__rules">
            {rules.length === 0 && <div className="cols__empty">No rules — every element keeps its {fallback ? 'other-values' : 'original'} colour.</div>}
            {rules.map((r) => (
              <div className="cm__rule" key={r.id}>
                <HexColorInput value={r.color} onChange={(hex) => update(r.id, { color: hex })} />
                <input className="cm__value" value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} placeholder="value" />
                <span className="flt__n" title="Elements with this value">{counts.get(r.value.trim().toLowerCase()) ?? 0}</span>
                <button type="button" className="cols__icon cols__icon--remove" onClick={() => patch({ rules: rules.filter((x) => x.id !== r.id) })} aria-label={`Remove rule ${r.value}`} title="Remove rule">✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--small" style={{ marginTop: 6 }} onClick={() => patch({ rules: [...rules, { id: newId(), value: '', color: RULE_PALETTE[rules.length % RULE_PALETTE.length] }] })}>+ Add rule</button>

          <div className="cols__heading"><span>Other values</span></div>
          <div className="disp__row">
            <span>Use original colour</span>
            <button type="button" role="switch" aria-checked={fallback === null} className={`switch${fallback === null ? ' on' : ''}`} onClick={() => patch({ fallback: fallback === null ? '#bab0ac' : null })}>
              <span className="switch__thumb" />
            </button>
          </div>
          {fallback !== null && (
            <div className="cm__rule">
              <HexColorInput value={fallback} onChange={(hex) => patch({ fallback: hex })} />
              <span className="cm__other">Every value without a rule</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
