import type { Patch } from './patches';
import type { Rule } from './rules';

/** The IDS library: .ids files in docs/ids, custom rules in docs/ids/rules
    and patches in docs/ids/patches (one JSON file each), read at build time like the
    wiki, so they ship with the app and reach the team with its updates.
    The dev server's /api/ids writes them (vite-plugins/ids.ts). */

const IDS = import.meta.glob('/docs/ids/*.ids', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PATCHES = import.meta.glob('/docs/ids/patches/*.json', { import: 'default', eager: true }) as Record<string, Patch>;
const RULES = import.meta.glob('/docs/ids/rules/*.json', { import: 'default', eager: true }) as Record<string, Rule>;

export interface IdsFile {
  /** File name in docs/ids, e.g. "Minimum-requirements-for-planning.ids". */
  name: string;
  xml: string;
}

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function idsFiles(): IdsFile[] {
  return Object.entries(IDS)
    .map(([p, xml]) => ({ name: fileName(p), xml }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Custom rules (docs/ids/rules): checks IDS can't express. */
export function rules(): Rule[] {
  return Object.values(RULES)
    .filter((r) => r && r.id && r.type)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function patches(): Patch[] {
  return Object.values(PATCHES).filter((p) => p && p.id && p.operation);
}

/** The patches linked to a specification (by its identifier or name). */
export function patchesFor(all: Patch[], ids: string, spec: { name: string; identifier?: string }): Patch[] {
  return all.filter((p) => p.fixes?.some((f) => f.ids === ids && (f.specification === spec.name || (!!spec.identifier && f.specification === spec.identifier))));
}
