import type { Recipe } from './recipes';
import { STANDARD_METHODS } from './standardMethods';
import { CLASS_FIELD, STOREY_FIELD, freshId, type PackagePart, type ResolvedMethod, type WorkPackage } from './workPackages';
import { inTreeOrder, treeRows } from './packageTree';

/** Generate 3's work packages as a table, for bulk editing in Excel and back (a config file of the packages). A row per package, in build order:
    sort or move rows in Excel to change the order. Packages are matched by ID; a row without one is a new package; a package not in the sheet is
    removed. Columns are matched by name in any order (an asterisk or a bracketed note is ignored), and the info columns (marked "(info)") are
    written for reading only.

    "Made of" lists the package's parts, separated by " | "; within a part the conditions are separated by "; " and all must hold:
    `set = <search set>`, `storey = <storey>`, `class = <IFC class>`, `<Pset.Property> = <value>`. Objects picked in 3D cannot be typed: they show as
    `picked = N objects`, and a row whose "Made of" is unchanged keeps them. */

export type Row = Record<string, string | number>;

export const PACKAGES_SHEET = 'Packages';
export const PACKAGES_README_SHEET = 'Read me';

export const PACKAGE_COLUMNS = ['Code (info)', 'ID', 'Inside (ID)', 'Name', 'Colour', 'Made of', 'Starts', 'Gap (days)', 'Method', 'Days', 'Crew size', 'Activity days', 'Added activity', 'Added days', 'Added before', 'Summary bar', 'At most at once', 'Objects (info)', 'Volume m3 (info)', 'Estimate days (info)', 'Method used (info)'] as const;

export const PACKAGES_README: string[] = [
  'Packages: a row per work package of Generate 3, in build order (top first). Move or sort rows to change the order; the packages inside a package follow it.',
  'ID: what a row is matched by when the file is uploaded. Leave it empty for a new package. A package whose ID is not in the sheet is removed.',
  'Inside (ID): the ID of the package that holds this one; empty: at the top.',
  'Made of: the parts, separated by " | "; within a part, conditions separated by "; ", all of which must hold. set = <search set>, storey = <storey>, class = <IFC class>, <Pset.Property> = <value>. "picked = N objects" stands for objects picked in 3D: keep the text unchanged to keep them.',
  'Starts: empty or "after the one above"; "with the one above" (together with it); or "after <ID or code>" (after that package, and all it holds, has finished). Gap (days): working days to wait.',
  'Method: empty for the automatic choice, a standard method by name, or "recipe: <recipe ID>" for one of the project\'s recipes.',
  'Days: the package\'s days in all (its activities share them). Crew size: people in a standard method\'s crew. Activity days: one activity\'s days, "Rebar = 3; Concrete = 1" (Days wins when both are given).',
  'Added activity, Added days, Added before (yes / no): one more activity for the package. Summary bar: yes / no (empty: on for a package that holds others). At most at once: for a package that holds others.',
  'Columns marked (info) are written for reading and ignored on upload. A package’s fine-tuned object order is not in this sheet and is kept as it is.',
];

const norm = (h: string) => h.replace(/\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v: unknown): number | undefined => { const t = s(v).replace(',', '.'); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined; };
const yesNo = (v: unknown): boolean | undefined => { const t = s(v).toLowerCase(); if (!t) return undefined; if (/^(y|yes|true|1|x|on)$/.test(t)) return true; if (/^(n|no|false|0|off)$/.test(t)) return false; return undefined; };
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** A package's parts as text. */
export function partsText(parts: readonly PackagePart[]): string {
  return parts.map((p) => {
    if (p.guids) return `picked = ${p.guids.length} objects`;
    const bits: string[] = [];
    if (p.set) bits.push(`set = ${p.set}`);
    if (p.storey !== undefined) bits.push(`storey = ${p.storey}`);
    if (p.cls) bits.push(`class = ${p.cls}`);
    for (const [k, v] of Object.entries(p.where ?? {})) bits.push(`${k === STOREY_FIELD ? 'storey' : k === CLASS_FIELD ? 'class' : k} = ${v}`);
    return bits.join('; ');
  }).join(' | ');
}

/** Parts from text; null when a part cannot be read (with the reason). */
export function parseParts(text: string): { parts: PackagePart[] } | { error: string } {
  const parts: PackagePart[] = [];
  for (const chunk of text.split('|').map((x) => x.trim()).filter(Boolean)) {
    const part: PackagePart = {};
    for (const cond of chunk.split(';').map((x) => x.trim()).filter(Boolean)) {
      const at = cond.indexOf('=');
      if (at < 1) return { error: `"${cond}" is not "name = value"` };
      const key = cond.slice(0, at).trim();
      const value = cond.slice(at + 1).trim();
      const k = key.toLowerCase();
      if (k === 'picked') return { error: 'objects picked in 3D cannot be typed' };
      if (k === 'set') part.set = value;
      else if (k === 'storey') part.storey = value;
      else if (k === 'class') part.cls = value.toUpperCase();
      else part.where = { ...part.where, [key]: value };
    }
    if (Object.keys(part).length) parts.push(part);
  }
  return { parts };
}

const methodText = (method: string | undefined, recipes: readonly Recipe[]) => {
  if (!method) return '';
  if (method.startsWith('std:')) return STANDARD_METHODS.find((m) => `std:${m.id}` === method)?.name ?? method;
  if (method.startsWith('recipe:')) { const r = recipes.find((x) => x.id === method.slice(7)); return `recipe: ${r?.id ?? method.slice(7)}`; }
  return method;
};

function parseMethod(text: string, recipes: readonly Recipe[]): { method?: string } | { error: string } {
  const t = text.trim();
  if (!t || /^auto/i.test(t)) return {};
  const recipe = /^recipe\s*:\s*(.+)$/i.exec(t);
  if (recipe) {
    const r = recipes.find((x) => x.id.toUpperCase() === recipe[1].trim().toUpperCase() || (x.name ?? '').trim().toUpperCase() === recipe[1].trim().toUpperCase());
    return r ? { method: `recipe:${r.id}` } : { error: `no project recipe "${recipe[1].trim()}"` };
  }
  const m = STANDARD_METHODS.find((x) => x.name.toUpperCase() === t.toUpperCase() || x.id.toUpperCase() === t.toUpperCase());
  if (m) return { method: `std:${m.id}` };
  const r = recipes.find((x) => x.id.toUpperCase() === t.toUpperCase() || (x.name ?? '').trim().toUpperCase() === t.toUpperCase());
  return r ? { method: `recipe:${r.id}` } : { error: `no method "${t}" (a standard method: ${STANDARD_METHODS.map((x) => x.name).join(', ')}; or "recipe: <ID>")` };
}

const daysText = (days: Record<string, number> | undefined) => Object.entries(days ?? {}).map(([k, v]) => `${k} = ${v}`).join('; ');
function parseDays(text: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const bit of text.split(';').map((x) => x.trim()).filter(Boolean)) {
    const at = bit.indexOf('=');
    const v = at > 0 ? num(bit.slice(at + 1)) : undefined;
    if (at > 0 && v !== undefined && v >= 0) out[bit.slice(0, at).trim()] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The packages as rows, with what each holds and the method it gets for reading. */
export function packagesToRows(packages: readonly WorkPackage[], info: { objects: (id: string) => { count: number; volume: number }; method: (id: string) => ResolvedMethod | undefined }, recipes: readonly Recipe[]): Row[] {
  return treeRows(packages).map(({ pkg: p, code: c, children }) => {
    const q = info.objects(p.id);
    const m = q.count ? info.method(p.id) : undefined;
    const starts = p.after ? `after ${p.after}` : p.link === 'with' ? 'with the one above' : '';
    const row: Row = {
      'Code (info)': c, ID: p.id, 'Inside (ID)': p.parent ?? '', Name: p.name, Colour: p.color, 'Made of': partsText(p.parts),
      Starts: starts, 'Gap (days)': p.lagDays ?? '', Method: methodText(p.method, recipes), Days: p.totalDays ?? '', 'Crew size': p.people ?? '',
      'Activity days': daysText(p.days), 'Added activity': p.extra?.name ?? '', 'Added days': p.extra ? p.extra.days : '', 'Added before': p.extra ? (p.extra.before ? 'yes' : 'no') : '',
      'Summary bar': p.bar === undefined ? '' : p.bar ? 'yes' : 'no', 'At most at once': p.maxAtOnce ?? '',
      'Objects (info)': q.count, 'Volume m3 (info)': round(q.volume, 1), 'Estimate days (info)': m ? round(m.estimate, 1) : '',
      'Method used (info)': m ? m.name : children ? `holds ${children}` : 'no objects',
    };
    return row;
  });
}

export interface PackagesImport {
  packages: WorkPackage[];
  added: number;
  changed: number;
  removed: number;
  /** What could not be read, by row (the rest of the row is used). */
  warnings: string[];
}

/** The packages from rows (as packagesToRows writes them, edited). `current` gives the IDs, the picked objects and the colours to keep. */
export function rowsToPackages(rows: readonly Row[], current: readonly WorkPackage[], recipes: readonly Recipe[], colors: (n: number) => string[]): PackagesImport {
  const warnings: string[] = [];
  const byId = new Map(current.map((p) => [p.id.toUpperCase(), p]));
  const codes = new Map(treeRows(current).map((r) => [r.code.toUpperCase(), r.pkg.id]));
  const cells = rows.map((r) => new Map(Object.entries(r).map(([k, v]) => [norm(k), v])));
  const used = cells.filter((c) => s(c.get('name')) || s(c.get('id')) || s(c.get('made of')));
  if (!used.length) throw new Error(`No packages found: the sheet needs the columns ID, Name and Made of. Use a file made with Download Excel.`);
  const out: WorkPackage[] = [];
  const palette = colors(used.length);
  // IDs first (a new row gets one), so "Inside" and "Starts" can name a package further down.
  const ids = used.map((c, i) => {
    const id = s(c.get('id'));
    if (id && !out.some((p) => p.id.toUpperCase() === id.toUpperCase())) { out.push({ id, name: '', color: '', parts: [] }); return id; }
    if (id) warnings.push(`Row ${i + 2}: the ID ${id} is used twice; this row is a new package`);
    const fresh = freshId([...current, ...out]);
    out.push({ id: fresh, name: '', color: '', parts: [] });
    return fresh;
  });
  const known = new Set(ids.map((x) => x.toUpperCase()));
  const refer = (t: string) => { const u = t.trim().toUpperCase(); return known.has(u) ? ids.find((x) => x.toUpperCase() === u) : codes.get(u) && known.has(codes.get(u)!.toUpperCase()) ? codes.get(u) : undefined; };
  let added = 0;
  let changed = 0;
  const packages = used.map((c, i): WorkPackage => {
    const line = `Row ${i + 2}`;
    const id = ids[i];
    const old = byId.get(id.toUpperCase());
    if (!old) added++;
    const name = s(c.get('name')) || old?.name || 'Package';
    // Made of: unchanged keeps the parts as they are (with objects picked in 3D); else read.
    const madeText = s(c.get('made of'));
    let parts: PackagePart[] = old?.parts ?? [];
    if (!old || madeText !== partsText(old.parts)) {
      const read = parseParts(madeText);
      if ('error' in read) warnings.push(`${line} (${name}): Made of not read, ${read.error}${old ? '; kept as it was' : ''}`);
      else parts = read.parts;
    }
    const pkg: WorkPackage = { id, name, color: s(c.get('colour')) || old?.color || palette[i], parts };
    const inside = s(c.get('inside'));
    if (inside) { const p = refer(inside); if (p && p !== id) pkg.parent = p; else warnings.push(`${line} (${name}): Inside "${inside}" is not a package of the sheet; put at the top`); }
    const starts = s(c.get('starts'));
    if (/^with/i.test(starts)) pkg.link = 'with';
    else if (/^after\s+(?!the one above)/i.test(starts)) {
      const target = refer(starts.replace(/^after\s+/i, ''));
      if (target && target !== id) pkg.after = target; else warnings.push(`${line} (${name}): Starts "${starts}" names no package of the sheet; it starts after the one above`);
    } else if (starts && !/^after( the one above)?$/i.test(starts)) warnings.push(`${line} (${name}): Starts "${starts}" not read; it starts after the one above`);
    const gap = num(c.get('gap'));
    if (gap && gap > 0) pkg.lagDays = gap;
    const method = parseMethod(s(c.get('method')), recipes);
    if ('error' in method) warnings.push(`${line} (${name}): ${method.error}; the automatic choice is used`);
    else if (method.method) pkg.method = method.method;
    const total = num(c.get('days'));
    if (total && total > 0) pkg.totalDays = total;
    const people = num(c.get('crew size'));
    if (people && people > 0) pkg.people = Math.round(people);
    const days = parseDays(s(c.get('activity days')));
    if (days && !pkg.totalDays) pkg.days = days;
    const extra = s(c.get('added activity'));
    if (extra) pkg.extra = { name: extra, days: Math.max(0, num(c.get('added days')) ?? 1), ...(yesNo(c.get('added before')) ? { before: true } : {}) };
    const bar = yesNo(c.get('summary bar'));
    if (bar !== undefined) pkg.bar = bar;
    const most = num(c.get('at most at once'));
    if (most && most > 0) pkg.maxAtOnce = Math.round(most);
    // The object order is not in the sheet (Fine-tune object order has its own Excel list): it is kept.
    if (old?.objectOrder) pkg.objectOrder = old.objectOrder;
    if (old && JSON.stringify(normal(old)) !== JSON.stringify(normal(pkg))) changed++;
    return pkg;
  });
  const keep = new Set(packages.map((p) => p.id));
  return { packages: inTreeOrder(packages), added, changed, removed: current.filter((p) => !keep.has(p.id)).length, warnings };
}

/** A package with its keys in one order, for comparing. */
const normal = (p: WorkPackage) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
