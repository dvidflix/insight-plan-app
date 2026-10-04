import type { Activity } from './types';
import type { PourMapEntry } from '../state/pourMapStore';
import { normalisePour } from '../viewer/modelCompare';

/** Renumbering a programme to a new version of the model: every old Pour ID
    found in an activity's ID, name, user fields or WBS names is replaced by
    its new one, all in one pass (so two pours swapping numbers swap
    properly). A Pour ID only counts as a whole token — "0016" in
    "PRJ-HVL-L3-IW-0016-R" or "Wall 0016 - Rebar", not inside a longer number. */

export interface RenumberOptions {
  code: boolean;
  name: boolean;
  udf: boolean;
  wbs: boolean;
}

export const DEFAULT_RENUMBER: RenumberOptions = { code: true, name: true, udf: true, wbs: true };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Entries as used: Pour IDs normalised, blanks and no-ops dropped, the last entry for an old ID winning. */
export function usableEntries(entries: PourMapEntry[]): PourMapEntry[] {
  const byOld = new Map<string, string>();
  for (const e of entries) {
    const o = normalisePour(e.oldPour);
    const n = normalisePour(e.newPour);
    if (o && n && o !== n) byOld.set(o, n);
  }
  return [...byOld].map(([oldPour, newPour]) => ({ oldPour, newPour }));
}

/** The text replacer for a map; the second value counts replacements per old Pour ID. */
export function makeReplacer(entries: PourMapEntry[]) {
  const map = new Map(usableEntries(entries).map((e) => [e.oldPour, e.newPour]));
  const used = new Map<string, number>();
  if (map.size === 0) return { replace: (s: string) => s, used };
  const alt = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const re = new RegExp(`(?<![0-9A-Za-z])(${alt})(?![0-9A-Za-z])`, 'g');
  return {
    replace: (s: string) =>
      s.replace(re, (m) => {
        used.set(m, (used.get(m) ?? 0) + 1);
        return map.get(m) ?? m;
      }),
    used,
  };
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface RenumberChange {
  id: string;
  code: string;
  fields: FieldChange[];
  patch: Partial<Activity>;
}

export interface RenumberPlan {
  changes: RenumberChange[];
  /** Old Pour IDs of the map that no activity carries. */
  unused: string[];
  /** Activity IDs that more than one activity would end up with. */
  duplicates: string[];
}

export function planRenumber(activities: Activity[], entries: PourMapEntry[], opts: RenumberOptions): RenumberPlan {
  const { replace, used } = makeReplacer(entries);
  const changes: RenumberChange[] = [];
  const finalCodes = new Map<string, number>();
  for (const a of activities) {
    if (a.type === 'wbs-summary') continue;
    const fields: FieldChange[] = [];
    const patch: Partial<Activity> = {};
    if (opts.code) {
      const next = replace(a.code);
      if (next !== a.code) {
        fields.push({ field: 'Activity ID', before: a.code, after: next });
        patch.code = next;
      }
    }
    if (opts.name) {
      const next = replace(a.name);
      if (next !== a.name) {
        fields.push({ field: 'Activity name', before: a.name, after: next });
        patch.name = next;
      }
    }
    if (opts.udf) {
      let udf: Activity['udf'] | null = null;
      for (const [k, v] of Object.entries(a.udf)) {
        if (typeof v !== 'string') continue;
        const next = replace(v);
        if (next === v) continue;
        udf ??= { ...a.udf };
        udf[k] = next;
        fields.push({ field: k, before: v, after: next });
      }
      if (udf) patch.udf = udf;
    }
    if (opts.wbs) {
      const path = replace(a.wbsPath);
      if (path !== a.wbsPath) {
        fields.push({ field: 'WBS', before: a.wbsPath, after: path });
        patch.wbsPath = path;
        if (a.wbsCodePath) patch.wbsCodePath = replace(a.wbsCodePath);
      }
    }
    const code = patch.code ?? a.code;
    finalCodes.set(code, (finalCodes.get(code) ?? 0) + 1);
    if (fields.length) changes.push({ id: a.id, code: a.code, fields, patch });
  }
  const touched = new Set(changes.map((c) => c.patch.code ?? c.code));
  return {
    changes,
    unused: usableEntries(entries).map((e) => e.oldPour).filter((o) => !used.has(o)),
    duplicates: [...finalCodes].filter(([code, n]) => n > 1 && touched.has(code)).map(([code]) => code),
  };
}

/** Old → new pairs from a pasted or loaded file: two columns (old, new) separated by a comma, semicolon or tab; a header line is skipped. */
export function parsePourMap(text: string): PourMapEntry[] {
  const out: PourMapEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2 || !cells[0] || !cells[1]) continue;
    if (/old/i.test(cells[0]) && /new/i.test(cells[1])) continue;
    out.push({ oldPour: cells[0], newPour: cells[1] });
  }
  return out;
}
