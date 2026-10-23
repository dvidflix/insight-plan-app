import { SETTINGS_META, type SettingValue } from './rules';

/** Sequencing presets: a named change to a few of the engine's switches (the Settings of the rules), so a planner picks how the work runs instead of
    finding the switches. A preset only touches the settings it names, so presets of different things (how steps overlap, the level gate, resource
    limits) combine; a value of `null` puts the generator's own back. Nothing here knows what the objects are. The scenario's other rules are untouched. */

export interface SequencingPreset {
  id: string;
  name: string;
  /** What it does, in a sentence a planner can read. */
  note: string;
  /** Setting key -> value, or null for the generator's own. */
  settings: Record<string, SettingValue | null>;
  /** Saved by the user (can be deleted); the others ship with the app. */
  own?: boolean;
}

/** The facets of the engine a preset can set: every setting that is a behaviour switch (not a distance or a list of types). */
export const PRESET_KEYS: string[] = SETTINGS_META.filter((m) => m.group === 'Sequence' || m.group === 'Level gate' || m.group === 'Resources').map((m) => m.key);

export const SHIPPED_PRESETS: SequencingPreset[] = [
  { id: 'relay', name: 'One step after another', note: 'Each step starts when the one before it has finished. The longest programme, and the safest order.', settings: { sequenceFlow: false, sequenceLeadDays: null, sequenceConcreteFollows: null } },
  { id: 'overlap-in-order', name: 'Steps overlap, in order', note: 'A step starts a few days after the previous one starts, and its concrete follows the previous step\'s.', settings: { sequenceFlow: true, sequenceLeadDays: 3, sequenceConcreteFollows: true } },
  { id: 'overlap-when-ready', name: 'Steps overlap, as ready', note: 'The order sets when each step starts; each pour is cast when it is ready. A shorter programme.', settings: { sequenceFlow: true, sequenceLeadDays: 1, sequenceConcreteFollows: false } },
  { id: 'gate-off', name: 'No level gate', note: 'Work on a level does not wait for the level below.', settings: { levelGate: false } },
  { id: 'gate-on', name: 'Level gate on', note: 'Work waits for the objects on the level below that it touches.', settings: { levelGate: true } },
  { id: 'supports-overlap', name: 'Supports overlap what they hold up', note: 'What rests on a support only has to finish after it, so it can start earlier.', settings: { supportLinkFinishToFinish: true, supportLagPct: 80 } },
  { id: 'unlimited', name: 'Shortest build: no resource limits', note: 'Ignores every limit on people, equipment, cranes and materials, to see what the logic alone allows.', settings: { maximizeResources: true } },
  { id: 'limited', name: 'Use the resource limits', note: 'Respects the capacities and counts of the scenario.', settings: { maximizeResources: null } },
  { id: 'default', name: 'Generator defaults', note: 'Puts every sequencing, level-gate and resource switch back to the generator\'s own.', settings: Object.fromEntries(PRESET_KEYS.map((k) => [k, null])) },
];

const same = (a: SettingValue | null | undefined, b: SettingValue | null | undefined) => (a ?? null) === (b ?? null);

/** The settings with a preset applied (a null puts the generator's value back). */
export function applyPreset(settings: Record<string, SettingValue>, preset: SequencingPreset): Record<string, SettingValue> {
  const out = { ...settings };
  for (const [key, value] of Object.entries(preset.settings)) {
    if (value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** Whether the settings already are what the preset sets. */
export const matches = (settings: Record<string, SettingValue>, preset: SequencingPreset): boolean =>
  Object.entries(preset.settings).every(([key, value]) => same(settings[key], value));

/** The presets whose values the settings are exactly at (a preset that only puts the generator's values back is not named: nothing is changed). */
export const activePresets = (settings: Record<string, SettingValue>, presets: SequencingPreset[]): SequencingPreset[] =>
  presets.filter((p) => matches(settings, p) && Object.values(p.settings).some((v) => v !== null));

/** A preset of the user's own from the scenario's sequencing settings as they are now. */
export function presetFromSettings(name: string, settings: Record<string, SettingValue>, taken: string[]): SequencingPreset {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return { id, name: name.trim(), note: 'Saved from a scenario.', own: true, settings: Object.fromEntries(PRESET_KEYS.map((k) => [k, settings[k] ?? null])) };
}

/** Tidies saved presets: known shape, own, only keys that are settings. */
export function normalizeSequencingPresets(raw: unknown): SequencingPreset[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(SETTINGS_META.map((m) => m.key));
  return raw.filter((p): p is SequencingPreset => !!p && typeof p === 'object' && typeof (p as SequencingPreset).id === 'string' && typeof (p as SequencingPreset).name === 'string' && !!(p as SequencingPreset).settings && typeof (p as SequencingPreset).settings === 'object')
    .map((p) => ({ id: p.id, name: p.name, note: typeof p.note === 'string' ? p.note : '', own: true, settings: Object.fromEntries(Object.entries(p.settings).filter(([k]) => known.has(k))) as SequencingPreset['settings'] }));
}
