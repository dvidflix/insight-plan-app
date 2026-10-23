import type { SettingValue } from './rules';

/** What a zone is, as the scenario's rules say it (the generator reads the same three settings, scenario-engine/core/zones.py): the property of the pour data
    that holds the zone, and which zone values are connected to the rest of the building and which are disconnected (built on their own). With none set the
    generator reads the property "Building Zone" and takes the words CONNECTED and DISCONNECTED in its text, as it always did. */

export const ZONE_PROPERTY_DEFAULT = 'Building Zone';

export type ZoneKind = 'connected' | 'disconnected' | 'none';

export interface ZoneDefinition {
  /** Empty: "Building Zone". */
  property: string;
  connected: string[];
  disconnected: string[];
}

const list = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : []);

export function zoneDefinition(settings: Record<string, SettingValue> | undefined): ZoneDefinition {
  const property = typeof settings?.zoneProperty === 'string' ? settings.zoneProperty.trim() : '';
  return { property, connected: list(settings?.zoneConnected), disconnected: list(settings?.zoneDisconnected) };
}

/** The settings with the definition in them; a part that is empty is taken out, so a scenario that never set it has none of the keys. */
export function withZoneDefinition(settings: Record<string, SettingValue>, def: ZoneDefinition): Record<string, SettingValue> {
  const { zoneProperty: _p, zoneConnected: _c, zoneDisconnected: _d, ...rest } = settings;
  return {
    ...rest,
    ...(def.property.trim() && def.property.trim() !== ZONE_PROPERTY_DEFAULT ? { zoneProperty: def.property.trim() } : {}),
    ...(def.connected.length ? { zoneConnected: def.connected } : {}),
    ...(def.disconnected.length ? { zoneDisconnected: def.disconnected } : {}),
  };
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** What the generator makes of a zone value: a value named in a list is that kind (disconnected wins); with no list, the words in the text decide. */
export function zoneKindOf(value: string, def: ZoneDefinition): ZoneKind {
  if (def.connected.length || def.disconnected.length) return def.disconnected.some((v) => same(v, value)) ? 'disconnected' : def.connected.some((v) => same(v, value)) ? 'connected' : 'none';
  const text = value.toUpperCase();
  return text.includes('DISCONNECTED') ? 'disconnected' : text.includes('CONNECTED') ? 'connected' : 'none';
}

/** The definition with one zone value set to a kind. The first choice on a scenario that read the words in the text names the values that already had a kind. */
export function withZoneKind(def: ZoneDefinition, value: string, kind: ZoneKind, present: string[]): ZoneDefinition {
  const listed = def.connected.length > 0 || def.disconnected.length > 0;
  let connected = def.connected;
  let disconnected = def.disconnected;
  if (!listed) {
    connected = present.filter((v) => zoneKindOf(v, def) === 'connected');
    disconnected = present.filter((v) => zoneKindOf(v, def) === 'disconnected');
  }
  const without = (l: string[]) => l.filter((v) => !same(v, value));
  connected = without(connected);
  disconnected = without(disconnected);
  if (kind === 'connected') connected = [...connected, value];
  if (kind === 'disconnected') disconnected = [...disconnected, value];
  return { ...def, connected, disconnected };
}
