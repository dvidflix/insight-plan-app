import * as THREE from 'three';

/** Realistic materials: each colour group of a model (the fragments engine
    draws every element of one colour with one material) is matched to a
    real-world material class from the names its elements carry — the IFC
    material association, the element's name and its IFC class — never from
    the colour itself. The class decides the surface pattern, how reflective
    it is and (for glass) that it is see-through. The match can be changed per
    colour group in the 3D View panel. */
export const MATERIAL_CLASSES = [
  'concrete', 'glass', 'metal', 'grass', 'brick', 'timber', 'asphalt', 'stone', 'gravel', 'soil', 'tile', 'render', 'painted-metal',
] as const;
export type MaterialClass = typeof MATERIAL_CLASSES[number];
/** 'original' keeps the model's own colour for that group, whatever its name says. */
export type ClassChoice = MaterialClass | 'original';

export const MATERIAL_CLASS_LABELS: Record<MaterialClass, string> = {
  concrete: 'Cast concrete',
  glass: 'Glass',
  metal: 'Exposed metal',
  grass: 'Grass / green roof',
  brick: 'Brick',
  timber: 'Timber',
  asphalt: 'Asphalt / tarmac',
  stone: 'Stone / paving',
  gravel: 'Gravel',
  soil: 'Soil / earth',
  tile: 'Tiles',
  render: 'Smooth render',
  'painted-metal': 'Painted metal',
};

/** The shader's class number (0 = no class: the model's own look). */
export const classNumber = (c: MaterialClass) => MATERIAL_CLASSES.indexOf(c) + 1;

const PATTERNS: [MaterialClass, RegExp][] = [
  ['glass', /\b(glass|glazing|glazed|glazier|vision panel|curtain wall glazing|pane|verre|glas)\b/],
  ['metal', /\b(steel|metal|metallic|alu|aluminium|aluminum|zinc|copper|iron|stainless|galvani[sz]ed|brass|bronze|corten|chrome|titanium)\b/],
  ['grass', /\b(grass|green roof|greenroof|sedum|vegetation|turf|lawn|planting|moss|living roof)\b/],
  ['brick', /\b(brick|bricks|brickwork)\b/],
  ['timber', /\b(timber|wood|wooden|oak|pine|spruce|larch|cedar|birch|beech|plywood|ply|osb|clt|glulam|lvl|softwood|hardwood|lumber|veneer|mdf)\b/],
  ['concrete', /\b(concrete|cement|screed|precast|in situ|insitu|blockwork|mortar|raft)\b/],
  ['render', /\b(render|rendered|plaster|plasterboard|stucco|gypsum)\b/],
  ['asphalt', /\b(asphalt|tarmac|tarmacadam|bitumen|bituminous|macadam|blacktop|road surface)\b/],
  ['stone', /\b(stone|granite|limestone|sandstone|marble|slate|basalt|travertine|flagstone|cobble|cobbles|quartzite)\b/],
  ['gravel', /\b(gravel|shingle|pebble|pebbles|ballast)\b/],
  ['soil', /\b(soil|topsoil|subsoil|earth|earthwork|earthworks|backfill|clay|dirt|made ground)\b/],
  ['tile', /\b(tile|tiles|tiled|tiling|ceramic|porcelain|mosaic)\b/],
];
/** Things that contain a class word without being that material. */
const FALSE_POSITIVES = /\b(glass ?fib(re|er)|glass ?wool|fib(re|er) ?glass|mineral wool)\b/g;
/** Layers inside a build-up that are never the visible face. */
const HIDDEN_LAYER = /\b(stud|studs|insulation|insulated|furring|batten|battens|membrane|vapour|vapor|cavity|air gap|sheathing|framing)\b/;
/** An IFC class that says what it is made of on its own. */
const BY_IFC_CLASS: Record<string, MaterialClass> = { IFCWINDOW: 'glass' };

function normalise(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.,:;/\\()[\]{}+|#]+/g, ' ')
    .replace(FALSE_POSITIVES, ' ')
    .replace(/\s+/g, ' ');
}

/** Every class whose words appear in `text`. More than one means an ambiguous
    name ("steel-reinforced concrete"): left for the user to decide. */
export function matchClasses(text: string): MaterialClass[] {
  const n = normalise(text);
  if (!n.trim() || HIDDEN_LAYER.test(n) && !PATTERNS.some(([, re]) => re.test(n))) return [];
  return PATTERNS.filter(([, re]) => re.test(n)).map(([c]) => c);
}

/** What one element tells about its material. */
export interface ElementMaterialInfo {
  /** The colour group (#rrggbb) the engine draws it with. */
  hex: string;
  /** Names from its IFC material association (layers included). */
  materialNames: string[];
  name: string;
  /** IFC class, e.g. "IFCWALL". */
  category: string;
}

/** One colour group of the loaded models, as listed in the 3D View panel. */
export interface MaterialEntry {
  /** #rrggbb. */
  key: string;
  label: string;
  detail: string;
  count: number;
  /** The class its names point to, null when none or ambiguous. */
  auto: MaterialClass | null;
  /** More than one class matched: the group needs a manual choice. */
  ambiguous: boolean;
}

function classOf(info: ElementMaterialInfo): { cls: MaterialClass | null; ambiguous: boolean } {
  // The material association is the strongest hint, then the element's own name.
  for (const text of [info.materialNames.join(' | '), info.name]) {
    const found = matchClasses(text);
    if (found.length === 1) return { cls: found[0], ambiguous: false };
    if (found.length > 1) return { cls: null, ambiguous: true };
  }
  const byClass = BY_IFC_CLASS[info.category.toUpperCase()];
  return { cls: byClass ?? null, ambiguous: false };
}

export function buildMaterialEntries(items: ElementMaterialInfo[]): MaterialEntry[] {
  const groups = new Map<string, { count: number; votes: Map<MaterialClass, number>; ambiguous: number; names: Map<string, number>; cats: Map<string, number> }>();
  for (const it of items) {
    const g = groups.get(it.hex) ?? groups.set(it.hex, { count: 0, votes: new Map(), ambiguous: 0, names: new Map(), cats: new Map() }).get(it.hex)!;
    g.count++;
    const { cls, ambiguous } = classOf(it);
    if (cls) g.votes.set(cls, (g.votes.get(cls) ?? 0) + 1);
    if (ambiguous) g.ambiguous++;
    for (const n of new Set(it.materialNames)) g.names.set(n, (g.names.get(n) ?? 0) + 1);
    if (it.category) g.cats.set(it.category, (g.cats.get(it.category) ?? 0) + 1);
  }
  const top = <T,>(m: Map<T, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const entries: MaterialEntry[] = [];
  for (const [key, g] of groups) {
    const ranked = [...g.votes.entries()].sort((a, b) => b[1] - a[1]);
    const classified = ranked.reduce((s, [, n]) => s + n, 0);
    // A class wins when it is most of what the group's elements say.
    const auto = ranked.length && ranked[0][1] >= 0.6 * classified && classified >= 0.25 * g.count ? ranked[0][0] : null;
    const names = top(g.names, 2);
    const cats = top(g.cats, 3);
    entries.push({
      key,
      label: names.length ? names.join(' / ') : cats[0] ?? 'Unnamed material',
      detail: cats.join(', '),
      count: g.count,
      auto,
      ambiguous: !auto && (g.ambiguous > 0 || ranked.length > 1),
    });
  }
  return entries.sort((a, b) => b.count - a.count);
}

// ---- the mapping in force ---------------------------------------------------

let autoClass = new Map<string, MaterialClass | null>();
let overrides: Record<string, ClassChoice> = {};
let known: { key: string; r: number; g: number; b: number }[] = [];

const parseHex = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

export function setMaterialEntries(entries: MaterialEntry[]) {
  autoClass = new Map(entries.map((e) => [e.key, e.auto]));
  known = entries.map((e) => ({ key: e.key, ...parseHex(e.key) }));
}

export function setClassOverrides(map: Record<string, ClassChoice>) {
  overrides = map;
}

/** The class number for a material of the given colour (0 = keep the model's look). */
export function classNumberForColour(color: THREE.Color): number {
  if (known.length === 0) return 0;
  const hex = `#${color.getHexString()}`;
  let key: string | null = autoClass.has(hex) || hex in overrides ? hex : null;
  if (!key) {
    // The engine's own colour can differ from the one read from the model by a rounding step.
    const { r, g, b } = parseHex(hex);
    let best = 12;
    for (const k of known) {
      const d = Math.abs(k.r - r) + Math.abs(k.g - g) + Math.abs(k.b - b);
      if (d < best) { best = d; key = k.key; }
    }
  }
  if (!key) return 0;
  const choice = overrides[key] ?? autoClass.get(key) ?? 'original';
  return choice === 'original' ? 0 : classNumber(choice);
}

/** Names found anywhere in an IFC relation result (material, layers, layer sets). */
export function collectMaterialNames(value: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) collectMaterialNames(v, out, depth + 1);
    return out;
  }
  const rec = value as Record<string, unknown>;
  for (const key of ['Name', 'LayerSetName', 'ForLayerSet', 'Category']) {
    const v = rec[key];
    const text = v && typeof v === 'object' ? (v as { value?: unknown }).value : v;
    if (key !== 'ForLayerSet' && typeof text === 'string' && text.trim()) out.add(text.trim());
  }
  for (const [k, v] of Object.entries(rec)) if (k !== 'type' && v && typeof v === 'object') collectMaterialNames(v, out, depth + 1);
  return out;
}
