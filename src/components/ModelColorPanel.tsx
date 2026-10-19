import { useEffect, useMemo, useRef, useState } from 'react';
import { HexColorInput } from './HexColorInput';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelColorStore, type ColourConfig } from '../state/modelColorStore';
import { useViewSettingsStore, type ViewKey } from '../state/viewSettingsStore';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { SET_FOLDER, isSetFolderField, makeValueOf, setFolderOf } from '../viewer/setFolderValues';
import { useIndexTick, useModelFields } from './modelFields';
import { useColourValues } from './useColourValues';
import { MODEL_PALETTES, paletteColors } from '../viewer/colorPalettes';
import { DEFAULT_SCALE, SCALE_PRESETS, colourAt, gradeColorOf, scaleCss, scaleRange, type ColourScale } from '../viewer/colourScale';
import { FieldPicker } from './schedule/FieldRules';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';
import { InfoTip } from './InfoTip';
import { IconEye, IconEyeOff } from './icons';
import { orderValues, useColourOrderStore, type ColourSort } from '../state/colourOrderStore';

const MAX_VALUES = 150;

/** Models > Colour: colour the models by any property — pick the field,
    a palette (or random colours), and adjust any value's colour. Split
    into two views, each view is coloured on its own. */
export function ModelColorPanel({ page = 'model' }: { page?: 'model' | 'sequence' } = {}) {
  const engine = useViewerEngine();
  const split = useViewSettingsStore((s) => s.pages[page].split);
  const [picked, setPicked] = useState<ViewKey>('main');
  const view: ViewKey = split ? picked : 'main';
  const { enabled, field, palette, seed, colors, others, mode, scale: storedScale } = useModelColorStore((s) => s.views[view]);
  const grade = mode === 'grade';
  const scale = storedScale ?? DEFAULT_SCALE;
  const patchView = useModelColorStore((s) => s.patch);
  const patch = (p: Partial<ColourConfig>) => patchView(view, p);
  const fields = useModelFields();
  const sets = useSearchSetsStore((s) => s.sets);
  const setFolder = isSetFolderField(field);
  // A property's values, or a set folder's (the names of its sets), most objects first.
  const values = useColourValues(field);
  const folders = useMemo(() => [...new Set(sets.map((x) => x.group ?? ''))].sort((a, b) => a.localeCompare(b)), [sets]);
  const sections = useOpenSections<'options' | 'values' | 'field'>('models.colourSections', ['options', 'values', 'field']);
  const fieldLabel = fields.find((f) => f.id === field);
  const pickField = (id: string) => {
    patch({ field: id });
    setPendingField(id);
  };

  /** One colour per value (most common first) from the palette. */
  const recolour = (f: string, pal: string, sd: number, list = values) => {
    const shown = list.slice(0, MAX_VALUES);
    const cs = paletteColors(pal, shown.length, sd);
    patch({ field: f, palette: pal, seed: sd, colors: shown.map((v, i) => ({ value: v.value, color: cs[i] })), enabled: true });
  };
  // Colours for a newly picked field are made once its values are known.
  const [pendingField, setPendingField] = useState<string | null>(null);
  useEffect(() => {
    if (pendingField && pendingField === field) {
      recolour(field, palette, seed);
      setPendingField(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingField, field, values]);

  const colorOf = new Map(colors.map((c) => [c.value, c.color]));
  const setColor = (value: string, color: string) => {
    const next = colors.some((c) => c.value === value) ? colors.map((c) => (c.value === value ? { ...c, color } : c)) : [...colors, { value, color }];
    patch({ colors: next });
  };
  // The order the values are listed in (the viewer's legend follows it).
  const sort = useColourOrderStore((s) => s.sort);
  const setSort = useColourOrderStore((s) => s.setSort);
  const manual = useColourOrderStore((s) => s.manual);
  const setManual = useColourOrderStore((s) => s.setManual);
  const [dragged, setDragged] = useState<string | null>(null);
  const shownValues = useMemo(() => orderValues(values.slice(0, MAX_VALUES), sort, manual[field]), [values, sort, manual, field]);
  const dropOn = (target: string) => {
    if (!dragged || dragged === target) return;
    const names = shownValues.map((v) => v.value);
    const order = names.filter((v) => v !== dragged);
    order.splice(order.indexOf(target) + (names.indexOf(dragged) < names.indexOf(target) ? 1 : 0), 0, dragged);
    setManual(field, order);
    setDragged(null);
  };

  // Eyes, as in Search sets: a value's eye hides / shows its objects in 3D (the viewer's Hide, so Show all brings them back).
  const hiddenModels = useModelsStore((s) => s.hiddenModelIds);
  const tick = useIndexTick();
  const [, setVisTick] = useState(0);
  useEffect(() => {
    const bump = () => setVisTick((t) => t + 1);
    engine.onVisibilityChange.add(bump);
    engine.onExternalVisibilityChange.add(bump);
    return () => {
      engine.onVisibilityChange.remove(bump);
      engine.onExternalVisibilityChange.remove(bump);
    };
  }, [engine]);
  /** Each value's objects (of the models that are on). */
  const idsByValue = useMemo(() => {
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const out = new Map<string, Record<string, number[]>>();
    for (const [modelId, index] of engine.getIndexes()) {
      if (hiddenModels.has(modelId)) continue;
      for (const [id, e] of index.elements) {
        const v = valueOf(e);
        const byModel = out.get(v) ?? out.set(v, {}).get(v)!;
        (byModel[modelId] ??= []).push(id);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, field, sets, hiddenModels, tick, values]);
  const idsOf = (list: string[]) => {
    const out: Record<string, number[]> = {};
    for (const v of list) for (const [m, ids] of Object.entries(idsByValue.get(v) ?? {})) (out[m] ??= []).push(...ids);
    return out;
  };
  const hiddenOf = (list: string[]) => {
    let hidden = 0;
    let total = 0;
    for (const [m, ids] of Object.entries(idsOf(list))) for (const id of ids) { total++; if (engine.isUserHidden(m, id)) hidden++; }
    return { hidden, total };
  };
  /** Off if any of these values shows, otherwise all come back. */
  const flipValues = async (list: string[]) => {
    const { hidden, total } = hiddenOf(list);
    if (total === 0) return;
    const map = Object.fromEntries(Object.entries(idsOf(list)).map(([m, l]) => [m, new Set(l)]));
    await engine.hider.set(hidden > 0, map);
    engine.onExternalVisibilityChange.trigger();
  };

  // Click a value to select its objects, Shift+click to reach down to another, Ctrl+click to add or remove one;
  // arrows step through, Space turns the selected on / off.
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked2, setPicked2] = useState<Set<string>>(new Set());
  const pickValues = (next: Set<string>) => {
    setPicked2(next);
    void engine.selectElements(idsOf([...next]), false);
  };
  const pickValue = (value: string, mod: { shift?: boolean; ctrl?: boolean } = {}) => {
    setActiveValue(value);
    const names = shownValues.map((v) => v.value);
    const from = names.indexOf(anchor ?? '');
    const to = names.indexOf(value);
    if (mod.shift && from >= 0 && to >= 0) {
      const range = names.slice(Math.min(from, to), Math.max(from, to) + 1);
      pickValues(new Set(mod.ctrl ? [...picked2, ...range] : range));
      return;
    }
    setAnchor(value);
    if (mod.ctrl) {
      const next = new Set(picked2);
      if (!next.delete(value)) next.add(value);
      pickValues(next);
    } else pickValues(new Set([value]));
  };
  const onValuesKey = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    if (e.key === ' ') {
      void flipValues(picked2.size ? [...picked2] : activeValue ? [activeValue] : []);
      return;
    }
    const names = shownValues.map((v) => v.value);
    if (!names.length) return;
    const i = names.indexOf(activeValue ?? '');
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : names.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= names.length) return;
    pickValue(names[next], { shift: e.shiftKey });
  };

  return (
    <div>
      {split && (
        <div className="disp model-colour__top" style={{ paddingBottom: 0 }}>
          <div className="cols__views" role="tablist" style={{ margin: '4px 0 6px' }}>
            <button type="button" role="tab" aria-selected={view === 'main'} className={view === 'main' ? 'active' : ''} onClick={() => setPicked('main')}>Left view</button>
            <button type="button" role="tab" aria-selected={view === 'second'} className={view === 'second' ? 'active' : ''} onClick={() => setPicked('second')}>Right view</button>
          </div>
        </div>
      )}
      <CollapsibleSection title="Options" open={sections.isOpen('options')} onToggle={() => sections.toggle('options')} flush>
      <div className="disp model-colour__top">
        {/* 4D Sequencing switches these colours on with its Color mode (By property) instead. */}
        {page === 'model' && (
          <div className="disp__row">
            <span>Colour the models</span>
            <button type="button" role="switch" aria-checked={enabled} className={`switch${enabled ? ' on' : ''}`} onClick={() => (enabled ? patch({ enabled: false }) : colors.length ? patch({ enabled: true }) : recolour(field, palette, seed))}>
              <span className="switch__thumb" />
            </button>
          </div>
        )}
        <div className="disp__row">
          <span>Colour by</span>
          <b className="model-colour__field" title={field}>
            {setFolder ? `Set folder › ${setFolderOf(field) || '(no folder)'}` : fieldLabel ? `${fieldLabel.group} › ${fieldLabel.label}` : field}
          </b>
        </div>
        <label className="disp__row">
          <span>
            Set folder{' '}
            <InfoTip>Colour each object by the search or selection set that holds it, from one folder of Search sets. An object in several sets takes the first one in the list.</InfoTip>
          </span>
          <select
            value={setFolder ? field : ''}
            onChange={(e) => pickField(e.target.value || 'Attributes.Class')}
            disabled={folders.length === 0}
            title={folders.length === 0 ? 'No search or selection sets saved yet' : undefined}
          >
            <option value="">— a property —</option>
            {folders.map((g) => (
              <option key={g} value={`${SET_FOLDER}${g}`}>{g || '(no folder)'}</option>
            ))}
          </select>
        </label>
        <label className="disp__row">
          <span>
            Colour as{' '}
            <InfoTip>One colour per value, or grade a number along a colour scale (like Excel's colour scales): the lowest number gets the first colour, the highest the last.</InfoTip>
          </span>
          <select value={grade ? 'grade' : 'values'} onChange={(e) => patch({ mode: e.target.value as 'values' | 'grade', ...(e.target.value === 'grade' && storedScale === undefined ? { scale: DEFAULT_SCALE } : {}), enabled: true })}>
            <option value="values">Value colours</option>
            <option value="grade">Grading (a number on a scale)</option>
          </select>
        </label>
        {grade && <ScaleEditor scale={scale} onChange={(s) => patch({ scale: s })} range={scaleRange(scale, gradeValues.map((v) => v.value))} />}
        {!grade && <label className="disp__row">
          <span>Palette</span>
          <select value={palette} onChange={(e) => recolour(field, e.target.value, seed)}>
            {MODEL_PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="random">Random</option>
          </select>
        </label>}
        {!grade && <div className="model-colour__palette">
          {paletteColors(palette, 12, seed).map((c, i) => <span key={i} style={{ background: c }} />)}
          <button type="button" className="btn btn--small" onClick={() => recolour(field, 'random', Math.random())} title="New random colours">Shuffle</button>
          <button type="button" className="btn btn--small" onClick={() => recolour(field, palette, seed)} title="Recolour every value from the palette (undoes hand-picked colours)">Reset colours</button>
        </div>}
        <div className="disp__row">
          <span>
            {grade ? 'Not a number' : 'Other values'}{' '}
            <InfoTip>{grade ? 'Objects whose value is not a number: one colour for all, or keep their own colours.' : `Values without a colour of their own (beyond the ${MAX_VALUES} most common): one colour for all, or keep their own colours.`}</InfoTip>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="cols__check" style={{ margin: 0 }}>
              <input type="checkbox" checked={others === null} onChange={(e) => patch({ others: e.target.checked ? null : '#d4d4d8' })} />
              <span>Own colours</span>
            </label>
            {others !== null && <HexColorInput value={others} onChange={(hex) => patch({ others: hex })} />}
          </span>
        </div>
      </div>
      </CollapsibleSection>

      {!grade && <CollapsibleSection
        title={`Values (${values.length})`}
        open={sections.isOpen('values')}
        onToggle={() => sections.toggle('values')}
        flush
        tip="Each value's colour: click the swatch to change it. Click a value to select its objects (Isolate / Ghost follow); Shift / Ctrl+click for several. The eye (or Space, on the selected values) hides them in 3D."
      >
        {values.length === 0 ? (
          <div className="disp"><div className="flt__hint">Load a model to colour it.</div></div>
        ) : (
          <>
          <div className="disp model-colour__top">
          <div className="disp__row">
            <span>Order</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ColourSort)} title="Drag a row to put it where you want it (switches to Manual)">
              <option value="count">Most objects</option>
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
              <option value="manual">Manual (drag rows)</option>
            </select>
          </div>
          </div>
          {/* (A button would also "click" on Space's release: kept from doing so.) */}
          <div tabIndex={0} style={{ outline: 'none' }} onKeyDown={onValuesKey} onKeyUp={(e) => { if (e.key === ' ' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault(); }} aria-label="Values: arrow keys move, Shift or Ctrl select several, Space hides or shows the selected">
          <table className="seq-grid">
            <thead>
              <tr>
                <th className="seq-grid__swatch" />
                <th>Value</th>
                <th className="seq-grid__num">Objects</th>
                <th className="seq-grid__swatch" />
              </tr>
            </thead>
            <tbody>
              {shownValues.map((v) => {
                const { hidden, total } = hiddenOf([v.value]);
                const shut = total > 0 && hidden === total;
                const part = hidden > 0 && !shut;
                return (
                  <tr
                    key={v.value}
                    draggable
                    className={`${picked2.has(v.value) ? 'is-active' : ''}${activeValue === v.value ? ' is-current' : ''}`}
                    onDragStart={() => setDragged(v.value)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(v.value)}
                    onDragEnd={() => setDragged(null)}
                    style={dragged === v.value ? { opacity: 0.4 } : shut ? { opacity: 0.5 } : undefined}
                  >
                    <td className="seq-grid__swatch">
                      <input type="color" className="model-colour__swatch" value={colorOf.get(v.value) ?? others ?? '#ffffff'} onChange={(e) => setColor(v.value, e.target.value)} title="Change colour" />
                    </td>
                    <td className="seq-grid__name" title={`${v.value}: select these objects`} onClick={(e) => pickValue(v.value, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}>{v.value}</td>
                    <td className="seq-grid__num">{v.count}</td>
                    <td className="seq-grid__swatch">
                      <button
                        type="button"
                        className={`ss__eye${shut ? ' is-off' : ''}${part ? ' is-part' : ''}`}
                        disabled={total === 0}
                        onClick={() => void flipValues([v.value])}
                        title={shut ? 'Show these objects' : part ? 'Some are hidden: click to show them all' : 'Hide these objects'}
                        aria-label={shut ? `Show ${v.value}` : `Hide ${v.value}`}
                      >
                        {shut ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </>
        )}
      </CollapsibleSection>}

      <CollapsibleSection title="Colour by…" open={sections.isOpen('field')} onToggle={() => sections.toggle('field')}>
        <div className="cols">
          <FieldPicker
            catalog={fields}
            picked={new Set([field])}
            placeholder="Search properties…"
            onPick={(f) => {
              patch({ field: f.id });
              setPendingField(f.id);
            }}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** The colour scale of grading: a preset, the colour stops (add, move, recolour, remove) and the ends (Lowest / Highest number). */
function ScaleEditor({ scale, onChange, range }: { scale: ColourScale; onChange: (s: ColourScale) => void; range: { min: number; max: number } | null }) {
  const setStop = (i: number, p: Partial<{ at: number; color: string }>) => onChange({ ...scale, stops: scale.stops.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const end = (key: 'min' | 'max', label: string, auto: number | undefined) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <label className="cols__check" style={{ margin: 0 }} title={`Take the ${label.toLowerCase()} number found`}>
        <input type="checkbox" checked={scale[key] === null} onChange={(e) => onChange({ ...scale, [key]: e.target.checked ? null : auto ?? 0 })} />
        <span>Auto</span>
      </label>
      <input
        type="number"
        style={{ width: 80 }}
        disabled={scale[key] === null}
        value={scale[key] ?? auto ?? ''}
        onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && onChange({ ...scale, [key]: Number(e.target.value) })}
        aria-label={label}
      />
    </span>
  );
  return (
    <>
      <label className="disp__row">
        <span>Scale</span>
        <select value="" onChange={(e) => { const p = SCALE_PRESETS.find((x) => x.id === e.target.value); if (p) onChange({ ...scale, stops: p.stops }); }}>
          <option value="">— presets —</option>
          {SCALE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <div style={{ height: 14, borderRadius: 4, border: '1px solid var(--border)', background: scaleCss(scale.stops), margin: '2px 0 6px' }} aria-hidden />
      {scale.stops.map((s, i) => (
        <div className="disp__row" key={i}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" className="model-colour__swatch" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} title="Colour of this stop" />
            <input
              type="number"
              min={0}
              max={100}
              style={{ width: 56 }}
              value={Math.round(s.at * 100)}
              onChange={(e) => e.target.value !== '' && setStop(i, { at: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })}
              title="Where on the scale, in % from the lowest number to the highest"
              aria-label="Stop position in percent"
            />
            <span>%</span>
          </span>
          <button type="button" className="btn btn--small" disabled={scale.stops.length <= 2} onClick={() => onChange({ ...scale, stops: scale.stops.filter((_, k) => k !== i) })} title="Remove this colour">×</button>
        </div>
      ))}
      <div className="disp__row">
        <span />
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            const s = [...scale.stops].sort((a, b) => a.at - b.at);
            const last = s[s.length - 1];
            const prev = s[s.length - 2];
            onChange({ ...scale, stops: [...scale.stops, { at: prev ? (prev.at + last.at) / 2 : 0.5, color: colourAt(scale.stops, prev ? (prev.at + last.at) / 2 : 0.5) }] });
          }}
        >
          Add colour
        </button>
      </div>
      <div className="disp__row"><span>Lowest</span>{end('min', 'Lowest', range?.min)}</div>
      <div className="disp__row"><span>Highest</span>{end('max', 'Highest', range?.max)}</div>
    </>
  );
}

/** Applies Models > Colour to the models while the Models page shows, and
    takes the colours off again when it hides or colouring is turned off —
    the main view's colouring on it, the right view's on the split's second view. */
export function ModelColorSync() {
  return (
    <>
      <ViewColourSync view="main" />
      <ViewColourSync view="second" />
    </>
  );
}

function ViewColourSync({ view }: { view: ViewKey }) {
  const engine = useViewerEngine();
  const { enabled, field, colors, others, mode, scale } = useModelColorStore((s) => s.views[view]);
  const sets = useSearchSetsStore((s) => s.sets);
  const models = useModelsStore((s) => s.models);
  const gradeValues = useColourValues(mode === 'grade' ? field : '');
  const tick = useIndexTick();
  const secondaryTick = useSecondaryTick();
  // Applying and removing are async: queue them so a removal never lands on
  // top of the colours applied after it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (job: () => Promise<void>) => { queue.current = queue.current.then(job, job); };
  useEffect(() => {
    const target = view === 'main' ? engine : engine.secondary;
    if (!enabled || !target) return;
    const byValue = new Map(colors.map((c) => [c.value, c.color]));
    const grade = mode === 'grade' ? gradeColorOf(scale ?? DEFAULT_SCALE, gradeValues.map((v) => v.value)) : null;
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const applied: [string, number[]][] = [];
    enqueue(async () => {
      for (const [modelId, index] of engine.getIndexes()) {
        const byColor = new Map<string, number[]>();
        for (const [id, e] of index.elements) {
          const c = (grade ? grade(valueOf(e)) : byValue.get(valueOf(e))) ?? others;
          if (c) (byColor.get(c) ?? byColor.set(c, []).get(c)!).push(id);
        }
        const all: number[] = [];
        for (const [color, ids] of byColor) {
          await target.setColor(modelId, ids, color, true);
          all.push(...ids);
        }
        applied.push([modelId, all]);
      }
      await target.forceUpdate();
    });
    return () => {
      enqueue(async () => {
        for (const [modelId, ids] of applied) await target.setColor(modelId, ids, null, true);
        await target.forceUpdate();
      });
    };
  }, [engine, view, enabled, field, colors, others, mode, scale, gradeValues, models, sets, tick, secondaryTick]);
  return null;
}

/** Bumps when the split's second view appears (it needs the colours too). */
function useSecondaryTick() {
  const engine = useViewerEngine();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    engine.onSecondaryChange.add(bump);
    return () => { engine.onSecondaryChange.remove(bump); };
  }, [engine]);
  return tick;
}
