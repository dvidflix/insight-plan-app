import type { Candidate } from './evaluate';

/** Levels of AVEVA (E3D) exports, read from the objects' names: the check
    "AVEVA models have a storey per level" and its patch share this. Ported
    from add_location_property.py and group_ifc_objects_by_level.py. */

/** Where an object's level comes from. */
export interface AvevaLevelSource {
  /** The model's Originating System (IFC header) must contain this. */
  originatingSystem: string;
  /** The level is the characters of the object's Name from here, this many. */
  nameStart: number;
  nameLength: number;
  /** "Pset.Property" holding the level, tried before the name. */
  locationProperty?: string;
}

/** Level code → elevation in metres; 11 and above are (number − 7). */
const ELEVATIONS: Record<string, number> = {
  '0J': -28, '0H': -26, '0G': -24, '0F': -22, '0E': -20, '0D': -18, '0C': -16, '0B': -14, '0A': -12,
  '01': -10, '02': -8, '03': -6, '04': -4, '05': -2, '06': -1, '07': 0, '08': 1, '09': 2, '10': 3,
};
for (let i = 11; i <= 80; i++) ELEVATIONS[String(i).padStart(2, '0')] = i - 7;

export const elevationOf = (code: string): number => ELEVATIONS[code] ?? 0;

/** A level code is a known one, or any two digits. */
const isLevelCode = (code: string) => code in ELEVATIONS || /^\d{2}$/.test(code);

/** "Level 07" → 07; "0J" → 0J (the first two digits, else a known last two characters). */
function extractCode(value: string): string | null {
  const v = value.trim();
  const digits = /(\d{2})/.exec(v)?.[1];
  if (digits) return digits;
  const last = v.slice(-2);
  return v.length >= 2 && (/^\d{2}$/.test(last) || last in ELEVATIONS) ? last : null;
}

const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE']);

/** The element's level code, or null when it has none (spatial nodes and
    elements without a GlobalId are not placed). */
export function levelCodeOf(c: { category: string; guid: string; name: string; props: Record<string, unknown> }, src: AvevaLevelSource): string | null {
  if (!c.guid || SPATIAL.has(c.category.toUpperCase())) return null;
  const located = src.locationProperty ? String(c.props[src.locationProperty] ?? '').trim() : '';
  const fromProp = located ? extractCode(located) : null;
  const name = (c.name ?? '').trim();
  const fromName = name.length >= src.nameStart + src.nameLength ? extractCode(name.slice(src.nameStart, src.nameStart + src.nameLength)) : null;
  const code = fromProp ?? fromName;
  return code && isLevelCode(code) ? code : null;
}

/** The levels the objects name, with how many objects each has. */
export function levelsOf(candidates: Candidate[], src: AvevaLevelSource): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of candidates) {
    const code = levelCodeOf(c, src);
    if (code) out.set(code, (out.get(code) ?? 0) + 1);
  }
  return out;
}
