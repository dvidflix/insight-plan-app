import { SETTINGS_META, type SettingMeta, type SettingValue } from '../../../prs/rules';
import { RuleCard, type RuleContext } from './RuleParts';

/** Rule type Settings: one rule that holds all the engine's switches and distances (the constants of scenario-engine/config.py) as a table.
    A setting is used from here only when it has a value in the rules; the rest are the generator's own. The generator's value is shown only where the value here differs. */

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') || 'none' : v === null || v === undefined ? '—' : v === true ? 'on' : v === false ? 'off' : String(v));

/** Whether a value set here is the generator's own (lists compare without order). */
const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? [...a].sort().join('|') === [...b].sort().join('|') : a === b);

/** Changes a setting (a value of `undefined`, or a number that is not one, puts the generator's back). */
export function setSetting(ctx: RuleContext, key: string, v: SettingValue) {
  ctx.change((r) => {
    const settings = { ...r.settings };
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) delete settings[key];
    else settings[key] = v;
    return { ...r, settings };
  });
}

/** How many settings the scenario sets. */
export const settingsSet = (ctx: RuleContext): number => SETTINGS_META.filter((m) => ctx.rules.settings[m.key] !== undefined).length;

export const resetSettings = (ctx: RuleContext) => ctx.change((r) => ({ ...r, settings: {} }));

function Control({ meta, shown, onChange }: { meta: SettingMeta; shown: SettingValue; onChange: (v: SettingValue) => void }) {
  if (meta.kind === 'bool') {
    const on = shown === true;
    return (
      <button type="button" role="switch" aria-checked={on} aria-label={meta.label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch__thumb" />
      </button>
    );
  }
  if (meta.kind === 'number') {
    return (
      <span className="rule-setting__number">
        <input className="rule-num" type="number" min={0} step="any" value={typeof shown === 'number' ? shown : ''} placeholder="—" onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} aria-label={meta.label} />
        {meta.unit && <span className="rule-setting__unit">{meta.unit}</span>}
      </span>
    );
  }
  return (
    <input
      className="rule-text"
      value={Array.isArray(shown) ? shown.join(', ') : ''}
      onChange={(e) => onChange(e.target.value.split(/[,;]/).map((x) => x.trim().toUpperCase().replace(/ /g, '_')).filter(Boolean))}
      placeholder="BOSS, SCREED"
      aria-label={meta.label}
      spellCheck={false}
    />
  );
}

export function SettingsRowCard({ ctx }: { ctx: RuleContext }) {
  const set = settingsSet(ctx);
  const changed = SETTINGS_META.filter((m) => ctx.rules.settings[m.key] !== undefined && ctx.defaults && !same(ctx.rules.settings[m.key], ctx.defaults.settings[m.key])).length;
  const groups = [...new Set(SETTINGS_META.map((m) => m.group))];
  return (
    <RuleCard
      kind="setting"
      id=""
      enabled
      onDelete={() => {
        if (set === 0 || window.confirm(`Put back the generator's value of the ${set} setting${set === 1 ? '' : 's'} set here?`)) resetSettings(ctx);
      }}
      summary={`${set} of ${SETTINGS_META.length} set here${changed ? `, ${changed} different from the generator's` : ''}`}
    >
      <div className="rule-settings">
        {groups.map((group) => (
          <section key={group} className="rule-settings__group">
            <h4>{group}</h4>
            {SETTINGS_META.filter((m) => m.group === group).map((m) => {
              const value = ctx.rules.settings[m.key];
              const def = ctx.defaults?.settings[m.key];
              const isSet = value !== undefined;
              const differs = isSet && ctx.defaults !== null && !same(value, def);
              return (
                <div key={m.key} className={`rule-setting${differs ? ' is-changed' : ''}`}>
                  <div className="rule-setting__text">
                    <span className="rule-setting__name">{m.label}</span>
                    <span className="rule-setting__help">{m.help}</span>
                  </div>
                  <div className="rule-setting__control">
                    <Control meta={m} shown={isSet ? value : (def as SettingValue)} onChange={(v) => setSetting(ctx, m.key, v)} />
                    {differs ? (
                      <span className="rule-setting__was">
                        generator: {fmt(def)}{' '}
                        <button type="button" className="mini-btn" onClick={() => setSetting(ctx, m.key, undefined)} title="Back to the generator's value">reset</button>
                      </span>
                    ) : (
                      !isSet && <span className="rule-setting__was">generator's</span>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className="scn-dim scn-editor__help">A setting changed here is used for this scenario only; the generator's own value is used for the others. A value equal to the generator's is the same as not setting it. Which objects are left out of the schedule, and which are stair steps, is decided by Groups.</div>
    </RuleCard>
  );
}
