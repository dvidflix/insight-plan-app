import type { SettingValue } from './rules';

/** What a level is, as the scenario's rules say it (the generator reads the same two settings, scenario-engine/core/levels.py): the property of the pour
    data that holds the level, and the level values in the order they are built. With the defaults (the property "Level", no order) the generator reads
    the level as it always did: the first whole number in the text puts it in the order. */

export const LEVEL_PROPERTY_DEFAULT = 'Level';

/** The generator's pour property set (scenario-engine/main.py POUR_PSET): the level property is one of its properties. */
export const POUR_PROPERTY_SET = 'CWA Pour';

export interface LevelDefinition {
  property: string;
  /** Lowest first; empty: ordered by the first whole number of each value. */
  order: string[];
}

export function levelDefinition(settings: Record<string, SettingValue> | undefined): LevelDefinition {
  const property = typeof settings?.levelProperty === 'string' && settings.levelProperty.trim() ? settings.levelProperty.trim() : LEVEL_PROPERTY_DEFAULT;
  const raw = settings?.levelOrder;
  const order = Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : [];
  return { property, order };
}

/** The settings with the definition in them; a part that is the default is taken out, so a scenario that never set it has neither key. */
export function withLevelDefinition(settings: Record<string, SettingValue>, def: LevelDefinition): Record<string, SettingValue> {
  const { levelProperty: _p, levelOrder: _o, ...rest } = settings;
  return {
    ...rest,
    ...(def.property.trim() && def.property.trim() !== LEVEL_PROPERTY_DEFAULT ? { levelProperty: def.property.trim() } : {}),
    ...(def.order.length ? { levelOrder: def.order } : {}),
  };
}

const firstNumber = (v: string): number => { const m = /[-+]?\d+/.exec(v); return m ? Number(m[0]) : 0; };

/** The order the generator gives levels when none is set: the first whole number of the text (none: 0), then the text. */
export const naturalLevelCompare = (a: string, b: string): number => firstNumber(a) - firstNumber(b) || a.localeCompare(b);

/** The levels to show: those the user ordered that are in the model, in that order, then the others in the generator's own order. */
export function orderLevels(present: string[], saved: string[]): string[] {
  const key = (v: string) => v.trim().toUpperCase();
  const have = new Map(present.map((v) => [key(v), v]));
  const listed: string[] = [];
  for (const s of saved) { const v = have.get(key(s)); if (v !== undefined && !listed.includes(v)) listed.push(v); }
  const rest = present.filter((v) => !listed.includes(v)).sort(naturalLevelCompare);
  return [...listed, ...rest];
}
