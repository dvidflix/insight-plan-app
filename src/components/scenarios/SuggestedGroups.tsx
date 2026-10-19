import { useState } from 'react';
import { applyRows, useScenarioStore } from '../../state/scenarioStore';
import { startTogether } from '../../scenarios/pourOrder';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { DEFAULT_TARGETS, levelKey, rebarByPour, suggestGroups, wallsToGroup, type GroupSuggestion, type RebarTargets } from '../../scenarios/groupSuggest';
import type { ScheduleModel } from '../../schedule/types';
import { usePersistedState } from '../../utils/persistedState';
import { IconCheckboxChecked, IconCheckboxUnchecked, IconSectionChevron, IconExpander } from '../icons';
import { InfoTip } from '../InfoTip';

interface Item {
  s: GroupSuggestion;
  /** Ticked: Approve selected applies it. */
  on: boolean;
  open: boolean;
}

const LEVEL_ORDER = ['L1', 'L1 & 2', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];
const t2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Scenario panel > Manual links > Suggested groups: walls that could start together, sized so their rebar adds up to the
    target tonnes per day of their level. Tick the ones to apply: each becomes one step of the order table, as selecting them
    and pressing SS does (Ctrl+Z takes it back). */
export function SuggestedGroups({ source }: { source: ScheduleModel | null }) {
  const { rows, loaded, ready } = useScenarioView();
  const [targets, setTargets] = usePersistedState<RebarTargets>('scenarios.rebarTargets', DEFAULT_TARGETS);
  const [showTargets, setShowTargets] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [note, setNote] = useState('');

  const suggest = () => {
    if (!loaded || !source) return;
    const { walls, skipped } = wallsToGroup(rows, loaded.headers, rebarByPour(source));
    const groups = suggestGroups(walls, targets);
    setItems(groups.map((s) => ({ s, on: true, open: false })));
    setNote(
      `${walls.length} wall${walls.length === 1 ? '' : 's'} looked at${skipped ? `, ${skipped} left out (no rebar rate in the programme)` : ''}: ${groups.length} group${groups.length === 1 ? '' : 's'} suggested.`,
    );
  };

  const ticked = items?.filter((i) => i.on) ?? [];
  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur && cur.map((i) => (i.s.id === id ? { ...i, ...p } : i)));
  const setAll = (on: boolean) => setItems((cur) => cur && cur.map((i) => ({ ...i, on })));

  /** Makes each of these groups one step; the order changes in one go (one Ctrl+Z). */
  const approve = (which: Item[]) => {
    if (which.length === 0) return;
    let next = useScenarioStore.getState().rows;
    for (const i of which) next = startTogether(next, new Set(i.s.members.map((m) => m.key)));
    applyRows(next);
    const done = new Set(which.map((i) => i.s.id));
    setItems((cur) => cur && cur.filter((i) => !done.has(i.s.id)));
    setNote(`${which.length} group${which.length === 1 ? '' : 's'} applied (${which.reduce((n, i) => n + i.s.members.length, 0)} walls).`);
  };

  const setLevelTarget = (level: string, value: number) => setTargets((t) => ({ ...t, byLevel: { ...t.byLevel, [level]: value } }));
  const levelsOf = (s: GroupSuggestion) => [...new Set(s.members.map((m) => levelKey(m.level) || m.level))].join(', ');

  return (
    <section className="scn-card">
      <div className="scn-card__title">
        Suggested groups
        <InfoTip>
          <p>Walls that could start together (one step of the order table, like selecting them and pressing SS), found by adding walls in the order they are in until their rebar adds up to the target tonnes per day of their level (the walls' rate where a level has none). A wall's own rate is its Rebar activity's tonnes divided by its days in the generated programme.</p>
          <p>Only sequenced walls that are still on their own are looked at. Tick the groups to apply, then Approve selected, or Approve all.</p>
        </InfoTip>
      </div>
      <div className="scn-row">
        <button type="button" className="btn" disabled={!ready || !source} onClick={suggest} title={source ? 'Look for groups of walls' : 'Update 4D first: the rebar rates come from the generated programme'}>
          Suggest groups
        </button>
        <button type="button" className="cols__link" aria-expanded={showTargets} onClick={() => setShowTargets((v) => !v)}>Target rates <IconExpander open={showTargets} width={14} height={14} /></button>
      </div>
      {!source && <div className="scn-dim">Update 4D once: the wall rates (rebar tonnes ÷ days) come from the generated programme.</div>}

      {showTargets && (
        <div className="sg__targets">
          <label title="Used for a wall whose level has no rate below">
            <span>Walls</span>
            <input type="number" min={0} step={0.01} value={targets.wall} onChange={(e) => setTargets((t) => ({ ...t, wall: Number(e.target.value) || 0 }))} />
          </label>
          {LEVEL_ORDER.map((level) => (
            <label key={level}>
              <span>{level}</span>
              <input type="number" min={0} step={0.01} value={targets.byLevel[level] ?? ''} placeholder="walls" onChange={(e) => setLevelTarget(level, Number(e.target.value) || 0)} />
            </label>
          ))}
          <button type="button" className="cols__link" onClick={() => setTargets(DEFAULT_TARGETS)}>Reset to the dashboard's actual rates</button>
          <div className="scn-dim">Rebar tonnes per day (actual, from the dashboard). A blank or 0 level uses the walls' rate.</div>
        </div>
      )}

      {note && <div className="scn-dim">{note}</div>}

      {items && items.length > 0 && (
        <>
          <div className="sg__bar">
            <b>{ticked.length}</b> of {items.length} ticked
            <span className="sg__spacer" />
            <button type="button" className="cols__link" onClick={() => setAll(true)}>All</button>
            <button type="button" className="cols__link" onClick={() => setAll(false)}>None</button>
          </div>
          <div className="sg__list">
            {items.map((i, n) => (
              <div key={i.s.id} className={`sg__item${i.on ? ' is-on' : ''}`}>
                <div className="sg__row">
                  <button type="button" className="sg__tick" role="checkbox" aria-checked={i.on} onClick={() => patch(i.s.id, { on: !i.on })} title={i.on ? 'Ticked: will be applied. Click to leave it out' : 'Left out. Click to include it'}>
                    {i.on ? <IconCheckboxChecked width={18} height={18} /> : <IconCheckboxUnchecked width={18} height={18} />}
                  </button>
                  <button type="button" className="sg__main" aria-expanded={i.open} onClick={() => patch(i.s.id, { open: !i.open })}>
                    <IconSectionChevron className="section-chevron" />
                    <span className="sg__name">Group {n + 1} · {i.s.members.length} walls · {levelsOf(i.s)}</span>
                    <span className="sg__rate" title="Rebar t/day added up, and the target">{t2(i.s.rate)} / {t2(i.s.target)} t/day</span>
                  </button>
                </div>
                {i.open && (
                  <div className="sg__members">
                    {i.s.members.map((m) => (
                      <div key={m.key} className="sg__member">
                        <span>{m.label}</span>
                        <span className="scn-dim">{levelKey(m.level) || m.level}</span>
                        <span className="scn-dim">{t2(m.tonnes)} t · {t2(m.days)} d</span>
                        <span className="sg__rate">{t2(m.rate)} t/day</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="scn-row">
            <button type="button" className="btn primary" disabled={ticked.length === 0} onClick={() => approve(ticked)}>Approve selected ({ticked.length})</button>
            <button type="button" className="btn" onClick={() => approve(items)}>Approve all</button>
            <button type="button" className="cols__link" onClick={() => { setItems(null); setNote(''); }}>Clear</button>
          </div>
        </>
      )}
    </section>
  );
}
