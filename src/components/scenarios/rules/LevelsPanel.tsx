import { useState } from 'react';
import { useModelFields, useFieldValues } from '../../modelFields';
import { NO_VALUE } from '../../../viewer/bimTables';
import { LEVEL_PROPERTY_DEFAULT, POUR_PROPERTY_SET, levelDefinition, orderLevels, withLevelDefinition } from '../../../prs/levelDefinition';
import { ZONE_PROPERTY_DEFAULT, withZoneDefinition, withZoneKind, zoneDefinition, zoneKindOf, type ZoneKind } from '../../../prs/zoneDefinition';
import { useRuleContext } from './RuleParts';

/** Levels and zones (under the Work breakdown): what a level is, and what a zone is. What a level is: Which property of the pour data holds it (the property "Level" until another is chosen), and the levels in the
    order they are built: drag a row to move it. The steps that are "per level" repeat in this order, within each building. Left alone, the generator reads
    each level's place from the first whole number in its text, as it always did. Saved with the scenario (its settings levelProperty and levelOrder). */

/** The zones of a building: which property of the pour data holds the zone, and which zone values are connected to the rest of the building and which are
    disconnected (built on their own). Saved with the scenario (its settings zoneProperty, zoneConnected and zoneDisconnected). */
function ZonesPanel() {
  const ctx = useRuleContext();
  const def = zoneDefinition(ctx.rules.settings);
  const fields = useModelFields();
  const property = def.property || ZONE_PROPERTY_DEFAULT;
  const values = useFieldValues(`${POUR_PROPERTY_SET}.${property}`, true).filter((v) => v.value !== NO_VALUE && v.value.trim() !== '');
  const present = values.map((v) => v.value);
  const names = [...new Set(fields.filter((f) => f.group === POUR_PROPERTY_SET).map((f) => f.label))];
  const save = (next: typeof def) => ctx.change((r) => ({ ...r, settings: withZoneDefinition(r.settings, next) }));
  return (
    <div>
      <h3 className="gen-sec">Zones</h3>
      <div className="scn-dim seq__explain">
        <p><strong>What is a zone?</strong> A part of a building that is built apart from its levels, for example a part connected to the main structure and a part that is not.</p>
        <p>Choose the property that holds the zone, then say which of its values are connected and which are disconnected. A value that is neither is not treated as a zone.</p>
      </div>
      <div className="rel-bar">
        <label className="scn-dim">Property that holds the zone
          <input className="rel-cell" list="zone-properties" style={{ width: 220, marginLeft: 6 }} value={def.property} placeholder={ZONE_PROPERTY_DEFAULT} spellCheck={false} onChange={(e) => save({ property: e.target.value, connected: [], disconnected: [] })} title={`A property of the pour data (property set “${POUR_PROPERTY_SET}”). Changing it clears the zones named below.`} />
        </label>
        <datalist id="zone-properties">{names.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      {values.length === 0 ? <div className="scn-dim scn-editor__help">No object in the loaded models has the property “{property}” in the pour data. Check its name, or load the model.</div> : (
        <table className="xl">
          <colgroup><col style={{ width: 48 }} /><col style={{ width: 280 }} /><col style={{ width: 110 }} /><col style={{ width: 200 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>Zone</th><th title="How many objects have this value">Objects</th><th title="Connected to the rest of the building, or built on its own">Kind</th></tr></thead>
          <tbody>
            {values.map((v, i) => (
              <tr key={v.value}>
                <th className="xl__row" scope="row">{i + 1}</th>
                <td className="xl__cell xl__ro">{v.value}</td>
                <td className="xl__cell xl__num xl__ro">{v.count.toLocaleString()}</td>
                <td className="xl__cell"><select value={zoneKindOf(v.value, def)} aria-label={`Kind of ${v.value}`} onChange={(e) => save(withZoneKind(def, v.value, e.target.value as ZoneKind, present))}><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="none">Not a zone</option></select></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ZonesPanel />
    </div>
  );
}

export function LevelsPanel() {
  const ctx = useRuleContext();
  const def = levelDefinition(ctx.rules.settings);
  const fields = useModelFields();
  const values = useFieldValues(`${POUR_PROPERTY_SET}.${def.property}`, true).filter((v) => v.value !== NO_VALUE && v.value.trim() !== '');
  const levels = orderLevels(values.map((v) => v.value), def.order);
  const counts = new Map(values.map((v) => [v.value, v.count]));
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const names = [...new Set(fields.filter((f) => f.group === POUR_PROPERTY_SET).map((f) => f.label))];

  const save = (next: { property?: string; order?: string[] }) => ctx.change((r) => ({ ...r, settings: withLevelDefinition(r.settings, { property: next.property ?? def.property, order: next.order ?? def.order }) }));
  const drop = (to: number) => {
    if (!drag || drag.from === to || drag.from + 1 === to) return setDrag(null);
    const next = [...levels];
    const [moved] = next.splice(drag.from, 1);
    next.splice(to > drag.from ? to - 1 : to, 0, moved);
    save({ order: next });
    setDrag(null);
  };

  return (
    <div>
      <div className="scn-dim seq__explain">
        <p><strong>What is a level?</strong> A value of a property of your objects, such as a floor, a deck or a phase. Choose the property, then put its values in the order they are built. A step set to “per level” is repeated for each level in this order, within each building.</p>
      </div>
      <div className="rel-bar">
        <label className="scn-dim">Property that holds the level
          <input className="rel-cell" list="level-properties" style={{ width: 220, marginLeft: 6 }} value={def.property} placeholder={LEVEL_PROPERTY_DEFAULT} spellCheck={false} onChange={(e) => save({ property: e.target.value, order: [] })} title={`A property of the pour data (property set “${POUR_PROPERTY_SET}”). Changing it clears the order.`} />
        </label>
        <datalist id="level-properties">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button type="button" className="btn btn--small" disabled={def.order.length === 0} onClick={() => save({ order: [] })} title="Forget the order set here: each level's place is the first whole number in its text, as the generator reads it when nothing is set">Order by the number in each value</button>
        <span className="scn-dim">{def.order.length ? 'Order set by you.' : 'Order from the number in each value.'}</span>
      </div>
      {levels.length === 0 ? <div className="scn-dim scn-editor__help">No object in the loaded models has the property “{def.property}” in the pour data. Check its name, or load the model.</div> : (
        <table className="xl">
          <colgroup><col style={{ width: 48 }} /><col style={{ width: 280 }} /><col style={{ width: 110 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Place" /><th>Level</th><th title="How many objects have this value">Objects</th></tr></thead>
          <tbody>
            {levels.map((level, i) => (
              <tr key={level} className={drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? 'is-drop' : ''}
                onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                <th scope="row" className="xl__row rel-grip" draggable title="Drag to move the level"
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', level); setDrag({ from: i, over: null }); }}
                  onDragEnd={() => setDrag(null)}>{i + 1}</th>
                <td className="xl__cell xl__ro">{level}</td>
                <td className="xl__cell xl__num xl__ro">{(counts.get(level) ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
